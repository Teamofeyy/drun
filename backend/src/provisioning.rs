//! Одноразовая установка агента по SSH: ansible-playbook во временном каталоге, секреты не персистятся.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use tempfile::TempDir;
use tokio::process::Command;

use crate::{
    error::ApiError,
    roles::UserRole,
    session::resolve_session,
    state::AppState,
};

/// Максимум текста stdout/stderr в JSON-ответе
const OUTPUT_CAP: usize = 48 * 1024;

#[derive(Debug, Deserialize)]
pub struct ProvisionAgentRequest {
    pub host: String,
    pub ssh_user: String,
    #[serde(default = "default_ssh_port")]
    pub ssh_port: u16,
    pub agent_name: String,
    /// Базовый URL API InfraHub, как его видит удалённый хост (например https://hub.example:8080)
    pub infrahub_api_base: String,
    /// URL для get_url (Linux binary). Пусто — взять из INFRAHUB_AGENT_DOWNLOAD_URL сервера
    #[serde(default)]
    pub agent_download_url: Option<String>,
    #[serde(default)]
    pub private_key_pem: Option<String>,
    #[serde(default)]
    pub ssh_password: Option<String>,
}

fn default_ssh_port() -> u16 {
    22
}

#[derive(Debug, Serialize)]
pub struct ProvisionAgentResponse {
    pub ok: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
struct InventoryAll {
    hosts: BTreeMap<String, HostConn>,
}

#[derive(Debug, Serialize)]
struct InventoryDoc {
    all: InventoryAll,
}

#[derive(Debug, Serialize)]
struct HostConn {
    ansible_host: String,
    ansible_user: String,
    ansible_port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    ansible_ssh_private_key_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ansible_password: Option<String>,
}

#[derive(Debug, Serialize)]
struct ExtraVars {
    infrahub_server: String,
    infrahub_agent_name: String,
    infrahub_agent_download_url: String,
    infrahub_agent_install_path: String,
    infrahub_agent_state_dir: String,
}

pub async fn provision_agent(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ProvisionAgentRequest>,
) -> Result<Json<ProvisionAgentResponse>, ApiError> {
    let (_, role) = resolve_session(&state, &headers).await?;
    role.require(UserRole::Operator)?;

    let req = validate_request(body)?;

    let ansible_dir = ansible_directory();
    let playbook = ansible_dir.join("playbooks/install_agent.yml");
    if !playbook.is_file() {
        tracing::error!(path = %playbook.display(), "ansible playbook missing");
        return Err(ApiError::new(
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "ansible playbook not configured on server",
        ));
    }

    let download_url = req
        .agent_download_url_override
        .clone()
        .or_else(|| state.config.agent_download_url_default.clone())
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| {
            ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "agent_download_url required (or set INFRAHUB_AGENT_DOWNLOAD_URL on server)",
            )
        })?;

    let timeout_secs = state.config.provision_timeout_secs;

    let run_result = run_ansible_playbook(
        &ansible_dir,
        &playbook,
        &req,
        &download_url,
        Duration::from_secs(timeout_secs),
    )
    .await;

    match run_result {
        Ok(out) => {
            let ok = out.exit_code == Some(0);
            let message = if ok {
                "provision finished".into()
            } else {
                format!(
                    "ansible-playbook exited with code {:?}",
                    out.exit_code
                )
            };
            Ok(Json(ProvisionAgentResponse {
                ok,
                exit_code: out.exit_code,
                stdout: truncate_output(&out.stdout),
                stderr: truncate_output(&out.stderr),
                message,
            }))
        }
        Err(e) => {
            tracing::error!(error = %e, "provision failed");
            Ok(Json(ProvisionAgentResponse {
                ok: false,
                exit_code: None,
                stdout: String::new(),
                stderr: truncate_output(e.as_str()),
                message: "provision failed".into(),
            }))
        }
    }
}

struct AnsibleOutput {
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
}

fn truncate_output(s: &str) -> String {
    let mut t = s.to_string();
    if t.len() > OUTPUT_CAP {
        t.truncate(OUTPUT_CAP);
        t.push_str("\n…(truncated)…");
    }
    t
}

struct ValidatedRequest {
    host: String,
    ssh_user: String,
    ssh_port: u16,
    agent_name: String,
    infrahub_api_base: String,
    /// Явный URL из UI (иначе — из конфига сервера)
    agent_download_url_override: Option<String>,
    private_key_pem: Option<String>,
    ssh_password: Option<String>,
}

fn validate_request(body: ProvisionAgentRequest) -> Result<ValidatedRequest, ApiError> {
    let host = body.host.trim().to_string();
    let ssh_user = body.ssh_user.trim().to_string();
    let agent_name = body.agent_name.trim().to_string();
    let infrahub = body.infrahub_api_base.trim().to_string();

    if !validate_host(&host) {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "invalid host",
        ));
    }
    if !validate_ssh_user(&ssh_user) {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "invalid ssh_user",
        ));
    }
    if agent_name.is_empty() || agent_name.len() > 256 || agent_name.chars().any(|c| c.is_control()) {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "invalid agent_name",
        ));
    }
    if !validate_infrahub_base(&infrahub) {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "invalid infrahub_api_base",
        ));
    }

    let key = body
        .private_key_pem
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let pass = body
        .ssh_password
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    match (&key, &pass) {
        (Some(_), Some(_)) => {
            return Err(ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "provide either private_key_pem or ssh_password, not both",
            ));
        }
        (None, None) => {
            return Err(ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "private_key_pem or ssh_password required",
            ));
        }
        _ => {}
    }

    let agent_download_url_override = body.agent_download_url.and_then(|s| {
        let t = s.trim().to_string();
        if t.is_empty() {
            None
        } else {
            Some(t)
        }
    });

    if let Some(ref u) = agent_download_url_override {
        if !validate_download_url(u) {
            return Err(ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "invalid agent_download_url",
            ));
        }
    }

    Ok(ValidatedRequest {
        host,
        ssh_user,
        ssh_port: body.ssh_port,
        agent_name,
        infrahub_api_base: infrahub,
        agent_download_url_override,
        private_key_pem: key,
        ssh_password: pass,
    })
}

fn validate_host(host: &str) -> bool {
    if host.is_empty() || host.len() > 255 {
        return false;
    }
    let inner = host
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .unwrap_or(host);
    if inner.parse::<std::net::IpAddr>().is_ok() {
        return true;
    }
    for label in host.split('.') {
        if label.is_empty() || label.len() > 63 {
            return false;
        }
        if !label
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return false;
        }
    }
    true
}

fn validate_ssh_user(u: &str) -> bool {
    if u.is_empty() || u.len() > 32 {
        return false;
    }
    u.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn validate_infrahub_base(s: &str) -> bool {
    if s.len() < 8 || s.len() > 2048 {
        return false;
    }
    let lower = s.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

fn validate_download_url(s: &str) -> bool {
    if s.len() > 2048 || s.chars().any(|c| c.is_control()) {
        return false;
    }
    let lower = s.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

fn ansible_directory() -> PathBuf {
    if let Ok(v) = std::env::var("INFRAHUB_ANSIBLE_DIR") {
        let p = PathBuf::from(v);
        if p.is_dir() {
            return p;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../ansible")
}

async fn run_ansible_playbook(
    ansible_dir: &Path,
    playbook: &Path,
    req: &ValidatedRequest,
    download_url: &str,
    timeout_dur: Duration,
) -> Result<AnsibleOutput, String> {
    let tmp = TempDir::new().map_err(|e| format!("tempdir: {e}"))?;
    let tmp_path = tmp.path();

    let key_path = tmp_path.join("ssh_key.pem");
    let inventory_path = tmp_path.join("inventory.yml");
    let extra_path = tmp_path.join("extra_vars.yml");

    let mut host_vars = HostConn {
        ansible_host: req.host.clone(),
        ansible_user: req.ssh_user.clone(),
        ansible_port: req.ssh_port,
        ansible_ssh_private_key_file: None,
        ansible_password: None,
    };

    if let Some(ref pem) = req.private_key_pem {
        let mut f = std::fs::File::create(&key_path).map_err(|e| format!("key file: {e}"))?;
        f.write_all(pem.as_bytes())
            .map_err(|e| format!("key write: {e}"))?;
        drop(f);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let m = std::fs::metadata(&key_path).map_err(|e| format!("key meta: {e}"))?;
            let mut p = m.permissions();
            p.set_mode(0o600);
            std::fs::set_permissions(&key_path, p).map_err(|e| format!("chmod key: {e}"))?;
        }
        host_vars.ansible_ssh_private_key_file = Some(key_path.to_string_lossy().to_string());
    } else if let Some(ref pw) = req.ssh_password {
        host_vars.ansible_password = Some(pw.clone());
    }

    let mut hosts = BTreeMap::new();
    hosts.insert("provision_target".to_string(), host_vars);
    let inv = InventoryDoc {
        all: InventoryAll { hosts },
    };
    let inv_yaml = serde_yaml::to_string(&inv).map_err(|e| format!("inventory yaml: {e}"))?;
    tokio::fs::write(&inventory_path, inv_yaml)
        .await
        .map_err(|e| format!("write inventory: {e}"))?;

    let extra = ExtraVars {
        infrahub_server: req.infrahub_api_base.clone(),
        infrahub_agent_name: req.agent_name.clone(),
        infrahub_agent_download_url: download_url.to_string(),
        infrahub_agent_install_path: "/usr/local/bin/infrahub-agent".into(),
        infrahub_agent_state_dir: "/var/lib/infrahub-agent".into(),
    };
    let extra_yaml = serde_yaml::to_string(&extra).map_err(|e| format!("extra yaml: {e}"))?;
    tokio::fs::write(&extra_path, extra_yaml)
        .await
        .map_err(|e| format!("write extra: {e}"))?;

    let playbook_str = playbook
        .to_str()
        .ok_or_else(|| "playbook path utf-8".to_string())?;
    let inv_str = inventory_path
        .to_str()
        .ok_or_else(|| "inventory path utf-8".to_string())?;
    let extra_str = extra_path
        .to_str()
        .ok_or_else(|| "extra path utf-8".to_string())?;

    let mut cmd = Command::new("ansible-playbook");
    cmd.arg("-i")
        .arg(inv_str)
        .arg("-e")
        .arg(format!("@{extra_str}"))
        .arg(playbook_str)
        .current_dir(ansible_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env(
            "ANSIBLE_SSH_COMMON_ARGS",
            "-o StrictHostKeyChecking=accept-new",
        );

    let output = tokio::time::timeout(timeout_dur, cmd.output())
        .await
        .map_err(|_| format!("ansible-playbook timed out after {timeout_dur:?}"))?
        .map_err(|e| format!("ansible-playbook spawn: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

    drop(tmp);
    Ok(AnsibleOutput {
        exit_code: output.status.code(),
        stdout,
        stderr,
    })
}
