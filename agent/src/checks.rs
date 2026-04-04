use serde_json::{json, Value};
use std::time::Duration;
use sysinfo::{Networks, System};
use tokio::net::TcpStream;

#[derive(Debug, thiserror::Error)]
pub enum CheckError {
    #[error("unknown task kind: {0}")]
    UnknownKind(String),
    #[error("invalid payload: {0}")]
    BadPayload(String),
    #[error("unknown diagnostic scenario: {0}")]
    UnknownScenario(String),
}

pub struct CheckOutput {
    pub data: Value,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub exit_code: i32,
    pub logs: Vec<(String, String)>,
}

pub async fn run(kind: &str, payload: &Value) -> Result<CheckOutput, CheckError> {
    match kind {
        "system_info" => system_info(),
        "port_check" => port_check(payload).await,
        "diagnostic" => diagnostic(payload),
        "network_reachability" => network_reachability(payload).await,
        _ => Err(CheckError::UnknownKind(kind.into())),
    }
}

fn system_info() -> Result<CheckOutput, CheckError> {
    let mut sys = System::new_all();
    sys.refresh_all();

    let hn = hostname::get()
        .ok()
        .and_then(|s| s.into_string().ok())
        .unwrap_or_else(|| "(unknown)".into());

    let os = format!(
        "{} {}",
        System::name().unwrap_or_else(|| "unknown".into()),
        System::os_version().unwrap_or_else(|| "".into())
    );

    let mut networks = Networks::new_with_refreshed_list();
    networks.refresh();

    let mut ifaces = Vec::new();
    for (name, data) in networks.iter() {
        ifaces.push(json!({
            "name": name,
            "received": data.received(),
            "transmitted": data.transmitted(),
        }));
    }

    let data = json!({
        "hostname": hn,
        "os": os.trim(),
        "kernel": System::kernel_version(),
        "interfaces": ifaces,
    });

    Ok(CheckOutput {
        data,
        stdout: Some(hn),
        stderr: None,
        exit_code: 0,
        logs: vec![("info".into(), "collected system_info".into())],
    })
}

async fn port_check(payload: &Value) -> Result<CheckOutput, CheckError> {
    let targets = payload
        .get("targets")
        .and_then(|v| v.as_array())
        .ok_or_else(|| CheckError::BadPayload("expected targets[]".into()))?;

    let mut results = Vec::new();
    for t in targets {
        let host = t
            .get("host")
            .and_then(|v| v.as_str())
            .ok_or_else(|| CheckError::BadPayload("target.host".into()))?;
        let port = t
            .get("port")
            .and_then(|v| v.as_u64())
            .or_else(|| t.get("port").and_then(|v| v.as_i64()).map(|x| x as u64))
            .ok_or_else(|| CheckError::BadPayload("target.port".into()))? as u16;

        let addr = format!("{}:{}", host, port);
        let ok = match tokio::time::timeout(Duration::from_secs(3), TcpStream::connect(&addr)).await {
            Ok(Ok(_)) => true,
            _ => false,
        };

        results.push(json!({ "host": host, "port": port, "open": ok }));
    }

    Ok(CheckOutput {
        data: json!({ "results": results }),
        stdout: Some(serde_json::to_string_pretty(&results).unwrap_or_default()),
        stderr: None,
        exit_code: 0,
        logs: vec![("info".into(), "port_check done".into())],
    })
}

fn diagnostic(payload: &Value) -> Result<CheckOutput, CheckError> {
    let scenario = payload
        .get("scenario")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CheckError::BadPayload("scenario required".into()))?;

    match scenario {
        "uname" => {
            let mut sys = System::new_all();
            sys.refresh_all();
            let line = format!(
                "{} {} {}",
                System::name().unwrap_or_else(|| "OS".into()),
                System::kernel_version().unwrap_or_else(|| "?".into()),
                System::os_version().unwrap_or_else(|| "".into())
            );
            Ok(CheckOutput {
                data: json!({ "scenario": "uname", "line": line }),
                stdout: Some(line),
                stderr: None,
                exit_code: 0,
                logs: vec![("info".into(), "diagnostic uname".into())],
            })
        }
        "hostname" => {
            let hn = hostname::get()
                .ok()
                .and_then(|s| s.into_string().ok())
                .unwrap_or_else(|| "(unknown)".into());
            Ok(CheckOutput {
                data: json!({ "scenario": "hostname", "hostname": hn }),
                stdout: Some(hn.clone()),
                stderr: None,
                exit_code: 0,
                logs: vec![("info".into(), "diagnostic hostname".into())],
            })
        }
        "interfaces_summary" => {
            let mut networks = Networks::new_with_refreshed_list();
            networks.refresh();
            let names: Vec<_> = networks.iter().map(|(n, _)| n.clone()).collect();
            Ok(CheckOutput {
                data: json!({ "scenario": "interfaces_summary", "names": names }),
                stdout: Some(names.join(", ")),
                stderr: None,
                exit_code: 0,
                logs: vec![("info".into(), "interfaces_summary".into())],
            })
        }
        _ => Err(CheckError::UnknownScenario(scenario.into())),
    }
}

async fn network_reachability(payload: &Value) -> Result<CheckOutput, CheckError> {
    let targets = payload
        .get("targets")
        .and_then(|v| v.as_array())
        .ok_or_else(|| CheckError::BadPayload("expected targets[] of host:port strings".into()))?;

    let mut out = Vec::new();
    for t in targets {
        let s = t.as_str().ok_or_else(|| CheckError::BadPayload("target string".into()))?;
        let ok = match tokio::time::timeout(Duration::from_secs(3), TcpStream::connect(s)).await {
            Ok(Ok(_)) => true,
            _ => false,
        };
        out.push(json!({ "target": s, "reachable": ok }));
    }

    Ok(CheckOutput {
        data: json!({ "results": out }),
        stdout: None,
        stderr: None,
        exit_code: 0,
        logs: vec![("info".into(), "network_reachability".into())],
    })
}
