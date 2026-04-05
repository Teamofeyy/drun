use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::Message;
use redis::aio::ConnectionManager;
use sea_orm::DatabaseConnection;
use tokio::sync::{broadcast, mpsc, Notify, RwLock};
use uuid::Uuid;

use crate::config::Config;

#[derive(Clone, Default)]
pub struct AgentWsRegistry {
    inner: Arc<RwLock<HashMap<Uuid, mpsc::UnboundedSender<Message>>>>,
}

impl AgentWsRegistry {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn register(&self, agent_id: Uuid, tx: mpsc::UnboundedSender<Message>) {
        let mut g = self.inner.write().await;
        g.insert(agent_id, tx);
    }

    pub async fn unregister(&self, agent_id: Uuid) {
        let mut g = self.inner.write().await;
        g.remove(&agent_id);
    }

    pub async fn has_connection(&self, agent_id: Uuid) -> bool {
        self.inner.read().await.contains_key(&agent_id)
    }

    pub async fn send_text(&self, agent_id: Uuid, text: String) -> bool {
        let g = self.inner.read().await;
        let Some(tx) = g.get(&agent_id) else {
            return false;
        };
        tx.send(Message::Text(text.into())).is_ok()
    }
}

#[derive(Clone)]
pub struct AppState {
    pub db: DatabaseConnection,
    pub redis: ConnectionManager,
    pub config: Arc<Config>,
    pub dashboard_tx: broadcast::Sender<()>,
    /// Пробуждает фоновую задачу; реальный `send` в `dashboard_tx` после debounce.
    pub dashboard_wake: Arc<Notify>,
    pub agent_ws: AgentWsRegistry,
}

impl AppState {
    pub fn new(
        db: DatabaseConnection,
        redis: ConnectionManager,
        config: Arc<Config>,
        dashboard_tx: broadcast::Sender<()>,
        dashboard_wake: Arc<Notify>,
        agent_ws: AgentWsRegistry,
    ) -> Self {
        Self {
            db,
            redis,
            config,
            dashboard_tx,
            dashboard_wake,
            agent_ws,
        }
    }

    pub fn notify_dashboard(&self) {
        tracing::debug!("dashboard notify requested (coalesced → sse)");
        self.dashboard_wake.notify_one();
    }
}

/// Trailing debounce: после последнего `notify_one` ждём `debounce`, затем один `send` в broadcast.
pub fn spawn_dashboard_fanout_task(
    dashboard_tx: broadcast::Sender<()>,
    wake: Arc<Notify>,
    debounce: Duration,
) {
    tokio::spawn(async move {
        loop {
            wake.notified().await;
            loop {
                tokio::select! {
                    _ = tokio::time::sleep(debounce) => {
                        let _ = dashboard_tx.send(());
                        tracing::debug!("dashboard fan-out (coalesced send)");
                        break;
                    }
                    _ = wake.notified() => {}
                }
            }
        }
    });
}
