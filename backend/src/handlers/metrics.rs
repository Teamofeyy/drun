use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{Duration, Utc};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde_json::json;
use std::collections::BTreeMap;

use crate::{
    entity::{agents, tasks},
    error::ApiError,
    session::resolve_session,
    state::AppState,
};

pub async fn metrics_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let _ = resolve_session(&state, &headers).await?;

    let window_start = Utc::now() - Duration::hours(24);

    let recent_tasks = tasks::Entity::find()
        .filter(tasks::Column::CreatedAt.gt(window_start))
        .all(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let mut tasks_by_status: BTreeMap<String, i64> = BTreeMap::new();
    for t in &recent_tasks {
        *tasks_by_status.entry(t.status.clone()).or_insert(0) += 1;
    }

    let done_for_avg = tasks::Entity::find()
        .filter(tasks::Column::Status.eq("done"))
        .all(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let mut durations: Vec<f64> = Vec::new();
    for t in done_for_avg {
        let (Some(s), Some(c)) = (t.started_at, t.completed_at) else {
            continue;
        };
        if c > window_start {
            durations.push((c - s).num_milliseconds() as f64 / 1000.0);
        }
    }
    let avg_sec = if durations.is_empty() {
        None
    } else {
        Some(durations.iter().sum::<f64>() / durations.len() as f64)
    };

    let agent_rows = agents::Entity::find()
        .all(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let total_agents = agent_rows.len() as i64;
    let online = agent_rows.iter().filter(|a| a.status == "online").count() as i64;

    let mut task_map = serde_json::Map::new();
    for (k, v) in tasks_by_status {
        task_map.insert(k, json!(v));
    }

    Ok(Json(json!({
        "window_hours": 24,
        "tasks_by_status": task_map,
        "avg_duration_seconds_done": avg_sec,
        "agents_total": total_agents,
        "agents_online": online,
    })))
}
