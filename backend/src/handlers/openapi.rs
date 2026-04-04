//! OpenAPI/Swagger: только эндпоинты с `#[utoipa::path]` в handlers.

use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::{Modify, OpenApi};

use crate::models;

struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let Some(components) = openapi.components.as_mut() else {
            return;
        };
        components.add_security_scheme(
            "bearerAuth",
            SecurityScheme::Http(
                HttpBuilder::new()
                    .scheme(HttpAuthScheme::Bearer)
                    .bearer_format("JWT")
                    .build(),
            ),
        );
    }
}

#[derive(OpenApi)]
#[openapi(
    paths(
        super::auth::health,
        super::auth::login,
        super::auth::current_user,
        super::agent_worker::register_agent,
        super::agent_worker::agent_heartbeat,
        super::agent_worker::agent_next_task,
        super::agent_worker::agent_complete_task,
        super::agent_worker::agent_fail_task,
        super::agents_admin::list_agents,
        super::agents_admin::patch_agent,
        super::tasks_http::create_task,
        super::tasks_http::list_tasks,
        super::tasks_http::get_task,
        super::tasks_http::get_task_result,
        super::tasks_http::get_task_logs,
    ),
    components(
        schemas(
            models::AgentPublic,
            models::TaskRow,
            models::TaskResultRow,
            models::TaskLogRow,
            models::LoginRequest,
            models::LoginResponse,
            models::MeResponse,
            models::RegisterAgentRequest,
            models::RegisterAgentResponse,
            models::CreateTaskRequest,
            models::CompleteTaskRequest,
            models::LogLine,
            models::PatchAgentRequest,
        )
    ),
    modifiers(&SecurityAddon),
    tags(
        (name = "Health", description = "Доступность сервиса"),
        (name = "Auth", description = "JWT для пользователей панели"),
        (name = "Agents", description = "Агенты и их API"),
        (name = "Tasks", description = "Задачи и результаты"),
    ),
)]
pub struct ApiDoc;
