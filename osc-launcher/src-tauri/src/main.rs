#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::fs;
use std::net::UdpSocket;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use regex::Regex;
use rosc::encoder;
use rosc::{OscBundle, OscMessage, OscPacket, OscType};
use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::process::Command as TokioCommand;
use tokio::sync::Mutex;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mapping {
    pub id: Option<String>,
    pub name: Option<String>,
    pub address: String,
    pub action_type: Option<String>,
    pub filter: Option<String>,
    pub debounce_ms: Option<u64>,
    pub file: Option<String>,
    pub cwd: Option<String>,
    pub args: Option<String>,
    pub forward_osc_args: Option<bool>,
    pub target_process_name: Option<String>,
    pub target_mapping_key: Option<String>,
    pub actions: Option<Vec<SequenceStep>>,
    pub feedback_enabled: Option<bool>,
    pub feedback_host: Option<String>,
    pub feedback_port: Option<u16>,
    pub feedback_address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceStep {
    #[serde(rename = "type")]
    pub step_type: String,
    pub file: Option<String>,
    pub args: Option<String>,
    pub cwd: Option<String>,
    pub forward_osc_args: Option<bool>,
    pub delay_ms: Option<u64>,
    pub host: Option<String>,
    pub port: Option<serde_json::Value>,
    pub address: Option<String>,
    pub target_process_name: Option<String>,
    pub target_mapping_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Relay {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub port: u16,
    pub allowed_ips: String,
    pub start_minimized: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            port: 9000,
            allowed_ips: String::new(),
            start_minimized: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveProcessInfo {
    pub key: String,
    pub pid: u32,
    pub name: String,
    pub file: String,
    pub start_time: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLogEntry {
    pub id: String,
    pub timestamp: String,
    pub address: String,
    pub args: String,
    pub action_name: String,
    pub file: String,
    pub status: String,
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoreFile {
    pub profiles: HashMap<String, Vec<Mapping>>,
    pub active_profile: String,
    pub relays: Vec<Relay>,
    pub config: AppConfig,
}

impl Default for StoreFile {
    fn default() -> Self {
        let mut profiles = HashMap::new();
        profiles.insert("Default".to_string(), Vec::new());
        Self {
            profiles,
            active_profile: "Default".to_string(),
            relays: Vec::new(),
            config: AppConfig::default(),
        }
    }
}

pub struct AppState {
    pub store_path: PathBuf,
    pub profiles: Arc<Mutex<HashMap<String, Vec<Mapping>>>>,
    pub active_profile: Arc<Mutex<String>>,
    pub relays: Arc<Mutex<Vec<Relay>>>,
    pub config: Arc<Mutex<AppConfig>>,
    pub active_processes: Arc<Mutex<HashMap<String, ActiveProcessInfo>>>,
    pub last_trigger_times: Arc<Mutex<HashMap<String, u64>>>,
    pub is_listener_running: Arc<AtomicBool>,
    pub activity_logs: Arc<Mutex<Vec<ActivityLogEntry>>>,
}

fn get_config_dir() -> PathBuf {
    if let Some(mut dir) = dirs::data_dir() {
        dir.push("osc-launcher");
        let _ = fs::create_dir_all(&dir);
        dir
    } else {
        PathBuf::from(".")
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn matches_osc_pattern(pattern: &str, address: &str) -> bool {
    if pattern == address {
        return true;
    }
    let mut re_str = String::from("^");
    let mut chars = pattern.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '*' => re_str.push_str("[^/]*"),
            '?' => re_str.push_str("[^/]"),
            '{' => {
                let mut choices = String::new();
                for inner in chars.by_ref() {
                    if inner == '}' {
                        break;
                    }
                    choices.push(inner);
                }
                let parts: Vec<String> = choices
                    .split(',')
                    .map(|p| regex::escape(p))
                    .collect();
                re_str.push_str(&format!("({})", parts.join("|")));
            }
            '[' => {
                let mut set = String::new();
                for inner in chars.by_ref() {
                    if inner == ']' {
                        break;
                    }
                    set.push(inner);
                }
                if let Some(stripped) = set.strip_prefix('!') {
                    re_str.push_str(&format!("[^{}]", stripped));
                } else {
                    re_str.push_str(&format!("[{}]", set));
                }
            }
            c => {
                re_str.push_str(&regex::escape(&c.to_string()));
            }
        }
    }
    re_str.push('$');
    Regex::new(&re_str).map(|r| r.is_match(address)).unwrap_or(false)
}

fn send_osc_packet(host: &str, port: u16, address: &str, args: Vec<OscType>) -> bool {
    let socket = match UdpSocket::bind("0.0.0.0:0") {
        Ok(s) => s,
        Err(_) => return false,
    };
    let msg = OscMessage {
        addr: address.to_string(),
        args,
    };
    let packet = OscPacket::Message(msg);
    let buf = match encoder::encode(&packet) {
        Ok(b) => b,
        Err(_) => return false,
    };
    let dest = format!("{}:{}", host, port);
    socket.send_to(&buf, dest).is_ok()
}

fn send_feedback(hit: &Mapping, state: f32) {
    if hit.feedback_enabled.unwrap_or(false) {
        let host = hit.feedback_host.as_deref().unwrap_or("127.0.0.1");
        let port = hit.feedback_port.unwrap_or(9000);
        let default_addr = format!("{}/status", hit.address);
        let addr = hit.feedback_address.as_deref().unwrap_or(&default_addr);
        send_osc_packet(host, port, addr, vec![OscType::Float(state)]);
    }
}

async fn kill_process_by_pid(pid: u32) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let output = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            Err("Failed to kill process".to_string())
        }
    }
}

async fn kill_process_by_name(name: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("taskkill")
            .args(["/IM", name, "/T", "/F"])
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let output = Command::new("pkill")
            .args(["-f", name])
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            Err("Failed to kill process by name".to_string())
        }
    }
}

async fn spawn_command(
    file: &str,
    args: &[String],
    cwd: Option<&str>,
) -> Result<(u32, tokio::process::Child), String> {
    let path = Path::new(file);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    let mut cmd = if ext == "bat" || ext == "cmd" {
        let mut c = TokioCommand::new("cmd.exe");
        c.arg("/c").arg(file);
        for a in args {
            c.arg(a);
        }
        c
    } else if ext == "ps1" {
        let mut c = TokioCommand::new("powershell.exe");
        c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file]);
        for a in args {
            c.arg(a);
        }
        c
    } else {
        let mut c = TokioCommand::new(file);
        for a in args {
            c.arg(a);
        }
        c
    };

    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    if let Some(dir) = cwd.filter(|d| !d.trim().is_empty()) {
        cmd.current_dir(dir);
    } else if let Some(parent) = path.parent() {
        cmd.current_dir(parent);
    }

    let child = cmd.spawn().map_err(|e| e.to_string())?;
    let pid = child.id().ok_or_else(|| "Failed to obtain process PID".to_string())?;
    Ok((pid, child))
}

fn save_store(state: &AppState) {
    let store_path = state.store_path.clone();
    let profiles = state.profiles.clone();
    let active_profile = state.active_profile.clone();
    let relays = state.relays.clone();
    let config = state.config.clone();

    tauri::async_runtime::spawn(async move {
        let p = profiles.lock().await.clone();
        let ap = active_profile.lock().await.clone();
        let r = relays.lock().await.clone();
        let c = config.lock().await.clone();

        let data = StoreFile {
            profiles: p,
            active_profile: ap,
            relays: r,
            config: c,
        };

        if let Ok(json) = serde_json::to_string_pretty(&data) {
            // Atomic save via .tmp
            let tmp_path = store_path.with_extension("tmp");
            if fs::write(&tmp_path, &json).is_ok() {
                let _ = fs::rename(&tmp_path, &store_path);
            }

            // Rolling Show Backups (maintain last 10 in /backups)
            if let Some(parent) = store_path.parent() {
                let backup_dir = parent.join("backups");
                let _ = fs::create_dir_all(&backup_dir);
                let backup_file = backup_dir.join(format!(
                    "mappings_{}.json",
                    chrono::Local::now().format("%Y%m%d_%H%M%S")
                ));
                let _ = fs::write(&backup_file, &json);

                if let Ok(entries) = fs::read_dir(&backup_dir) {
                    let mut files: Vec<PathBuf> = entries
                        .filter_map(|e| e.ok().map(|e| e.path()))
                        .filter(|p| p.extension().map_or(false, |ext| ext == "json"))
                        .collect();
                    files.sort();
                    if files.len() > 10 {
                        for old in files.iter().take(files.len() - 10) {
                            let _ = fs::remove_file(old);
                        }
                    }
                }
            }
        }
    });
}

fn restore_from_latest_backup(store_path: &Path) -> Option<StoreFile> {
    let parent = store_path.parent()?;
    let backup_dir = parent.join("backups");
    if !backup_dir.exists() {
        return None;
    }
    let entries = fs::read_dir(&backup_dir).ok()?;
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().map_or(false, |ext| ext == "json"))
        .collect();
    files.sort();
    files.reverse();

    for backup in files {
        if let Ok(content) = fs::read_to_string(&backup) {
            if let Ok(store) = serde_json::from_str::<StoreFile>(&content) {
                eprintln!("[Recovery] Restored configuration from {:?}", backup);
                let _ = fs::write(store_path, &content);
                return Some(store);
            }
        }
    }
    None
}

async fn log_activity(
    app: &AppHandle,
    address: &str,
    args: &[serde_json::Value],
    action_name: &str,
    file: &str,
    status: &str,
    pid: Option<u32>,
) {
    let state = app.state::<AppState>();
    let formatted_args = if args.is_empty() {
        "-".to_string()
    } else {
        serde_json::to_string(args).unwrap_or_default()
    };

    let entry = ActivityLogEntry {
        id: format!("{}-{}", now_millis(), pid.unwrap_or(0)),
        timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
        address: address.to_string(),
        args: formatted_args,
        action_name: action_name.to_string(),
        file: file.to_string(),
        status: status.to_string(),
        pid,
    };

    let mut logs = state.activity_logs.lock().await;
    logs.push(entry.clone());
    if logs.len() > 100 {
        logs.remove(0);
    }
    let _ = app.emit("activity-log", entry);
}

// Event-driven IOCP UDP socket listener
fn start_osc_listener(app_handle: AppHandle, port: u16) {
    let state = app_handle.state::<AppState>();
    let is_running = state.is_listener_running.clone();
    is_running.store(true, Ordering::SeqCst);

    let app_handle_clone = app_handle.clone();

    tauri::async_runtime::spawn(async move {
        let socket = match tokio::net::UdpSocket::bind(format!("0.0.0.0:{}", port)).await {
            Ok(s) => Arc::new(s),
            Err(e) => {
                let _ = app_handle_clone.emit("osc-error", format!("Port {} error: {}", port, e));
                return;
            }
        };

        let mut buf = [0u8; 65535];

        while is_running.load(Ordering::SeqCst) {
            tokio::select! {
                res = socket.recv_from(&mut buf) => {
                    match res {
                        Ok((size, remote_addr)) => {
                            let state = app_handle_clone.state::<AppState>();
                            let allowed_ips = {
                                let c = state.config.lock().await;
                                c.allowed_ips.clone()
                            };

                            if !allowed_ips.trim().is_empty() {
                                let ip_str = remote_addr.ip().to_string();
                                let allowed: Vec<&str> = allowed_ips.split(',').map(|s| s.trim()).collect();
                                if !allowed.contains(&ip_str.as_str()) {
                                    continue;
                                }
                            }

                            if let Ok((_, packet)) = rosc::decoder::decode_udp(&buf[..size]) {
                                process_incoming_packet(&app_handle_clone, packet, &socket).await;
                            }
                        }
                        Err(e) => {
                            eprintln!("[OSC UDP Error]: {}", e);
                            tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                        }
                    }
                }
                _ = tokio::time::sleep(tokio::time::Duration::from_millis(250)) => {
                    if !is_running.load(Ordering::SeqCst) {
                        break;
                    }
                }
            }
        }
    });
}

async fn process_incoming_packet(
    app: &AppHandle,
    packet: OscPacket,
    socket: &Arc<tokio::net::UdpSocket>,
) {
    match packet {
        OscPacket::Message(msg) => {
            handle_osc_message(app, msg, socket).await;
        }
        OscPacket::Bundle(bundle) => {
            unpack_bundle(app, bundle, socket).await;
        }
    }
}

async fn unpack_bundle(app: &AppHandle, bundle: OscBundle, socket: &Arc<tokio::net::UdpSocket>) {
    for p in bundle.content {
        match p {
            OscPacket::Message(msg) => {
                handle_osc_message(app, msg, socket).await;
            }
            OscPacket::Bundle(b) => {
                Box::pin(unpack_bundle(app, b, socket)).await;
            }
        }
    }
}

async fn handle_osc_message(app: &AppHandle, msg: OscMessage, socket: &Arc<tokio::net::UdpSocket>) {
    let state = app.state::<AppState>();

    let formatted_args: Vec<serde_json::Value> = msg
        .args
        .iter()
        .map(|a| match a {
            OscType::Int(i) => serde_json::Value::from(*i),
            OscType::Float(f) => serde_json::Value::from(*f),
            OscType::String(s) => serde_json::Value::from(s.as_str()),
            OscType::Bool(b) => serde_json::Value::from(*b),
            _ => serde_json::Value::String(format!("{:?}", a)),
        })
        .collect();

    let _ = app.emit(
        "osc-packet",
        serde_json::json!({
            "address": msg.addr,
            "args": formatted_args,
            "time": chrono::Local::now().format("%H:%M:%S").to_string(),
        }),
    );

    // 1. Relays Forwarding
    {
        let relays = state.relays.lock().await.clone();
        for r in relays {
            if r.enabled {
                if let Ok(encoded) = encoder::encode(&OscPacket::Message(msg.clone())) {
                    let dest = format!("{}:{}", r.host, r.port);
                    let _ = socket.send_to(&encoded, &dest).await;
                }
            }
        }
    }

    // 2. Mappings lookup & pattern matching
    let mappings = {
        let active_prof = state.active_profile.lock().await.clone();
        let profiles = state.profiles.lock().await;
        profiles.get(&active_prof).cloned().unwrap_or_default()
    };

    let hits: Vec<Mapping> = mappings
        .into_iter()
        .filter(|m| matches_osc_pattern(&m.address, &msg.addr))
        .collect();

    for hit in hits {
        // Trigger condition check
        if hit.filter.as_deref() == Some("nonzero") {
            if let Some(first) = msg.args.first() {
                let val = match first {
                    OscType::Int(i) => *i as f32,
                    OscType::Float(f) => *f,
                    _ => 0.0,
                };
                if val <= 0.0 {
                    continue;
                }
            } else {
                continue;
            }
        }

        handle_mapping_trigger(app, hit, formatted_args.clone()).await;
    }
}

async fn handle_mapping_trigger(
    app: &AppHandle,
    hit: Mapping,
    osc_args: Vec<serde_json::Value>,
) {
    let state = app.state::<AppState>();
    let mapping_key = hit.id.clone().unwrap_or_else(|| hit.address.clone());

    // Debounce check
    if let Some(cooldown) = hit.debounce_ms.filter(|&c| c > 0) {
        let now = now_millis();
        let mut last_times = state.last_trigger_times.lock().await;
        if let Some(&last) = last_times.get(&mapping_key) {
            if now < last + cooldown {
                return;
            }
        }
        last_times.insert(mapping_key.clone(), now);
    }

    send_feedback(&hit, 1.0);

    let action_type = hit.action_type.as_deref().unwrap_or("launch");
    match action_type {
        "stop" => {
            if let Some(proc_name) = &hit.target_process_name {
                let _ = kill_process_by_name(proc_name).await;
            } else if let Some(target_key) = &hit.target_mapping_key {
                let mut procs = state.active_processes.lock().await;
                if let Some(proc) = procs.remove(target_key) {
                    let _ = kill_process_by_pid(proc.pid).await;
                    broadcast_active_processes(app, &procs);
                }
            }
            send_feedback(&hit, 0.0);
        }
        "toggle" => {
            let mut procs = state.active_processes.lock().await;
            if let Some(proc) = procs.remove(&mapping_key) {
                let _ = kill_process_by_pid(proc.pid).await;
                broadcast_active_processes(app, &procs);
                send_feedback(&hit, 0.0);
            } else if let Some(file) = &hit.file {
                drop(procs);
                let mut args = Vec::new();
                if let Some(custom) = &hit.args {
                    args.extend(custom.split_whitespace().map(String::from));
                }
                if hit.forward_osc_args.unwrap_or(false) {
                    args.extend(osc_args.iter().map(|v| v.to_string().trim_matches('"').to_string()));
                }
                if let Ok((pid, mut child)) = spawn_command(file, &args, hit.cwd.as_deref()).await {
                    let mut procs = state.active_processes.lock().await;
                    let file_name = Path::new(file)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(file)
                        .to_string();
                    procs.insert(
                        mapping_key.clone(),
                        ActiveProcessInfo {
                            key: file.clone(),
                            pid,
                            name: file_name.clone(),
                            file: file.clone(),
                            start_time: now_millis(),
                        },
                    );
                    broadcast_active_processes(app, &procs);

                    log_activity(
                        app,
                        &hit.address,
                        &osc_args,
                        hit.name.as_deref().unwrap_or(&file_name),
                        file,
                        &format!("Started (PID {})", pid),
                        Some(pid),
                    )
                    .await;

                    let app_clone = app.clone();
                    let mapping_key_clone = mapping_key.clone();
                    let hit_clone = hit.clone();
                    let action_label = hit.name.as_deref().unwrap_or(&file_name).to_string();
                    let file_path = file.clone();

                    tokio::spawn(async move {
                        let status = child.wait().await;
                        let (exit_code, status_str) = match status {
                            Ok(s) if s.success() => (0.0, "Finished (0)".to_string()),
                            Ok(s) => (-1.0, format!("Exited ({})", s.code().unwrap_or(-1))),
                            Err(e) => (-1.0, format!("Error: {}", e)),
                        };

                        let state = app_clone.state::<AppState>();
                        {
                            let mut p = state.active_processes.lock().await;
                            p.remove(&mapping_key_clone);
                            broadcast_active_processes(&app_clone, &p);
                        }

                        send_feedback(&hit_clone, exit_code);

                        log_activity(
                            &app_clone,
                            &hit_clone.address,
                            &[],
                            &action_label,
                            &file_path,
                            &status_str,
                            Some(pid),
                        )
                        .await;
                    });
                }
            }
        }
        "sequence" => {
            if let Some(steps) = &hit.actions {
                for step in steps {
                    match step.step_type.as_str() {
                        "delay" => {
                            let ms = step.delay_ms.unwrap_or(500);
                            tokio::time::sleep(tokio::time::Duration::from_millis(ms)).await;
                        }
                        "launch" => {
                            if let Some(file) = &step.file {
                                let mut args = Vec::new();
                                if let Some(custom) = &step.args {
                                    args.extend(custom.split_whitespace().map(String::from));
                                }
                                if step.forward_osc_args.unwrap_or(false) {
                                    args.extend(
                                        osc_args
                                            .iter()
                                            .map(|v| v.to_string().trim_matches('"').to_string()),
                                    );
                                }
                                if let Ok((_, mut child)) = spawn_command(file, &args, step.cwd.as_deref()).await {
                                    tokio::spawn(async move {
                                        let _ = child.wait().await;
                                    });
                                }
                            }
                        }
                        "osc" => {
                            if let Some(addr) = &step.address {
                                let host = step.host.as_deref().unwrap_or("127.0.0.1");
                                let port = step
                                    .port
                                    .as_ref()
                                    .and_then(|p| p.as_u64())
                                    .unwrap_or(7000) as u16;
                                let mut osc_types = Vec::new();
                                if let Some(arg) = &step.args {
                                    if let Ok(i) = arg.parse::<i32>() {
                                        osc_types.push(OscType::Int(i));
                                    } else if let Ok(f) = arg.parse::<f32>() {
                                        osc_types.push(OscType::Float(f));
                                    } else if !arg.is_empty() {
                                        osc_types.push(OscType::String(arg.clone()));
                                    }
                                }
                                send_osc_packet(host, port, addr, osc_types);
                            }
                        }
                        "stop" => {
                            if let Some(proc_name) = &step.target_process_name {
                                let _ = kill_process_by_name(proc_name).await;
                            }
                        }
                        _ => {}
                    }
                }
            }
            send_feedback(&hit, 0.0);
        }
        _ => {
            // standard launch
            if let Some(file) = &hit.file {
                let mut args = Vec::new();
                if let Some(custom) = &hit.args {
                    args.extend(custom.split_whitespace().map(String::from));
                }
                if hit.forward_osc_args.unwrap_or(false) {
                    args.extend(osc_args.iter().map(|v| v.to_string().trim_matches('"').to_string()));
                }
                if let Ok((pid, mut child)) = spawn_command(file, &args, hit.cwd.as_deref()).await {
                    let mut procs = state.active_processes.lock().await;
                    let file_name = Path::new(file)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(file)
                        .to_string();
                    procs.insert(
                        mapping_key.clone(),
                        ActiveProcessInfo {
                            key: file.clone(),
                            pid,
                            name: file_name.clone(),
                            file: file.clone(),
                            start_time: now_millis(),
                        },
                    );
                    broadcast_active_processes(app, &procs);

                    log_activity(
                        app,
                        &hit.address,
                        &osc_args,
                        hit.name.as_deref().unwrap_or(&file_name),
                        file,
                        &format!("Started (PID {})", pid),
                        Some(pid),
                    )
                    .await;

                    let app_clone = app.clone();
                    let mapping_key_clone = mapping_key.clone();
                    let hit_clone = hit.clone();
                    let action_label = hit.name.as_deref().unwrap_or(&file_name).to_string();
                    let file_path = file.clone();

                    tokio::spawn(async move {
                        let status = child.wait().await;
                        let (exit_code, status_str) = match status {
                            Ok(s) if s.success() => (0.0, "Finished (0)".to_string()),
                            Ok(s) => (-1.0, format!("Exited ({})", s.code().unwrap_or(-1))),
                            Err(e) => (-1.0, format!("Error: {}", e)),
                        };

                        let state = app_clone.state::<AppState>();
                        {
                            let mut p = state.active_processes.lock().await;
                            p.remove(&mapping_key_clone);
                            broadcast_active_processes(&app_clone, &p);
                        }

                        send_feedback(&hit_clone, exit_code);

                        log_activity(
                            &app_clone,
                            &hit_clone.address,
                            &[],
                            &action_label,
                            &file_path,
                            &status_str,
                            Some(pid),
                        )
                        .await;
                    });
                }
            }
        }
    }
}

fn broadcast_active_processes(
    app: &AppHandle,
    procs: &HashMap<String, ActiveProcessInfo>,
) {
    let list: Vec<ActiveProcessInfo> = procs.values().cloned().collect();
    let _ = app.emit("active-processes", list);
}

// Windows native autostart
fn is_autostart_enabled() -> bool {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("reg")
            .args(["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "OSC Launcher"])
            .output();
        output.map(|o| o.status.success()).unwrap_or(false)
    }
    #[cfg(not(target_os = "windows"))]
    false
}

fn set_autostart(enable: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if enable {
            let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let exe_str = current_exe.to_string_lossy().to_string();
            let value = format!("\"{}\" --minimized", exe_str);
            let output = Command::new("reg")
                .args([
                    "add",
                    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    "/v",
                    "OSC Launcher",
                    "/t",
                    "REG_SZ",
                    "/d",
                    &value,
                    "/f",
                ])
                .output()
                .map_err(|e| e.to_string())?;
            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).to_string());
            }
        } else {
            let _ = Command::new("reg")
                .args([
                    "delete",
                    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    "/v",
                    "OSC Launcher",
                    "/f",
                ])
                .output();
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    Ok(())
}

// Single-instance enforcement via local loopback port 42129
fn check_single_instance(app_handle: &AppHandle) -> bool {
    match UdpSocket::bind("127.0.0.1:42129") {
        Ok(socket) => {
            let handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let mut buf = [0u8; 32];
                while let Ok((size, _)) = socket.recv_from(&mut buf) {
                    if let Ok(cmd) = std::str::from_utf8(&buf[..size]) {
                        if cmd.trim() == "show" {
                            if let Some(w) = handle.get_webview_window("main") {
                                let _ = w.unminimize();
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                }
            });
            true
        }
        Err(_) => {
            if let Ok(client) = UdpSocket::bind("127.0.0.1:0") {
                let _ = client.send_to(b"show", "127.0.0.1:42129");
            }
            false
        }
    }
}

// TAURI IPC COMMANDS

#[tauri::command]
async fn get_mappings(state: State<'_, AppState>) -> Result<Vec<Mapping>, String> {
    let active = state.active_profile.lock().await.clone();
    let profiles = state.profiles.lock().await;
    Ok(profiles.get(&active).cloned().unwrap_or_default())
}

#[tauri::command]
async fn save_mappings(
    state: State<'_, AppState>,
    mappings: Vec<Mapping>,
) -> Result<bool, String> {
    let active = state.active_profile.lock().await.clone();
    {
        let mut profiles = state.profiles.lock().await;
        profiles.insert(active, mappings);
    }
    save_store(&state);
    Ok(true)
}

#[tauri::command]
async fn get_profiles(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let active = state.active_profile.lock().await.clone();
    let profiles = state.profiles.lock().await;
    let list: Vec<String> = profiles.keys().cloned().collect();
    Ok(serde_json::json!({
        "active": active,
        "list": list
    }))
}

#[tauri::command]
async fn switch_profile(
    state: State<'_, AppState>,
    name: String,
) -> Result<serde_json::Value, String> {
    let profiles = state.profiles.lock().await;
    if profiles.contains_key(&name) {
        let mut active = state.active_profile.lock().await;
        *active = name.clone();
        drop(profiles);
        drop(active);
        save_store(&state);
        let current_mappings = {
            let p = state.profiles.lock().await;
            p.get(&name).cloned().unwrap_or_default()
        };
        Ok(serde_json::json!({
            "ok": true,
            "active": name,
            "mappings": current_mappings
        }))
    } else {
        Err("Profile not found".to_string())
    }
}

#[tauri::command]
async fn create_profile(
    state: State<'_, AppState>,
    name: String,
) -> Result<serde_json::Value, String> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err("Profile name cannot be empty".to_string());
    }
    {
        let mut profiles = state.profiles.lock().await;
        if profiles.contains_key(&trimmed) {
            return Err("Profile already exists".to_string());
        }
        profiles.insert(trimmed.clone(), Vec::new());
        let mut active = state.active_profile.lock().await;
        *active = trimmed.clone();
    }
    save_store(&state);
    let profiles = state.profiles.lock().await;
    let list: Vec<String> = profiles.keys().cloned().collect();
    Ok(serde_json::json!({
        "ok": true,
        "active": trimmed,
        "list": list
    }))
}

#[tauri::command]
async fn delete_profile(
    state: State<'_, AppState>,
    name: String,
) -> Result<serde_json::Value, String> {
    let mut profiles = state.profiles.lock().await;
    if profiles.len() <= 1 {
        return Err("Cannot delete the only remaining profile".to_string());
    }
    profiles.remove(&name);
    let mut active = state.active_profile.lock().await;
    if *active == name {
        *active = profiles.keys().next().cloned().unwrap_or_else(|| "Default".to_string());
    }
    let new_active = active.clone();
    let current_mappings = profiles.get(&new_active).cloned().unwrap_or_default();
    drop(profiles);
    drop(active);
    save_store(&state);
    Ok(serde_json::json!({
        "ok": true,
        "active": new_active,
        "mappings": current_mappings
    }))
}

#[tauri::command]
async fn export_profile(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    use tauri_plugin_dialog::DialogExt;

    let active = state.active_profile.lock().await.clone();
    let mappings = {
        let p = state.profiles.lock().await;
        p.get(&active).cloned().unwrap_or_default()
    };
    let relays = state.relays.lock().await.clone();

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Export Profile")
        .set_file_name(&format!("OSC_Profile_{}.json", active))
        .add_filter("JSON Files", &["json"])
        .save_file(move |path| {
            let _ = tx.send(path);
        });

    if let Ok(Some(file_path)) = rx.await {
        let path_str = file_path.to_string();
        let data = serde_json::json!({
            "profileName": active,
            "exportedAt": chrono::Utc::now().to_rfc3339(),
            "mappings": mappings,
            "relays": relays
        });
        fs::write(&path_str, serde_json::to_string_pretty(&data).unwrap_or_default())
            .map_err(|e| e.to_string())?;
        Ok(serde_json::json!({ "ok": true, "filePath": path_str }))
    } else {
        Ok(serde_json::json!({ "ok": false }))
    }
}

#[tauri::command]
async fn import_profile(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Import Profile")
        .add_filter("JSON Files", &["json"])
        .pick_file(move |path| {
            let _ = tx.send(path);
        });

    if let Ok(Some(file_path)) = rx.await {
        let path_str = file_path.to_string();
        let content = fs::read_to_string(&path_str).map_err(|e| e.to_string())?;
        let parsed: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

        let profile_name = parsed["profileName"]
            .as_str()
            .map(|s| format!("{} (Imported)", s))
            .unwrap_or_else(|| format!("Imported_{}", now_millis()));

        let mappings: Vec<Mapping> = serde_json::from_value(parsed["mappings"].clone())
            .unwrap_or_default();

        {
            let mut profiles = state.profiles.lock().await;
            profiles.insert(profile_name.clone(), mappings.clone());
            let mut active = state.active_profile.lock().await;
            *active = profile_name.clone();
        }
        save_store(&state);

        Ok(serde_json::json!({
            "ok": true,
            "active": profile_name,
            "mappings": mappings
        }))
    } else {
        Ok(serde_json::json!({ "ok": false }))
    }
}

#[tauri::command]
async fn get_relays(state: State<'_, AppState>) -> Result<Vec<Relay>, String> {
    Ok(state.relays.lock().await.clone())
}

#[tauri::command]
async fn save_relays(
    state: State<'_, AppState>,
    relays: Vec<Relay>,
) -> Result<bool, String> {
    {
        let mut r = state.relays.lock().await;
        *r = relays;
    }
    save_store(&state);
    Ok(true)
}

#[tauri::command]
async fn get_config(state: State<'_, AppState>) -> Result<AppConfig, String> {
    Ok(state.config.lock().await.clone())
}

#[tauri::command]
async fn save_config(
    app: AppHandle,
    state: State<'_, AppState>,
    config: AppConfig,
) -> Result<serde_json::Value, String> {
    let port = config.port;
    {
        let mut c = state.config.lock().await;
        *c = config;
    }
    save_store(&state);

    // Restart listener on new port
    state.is_listener_running.store(false, Ordering::SeqCst);
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
    start_osc_listener(app, port);

    Ok(serde_json::json!({ "ok": true, "port": port }))
}

#[tauri::command]
async fn get_startup_settings(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let c = state.config.lock().await;
    let autostart = is_autostart_enabled();
    Ok(serde_json::json!({
        "openAtLogin": autostart,
        "startMinimized": c.start_minimized
    }))
}

#[tauri::command]
async fn set_startup_settings(
    state: State<'_, AppState>,
    open_at_login: Option<bool>,
    start_minimized: Option<bool>,
) -> Result<bool, String> {
    if let Some(open) = open_at_login {
        let _ = set_autostart(open);
    }
    if let Some(min) = start_minimized {
        let mut c = state.config.lock().await;
        c.start_minimized = min;
        save_store(&state);
    }
    Ok(true)
}

#[tauri::command]
async fn get_active_processes(
    state: State<'_, AppState>,
) -> Result<Vec<ActiveProcessInfo>, String> {
    let procs = state.active_processes.lock().await;
    Ok(procs.values().cloned().collect())
}

#[tauri::command]
async fn kill_process(
    app: AppHandle,
    state: State<'_, AppState>,
    pid: Option<u32>,
    name: Option<String>,
    key: Option<String>,
) -> Result<serde_json::Value, String> {
    if let Some(p) = pid {
        kill_process_by_pid(p).await?;
        let mut procs = state.active_processes.lock().await;
        procs.retain(|_, v| v.pid != p);
        broadcast_active_processes(&app, &procs);
        Ok(serde_json::json!({ "ok": true }))
    } else if let Some(n) = name {
        kill_process_by_name(&n).await?;
        Ok(serde_json::json!({ "ok": true }))
    } else if let Some(k) = key {
        let mut procs = state.active_processes.lock().await;
        if let Some(proc) = procs.remove(&k) {
            kill_process_by_pid(proc.pid).await?;
            broadcast_active_processes(&app, &procs);
        }
        Ok(serde_json::json!({ "ok": true }))
    } else {
        Err("No process identifier specified".to_string())
    }
}

#[tauri::command]
async fn test_command(
    file: String,
    args: Option<String>,
    cwd: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut cmd_args = Vec::new();
    if let Some(custom) = args {
        cmd_args.extend(custom.split_whitespace().map(String::from));
    }
    match spawn_command(&file, &cmd_args, cwd.as_deref()).await {
        Ok((pid, mut child)) => {
            tokio::spawn(async move {
                let _ = child.wait().await;
            });
            Ok(serde_json::json!({
                "ok": true,
                "pid": pid,
                "stillRunning": true,
                "stdout": format!("Process started with PID: {}", pid)
            }))
        }
        Err(e) => Ok(serde_json::json!({
            "ok": false,
            "errorMessage": e
        })),
    }
}

#[tauri::command]
async fn test_sequence(actions: Vec<SequenceStep>) -> Result<serde_json::Value, String> {
    for step in actions {
        match step.step_type.as_str() {
            "delay" => {
                let ms = step.delay_ms.unwrap_or(500);
                tokio::time::sleep(tokio::time::Duration::from_millis(ms)).await;
            }
            "launch" => {
                if let Some(file) = &step.file {
                    let mut args = Vec::new();
                    if let Some(custom) = &step.args {
                        args.extend(custom.split_whitespace().map(String::from));
                    }
                    if let Ok((_, mut child)) = spawn_command(file, &args, step.cwd.as_deref()).await {
                        tokio::spawn(async move {
                            let _ = child.wait().await;
                        });
                    }
                }
            }
            "osc" => {
                if let Some(addr) = &step.address {
                    let host = step.host.as_deref().unwrap_or("127.0.0.1");
                    let port = step.port.as_ref().and_then(|p| p.as_u64()).unwrap_or(7000) as u16;
                    let mut osc_types = Vec::new();
                    if let Some(arg) = &step.args {
                        if let Ok(i) = arg.parse::<i32>() {
                            osc_types.push(OscType::Int(i));
                        } else if let Ok(f) = arg.parse::<f32>() {
                            osc_types.push(OscType::Float(f));
                        } else if !arg.is_empty() {
                            osc_types.push(OscType::String(arg.clone()));
                        }
                    }
                    send_osc_packet(host, port, addr, osc_types);
                }
            }
            "stop" => {
                if let Some(proc_name) = &step.target_process_name {
                    let _ = kill_process_by_name(proc_name).await;
                }
            }
            _ => {}
        }
    }
    Ok(serde_json::json!({ "ok": true, "stdout": "Sequence test completed successfully" }))
}

#[tauri::command]
async fn open_file_dialog(
    app: AppHandle,
    directory: Option<bool>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = tokio::sync::oneshot::channel();
    if directory.unwrap_or(false) {
        app.dialog()
            .file()
            .set_title("Select Working Directory")
            .pick_folder(move |folder| {
                let _ = tx.send(folder.map(|f| f.to_string()));
            });
    } else {
        app.dialog()
            .file()
            .set_title("Select Executable or Script")
            .add_filter("Executables & Scripts", &["bat", "cmd", "exe", "ps1"])
            .add_filter("All Files", &["*"])
            .pick_file(move |file| {
                let _ = tx.send(file.map(|f| f.to_string()));
            });
    }

    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_config_location(state: State<'_, AppState>) -> Result<bool, String> {
    let p = state.store_path.clone();
    #[cfg(target_os = "windows")]
    {
        if p.exists() {
            let _ = Command::new("explorer.exe")
                .arg(format!("/select,{}", p.display()))
                .spawn();
        } else {
            let parent = p.parent().unwrap_or(&p);
            let _ = Command::new("explorer.exe").arg(parent).spawn();
        }
        Ok(true)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let parent = p.parent().unwrap_or(&p);
        let _ = Command::new("open").arg(parent).spawn();
        Ok(true)
    }
}

#[tauri::command]
async fn get_config_path(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.store_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn open_external_url(url: String) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("cmd").args(["/c", "start", "", &url]).spawn();
        Ok(true)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("open").arg(&url).spawn();
        Ok(true)
    }
}

#[tauri::command]
async fn get_activity_logs(state: State<'_, AppState>) -> Result<Vec<ActivityLogEntry>, String> {
    let logs = state.activity_logs.lock().await;
    Ok(logs.clone())
}

#[tauri::command]
async fn clear_activity_logs(state: State<'_, AppState>) -> Result<bool, String> {
    let mut logs = state.activity_logs.lock().await;
    logs.clear();
    Ok(true)
}

fn main() {
    let config_dir = get_config_dir();
    let store_path = config_dir.join("mappings.json");

    let initial_store: StoreFile = if store_path.exists() {
        match fs::read_to_string(&store_path) {
            Ok(data) => match serde_json::from_str::<StoreFile>(&data) {
                Ok(store) => store,
                Err(err) => {
                    eprintln!("[Store Error] Corrupted mappings.json: {}. Checking backups...", err);
                    restore_from_latest_backup(&store_path).unwrap_or_default()
                }
            },
            Err(_) => restore_from_latest_backup(&store_path).unwrap_or_default(),
        }
    } else {
        restore_from_latest_backup(&store_path).unwrap_or_default()
    };

    let initial_port = initial_store.config.port;
    let start_minimized = initial_store.config.start_minimized
        || std::env::args().any(|arg| arg == "--minimized");

    let app_state = AppState {
        store_path,
        profiles: Arc::new(Mutex::new(initial_store.profiles)),
        active_profile: Arc::new(Mutex::new(initial_store.active_profile)),
        relays: Arc::new(Mutex::new(initial_store.relays)),
        config: Arc::new(Mutex::new(initial_store.config)),
        active_processes: Arc::new(Mutex::new(HashMap::new())),
        last_trigger_times: Arc::new(Mutex::new(HashMap::new())),
        is_listener_running: Arc::new(AtomicBool::new(false)),
        activity_logs: Arc::new(Mutex::new(Vec::new())),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            tauri::WindowEvent::Resized(_) => {
                if window.is_minimized().unwrap_or(false) {
                    let _ = window.hide();
                }
            }
            _ => {}
        })
        .setup(move |app| {
            // Check single instance; if duplicate, signals existing window to show and exits
            if !check_single_instance(&app.handle()) {
                println!("[Single Instance] Application is already running. Focused existing window.");
                std::process::exit(0);
            }

            let handle = app.handle().clone();

            // Tray setup
            let show_i = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let icon = app
                .default_window_icon()
                .cloned()
                .or_else(|| {
                    tauri::image::Image::from_bytes(include_bytes!("../../assets/app-icon.ico")).ok()
                });

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("OSC Launcher")
                .show_menu_on_left_click(false);

            if let Some(ic) = icon {
                tray_builder = tray_builder.icon(ic);
            }

            let _tray = tray_builder
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let is_visible = w.is_visible().unwrap_or(true);
                            if is_visible && !w.is_minimized().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.unminimize();
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Start minimized if configured or passed via CLI
            if start_minimized {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            // Start UDP Listener
            start_osc_listener(handle, initial_port);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_mappings,
            save_mappings,
            get_profiles,
            switch_profile,
            create_profile,
            delete_profile,
            export_profile,
            import_profile,
            get_relays,
            save_relays,
            get_config,
            save_config,
            get_startup_settings,
            set_startup_settings,
            get_active_processes,
            kill_process,
            test_command,
            test_sequence,
            open_file_dialog,
            open_config_location,
            get_config_path,
            open_external_url,
            get_activity_logs,
            clear_activity_logs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_matches_osc_pattern_exact() {
        assert!(matches_osc_pattern("/cue/1/go", "/cue/1/go"));
        assert!(!matches_osc_pattern("/cue/1/go", "/cue/1/stop"));
        assert!(!matches_osc_pattern("/cue/1/go", "/cue/2/go"));
    }

    #[test]
    fn test_matches_osc_pattern_wildcards() {
        assert!(matches_osc_pattern("/cue/*/start", "/cue/1/start"));
        assert!(matches_osc_pattern("/cue/*/start", "/cue/media/start"));
        assert!(!matches_osc_pattern("/cue/*/start", "/cue/1/2/start"));

        assert!(matches_osc_pattern("/ch/?/mute", "/ch/1/mute"));
        assert!(matches_osc_pattern("/ch/?/mute", "/ch/A/mute"));
        assert!(!matches_osc_pattern("/ch/?/mute", "/ch/12/mute"));

        assert!(matches_osc_pattern("/deck/{A,B}/play", "/deck/A/play"));
        assert!(matches_osc_pattern("/deck/{A,B}/play", "/deck/B/play"));
        assert!(!matches_osc_pattern("/deck/{A,B}/play", "/deck/C/play"));

        assert!(matches_osc_pattern("/light/[1-4]", "/light/1"));
        assert!(matches_osc_pattern("/light/[1-4]", "/light/4"));
        assert!(!matches_osc_pattern("/light/[1-4]", "/light/5"));

        assert!(matches_osc_pattern("/slot/[!0-9]", "/slot/A"));
        assert!(!matches_osc_pattern("/slot/[!0-9]", "/slot/1"));
    }

    #[test]
    fn test_mapping_deserialization() {
        let json = r#"{
            "id": "map-1",
            "name": "Play Track",
            "address": "/track/1/play",
            "actionType": "launch",
            "file": "C:\\scripts\\play.bat",
            "args": "-v 100",
            "debounceMs": 250,
            "forwardOscArgs": true
        }"#;

        let mapping: Result<Mapping, _> = serde_json::from_str(json);
        assert!(mapping.is_ok());
        let m = mapping.unwrap();
        assert_eq!(m.id, Some("map-1".to_string()));
        assert_eq!(m.name, Some("Play Track".to_string()));
        assert_eq!(m.address, "/track/1/play");
        assert_eq!(m.action_type, Some("launch".to_string()));
        assert_eq!(m.file, Some("C:\\scripts\\play.bat".to_string()));
        assert_eq!(m.debounce_ms, Some(250));
        assert_eq!(m.forward_osc_args, Some(true));
    }

    #[test]
    fn test_sequence_step_deserialization() {
        let json = r#"[
            { "type": "delay", "delayMs": 1000 },
            { "type": "launch", "file": "test.bat", "args": "run", "forwardOscArgs": false },
            { "type": "osc", "host": "127.0.0.1", "port": 8000, "address": "/seq/done" },
            { "type": "stop", "targetProcessName": "notepad.exe" }
        ]"#;

        let steps: Result<Vec<SequenceStep>, _> = serde_json::from_str(json);
        assert!(steps.is_ok());
        let steps = steps.unwrap();
        assert_eq!(steps.len(), 4);
        assert_eq!(steps[0].step_type, "delay");
        assert_eq!(steps[0].delay_ms, Some(1000));
        assert_eq!(steps[1].step_type, "launch");
        assert_eq!(steps[2].step_type, "osc");
        assert_eq!(steps[2].address, Some("/seq/done".to_string()));
        assert_eq!(steps[3].step_type, "stop");
        assert_eq!(steps[3].target_process_name, Some("notepad.exe".to_string()));
    }

    #[test]
    fn test_app_config_defaults() {
        let cfg = AppConfig::default();
        assert_eq!(cfg.port, 9000);
        assert_eq!(cfg.allowed_ips, "");
        assert_eq!(cfg.start_minimized, false);
    }

    #[test]
    fn test_store_file_roundtrip() {
        let mut profiles = HashMap::new();
        profiles.insert(
            "Show1".to_string(),
            vec![Mapping {
                id: Some("1".to_string()),
                name: Some("Test".to_string()),
                address: "/test".to_string(),
                action_type: Some("launch".to_string()),
                filter: None,
                debounce_ms: Some(100),
                file: Some("echo.bat".to_string()),
                cwd: None,
                args: None,
                forward_osc_args: None,
                target_process_name: None,
                target_mapping_key: None,
                actions: None,
                feedback_enabled: Some(true),
                feedback_host: Some("127.0.0.1".to_string()),
                feedback_port: Some(9001),
                feedback_address: None,
            }],
        );

        let store = StoreFile {
            profiles,
            active_profile: "Show1".to_string(),
            relays: vec![Relay {
                id: "r1".to_string(),
                name: "Lighting".to_string(),
                host: "10.0.0.5".to_string(),
                port: 7000,
                enabled: true,
            }],
            config: AppConfig {
                port: 9005,
                allowed_ips: "127.0.0.1".to_string(),
                start_minimized: true,
            },
        };

        let serialized = serde_json::to_string(&store).expect("Failed to serialize store");
        let deserialized: StoreFile =
            serde_json::from_str(&serialized).expect("Failed to deserialize store");

        assert_eq!(deserialized.active_profile, "Show1");
        assert_eq!(deserialized.config.port, 9005);
        assert_eq!(deserialized.relays.len(), 1);
        assert_eq!(deserialized.relays[0].name, "Lighting");
        assert_eq!(deserialized.profiles.get("Show1").unwrap().len(), 1);
    }
}
