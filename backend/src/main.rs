mod admin_api;
mod analytics;
mod auth;
mod config;
mod entity;
mod error;
mod export;
mod handlers;
mod machine_diff;
mod models;
mod provisioning;
mod queue;
mod roles;
mod session;
mod state;
mod streaming;
mod token;
mod topology;

use std::sync::Arc;

use axum::{
    routing::{get, patch, post},
    Router,
};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cfg = config::Config::from_env()?;
    let bind = cfg.bind.clone();
    let cfg = Arc::new(cfg);

    let pool = sqlx::PgPool::connect(&cfg.database_url).await?;
    sqlx::migrate!().run(&pool).await?;
    let db: sea_orm::DatabaseConnection = pool.into();

    handlers::seed_admin(&db, &cfg.admin_username, &cfg.admin_password).await?;

    let client = redis::Client::open(cfg.redis_url.as_str())?;
    let redis = redis::aio::ConnectionManager::new(client).await?;

    let state = state::AppState {
        db,
        redis,
        config: cfg,
    };

    let app = Router::new()
        .route("/health", get(handlers::health))
        .route("/api/v1/auth/login", post(handlers::login))
        .route("/api/v1/me", get(handlers::current_user))
        .route("/api/v1/agent/register", post(handlers::register_agent))
        .route("/api/v1/agent/heartbeat", post(handlers::agent_heartbeat))
        .route("/api/v1/agent/tasks/next", get(handlers::agent_next_task))
        .route(
            "/api/v1/agent/tasks/{id}/complete",
            post(handlers::agent_complete_task),
        )
        .route("/api/v1/agent/tasks/{id}/fail", post(handlers::agent_fail_task))
        .route("/api/v1/agents", get(handlers::list_agents))
        .route(
            "/api/v1/agents/{id}/machine-diff",
            get(machine_diff::machine_diff_between_tasks),
        )
        .route(
            "/api/v1/agents/{id}",
            patch(handlers::patch_agent),
        )
        .route(
            "/api/v1/tasks",
            get(handlers::list_tasks).post(handlers::create_task),
        )
        .route("/api/v1/tasks/{id}", get(handlers::get_task))
        .route("/api/v1/tasks/{id}/result", get(handlers::get_task_result))
        .route("/api/v1/tasks/{id}/logs", get(handlers::get_task_logs))
        .route(
            "/api/v1/stream/dashboard",
            get(streaming::sse_dashboard),
        )
        .route("/api/v1/metrics/summary", get(handlers::metrics_summary))
        .route(
            "/api/v1/analytics/daily",
            get(analytics::daily_metrics),
        )
        .route(
            "/api/v1/analytics/ranking",
            get(analytics::agent_ranking),
        )
        .route(
            "/api/v1/analytics/groups",
            get(analytics::agent_groups),
        )
        .route("/api/v1/topology/graph", get(topology::topology_graph))
        .route("/api/v1/export/tasks", get(export::export_tasks))
        .route(
            "/api/v1/admin/clear-task-history",
            post(admin_api::wipe_task_history),
        )
        .route(
            "/api/v1/admin/provision-agent",
            post(provisioning::provision_agent),
        )
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(%bind, "listening");
    axum::serve(listener, app).await?;
    Ok(())
}
