//! 工具管理 + 二次确认系统
//!
//! 定义工具列表获取、工具执行以及危险工具的二次确认机制。
//!
//! 流程：
//!   1. execute_tool 检测到危险工具 → 不执行，保存为 PendingExecution，返回 needs_confirmation
//!   2. 前端展示确认对话框，用户点击「运行」或「取消」
//!   3. 前端调用 confirm_execution(token) 或 cancel_execution(token)
//!   4. confirm_execution 取出 pending 记录并执行，返回真实结果

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::State;

use crate::mcp_client::McpClientManager;
use crate::workspace;

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

/// 判断工具是否需要用户二次确认（根据安全模式）
fn tool_needs_confirmation(name: &str, mode: &str) -> bool {
    let risk = crate::tools::get_tool_risk_level(name);
    match mode {
        "trusted" => false,               // 信任模式：全部自动放行
        "balanced" => risk == "high",      // 平衡模式：仅高风险需确认
        _ => risk == "high" || risk == "medium", // 保守模式：中高风险都需确认
    }
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

/// 获取 MCP 工具列表
///
/// 返回所有可用工具的 JSON 定义列表，供前端或 MCP 客户端使用
/// 同时合并外部 MCP 服务器提供的工具
#[tauri::command]
pub fn get_tools(mcp: State<'_, McpClientManager>, app_handle: tauri::AppHandle) -> Vec<Value> {
    let mut tools = crate::tools::get_tool_definitions();
    // 合并外部 MCP 工具
    for mcp_tool in mcp.get_tools() {
        tools.push(serde_json::json!({
            "name": mcp_tool.prefixed_name,
            "description": mcp_tool.description,
            "inputSchema": mcp_tool.input_schema,
        }));
    }
    // 合并技能工具（去重，避免与内置工具重名）
    if let Ok(skill_tools) = crate::tools::get_skill_tools(&app_handle) {
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
/// * `permission_mode` - 权限模式（conservative / balanced / trusted），可选
///
/// # 返回
/// 工具执行结果（JSON 格式）
#[tauri::command]
pub async fn execute_tool(name: String, args: Value, permission_mode: Option<String>, mcp: State<'_, McpClientManager>, app_handle: tauri::AppHandle) -> Result<Value, String> {
    let mode = permission_mode.as_deref().unwrap_or("conservative");

    // ═══ 二次确认拦截（根据安全模式判断，不满足阈值则拦截）═══
    if tool_needs_confirmation(&name, mode) {
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
        return crate::tools::execute_skill(&app_handle, &name, &args);
    }

    // 内置工具
    let name_clone = name.clone();
    let args_clone = args.clone();
    let result = tokio::task::spawn_blocking(move || {
        crate::tools::execute_tool(&name_clone, &args_clone)
    })
    .await;

    match result {
        Ok(Ok(val)) => Ok(val),
        Ok(Err(_)) => {
            // 内置工具未命中 → 尝试作为技能执行
            crate::tools::execute_skill(&app_handle, &name, &args)
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
        crate::tools::execute_tool(&name_clone, &args_clone)
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
