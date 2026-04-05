use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::entity;

#[derive(Debug, Clone, Serialize)]
pub struct AgentRow {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub status: String,
    pub site: String,
    pub segment: String,
    pub role_tag: String,
}

impl From<entity::agents::Model> for AgentRow {
    fn from(m: entity::agents::Model) -> Self {
        Self {
            id: m.id,
            name: m.name,
            created_at: m.created_at,
            last_seen_at: m.last_seen_at,
            status: m.status,
            site: m.site,
            segment: m.segment,
            role_tag: m.role_tag,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct AgentPublic {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub status: String,
    pub site: String,
    pub segment: String,
    pub role_tag: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskRow {
    pub id: Uuid,
    pub agent_id: Uuid,
    pub kind: String,
    pub payload: serde_json::Value,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub error_message: Option<String>,
    pub retries_used: i32,
    pub max_retries: i32,
}

impl From<entity::tasks::Model> for TaskRow {
    fn from(m: entity::tasks::Model) -> Self {
        Self {
            id: m.id,
            agent_id: m.agent_id,
            kind: m.kind,
            payload: m.payload,
            status: m.status,
            created_at: m.created_at,
            started_at: m.started_at,
            completed_at: m.completed_at,
            error_message: m.error_message,
            retries_used: m.retries_used,
            max_retries: m.max_retries,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct TaskResultRow {
    pub id: Uuid,
    pub task_id: Uuid,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub exit_code: Option<i32>,
    pub data: serde_json::Value,
    pub summary: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl From<entity::task_results::Model> for TaskResultRow {
    fn from(m: entity::task_results::Model) -> Self {
        Self {
            id: m.id,
            task_id: m.task_id,
            stdout: m.stdout,
            stderr: m.stderr,
            exit_code: m.exit_code,
            data: m.data,
            summary: m.summary,
            created_at: m.created_at,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct TaskLogRow {
    pub id: i64,
    pub task_id: Uuid,
    pub ts: DateTime<Utc>,
    pub level: String,
    pub message: String,
}

impl From<entity::task_logs::Model> for TaskLogRow {
    fn from(m: entity::task_logs::Model) -> Self {
        Self {
            id: m.id,
            task_id: m.task_id,
            ts: m.ts,
            level: m.level,
            message: m.message,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    pub token: String,
    pub token_type: &'static str,
    pub expires_in: u64,
    pub role: String,
}

#[derive(Debug, Deserialize)]
pub struct RegisterAgentRequest {
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct RegisterAgentResponse {
    pub agent_id: Uuid,
    pub token: String,
    pub message: &'static str,
}

fn default_max_retries() -> i32 {
    2
}

#[derive(Debug, Deserialize)]
pub struct CreateTaskRequest {
    pub agent_id: Uuid,
    pub kind: String,
    #[serde(default)]
    pub payload: serde_json::Value,
    #[serde(default = "default_max_retries")]
    pub max_retries: i32,
}

#[derive(Debug, Deserialize)]
pub struct CompleteTaskRequest {
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub data: serde_json::Value,
    #[serde(default)]
    pub logs: Vec<LogLine>,
    #[serde(default)]
    pub summary: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct LogLine {
    pub level: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct PatchAgentRequest {
    #[serde(default)]
    pub site: Option<String>,
    #[serde(default)]
    pub segment: Option<String>,
    #[serde(default)]
    pub role_tag: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MeResponse {
    pub id: Uuid,
    pub username: String,
    pub role: String,
}

#[derive(Debug, Deserialize)]
pub struct AdminWipeBody {
    /// Должно быть ровно `DELETE_ALL_TASK_HISTORY`
    pub confirm: String,
}
