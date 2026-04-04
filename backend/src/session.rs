use axum::http::{header::AUTHORIZATION, HeaderMap, StatusCode};
use std::str::FromStr;
use uuid::Uuid;

use crate::{
    auth::{parse_jwt, Claims},
    error::ApiError,
    roles::UserRole,
    state::AppState,
};

pub fn bearer(headers: &HeaderMap) -> Option<String> {
    let v = headers.get(AUTHORIZATION)?.to_str().ok()?;
    let rest = v.strip_prefix("Bearer ")?;
    Some(rest.trim().to_string())
}

pub async fn resolve_session(state: &AppState, headers: &HeaderMap) -> Result<(Uuid, UserRole), ApiError> {
    let token = bearer(headers).ok_or_else(|| {
        ApiError::new(StatusCode::UNAUTHORIZED, "missing bearer token")
    })?;
    let claims = parse_jwt(&token, &state.config.jwt_secret)?;
    claims_to_session(&claims)
}

pub fn claims_to_session(claims: &Claims) -> Result<(Uuid, UserRole), ApiError> {
    let uid = Uuid::from_str(&claims.sub).map_err(|_| {
        ApiError::new(StatusCode::UNAUTHORIZED, "invalid subject")
    })?;
    let role = UserRole::from_db(
        claims
            .role
            .as_deref()
            .unwrap_or("operator"),
    );
    Ok((uid, role))
}
