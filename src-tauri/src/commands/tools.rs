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
use std::sync::Arc;
use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::State;

use crate::bridge::BridgeState;
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
/// safe → 写/删/执行操作需要确认；trusted → 全部自动放行
fn tool_needs_confirmation(name: &str, mode: &str) -> bool {
    match mode {
        "trusted" => false,  // 信任模式：全部自动放行
        _ => {
            // 安全模式：写/删/执行操作需要确认
            let risk = crate::tools::get_tool_risk_level(name);
            risk == "high" || risk == "medium"
        }
    }
}

/// 获取工具调用的风险详情，用于前端展示
/// 返回 { type, target, risk, description, args_detail }
fn get_tool_confirmation_details(name: &str, args: &Value) -> Value {
    match name {
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
        "batch_rename" => {
            let ops = args.get("operations").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
            json!({
                "action": "批量重命名",
                "target": format!("{} 个文件/目录", ops),
                "risk": "medium",
                "description": format!("批量重命名或移动 {} 个文件/目录。每个操作都会独立验证路径，部分失败不影响其他操作。", ops),
                "args_detail": serde_json::to_string_pretty(args).unwrap_or_default()
            })
        }
        "delete_path" => {
            if let Some(paths) = args.get("paths").and_then(|v| v.as_array()) {
                json!({
                    "action": "批量删除",
                    "target": format!("{} 个路径", paths.len()),
                    "risk": "high",
                    "description": format!("将删除 {} 个文件或目录。此操作不可撤销！", paths.len()),
                    "args_detail": paths.iter().filter_map(|p| p.as_str()).collect::<Vec<_>>().join("\n")
                })
            } else {
                let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("未知");
                json!({
                    "action": "删除",
                    "target": path,
                    "risk": "high",
                    "description": format!("将删除：{}。此操作不可撤销！", path),
                    "args_detail": path.to_string()
                })
            }
        }
        "write_new_file" => {
            if let Some(files) = args.get("files").and_then(|v| v.as_array()) {
                let paths: Vec<&str> = files.iter().filter_map(|f| f.get("path").and_then(|v| v.as_str())).collect();
                json!({
                    "action": "批量写文件",
                    "target": format!("{} 个文件", files.len()),
                    "risk": "medium",
                    "description": format!("将写入 {} 个文件。如果文件已存在会被覆盖。", files.len()),
                    "args_detail": paths.join("\n")
                })
            } else {
                let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("未知");
                json!({
                    "action": "写文件",
                    "target": path,
                    "risk": "medium",
                    "description": format!("将在以下路径写入新文件：{}。如果文件已存在会被覆盖。", path),
                    "args_detail": path.to_string()
                })
            }
        }
        "download_file" => {
            if let Some(files) = args.get("files").and_then(|v| v.as_array()) {
                json!({
                    "action": "批量下载",
                    "target": format!("{} 个文件", files.len()),
                    "risk": "medium",
                    "description": format!("将从网络批量下载 {} 个文件到本地。", files.len()),
                    "args_detail": files.iter().filter_map(|f| {
                        let url = f.get("url").and_then(|v| v.as_str()).unwrap_or("?");
                        let dest = f.get("destination").and_then(|v| v.as_str()).unwrap_or("?");
                        Some(format!("{} → {}", url, dest))
                    }).collect::<Vec<_>>().join("\n")
                })
            } else {
                let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("未知");
                let dest = args.get("destination").and_then(|v| v.as_str()).unwrap_or("未知");
                json!({
                    "action": "下载",
                    "target": format!("{} → {}", url, dest),
                    "risk": "medium",
                    "description": format!("将从以下 URL 下载文件到本地：{}", url),
                    "args_detail": format!("URL: {}\n保存到: {}", url, dest)
                })
            }
        }
        "export_to_docx" => {
            let dest = args.get("destination").and_then(|v| v.as_str()).unwrap_or("?");
            json!({
                "action": "导出 Word",
                "target": dest,
                "risk": "medium",
                "description": format!("将内容导出为 Word 文档到 {}", dest),
                "args_detail": serde_json::to_string_pretty(&args).unwrap_or_default()
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
/// 同时合并外部 MCP 服务器提供的工具和浏览器工具
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
    // 合并浏览器工具（去重）— 只暴露只读工具 + 委托工具给本地 AI，不暴露 search_web/execute_js 等浏览器内部工具
    let desktop_browser_tools = crate::bridge::get_desktop_browser_tool_names();
    for bt in crate::bridge::get_browser_tool_definitions() {
        let name = bt["name"].as_str().unwrap_or("");
        if desktop_browser_tools.contains(&name) && !tools.iter().any(|t| t["name"].as_str() == Some(name)) {
            tools.push(bt);
        }
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

/// 获取全部工具清单（含权限状态），供前端自定义权限列表使用
///
/// 返回每个工具的名称、描述、类别、详细类型说明和当前权限状态。
#[tauri::command]
pub fn get_tool_permission_list(mcp: State<'_, McpClientManager>, app_handle: tauri::AppHandle) -> Vec<Value> {
    let mut items: Vec<Value> = Vec::new();

    // 1. 内置工具（按类别和类型分组）
    let builtin = crate::tools::get_tool_definitions();
    // 工具类型标签映射：tool_name → type_label
    let type_labels: std::collections::HashMap<&str, &str> = [
        ("get_file_info", "内置文件信息查询工具"),
        ("read_local_file", "内置文件读取工具"),
        ("write_new_file", "内置文件写入工具"),
        ("edit_file", "文件查找替换工具"),
        ("list_directory", "目录浏览工具"),
        ("create_directory", "目录创建工具"),
        ("rename_path", "文件/目录重命名工具"),
        ("delete_path", "文件/目录删除工具"),
        ("search_files", "文件搜索工具"),
        ("download_file", "网络文件下载工具"),
        ("export_to_docx", "导出 Word 文档工具"),
        ("open_path", "文件/路径打开工具"),
        ("run_command", "终端命令执行工具"),
        ("system_notify", "系统通知工具"),
        ("system_info", "系统信息查询工具"),
        ("get_env", "环境变量读取工具"),
        ("system_get_languages", "系统语言查询工具"),
        ("system_add_language", "系统语言添加工具"),
        ("list_processes", "进程列表查询工具"),
        ("list_windows", "窗口列表查询工具"),
        ("capture_screen", "屏幕截图工具"),
        ("fetch_url", "HTTP 网络请求工具"),
        ("clipboard_read", "剪贴板读取工具"),
        ("clipboard_write", "剪贴板写入工具"),
        ("ask_user", "用户交互工具（向用户提问）"),
        ("skill_list", "内置技能管理工具（列出技能）"),
        ("skill_create", "内置技能管理工具（创建技能）"),
        ("skill_read", "内置技能管理工具（读取技能）"),
        ("skill_search", "内置技能管理工具（搜索技能）"),
        ("skill_delete", "内置技能管理工具（删除技能）"),
    ].iter().cloned().collect();

    // 类别映射
    let categories: &[(&str, &[&str])] = &[
        ("文件操作", &["get_file_info", "read_local_file", "write_new_file", "edit_file"]),
        ("目录操作", &["list_directory", "create_directory", "rename_path", "delete_path", "search_files"]),
        ("网络/文件传输", &["download_file", "export_to_docx", "open_path"]),
        ("命令执行", &["run_command"]),
        ("系统通知", &["system_notify"]),
        ("系统信息", &["system_info", "get_env", "system_get_languages", "system_add_language", "list_processes", "list_windows", "capture_screen"]),
        ("网络请求", &["fetch_url"]),
        ("剪贴板", &["clipboard_read", "clipboard_write"]),
        ("用户交互", &["ask_user"]),
        ("技能管理", &["skill_list", "skill_create", "skill_read", "skill_search", "skill_delete"]),
    ];

    for tool in &builtin {
        let name = tool["name"].as_str().unwrap_or("");
        let desc = tool["description"].as_str().unwrap_or("");
        let short_desc = desc.lines().next().unwrap_or(desc);
        let mut cat = "其他";
        for (c, names) in categories {
            if names.contains(&name) {
                cat = c;
                break;
            }
        }
        let type_label = type_labels.get(name).copied().unwrap_or("内置工具");
        items.push(json!({
            "name": name,
            "description": short_desc,
            "category": cat,
            "source": "builtin",
            "type_label": type_label,
        }));
    }

    // 2. 浏览器工具（通过桥接）
    for bt in crate::bridge::get_browser_tool_definitions() {
        let name = bt["name"].as_str().unwrap_or("");
        let desc = bt["description"].as_str().unwrap_or("");
        items.push(json!({
            "name": name,
            "description": desc.lines().next().unwrap_or(desc),
            "category": "浏览器控制",
            "source": "bridge",
            "type_label": "浏览器工具（需连接 CeBian 扩展）",
        }));
    }

    // 3. MCP 工具
    for tool in mcp.get_tools() {
        items.push(json!({
            "name": tool.prefixed_name,
            "description": tool.description.lines().next().unwrap_or(&tool.description),
            "category": "MCP 服务",
            "source": "mcp",
            "type_label": "MCP 外部服务工具",
        }));
    }

    // 3. 技能工具
    if let Ok(skill_tools) = crate::tools::get_skill_tools(&app_handle) {
        for st in skill_tools {
            let name = st["name"].as_str().unwrap_or("");
            let desc = st["description"].as_str().unwrap_or("");
            items.push(json!({
                "name": name,
                "description": desc.lines().next().unwrap_or(desc),
                "category": "技能",
                "source": "skill",
                "type_label": "用户自定义技能（以 .md 文件形式存储）",
            }));
        }
    }

    items
}

/// 执行指定的工具
///
/// # 参数
/// * `name` - 工具名称
/// * `args` - 工具参数（JSON 对象）
/// * `permission_mode` - 权限模式（conservative / balanced / trusted / custom），可选
///
/// # 返回
/// 工具执行结果（JSON 格式）
#[tauri::command]
pub async fn execute_tool(name: String, args: Value, permission_mode: Option<String>, mcp: State<'_, McpClientManager>, bridge_state: State<'_, Arc<BridgeState>>, app_handle: tauri::AppHandle) -> Result<Value, String> {
    let mode = permission_mode.as_deref().unwrap_or("safe");

    // ═══ 按安全模式判断是否需要确认 ═══
    // safe → 写/删/执行操作需确认；trusted → 自动放行
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

    // ═══ 浏览器工具（通过桥接发送到 CeBian 扩展执行）═══
    if crate::bridge::get_browser_tool_names().contains(&name.as_str()) {
        // 从参数中提取 browser_name，传给桥接执行
        let browser_name = args.get("browser_name").and_then(|v| v.as_str());
        let mut clean_args = args.clone();
        if let Some(obj) = clean_args.as_object_mut() {
            obj.remove("browser_name");
        }
        return crate::bridge::execute_browser_tool(&bridge_state, &name, &clean_args, browser_name, Some(&app_handle)).await;
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
        "skill_search" => {
            let query = args.get("query").and_then(|v| v.as_str()).ok_or("缺少 query 参数")?.to_lowercase();
            let files = workspace::list_files(&app_handle, workspace::WorkspaceDir::Skills)?;
            let mut results = Vec::new();
            for f in &files {
                if f.filename.ends_with('/') { continue; }
                let name_match = f.name.to_lowercase().contains(&query);
                let content_match = f.content.to_lowercase().contains(&query);
                if name_match || content_match {
                    let snippet = if content_match {
                        extract_snippet(&f.content, &query, 120)
                    } else {
                        String::new()
                    };
                    results.push(json!({
                        "name": f.name,
                        "description": f.description,
                        "filename": f.filename,
                        "match_type": if name_match && content_match { "both" } else if name_match { "name" } else { "content" },
                        "snippet": snippet,
                    }));
                }
            }
            return Ok(json!({
                "query": args.get("query").and_then(|v| v.as_str()).unwrap_or(""),
                "results": results,
                "count": results.len(),
            }))
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
        return crate::tools::execute_skill(&app_handle, &name, &args);
    }

    // 内置工具
    let name_clone = name.clone();
    let args_clone = args.clone();
    let app_clone = app_handle.clone();
    let result = tokio::task::spawn_blocking(move || {
        crate::tools::execute_tool(&name_clone, &args_clone, Some(&app_clone))
    })
    .await;

    match result {
        Ok(Ok(val)) => Ok(val),
        Ok(Err(e)) => {
            if e.starts_with("未知工具:") {
                // 内置工具未命中 → 尝试作为技能执行
                crate::tools::execute_skill(&app_handle, &name, &args)
            } else {
                // 内置工具命中但执行失败 → 返回真实错误信息
                Err(e)
            }
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

    // 内置工具（带路径沙箱）
    let name_clone = tool_name.clone();
    let args_clone = args.clone();
    let app_clone = app_handle.clone();
    let result = tokio::task::spawn_blocking(move || {
        crate::tools::execute_tool(&name_clone, &args_clone, Some(&app_clone))
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
        "skill_search" => {
            let query = args.get("query").and_then(|v| v.as_str()).ok_or("缺少 query 参数")?.to_lowercase();
            let files = workspace::list_files(app_handle, workspace::WorkspaceDir::Skills)?;
            let mut results = Vec::new();
            for f in &files {
                if f.filename.ends_with('/') { continue; }
                let name_match = f.name.to_lowercase().contains(&query);
                let content_match = f.content.to_lowercase().contains(&query);
                if name_match || content_match {
                    let snippet = if content_match {
                        extract_snippet(&f.content, &query, 120)
                    } else {
                        String::new()
                    };
                    results.push(json!({
                        "name": f.name,
                        "description": f.description,
                        "filename": f.filename,
                        "match_type": if name_match && content_match { "both" } else if name_match { "name" } else { "content" },
                        "snippet": snippet,
                    }));
                }
            }
            Ok(json!({
                "query": args.get("query").and_then(|v| v.as_str()).unwrap_or(""),
                "results": results,
                "count": results.len(),
            }))
        }
        _ => Err(format!("未知工具: {}", name)),
    }
}

/// 从文本中提取匹配关键词的上下文片段
fn extract_snippet(text: &str, query: &str, max_len: usize) -> String {
    let lower = text.to_lowercase();
    if let Some(pos) = lower.find(query) {
        let start = if pos > max_len / 2 { pos - max_len / 2 } else { 0 };
        let end = std::cmp::min(start + max_len, text.len());
        let mut snippet: String = text[start..end].to_string();
        if start > 0 { snippet.insert_str(0, "..."); }
        if end < text.len() { snippet.push_str("..."); }
        snippet
    } else {
        text.chars().take(max_len).collect()
    }
}
