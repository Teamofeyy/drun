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
    auth::{enrollment_secrets_equal, hash_agent_token},
    entity::{agents, task_logs, task_results, tasks},
    error::ApiError,
    models::{
        normalize_register_cpu_arch, CompleteTaskRequest, RegisterAgentRequest,
        RegisterAgentResponse, TaskRow,
    },
    queue,
    session::{bearer, enrollment_secret_from_headers},
    state::AppState,
    token::fingerprint_token,
};

use super::resolve_agent;

pub async fn record_agent_presence(state: &AppState, agent_id: Uuid) -> Result<(), ApiError> {
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
    Ok(())
}

pub async fn rollback_claimed_task(
    state: &AppState,
    agent_id: Uuid,
    task_id: Uuid,
) -> Result<(), ApiError> {
    let task = tasks::Entity::find_by_id(task_id)
        .filter(tasks::Column::AgentId.eq(agent_id))
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let Some(task) = task else {
        return Ok(());
    };
    if task.status != "running" {
        return Ok(());
    }

    let mut am = task.into_active_model();
    am.status = Set("pending".to_string());
    am.started_at = Set(None);
    am.update(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let mut redis = state.redis.clone();
    queue::enqueue(&mut redis, agent_id, task_id)
        .await
        .map_err(|e| {
            tracing::error!(%e, "rollback re-enqueue");
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "queue error")
        })?;

    Ok(())
}

pub async fn claim_next_task_for_agent(
    state: &AppState,
    agent_id: Uuid,
) -> Result<Option<TaskRow>, ApiError> {
    let running = tasks::Entity::find()
        .filter(tasks::Column::AgentId.eq(agent_id))
        .filter(tasks::Column::Status.eq("running"))
        .count(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    if running >= state.config.agent_max_concurrent_tasks as u64 {
        return Ok(None);
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
        return Ok(None);
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
        return Ok(None);
    }

    let task = tasks::Entity::find_by_id(tid)
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "task row missing"))?;

    Ok(Some(task.into()))
}

/// If this agent has a WebSocket, claim the next task and push JSON; rollback claim if send fails.
pub async fn try_push_next_task_ws(state: &AppState, agent_id: Uuid) -> Result<(), ApiError> {
    if !state.agent_ws.has_connection(agent_id).await {
        return Ok(());
    }

    let task = claim_next_task_for_agent(state, agent_id).await?;
    let Some(task) = task else {
        return Ok(());
    };

    let tid = task.id;

    let body = json!({ "kind": "task", "task": task });
    let text = serde_json::to_string(&body)
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if state.agent_ws.send_text(agent_id, text).await {
        state.notify_dashboard();
        return Ok(());
    }

    rollback_claimed_task(state, agent_id, tid).await?;
    state.notify_dashboard();
    Ok(())
}

pub async fn register_agent(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RegisterAgentRequest>,
) -> Result<Json<RegisterAgentResponse>, ApiError> {
    let provided = enrollment_secret_from_headers(&headers)
        .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "unauthorized"))?;
    if !enrollment_secrets_equal(&provided, state.config.agent_enrollment_secret.as_str()) {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "unauthorized"));
    }

    if body.name.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "name required"));
    }

    let raw_token: String = format!("{}.{}", Uuid::new_v4(), Uuid::new_v4().simple());
    let fp = fingerprint_token(&raw_token);
    let th = hash_agent_token(&raw_token)
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "hash failed"))?;

    let id = Uuid::new_v4();
    let cpu_arch = normalize_register_cpu_arch(body.cpu_arch.as_deref());
    agents::ActiveModel {
        id: Set(id),
        name: Set(body.name),
        token_fingerprint: Set(fp),
        token_hash: Set(th),
        status: Set("offline".to_string()),
        cpu_arch: Set(cpu_arch),
        ..Default::default()
    }
    .insert(&state.db)
    .await
    .map_err(|e| {
        tracing::error!(%e, "insert agent");
        ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error")
    })?;

    state.notify_dashboard();

    Ok(Json(RegisterAgentResponse {
        agent_id: id,
        token: raw_token,
        message: "store this token; it is not shown again",
    }))
}

pub async fn agent_heartbeat(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let token = bearer(&headers)
        .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "missing bearer token"))?;
    let agent_id = resolve_agent(&state, &token).await?;
    record_agent_presence(&state, agent_id).await?;

    Ok(Json(json!({ "ok": true, "agent_id": agent_id })))
}

pub async fn agent_next_task(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Option<TaskRow>>, ApiError> {
    let token = bearer(&headers)
        .ok_or_else(|| ApiError::new(StatusCode::UNAUTHORIZED, "missing bearer token"))?;
    let agent_id = resolve_agent(&state, &token).await?;

    let row = claim_next_task_for_agent(&state, agent_id).await?;
    if row.is_some() {
        state.notify_dashboard();
    }
    Ok(Json(row))
}

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

    state.notify_dashboard();
    if let Err(e) = try_push_next_task_ws(&state, agent_id).await {
        tracing::warn!(%agent_id, error = %e, "ws push after complete");
    }

    Ok(Json(json!({ "ok": true, "result_id": rid })))
}

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

        state.notify_dashboard();
        if let Err(e) = try_push_next_task_ws(&state, agent_id).await {
            tracing::warn!(%agent_id, error = %e, "ws push after fail retry");
        }

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

        state.notify_dashboard();

        Ok(Json(json!({ "ok": true, "will_retry": false })))
    }
}
