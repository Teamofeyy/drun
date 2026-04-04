use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::Utc;
use sea_orm::{
    sea_query::Expr, ActiveModelTrait, ColumnTrait, EntityTrait, IntoActiveModel, PaginatorTrait,
    QueryFilter, QueryOrder, Set, TransactionTrait,
};
use serde_json::json;
use uuid::Uuid;

use crate::{
    auth::hash_agent_token,
    entity::{agents, task_logs, task_results, tasks},
    error::ApiError,
    models::{CompleteTaskRequest, RegisterAgentRequest, RegisterAgentResponse, TaskRow},
    queue,
    session::bearer,
    state::AppState,
    token::fingerprint_token,
};

use super::resolve_agent;

#[utoipa::path(
    post,
    path = "/api/v1/agent/register",
    tag = "Agents",
    description = "Регистрация нового агента; в ответе выдаётся одноразовый токен.",
    request_body = RegisterAgentRequest,
    responses(
        (status = 201, description = "Агент создан, токен в теле ответа", body = RegisterAgentResponse),
        (status = 400, description = "Пустое имя и т.п.", body = serde_json::Value),
        (status = 500, description = "Внутренняя ошибка", body = serde_json::Value),
    )
)]
pub async fn register_agent(
    State(state): State<AppState>,
    Json(body): Json<RegisterAgentRequest>,
) -> Result<Json<RegisterAgentResponse>, ApiError> {
    if body.name.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "name required"));
    }

    let raw_token: String = format!("{}.{}", Uuid::new_v4(), Uuid::new_v4().simple());
    let fp = fingerprint_token(&raw_token);
    let th = hash_agent_token(&raw_token)
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "hash failed"))?;

    let id = Uuid::new_v4();
    agents::ActiveModel {
        id: Set(id),
        name: Set(body.name),
        token_fingerprint: Set(fp),
        token_hash: Set(th),
        status: Set("offline".to_string()),
        ..Default::default()
    }
    .insert(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(%e, "insert agent");
        ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error")
    })?;

    Ok(Json(RegisterAgentResponse {
        agent_id: id,
        token: raw_token,
        message: "store this token; it is not shown again",
    }))
}

#[utoipa::path(
    post,
    path = "/api/v1/agent/heartbeat",
    tag = "Agents",
    description = "Heartbeat агента по токену в Authorization: Bearer.",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Статус обновлён", body = serde_json::Value),
        (status = 401, description = "Нет или невалидный токен агента", body = serde_json::Value),
        (status = 404, description = "Агент не найден", body = serde_json::Value),
        (status = 500, description = "Внутренняя ошибка", body = serde_json::Value),
    )
)]
pub async fn agent_heartbeat(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let token = bearer(&headers)
        .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "missing bearer token"))?;
    let agent_id = resolve_agent(&state, &token).await?;

    let agent = agents::Entity::find_by_id(agent_id)
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "agent not found"))?;

    let mut am = agent.into_active_model();
    am.last_seen_at = Set(Some(Utc::now()));
    am.status = Set("online".to_string());
    am.update(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    Ok(Json(json!({ "ok": true, "agent_id": agent_id })))
}

#[utoipa::path(
    get,
    path = "/api/v1/agent/tasks/next",
    tag = "Agents",
    description = "Следующая задача из очереди для агента; тело может быть null, если задач нет.",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Задача или null", body = serde_json::Value),
        (status = 401, description = "Нет или невалидный токен агента", body = serde_json::Value),
        (status = 500, description = "Внутренняя ошибка", body = serde_json::Value),
    )
)]
pub async fn agent_next_task(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Option<TaskRow>>, ApiError> {
    let token = bearer(&headers)
        .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "missing bearer token"))?;
    let agent_id = resolve_agent(&state, &token).await?;

    let running = tasks::Entity::find()
        .filter(tasks::Column::AgentId.eq(agent_id))
        .filter(tasks::Column::Status.eq("running"))
        .count(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    if running >= state.config.agent_max_concurrent_tasks as u64 {
        return Ok(Json(None));
    }

    let mut redis = state.redis.clone();
    let mut task_id = queue::dequeue(&mut redis, agent_id).await.map_err(|e| {
        tracing::error!(%e, "redis dequeue");
        ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "queue error")
    })?;

    if task_id.is_none() {
        let row = tasks::Entity::find()
            .filter(tasks::Column::AgentId.eq(agent_id))
            .filter(tasks::Column::Status.eq("pending"))
            .order_by_asc(tasks::Column::CreatedAt)
            .one(&state.db)
            .await
            .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;
        task_id = row.map(|t| t.id);
    }

    let Some(tid) = task_id else {
        return Ok(Json(None));
    };

    let updated = tasks::Entity::update_many()
        .col_expr(tasks::Column::Status, Expr::value("running"))
        .col_expr(tasks::Column::StartedAt, Expr::value(Utc::now()))
        .filter(tasks::Column::Id.eq(tid))
        .filter(tasks::Column::AgentId.eq(agent_id))
        .filter(tasks::Column::Status.eq("pending"))
        .exec(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .rows_affected;

    if updated == 0 {
        return Ok(Json(None));
    }

    let task = tasks::Entity::find_by_id(tid)
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "task row missing"))?;

    Ok(Json(Some(task.into())))
}

#[utoipa::path(
    post,
    path = "/api/v1/agent/tasks/{id}/complete",
    tag = "Agents",
    description = "Завершение задачи агентом: результат, логи, переход в done.",
    security(("bearerAuth" = [])),
    params(
        ("id" = Uuid, Path, description = "Идентификатор задачи"),
    ),
    request_body = CompleteTaskRequest,
    responses(
        (status = 200, description = "Результат сохранён", body = serde_json::Value),
        (status = 401, description = "Нет или невалидный токен агента", body = serde_json::Value),
        (status = 403, description = "Задача назначена другому агенту", body = serde_json::Value),
        (status = 404, description = "Задача не найдена", body = serde_json::Value),
        (status = 500, description = "Внутренняя ошибка", body = serde_json::Value),
    )
)]
pub async fn agent_complete_task(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<CompleteTaskRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let token = bearer(&headers)
        .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "missing bearer token"))?;
    let agent_id = resolve_agent(&state, &token).await?;

    let owner = tasks::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let Some(task) = owner else {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "task not found"));
    };
    if task.agent_id != agent_id {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "wrong agent"));
    }

    let txn = state
        .db
        .begin()
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let rid = Uuid::new_v4();
    task_results::ActiveModel {
        id: Set(rid),
        task_id: Set(id),
        stdout: Set(body.stdout.clone()),
        stderr: Set(body.stderr.clone()),
        exit_code: Set(body.exit_code),
        data: Set(body.data.clone()),
        summary: Set(body.summary.clone()),
        ..Default::default()
    }
    .insert(&txn)
    .await
    .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    for line in &body.logs {
        task_logs::ActiveModel {
            task_id: Set(id),
            level: Set(line.level.clone()),
            message: Set(line.message.clone()),
            ..Default::default()
        }
        .insert(&txn)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;
    }

    let row = tasks::Entity::find_by_id(id)
        .one(&txn)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "task not found"))?;

    let mut am = row.into_active_model();
    am.status = Set("done".to_string());
    am.completed_at = Set(Some(Utc::now()));
    am.error_message = Set(None);
    am.update(&txn)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    txn.commit()
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    Ok(Json(json!({ "ok": true, "result_id": rid })))
}

#[utoipa::path(
    post,
    path = "/api/v1/agent/tasks/{id}/fail",
    tag = "Agents",
    description = "Сообщение об ошибке выполнения; возможен повтор в очереди до исчерпания лимита.",
    security(("bearerAuth" = [])),
    params(
        ("id" = Uuid, Path, description = "Идентификатор задачи"),
    ),
    request_body = serde_json::Value,
    responses(
        (status = 200, description = "Статус обработан (retry или failed)", body = serde_json::Value),
        (status = 401, description = "Нет или невалидный токен агента", body = serde_json::Value),
        (status = 404, description = "Задача не найдена или не в running", body = serde_json::Value),
        (status = 500, description = "Внутренняя ошибка", body = serde_json::Value),
    )
)]
pub async fn agent_fail_task(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let token = bearer(&headers)
        .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "missing bearer token"))?;
    let agent_id = resolve_agent(&state, &token).await?;

    let msg = body
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("failed");

    let task = tasks::Entity::find_by_id(id)
        .filter(tasks::Column::AgentId.eq(agent_id))
        .filter(tasks::Column::Status.eq("running"))
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let Some(task) = task else {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "task not found or not running",
        ));
    };

    let retries_used = task.retries_used + 1;
    let max_retries = task.max_retries;

    let mut am = task.into_active_model();
    am.retries_used = Set(retries_used);
    am.error_message = Set(Some(msg.to_string()));
    am.update(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    if retries_used <= max_retries {
        let fresh = tasks::Entity::find_by_id(id)
            .one(&state.db)
            .await
            .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
            .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "task not found"))?;

        let mut am = fresh.into_active_model();
        am.status = Set("pending".to_string());
        am.started_at = Set(None);
        am.completed_at = Set(None);
        am.update(&state.db)
            .await
            .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

        let mut redis = state.redis.clone();
        queue::enqueue(&mut redis, agent_id, id)
            .await
            .map_err(|e| {
                tracing::error!(%e, "redis enqueue retry");
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "queue error")
            })?;

        Ok(Json(
            json!({ "ok": true, "will_retry": true, "retries_used": retries_used }),
        ))
    } else {
        let fresh = tasks::Entity::find_by_id(id)
            .one(&state.db)
            .await
            .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
            .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "task not found"))?;

        let mut am = fresh.into_active_model();
        am.status = Set("failed".to_string());
        am.completed_at = Set(Some(Utc::now()));
        am.update(&state.db)
            .await
            .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

        Ok(Json(json!({ "ok": true, "will_retry": false })))
    }
}
