//! Сравнение двух снимков system_info по результатам задач.

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

use crate::{
    entity::{task_results, tasks},
    error::ApiError,
    session::resolve_session,
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct DiffQuery {
    pub from_task: Uuid,
    pub to_task: Uuid,
}

fn flatten(prefix: &str, v: &Value, out: &mut BTreeMap<String, String>) {
    match v {
        Value::Object(map) => {
            if map.is_empty() {
                out.insert(prefix.to_string(), "{}".to_string());
                return;
            }
            for (k, ch) in map {
                let p = if prefix.is_empty() {
                    k.clone()
                } else {
                    format!("{prefix}.{k}")
                };
                flatten(&p, ch, out);
            }
        }
        Value::Array(a) => {
            if a.is_empty() {
                out.insert(prefix.to_string(), "[]".to_string());
                return;
            }
            for (i, ch) in a.iter().enumerate() {
                let p = if prefix.is_empty() {
                    format!("[{i}]")
                } else {
                    format!("{prefix}[{i}]")
                };
                flatten(&p, ch, out);
            }
        }
        _ => {
            out.insert(prefix.to_string(), v.to_string());
        }
    }
}

pub async fn machine_diff_between_tasks(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(agent_id): Path<Uuid>,
    Query(q): Query<DiffQuery>,
) -> Result<Json<Value>, ApiError> {
    let _ = resolve_session(&state, &headers).await?;

    if q.from_task == q.to_task {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "from_task and to_task must differ",
        ));
    }

    let ids = vec![q.from_task, q.to_task];
    let rows = tasks::Entity::find()
        .filter(tasks::Column::Id.is_in(ids))
        .all(&state.db)
        .await
        .map_err(|_| {
            ApiError::new(
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "database error",
            )
        })?;

    if rows.len() != 2 {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "expected two existing tasks",
        ));
    }

    for t in &rows {
        if t.agent_id != agent_id {
            return Err(ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "task does not belong to this agent",
            ));
        }
        if t.kind != "system_info" {
            return Err(ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "both tasks must be system_info",
            ));
        }
        if t.status != "done" {
            return Err(ApiError::new(
                axum::http::StatusCode::BAD_REQUEST,
                "both tasks must be completed (done)",
            ));
        }
    }

    let results = task_results::Entity::find()
        .filter(task_results::Column::TaskId.is_in(vec![q.from_task, q.to_task]))
        .all(&state.db)
        .await
        .map_err(|_| {
            ApiError::new(
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "database error",
            )
        })?;

    let d1 = results.iter().find(|r| r.task_id == q.from_task).map(|r| &r.data);
    let d2 = results.iter().find(|r| r.task_id == q.to_task).map(|r| &r.data);

    let (Some(v1), Some(v2)) = (d1, d2) else {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            "missing task_results for one or both tasks",
        ));
    };

    let mut m1 = BTreeMap::new();
    let mut m2 = BTreeMap::new();
    flatten("", v1, &mut m1);
    flatten("", v2, &mut m2);

    let mut changes: Vec<Value> = Vec::new();
    let keys: BTreeSet<String> = m1.keys().chain(m2.keys()).cloned().collect();

    for k in keys {
        let a = m1.get(&k);
        let b = m2.get(&k);
        match (a, b) {
            (Some(x), Some(y)) if x != y => {
                changes.push(json!({
                    "path": k,
                    "before": x,
                    "after": y,
                    "change": "modified",
                }));
            }
            (Some(x), None) => {
                changes.push(json!({
                    "path": k,
                    "before": x,
                    "after": null,
                    "change": "removed",
                }));
            }
            (None, Some(y)) => {
                changes.push(json!({
                    "path": k,
                    "before": null,
                    "after": y,
                    "change": "added",
                }));
            }
            _ => {}
        }
    }

    Ok(Json(json!({
        "agent_id": agent_id,
        "from_task": q.from_task,
        "to_task": q.to_task,
        "changes": changes,
        "changed_count": changes.len(),
    })))
}
