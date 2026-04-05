use std::convert::Infallible;
use std::time::Duration;

use async_stream::stream;
use axum::{
    extract::{Query, State},
    response::sse::{Event, KeepAlive, Sse},
};
use chrono::Utc;
use sea_orm::{EntityTrait, QueryOrder, QuerySelect};
use serde::Deserialize;
use serde_json::json;

use crate::{
    auth::parse_jwt,
    entity::{agents, tasks},
    error::ApiError,
    state::AppState,
};

#[derive(Deserialize)]
pub struct SseTokenQuery {
    pub token: String,
}

pub async fn sse_dashboard(
    Query(q): Query<SseTokenQuery>,
    State(state): State<AppState>,
) -> Result<Sse<impl futures::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let _claims = parse_jwt(&q.token, &state.config.jwt_secret)?;
    let db = state.db.clone();

    let s = stream! {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let payload = snapshot_payload(&db).await;
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

async fn snapshot_payload(db: &sea_orm::DatabaseConnection) -> serde_json::Value {
    crate::handlers::mark_stale_agents_db(db).await;

    let agents = match agents::Entity::find()
        .order_by_desc(agents::Column::CreatedAt)
        .limit(100)
        .all(db)
        .await
    {
        Ok(v) => v,
        Err(_) => return json!({ "error": "db", "ts": Utc::now() }),
    };

    let tasks = match tasks::Entity::find()
        .order_by_desc(tasks::Column::CreatedAt)
        .limit(80)
        .all(db)
        .await
    {
        Ok(v) => v,
        Err(_) => {
            return json!({
                "ts": Utc::now(),
                "agents": agents.iter().map(|a| json!({
                    "id": a.id, "name": a.name, "status": a.status, "last_seen_at": a.last_seen_at
                })).collect::<Vec<_>>(),
                "tasks": [],
            })
        }
    };

    json!({
        "ts": Utc::now(),
        "agents": agents.iter().map(|a| json!({
            "id": a.id, "name": a.name, "status": a.status, "last_seen_at": a.last_seen_at
        })).collect::<Vec<_>>(),
        "tasks": tasks.iter().map(|t| json!({
            "id": t.id, "kind": t.kind, "status": t.status, "agent_id": t.agent_id, "created_at": t.created_at
        })).collect::<Vec<_>>(),
    })
}
