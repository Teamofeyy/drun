//! HTTP handlers by area. Persistence goes through SeaORM on [`AppState::db`](crate::state::AppState::db).

mod agent_worker;
mod agents_admin;
mod auth;
mod metrics;
mod tasks_http;

use axum::http::StatusCode;
use chrono::{Duration, Utc};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter, Set,
};
use uuid::Uuid;

use crate::{
    auth::verify_agent_token,
    entity::agents,
    error::ApiError,
    state::AppState,
    token::fingerprint_token,
};

pub use agent_worker::*;
pub use agents_admin::*;
pub use auth::{current_user, health, login, seed_admin};
pub use metrics::*;
pub use tasks_http::*;

pub(crate) async fn resolve_agent(state: &AppState, token: &str) -> Result<Uuid, ApiError> {
    let fp = fingerprint_token(token);
    let row = agents::Entity::find()
        .filter(agents::Column::TokenFingerprint.eq(fp))
        .one(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "db");
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error")
        })?;

    let Some(agent) = row else {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "invalid agent token"));
    };

    if !verify_agent_token(token, &agent.token_hash) {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "invalid agent token"));
    }
    Ok(agent.id)
}

pub(crate) async fn mark_stale_agents_db(db: &sea_orm::DatabaseConnection) {
    let Ok(list) = agents::Entity::find()
        .filter(agents::Column::Status.eq("online"))
        .all(db)
        .await
    else {
        return;
    };

    let cutoff = Utc::now() - Duration::seconds(90);
    for a in list {
        let stale = a.last_seen_at.map(|t| t < cutoff).unwrap_or(true);
        if !stale {
            continue;
        }
        let mut am = a.into_active_model();
        am.status = Set("offline".to_string());
        let _ = am.update(db).await;
    }
}

pub(crate) async fn mark_stale_offline(state: &AppState) {
    mark_stale_agents_db(&state.db).await;
}
