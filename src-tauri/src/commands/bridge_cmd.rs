//! 双 AI 桥接服务器管理命令
//!
//! 提供多端口启动/停止/状态查询的 IPC 命令

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{json, Value};
use tauri::State;

use crate::bridge::BridgeState;

/// 桥接服务器状态（多端口）
#[derive(Clone)]
pub struct BridgeServerHandle {
    inner: std::sync::Arc<BridgeServerHandleInner>,
}

pub(crate) struct BridgeServerHandleInner {
    /// 多个端口的 JoinHandle（key = 端口）
    handles: tokio::sync::Mutex<HashMap<u16, tokio::task::JoinHandle<()>>>,
    /// 当前配置的端口列表（port → name）
    port_names: tokio::sync::Mutex<HashMap<u16, String>>,
}

impl BridgeServerHandle {
    pub fn new() -> Self {
        Self {
            inner: std::sync::Arc::new(BridgeServerHandleInner {
                handles: tokio::sync::Mutex::new(HashMap::new()),
                port_names: tokio::sync::Mutex::new(HashMap::new()),
            }),
        }
    }

    /// 设置端口配置（自动启动时调用）
    pub(crate) async fn set_port_configs(&self, configs: &[(String, u16)]) {
        let mut names = self.inner.port_names.lock().await;
        names.clear();
        for (name, port) in configs {
            names.insert(*port, name.clone());
        }
    }

    /// 添加单个端口的 JoinHandle（接受 tauri 异步运行时句柄，内部提取 tokio 句柄）
    pub(crate) async fn add_handle(&self, port: u16, handle: tauri::async_runtime::JoinHandle<()>) {
        let tauri::async_runtime::JoinHandle::Tokio(tokio_handle) = handle;
        self.inner.handles.lock().await.insert(port, tokio_handle);
    }

    /// 获取运行中的端口列表
    pub(crate) async fn running_ports(&self) -> Vec<u16> {
        self.inner.handles.lock().await.keys().copied().collect()
    }
}

/// 启动双 AI 桥接 WebSocket 服务器（所有端口）
#[tauri::command]
pub async fn start_bridge_server(
    server_handle: State<'_, BridgeServerHandle>,
    bridge_state: State<'_, Arc<BridgeState>>,
) -> Result<String, String> {
    let mut handles_guard = server_handle.inner.handles.lock().await;
    if !handles_guard.is_empty() {
        return Ok("桥接服务器已在运行中".to_string());
    }

    let port_names = server_handle.inner.port_names.lock().await;
    if port_names.is_empty() {
        return Err("未配置桥接端口，请先在设置中添加端口".to_string());
    }

    let configs: Vec<(String, u16)> = port_names
        .iter()
        .map(|(port, name)| (name.clone(), *port))
        .collect();
    drop(port_names);

    let state = bridge_state.inner().clone();

    for (name, port) in &configs {
        let s = state.clone();
        let p = *port;
        let n = name.clone();
        let handle = tokio::spawn(async move {
            // 注册端口配置到桥接状态
            {
                let mut inner = s.inner.lock().await;
                inner.port_configs.insert(p, n);
            }
            if let Err(e) = crate::bridge::run_bridge_server(s, p).await {
                eprintln!("桥接服务器端口 {} 错误: {}", p, e);
            }
        });
        handles_guard.insert(*port, handle);
    }

    let ports_str: Vec<String> = configs
        .iter()
        .map(|(n, p)| format!("{}:{}", n, p))
        .collect();
    Ok(format!(
        "桥接服务已启动，端口: {}",
        ports_str.join(", ")
    ))
}

/// 停止所有双 AI 桥接服务器
#[tauri::command]
pub async fn stop_bridge_server(
    server_handle: State<'_, BridgeServerHandle>,
) -> Result<String, String> {
    let mut handles_guard = server_handle.inner.handles.lock().await;
    if handles_guard.is_empty() {
        return Err("没有正在运行的桥接服务器".to_string());
    }

    let count = handles_guard.len();
    for (_, handle) in handles_guard.drain() {
        handle.abort();
    }
    Ok(format!("已停止 {} 个桥接服务器", count))
}

/// 重新加载桥接配置并重启服务器
///
/// 从配置文件中读取最新的端口配置，停止旧服务器，启动新服务器。
#[tauri::command]
pub async fn reload_bridge_config(
    server_handle: State<'_, BridgeServerHandle>,
    bridge_state: State<'_, Arc<BridgeState>>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    // 1. 停止现有服务器
    {
        let mut handles_guard = server_handle.inner.handles.lock().await;
        for (_, handle) in handles_guard.drain() {
            handle.abort();
        }
    }

    // 2. 清除旧的浏览器连接（端口配置变了，连接需要重建立）
    {
        let mut inner = bridge_state.inner.lock().await;
        inner.browsers.clear();
        inner.pending_requests.clear();
    }

    // 3. 从配置文件读取最新端口配置
    let config = crate::config_storage::load_config(&app_handle)?;
    let port_configs: Vec<(String, u16)> = config
        .bridge_ports
        .iter()
        .map(|p| (p.name.clone(), p.port))
        .collect();

    if port_configs.is_empty() {
        return Ok("桥接端口配置为空，未启动服务".to_string());
    }

    // 4. 更新端口名称映射
    {
        let mut names = server_handle.inner.port_names.lock().await;
        names.clear();
        for (name, port) in &port_configs {
            names.insert(*port, name.clone());
        }
    }

    // 5. 启动新服务器
    let state = bridge_state.inner().clone();
    let mut handles_guard = server_handle.inner.handles.lock().await;

    for (name, port) in &port_configs {
        let s = state.clone();
        let p = *port;
        let n = name.clone();
        let handle = tokio::spawn(async move {
            {
                let mut inner = s.inner.lock().await;
                inner.port_configs.insert(p, n);
            }
            if let Err(e) = crate::bridge::run_bridge_server(s, p).await {
                eprintln!("桥接服务器端口 {} 错误: {}", p, e);
            }
        });
        handles_guard.insert(*port, handle);
    }

    let ports_str: Vec<String> = port_configs
        .iter()
        .map(|(n, p)| format!("{}:{}", n, p))
        .collect();
    Ok(format!(
        "桥接服务已重启，端口: {}",
        ports_str.join(", ")
    ))
}

/// 获取所有桥接服务器的运行状态
#[tauri::command]
pub async fn get_bridge_status(
    server_handle: State<'_, BridgeServerHandle>,
    bridge_state: State<'_, Arc<BridgeState>>,
) -> Result<Value, String> {
    let running_ports = server_handle.running_ports().await;
    let running = !running_ports.is_empty();

    let browsers = {
        let inner = bridge_state.inner.lock().await;
        inner
            .browsers
            .values()
            .map(|b| {
                json!({
                    "session_id": b.session_id,
                    "name": b.client_name,
                    "port_name": b.port_name,
                    "client_name": b.client_name,
                    "browser": b.browser_type,
                    "version": b.version,
                    "profile": b.profile_name,
                    "profile_avatar": b.profile_avatar,
                    "windows": b.window_count,
                    "port": b.port,
                    "remote_addr": b.remote_addr,
                    "connected_at": b.connected_at.elapsed().as_secs(),
                })
            })
            .collect::<Vec<_>>()
    };

    Ok(serde_json::json!({
        "running": running,
        "running_ports": running_ports,
        "local_addresses": bridge_state.local_addresses,
        "browsers": browsers,
        "browser_count": browsers.len(),
    }))
}

/// 获取浏览器 AI 执行进度
///
/// 轮询获取所有正在进行的浏览器 AI（ask_browser_ai）的执行进度。
/// 前端每隔一段时间调用此命令，获取最新的步骤信息并可视化展示。
#[tauri::command]
pub async fn get_bridge_agent_progress(
    bridge_state: State<'_, Arc<BridgeState>>,
) -> Result<Value, String> {
    Ok(crate::bridge::get_all_agent_progresses(&bridge_state).await)
}

/// 直接向浏览器 AI 发送消息（用户直接与浏览器 AI 对话）
///
/// 将用户输入直接作为 ask_browser_ai 任务发送到浏览器 AI，
/// 返回浏览器 AI 的执行结果。
#[tauri::command]
pub async fn send_browser_message(
    bridge_state: State<'_, Arc<BridgeState>>,
    task: String,
    browser_session_id: Option<String>,
) -> Result<Value, String> {
    let result = crate::bridge::execute_browser_tool(
        &bridge_state,
        "ask_browser_ai",
        &serde_json::json!({"task": task}),
        browser_session_id.as_deref(),
    ).await?;
    Ok(result)
}

/// 对指定浏览器会话进行连通性测试（ping），返回延迟毫秒数
#[tauri::command]
pub async fn ping_browser(
    bridge_state: State<'_, Arc<BridgeState>>,
    session_id: String,
) -> Result<Value, String> {
    let ms = crate::bridge::ping_session(&bridge_state, &session_id).await?;
    Ok(serde_json::json!({ "session_id": session_id, "ping_ms": ms.round() as i64 }))
}

/// 断开指定浏览器会话
#[tauri::command]
pub async fn disconnect_browser(
    bridge_state: State<'_, Arc<BridgeState>>,
    session_id: String,
) -> Result<Value, String> {
    let mut inner = bridge_state.inner.lock().await;
    match inner.browsers.remove(&session_id) {
        Some(_) => Ok(json!({ "ok": true, "session_id": session_id })),
        None => Err(format!("浏览器会话 {} 不存在", session_id)),
    }
}

/// 更新浏览器会话的客户端名称（别名）
#[tauri::command]
pub async fn update_browser_name(
    bridge_state: State<'_, Arc<BridgeState>>,
    session_id: String,
    name: String,
) -> Result<Value, String> {
    let mut inner = bridge_state.inner.lock().await;
    match inner.browsers.get_mut(&session_id) {
        Some(session) => {
            session.client_name = name;
            Ok(json!({ "ok": true, "session_id": session_id }))
        }
        None => Err(format!("浏览器会话 {} 不存在", session_id)),
    }
}

/// 取消所有浏览器 AI 任务（用户终止桌面 AI 时由前端调用）
///
/// 向所有已连接的浏览器广播取消消息，通知浏览器停止 agent/prompt 任务。
#[tauri::command]
pub async fn cancel_browser_ai(
    bridge_state: State<'_, Arc<BridgeState>>,
) -> Result<(), String> {
    crate::bridge::cancel_browser_ai_tasks(&bridge_state).await;
    Ok(())
}
