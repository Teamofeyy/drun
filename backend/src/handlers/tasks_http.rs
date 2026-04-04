use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Set,
};
use uuid::Uuid;

use crate::{
    entity::{agents, tasks},
    error::ApiError,
    models::{CreateTaskRequest, TaskLogRow, TaskResultRow, TaskRow},
    queue,
    roles::UserRole,
    session::resolve_session,
    state::AppState,
};

const ALLOWED_TASK_KINDS: &[&str] = &[
    "system_info",
    "port_check",
    "diagnostic",
    "network_reachability",
    "check_bundle",
];

#[utoipa::path(
    post,
    path = "/api/v1/tasks",
    tag = "Tasks",
    description = "Создание задачи для агента и постановка в очередь. Требуется роль operator+.",
    security(("bearerAuth" = [])),
    request_body = CreateTaskRequest,
    responses(
        (status = 201, description = "Задача создана", body = TaskRow),
        (status = 400, description = "Некорректный kind или агент", body = serde_json::Value),
        (status = 401, description = "Нет или невалидный токен", body = serde_json::Value),
        (status = 403, description = "Недостаточно прав", body = serde_json::Value),
        (status = 500, description = "Внутренняя ошибка", body = serde_json::Value),
    )
)]
pub async fn create_task(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateTaskRequest>,
) -> Result<Json<TaskRow>, ApiError> {
    let (_, role) = resolve_session(&state, &headers).await?;
    role.require(UserRole::Operator)?;

    if !ALLOWED_TASK_KINDS.contains(&body.kind.as_str()) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "unsupported task kind",
        ));
    }

    let exists = agents::Entity::find_by_id(body.agent_id)
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .is_some();

    if !exists {
        return Err(ApiError::new(StatusCode::BAD_REQUEST, "unknown agent"));
    }

    let max_retries = body.max_retries.clamp(0, 10);

    let id = Uuid::new_v4();
    tasks::ActiveModel {
        id: Set(id),
        agent_id: Set(body.agent_id),
        kind: Set(body.kind),
        payload: Set(body.payload),
        status: Set("pending".to_string()),
        max_retries: Set(max_retries),
        ..Default::default()
    }
    .insert(&state.db)
    .await
    .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let mut redis = state.redis.clone();
    queue::enqueue(&mut redis, body.agent_id, id)
        .await
        .map_err(|e| {
            tracing::error!(%e, "redis enqueue");
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "queue error")
        })?;

    let task = tasks::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .ok_or_else(|| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "task row missing"))?;

    Ok(Json(task.into()))
}

#[utoipa::path(
    get,
    path = "/api/v1/tasks",
    tag = "Tasks",
    description = "Список последних задач (до 200), по убыванию даты создания.",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Список задач", body = [TaskRow]),
        (status = 401, description = "Нет или невалидный токен", body = serde_json::Value),
        (status = 500, description = "Внутренняя ошибка", body = serde_json::Value),
    )
)]
pub async fn list_tasks(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<TaskRow>>, ApiError> {
    let _ = resolve_session(&state, &headers).await?;

    let rows: Vec<TaskRow> = tasks::Entity::find()
        .order_by_desc(tasks::Column::CreatedAt)
        .limit(200)
        .all(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .into_iter()
        .map(Into::into)
        .collect();

    Ok(Json(rows))
}

#[utoipa::path(
    get,
    path = "/api/v1/tasks/{id}",
    tag = "Tasks",
    description = "Карточка задачи по идентификатору.",
    security(("bearerAuth" = [])),
    params(
        ("id" = Uuid, Path, description = "Идентификатор задачи"),
    ),
    responses(
        (status = 200, description = "Задача найдена", body = TaskRow),
        (status = 401, description = "Нет или невалидный токен", body = serde_json::Value),
        (status = 404, description = "Не найдено", body = serde_json::Value),
        (status = 500, description = "Внутренняя ошибка", body = serde_json::Value),
    )
)]
pub async fn get_task(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<TaskRow>, ApiError> {
    let _ = resolve_session(&state, &headers).await?;

    let task = tasks::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let Some(task) = task else {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "not found"));
    };
    Ok(Json(task.into()))
}

#[utoipa::path(
    get,
    path = "/api/v1/tasks/{id}/result",
    tag = "Tasks",
    description = "Результат выполнения задачи (stdout/stderr/data и т.д.).",
    security(("bearerAuth" = [])),
    params(
        ("id" = Uuid, Path, description = "Идентификатор задачи"),
    ),
    responses(
        (status = 200, description = "Результат найден", body = TaskResultRow),
        (status = 401, description = "Нет или невалидный токен", body = serde_json::Value),
        (status = 404, description = "Результата ещё нет", body = serde_json::Value),
        (status = 500, description = "Внутренняя ошибка", body = serde_json::Value),
    )
)]
pub async fn get_task_result(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<crate::models::TaskResultRow>, ApiError> {
    let _ = resolve_session(&state, &headers).await?;

    use crate::entity::task_results;
    let res = task_results::Entity::find()
        .filter(task_results::Column::TaskId.eq(id))
        .one(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?;

    let Some(res) = res else {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "no result yet"));
    };
    Ok(Json(res.into()))
}

#[utoipa::path(
    get,
    path = "/api/v1/tasks/{id}/logs",
    tag = "Tasks",
    description = "Строки лога, записанные агентом по задаче.",
    security(("bearerAuth" = [])),
    params(
        ("id" = Uuid, Path, description = "Идентификатор задачи"),
    ),
    responses(
        (status = 200, description = "Список записей лога", body = [TaskLogRow]),
        (status = 401, description = "Нет или невалидный токен", body = serde_json::Value),
        (status = 404, description = "Не найдено (пустой список при отсутствии строк)", body = serde_json::Value),
        (status = 500, description = "Внутренняя ошибка", body = serde_json::Value),
    )
)]
pub async fn get_task_logs(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::models::TaskLogRow>>, ApiError> {
    let _ = resolve_session(&state, &headers).await?;

    use crate::entity::task_logs;
    let rows: Vec<crate::models::TaskLogRow> = task_logs::Entity::find()
        .filter(task_logs::Column::TaskId.eq(id))
        .order_by_asc(task_logs::Column::Id)
        .all(&state.db)
        .await
        .map_err(|_| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error"))?
        .into_iter()
        .map(Into::into)
        .collect();

    Ok(Json(rows))
}
