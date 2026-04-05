use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter, QueryOrder, Set,
};
use serde_json::json;
use uuid::Uuid;

use crate::{
    entity::{agents, scenarios, tasks},
    error::ApiError,
    models::{
        CreateScenarioRequest, RunScenarioRequest, ScenarioRow, TaskRow, UpdateScenarioRequest,
    },
    queue,
    roles::UserRole,
    session::resolve_session,
    state::AppState,
};

fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for tag in tags {
        let tag = tag.trim();
        if tag.is_empty() {
            continue;
        }
        if out.iter().any(|x: &String| x.eq_ignore_ascii_case(tag)) {
            continue;
        }
        out.push(tag.to_string());
    }
    out
}

fn slugify(input: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in input.trim().chars() {
        let lower = ch.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() {
            out.push(lower);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn validate_status(status: &str) -> bool {
    matches!(status, "draft" | "published" | "archived")
}

async fn ensure_unique_slug(
    db: &sea_orm::DatabaseConnection,
    base: &str,
    exclude_id: Option<Uuid>,
) -> Result<String, ApiError> {
    let base = if base.trim().is_empty() {
        "scenario".to_string()
    } else {
        slugify(base)
    };

    for idx in 0..1000 {
        let candidate = if idx == 0 {
            base.clone()
        } else {
            format!("{base}-{idx}")
        };

        let row = scenarios::Entity::find()
            .filter(scenarios::Column::Slug.eq(&candidate))
            .one(db)
            .await
            .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

        match row {
            None => return Ok(candidate),
            Some(existing) if Some(existing.id) == exclude_id => return Ok(candidate),
            Some(_) => {}
        }
    }

    Err(ApiError::new(
        StatusCode::CONFLICT,
        "could not allocate unique slug",
    ))
}

pub async fn list_scenarios(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<ScenarioRow>>, ApiError> {
    let _ = resolve_session(&state, &headers).await?;

    let rows: Vec<ScenarioRow> = scenarios::Entity::find()
        .order_by_desc(scenarios::Column::IsPreset)
        .order_by_asc(scenarios::Column::Name)
        .all(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .into_iter()
        .map(Into::into)
        .collect();

    Ok(Json(rows))
}

pub async fn get_scenario(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<ScenarioRow>, ApiError> {
    let _ = resolve_session(&state, &headers).await?;

    let row = scenarios::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "scenario not found"))?;

    Ok(Json(row.into()))
}

pub async fn create_scenario(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateScenarioRequest>,
) -> Result<Json<ScenarioRow>, ApiError> {
    let (uid, role) = resolve_session(&state, &headers).await?;
    role.require(UserRole::Operator)?;

    if body.name.trim().is_empty() {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "name required"));
    }

    let status = body.status.unwrap_or_else(|| "draft".to_string());
    if !validate_status(&status) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid scenario status",
        ));
    }

    let slug =
        ensure_unique_slug(&state.db, body.slug.as_deref().unwrap_or(&body.name), None).await?;

    let id = Uuid::new_v4();
    let now = Utc::now();
    let row = scenarios::ActiveModel {
        id: Set(id),
        slug: Set(slug),
        name: Set(body.name.trim().to_string()),
        description: Set(body.description.trim().to_string()),
        tags: Set(json!(normalize_tags(&body.tags))),
        definition: Set(body.definition),
        input_schema: Set(body.input_schema),
        summary_template: Set(body.summary_template),
        status: Set(status),
        version: Set(1),
        is_preset: Set(false),
        created_by: Set(Some(uid)),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(&state.db)
    .await
    .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    Ok(Json(row.into()))
}

pub async fn update_scenario(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateScenarioRequest>,
) -> Result<Json<ScenarioRow>, ApiError> {
    let (_, role) = resolve_session(&state, &headers).await?;
    role.require(UserRole::Operator)?;

    let row = scenarios::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "scenario not found"))?;

    if row.is_preset {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "preset scenarios are read-only; clone them instead",
        ));
    }

    let current_version = row.version;
    let mut am = row.into_active_model();
    let mut changed = false;

    if let Some(name) = body.name {
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err(ApiError::new(StatusCode::BAD_REQUEST, "name required"));
        }
        am.name = Set(name);
        changed = true;
    }

    if let Some(slug) = body.slug {
        let slug = ensure_unique_slug(&state.db, &slug, Some(id)).await?;
        am.slug = Set(slug);
        changed = true;
    }

    if let Some(description) = body.description {
        am.description = Set(description.trim().to_string());
        changed = true;
    }

    if let Some(tags) = body.tags {
        am.tags = Set(json!(normalize_tags(&tags)));
        changed = true;
    }

    if let Some(definition) = body.definition {
        am.definition = Set(definition);
        changed = true;
    }

    if let Some(input_schema) = body.input_schema {
        am.input_schema = Set(input_schema);
        changed = true;
    }

    if let Some(summary_template) = body.summary_template {
        am.summary_template = Set(summary_template);
        changed = true;
    }

    if let Some(status) = body.status {
        if !validate_status(&status) {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "invalid scenario status",
            ));
        }
        am.status = Set(status);
        changed = true;
    }

    if changed {
        am.version = Set(current_version + 1);
        am.updated_at = Set(Utc::now());
    }

    let updated = am
        .update(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    Ok(Json(updated.into()))
}

pub async fn run_scenario(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(body): Json<RunScenarioRequest>,
) -> Result<Json<TaskRow>, ApiError> {
    let (_, role) = resolve_session(&state, &headers).await?;
    role.require(UserRole::Operator)?;

    let scenario = scenarios::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "scenario not found"))?;

    if scenario.status == "archived" {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "archived scenario cannot be run",
        ));
    }

    let agent_exists = agents::Entity::find_by_id(body.agent_id)
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .is_some();

    if !agent_exists {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "unknown agent"));
    }

    let task_id = Uuid::new_v4();
    tasks::ActiveModel {
        id: Set(task_id),
        agent_id: Set(body.agent_id),
        kind: Set("scenario_run".to_string()),
        payload: Set(json!({
            "scenario_id": scenario.id,
            "scenario_name": scenario.name,
            "scenario_slug": scenario.slug,
            "scenario_version": scenario.version,
            "definition": scenario.definition,
            "inputs": body.inputs,
        })),
        status: Set("pending".to_string()),
        max_retries: Set(0),
        ..Default::default()
    }
    .insert(&state.db)
    .await
    .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let mut redis = state.redis.clone();
    queue::enqueue(&mut redis, body.agent_id, task_id)
        .await
        .map_err(|e| {
            tracing::error!(%e, "redis enqueue scenario_run");
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "queue error")
        })?;

    let task = tasks::Entity::find_by_id(task_id)
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "task row missing"))?;

    state.notify_dashboard();
    if let Err(e) = super::try_push_next_task_ws(&state, body.agent_id).await {
        tracing::warn!(error = %e, "ws push after scenario_run");
    }

    Ok(Json(task.into()))
}

pub async fn seed_system_scenarios(db: &sea_orm::DatabaseConnection) -> anyhow::Result<()> {
    let seeds = vec![
        (
            "node-baseline",
            "Базовая диагностика узла",
            "Системный шаблон: системная информация, CPU, память и диски.",
            vec!["system".to_string(), "baseline".to_string()],
            json!({
                "inputs": {},
                "steps": [
                    { "id": "system", "type": "system_info", "title": "Системная информация" },
                    { "id": "memory", "type": "diagnostic", "title": "Память и диски", "params": { "scenario": "memory_disks" } },
                    { "id": "cpu", "type": "diagnostic", "title": "CPU", "params": { "scenario": "cpu_load" } }
                ]
            }),
        ),
        (
            "network-context",
            "Сетевой контекст",
            "Системный шаблон: reachability и DNS-диагностика.",
            vec!["network".to_string(), "baseline".to_string()],
            json!({
                "inputs": {
                    "targets": {
                        "type": "array",
                        "items": { "type": "string" },
                        "default": ["1.1.1.1:443", "8.8.8.8:53"]
                    }
                },
                "steps": [
                    { "id": "reach", "type": "network_reachability", "title": "Связность", "params": { "targets": "{{inputs.targets}}" } },
                    { "id": "dns", "type": "dns_lookup", "title": "DNS cloudflare.com", "params": { "host": "cloudflare.com" } }
                ]
            }),
        ),
        (
            "internal-services",
            "Проверка внутренних сервисов",
            "Системный шаблон: проверка набора TCP-портов.",
            vec!["ports".to_string(), "services".to_string()],
            json!({
                "inputs": {
                    "targets": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "host": { "type": "string" },
                                "port": { "type": "number" }
                            }
                        }
                    }
                },
                "steps": [
                    { "id": "ports", "type": "port_check", "title": "TCP-проверка", "params": { "targets": "{{inputs.targets}}" } }
                ]
            }),
        ),
    ];

    for (slug, name, description, tags, definition) in seeds {
        let exists = scenarios::Entity::find()
            .filter(scenarios::Column::Slug.eq(slug))
            .one(db)
            .await?;

        if exists.is_some() {
            continue;
        }

        let now = Utc::now();
        scenarios::ActiveModel {
            id: Set(Uuid::new_v4()),
            slug: Set(slug.to_string()),
            name: Set(name.to_string()),
            description: Set(description.to_string()),
            tags: Set(json!(tags)),
            definition: Set(definition),
            input_schema: Set(json!({})),
            summary_template: Set(None),
            status: Set("published".to_string()),
            version: Set(1),
            is_preset: Set(true),
            created_by: Set(None),
            created_at: Set(now),
            updated_at: Set(now),
        }
        .insert(db)
        .await?;
    }

    Ok(())
}
