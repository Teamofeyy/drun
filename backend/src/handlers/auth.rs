use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde_json::json;
use uuid::Uuid;

use crate::{
    auth::{hash_password, issue_jwt, verify_password},
    entity::users,
    error::ApiError,
    models::{LoginRequest, LoginResponse, MeResponse},
    session::resolve_session,
    state::AppState,
};

pub async fn health() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok" }))
}

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<LoginResponse>, ApiError> {
    let row = users::Entity::find()
        .filter(users::Column::Username.eq(&body.username))
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let Some(user) = row else {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "invalid credentials"));
    };

    if !verify_password(&body.password, &user.password_hash) {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "invalid credentials"));
    }

    let token = issue_jwt(&user.id, &user.role, &state.config.jwt_secret, 24).map_err(|_| {
        ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "token issue failed")
    })?;

    Ok(Json(LoginResponse {
        token,
        token_type: "Bearer",
        expires_in: 24 * 3600,
        role: user.role,
    }))
}

pub async fn current_user(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<MeResponse>, ApiError> {
    let (uid, role) = resolve_session(&state, &headers).await?;
    let username = users::Entity::find_by_id(uid)
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .map(|u| u.username)
        .unwrap_or_else(|| "(unknown)".to_string());

    Ok(Json(MeResponse {
        id: uid,
        username,
        role: role.as_str().to_string(),
    }))
}

pub async fn seed_admin(
    db: &sea_orm::DatabaseConnection,
    username: &str,
    password: &str,
) -> anyhow::Result<()> {
    let exists = users::Entity::find()
        .filter(users::Column::Username.eq(username))
        .one(db)
        .await?
        .is_some();

    if exists {
        return Ok(());
    }

    let id = Uuid::new_v4();
    let hash = hash_password(password).map_err(|e| anyhow::anyhow!("{e}"))?;
    use sea_orm::ActiveModelTrait;
    use sea_orm::Set;
    users::ActiveModel {
        id: Set(id),
        username: Set(username.to_string()),
        password_hash: Set(hash),
        role: Set("admin".to_string()),
        ..Default::default()
    }
    .insert(db)
    .await?;

    tracing::info!(%username, "created default admin user");
    Ok(())
}
