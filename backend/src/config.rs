use std::env;

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub redis_url: String,
    pub jwt_secret: String,
    pub admin_username: String,
    pub admin_password: String,
    pub bind: String,
    /// Сколько задач одновременно может быть в статусе running на одном агенте
    pub agent_max_concurrent_tasks: i64,
    /// Таймаут `ansible-playbook` для provision-agent (секунды)
    pub provision_timeout_secs: u64,
    /// Дефолт каталога URL релиза агента (GET /admin/provision-agent-defaults и fallback в POST, если поле не прислали)
    pub default_infrahub_agent_release_base: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        dotenvy::dotenv().ok();
        Ok(Self {
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://infrahub:infrahub@127.0.0.1:5432/infrahub".into()),
            redis_url: env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into()),
            jwt_secret: env::var("JWT_SECRET").unwrap_or_else(|_| {
                tracing::warn!("JWT_SECRET not set; using dev default");
                "dev-secret-change-me".into()
            }),
            admin_username: env::var("ADMIN_USERNAME").unwrap_or_else(|_| "admin".into()),
            admin_password: env::var("ADMIN_PASSWORD").unwrap_or_else(|_| "admin".into()),
            bind: env::var("BIND").unwrap_or_else(|_| "0.0.0.0:8080".into()),
            agent_max_concurrent_tasks: env::var("AGENT_MAX_CONCURRENT_TASKS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(1)
                .max(1),
            provision_timeout_secs: env::var("INFRAHUB_PROVISION_TIMEOUT_SECS")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(1800)
                .clamp(60, 7200),
            default_infrahub_agent_release_base: env::var("INFRAHUB_AGENT_RELEASE_BASE")
                .unwrap_or_else(|_| {
                    "https://github.com/Teamofeyy/drun/releases/download/nightly".into()
                })
                .trim_end_matches('/')
                .to_string(),
        })
    }
}
