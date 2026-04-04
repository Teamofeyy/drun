//! Опасные операции только для администратора.

use axum::{extract::State, http::HeaderMap, Json};
use sea_orm::{EntityTrait, TransactionTrait};
use serde_json::json;

use crate::{
    entity::tasks,
    error::ApiError,
    models::AdminWipeBody,
    queue,
    roles::UserRole,
    session::resolve_session,
    state::AppState,
};

/// Удаляет все задачи, результаты, логи и очищает Redis-очереди агентов.
pub async fn wipe_task_history(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AdminWipeBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let (_, role) = resolve_session(&state, &headers).await?;
    role.require(UserRole::Admin)?;
    if body.confirm != "DELETE_ALL_TASK_HISTORY" {
        return Err(ApiError::new(
            axum::http::StatusCode::BAD_REQUEST,
            r#"body must be {"confirm":"DELETE_ALL_TASK_HISTORY"}"#,
        ));
    }

    let txn = state
        .db
        .begin()
        .await
        .map_err(|_| {
            ApiError::new(
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "database error",
            )
        })?;

    let res = tasks::Entity::delete_many()
        .exec(&txn)
        .await
        .map_err(|e| {
            tracing::error!(%e, "wipe tasks");
            ApiError::new(
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "database error",
            )
        })?;

    txn.commit()
        .await
        .map_err(|_| {
            ApiError::new(
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "database error",
            )
        })?;

    let mut redis = state.redis.clone();
    let queues = queue::clear_all_agent_queues(&mut redis).await.map_err(|e| {
        tracing::error!(%e, "redis clear queues");
        ApiError::new(
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "redis error",
        )
    })?;

    Ok(Json(json!({
        "ok": true,
        "deleted_task_rows": res.rows_affected,
        "redis_queue_keys_cleared": queues,
    })))
}
