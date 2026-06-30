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
                    "name": b.name,
                    "client_name": b.client_name,
                    "port": b.port,
                    "connected_at": b.connected_at.elapsed().as_secs(),
                })
            })
            .collect::<Vec<_>>()
    };

    Ok(serde_json::json!({
        "running": running,
        "running_ports": running_ports,
        "browsers": browsers,
        "browser_count": browsers.len(),
    }))
}
