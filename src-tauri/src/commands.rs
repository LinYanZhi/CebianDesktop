//! Tauri IPC 命令
//!
//! 定义前端可调用的所有 IPC 命令，管理 MCP 服务器状态

use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::Emitter;
use tauri::State;

use crate::ai::{call_llm, AIConfig, ChatMessage};
use crate::config_storage::{
    save_config, load_config, AppConfig, Conversation, Prompt, McpServerConfig,
    save_conversations as storage_save_convs, load_conversations as storage_load_convs,
};
use crate::mcp_client::McpClientManager;
use crate::server;
use crate::tools;
use crate::workspace;

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
    // 合并技能工具（动态加载自 workspace/skills/）
    if let Ok(skill_tools) = tools::get_skill_tools(&app_handle) {
        tools.extend(skill_tools);
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
    // 技能管理工具（需要 app_handle）
    match name.as_str() {
        "skill_list" => {
            let files = workspace::list_files(&app_handle, workspace::WorkspaceDir::Skills)?;
            let skills: Vec<Value> = files.into_iter().map(|f| json!({
                "name": f.name,
                "description": f.description,
                "filename": f.filename,
                "updated_at": f.updated_at,
            })).collect();
            return Ok(json!({"skills": skills, "count": skills.len()}));
        }
        "skill_create" => {
            let name_val = args.get("name").and_then(|v| v.as_str()).ok_or("缺少 name 参数")?;
            let description = args.get("description").and_then(|v| v.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let id = workspace::generate_id();
            workspace::write_file(&app_handle, workspace::WorkspaceDir::Skills, &id, name_val, description, content)?;
            return Ok(json!({
                "id": id,
                "name": name_val,
                "filename": format!("{}.md", id),
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

/// 内部工具执行（同步，用于 ai.rs 中调用技能管理工具）
///
/// 处理 skill_list / skill_create / skill_read / skill_delete 四个技能管理工具。
/// 注意：此函数不处理 MCP 工具（MCP 需要 async 调用）和内置工具。
pub fn execute_tool_internal(name: &str, args: &Value, app_handle: &tauri::AppHandle) -> Result<Value, String> {
    match name {
        "skill_list" => {
            let files = workspace::list_files(app_handle, workspace::WorkspaceDir::Skills)?;
            let skills: Vec<Value> = files.into_iter().map(|f| json!({
                "name": f.name,
                "description": f.description,
                "filename": f.filename,
                "updated_at": f.updated_at,
            })).collect();
            Ok(json!({"skills": skills, "count": skills.len()}))
        }
        "skill_create" => {
            let name_val = args.get("name").and_then(|v| v.as_str()).ok_or("缺少 name 参数")?;
            let description = args.get("description").and_then(|v| v.as_str()).unwrap_or("");
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let id = workspace::generate_id();
            workspace::write_file(app_handle, workspace::WorkspaceDir::Skills, &id, name_val, description, content)?;
            Ok(json!({
                "id": id,
                "name": name_val,
                "filename": format!("{}.md", id),
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
