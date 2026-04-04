use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use sea_orm::{ActiveModelTrait, EntityTrait, IntoActiveModel, QueryOrder, Set};
use uuid::Uuid;

use crate::{
    entity::agents,
    error::ApiError,
    models::{AgentPublic, AgentRow, PatchAgentRequest},
    roles::UserRole,
    session::resolve_session,
    state::AppState,
};

use super::mark_stale_offline;

pub async fn list_agents(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<AgentPublic>>, ApiError> {
    let _ = resolve_session(&state, &headers).await?;
    mark_stale_offline(&state).await;

    let rows: Vec<AgentRow> = agents::Entity::find()
        .order_by_desc(agents::Column::CreatedAt)
        .all(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .into_iter()
        .map(Into::into)
        .collect();

    let out: Vec<AgentPublic> = rows
        .into_iter()
        .map(|r| AgentPublic {
            id: r.id,
            name: r.name,
            created_at: r.created_at,
            last_seen_at: r.last_seen_at,
            status: r.status,
            site: r.site,
            segment: r.segment,
            role_tag: r.role_tag,
        })
        .collect();

    Ok(Json(out))
}

pub async fn patch_agent(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<PatchAgentRequest>,
) -> Result<Json<AgentPublic>, ApiError> {
    let (_, role) = resolve_session(&state, &headers).await?;
    role.require(UserRole::Operator)?;

    let current = agents::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "agent not found"))?;

    let site = body.site.unwrap_or_else(|| current.site.clone());
    let segment = body.segment.unwrap_or_else(|| current.segment.clone());
    let role_tag = body.role_tag.unwrap_or_else(|| current.role_tag.clone());

    let name = current.name.clone();
    let created_at = current.created_at;
    let last_seen_at = current.last_seen_at;
    let status = current.status.clone();

    let mut am = current.into_active_model();
    am.site = Set(site.clone());
    am.segment = Set(segment.clone());
    am.role_tag = Set(role_tag.clone());
    am.update(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    Ok(Json(AgentPublic {
        id,
        name,
        created_at,
        last_seen_at,
        status,
        site,
        segment,
        role_tag,
    }))
}
