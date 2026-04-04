use std::net::SocketAddr;
use std::time::Instant;

use serde_json::{json, Value};
use sysinfo::{Disks, Networks, System};
use tokio::net::{lookup_host, TcpStream};

#[derive(Debug, thiserror::Error)]
pub enum CheckError {
    #[error("unknown task kind: {0}")]
    UnknownKind(String),
    #[error("invalid payload: {0}")]
    BadPayload(String),
    #[error("unknown diagnostic scenario: {0}")]
    UnknownScenario(String),
    #[error("unknown bundle template: {0}")]
    UnknownTemplate(String),
}

pub struct CheckOutput {
    pub data: Value,
    pub stdout: Option<String>,
    pub stderr: Option<String>,
    pub exit_code: i32,
    pub logs: Vec<(String, String)>,
    pub summary: String,
}

pub async fn run(kind: &str, payload: &Value) -> Result<CheckOutput, CheckError> {
    let mut out = match kind {
        "system_info" => system_info()?,
        "port_check" => port_check(payload).await?,
        "diagnostic" => diagnostic(payload).await?,
        "network_reachability" => network_reachability(payload).await?,
        "check_bundle" => check_bundle(payload).await?,
        _ => return Err(CheckError::UnknownKind(kind.into())),
    };
    if out.summary.is_empty() {
        out.summary = autosummary(kind, &out.data);
    }
    Ok(out)
}

fn autosummary(kind: &str, data: &Value) -> String {
    match kind {
        "system_info" => data
            .get("hostname")
            .and_then(|v| v.as_str())
            .map(|h| {
                format!(
                    "Узел {h}, {}",
                    data.get("os_long").and_then(|v| v.as_str()).unwrap_or("")
                )
            })
            .unwrap_or_else(|| "Сводка по системе".into()),
        "port_check" => {
            let n = data
                .get("results")
                .and_then(|r| r.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            let open = data
                .get("results")
                .and_then(|r| r.as_array())
                .map(|a| {
                    a.iter()
                        .filter(|x| x.get("open").and_then(|v| v.as_bool()) == Some(true))
                        .count()
                })
                .unwrap_or(0);
            format!("Проверено портов: {n}, доступно TCP: {open}")
        }
        "network_reachability" => {
            let n = data
                .get("results")
                .and_then(|r| r.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            let ok = data
                .get("results")
                .and_then(|r| r.as_array())
                .map(|a| {
                    a.iter()
                        .filter(|x| x.get("reachable").and_then(|v| v.as_bool()) == Some(true))
                        .count()
                })
                .unwrap_or(0);
            format!("Целей: {n}, доступно: {ok}")
        }
        "diagnostic" => data
            .get("line")
            .or_else(|| data.get("hostname"))
            .and_then(|v| v.as_str())
            .map(|s| s.chars().take(120).collect())
            .unwrap_or_else(|| "Диагностика".into()),
        "check_bundle" => data
            .get("template")
            .and_then(|v| v.as_str())
            .map(|t| format!("Шаблон «{t}»"))
            .unwrap_or_else(|| "Комплексная проверка".into()),
        _ => "Готово".into(),
    }
}

fn system_info() -> Result<CheckOutput, CheckError> {
    let mut sys = System::new_all();
    sys.refresh_all();

    let hn = hostname::get()
        .ok()
        .and_then(|s| s.into_string().ok())
        .unwrap_or_else(|| "(unknown)".into());

    let os_name = System::name().unwrap_or_else(|| "unknown".into());
    let os_ver = System::os_version().unwrap_or_else(|| "".into());
    let os_long = format!("{os_name} {os_ver}").trim().to_string();
    let kernel = System::kernel_version();
    let arch = System::cpu_arch();
    let host = System::host_name();

    let cpus: Vec<Value> = sys
        .cpus()
        .iter()
        .take(64)
        .map(|c| {
            json!({
                "name": c.name(),
                "frequency_mhz": c.frequency(),
                "usage_percent": c.cpu_usage() as f64,
            })
        })
        .collect();

    let mut networks = Networks::new_with_refreshed_list();
    networks.refresh();

    let mut ifaces_traffic: Vec<Value> = Vec::new();
    for (iface_name, net) in networks.iter() {
        ifaces_traffic.push(json!({
            "name": iface_name,
            "received_bytes": net.received(),
            "transmitted_bytes": net.transmitted(),
            "packets_received": net.packets_received(),
            "packets_transmitted": net.packets_transmitted(),
            "errors_on_received": net.errors_on_received(),
            "errors_on_transmitted": net.errors_on_transmitted(),
        }));
    }

    let mut ip_by_iface: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    if let Ok(list) = if_addrs::get_if_addrs() {
        for ifa in list {
            let ip = ifa.addr.ip();
            if ip.is_unspecified() {
                continue;
            }
            ip_by_iface
                .entry(ifa.name.clone())
                .or_default()
                .push(format!("{ip}"));
        }
    }

    let mut interfaces: Vec<Value> = Vec::new();
    for t in &ifaces_traffic {
        let name = t.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let ips = ip_by_iface.get(name).cloned().unwrap_or_default();
        let mut row = t.clone();
        if let Some(obj) = row.as_object_mut() {
            obj.insert("ip_addresses".into(), json!(ips));
        }
        interfaces.push(row);
    }

    let all_ips: Vec<String> = ip_by_iface.values().flatten().cloned().collect();

    let disks = Disks::new_with_refreshed_list();
    let mut mounts: Vec<Value> = Vec::new();
    for d in disks.list() {
        mounts.push(json!({
            "name": d.name().to_string_lossy(),
            "mount_point": d.mount_point().to_string_lossy(),
            "file_system": d.file_system().to_string_lossy(),
            "total_bytes": d.total_space(),
            "available_bytes": d.available_space(),
        }));
    }

    let data = json!({
        "hostname": hn,
        "host_name_sys": host,
        "os_long": os_long,
        "kernel": kernel,
        "cpu_arch": arch,
        "cpus_logical": sys.cpus().len(),
        "memory_total_bytes": sys.total_memory(),
        "memory_used_bytes": sys.used_memory(),
        "memory_available_bytes": sys.available_memory(),
        "swap_total_bytes": sys.total_swap(),
        "swap_used_bytes": sys.used_swap(),
        "cpus": cpus,
        "all_ip_addresses": all_ips,
        "interfaces": interfaces,
        "disk_mounts": mounts,
    });

    let summary = format!(
        "{hn}: {os_long}, RAM {} / {} MiB, интерфейсов с IP: {}",
        sys.used_memory() / 1024 / 1024,
        sys.total_memory() / 1024 / 1024,
        ip_by_iface.len()
    );

    Ok(CheckOutput {
        data,
        stdout: Some(hn.clone()),
        stderr: None,
        exit_code: 0,
        logs: vec![(
            "info".into(),
            "system_info: hostname, IPs, interfaces, OS, CPU, RAM, disks".into(),
        )],
        summary,
    })
}

async fn port_check(payload: &Value) -> Result<CheckOutput, CheckError> {
    let targets = payload
        .get("targets")
        .and_then(|v| v.as_array())
        .ok_or_else(|| CheckError::BadPayload("expected targets[]".into()))?;

    let timeout_secs = payload
        .get("timeout_secs")
        .and_then(|v| v.as_u64())
        .unwrap_or(5)
        .clamp(1, 60);

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

        let addr = format!("{host}:{port}");
        let started = Instant::now();
        let mut resolved: Vec<String> = Vec::new();
        if let Ok(mut it) = lookup_host((host, port)).await {
            for sa in it.by_ref().take(8) {
                resolved.push(sa.to_string());
            }
        }

        let connect_res = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            TcpStream::connect(&addr),
        )
        .await;

        let (open, error, rtt_ms) = match connect_res {
            Ok(Ok(_)) => (true, None, Some(started.elapsed().as_secs_f64() * 1000.0)),
            Ok(Err(e)) => (
                false,
                Some(format!("tcp: {e}")),
                Some(started.elapsed().as_secs_f64() * 1000.0),
            ),
            Err(_) => (false, Some("timeout".into()), None),
        };

        results.push(json!({
            "host": host,
            "port": port,
            "address_tried": addr,
            "open": open,
            "connect_time_ms": rtt_ms,
            "error": error,
            "resolved_endpoints": resolved,
        }));
    }

    let open_n = results
        .iter()
        .filter(|r| r.get("open").and_then(|v| v.as_bool()) == Some(true))
        .count();

    Ok(CheckOutput {
        data: json!({ "results": results, "timeout_secs": timeout_secs }),
        stdout: Some(format!("{open_n}/{} портов отвечают TCP", results.len())),
        stderr: None,
        exit_code: 0,
        logs: vec![("info".into(), "port_check with timing and DNS".into())],
        summary: format!("Портов проверено: {}, TCP OK: {open_n}", results.len()),
    })
}

async fn diagnostic(payload: &Value) -> Result<CheckOutput, CheckError> {
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
                stdout: Some(line.clone()),
                stderr: None,
                exit_code: 0,
                logs: vec![("info".into(), "diagnostic uname".into())],
                summary: line.chars().take(100).collect(),
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
                summary: format!("Hostname: {hn}"),
            })
        }
        "interfaces_summary" => {
            let mut networks = Networks::new_with_refreshed_list();
            networks.refresh();
            let names: Vec<String> = networks.keys().cloned().collect();
            Ok(CheckOutput {
                data: json!({ "scenario": "interfaces_summary", "names": names }),
                stdout: Some(names.join(", ")),
                stderr: None,
                exit_code: 0,
                logs: vec![("info".into(), "interfaces_summary".into())],
                summary: format!("Интерфейсов: {}", names.len()),
            })
        }
        "memory_disks" => {
            let mut sys = System::new_all();
            sys.refresh_memory();
            let disks = Disks::new_with_refreshed_list();
            let mounts: Vec<Value> = disks
                .list()
                .iter()
                .map(|d| {
                    json!({
                        "mount": d.mount_point().to_string_lossy(),
                        "total_gb": (d.total_space() as f64 / 1e9),
                        "avail_gb": (d.available_space() as f64 / 1e9),
                    })
                })
                .collect();
            let data = json!({
                "scenario": "memory_disks",
                "ram_total_mb": sys.total_memory() / 1024 / 1024,
                "ram_used_mb": sys.used_memory() / 1024 / 1024,
                "swap_total_mb": sys.total_swap() / 1024 / 1024,
                "swap_used_mb": sys.used_swap() / 1024 / 1024,
                "disk_mounts": mounts,
            });
            Ok(CheckOutput {
                data: data.clone(),
                stdout: None,
                stderr: None,
                exit_code: 0,
                logs: vec![("info".into(), "memory_disks".into())],
                summary: format!(
                    "RAM {} / {} MiB",
                    sys.used_memory() / 1024 / 1024,
                    sys.total_memory() / 1024 / 1024
                ),
            })
        }
        "cpu_load" => {
            let mut sys = System::new_all();
            sys.refresh_cpu_usage();
            let usage: Vec<Value> = sys
                .cpus()
                .iter()
                .enumerate()
                .map(|(i, c)| json!({ "cpu": i, "usage_percent": c.cpu_usage() as f64 }))
                .collect();
            let global = sys.global_cpu_usage();
            Ok(CheckOutput {
                data: json!({ "scenario": "cpu_load", "global_usage_percent": global, "per_cpu": usage }),
                stdout: Some(format!("CPU load global: {global:.1}%")),
                stderr: None,
                exit_code: 0,
                logs: vec![("info".into(), "cpu_load".into())],
                summary: format!("Загрузка CPU: {global:.1}%"),
            })
        }
        "dns_lookup" => {
            let host = payload
                .get("host")
                .and_then(|v| v.as_str())
                .ok_or_else(|| CheckError::BadPayload("dns_lookup needs host".into()))?;
            let mut resolved: Vec<String> = Vec::new();
            if let Ok(s) = lookup_host((host, 0)).await {
                for sa in s.take(16) {
                    match sa {
                        SocketAddr::V4(a) => resolved.push(a.ip().to_string()),
                        SocketAddr::V6(a) => resolved.push(a.ip().to_string()),
                    }
                }
            }
            Ok(CheckOutput {
                data: json!({ "scenario": "dns_lookup", "query": host, "addresses": resolved }),
                stdout: Some(resolved.join(", ")),
                stderr: None,
                exit_code: 0,
                logs: vec![("info".into(), "dns_lookup".into())],
                summary: format!("DNS {host}: {} адр.", resolved.len()),
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

    let timeout_secs = payload
        .get("timeout_secs")
        .and_then(|v| v.as_u64())
        .unwrap_or(5)
        .clamp(1, 60);

    let mut out = Vec::new();
    for t in targets {
        let s = t
            .as_str()
            .ok_or_else(|| CheckError::BadPayload("target string".into()))?;
        let started = Instant::now();

        let host_part = s.rsplit_once(':').map(|(h, _)| h).unwrap_or(s);
        let mut dns: Vec<String> = Vec::new();
        if let Ok(mut it) = lookup_host(host_part).await {
            for sa in it.by_ref().take(8) {
                dns.push(sa.to_string());
            }
        }

        let res = tokio::time::timeout(
            std::time::Duration::from_secs(timeout_secs),
            TcpStream::connect(s),
        )
        .await;

        let (reachable, err, ms) = match res {
            Ok(Ok(_)) => (true, None, Some(started.elapsed().as_secs_f64() * 1000.0)),
            Ok(Err(e)) => (
                false,
                Some(format!("{e}")),
                Some(started.elapsed().as_secs_f64() * 1000.0),
            ),
            Err(_) => (false, Some("timeout".into()), None),
        };

        out.push(json!({
            "target": s,
            "reachable": reachable,
            "connect_time_ms": ms,
            "error": err,
            "dns_sample": dns,
        }));
    }

    let ok = out
        .iter()
        .filter(|r| r.get("reachable").and_then(|v| v.as_bool()) == Some(true))
        .count();

    Ok(CheckOutput {
        data: json!({ "results": out, "timeout_secs": timeout_secs }),
        stdout: None,
        stderr: None,
        exit_code: 0,
        logs: vec![("info".into(), "network_reachability + dns".into())],
        summary: format!("Доступно {ok} из {}", out.len()),
    })
}

async fn check_bundle(payload: &Value) -> Result<CheckOutput, CheckError> {
    let template = payload
        .get("template")
        .and_then(|v| v.as_str())
        .ok_or_else(|| CheckError::BadPayload("template required".into()))?;

    match template {
        "node_baseline" => {
            let sys = system_info()?;
            let mem = diagnostic(&json!({ "scenario": "memory_disks" })).await?;
            let cpu = diagnostic(&json!({ "scenario": "cpu_load" })).await?;
            let uname = diagnostic(&json!({ "scenario": "uname" })).await?;
            let data = json!({
                "template": "node_baseline",
                "description": "Базовая диагностика узла: система, ресурсы, CPU",
                "system_info": sys.data,
                "memory_disks": mem.data,
                "cpu_load": cpu.data,
                "uname": uname.data,
            });
            let summary = format!(
                "Базовая диагностика: {} · RAM {} MiB свободно не считаем здесь",
                sys.summary,
                mem.data
                    .get("ram_used_mb")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0)
            );
            let mut logs = sys.logs;
            logs.extend(mem.logs);
            logs.extend(cpu.logs);
            logs.extend(uname.logs);
            Ok(CheckOutput {
                data,
                stdout: Some(uname.stdout.unwrap_or_default()),
                stderr: None,
                exit_code: 0,
                logs,
                summary,
            })
        }
        "network_context" => {
            let targets: Vec<Value> = vec![
                json!("1.1.1.1:443"),
                json!("8.8.8.8:53"),
                json!("127.0.0.1:8080"),
            ];
            let reach = network_reachability(&json!({ "targets": targets })).await?;
            let dns_cf = diagnostic(&json!({ "scenario": "dns_lookup", "host": "cloudflare.com" }))
                .await
                .ok();
            let mut parts = json!({
                "template": "network_context",
                "description": "Сетевой контекст: DNS + доступность типовых точек",
                "reachability": reach.data,
            });
            if let Some(d) = dns_cf {
                if let Some(obj) = parts.as_object_mut() {
                    obj.insert("dns_cloudflare".into(), d.data);
                }
            }
            Ok(CheckOutput {
                data: parts,
                stdout: reach.stdout,
                stderr: None,
                exit_code: 0,
                logs: reach.logs,
                summary: format!("Сеть: {}", reach.summary),
            })
        }
        "internal_services_check" => {
            let targets = vec![
                json!({ "host": "127.0.0.1", "port": 8080 }),
                json!({ "host": "127.0.0.1", "port": 5432 }),
                json!({ "host": "127.0.0.1", "port": 6379 }),
            ];
            let ports = port_check(&json!({ "targets": targets, "timeout_secs": 3 })).await?;
            let data = json!({
                "template": "internal_services_check",
                "description": "Проверка типичных локальных сервисов (HTTP API, Postgres, Redis)",
                "port_check": ports.data,
            });
            Ok(CheckOutput {
                data,
                stdout: ports.stdout,
                stderr: None,
                exit_code: 0,
                logs: ports.logs,
                summary: ports.summary,
            })
        }
        _ => Err(CheckError::UnknownTemplate(template.into())),
    }
}
