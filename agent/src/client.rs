use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::checks;

#[derive(Debug, Deserialize)]
pub struct RegisterResponse {
    pub agent_id: Uuid,
    pub token: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TaskDto {
    pub id: Uuid,
    pub agent_id: Uuid,
    pub kind: String,
    pub payload: Value,
    pub status: String,
}

pub async fn register(server: &str, name: &str) -> anyhow::Result<RegisterResponse> {
    let base = server.trim_end_matches('/');
    let url = format!("{}/api/v1/agent/register", base);
    let client = reqwest::Client::new();
    let res = client
        .post(&url)
        .json(&json!({ "name": name }))
        .send()
        .await?
        .error_for_status()?;
    Ok(res.json().await?)
}

pub async fn run_loop(server: &str, token: &str, heartbeat_secs: u64) -> anyhow::Result<()> {
    let base = server.trim_end_matches('/');
    let client = reqwest::Client::new();

    let mut poll_iv = tokio::time::interval(std::time::Duration::from_secs(2));
    poll_iv.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut hb_iv = tokio::time::interval(std::time::Duration::from_secs(heartbeat_secs.max(5)));
    hb_iv.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    poll_iv.tick().await;
    hb_iv.tick().await;

    loop {
        tokio::select! {
            _ = poll_iv.tick() => {
                match poll_task(&client, base, token).await {
                    Ok(Some(task)) => {
                        tracing::info!(task_id = %task.id, kind = %task.kind, "running task");
                        match checks::run(&task.kind, &task.payload).await {
                            Ok(out) => {
                                let logs: Vec<serde_json::Value> = out
                                    .logs
                                    .into_iter()
                                    .map(|(level, message)| json!({ "level": level, "message": message }))
                                    .collect();
                                let url = format!("{}/api/v1/agent/tasks/{}/complete", base, task.id);
                                let body = json!({
                                    "stdout": out.stdout,
                                    "stderr": out.stderr,
                                    "exit_code": out.exit_code,
                                    "data": out.data,
                                    "logs": logs,
                                    "summary": out.summary,
                                });
                                let resp = client
                                    .post(&url)
                                    .header("Authorization", format!("Bearer {}", token))
                                    .json(&body)
                                    .send()
                                    .await;
                                if let Err(e) = resp {
                                    tracing::error!(error = %e, "complete failed");
                                }
                            }
                            Err(e) => {
                                tracing::warn!(error = %e, "check failed");
                                let url = format!("{}/api/v1/agent/tasks/{}/fail", base, task.id);
                                let _ = client
                                    .post(&url)
                                    .header("Authorization", format!("Bearer {}", token))
                                    .json(&json!({ "message": e.to_string() }))
                                    .send()
                                    .await;
                            }
                        }
                    }
                    Ok(None) => {}
                    Err(e) => tracing::warn!(error = %e, "poll failed"),
                }
            }
            _ = hb_iv.tick() => {
                let url = format!("{}/api/v1/agent/heartbeat", base);
                if let Err(e) = client
                    .post(&url)
                    .header("Authorization", format!("Bearer {}", token))
                    .send()
                    .await
                {
                    tracing::warn!(error = %e, "heartbeat failed");
                }
            }
        }
    }
}

async fn poll_task(
    client: &reqwest::Client,
    base: &str,
    token: &str,
) -> anyhow::Result<Option<TaskDto>> {
    let url = format!("{}/api/v1/agent/tasks/next", base);
    let res = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await?;

    if res.status() == reqwest::StatusCode::OK {
        let text = res.text().await?;
        if text.trim().is_empty() || text == "null" {
            return Ok(None);
        }
        let v: Option<TaskDto> = serde_json::from_str(&text)?;
        return Ok(v);
    }

    res.error_for_status()?;
    Ok(None)
}
