use std::fs;
use std::io::Read;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sysinfo::{Disks, Networks, System};
use tokio::net::{lookup_host, TcpStream};

#[derive(Debug, thiserror::Error)]
pub enum CheckError {
    #[error("unknown task kind: {0}")]
    UnknownKind(String),
    #[error("invalid payload: {0}")]
    BadPayload(String),
    #[error("unknown diagnostic scenario: {0}")]
    UnknownScenario(String),
    #[error("unknown bundle template: {0}")]
    UnknownTemplate(String),
    #[error("invalid scenario definition: {0}")]
    BadScenario(String),
}

pub struct CheckOutput {
    pub data: Value,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub exit_code: i32,
    pub logs: Vec<(String, String)>,
    pub summary: String,
}

async fn run_inner(kind: &str, payload: &Value) -> Result<CheckOutput, CheckError> {
    match kind {
        "system_info" => system_info(),
        "port_check" => port_check(payload).await,
        "diagnostic" => diagnostic(payload).await,
        "network_reachability" => network_reachability(payload).await,
        "check_bundle" => check_bundle(payload).await,
        "file_upload" => file_upload(payload),
        "path_snapshot" => path_snapshot(payload),
        "shell_script" => shell_script(payload).await,
        "agent_self_update" => agent_self_update(payload).await,
        _ => Err(CheckError::UnknownKind(kind.into())),
    }
}

pub async fn run(kind: &str, payload: &Value) -> Result<CheckOutput, CheckError> {
    let kind = kind.trim();
    let mut out = match kind {
        "scenario_run" => scenario_run(payload).await?,
        "system_info"
        | "port_check"
        | "diagnostic"
        | "network_reachability"
        | "check_bundle"
        | "file_upload"
        | "path_snapshot"
        | "shell_script"
        | "agent_self_update" => run_inner(kind, payload).await?,
        _ => return Err(CheckError::UnknownKind(kind.into())),
    };
    if out.summary.is_empty() {
        out.summary = autosummary(kind, &out.data);
    }
    Ok(out)
}

fn autosummary(kind: &str, data: &Value) -> String {
    match kind {
        "system_info" => data
            .get("hostname")
            .and_then(|v| v.as_str())
            .map(|h| {
                format!(
                    "Узел {h}, {}",
                    data.get("os_long").and_then(|v| v.as_str()).unwrap_or("")
                )
            })
            .unwrap_or_else(|| "Сводка по системе".into()),
        "port_check" => {
            let n = data
                .get("results")
                .and_then(|r| r.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            let open = data
                .get("results")
                .and_then(|r| r.as_array())
                .map(|a| {
                    a.iter()
                        .filter(|x| x.get("open").and_then(|v| v.as_bool()) == Some(true))
                        .count()
                })
                .unwrap_or(0);
            format!("Проверено портов: {n}, доступно TCP: {open}")
        }
        "network_reachability" => {
            let n = data
                .get("results")
                .and_then(|r| r.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            let ok = data
                .get("results")
                .and_then(|r| r.as_array())
                .map(|a| {
                    a.iter()
                        .filter(|x| x.get("reachable").and_then(|v| v.as_bool()) == Some(true))
                        .count()
                })
                .unwrap_or(0);
            format!("Целей: {n}, доступно: {ok}")
        }
        "diagnostic" => data
            .get("line")
            .or_else(|| data.get("hostname"))
            .and_then(|v| v.as_str())
            .map(|s| s.chars().take(120).collect())
            .unwrap_or_else(|| "Диагностика".into()),
        "check_bundle" => data
            .get("template")
            .and_then(|v| v.as_str())
            .map(|t| format!("Шаблон «{t}»"))
            .unwrap_or_else(|| "Комплексная проверка".into()),
        "scenario_run" => data
            .get("scenario_name")
            .and_then(|v| v.as_str())
            .map(|name| {
                let total = data
                    .get("steps")
                    .and_then(|v| v.as_array())
                    .map(|v| v.len())
                    .unwrap_or(0);
                let ok = data
                    .get("steps")
                    .and_then(|v| v.as_array())
                    .map(|steps| {
                        steps
                            .iter()
                            .filter(|step| {
                                step.get("status").and_then(|v| v.as_str()) == Some("done")
                            })
                            .count()
                    })
                    .unwrap_or(0);
                format!("Сценарий {name}: шагов {total}, успешно {ok}")
            })
            .unwrap_or_else(|| "Сценарий выполнен".into()),
        "file_upload" => {
            let path = data
                .get("destination_path")
                .and_then(|v| v.as_str())
                .unwrap_or("?");
            let bytes = data
                .get("bytes_written")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            format!("Файл доставлен: {path} ({bytes} байт)")
        }
        "path_snapshot" => {
            let path = data.get("path").and_then(|v| v.as_str()).unwrap_or("?");
            let exists = data.get("exists").and_then(|v| v.as_bool()) == Some(true);
            let kind = data.get("kind").and_then(|v| v.as_str()).unwrap_or("?");
            if exists {
                format!("Снимок пути: {path} ({kind})")
            } else {
                format!("Снимок пути: {path} (нет)")
            }
        }
        "shell_script" => {
            if data.get("timed_out").and_then(|v| v.as_bool()) == Some(true) {
                "Shell: таймаут".into()
            } else {
                let code = data.get("exit_code").and_then(|v| v.as_i64()).unwrap_or(-1);
                format!("Shell: код выхода {code}")
            }
        }
        _ => "Готово".into(),
    }
}

#[cfg(unix)]
async fn shell_script(payload: &Value) -> Result<CheckOutput, CheckError> {
    use std::process::Stdio;
    use tokio::process::Command;

    const MAX_STREAM_BYTES: usize = 256 * 1024;

    let script = payload
        .get("script")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CheckError::BadPayload("script required".into()))?;
    let script = script.trim();
    if script.is_empty() {
        return Err(CheckError::BadPayload("script must not be empty".into()));
    }

    let timeout_secs = payload
        .get("timeout_secs")
        .and_then(|v| v.as_u64())
        .unwrap_or(300)
        .clamp(1, 3600);

    let mut logs: Vec<(String, String)> = vec![(
        "info".into(),
        format!("shell_script: bash -c, timeout={timeout_secs}s"),
    )];

    let duration = Duration::from_secs(timeout_secs);
    let fut = async {
        let child = Command::new("bash")
            .arg("-c")
            .arg(script)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| CheckError::BadPayload(format!("spawn failed: {e}")))?;
        child
            .wait_with_output()
            .await
            .map_err(|e| CheckError::BadPayload(format!("wait failed: {e}")))
    };

    match tokio::time::timeout(duration, fut).await {
        Ok(Ok(output)) => {
            let code = output.status.code().unwrap_or(-1);
            let stdout_raw = String::from_utf8_lossy(&output.stdout).into_owned();
            let stderr_raw = String::from_utf8_lossy(&output.stderr).into_owned();
            let stdout = truncate_utf8_bytes(&stdout_raw, MAX_STREAM_BYTES);
            let stderr = truncate_utf8_bytes(&stderr_raw, MAX_STREAM_BYTES);
            if code != 0 {
                logs.push(("error".into(), format!("exit code {code}")));
            }
            Ok(CheckOutput {
                data: json!({
                    "exit_code": code,
                    "timed_out": false,
                }),
                stdout: Some(stdout),
                stderr: Some(stderr),
                exit_code: code,
                logs,
                summary: String::new(),
            })
        }
        Ok(Err(e)) => Err(e),
        Err(_) => {
            logs.push(("error".into(), format!("timed out after {timeout_secs}s")));
            Ok(CheckOutput {
                data: json!({
                    "exit_code": 124,
                    "timed_out": true,
                }),
                stdout: None,
                stderr: Some(format!("Timed out after {timeout_secs}s")),
                exit_code: 124,
                logs,
                summary: String::new(),
            })
        }
    }
}

#[cfg(not(unix))]
async fn shell_script(_payload: &Value) -> Result<CheckOutput, CheckError> {
    Err(CheckError::BadPayload(
        "shell_script is only supported on Unix-like systems with bash".into(),
    ))
}

fn truncate_utf8_bytes(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…\n[truncated, total {} bytes]", &s[..end], s.len())
}

/// Имя musl-артефакта на релизе (как в `ansible/playbooks/install_agent.yml`).
fn musl_download_basename(arch: &str) -> Option<&'static str> {
    match arch.trim().to_ascii_lowercase().as_str() {
        "x86_64" | "amd64" => Some("infrahub-agent-x86_64-unknown-linux-musl"),
        "aarch64" | "arm64" => Some("infrahub-agent-aarch64-unknown-linux-musl"),
        _ => None,
    }
}

#[cfg(unix)]
async fn agent_self_update(payload: &Value) -> Result<CheckOutput, CheckError> {
    use std::os::unix::fs::PermissionsExt;
    use tokio::process::Command;

    let release_base = payload
        .get("release_base")
        .and_then(|v| if v.is_null() { None } else { v.as_str() })
        .ok_or_else(|| CheckError::BadPayload("release_base required".into()))?;
    let release_base = release_base.trim().trim_end_matches('/');
    if release_base.is_empty() {
        return Err(CheckError::BadPayload(
            "release_base must not be empty".into(),
        ));
    }

    let install_path = payload
        .get("install_path")
        .and_then(|v| v.as_str())
        .unwrap_or("/usr/local/bin/infrahub-agent");
    let install_path = PathBuf::from(install_path);

    let arch_raw = std::env::var("INFRAHUB_AGENT_CPU_ARCH")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(System::cpu_arch)
        .unwrap_or_else(|| "unknown".into());

    let basename = musl_download_basename(&arch_raw).ok_or_else(|| {
        CheckError::BadPayload(format!(
            "unsupported cpu architecture for musl bundle: {arch_raw}"
        ))
    })?;

    let url = format!("{release_base}/{basename}");
    let parent = install_path
        .parent()
        .ok_or_else(|| CheckError::BadPayload("invalid install_path".into()))?;
    fs::create_dir_all(parent)
        .map_err(|e| CheckError::BadPayload(format!("create_dir_all: {e}")))?;

    let fname = install_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("infrahub-agent");
    let tmp_path = parent.join(format!(".{fname}.new"));

    let _ = fs::remove_file(&tmp_path);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| CheckError::BadPayload(format!("http client: {e}")))?;

    let mut logs: Vec<(String, String)> = vec![(
        "info".into(),
        format!("agent_self_update: GET {url} (arch={arch_raw})"),
    )];

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| CheckError::BadPayload(format!("download failed: {e}")))?;

    if !resp.status().is_success() {
        return Err(CheckError::BadPayload(format!(
            "HTTP {} for {url}",
            resp.status()
        )));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| CheckError::BadPayload(format!("read body: {e}")))?;

    if bytes.is_empty() {
        return Err(CheckError::BadPayload("empty release artifact".into()));
    }

    fs::write(&tmp_path, &bytes).map_err(|e| CheckError::BadPayload(format!("write tmp: {e}")))?;

    let mut perms = fs::metadata(&tmp_path)
        .map_err(|e| CheckError::BadPayload(format!("metadata tmp: {e}")))?
        .permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&tmp_path, perms)
        .map_err(|e| CheckError::BadPayload(format!("chmod tmp: {e}")))?;

    fs::rename(&tmp_path, &install_path)
        .map_err(|e| CheckError::BadPayload(format!("install rename: {e}")))?;

    logs.push((
        "info".into(),
        "scheduled systemctl restart infrahub-agent (after task completes)".into(),
    ));

    tokio::spawn(async {
        tokio::time::sleep(Duration::from_secs(2)).await;
        let _ = Command::new("systemctl")
            .args(["restart", "infrahub-agent"])
            .status()
            .await;
    });

    let summary = format!(
        "Обновление агента: {basename}, {} MiB, arch {arch_raw}",
        bytes.len() / 1024 / 1024
    );

    Ok(CheckOutput {
        data: json!({
            "release_url": url,
            "basename": basename,
            "bytes_written": bytes.len(),
            "install_path": install_path.to_string_lossy(),
            "cpu_arch_resolved": arch_raw,
            "restart_scheduled": true,
        }),
        stdout: Some(format!(
            "installed {basename} -> {}",
            install_path.display()
        )),
        stderr: None,
        exit_code: 0,
        logs,
        summary,
    })
}

#[cfg(not(unix))]
async fn agent_self_update(_payload: &Value) -> Result<CheckOutput, CheckError> {
    Err(CheckError::BadPayload(
        "agent_self_update is only supported on Unix".into(),
    ))
}

fn scenario_step_kind(step_type: &str, params: &Value) -> Result<(String, Value), CheckError> {
    match step_type {
        "system_info" | "port_check" | "network_reachability" | "check_bundle" => {
            Ok((step_type.to_string(), params.clone()))
        }
        "path_snapshot" | "file_upload" => Ok((step_type.to_string(), params.clone())),
        "diagnostic" => Ok(("diagnostic".to_string(), params.clone())),
        "dns_lookup" => Ok((
            "diagnostic".to_string(),
            json!({
                "scenario": "dns_lookup",
                "host": params.get("host").cloned().unwrap_or(Value::Null),
            }),
        )),
        "hostname" => Ok(("diagnostic".to_string(), json!({ "scenario": "hostname" }))),
        "cpu_load" => Ok(("diagnostic".to_string(), json!({ "scenario": "cpu_load" }))),
        "memory_disks" => Ok((
            "diagnostic".to_string(),
            json!({ "scenario": "memory_disks" }),
        )),
        "agent_self_update" => Ok(("agent_self_update".to_string(), params.clone())),
        other => Err(CheckError::BadScenario(format!(
            "unsupported scenario step type: {other}"
        ))),
    }
}

fn resolve_inputs(value: &Value, inputs: &Value) -> Value {
    match value {
        Value::String(s) => {
            if let Some(path) = s
                .strip_prefix("{{inputs.")
                .and_then(|rest| rest.strip_suffix("}}"))
            {
                return inputs.get(path).cloned().unwrap_or(Value::Null);
            }
            Value::String(s.clone())
        }
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| resolve_inputs(item, inputs))
                .collect(),
        ),
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, v) in map {
                out.insert(k.clone(), resolve_inputs(v, inputs));
            }
            Value::Object(out)
        }
        _ => value.clone(),
    }
}

async fn scenario_run(payload: &Value) -> Result<CheckOutput, CheckError> {
    let definition = payload
        .get("definition")
        .ok_or_else(|| CheckError::BadScenario("definition required".into()))?;
    let steps = definition
        .get("steps")
        .and_then(|v| v.as_array())
        .ok_or_else(|| CheckError::BadScenario("definition.steps[] required".into()))?;
    let inputs = payload.get("inputs").cloned().unwrap_or_else(|| json!({}));
    let scenario_name = payload
        .get("scenario_name")
        .and_then(|v| v.as_str())
        .unwrap_or("scenario");

    let mut run_logs: Vec<(String, String)> = vec![(
        "info".into(),
        format!("scenario_run: {scenario_name}, steps={}", steps.len()),
    )];
    let mut results = Vec::new();
    let mut combined_stdout = Vec::new();

    for step in steps {
        let id = step
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("step")
            .to_string();
        let title = step
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or(&id)
            .to_string();
        let step_type = step
            .get("type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| CheckError::BadScenario(format!("step {id}: type required")))?;
        let params = resolve_inputs(step.get("params").unwrap_or(&Value::Null), &inputs);
        let (kind, resolved_payload) = scenario_step_kind(step_type, &params)?;

        run_logs.push(("info".into(), format!("step {id}: {title} ({step_type})")));
        let out = run_inner(&kind, &resolved_payload).await?;
        run_logs.extend(
            out.logs
                .iter()
                .map(|(level, message)| (level.clone(), format!("[{id}] {message}"))),
        );
        if let Some(stdout) = &out.stdout {
            combined_stdout.push(format!("[{id}] {stdout}"));
        }
        results.push(json!({
            "id": id,
            "title": title,
            "type": step_type,
            "kind": kind,
            "status": if out.exit_code == 0 { "done" } else { "failed" },
            "summary": out.summary,
            "stdout": out.stdout,
            "stderr": out.stderr,
            "exit_code": out.exit_code,
            "data": out.data,
        }));
    }

    let done = results
        .iter()
        .filter(|step| step.get("status").and_then(|v| v.as_str()) == Some("done"))
        .count();
    let summary = format!(
        "Сценарий {scenario_name}: выполнено {done}/{} шагов",
        results.len()
    );

    Ok(CheckOutput {
        data: json!({
            "scenario_id": payload.get("scenario_id").cloned().unwrap_or(Value::Null),
            "scenario_name": scenario_name,
            "scenario_slug": payload.get("scenario_slug").cloned().unwrap_or(Value::Null),
            "scenario_version": payload.get("scenario_version").cloned().unwrap_or(Value::Null),
            "inputs": inputs,
            "steps": results,
        }),
        stdout: if combined_stdout.is_empty() {
            None
        } else {
            Some(combined_stdout.join("\n"))
        },
        stderr: None,
        exit_code: 0,
        logs: run_logs,
        summary,
    })
}

fn system_info() -> Result<CheckOutput, CheckError> {
    let mut sys = System::new_all();
    sys.refresh_all();

    let hn = hostname::get()
        .ok()
        .and_then(|s| s.into_string().ok())
        .unwrap_or_else(|| "(unknown)".into());

    let os_name = System::name().unwrap_or_else(|| "unknown".into());
    let os_ver = System::os_version().unwrap_or_else(|| "".into());
    let os_long = format!("{os_name} {os_ver}").trim().to_string();
    let kernel = System::kernel_version();
    let arch = System::cpu_arch();
    let host = System::host_name();

    let cpus: Vec<Value> = sys
        .cpus()
        .iter()
        .take(64)
        .map(|c| {
            json!({
                "name": c.name(),
                "frequency_mhz": c.frequency(),
                "usage_percent": c.cpu_usage() as f64,
            })
        })
        .collect();

    let mut networks = Networks::new_with_refreshed_list();
    networks.refresh();

    let mut ifaces_traffic: Vec<Value> = Vec::new();
    for (iface_name, net) in networks.iter() {
        ifaces_traffic.push(json!({
            "name": iface_name,
            "received_bytes": net.received(),
            "transmitted_bytes": net.transmitted(),
            "packets_received": net.packets_received(),
            "packets_transmitted": net.packets_transmitted(),
            "errors_on_received": net.errors_on_received(),
            "errors_on_transmitted": net.errors_on_transmitted(),
        }));
    }

    let mut ip_by_iface: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    if let Ok(list) = if_addrs::get_if_addrs() {
        for ifa in list {
            let ip = ifa.addr.ip();
            if ip.is_unspecified() {
                continue;
            }
            ip_by_iface
                .entry(ifa.name.clone())
                .or_default()
                .push(format!("{ip}"));
        }
    }

    let mut interfaces: Vec<Value> = Vec::new();
    for t in &ifaces_traffic {
        let name = t.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let ips = ip_by_iface.get(name).cloned().unwrap_or_default();
        let mut row = t.clone();
        if let Some(obj) = row.as_object_mut() {
            obj.insert("ip_addresses".into(), json!(ips));
        }
        interfaces.push(row);
    }

    let all_ips: Vec<String> = ip_by_iface.values().flatten().cloned().collect();

    let disks = Disks::new_with_refreshed_list();
    let mut mounts: Vec<Value> = Vec::new();
    for d in disks.list() {
        mounts.push(json!({
            "name": d.name().to_string_lossy(),
            "mount_point": d.mount_point().to_string_lossy(),
            "file_system": d.file_system().to_string_lossy(),
            "total_bytes": d.total_space(),
            "available_bytes": d.available_space(),
        }));
    }

    let data = json!({
        "hostname": hn,
        "host_name_sys": host,
        "os_long": os_long,
        "kernel": kernel,
        "cpu_arch": arch,
        "infrahub_agent_version": env!("CARGO_PKG_VERSION"),
        "cpus_logical": sys.cpus().len(),
        "memory_total_bytes": sys.total_memory(),
        "memory_used_bytes": sys.used_memory(),
        "memory_available_bytes": sys.available_memory(),
        "swap_total_bytes": sys.total_swap(),
        "swap_used_bytes": sys.used_swap(),
        "cpus": cpus,
        "all_ip_addresses": all_ips,
        "interfaces": interfaces,
        "disk_mounts": mounts,
    });

    let summary = format!(
        "{hn}: {os_long}, RAM {} / {} MiB, интерфейсов с IP: {}",
        sys.used_memory() / 1024 / 1024,
        sys.total_memory() / 1024 / 1024,
        ip_by_iface.len()
    );

    Ok(CheckOutput {
        data,
        stdout: Some(hn.clone()),
        stderr: None,
        exit_code: 0,
        logs: vec![(
            "info".into(),
            "system_info: hostname, IPs, interfaces, OS, CPU, RAM, disks".into(),
        )],
        summary,
    })
}

async fn port_check(payload: &Value) -> Result<CheckOutput, CheckError> {
    let targets = payload
        .get("targets")
        .and_then(|v| v.as_array())
        .ok_or_else(|| CheckError::BadPayload("expected targets[]".into()))?;

    let timeout_secs = payload
        .get("timeout_secs")
        .and_then(|v| v.as_u64())
        .unwrap_or(5)
        .clamp(1, 60);

    let mut results = Vec::new();
    for t in targets {
        let host = t
            .get("host")
            .and_then(|v| v.as_str())
            .ok_or_else(|| CheckError::BadPayload("target.host".into()))?;
        let port = t
            .get("port")
            .and_then(|v| v.as_u64())
            .or_else(|| t.get("port").and_then(|v| v.as_i64()).map(|x| x as u64))
            .ok_or_else(|| CheckError::BadPayload("target.port".into()))? as u16;

        let addr = format!("{host}:{port}");
        let started = Instant::now();
        let mut resolved: Vec<String> = Vec::new();
        if let Ok(mut it) = lookup_host((host, port)).await {
            for sa in it.by_ref().take(8) {
                resolved.push(sa.to_string());
            }
        }

        let connect_res = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            TcpStream::connect(&addr),
        )
        .await;

        let (open, error, rtt_ms) = match connect_res {
            Ok(Ok(_)) => (true, None, Some(started.elapsed().as_secs_f64() * 1000.0)),
            Ok(Err(e)) => (
                false,
                Some(format!("tcp: {e}")),
                Some(started.elapsed().as_secs_f64() * 1000.0),
            ),
            Err(_) => (false, Some("timeout".into()), None),
        };

        results.push(json!({
            "host": host,
            "port": port,
            "address_tried": addr,
            "open": open,
            "connect_time_ms": rtt_ms,
            "error": error,
            "resolved_endpoints": resolved,
        }));
    }

    let open_n = results
        .iter()
        .filter(|r| r.get("open").and_then(|v| v.as_bool()) == Some(true))
        .count();

    Ok(CheckOutput {
        data: json!({ "results": results, "timeout_secs": timeout_secs }),
        stdout: Some(format!("{open_n}/{} портов отвечают TCP", results.len())),
        stderr: None,
        exit_code: 0,
        logs: vec![("info".into(), "port_check with timing and DNS".into())],
        summary: format!("Портов проверено: {}, TCP OK: {open_n}", results.len()),
    })
}

async fn diagnostic(payload: &Value) -> Result<CheckOutput, CheckError> {
    let scenario = payload
        .get("scenario")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CheckError::BadPayload("scenario required".into()))?;

    match scenario {
        "uname" => {
            let mut sys = System::new_all();
            sys.refresh_all();
            let line = format!(
                "{} {} {}",
                System::name().unwrap_or_else(|| "OS".into()),
                System::kernel_version().unwrap_or_else(|| "?".into()),
                System::os_version().unwrap_or_else(|| "".into())
            );
            Ok(CheckOutput {
                data: json!({ "scenario": "uname", "line": line }),
                stdout: Some(line.clone()),
                stderr: None,
                exit_code: 0,
                logs: vec![("info".into(), "diagnostic uname".into())],
                summary: line.chars().take(100).collect(),
            })
        }
        "hostname" => {
            let hn = hostname::get()
                .ok()
                .and_then(|s| s.into_string().ok())
                .unwrap_or_else(|| "(unknown)".into());
            Ok(CheckOutput {
                data: json!({ "scenario": "hostname", "hostname": hn }),
                stdout: Some(hn.clone()),
                stderr: None,
                exit_code: 0,
                logs: vec![("info".into(), "diagnostic hostname".into())],
                summary: format!("Hostname: {hn}"),
            })
        }
        "interfaces_summary" => {
            let mut networks = Networks::new_with_refreshed_list();
            networks.refresh();
            let names: Vec<String> = networks.keys().cloned().collect();
            Ok(CheckOutput {
                data: json!({ "scenario": "interfaces_summary", "names": names }),
                stdout: Some(names.join(", ")),
                stderr: None,
                exit_code: 0,
                logs: vec![("info".into(), "interfaces_summary".into())],
                summary: format!("Интерфейсов: {}", names.len()),
            })
        }
        "memory_disks" => {
            let mut sys = System::new_all();
            sys.refresh_memory();
            let disks = Disks::new_with_refreshed_list();
            let mounts: Vec<Value> = disks
                .list()
                .iter()
                .map(|d| {
                    json!({
                        "mount": d.mount_point().to_string_lossy(),
                        "total_gb": (d.total_space() as f64 / 1e9),
                        "avail_gb": (d.available_space() as f64 / 1e9),
                    })
                })
                .collect();
            let data = json!({
                "scenario": "memory_disks",
                "ram_total_mb": sys.total_memory() / 1024 / 1024,
                "ram_used_mb": sys.used_memory() / 1024 / 1024,
                "swap_total_mb": sys.total_swap() / 1024 / 1024,
                "swap_used_mb": sys.used_swap() / 1024 / 1024,
                "disk_mounts": mounts,
            });
            Ok(CheckOutput {
                data: data.clone(),
                stdout: None,
                stderr: None,
                exit_code: 0,
                logs: vec![("info".into(), "memory_disks".into())],
                summary: format!(
                    "RAM {} / {} MiB",
                    sys.used_memory() / 1024 / 1024,
                    sys.total_memory() / 1024 / 1024
                ),
            })
        }
        "cpu_load" => {
            let mut sys = System::new_all();
            sys.refresh_cpu_usage();
            let usage: Vec<Value> = sys
                .cpus()
                .iter()
                .enumerate()
                .map(|(i, c)| json!({ "cpu": i, "usage_percent": c.cpu_usage() as f64 }))
                .collect();
            let global = sys.global_cpu_usage();
            Ok(CheckOutput {
                data: json!({ "scenario": "cpu_load", "global_usage_percent": global, "per_cpu": usage }),
                stdout: Some(format!("CPU load global: {global:.1}%")),
                stderr: None,
                exit_code: 0,
                logs: vec![("info".into(), "cpu_load".into())],
                summary: format!("Загрузка CPU: {global:.1}%"),
            })
        }
        "dns_lookup" => {
            let host = payload
                .get("host")
                .and_then(|v| v.as_str())
                .ok_or_else(|| CheckError::BadPayload("dns_lookup needs host".into()))?;
            let mut resolved: Vec<String> = Vec::new();
            if let Ok(s) = lookup_host((host, 0)).await {
                for sa in s.take(16) {
                    match sa {
                        SocketAddr::V4(a) => resolved.push(a.ip().to_string()),
                        SocketAddr::V6(a) => resolved.push(a.ip().to_string()),
                    }
                }
            }
            Ok(CheckOutput {
                data: json!({ "scenario": "dns_lookup", "query": host, "addresses": resolved }),
                stdout: Some(resolved.join(", ")),
                stderr: None,
                exit_code: 0,
                logs: vec![("info".into(), "dns_lookup".into())],
                summary: format!("DNS {host}: {} адр.", resolved.len()),
            })
        }
        _ => Err(CheckError::UnknownScenario(scenario.into())),
    }
}

async fn network_reachability(payload: &Value) -> Result<CheckOutput, CheckError> {
    let targets = payload
        .get("targets")
        .and_then(|v| v.as_array())
        .ok_or_else(|| CheckError::BadPayload("expected targets[] of host:port strings".into()))?;

    let timeout_secs = payload
        .get("timeout_secs")
        .and_then(|v| v.as_u64())
        .unwrap_or(5)
        .clamp(1, 60);

    let mut out = Vec::new();
    for t in targets {
        let s = t
            .as_str()
            .ok_or_else(|| CheckError::BadPayload("target string".into()))?;
        let started = Instant::now();

        let host_part = s.rsplit_once(':').map(|(h, _)| h).unwrap_or(s);
        let mut dns: Vec<String> = Vec::new();
        if let Ok(mut it) = lookup_host(host_part).await {
            for sa in it.by_ref().take(8) {
                dns.push(sa.to_string());
            }
        }

        let res = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            TcpStream::connect(s),
        )
        .await;

        let (reachable, err, ms) = match res {
            Ok(Ok(_)) => (true, None, Some(started.elapsed().as_secs_f64() * 1000.0)),
            Ok(Err(e)) => (
                false,
                Some(format!("{e}")),
                Some(started.elapsed().as_secs_f64() * 1000.0),
            ),
            Err(_) => (false, Some("timeout".into()), None),
        };

        out.push(json!({
            "target": s,
            "reachable": reachable,
            "connect_time_ms": ms,
            "error": err,
            "dns_sample": dns,
        }));
    }

    let ok = out
        .iter()
        .filter(|r| r.get("reachable").and_then(|v| v.as_bool()) == Some(true))
        .count();

    Ok(CheckOutput {
        data: json!({ "results": out, "timeout_secs": timeout_secs }),
        stdout: None,
        stderr: None,
        exit_code: 0,
        logs: vec![("info".into(), "network_reachability + dns".into())],
        summary: format!("Доступно {ok} из {}", out.len()),
    })
}

async fn check_bundle(payload: &Value) -> Result<CheckOutput, CheckError> {
    let template = payload
        .get("template")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CheckError::BadPayload("template required".into()))?;

    match template {
        "node_baseline" => {
            let sys = system_info()?;
            let mem = diagnostic(&json!({ "scenario": "memory_disks" })).await?;
            let cpu = diagnostic(&json!({ "scenario": "cpu_load" })).await?;
            let uname = diagnostic(&json!({ "scenario": "uname" })).await?;
            let data = json!({
                "template": "node_baseline",
                "description": "Базовая диагностика узла: система, ресурсы, CPU",
                "system_info": sys.data,
                "memory_disks": mem.data,
                "cpu_load": cpu.data,
                "uname": uname.data,
            });
            let summary = format!(
                "Базовая диагностика: {} · RAM {} MiB свободно не считаем здесь",
                sys.summary,
                mem.data
                    .get("ram_used_mb")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0)
            );
            let mut logs = sys.logs;
            logs.extend(mem.logs);
            logs.extend(cpu.logs);
            logs.extend(uname.logs);
            Ok(CheckOutput {
                data,
                stdout: Some(uname.stdout.unwrap_or_default()),
                stderr: None,
                exit_code: 0,
                logs,
                summary,
            })
        }
        "network_context" => {
            let targets: Vec<Value> = vec![
                json!("1.1.1.1:443"),
                json!("8.8.8.8:53"),
                json!("127.0.0.1:8080"),
            ];
            let reach = network_reachability(&json!({ "targets": targets })).await?;
            let dns_cf = diagnostic(&json!({ "scenario": "dns_lookup", "host": "cloudflare.com" }))
                .await
                .ok();
            let mut parts = json!({
                "template": "network_context",
                "description": "Сетевой контекст: DNS + доступность типовых точек",
                "reachability": reach.data,
            });
            if let Some(d) = dns_cf {
                if let Some(obj) = parts.as_object_mut() {
                    obj.insert("dns_cloudflare".into(), d.data);
                }
            }
            Ok(CheckOutput {
                data: parts,
                stdout: reach.stdout,
                stderr: None,
                exit_code: 0,
                logs: reach.logs,
                summary: format!("Сеть: {}", reach.summary),
            })
        }
        "internal_services_check" => {
            let targets = vec![
                json!({ "host": "127.0.0.1", "port": 8080 }),
                json!({ "host": "127.0.0.1", "port": 5432 }),
                json!({ "host": "127.0.0.1", "port": 6379 }),
            ];
            let ports = port_check(&json!({ "targets": targets, "timeout_secs": 3 })).await?;
            let data = json!({
                "template": "internal_services_check",
                "description": "Проверка типичных локальных сервисов (HTTP API, Postgres, Redis)",
                "port_check": ports.data,
            });
            Ok(CheckOutput {
                data,
                stdout: ports.stdout,
                stderr: None,
                exit_code: 0,
                logs: ports.logs,
                summary: ports.summary,
            })
        }
        _ => Err(CheckError::UnknownTemplate(template.into())),
    }
}

/// Максимум байт файла, для которого считаем SHA256 (защита от больших чтений).
const PATH_SNAPSHOT_MAX_HASH_BYTES: u64 = 256 * 1024;

fn system_time_to_unix_ms(st: SystemTime) -> Option<i64> {
    st.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|d| i64::try_from(d.as_millis()).ok())
}

fn path_snapshot(payload: &Value) -> Result<CheckOutput, CheckError> {
    let raw_path = payload
        .get("path")
        .or_else(|| payload.get("destination_path"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| CheckError::BadPayload("path or destination_path required".into()))?;

    let path = PathBuf::from(raw_path);
    let path_display = path.to_string_lossy().to_string();

    if !path.exists() {
        let data = json!({
            "path": path_display,
            "exists": false,
            "kind": "missing",
            "size": Value::Null,
            "modified_unix_ms": Value::Null,
            "sha256": Value::Null,
            "hash_skipped_reason": "path does not exist",
        });
        return Ok(CheckOutput {
            data: data.clone(),
            stdout: Some(format!("path_snapshot: {} (missing)", path_display)),
            stderr: None,
            exit_code: 0,
            logs: vec![(
                "info".into(),
                format!("path_snapshot: {} — нет", path_display),
            )],
            summary: format!("Снимок: {} — объект отсутствует", path_display),
        });
    }

    let meta = fs::metadata(&path).map_err(|e| CheckError::BadPayload(format!("metadata: {e}")))?;
    let modified_unix_ms = meta.modified().ok().and_then(system_time_to_unix_ms);

    let kind = if meta.is_file() {
        "file"
    } else if meta.is_dir() {
        "directory"
    } else {
        "other"
    };

    let size = if meta.is_file() {
        Some(meta.len())
    } else {
        None
    };

    let mut sha256_hex: Option<String> = None;
    let mut hash_skipped_reason: Option<&'static str> = None;

    if meta.is_file() {
        let len = meta.len();
        if len <= PATH_SNAPSHOT_MAX_HASH_BYTES {
            let mut file =
                fs::File::open(&path).map_err(|e| CheckError::BadPayload(format!("open: {e}")))?;
            let mut hasher = Sha256::new();
            let mut buf = [0u8; 8192];
            let mut remaining = len;
            while remaining > 0 {
                let chunk = std::cmp::min(buf.len() as u64, remaining) as usize;
                let n = file
                    .read(&mut buf[..chunk])
                    .map_err(|e| CheckError::BadPayload(format!("read: {e}")))?;
                if n == 0 {
                    break;
                }
                hasher.update(&buf[..n]);
                remaining -= n as u64;
            }
            sha256_hex = Some(format!("{:x}", hasher.finalize()));
        } else {
            hash_skipped_reason = Some("file larger than hash limit");
        }
    } else {
        hash_skipped_reason = Some("not a regular file");
    }

    let data = json!({
        "path": path_display,
        "exists": true,
        "kind": kind,
        "size": size,
        "modified_unix_ms": modified_unix_ms,
        "sha256": sha256_hex,
        "hash_skipped_reason": hash_skipped_reason,
    });

    Ok(CheckOutput {
        data: data.clone(),
        stdout: Some(format!("path_snapshot: {} ({kind})", path_display)),
        stderr: None,
        exit_code: 0,
        logs: vec![(
            "info".into(),
            format!("path_snapshot: {} ({kind})", path_display),
        )],
        summary: format!("Снимок: {} ({kind})", path_display),
    })
}

fn file_upload(payload: &Value) -> Result<CheckOutput, CheckError> {
    let destination_path = payload
        .get("destination_path")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| CheckError::BadPayload("destination_path required".into()))?;
    let content_base64 = payload
        .get("content_base64")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CheckError::BadPayload("content_base64 required".into()))?;
    let overwrite = payload
        .get("overwrite")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let create_parents = payload
        .get("create_parents")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let filename = payload
        .get("filename")
        .and_then(|v| v.as_str())
        .filter(|v| !v.trim().is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            PathBuf::from(destination_path)
                .file_name()
                .and_then(|v| v.to_str())
                .unwrap_or("uploaded.bin")
                .to_string()
        });

    let bytes = BASE64
        .decode(content_base64.as_bytes())
        .map_err(|e| CheckError::BadPayload(format!("content_base64: {e}")))?;

    let path = PathBuf::from(destination_path);
    if path.exists() && !overwrite {
        return Err(CheckError::BadPayload(format!(
            "destination already exists: {}",
            path.display()
        )));
    }

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            if create_parents {
                fs::create_dir_all(parent)
                    .map_err(|e| CheckError::BadPayload(format!("create parent dirs: {e}")))?;
            } else if !parent.exists() {
                return Err(CheckError::BadPayload(format!(
                    "parent directory does not exist: {}",
                    parent.display()
                )));
            }
        }
    }

    fs::write(&path, &bytes).map_err(|e| CheckError::BadPayload(format!("write file: {e}")))?;

    Ok(CheckOutput {
        data: json!({
            "filename": filename,
            "destination_path": path.to_string_lossy(),
            "bytes_written": bytes.len(),
            "overwrite": overwrite,
            "create_parents": create_parents,
        }),
        stdout: Some(format!(
            "written {} bytes to {}",
            bytes.len(),
            path.to_string_lossy()
        )),
        stderr: None,
        exit_code: 0,
        logs: vec![(
            "info".into(),
            format!(
                "file_upload: {} bytes -> {}",
                bytes.len(),
                path.to_string_lossy()
            ),
        )],
        summary: format!("Файл доставлен: {}", path.to_string_lossy()),
    })
}
