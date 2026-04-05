use std::convert::Infallible;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_stream::stream;
use axum::{
    extract::{Query, State},
    response::sse::{Event, KeepAlive, Sse},
};
use chrono::Utc;
use sea_orm::{EntityTrait, QueryOrder, QuerySelect};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::broadcast::error::RecvError;
use tokio::time::{interval, MissedTickBehavior};

use crate::{
    auth::parse_jwt,
    entity::{agents, tasks},
    error::ApiError,
    state::AppState,
};

/// Минимум секунд между `mark_stale_agents_db` на push-SSE (reconcile/initial всегда с пометкой).
const STALE_MARK_MIN_INTERVAL_SECS: u64 = 30;

static LAST_STALE_MARK_UNIX_SECS: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy)]
enum DashboardSnapshotReason {
    Initial,
    Reconcile,
    /// Явный push после мутаций.
    Update,
    /// Пропуск в broadcast — подстраховка как reconcile.
    Lagged,
}

#[derive(Deserialize)]
pub struct SseTokenQuery {
    pub token: String,
}

pub async fn sse_dashboard(
    Query(q): Query<SseTokenQuery>,
    State(state): State<AppState>,
) -> Result<Sse<impl futures::Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let _claims = parse_jwt(&q.token, &state.config.jwt_secret)?;
    let db = state.db.clone();
    let mut rx = state.dashboard_tx.subscribe();

    let s = stream! {
        let payload = snapshot_payload(&db, DashboardSnapshotReason::Initial).await;
        let data = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".into());
        tracing::debug!(bytes = data.len(), "sse dashboard initial snapshot");
        yield Ok(Event::default().event("reconcile").data(data));

        let mut reconcile = interval(Duration::from_secs(45));
        reconcile.set_missed_tick_behavior(MissedTickBehavior::Delay);
        reconcile.tick().await;

        loop {
            tokio::select! {
                _ = reconcile.tick() => {
                    let payload = snapshot_payload(&db, DashboardSnapshotReason::Reconcile).await;
                    let data = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".into());
                    tracing::debug!(bytes = data.len(), "sse dashboard reconcile tick");
                    yield Ok(Event::default().event("reconcile").data(data));
                }
                recv = rx.recv() => {
                    match recv {
                        Ok(()) => {
                            let payload = snapshot_payload(&db, DashboardSnapshotReason::Update).await;
                            let data = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".into());
                            tracing::debug!(bytes = data.len(), "sse dashboard update");
                            yield Ok(Event::default().event("update").data(data));
                        }
                        Err(RecvError::Lagged(_)) => {
                            let payload = snapshot_payload(&db, DashboardSnapshotReason::Lagged).await;
                            let data = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".into());
                            tracing::debug!(bytes = data.len(), "sse dashboard lagged → reconcile");
                            yield Ok(Event::default().event("reconcile").data(data));
                        }
                        Err(RecvError::Closed) => break,
                    }
                }
            }
        }
    };

    Ok(Sse::new(s).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keepalive"),
    ))
}

async fn snapshot_payload(
    db: &sea_orm::DatabaseConnection,
    reason: DashboardSnapshotReason,
) -> serde_json::Value {
    let run_stale = match reason {
        DashboardSnapshotReason::Initial
        | DashboardSnapshotReason::Reconcile
        | DashboardSnapshotReason::Lagged => true,
        DashboardSnapshotReason::Update => {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let prev = LAST_STALE_MARK_UNIX_SECS.load(Ordering::Relaxed);
            now.saturating_sub(prev) >= STALE_MARK_MIN_INTERVAL_SECS
        }
    };
    if run_stale {
        crate::handlers::mark_stale_agents_db(db).await;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        LAST_STALE_MARK_UNIX_SECS.store(now, Ordering::Relaxed);
    }

    let agents = match agents::Entity::find()
        .order_by_desc(agents::Column::CreatedAt)
        .limit(100)
        .all(db)
        .await
    {
        Ok(v) => v,
        Err(_) => return json!({ "error": "db", "ts": Utc::now() }),
    };

    let tasks = match tasks::Entity::find()
        .order_by_desc(tasks::Column::CreatedAt)
        .limit(80)
        .all(db)
        .await
    {
        Ok(v) => v,
        Err(_) => {
            return json!({
                "ts": Utc::now(),
                "agents": agents.iter().map(|a| json!({
                    "id": a.id, "name": a.name, "status": a.status, "last_seen_at": a.last_seen_at,
                    "cpu_arch": a.cpu_arch
                })).collect::<Vec<_>>(),
                "tasks": [],
            })
        }
    };

    json!({
        "ts": Utc::now(),
        "agents": agents.iter().map(|a| json!({
            "id": a.id, "name": a.name, "status": a.status, "last_seen_at": a.last_seen_at,
            "cpu_arch": a.cpu_arch
        })).collect::<Vec<_>>(),
        "tasks": tasks.iter().map(|t| json!({
            "id": t.id, "kind": t.kind, "status": t.status, "agent_id": t.agent_id, "created_at": t.created_at
        })).collect::<Vec<_>>(),
    })
}
