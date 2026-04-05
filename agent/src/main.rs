#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod checks;
mod client;
mod state_file;

use std::path::PathBuf;

use clap::Parser;
use state_file::{normalize_server, AgentState};

/// Подключается к платформе: при первом запуске регистрируется (нужен INFRAHUB_ENROLLMENT_SECRET) и сохраняет токен локально.
#[derive(Parser)]
#[command(name = "infrahub-agent")]
#[command(about = "InfraHub agent: auto-register, heartbeat, whitelist checks only")]
struct Cli {
    /// URL платформы (например http://127.0.0.1:8080)
    #[arg(long, default_value = "http://127.0.0.1:8080", env = "INFRAHUB_SERVER")]
    server: String,

    /// Имя агента в UI (по умолчанию — hostname машины)
    #[arg(long, env = "INFRAHUB_AGENT_NAME")]
    name: Option<String>,

    /// Каталог для agent.json (по умолчанию XDG data / infrahub)
    #[arg(long, env = "INFRAHUB_DATA_DIR")]
    data_dir: Option<PathBuf>,

    #[arg(long, default_value = "10", env = "INFRAHUB_HEARTBEAT_SECS")]
    heartbeat_secs: u64,

    /// Интервал HTTP GET /agent/tasks/next при открытом WebSocket (запасной канал). 0 — только push по WS.
    #[arg(long, default_value = "60", env = "INFRAHUB_POLL_FALLBACK_SECS")]
    poll_fallback_secs: u64,

    /// Секрет для первичной регистрации на мастере (env INFRAHUB_ENROLLMENT_SECRET)
    #[arg(long, env = "INFRAHUB_ENROLLMENT_SECRET")]
    enrollment_secret: Option<String>,

    /// Заново зарегистрироваться (новый токен), даже если есть сохранённый
    #[arg(long)]
    re_register: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("infrahub_agent=info".parse()?),
        )
        .init();

    tracing::info!(version = env!("CARGO_PKG_VERSION"), "infrahub-agent");

    let cli = Cli::parse();
    let path = state_file::state_path(cli.data_dir.as_deref());
    let server_n = normalize_server(&cli.server);
    let display_name = cli
        .name
        .clone()
        .or_else(|| hostname::get().ok().and_then(|h| h.into_string().ok()))
        .unwrap_or_else(|| "agent".to_string());

    let (state, freshly_registered) = if !cli.re_register {
        if let Ok(Some(st)) = state_file::load(&path) {
            if normalize_server(&st.server) == server_n {
                (st, false)
            } else {
                tracing::info!("Сохранённый server не совпадает — новая регистрация");
                let enrollment = enrollment_for_register(&cli)?;
                register_and_save(&path, &server_n, &display_name, &enrollment).await?
            }
        } else {
            let enrollment = enrollment_for_register(&cli)?;
            register_and_save(&path, &server_n, &display_name, &enrollment).await?
        }
    } else {
        let enrollment = enrollment_for_register(&cli)?;
        register_and_save(&path, &server_n, &display_name, &enrollment).await?
    };

    if freshly_registered {
        tracing::info!(
            "Зарегистрирован агент «{}» (id: {})\nУчётные данные: {}",
            state.name,
            state.agent_id,
            path.display()
        );
    } else {
        tracing::info!(
            "Подключение как «{}» (id: {}), {}",
            state.name,
            state.agent_id,
            path.display()
        );
    }

    client::run_loop(
        &state.server,
        &state.token,
        cli.heartbeat_secs,
        cli.poll_fallback_secs,
    )
    .await
}

fn enrollment_for_register(cli: &Cli) -> anyhow::Result<String> {
    let s = cli
        .enrollment_secret
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            anyhow::anyhow!(
                "нужен секрет регистрации: задайте INFRAHUB_ENROLLMENT_SECRET или --enrollment-secret"
            )
        })?;
    Ok(s)
}

async fn register_and_save(
    path: &std::path::Path,
    server: &str,
    name: &str,
    enrollment_secret: &str,
) -> anyhow::Result<(AgentState, bool)> {
    let cpu_arch = std::env::var("INFRAHUB_AGENT_CPU_ARCH")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let res = client::register(server, name, enrollment_secret, cpu_arch.as_deref()).await?;
    let state = AgentState {
        server: server.to_string(),
        agent_id: res.agent_id,
        token: res.token,
        name: name.to_string(),
    };
    state_file::save(path, &state)?;
    Ok((state, true))
}
