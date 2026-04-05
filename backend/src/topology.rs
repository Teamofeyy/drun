use axum::{extract::State, http::HeaderMap, Json};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

use crate::{
    entity::{agents, task_results, tasks},
    error::ApiError,
    handlers::mark_stale_agents_db,
    session::resolve_session,
    state::AppState,
};

const PLATFORM_ID: &str = "platform:infrahub";

pub async fn topology_graph(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let _ = resolve_session(&state, &headers).await?;
    mark_stale_agents_db(&state.db).await;

    let agent_rows = agents::Entity::find()
        .order_by_asc(agents::Column::Name)
        .all(&state.db)
        .await
        .map_err(|_| {
            ApiError::new(
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "database error",
            )
        })?;

    let running_rows = tasks::Entity::find()
        .filter(tasks::Column::Status.eq("running"))
        .all(&state.db)
        .await
        .map_err(|_| {
            ApiError::new(
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "database error",
            )
        })?;

    let mut running_by_agent: HashMap<uuid::Uuid, usize> = HashMap::new();
    for row in running_rows {
        *running_by_agent.entry(row.agent_id).or_insert(0) += 1;
    }

    let latest_system_info_rows: Vec<(task_results::Model, Option<tasks::Model>)> =
        task_results::Entity::find()
            .find_also_related(tasks::Entity)
            .filter(tasks::Column::Kind.eq("system_info"))
            .filter(tasks::Column::Status.eq("done"))
            .order_by_desc(task_results::Column::CreatedAt)
            .all(&state.db)
            .await
            .map_err(|_| {
                ApiError::new(
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    "database error",
                )
            })?;

    let mut latest_system_info_by_agent: HashMap<uuid::Uuid, serde_json::Value> = HashMap::new();
    for (result, task_opt) in latest_system_info_rows {
        let Some(task) = task_opt else {
            continue;
        };
        latest_system_info_by_agent
            .entry(task.agent_id)
            .or_insert(result.data);
    }

    let mut nodes: Vec<Value> = Vec::new();
    let mut edges: Vec<Value> = Vec::new();

    nodes.push(json!({
        "id": PLATFORM_ID,
        "label": "InfraHub",
        "type": "platform",
        "sub": "REST API · WebSocket агентов · SSE дашборда",
    }));

    let mut site_ids: HashSet<String> = HashSet::new();
    let mut segment_seen: HashSet<String> = HashSet::new();
    let mut probe_target_ids: HashSet<String> = HashSet::new();

    for a in &agent_rows {
        let aid = format!("agent:{}", a.id);
        let running = running_by_agent.get(&a.id).copied().unwrap_or(0);
        let agent_status = if a.status == "online" && running > 0 {
            "busy"
        } else {
            a.status.as_str()
        };
        let system_info = latest_system_info_by_agent.get(&a.id);
        let hostname = system_info
            .and_then(|data| data.get("hostname"))
            .and_then(|v| v.as_str());
        let os_long = system_info
            .and_then(|data| data.get("os_long"))
            .and_then(|v| v.as_str());
        let primary_ip = system_info
            .and_then(|data| data.get("all_ip_addresses"))
            .and_then(|v| v.as_array())
            .and_then(|items| items.first())
            .and_then(|v| v.as_str());

        nodes.push(json!({
            "id": aid,
            "label": a.name,
            "type": "agent",
            "agent_status": agent_status,
            "site": a.site,
            "segment": a.segment,
            "role_tag": a.role_tag,
            "hostname": hostname,
            "primary_ip": primary_ip,
            "os_long": os_long,
        }));

        edges.push(json!({
            "source": aid,
            "target": PLATFORM_ID,
            "kind": "control_plane",
            "category": "control_plane",
            "detail": format!(
                "status={agent_status}; WebSocket, редкий HTTP fallback к задачам, complete/fail"
            ),
        }));

        let s = a.site.trim();
        if !s.is_empty() {
            let sid = format!("site:{s}");
            if site_ids.insert(sid.clone()) {
                nodes.push(json!({
                    "id": sid,
                    "label": s,
                    "type": "site",
                    "sub": "логическая площадка",
                }));
            }
            edges.push(json!({
                "source": format!("agent:{}", a.id),
                "target": sid,
                "kind": "located_at",
                "category": "metadata",
                "detail": "группировка в UI",
            }));
        }
    }

    for a in &agent_rows {
        let seg = a.segment.trim();
        if seg.is_empty() {
            continue;
        }
        let gid = format!("segment:{seg}");
        if segment_seen.insert(gid.clone()) {
            nodes.push(json!({
                "id": gid,
                "label": seg,
                "type": "segment",
                "sub": "сегмент / команда",
            }));
        }
        edges.push(json!({
            "source": format!("agent:{}", a.id),
            "target": gid,
            "kind": "in_segment",
            "category": "metadata",
            "detail": "группировка в UI",
        }));
    }

    let probe_rows: Vec<(task_results::Model, Option<tasks::Model>)> = task_results::Entity::find()
        .find_also_related(tasks::Entity)
        .filter(tasks::Column::Kind.is_in(vec![
            "port_check".to_string(),
            "network_reachability".to_string(),
        ]))
        .filter(tasks::Column::Status.eq("done"))
        .order_by_desc(task_results::Column::CreatedAt)
        .limit(400)
        .all(&state.db)
        .await
        .map_err(|_| {
            ApiError::new(
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "database error",
            )
        })?;

    for (tr, t_opt) in probe_rows {
        let Some(t) = t_opt else {
            continue;
        };
        let agent_id = t.agent_id;
        let kind = t.kind.as_str();
        let data = &tr.data;
        let src = format!("agent:{agent_id}");

        if kind == "port_check" {
            if let Some(arr) = data.get("results").and_then(|x| x.as_array()) {
                for item in arr {
                    let label = item
                        .get("address_tried")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string())
                        .or_else(|| {
                            let h = item.get("host")?.as_str()?;
                            let p = item.get("port")?.as_u64()?;
                            Some(format!("{h}:{p}"))
                        });
                    if let Some(lbl) = label {
                        let tid = format!("target:{lbl}");
                        if probe_target_ids.insert(tid.clone()) {
                            nodes.push(json!({
                                "id": tid,
                                "label": lbl,
                                "type": "probe_target",
                                "sub": "цель из port_check",
                            }));
                        }
                        edges.push(json!({
                            "source": src,
                            "target": tid,
                            "kind": "tcp_probe",
                            "category": "observed_probe",
                            "detail": "проверка TCP с агента (не P2P между агентами)",
                        }));
                    }
                }
            }
        } else if kind == "network_reachability" {
            if let Some(arr) = data.get("results").and_then(|x| x.as_array()) {
                for item in arr {
                    if let Some(tgt) = item.get("target").and_then(|x| x.as_str()) {
                        let tid = format!("target:{tgt}");
                        if probe_target_ids.insert(tid.clone()) {
                            nodes.push(json!({
                                "id": tid,
                                "label": tgt,
                                "type": "probe_target",
                                "sub": "цель из network_reachability",
                            }));
                        }
                        edges.push(json!({
                            "source": src,
                            "target": tid,
                            "kind": "reachability_probe",
                            "category": "observed_probe",
                            "detail": "проверка связности с агента",
                        }));
                    }
                }
            }
        }
    }

    Ok(Json(json!({
        "nodes": nodes,
        "edges": edges,
        "legend": {
            "control_plane": "Агент ↔ платформа: единственный обязательный канал управления (HTTPS).",
            "metadata": "Площадка и сегмент — только метки для группировки, не сетевые линки.",
            "observed_probe": "Рёбра из отчётов проверок: куда агент стучался TCP (диагностика), не топология обмена между агентами."
        }
    })))
}
