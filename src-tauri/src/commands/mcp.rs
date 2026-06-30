//! MCP 服务器 + 客户端管理命令

use std::sync::Mutex;

use serde_json::Value;
use tauri::State;

use crate::config_storage::McpServerConfig;
use crate::mcp_client::McpClientManager;

/// MCP 服务器运行时状态
pub struct McpServerState {
    /// 服务器 tokio 任务句柄
    pub handle: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl McpServerState {
    /// 创建新的服务器状态
    pub fn new() -> Self {
        Self {
            handle: Mutex::new(None),
        }
    }
}

/// 启动 MCP HTTP 服务器
///
/// # 参数
/// * `port` - 监听端口号
///
/// # 返回
/// 启动结果消息
#[tauri::command]
pub async fn start_mcp_server(
    state: State<'_, McpServerState>,
    port: u16,
) -> Result<String, String> {
    // 检查是否已有服务器在运行
    let mut handle_guard = state.handle.lock().map_err(|e| format!("获取锁失败: {}", e))?;
    if handle_guard.is_some() {
        return Err("MCP 服务已在运行中".to_string());
    }

    let handle = tokio::spawn(async move {
        if let Err(e) = crate::server::run_server(port).await {
            eprintln!("MCP 服务器错误: {}", e);
        }
    });

    *handle_guard = Some(handle);
    Ok(format!("MCP 服务已启动，端口: {}", port))
}

/// 停止 MCP HTTP 服务器
///
/// # 返回
/// 停止结果消息
#[tauri::command]
pub fn stop_mcp_server(state: State<'_, McpServerState>) -> Result<String, String> {
    let mut handle_guard = state.handle.lock().map_err(|e| format!("获取锁失败: {}", e))?;
    match handle_guard.take() {
        Some(handle) => {
            handle.abort();
            Ok("MCP 服务已停止".to_string())
        }
        None => Err("MCP 服务未运行".to_string()),
    }
}

/// 获取 MCP 服务器运行状态
///
/// # 返回
/// `true` 表示服务器正在运行，`false` 表示未运行
#[tauri::command]
pub fn get_server_status(state: State<'_, McpServerState>) -> bool {
    state.handle.lock().map(|h| h.is_some()).unwrap_or(false)
}

/// 连接（启动）一个 MCP 服务器
#[tauri::command]
pub fn connect_mcp_server(
    mcp: State<'_, McpClientManager>,
    name: String,
    command: String,
    args: Vec<String>,
) -> Result<(), String> {
    mcp.connect(&name, &command, &args)
}

/// 断开一个 MCP 服务器
#[tauri::command]
pub fn disconnect_mcp_server(
    mcp: State<'_, McpClientManager>,
    name: String,
) -> Result<(), String> {
    mcp.disconnect(&name)
}

/// 列出所有已连接的 MCP 服务器
#[tauri::command]
pub fn list_mcp_connections(
    mcp: State<'_, McpClientManager>,
) -> Vec<String> {
    mcp.list_connections()
}

/// 获取所有 MCP 工具定义
#[tauri::command]
pub fn get_mcp_tools(
    mcp: State<'_, McpClientManager>,
) -> Vec<crate::mcp_client::McpToolDef> {
    mcp.get_tools()
}

/// 调用一个 MCP 工具
#[tauri::command]
pub fn call_mcp_tool(
    mcp: State<'_, McpClientManager>,
    name: String,
    args: Value,
) -> Result<Value, String> {
    mcp.call_tool(&name, &args)
}

/// 保存 MCP 服务器配置列表
#[tauri::command]
pub fn save_mcp_config(
    app_handle: tauri::AppHandle,
    servers: Vec<McpServerConfig>,
) -> Result<(), String> {
    crate::config_storage::save_mcp_servers(&app_handle, &servers)
}

/// 加载 MCP 服务器配置列表
#[tauri::command]
pub fn load_mcp_config(
    app_handle: tauri::AppHandle,
) -> Result<Vec<McpServerConfig>, String> {
    crate::config_storage::load_mcp_servers(&app_handle)
}
