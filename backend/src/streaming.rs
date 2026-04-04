use std::convert::Infallible;
use std::time::Duration;

use async_stream::stream;
use axum::{
    extract::{Query, State},
    response::sse::{Event, KeepAlive, Sse},
};
use serde::Deserialize;
use chrono::{DateTime, Utc};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{auth::parse_jwt, error::ApiError, state::AppState};

#[derive(Deserialize)]
pub struct SseTokenQuery {
    pub token: String,
}

pub async fn sse_dashboard(
    Query(q): Query<SseTokenQuery>,
    State(state): State<AppState>,
) -> Result<Sse<impl futures::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let _claims = parse_jwt(&q.token, &state.config.jwt_secret)?;
    let pool = state.pool.clone();

    let s = stream! {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let payload = snapshot_payload(&pool).await;
            let data = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".into());
            yield Ok(Event::default().data(data));
        }
    };

    Ok(Sse::new(s).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keepalive"),
    ))
}

async fn snapshot_payload(pool: &PgPool) -> serde_json::Value {
    let _ = sqlx::query(
        "UPDATE agents SET status = 'offline' WHERE status = 'online' \
         AND (last_seen_at IS NULL OR last_seen_at < now() - interval '90 seconds')",
    )
    .execute(pool)
    .await;

    type AgentRow = (Uuid, String, String, Option<DateTime<Utc>>);
    let agents: Vec<AgentRow> = match sqlx::query_as(
        "SELECT id, name, status, last_seen_at FROM agents ORDER BY created_at DESC LIMIT 100",
    )
    .fetch_all(pool)
    .await
    {
        Ok(v) => v,
        Err(_) => return json!({ "error": "db", "ts": Utc::now() }),
    };

    type TaskRow = (Uuid, String, String, Uuid, DateTime<Utc>);
    let tasks: Vec<TaskRow> = match sqlx::query_as(
        "SELECT id, kind, status, agent_id, created_at FROM tasks ORDER BY created_at DESC LIMIT 80",
    )
    .fetch_all(pool)
    .await
    {
        Ok(v) => v,
        Err(_) => {
            return json!({
                "ts": Utc::now(),
                "agents": agents.iter().map(|(id, n, s, l)| json!({
                    "id": id, "name": n, "status": s, "last_seen_at": l
                })).collect::<Vec<_>>(),
                "tasks": [],
            })
        }
    };

    json!({
        "ts": Utc::now(),
        "agents": agents.iter().map(|(id, n, s, l)| json!({
            "id": id, "name": n, "status": s, "last_seen_at": l
        })).collect::<Vec<_>>(),
        "tasks": tasks.iter().map(|(id, k, st, aid, c)| json!({
            "id": id, "kind": k, "status": st, "agent_id": aid, "created_at": c
        })).collect::<Vec<_>>(),
    })
}
