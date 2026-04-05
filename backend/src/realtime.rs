//! Dashboard fan-out (`broadcast` → SSE) and per-agent WebSocket delivery.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::IntoResponse;
use futures::stream::StreamExt;
use serde::Deserialize;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::error::ApiError;
use crate::handlers::{record_agent_presence, try_push_next_task_ws};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct AgentWsTokenQuery {
    pub token: String,
}

pub async fn agent_ws_upgrade(
    ws: WebSocketUpgrade,
    Query(q): Query<AgentWsTokenQuery>,
    State(state): State<AppState>,
) -> Result<impl IntoResponse, ApiError> {
    let agent_id = crate::handlers::resolve_agent(&state, &q.token).await?;
    Ok(ws.on_upgrade(move |socket| agent_ws_loop(socket, state, agent_id)))
}

async fn agent_ws_loop(socket: WebSocket, state: AppState, agent_id: Uuid) {
    if record_agent_presence(&state, agent_id).await.is_err() {
        return;
    }
    state.notify_dashboard();

    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Message>();
    state.agent_ws.register(agent_id, out_tx).await;

    let mut socket = socket;
    if let Err(e) = try_push_next_task_ws(&state, agent_id).await {
        tracing::warn!(%agent_id, error = %e, "initial ws task push");
    }

    loop {
        tokio::select! {
            biased;
            Some(msg) = out_rx.recv() => {
                if socket.send(msg).await.is_err() {
                    break;
                }
            }
            next = socket.next() => {
                match next {
                    Some(Ok(Message::Text(t))) => {
                        if handle_agent_ws_text(&state, agent_id, &t).await {
                            continue;
                        }
                    }
                    Some(Ok(Message::Ping(p))) => {
                        let _ = socket.send(Message::Pong(p)).await;
                        continue;
                    }
                    Some(Ok(Message::Pong(_))) => continue,
                    Some(Ok(Message::Binary(_))) => {}
                    Some(Err(_)) | Some(Ok(Message::Close(_))) | None => break,
                }
            }
        }
    }

    state.agent_ws.unregister(agent_id).await;
    state.notify_dashboard();
}

async fn handle_agent_ws_text(state: &AppState, agent_id: Uuid, t: &str) -> bool {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(t) else {
        return true;
    };
    let kind = v.get("kind").and_then(|x| x.as_str()).unwrap_or("");
    match kind {
        "heartbeat" => {
            // Presence обновляется в БД; UI подтягивает last_seen через SSE reconcile (~45s)
            // и явные notify при задачах/регистрации/WS connect — без fan-out на каждый ping.
            let _ = record_agent_presence(state, agent_id).await;
        }
        "received" => {
            tracing::debug!(%agent_id, body = %t, "task ack");
        }
        _ => {}
    }
    true
}
