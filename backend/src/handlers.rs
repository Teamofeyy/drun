use std::str::FromStr;

use axum::{
    extract::{Path, State},
    http::{header::AUTHORIZATION, HeaderMap, StatusCode},
    Json,
};
use serde_json::json;
use uuid::Uuid;

use crate::{
    auth::{hash_agent_token, hash_password, issue_jwt, parse_jwt, verify_agent_token},
    error::ApiError,
    models::{
        AgentPublic, AgentRow, CompleteTaskRequest, CreateTaskRequest, LoginRequest, LoginResponse,
        RegisterAgentRequest, RegisterAgentResponse, TaskLogRow, TaskResultRow, TaskRow,
    },
    queue,
    state::AppState,
    token::fingerprint_token,
};

const ALLOWED_TASK_KINDS: &[&str] = &[
    "system_info",
    "port_check",
    "diagnostic",
    "network_reachability",
];

fn bearer(headers: &HeaderMap) -> Option<String> {
    let v = headers.get(AUTHORIZATION)?.to_str().ok()?;
    let rest = v.strip_prefix("Bearer ")?;
    Some(rest.trim().to_string())
}

async fn resolve_agent(state: &AppState, token: &str) -> Result<Uuid, ApiError> {
    let fp = fingerprint_token(token);
    let row: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT id, token_hash FROM agents WHERE token_fingerprint = $1",
    )
    .bind(&fp)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "db");
        ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error")
    })?;

    let Some((id, hash)) = row else {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "invalid agent token"));
    };

    if !verify_agent_token(token, &hash) {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "invalid agent token"));
    }
    Ok(id)
}

async fn resolve_user(state: &AppState, headers: &HeaderMap) -> Result<Uuid, ApiError> {
    let token = bearer(headers).ok_or_else(|| {
        ApiError::new(StatusCode::UNAUTHORIZED, "missing bearer token")
    })?;
    let claims = parse_jwt(&token, &state.config.jwt_secret)?;
    Uuid::from_str(&claims.sub).map_err(|_| {
        ApiError::new(StatusCode::UNAUTHORIZED, "invalid subject")
    })
}

pub async fn health() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok" }))
}

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, ApiError> {
    let row: Option<(Uuid, String)> = sqlx::query_as("SELECT id, password_hash FROM users WHERE username = $1")
        .bind(&body.username)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let Some((id, hash)) = row else {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "invalid credentials"));
    };

    if !crate::auth::verify_password(&body.password, &hash) {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "invalid credentials"));
    }

    let token = issue_jwt(&id, &state.config.jwt_secret, 24).map_err(|_| {
        ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "token issue failed")
    })?;

    Ok(Json(LoginResponse {
        token,
        token_type: "Bearer",
        expires_in: 24 * 3600,
    }))
}

pub async fn register_agent(
    State(state): State<AppState>,
    Json(body): Json<RegisterAgentRequest>,
) -> Result<Json<RegisterAgentResponse>, ApiError> {
    if body.name.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "name required"));
    }

    let raw_token: String = format!(
        "{}.{}",
        Uuid::new_v4(),
        Uuid::new_v4().simple()
    );
    let fp = fingerprint_token(&raw_token);
    let th = hash_agent_token(&raw_token).map_err(|_| {
        ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "hash failed")
    })?;

    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO agents (id, name, token_fingerprint, token_hash, status) VALUES ($1, $2, $3, $4, 'offline')",
    )
    .bind(id)
    .bind(&body.name)
    .bind(&fp)
    .bind(&th)
    .execute(&state.pool)
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

pub async fn agent_heartbeat(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let token = bearer(&headers).ok_or_else(|| {
        ApiError::new(StatusCode::UNAUTHORIZED, "missing bearer token")
    })?;
    let agent_id = resolve_agent(&state, &token).await?;

    sqlx::query(
        "UPDATE agents SET last_seen_at = now(), status = 'online' WHERE id = $1",
    )
    .bind(agent_id)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    Ok(Json(json!({ "ok": true, "agent_id": agent_id })))
}

pub async fn agent_next_task(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Option<TaskRow>>, ApiError> {
    let token = bearer(&headers).ok_or_else(|| {
        ApiError::new(StatusCode::UNAUTHORIZED, "missing bearer token")
    })?;
    let agent_id = resolve_agent(&state, &token).await?;

    let mut redis = state.redis.clone();
    let mut task_id = queue::dequeue(&mut redis, agent_id)
        .await
        .map_err(|e| {
            tracing::error!(%e, "redis dequeue");
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "queue error")
        })?;

    if task_id.is_none() {
        let row: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM tasks WHERE agent_id = $1 AND status = 'pending' ORDER BY created_at ASC LIMIT 1",
        )
        .bind(agent_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;
        task_id = row;
    }

    let Some(tid) = task_id else {
        return Ok(Json(None));
    };

    let updated = sqlx::query(
        "UPDATE tasks SET status = 'running', started_at = now() WHERE id = $1 AND agent_id = $2 AND status = 'pending'",
    )
    .bind(tid)
    .bind(agent_id)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
    .rows_affected();

    if updated == 0 {
        return Ok(Json(None));
    }

    let task = sqlx::query_as::<_, TaskRow>("SELECT id, agent_id, kind, payload, status, created_at, started_at, completed_at, error_message FROM tasks WHERE id = $1")
        .bind(tid)
        .fetch_one(&state.pool)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    Ok(Json(Some(task)))
}

pub async fn agent_complete_task(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<CompleteTaskRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let token = bearer(&headers).ok_or_else(|| {
        ApiError::new(StatusCode::UNAUTHORIZED, "missing bearer token")
    })?;
    let agent_id = resolve_agent(&state, &token).await?;

    let owner: Option<Uuid> = sqlx::query_scalar("SELECT agent_id FROM tasks WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let Some(oid) = owner else {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "task not found"));
    };
    if oid != agent_id {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "wrong agent"));
    }

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let rid = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO task_results (id, task_id, stdout, stderr, exit_code, data) VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(rid)
    .bind(id)
    .bind(&body.stdout)
    .bind(&body.stderr)
    .bind(body.exit_code)
    .bind(&body.data)
    .execute(&mut *tx)
    .await
    .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    for line in &body.logs {
        sqlx::query(
            "INSERT INTO task_logs (task_id, level, message) VALUES ($1, $2, $3)",
        )
        .bind(id)
        .bind(&line.level)
        .bind(&line.message)
        .execute(&mut *tx)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;
    }

    sqlx::query(
        "UPDATE tasks SET status = 'done', completed_at = now(), error_message = NULL WHERE id = $1",
    )
    .bind(id)
    .execute(&mut *tx)
    .await
    .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    tx.commit()
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    Ok(Json(json!({ "ok": true, "result_id": rid })))
}

pub async fn agent_fail_task(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let token = bearer(&headers).ok_or_else(|| {
        ApiError::new(StatusCode::UNAUTHORIZED, "missing bearer token")
    })?;
    let agent_id = resolve_agent(&state, &token).await?;

    let owner: Option<Uuid> = sqlx::query_scalar("SELECT agent_id FROM tasks WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let Some(oid) = owner else {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "task not found"));
    };
    if oid != agent_id {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "wrong agent"));
    }

    let msg = body
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("failed");

    sqlx::query(
        "UPDATE tasks SET status = 'failed', completed_at = now(), error_message = $2 WHERE id = $1",
    )
    .bind(id)
    .bind(msg)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    Ok(Json(json!({ "ok": true })))
}

pub async fn list_agents(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<AgentPublic>>, ApiError> {
    let _uid = resolve_user(&state, &headers).await?;
    mark_stale_offline(&state).await;

    let rows: Vec<AgentRow> = sqlx::query_as(
        "SELECT id, name, created_at, last_seen_at, status FROM agents ORDER BY created_at DESC",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let out: Vec<AgentPublic> = rows
        .into_iter()
        .map(|r| AgentPublic {
            id: r.id,
            name: r.name,
            created_at: r.created_at,
            last_seen_at: r.last_seen_at,
            status: r.status,
        })
        .collect();

    Ok(Json(out))
}

async fn mark_stale_offline(state: &AppState) {
    let _ = sqlx::query(
        "UPDATE agents SET status = 'offline' WHERE status = 'online' AND (last_seen_at IS NULL OR last_seen_at < now() - interval '90 seconds')",
    )
    .execute(&state.pool)
    .await;
}

pub async fn create_task(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateTaskRequest>,
) -> Result<Json<TaskRow>, ApiError> {
    let _uid = resolve_user(&state, &headers).await?;

    if !ALLOWED_TASK_KINDS.contains(&body.kind.as_str()) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "unsupported task kind",
        ));
    }

    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM agents WHERE id = $1)")
        .bind(body.agent_id)
        .fetch_one(&state.pool)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    if !exists {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "unknown agent"));
    }

    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO tasks (id, agent_id, kind, payload, status) VALUES ($1, $2, $3, $4, 'pending')",
    )
    .bind(id)
    .bind(body.agent_id)
    .bind(&body.kind)
    .bind(&body.payload)
    .execute(&state.pool)
    .await
    .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let mut redis = state.redis.clone();
    queue::enqueue(&mut redis, body.agent_id, id)
        .await
        .map_err(|e| {
            tracing::error!(%e, "redis enqueue");
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "queue error")
        })?;

    let task = sqlx::query_as::<_, TaskRow>("SELECT id, agent_id, kind, payload, status, created_at, started_at, completed_at, error_message FROM tasks WHERE id = $1")
        .bind(id)
        .fetch_one(&state.pool)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    Ok(Json(task))
}

pub async fn list_tasks(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<TaskRow>>, ApiError> {
    let _uid = resolve_user(&state, &headers).await?;

    let rows: Vec<TaskRow> = sqlx::query_as(
        "SELECT id, agent_id, kind, payload, status, created_at, started_at, completed_at, error_message FROM tasks ORDER BY created_at DESC LIMIT 200",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    Ok(Json(rows))
}

pub async fn get_task(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<TaskRow>, ApiError> {
    let _uid = resolve_user(&state, &headers).await?;

    let task = sqlx::query_as::<_, TaskRow>("SELECT id, agent_id, kind, payload, status, created_at, started_at, completed_at, error_message FROM tasks WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let Some(task) = task else {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "not found"));
    };
    Ok(Json(task))
}

pub async fn get_task_result(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<TaskResultRow>, ApiError> {
    let _uid = resolve_user(&state, &headers).await?;

    let res = sqlx::query_as::<_, TaskResultRow>(
        "SELECT id, task_id, stdout, stderr, exit_code, data, created_at FROM task_results WHERE task_id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let Some(res) = res else {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "no result yet"));
    };
    Ok(Json(res))
}

pub async fn get_task_logs(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<Vec<TaskLogRow>>, ApiError> {
    let _uid = resolve_user(&state, &headers).await?;

    let rows: Vec<TaskLogRow> = sqlx::query_as(
        "SELECT id, task_id, ts, level, message FROM task_logs WHERE task_id = $1 ORDER BY id ASC",
    )
    .bind(id)
    .fetch_all(&state.pool)
    .await
    .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    Ok(Json(rows))
}

pub async fn seed_admin(pool: &sqlx::PgPool, username: &str, password: &str) -> anyhow::Result<()> {
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)")
        .bind(username)
        .fetch_one(pool)
        .await?;

    if exists {
        return Ok(());
    }

    let id = Uuid::new_v4();
    let hash = hash_password(password).map_err(|e| anyhow::anyhow!("{e}"))?;
    sqlx::query("INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)")
        .bind(id)
        .bind(username)
        .bind(&hash)
        .execute(pool)
        .await?;

    tracing::info!(%username, "created default admin user");
    Ok(())
}
