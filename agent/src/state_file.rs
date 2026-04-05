use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentState {
    pub server: String,
    pub agent_id: Uuid,
    pub token: String,
    pub name: String,
}

pub fn normalize_server(s: &str) -> String {
    s.trim_end_matches('/').to_string()
}

pub fn default_data_dir() -> Option<PathBuf> {
    dirs::data_local_dir().map(|p| p.join("infrahub"))
}

pub fn state_path(data_dir: Option<&Path>) -> PathBuf {
    data_dir
        .map(Path::to_path_buf)
        .or_else(default_data_dir)
        .unwrap_or_else(|| PathBuf::from(".infrahub"))
        .join("agent.json")
}

pub fn load(path: &Path) -> anyhow::Result<Option<AgentState>> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path)?;
    let s: AgentState = serde_json::from_str(&raw)?;
    Ok(Some(s))
}

pub fn save(path: &Path, state: &AgentState) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = serde_json::to_string_pretty(state)?;
    fs::write(path, raw)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(path)?.permissions();
        perms.set_mode(0o600);
        fs::set_permissions(path, perms)?;
    }
    Ok(())
}
