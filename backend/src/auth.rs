use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::http::StatusCode;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;
use uuid::Uuid;

use crate::error::ApiError;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    #[serde(default)]
    pub role: Option<String>,
    pub exp: usize,
}

pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut rand::thread_rng());
    let argon2 = Argon2::default();
    Ok(argon2
        .hash_password(password.as_bytes(), &salt)?
        .to_string())
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

pub fn hash_agent_token(token: &str) -> Result<String, argon2::password_hash::Error> {
    hash_password(token)
}

pub fn verify_agent_token(token: &str, hash: &str) -> bool {
    verify_password(token, hash)
}

/// Сравнение enrollment-секрета без ветвления по содержимому (длины должны совпадать).
pub fn enrollment_secrets_equal(provided: &str, expected: &str) -> bool {
    let a = provided.as_bytes();
    let b = expected.as_bytes();
    if a.len() != b.len() {
        return false;
    }
    a.ct_eq(b).into()
}

pub fn issue_jwt(
    user_id: &Uuid,
    role: &str,
    secret: &str,
    ttl_hours: u64,
) -> Result<String, jsonwebtoken::errors::Error> {
    let exp = chrono::Utc::now().timestamp() as usize + (ttl_hours as usize * 3600);
    let claims = Claims {
        sub: user_id.to_string(),
        role: Some(role.to_string()),
        exp,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

pub fn parse_jwt(token: &str, secret: &str) -> Result<Claims, ApiError> {
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map(|d| d.claims)
    .map_err(|_| ApiError::new(StatusCode::UNAUTHORIZED, "invalid token"))
}

#[cfg(test)]
mod tests {
    use super::enrollment_secrets_equal;

    #[test]
    fn enrollment_secret_match_and_mismatch() {
        assert!(enrollment_secrets_equal("same", "same"));
        assert!(!enrollment_secrets_equal("a", "b"));
        assert!(!enrollment_secrets_equal("short", "longer"));
    }
}
