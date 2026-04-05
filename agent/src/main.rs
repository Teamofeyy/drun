#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod checks;
mod client;
mod state_file;

use std::path::PathBuf;

use clap::Parser;
use state_file::{normalize_server, AgentState};

/// Подключается к платформе: при первом запуске регистрируется и сохраняет токен локально.
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
                register_and_save(&path, &server_n, &display_name).await?
            }
        } else {
            register_and_save(&path, &server_n, &display_name).await?
        }
    } else {
        register_and_save(&path, &server_n, &display_name).await?
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

    client::run_loop(&state.server, &state.token, cli.heartbeat_secs).await
}

async fn register_and_save(
    path: &std::path::Path,
    server: &str,
    name: &str,
) -> anyhow::Result<(AgentState, bool)> {
    let res = client::register(server, name).await?;
    let state = AgentState {
        server: server.to_string(),
        agent_id: res.agent_id,
        token: res.token,
        name: name.to_string(),
    };
    state_file::save(path, &state)?;
    Ok((state, true))
}
