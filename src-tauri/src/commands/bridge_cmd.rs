//! 双 AI 桥接服务器管理命令
//!
//! 提供启动/停止/状态查询的 IPC 命令

use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use crate::bridge::BridgeState;

/// 桥接服务器状态
pub struct BridgeServerHandle {
    handle: tokio::sync::Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl BridgeServerHandle {
    pub fn new() -> Self {
        Self {
            handle: tokio::sync::Mutex::new(None),
        }
    }
}

/// 启动双 AI 桥接 WebSocket 服务器
#[tauri::command]
pub async fn start_bridge_server(
    server_handle: State<'_, BridgeServerHandle>,
    bridge_state: State<'_, Arc<BridgeState>>,
) -> Result<String, String> {
    let mut handle_guard = server_handle.handle.lock().await;
    if handle_guard.is_some() {
        return Ok("桥接服务器已在运行中".to_string());
    }

    let state = bridge_state.inner().clone();
    let handle = tokio::spawn(async move {
        if let Err(e) = crate::bridge::run_bridge_server(state).await {
            eprintln!("桥接服务器错误: {}", e);
        }
    });

    *handle_guard = Some(handle);
    Ok(format!(
        "桥接服务已启动，端口: {}",
        crate::bridge::BRIDGE_PORT
    ))
}

/// 停止双 AI 桥接服务器
#[tauri::command]
pub async fn stop_bridge_server(
    server_handle: State<'_, BridgeServerHandle>,
) -> Result<String, String> {
    let mut handle_guard = server_handle.handle.lock().await;
    match handle_guard.take() {
        Some(handle) => {
            handle.abort();
            Ok("桥接服务器已停止".to_string())
        }
        None => Err("桥接服务器未运行".to_string()),
    }
}

/// 获取桥接服务器运行状态
#[tauri::command]
pub async fn get_bridge_status(
    server_handle: State<'_, BridgeServerHandle>,
    bridge_state: State<'_, Arc<BridgeState>>,
) -> Result<Value, String> {
    let running = server_handle.handle.lock().await.is_some();
    let connected = {
        let inner = bridge_state.inner.lock().await;
        inner.browser_connected
    };

    Ok(serde_json::json!({
        "running": running,
        "browser_connected": connected,
        "port": crate::bridge::BRIDGE_PORT,
    }))
}
