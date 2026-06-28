//! Tauri IPC 命令
//!
//! 定义前端可调用的所有 IPC 命令，管理 MCP 服务器状态

use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::Emitter;
use tauri::State;

use crate::ai::{call_llm, AIConfig, ChatMessage};
use crate::config_storage::{
    save_config, load_config, AppConfig, Conversation,
    save_conversations as storage_save_convs, load_conversations as storage_load_convs,
};
use crate::server;
use crate::tools;

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

/// 获取 MCP 工具列表
///
/// 返回所有可用工具的 JSON 定义列表，供前端或 MCP 客户端使用
#[tauri::command]
pub fn get_tools() -> Vec<Value> {
    tools::get_tool_definitions()
}

/// 执行指定的工具
///
/// # 参数
/// * `name` - 工具名称
/// * `args` - 工具参数（JSON 对象）
///
/// # 返回
/// 工具执行结果（JSON 格式）
#[tauri::command]
pub fn execute_tool(name: String, args: Value) -> Value {
    match tools::execute_tool(&name, &args) {
        Ok(result) => result,
        Err(e) => json!({"error": e}),
    }
}

/// 调用 AI LLM
///
/// # 参数
/// * `config` - AI 配置（包括 base_url、api_key、model 等）
/// * `messages` - 聊天消息列表
///
/// # 返回
/// AI 回复消息
#[tauri::command]
pub fn call_ai(config: AIConfig, messages: Vec<ChatMessage>) -> Result<ChatMessage, String> {
    call_llm(&config, &messages)
}

/// 流式调用 AI（通过 Tauri 事件返回结果）
///
/// 在后台线程中运行流式处理，通过以下 Tauri 事件向前端推送实时结果：
/// - "ai:token" - 每个内容 token
/// - "ai:thinking" - 思考过程 token
/// - "ai:tool_call" - 工具调用
/// - "ai:tool_result" - 工具执行结果
/// - "ai:done" - 流式完成
/// - "ai:error" - 发生错误
///
/// # 参数
/// * `app_handle` - Tauri 应用句柄
/// * `config` - AI 配置
/// * `messages` - 聊天消息列表
#[tauri::command]
pub async fn call_ai_streaming(
    app_handle: tauri::AppHandle,
    config: AIConfig,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    // 在后台线程中运行流式处理，避免阻塞 Tauri 的异步运行时
    let handle = app_handle.clone();
    std::thread::spawn(move || {
        if let Err(e) = crate::ai::call_llm_streaming(&config, &messages, &handle) {
            let _ = handle.emit("ai:error", serde_json::json!({"error": e}));
        }
    });
    Ok(())
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
        if let Err(e) = server::run_server(port).await {
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

/// 保存应用配置到本地 JSON
#[tauri::command]
pub fn save_app_config(
    app_handle: tauri::AppHandle,
    config: AppConfig,
) -> Result<(), String> {
    save_config(&app_handle, &config)
}

/// 从本地 JSON 加载应用配置
#[tauri::command]
pub fn load_app_config(
    app_handle: tauri::AppHandle,
) -> Result<AppConfig, String> {
    load_config(&app_handle)
}

/// 保存对话列表到本地 JSON
#[tauri::command]
pub fn save_conversations(
    app_handle: tauri::AppHandle,
    conversations: Vec<Conversation>,
) -> Result<(), String> {
    storage_save_convs(&app_handle, &conversations)
}

/// 从本地 JSON 加载对话列表
#[tauri::command]
pub fn load_conversations(
    app_handle: tauri::AppHandle,
) -> Result<Vec<Conversation>, String> {
    storage_load_convs(&app_handle)
}
