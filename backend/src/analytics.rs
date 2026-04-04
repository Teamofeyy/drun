//! Агрегированная аналитика по задачам и агентам.

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    Json,
};
use chrono::{Duration, Utc};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::cmp::Ordering;

use crate::{
    entity::{agents, tasks},
    error::ApiError,
    session::resolve_session,
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct DaysQuery {
    #[serde(default = "default_days")]
    pub days: i32,
}

fn default_days() -> i32 {
    7
}

#[derive(Default)]
struct DailyAgg {
    runs: i64,
    errors: i64,
    durations: Vec<f64>,
}

/// Сводка по календарным дням (UTC): запуски, ошибки, среднее время done-задач.
pub async fn daily_metrics(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<DaysQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let _ = resolve_session(&state, &headers).await?;
    let days = q.days.clamp(1, 90) as i64;

    let cutoff = Utc::now() - Duration::days(days);
    let task_rows = tasks::Entity::find()
        .filter(tasks::Column::CreatedAt.gte(cutoff))
        .all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(%e, "daily_metrics");
            ApiError::new(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "database error")
        })?;

    let agent_names: HashMap<uuid::Uuid, String> = agents::Entity::find()
        .all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(%e, "daily_metrics agents");
            ApiError::new(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "database error")
        })?
        .into_iter()
        .map(|a| (a.id, a.name))
        .collect();

    let mut groups: HashMap<(String, uuid::Uuid), DailyAgg> = HashMap::new();
    for t in task_rows {
        let day = t.created_at.format("%Y-%m-%d").to_string();
        let key = (day, t.agent_id);
        let g = groups.entry(key).or_default();
        g.runs += 1;
        if t.status == "failed" {
            g.errors += 1;
        }
        if t.status == "done" {
            if let (Some(s), Some(c)) = (t.started_at, t.completed_at) {
                g.durations
                    .push((c - s).num_milliseconds() as f64 / 1000.0);
            }
        }
    }

    let mut series: Vec<serde_json::Value> = groups
        .into_iter()
        .map(|((day, agent_id), g)| {
            let agent_name = agent_names
                .get(&agent_id)
                .cloned()
                .unwrap_or_else(|| "(unknown)".to_string());
            let avg_duration_sec = if g.durations.is_empty() {
                None
            } else {
                Some(g.durations.iter().sum::<f64>() / g.durations.len() as f64)
            };
            json!({
                "day": day,
                "agent_id": agent_id,
                "agent_name": agent_name,
                "runs": g.runs,
                "errors": g.errors,
                "avg_duration_seconds": avg_duration_sec,
            })
        })
        .collect();

    series.sort_by(|a, b| {
        let da = a.get("day").and_then(|x| x.as_str()).unwrap_or("");
        let db = b.get("day").and_then(|x| x.as_str()).unwrap_or("");
        let na = a.get("agent_name").and_then(|x| x.as_str()).unwrap_or("");
        let nb = b.get("agent_name").and_then(|x| x.as_str()).unwrap_or("");
        match db.cmp(da) {
            Ordering::Equal => na.cmp(nb),
            o => o,
        }
    });

    Ok(Json(json!({ "days_window": days, "series": series })))
}

#[derive(Default)]
struct RankAgg {
    finished: i64,
    failed: i64,
    durations: Vec<f64>,
}

/// Рейтинг агентов: стабильность (доля успехов) и скорость (обратная к среднему времени).
pub async fn agent_ranking(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<DaysQuery>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let _ = resolve_session(&state, &headers).await?;
    let days = q.days.clamp(1, 90) as i64;

    let cutoff = Utc::now() - Duration::days(days);
    let task_rows = tasks::Entity::find()
        .filter(tasks::Column::CreatedAt.gte(cutoff))
        .all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(%e, "agent_ranking");
            ApiError::new(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "database error")
        })?;

    let agent_names: HashMap<uuid::Uuid, String> = agents::Entity::find()
        .all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(%e, "agent_ranking agents");
            ApiError::new(axum::http::StatusCode::INTERNAL_SERVER_ERROR, "database error")
        })?
        .into_iter()
        .map(|a| (a.id, a.name))
        .collect();

    let mut per_agent: HashMap<uuid::Uuid, RankAgg> = HashMap::new();
    for t in task_rows {
        if t.status != "done" && t.status != "failed" {
            continue;
        }
        let g = per_agent.entry(t.agent_id).or_default();
        g.finished += 1;
        if t.status == "failed" {
            g.failed += 1;
        }
        if t.status == "done" {
            if let (Some(s), Some(c)) = (t.started_at, t.completed_at) {
                g.durations
                    .push((c - s).num_milliseconds() as f64 / 1000.0);
            }
        }
    }

    let mut ranked: Vec<serde_json::Value> = per_agent
        .into_iter()
        .map(|(agent_id, g)| {
            let name = agent_names
                .get(&agent_id)
                .cloned()
                .unwrap_or_else(|| "(unknown)".to_string());
            let avg_sec = if g.durations.is_empty() {
                None
            } else {
                Some(g.durations.iter().sum::<f64>() / g.durations.len() as f64)
            };
            let finished_f = g.finished.max(1) as f64;
            let success_rate = (g.finished - g.failed) as f64 / finished_f;
            let avg = avg_sec.unwrap_or(60.0).max(0.1);
            let speed_score = 1.0 / (1.0 + avg / 10.0);
            let stability_score = success_rate;
            let combined = 0.65 * stability_score + 0.35 * speed_score;
            json!({
                "agent_id": agent_id,
                "name": name,
                "finished_tasks": g.finished,
                "failed_tasks": g.failed,
                "success_rate": success_rate,
                "avg_duration_seconds": avg_sec,
                "stability_score": stability_score,
                "speed_score": speed_score,
                "combined_score": combined,
            })
        })
        .collect();

    ranked.sort_by(|a, b| {
        let ca = a.get("combined_score").and_then(|x| x.as_f64()).unwrap_or(0.0);
        let cb = b.get("combined_score").and_then(|x| x.as_f64()).unwrap_or(0.0);
        cb.partial_cmp(&ca).unwrap_or(Ordering::Equal)
    });

    Ok(Json(json!({ "days_window": days, "ranking": ranked })))
}

/// Группировка агентов по площадке, сегменту и тегу роли.
pub async fn agent_groups(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let _ = resolve_session(&state, &headers).await?;

    let bucket_site = |label: String, n: i64| -> (String, i64) {
        let s = label.trim();
        if s.is_empty() {
            ("(площадка не задана)".to_string(), n)
        } else {
            (s.to_string(), n)
        }
    };

    let rows = agents::Entity::find()
        .all(&state.db)
        .await
        .map_err(|_| {
            ApiError::new(
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "database error",
            )
        })?;

    let mut by_site: HashMap<String, i64> = HashMap::new();
    let mut by_segment: HashMap<String, i64> = HashMap::new();
    let mut by_role_tag: HashMap<String, i64> = HashMap::new();

    for a in rows {
        *by_site.entry(a.site).or_insert(0) += 1;
        *by_segment.entry(a.segment).or_insert(0) += 1;
        *by_role_tag.entry(a.role_tag).or_insert(0) += 1;
    }

    let map_json = |m: HashMap<String, i64>| -> serde_json::Map<String, serde_json::Value> {
        m.into_iter()
            .map(|(k, v)| {
                let (k2, v2) = bucket_site(k, v);
                (k2, json!(v2))
            })
            .collect()
    };

    let by_site = map_json(by_site);
    let by_segment = map_json(by_segment);
    let by_role_tag = map_json(by_role_tag);

    Ok(Json(json!({
        "by_site": by_site,
        "by_segment": by_segment,
        "by_role_tag": by_role_tag,
    })))
}
