use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Set,
};
use serde_json::json;
use uuid::Uuid;

use crate::{
    entity::{agents, tasks},
    error::ApiError,
    models::CreateTaskRequest,
    models::RunScriptRequest,
    models::TaskRow,
    queue,
    roles::UserRole,
    session::resolve_session,
    state::AppState,
};

const ALLOWED_TASK_KINDS: &[&str] = &[
    "system_info",
    "port_check",
    "diagnostic",
    "network_reachability",
    "check_bundle",
    "scenario_run",
    "file_upload",
    "shell_script",
];

/// Максимальный размер тела скрипта в задаче `shell_script` (байты UTF-8).
const MAX_SHELL_SCRIPT_BYTES: usize = 256 * 1024;
const DEFAULT_SHELL_TIMEOUT_SECS: u64 = 300;
const MAX_SHELL_TIMEOUT_SECS: u64 = 3600;

pub async fn create_task(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateTaskRequest>,
) -> Result<Json<TaskRow>, ApiError> {
    let (_, role) = resolve_session(&state, &headers).await?;
    role.require(UserRole::Operator)?;

    if !ALLOWED_TASK_KINDS.contains(&body.kind.as_str()) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "unsupported task kind",
        ));
    }

    let exists = agents::Entity::find_by_id(body.agent_id)
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .is_some();

    if !exists {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "unknown agent"));
    }

    let max_retries = body.max_retries.clamp(0, 10);

    let id = Uuid::new_v4();
    tasks::ActiveModel {
        id: Set(id),
        agent_id: Set(body.agent_id),
        kind: Set(body.kind),
        payload: Set(body.payload),
        status: Set("pending".to_string()),
        max_retries: Set(max_retries),
        ..Default::default()
    }
    .insert(&state.db)
    .await
    .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let mut redis = state.redis.clone();
    queue::enqueue(&mut redis, body.agent_id, id)
        .await
        .map_err(|e| {
            tracing::error!(%e, "redis enqueue");
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "queue error")
        })?;

    let task = tasks::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "task row missing"))?;

    state.notify_dashboard();
    if let Err(e) = super::try_push_next_task_ws(&state, body.agent_id).await {
        tracing::warn!(error = %e, "ws push after create_task");
    }

    Ok(Json(task.into()))
}

pub async fn run_script_task(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RunScriptRequest>,
) -> Result<Json<TaskRow>, ApiError> {
    let (_, role) = resolve_session(&state, &headers).await?;
    role.require(UserRole::Operator)?;

    let script = body.script.trim().to_string();
    if script.is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "script must not be empty",
        ));
    }
    if script.len() > MAX_SHELL_SCRIPT_BYTES {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "script exceeds maximum size",
        ));
    }

    let timeout_secs = body
        .timeout_secs
        .unwrap_or(DEFAULT_SHELL_TIMEOUT_SECS)
        .clamp(1, MAX_SHELL_TIMEOUT_SECS);

    let exists = agents::Entity::find_by_id(body.agent_id)
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .is_some();

    if !exists {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "unknown agent"));
    }

    let id = Uuid::new_v4();
    let payload = json!({
        "script": script,
        "timeout_secs": timeout_secs,
    });

    tasks::ActiveModel {
        id: Set(id),
        agent_id: Set(body.agent_id),
        kind: Set("shell_script".to_string()),
        payload: Set(payload),
        status: Set("pending".to_string()),
        max_retries: Set(0),
        ..Default::default()
    }
    .insert(&state.db)
    .await
    .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let mut redis = state.redis.clone();
    queue::enqueue(&mut redis, body.agent_id, id)
        .await
        .map_err(|e| {
            tracing::error!(%e, "redis enqueue shell_script");
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "queue error")
        })?;

    let task = tasks::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "task row missing"))?;

    state.notify_dashboard();
    if let Err(e) = super::try_push_next_task_ws(&state, body.agent_id).await {
        tracing::warn!(error = %e, "ws push after run_script_task");
    }

    Ok(Json(task.into()))
}

pub async fn list_tasks(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<TaskRow>>, ApiError> {
    let _ = resolve_session(&state, &headers).await?;

    let rows: Vec<TaskRow> = tasks::Entity::find()
        .order_by_desc(tasks::Column::CreatedAt)
        .limit(200)
        .all(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .into_iter()
        .map(Into::into)
        .collect();

    Ok(Json(rows))
}

pub async fn get_task(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<TaskRow>, ApiError> {
    let _ = resolve_session(&state, &headers).await?;

    let task = tasks::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let Some(task) = task else {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "not found"));
    };
    Ok(Json(task.into()))
}

pub async fn get_task_result(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<crate::models::TaskResultRow>, ApiError> {
    let _ = resolve_session(&state, &headers).await?;

    use crate::entity::task_results;
    let res = task_results::Entity::find()
        .filter(task_results::Column::TaskId.eq(id))
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let Some(res) = res else {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "no result yet"));
    };
    Ok(Json(res.into()))
}

pub async fn get_task_logs(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::models::TaskLogRow>>, ApiError> {
    let _ = resolve_session(&state, &headers).await?;

    use crate::entity::task_logs;
    let rows: Vec<crate::models::TaskLogRow> = task_logs::Entity::find()
        .filter(task_logs::Column::TaskId.eq(id))
        .order_by_asc(task_logs::Column::Id)
        .all(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .into_iter()
        .map(Into::into)
        .collect();

    Ok(Json(rows))
}
