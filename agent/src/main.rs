mod checks;
mod client;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "infrahub-agent")]
#[command(about = "InfraHub diagnostic agent (whitelist checks only)")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Register with server and print credentials (save token securely)
    Register {
        #[arg(long, default_value = "http://127.0.0.1:8080")]
        server: String,
        #[arg(long)]
        name: String,
    },
    /// Run heartbeat + task loop
    Run {
        #[arg(long, default_value = "http://127.0.0.1:8080")]
        server: String,
        #[arg(long)]
        token: String,
        #[arg(long, default_value = "10")]
        heartbeat_secs: u64,
    },
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
    match cli.command {
        Commands::Register { server, name } => {
            let res = client::register(&server, &name).await?;
            println!("agent_id: {}", res.agent_id);
            println!("token: {}", res.token);
            println!("\nSave the token. Run:\n  infrahub-agent run --server {} --token <token>", server);
        }
        Commands::Run {
            server,
            token,
            heartbeat_secs,
        } => {
            client::run_loop(&server, &token, heartbeat_secs).await?;
        }
    }
    Ok(())
}
