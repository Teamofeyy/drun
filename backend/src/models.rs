use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AgentRow {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct AgentPublic {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub last_seen_at: Option<DateTime<Utc>>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct TaskRow {
    pub id: Uuid,
    pub agent_id: Uuid,
    pub kind: String,
    #[sqlx(json)]
    pub payload: serde_json::Value,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub error_message: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct TaskResultRow {
    pub id: Uuid,
    pub task_id: Uuid,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub exit_code: Option<i32>,
    #[sqlx(json)]
    pub data: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct TaskLogRow {
    pub id: i64,
    pub task_id: Uuid,
    pub ts: DateTime<Utc>,
    pub level: String,
    pub message: String,
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

#[derive(Debug, Deserialize)]
pub struct CreateTaskRequest {
    pub agent_id: Uuid,
    pub kind: String,
    #[serde(default)]
    pub payload: serde_json::Value,
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
}

#[derive(Debug, Deserialize, Serialize)]
pub struct LogLine {
    pub level: String,
    pub message: String,
}
