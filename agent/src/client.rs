use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::time::MissedTickBehavior;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream};
use url::Url;

use crate::checks;

#[derive(Debug, Deserialize)]
pub struct RegisterResponse {
    pub agent_id: uuid::Uuid,
    pub token: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct TaskDto {
    pub id: uuid::Uuid,
    pub agent_id: uuid::Uuid,
    pub kind: String,
    pub payload: Value,
    pub status: String,
}

pub async fn register(
    server: &str,
    name: &str,
    enrollment_secret: &str,
) -> anyhow::Result<RegisterResponse> {
    let base = server.trim_end_matches('/');
    let url = format!("{}/api/v1/agent/register", base);
    let client = reqwest::Client::new();
    let res = client
        .post(&url)
        .header("X-Infrahub-Enrollment", enrollment_secret)
        .json(&json!({ "name": name }))
        .send()
        .await?
        .error_for_status()?;
    Ok(res.json().await?)
}

fn agent_ws_url(server: &str, token: &str) -> anyhow::Result<String> {
    let base = server.trim_end_matches('/');
    let mut u = Url::parse(base)?;
    match u.scheme() {
        "https" => {
            u.set_scheme("wss")
                .map_err(|_| anyhow::anyhow!("could not set wss scheme"))?;
        }
        "http" => {
            u.set_scheme("ws")
                .map_err(|_| anyhow::anyhow!("could not set ws scheme"))?;
        }
        s => anyhow::bail!("unsupported URL scheme: {s}"),
    }
    u.set_path("/api/v1/agent/ws");
    u.query_pairs_mut().clear();
    u.query_pairs_mut().append_pair("token", token);
    Ok(u.to_string())
}

type WsStream = tokio_tungstenite::WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

pub async fn run_loop(
    server: &str,
    token: &str,
    heartbeat_secs: u64,
    poll_fallback_secs: u64,
) -> anyhow::Result<()> {
    let base = server.trim_end_matches('/').to_string();
    let client = reqwest::Client::new();
    let heartbeat = Duration::from_secs(heartbeat_secs.max(5));
    let poll_fallback = (poll_fallback_secs > 0).then(|| Duration::from_secs(poll_fallback_secs));

    loop {
        let ws_url = match agent_ws_url(&base, token) {
            Ok(u) => u,
            Err(e) => {
                tracing::error!(error = %e, "invalid server URL for WebSocket");
                tokio::time::sleep(Duration::from_secs(10)).await;
                continue;
            }
        };

        match run_ws_session(&client, &base, token, &ws_url, heartbeat, poll_fallback).await {
            Ok(()) => tracing::info!("websocket closed, reconnecting"),
            Err(e) => tracing::warn!(error = %e, "websocket session error"),
        }
        tokio::time::sleep(Duration::from_secs(4)).await;
    }
}

async fn run_ws_session(
    client: &reqwest::Client,
    base: &str,
    token: &str,
    ws_url: &str,
    heartbeat: Duration,
    poll_fallback: Option<Duration>,
) -> anyhow::Result<()> {
    let (ws, _) = connect_async(ws_url).await?;
    let (mut write, mut read) = ws.split();

    let mut hb_iv = tokio::time::interval(heartbeat);
    hb_iv.set_missed_tick_behavior(MissedTickBehavior::Delay);
    hb_iv.tick().await;

    if let Some(pd) = poll_fallback {
        let mut poll_iv = tokio::time::interval(pd);
        poll_iv.set_missed_tick_behavior(MissedTickBehavior::Delay);
        poll_iv.tick().await;
        loop {
            tokio::select! {
                _ = hb_iv.tick() => {
                    let msg = Message::Text(r#"{"kind":"heartbeat"}"#.into());
                    if write.send(msg).await.is_err() {
                        anyhow::bail!("websocket send failed (heartbeat)");
                    }
                }
                _ = poll_iv.tick() => {
                    match poll_task(client, base, token).await {
                        Ok(Some(task)) => run_one_task(client, base, token, task).await,
                        Ok(None) => {}
                        Err(e) => tracing::warn!(error = %e, "poll fallback failed"),
                    }
                }
                msg = read.next() => {
                    if ws_recv_done(msg, &mut write, client, base, token).await? {
                        return Ok(());
                    }
                }
            }
        }
    } else {
        loop {
            tokio::select! {
                _ = hb_iv.tick() => {
                    let msg = Message::Text(r#"{"kind":"heartbeat"}"#.into());
                    if write.send(msg).await.is_err() {
                        anyhow::bail!("websocket send failed (heartbeat)");
                    }
                }
                msg = read.next() => {
                    if ws_recv_done(msg, &mut write, client, base, token).await? {
                        return Ok(());
                    }
                }
            }
        }
    }
}

/// Returns `true` if the WebSocket session should end (close or EOF).
async fn ws_recv_done(
    msg: Option<Result<Message, tokio_tungstenite::tungstenite::Error>>,
    write: &mut futures_util::stream::SplitSink<WsStream, Message>,
    client: &reqwest::Client,
    base: &str,
    token: &str,
) -> anyhow::Result<bool> {
    match msg {
        Some(Ok(Message::Text(t))) => {
            if let Err(e) = handle_server_text(write, client, base, token, t.as_str()).await {
                tracing::warn!(error = %e, "ws message handling");
            }
            Ok(false)
        }
        Some(Ok(Message::Ping(p))) => {
            let _ = write.send(Message::Pong(p)).await;
            Ok(false)
        }
        Some(Ok(Message::Pong(_))) => Ok(false),
        Some(Ok(Message::Binary(_))) => Ok(false),
        Some(Ok(Message::Frame(_))) => Ok(false),
        Some(Ok(Message::Close(_))) | None => Ok(true),
        Some(Err(e)) => Err(e.into()),
    }
}

async fn handle_server_text(
    write: &mut futures_util::stream::SplitSink<WsStream, Message>,
    client: &reqwest::Client,
    base: &str,
    token: &str,
    text: &str,
) -> anyhow::Result<()> {
    let v: Value = serde_json::from_str(text)?;
    let kind = v
        .get("kind")
        .and_then(|x| x.as_str())
        .unwrap_or("");
    if kind != "task" {
        return Ok(());
    }
    let task_val = v
        .get("task")
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("missing task field"))?;
    let task: TaskDto = serde_json::from_value(task_val)?;

    let ack = json!({ "kind": "received", "task_id": task.id });
    write
        .send(Message::Text(ack.to_string().into()))
        .await
        .map_err(|e| anyhow::anyhow!(e))?;

    let c = client.clone();
    let b = base.to_string();
    let t = token.to_string();
    let task = task.clone();
    tokio::spawn(async move {
        run_one_task(&c, &b, &t, task).await;
    });

    Ok(())
}

async fn run_one_task(client: &reqwest::Client, base: &str, token: &str, task: TaskDto) {
    tracing::info!(task_id = %task.id, kind = %task.kind, "running task");
    match checks::run(&task.kind, &task.payload).await {
        Ok(out) => {
            let logs: Vec<Value> = out
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
