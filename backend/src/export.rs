use std::io::BufWriter;
use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::Response,
};
use chrono::{DateTime, Utc};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::{
    entity::{agents, tasks},
    error::ApiError,
    session::resolve_session,
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct ExportQuery {
    #[serde(default = "default_format")]
    pub format: String,
}

fn default_format() -> String {
    "json".to_string()
}

#[derive(Debug, serde::Serialize)]
struct ExportRow {
    id: Uuid,
    agent_id: Uuid,
    agent_name: String,
    kind: String,
    status: String,
    created_at: DateTime<Utc>,
    completed_at: Option<DateTime<Utc>>,
    error_message: Option<String>,
}

pub async fn export_tasks(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<ExportQuery>,
) -> Result<Response, ApiError> {
    let _ = resolve_session(&state, &headers).await?;

    let task_rows = tasks::Entity::find()
        .order_by_desc(tasks::Column::CreatedAt)
        .limit(5000)
        .all(&state.db)
        .await
        .map_err(|e| {
            tracing::error!(%e, "export_tasks");
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error")
        })?;

    let agent_ids: std::collections::HashSet<Uuid> = task_rows.iter().map(|t| t.agent_id).collect();

    let agent_list = if agent_ids.is_empty() {
        Vec::new()
    } else {
        agents::Entity::find()
            .filter(agents::Column::Id.is_in(agent_ids.into_iter().collect::<Vec<_>>()))
            .all(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(%e, "export_tasks agents");
                ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "database error")
            })?
    };

    let names: std::collections::HashMap<Uuid, String> =
        agent_list.into_iter().map(|a| (a.id, a.name)).collect();

    let rows: Vec<ExportRow> = task_rows
        .into_iter()
        .map(|t| ExportRow {
            id: t.id,
            agent_id: t.agent_id,
            agent_name: names
                .get(&t.agent_id)
                .cloned()
                .unwrap_or_else(|| "(unknown)".to_string()),
            kind: t.kind,
            status: t.status,
            created_at: t.created_at,
            completed_at: t.completed_at,
            error_message: t.error_message,
        })
        .collect();

    let fmt = q.format.to_lowercase();
    match fmt.as_str() {
        "json" => Ok(json_export(&rows)),
        "csv" => Ok(csv_export(&rows)),
        "pdf" => pdf_export(&rows).map_err(|e| {
            tracing::error!(%e, "pdf_export");
            ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "pdf build failed")
        }),
        _ => Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "format must be json, csv or pdf",
        )),
    }
}

fn json_export(rows: &[ExportRow]) -> Response {
    let body = serde_json::to_vec(&json!({ "tasks": rows })).unwrap_or_else(|_| b"{}".to_vec());
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=\"infrahub-tasks.json\"",
        )
        .body(Body::from(body))
        .unwrap()
}

fn csv_export(rows: &[ExportRow]) -> Response {
    let mut w = csv::Writer::from_writer(vec![]);
    let _ = w.write_record([
        "id",
        "agent_id",
        "agent_name",
        "kind",
        "status",
        "created_at",
        "completed_at",
        "error_message",
    ]);
    for r in rows {
        let _ = w.serialize(r);
    }
    let buf = w.into_inner().unwrap_or_default();
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/csv; charset=utf-8")
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=\"infrahub-tasks.csv\"",
        )
        .body(Body::from(buf))
        .unwrap()
}

fn pdf_export(rows: &[ExportRow]) -> Result<Response, printpdf::Error> {
    use printpdf::*;

    let doc = PdfDocument::empty("InfraHub export");
    let font = doc.add_builtin_font(BuiltinFont::Helvetica)?;
    let font_bold = doc.add_builtin_font(BuiltinFont::HelveticaBold)?;

    let lines_per_page = 40usize;
    let mut idx = 0usize;
    while idx < rows.len() || idx == 0 {
        let (page, layer) = doc.add_page(Mm(210.0), Mm(297.0), "Layer");
        let layer = doc.get_page(page).get_layer(layer);
        let mut y = Mm(285.0);
        layer.begin_text_section();
        layer.set_font(&font_bold, 12.0);
        layer.set_text_cursor(Mm(15.0), y);
        layer.write_text("InfraHub — экспорт задач", &font_bold);
        layer.end_text_section();
        y = Mm(y.0 - 10.0);

        let chunk = rows.iter().skip(idx).take(lines_per_page);
        let mut count = 0usize;
        for r in chunk {
            let line = format!(
                "{} | {} | {} | {} | {}",
                r.id,
                &r.agent_name,
                r.kind,
                r.status,
                r.created_at.format("%Y-%m-%d %H:%M")
            );
            layer.begin_text_section();
            layer.set_font(&font, 7.0);
            layer.set_text_cursor(Mm(12.0), y);
            let truncated: String = line.chars().take(120).collect();
            layer.write_text(truncated.as_str(), &font);
            layer.end_text_section();
            y = Mm(y.0 - 4.0);
            count += 1;
        }
        idx += count;
        if count == 0 {
            break;
        }
    }

    let mut writer = BufWriter::new(Vec::new());
    doc.save(&mut writer)?;
    let buf = writer.into_inner().unwrap();

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/pdf")
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=\"infrahub-tasks.pdf\"",
        )
        .body(Body::from(buf))
        .unwrap())
}
