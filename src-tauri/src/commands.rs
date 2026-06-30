//! Tauri IPC 命令
//!
//! 定义前端可调用的所有 IPC 命令，管理 MCP 服务器状态、AI 工具调用的二次确认机制

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::Emitter;
use tauri::State;

use crate::ai::{call_llm, AIConfig, ChatMessage};
use crate::config_storage::{
    save_config, load_config, AppConfig, ProviderConfig, Conversation, Prompt, McpServerConfig,
    save_conversations as storage_save_convs, load_conversations as storage_load_convs,
};
use crate::mcp_client::McpClientManager;
use crate::server;
use crate::tools;
use crate::workspace;

// ─── AI 工具调用二次确认（Pending Execution） ─────────────────────
//
// 某些危险工具调用（删除、覆盖、命令执行等）需要用户在前端确认后才能执行。
// 流程：
//   1. execute_tool 检测到危险工具 → 不执行，保存为 PendingExecution，返回 needs_confirmation
//   2. 前端展示确认对话框，用户点击「运行」或「取消」
//   3. 前端调用 confirm_execution(token) 或 cancel_execution(token)
//   4. confirm_execution 取出 pending 记录并执行，返回真实结果

/// 待用户确认的工具执行
struct PendingExecution {
    tool_name: String,
    args: Value,
}

/// 全局 pending 执行存储，key = 唯一 token
static PENDING_EXECUTIONS: std::sync::OnceLock<Mutex<HashMap<String, PendingExecution>>> =
    std::sync::OnceLock::new();

fn pending_store() -> &'static Mutex<HashMap<String, PendingExecution>> {
    PENDING_EXECUTIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 生成唯一 token（时间戳 + 自增计数器）
fn generate_token() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{:x}{:016x}", ts, count)
}

/// 判断工具是否需要用户二次确认
fn tool_needs_confirmation(name: &str) -> bool {
    matches!(
        name,
        "delete_path"
            | "write_new_file"
            | "edit_file"
            | "rename_path"
            | "skill_delete"
            | "run_command"
    )
}

/// 获取工具调用的风险详情，用于前端展示
/// 返回 { type, target, risk, description, args_detail }
fn get_tool_confirmation_details(name: &str, args: &Value) -> Value {
    match name {
        "delete_path" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("?");
            json!({
                "action": "删除",
                "target": path,
                "risk": "high",
                "description": "永久删除文件或目录，此操作不可撤销。被删除的文件不会进入回收站。",
                "args_detail": serde_json::to_string_pretty(&json!({"path": path})).unwrap_or_default()
            })
        }
        "write_new_file" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("?");
            json!({
                "action": "写入文件",
                "target": path,
                "risk": "medium",
                "description": "创建新文件或覆盖已有文件。如果文件已存在，原有内容将被完全替换。",
                "args_detail": serde_json::to_string_pretty(&json!({"path": path})).unwrap_or_default()
            })
        }
        "edit_file" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("?");
            json!({
                "action": "编辑文件",
                "target": path,
                "risk": "medium",
                "description": "查找并替换文件内容。可能修改文件中的关键配置或代码逻辑。",
                "args_detail": serde_json::to_string_pretty(&json!({"path": path})).unwrap_or_default()
            })
        }
        "rename_path" => {
            let old = args.get("old_path").and_then(|v| v.as_str()).unwrap_or("?");
            let new = args.get("new_path").and_then(|v| v.as_str()).unwrap_or("?");
            json!({
                "action": "重命名/移动",
                "target": old,
                "risk": "medium",
                "description": "重命名或移动文件/目录。如果目标位置已存在文件，可能会被覆盖。",
                "args_detail": serde_json::to_string_pretty(&json!({"from": old, "to": new})).unwrap_or_default()
            })
        }
        "run_command" => {
            let cmd = args.get("command").and_then(|v| v.as_str()).unwrap_or("?");
            json!({
                "action": "执行命令",
                "target": cmd,
                "risk": "high",
                "description": "在您的电脑上执行终端命令。可能安装/卸载软件、修改系统配置、访问网络等。",
                "args_detail": serde_json::to_string_pretty(&json!({"command": cmd})).unwrap_or_default()
            })
        }
        "skill_delete" => {
            let name_val = args.get("name").and_then(|v| v.as_str()).unwrap_or("?");
            json!({
                "action": "删除技能",
                "target": name_val,
                "risk": "high",
                "description": "永久删除一个技能文件，此操作不可撤销。被删除的技能将不再可用。",
                "args_detail": serde_json::to_string_pretty(&json!({"skill": name_val})).unwrap_or_default()
            })
        }
        _ => {
            json!({
                "action": name,
                "target": "?",
                "risk": "unknown",
                "description": "执行工具调用",
                "args_detail": serde_json::to_string_pretty(args).unwrap_or_default()
            })
        }
    }
}

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
/// 同时合并外部 MCP 服务器提供的工具
#[tauri::command]
pub fn get_tools(mcp: State<'_, McpClientManager>, app_handle: tauri::AppHandle) -> Vec<Value> {
    let mut tools = tools::get_tool_definitions();
    // 合并外部 MCP 工具
    for mcp_tool in mcp.get_tools() {
        tools.push(serde_json::json!({
            "name": mcp_tool.prefixed_name,
            "description": mcp_tool.description,
            "inputSchema": mcp_tool.input_schema,
        }));
    }
    // 合并技能工具（去重，避免与内置工具重名）
    if let Ok(skill_tools) = tools::get_skill_tools(&app_handle) {
        for st in skill_tools {
            let name = st["name"].as_str().unwrap_or("");
            if !tools.iter().any(|t| t["name"].as_str() == Some(name)) {
                tools.push(st);
            }
        }
    }
    tools
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
pub async fn execute_tool(name: String, args: Value, mcp: State<'_, McpClientManager>, app_handle: tauri::AppHandle) -> Result<Value, String> {
    // ═══ 二次确认拦截（危险工具不立即执行，返回确认请求）═══
    if tool_needs_confirmation(&name) {
        let token = generate_token();
        let details = get_tool_confirmation_details(&name, &args);
        let pending = PendingExecution {
            tool_name: name.clone(),
            args: args.clone(),
        };
        pending_store()
            .lock()
            .map_err(|e| format!("内部错误: {}", e))?
            .insert(token.clone(), pending);
        return Ok(json!({
            "needs_confirmation": true,
            "token": token,
            "details": details,
        }));
    }

    // 技能管理工具（需要 app_handle）
    match name.as_str() {
        "skill_list" => {
            let files = workspace::list_files(&app_handle, workspace::WorkspaceDir::Skills)?;
            let workspace_dir = workspace::get_subdir_path(&app_handle, workspace::WorkspaceDir::Skills)?;
            let skills: Vec<Value> = files.into_iter().map(|f| json!({
                "name": f.name,
                "description": f.description,
                "filename": f.filename,
                "is_dir": f.filename.ends_with('/'),
                "updated_at": f.updated_at,
            })).collect();
            return Ok(json!({
                "workspace_dir": workspace_dir.to_string_lossy().to_string(),
                "skills": skills,
                "count": skills.len(),
            }));
        }
        "skill_create" => {
            let name_val = args.get("name").and_then(|v| v.as_str()).ok_or("缺少 name 参数")?;
            let description = args.get("description").and_then(|v| v.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let file_id = workspace::resolve_skill_filename(&app_handle, workspace::WorkspaceDir::Skills, name_val)?;
            let skill_id = file_id.strip_suffix(".md").unwrap_or(&file_id).to_string();
            workspace::write_file(&app_handle, workspace::WorkspaceDir::Skills, &file_id, name_val, description, content)?;
            return Ok(json!({
                "id": skill_id,
                "name": name_val,
                "filename": file_id,
                "message": format!("技能「{}」已创建成功。AI 现在可以通过 skill_{} 工具调用此技能。", name_val, name_val.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect::<String>()),
            }));
        }
        "skill_read" => {
            let name_val = args.get("name").and_then(|v| v.as_str()).ok_or("缺少 name 参数")?;
            let files = workspace::list_files(&app_handle, workspace::WorkspaceDir::Skills)?;
            let skill = files.iter().find(|f| f.name == name_val)
                .ok_or_else(|| format!("未找到技能「{}」", name_val))?;
            return Ok(json!({
                "name": skill.name,
                "description": skill.description,
                "filename": skill.filename,
                "content": skill.content,
            }));
        }
        _ => {}
    }

    // MCP 工具（前缀 mcp:）路由到 MCP 客户端
    if name.starts_with("mcp:") {
        return mcp.call_tool(&name, &args).or_else(|e| Ok(json!({ "error": e })));
    }

    // 技能工具（前缀 skill_）直接路由到技能执行
    if name.starts_with("skill_") {
        return tools::execute_skill(&app_handle, &name, &args);
    }

    // 内置工具
    let name_clone = name.clone();
    let args_clone = args.clone();
    let result = tokio::task::spawn_blocking(move || {
        tools::execute_tool(&name_clone, &args_clone)
    })
    .await;

    match result {
        Ok(Ok(val)) => Ok(val),
        Ok(Err(_)) => {
            // 内置工具未命中 → 尝试作为技能执行
            tools::execute_skill(&app_handle, &name, &args)
        }
        Err(e) => Ok(json!({"error": format!("工具执行线程崩溃: {}", e)})),
    }
}

/// 确认执行一个待确认的工具调用
///
/// 用户在前端点击「运行」后调用此命令，执行之前被拦截的 pending 工具。
/// # 参数
/// * `token` - execute_tool 返回的确认 token
///
/// # 返回
/// 工具执行的真实结果
#[tauri::command]
pub async fn confirm_tool_execution(token: String, _mcp: State<'_, McpClientManager>, app_handle: tauri::AppHandle) -> Result<Value, String> {
    let pending = pending_store()
        .lock()
        .map_err(|e| format!("内部错误: {}", e))?
        .remove(&token)
        .ok_or_else(|| format!("确认 token 无效或已过期: {}", token))?;

    let tool_name = pending.tool_name;
    let args = pending.args;

    // 处理技能管理工具（skill_delete 已被确认，可以执行）
    // 注意：skill_list/create/read 不需要确认，只有 skill_delete 会走这里
    match tool_name.as_str() {
        "skill_delete" => {
            let name_val = args.get("name").and_then(|v| v.as_str()).ok_or("缺少 name 参数")?;
            let files = workspace::list_files(&app_handle, workspace::WorkspaceDir::Skills)?;
            let skill = files.iter().find(|f| f.name == name_val)
                .ok_or_else(|| format!("未找到技能「{}」", name_val))?;
            workspace::delete_file(&app_handle, workspace::WorkspaceDir::Skills, &skill.id)?;
            return Ok(json!({"message": format!("技能「{}」已删除", name_val)}));
        }
        _ => {}
    }

    // 内置工具（带路径沙箱）
    let name_clone = tool_name.clone();
    let args_clone = args.clone();
    let result = tokio::task::spawn_blocking(move || {
        tools::execute_tool(&name_clone, &args_clone)
    })
    .await;

    match result {
        Ok(Ok(val)) => Ok(val),
        Ok(Err(e)) => Ok(json!({"error": format!("工具执行失败: {}", e)})),
        Err(e) => Ok(json!({"error": format!("工具执行线程崩溃: {}", e)})),
    }
}

/// 取消一个待确认的工具调用
///
/// 用户在前端点击「取消」后调用此命令，仅移除 pending 记录，不执行任何操作。
#[tauri::command]
pub fn cancel_tool_execution(token: String) -> Result<Value, String> {
    let removed = pending_store()
        .lock()
        .map_err(|e| format!("内部错误: {}", e))?
        .remove(&token);
    if removed.is_some() {
        Ok(json!({"message": "操作已取消"}))
    } else {
        Ok(json!({"message": "操作已取消（token 已过期）"}))
    }
}

/// 内部工具执行（同步，用于 ai.rs 中调用技能管理工具）
///
/// 处理 skill_list / skill_create / skill_read / skill_delete 四个技能管理工具。
/// 注意：此函数不处理 MCP 工具（MCP 需要 async 调用）和内置工具。
pub fn execute_tool_internal(name: &str, args: &Value, app_handle: &tauri::AppHandle) -> Result<Value, String> {
    match name {
        "skill_list" => {
            let files = workspace::list_files(app_handle, workspace::WorkspaceDir::Skills)?;
            let workspace_dir = workspace::get_subdir_path(app_handle, workspace::WorkspaceDir::Skills)?;
            let skills: Vec<Value> = files.into_iter().map(|f| json!({
                "name": f.name,
                "description": f.description,
                "filename": f.filename,
                "is_dir": f.filename.ends_with('/'),
                "updated_at": f.updated_at,
            })).collect();
            Ok(json!({
                "workspace_dir": workspace_dir.to_string_lossy().to_string(),
                "skills": skills,
                "count": skills.len(),
            }))
        }
        "skill_create" => {
            let name_val = args.get("name").and_then(|v| v.as_str()).ok_or("缺少 name 参数")?;
            let description = args.get("description").and_then(|v| v.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let file_id = workspace::resolve_skill_filename(app_handle, workspace::WorkspaceDir::Skills, name_val)?;
            let skill_id = file_id.strip_suffix(".md").unwrap_or(&file_id).to_string();
            workspace::write_file(app_handle, workspace::WorkspaceDir::Skills, &file_id, name_val, description, content)?;
            Ok(json!({
                "id": skill_id,
                "name": name_val,
                "filename": file_id,
                "message": format!("技能「{}」已创建成功。AI 现在可以通过 skill_{} 工具调用此技能。", name_val, name_val.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect::<String>()),
            }))
        }
        "skill_read" => {
            let name_val = args.get("name").and_then(|v| v.as_str()).ok_or("缺少 name 参数")?;
            let files = workspace::list_files(app_handle, workspace::WorkspaceDir::Skills)?;
            let skill = files.iter().find(|f| f.name == name_val)
                .ok_or_else(|| format!("未找到技能「{}」", name_val))?;
            Ok(json!({
                "name": skill.name,
                "description": skill.description,
                "filename": skill.filename,
                "content": skill.content,
            }))
        }
        "skill_delete" => {
            let name_val = args.get("name").and_then(|v| v.as_str()).ok_or("缺少 name 参数")?;
            let files = workspace::list_files(app_handle, workspace::WorkspaceDir::Skills)?;
            let skill = files.iter().find(|f| f.name == name_val)
                .ok_or_else(|| format!("未找到技能「{}」", name_val))?;
            workspace::delete_file(app_handle, workspace::WorkspaceDir::Skills, &skill.id)?;
            Ok(json!({"message": format!("技能「{}」已删除", name_val)}))
        }
        _ => Err(format!("未知工具: {}", name)),
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
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            crate::ai::call_llm_streaming(&config, &messages, &handle)
        }));
        match result {
            Ok(Err(e)) => {
                let _ = handle.emit("ai:error", serde_json::json!({"error": e}));
            }
            Err(panic_err) => {
                let msg = if let Some(s) = panic_err.downcast_ref::<&str>() {
                    s.to_string()
                } else if let Some(s) = panic_err.downcast_ref::<String>() {
                    s.clone()
                } else {
                    "未知线程错误".to_string()
                };
                eprintln!("[call_ai_streaming] thread panicked: {}", msg);
                let _ = handle.emit("ai:error", serde_json::json!({"error": format!("线程错误: {}", msg)}));
            }
            _ => {}
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

// ─── Prompt CRUD ───────────────────────────────────────────

/// 列出所有提示词
#[tauri::command]
pub fn list_prompts(
    app_handle: tauri::AppHandle,
) -> Result<Vec<Prompt>, String> {
    crate::config_storage::load_prompts(&app_handle)
}

/// 保存一个提示词（创建或更新）
#[tauri::command]
pub fn save_prompt(
    app_handle: tauri::AppHandle,
    prompt: Prompt,
) -> Result<(), String> {
    let mut prompts = crate::config_storage::load_prompts(&app_handle)?;
    // 如果已存在相同 id，则替换；否则追加
    if let Some(pos) = prompts.iter().position(|p| p.id == prompt.id) {
        prompts[pos] = prompt;
    } else {
        prompts.push(prompt);
    }
    crate::config_storage::save_prompts(&app_handle, &prompts)
}

/// 删除一个提示词
#[tauri::command]
pub fn delete_prompt(
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    crate::config_storage::delete_prompt(&app_handle, &id)
}

// ─── MCP 客户端管理 ────────────────────────────────────────

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

// ─── 工作区文件管理 ─────────────────────────────────────────

/// 列出工作区子目录下的所有文件
#[tauri::command]
pub fn list_workspace_files(
    app_handle: tauri::AppHandle,
    sub: String,
) -> Result<Vec<workspace::WorkspaceFile>, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::list_files(&app_handle, dir)
}

/// 读取工作区文件
#[tauri::command]
pub fn read_workspace_file(
    app_handle: tauri::AppHandle,
    sub: String,
    id: String,
) -> Result<workspace::WorkspaceFile, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::read_file(&app_handle, dir, &id)
}

/// 写入工作区文件（创建或更新）
#[tauri::command]
pub fn write_workspace_file(
    app_handle: tauri::AppHandle,
    sub: String,
    id: String,
    name: String,
    description: String,
    content: String,
) -> Result<(), String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::write_file(&app_handle, dir, &id, &name, &description, &content)
}

/// 删除工作区文件
#[tauri::command]
pub fn delete_workspace_file(
    app_handle: tauri::AppHandle,
    sub: String,
    id: String,
) -> Result<(), String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::delete_file(&app_handle, dir, &id)
}

/// 重命名工作区文件
#[tauri::command]
pub fn rename_workspace_file(
    app_handle: tauri::AppHandle,
    sub: String,
    id: String,
    new_name: String,
) -> Result<(), String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::rename_file(&app_handle, dir, &id, &new_name)
}

/// 在工作区子目录下创建子文件夹
#[tauri::command]
pub fn create_workspace_subdir(
    app_handle: tauri::AppHandle,
    sub: String,
    dir_name: String,
) -> Result<(), String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::create_subdir(&app_handle, dir, &dir_name)
}

/// 删除工作区子目录
#[tauri::command]
pub fn delete_workspace_subdir(
    app_handle: tauri::AppHandle,
    sub: String,
    dir_name: String,
) -> Result<(), String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::delete_subdir(&app_handle, dir, &dir_name)
}

/// 移动工作区文件到目标目录
#[tauri::command]
pub fn move_workspace_file(
    app_handle: tauri::AppHandle,
    sub: String,
    file_id: String,
    target_dir: String,
) -> Result<(), String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::move_file_to_dir(&app_handle, dir, &file_id, &target_dir)
}

/// 生成工作区文件 ID
#[tauri::command]
pub fn generate_workspace_id() -> String {
    workspace::generate_id()
}

/// 导出单个工作区文件（返回原始 Markdown 内容）
#[tauri::command]
pub fn export_workspace_file(
    app_handle: tauri::AppHandle,
    sub: String,
    id: String,
) -> Result<String, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::read_file_raw(&app_handle, dir, &id)
}

/// 导入单个工作区文件（从原始 Markdown 内容）
#[tauri::command]
pub fn import_workspace_file(
    app_handle: tauri::AppHandle,
    sub: String,
    content: String,
) -> Result<String, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::import_file_raw(&app_handle, dir, &content)
}

/// 将工作区子目录下指定文件导出为 ZIP（base64 编码）
#[tauri::command]
pub fn export_workspace_zip(
    app_handle: tauri::AppHandle,
    sub: String,
    ids: Vec<String>,
) -> Result<String, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    let data = workspace::export_files_as_zip(&app_handle, dir, &ids)?;
    Ok(base64_encode(&data))
}

/// 从 ZIP 导入文件到工作区子目录
#[tauri::command]
pub fn import_workspace_zip(
    app_handle: tauri::AppHandle,
    sub: String,
    data: String,
) -> Result<usize, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    let bytes = base64_decode(&data)?;
    workspace::import_files_from_zip(&app_handle, dir, bytes)
}

/// 从本地目录导入文件到工作区子目录
#[tauri::command]
pub fn import_workspace_directory(
    app_handle: tauri::AppHandle,
    sub: String,
    dir_path: String,
) -> Result<usize, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::import_files_from_directory(&app_handle, dir, &dir_path)
}

/// 将工作区子目录下指定文件导出为 ZIP 并写入到指定路径
#[tauri::command]
pub fn export_workspace_zip_to_path(
    app_handle: tauri::AppHandle,
    sub: String,
    ids: Vec<String>,
    path: String,
) -> Result<usize, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::export_files_as_zip_to_path(&app_handle, dir, &ids, &path)
}

/// 从 ZIP 文件路径导入文件到工作区子目录
#[tauri::command]
pub fn import_workspace_zip_path(
    app_handle: tauri::AppHandle,
    sub: String,
    zip_path: String,
) -> Result<usize, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::import_files_from_zip_path(&app_handle, dir, &zip_path)
}

// ─── 打开文件管理器 ─────────────────────────────────────────

/// 在文件管理器中打开工作区子目录
#[tauri::command]
pub fn open_workspace_dir(app_handle: tauri::AppHandle, sub: String) -> Result<String, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    let path = workspace::get_subdir_path(&app_handle, dir)?;
    let path_str = path.to_string_lossy().to_string();
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &path_str])
        .spawn()
        .map_err(|e| format!("打开目录失败: {}", e))?;
    Ok(path_str)
}

/// 在文件管理器中打开并定位到工作区中指定文件
#[tauri::command]
pub fn open_file_location(app_handle: tauri::AppHandle, sub: String, id: String) -> Result<String, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    let path = workspace::get_file_path(&app_handle, dir, &id)?;
    let path_str = path.to_string_lossy().to_string();
    // Windows: explorer /select,<path> 会打开目录并选中文件
    std::process::Command::new("explorer")
        .args(["/select,", &path_str])
        .spawn()
        .map_err(|e| format!("打开文件位置失败: {}", e))?;
    Ok(path_str)
}

/// 获取工作区文件的绝对路径（不打开资源管理器）
#[tauri::command]
pub fn get_workspace_file_path(app_handle: tauri::AppHandle, sub: String, id: String) -> Result<String, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    let path = workspace::get_file_path(&app_handle, dir, &id)?;
    Ok(path.to_string_lossy().to_string())
}

// ─── 备份与恢复 ─────────────────────────────────────────────

/// 导出备份为 base64 字符串（供前端下载）
#[tauri::command]
pub fn export_backup(
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let data = workspace::export_backup(&app_handle)?;
    Ok(base64_encode(&data))
}

/// 从 base64 字符串导入备份
#[tauri::command]
pub fn import_backup(
    app_handle: tauri::AppHandle,
    data: String,
) -> Result<(), String> {
    let bytes = base64_decode(&data)?;
    workspace::import_backup(&app_handle, bytes)
}

// base64 辅助
fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    const DECODE: [i8; 256] = {
        let mut table = [-1i8; 256];
        let chars = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut i = 0;
        while i < 64 {
            table[chars[i] as usize] = i as i8;
            i += 1;
        }
        table
    };

    let input = input.trim();
    let mut output = Vec::with_capacity(input.len() * 3 / 4);
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() && bytes[i] != b'=' {
        let mut sextets = [0i8; 4];
        for j in 0..4 {
            if i + j >= bytes.len() || bytes[i + j] == b'=' {
                sextets[j] = -1;
            } else {
                let b = bytes[i + j] as usize;
                if b >= 256 { return Err("无效 base64 字符".into()); }
                sextets[j] = DECODE[b];
                if sextets[j] == -1 { return Err(format!("无效 base64 字符: {}", bytes[i + j] as char)); }
            }
        }
        let triple = ((sextets[0] as u32) << 18)
            | ((sextets[1] as u32) << 12)
            | (if sextets[2] >= 0 { (sextets[2] as u32) << 6 } else { 0 })
            | (if sextets[3] >= 0 { sextets[3] as u32 } else { 0 });
        output.push((triple >> 16) as u8);
        if sextets[2] >= 0 { output.push((triple >> 8) as u8); }
        if sextets[3] >= 0 { output.push(triple as u8); }
        i += 4;
    }
    Ok(output)
}

/// 将内容写入指定文件路径（用于对话导出）
#[tauri::command]
pub fn write_file_to_path(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content)
        .map_err(|e| format!("写入文件失败: {}", e))
}

/// 导出 AI 提供商配置到指定路径的 JSON 文件
#[tauri::command]
pub fn export_providers_config(path: String, config: AppConfig) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&config.providers)
        .map_err(|e| format!("序列化提供商配置失败: {}", e))?;
    std::fs::write(&path, &json)
        .map_err(|e| format!("写入提供商配置文件失败: {}", e))
}

/// 从指定路径的 JSON 文件导入 AI 提供商配置
#[tauri::command]
pub fn import_providers_config(path: String) -> Result<Vec<ProviderConfig>, String> {
    let json = std::fs::read_to_string(&path)
        .map_err(|e| format!("读取提供商配置文件失败: {}", e))?;
    serde_json::from_str::<Vec<ProviderConfig>>(&json)
        .map_err(|e| format!("解析提供商配置失败: {}", e))
}
