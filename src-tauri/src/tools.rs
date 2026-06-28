//! MCP 工具实现
//!
//! 提供各种本地工具函数，包括文件操作、剪贴板操作、系统信息查询等

use std::fs;
use std::io::Read;
use std::path::Path;
use std::process::Command;

use serde_json::{json, Value};

/// 获取所有 MCP 工具定义列表
///
/// 每个工具定义包含名称、描述和输入参数 schema
pub fn get_tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "read_local_file",
            "description": "读取本地文件内容",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "要读取的文件路径（绝对路径）"
                    }
                },
                "required": ["path"]
            }
        }),
        json!({
            "name": "list_directory",
            "description": "列出目录中的文件和子目录",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "要列出的目录路径（绝对路径）"
                    }
                },
                "required": ["path"]
            }
        }),
        json!({
            "name": "download_file",
            "description": "从 URL 下载文件到本地",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "文件下载 URL"
                    },
                    "destination": {
                        "type": "string",
                        "description": "保存路径（绝对路径）"
                    }
                },
                "required": ["url", "destination"]
            }
        }),
        json!({
            "name": "open_file",
            "description": "使用系统默认程序打开文件或目录",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "要打开的文件或目录路径（绝对路径）"
                    }
                },
                "required": ["path"]
            }
        }),
        json!({
            "name": "run_command",
            "description": "在终端中执行命令并返回输出结果",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "要执行的命令"
                    }
                },
                "required": ["command"]
            }
        }),
        json!({
            "name": "write_new_file",
            "description": "写入内容到新文件（若文件已存在则覆盖）",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "文件路径（绝对路径）"
                    },
                    "content": {
                        "type": "string",
                        "description": "文件内容"
                    }
                },
                "required": ["path", "content"]
            }
        }),
        json!({
            "name": "clipboard_read",
            "description": "读取系统剪贴板文本内容",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        }),
        json!({
            "name": "clipboard_write",
            "description": "写入文本内容到系统剪贴板",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "要写入剪贴板的文本"
                    }
                },
                "required": ["text"]
            }
        }),
        json!({
            "name": "system_info",
            "description": "获取系统信息（操作系统、主机名、CPU、内存等）",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        }),
    ]
}

/// 根据工具名称和参数执行对应的工具函数
///
/// # 参数
/// * `name` - 工具名称
/// * `args` - 工具参数（JSON 对象）
///
/// # 返回
/// 执行结果（JSON 格式）
pub fn execute_tool(name: &str, args: &Value) -> Result<Value, String> {
    match name {
        "read_local_file" => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or("缺少 path 参数")?;
            let content = read_local_file(path)?;
            Ok(json!({"content": content}))
        }
        "list_directory" => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or("缺少 path 参数")?;
            let entries = list_directory(path)?;
            Ok(json!({"entries": entries}))
        }
        "download_file" => {
            let url = args
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or("缺少 url 参数")?;
            let destination = args
                .get("destination")
                .and_then(|v| v.as_str())
                .ok_or("缺少 destination 参数")?;
            let result = download_file(url, destination)?;
            Ok(json!({"message": result}))
        }
        "open_file" => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or("缺少 path 参数")?;
            let result = open_file(path)?;
            Ok(json!({"message": result}))
        }
        "run_command" => {
            let cmd = args
                .get("command")
                .and_then(|v| v.as_str())
                .ok_or("缺少 command 参数")?;
            let output = run_command(cmd)?;
            Ok(json!({"output": output}))
        }
        "write_new_file" => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or("缺少 path 参数")?;
            let content = args
                .get("content")
                .and_then(|v| v.as_str())
                .ok_or("缺少 content 参数")?;
            write_new_file(path, content)?;
            Ok(json!({"message": format!("文件已写入: {}", path)}))
        }
        "clipboard_read" => {
            let text = clipboard_read()?;
            Ok(json!({"text": text}))
        }
        "clipboard_write" => {
            let text = args
                .get("text")
                .and_then(|v| v.as_str())
                .ok_or("缺少 text 参数")?;
            clipboard_write(text)?;
            Ok(json!({"message": "已写入剪贴板"}))
        }
        "system_info" => {
            let info = system_info()?;
            Ok(info)
        }
        _ => Err(format!("未知工具: {}", name)),
    }
}

/// 读取本地文件内容
fn read_local_file(path: &str) -> Result<String, String> {
    let resolved_path = Path::new(path);
    if !resolved_path.exists() {
        return Err(format!("文件不存在: {}", path));
    }
    fs::read_to_string(resolved_path).map_err(|e| format!("读取文件失败: {}", e))
}

/// 列出目录中的文件和子目录
fn list_directory(path: &str) -> Result<Vec<Value>, String> {
    let dir = Path::new(path);
    if !dir.is_dir() {
        return Err(format!("路径不是目录: {}", path));
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("读取目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let file_type = entry.file_type().map_err(|e| format!("获取文件类型失败: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();

        entries.push(json!({
            "name": name,
            "is_dir": file_type.is_dir(),
            "is_file": file_type.is_file(),
            "is_symlink": file_type.is_symlink(),
        }));
    }

    // 按名称排序
    entries.sort_by(|a, b| {
        let a_name = a["name"].as_str().unwrap_or("");
        let b_name = b["name"].as_str().unwrap_or("");
        a_name.cmp(b_name)
    });

    Ok(entries)
}

/// 从 URL 下载文件到本地
fn download_file(url: &str, destination: &str) -> Result<String, String> {
    let resp = ureq::get(url)
        .call()
        .map_err(|e| format!("下载文件失败: {}", e))?;

    let mut body: Vec<u8> = Vec::new();
    resp.into_reader()
        .read_to_end(&mut body)
        .map_err(|e| format!("读取响应体失败: {}", e))?;

    let dest_path = Path::new(destination);
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    fs::write(dest_path, &body).map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(format!("文件已下载到: {}", destination))
}

/// 使用系统默认程序打开文件或目录
fn open_file(path: &str) -> Result<String, String> {
    let resolved_path = Path::new(path);
    if !resolved_path.exists() {
        return Err(format!("路径不存在: {}", path));
    }

    // Windows 下使用 cmd /c start 打开文件
    Command::new("cmd")
        .args(["/C", "start", "", path])
        .spawn()
        .map_err(|e| format!("打开文件失败: {}", e))?;

    Ok(format!("已打开: {}", path))
}

/// 在终端中执行命令并返回输出
fn run_command(cmd: &str) -> Result<String, String> {
    let output = Command::new("cmd")
        .args(["/C", cmd])
        .output()
        .map_err(|e| format!("执行命令失败: {}", e))?;

    let mut result = String::new();

    if !output.stdout.is_empty() {
        result.push_str(&String::from_utf8_lossy(&output.stdout));
    }

    if !output.stderr.is_empty() {
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str("STDERR:\n");
        result.push_str(&String::from_utf8_lossy(&output.stderr));
    }

    if !output.status.success() && result.is_empty() {
        result = format!("命令退出码: {}", output.status.code().unwrap_or(-1));
    }

    Ok(result.trim().to_string())
}

/// 写入内容到新文件（若文件已存在则覆盖）
fn write_new_file(path: &str, content: &str) -> Result<(), String> {
    let dest_path = Path::new(path);
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    fs::write(dest_path, content).map_err(|e| format!("写入文件失败: {}", e))
}

/// 读取系统剪贴板文本内容
fn clipboard_read() -> Result<String, String> {
    clipboard_win::get_clipboard_string()
        .map_err(|e| format!("读取剪贴板失败: {}", e))
}

/// 写入文本内容到系统剪贴板
fn clipboard_write(text: &str) -> Result<(), String> {
    // clipboard_win 的 set_clipboard_string 需要 Clipboard 上下文
    let _clip = clipboard_win::Clipboard::new()
        .map_err(|e| format!("打开剪贴板失败: {}", e))?;

    clipboard_win::set_clipboard_string(text)
        .map_err(|e| format!("写入剪贴板失败: {}", e))
}

/// 获取系统信息
fn system_info() -> Result<Value, String> {
    let os_info = format!("{} {}", std::env::consts::OS, std::env::consts::ARCH);

    let hostname = get_hostname();
    let cpu_info = get_cpu_info();
    let memory_info = get_memory_info();

    Ok(json!({
        "os": os_info,
        "hostname": hostname,
        "cpu": cpu_info,
        "memory": memory_info,
        "username": std::env::var("USERNAME").unwrap_or_default(),
        "computer_name": std::env::var("COMPUTERNAME").unwrap_or_default(),
    }))
}

/// 获取主机名
fn get_hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "未知".to_string())
}

/// 获取 CPU 信息（使用 Windows 注册表）
fn get_cpu_info() -> Value {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_LOCAL_MACHINE;
        use winreg::RegKey;

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        if let Ok(key) = hklm.open_subkey("HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0") {
            let name: String = key.get_value("ProcessorNameString").unwrap_or_default();
            let cores: u32 = key.get_value("NumberOfEnabledCoreCount").unwrap_or(0);
            return json!({
                "name": name.trim(),
                "cores": cores,
            });
        }
    }

    json!({
        "name": "未知",
        "cores": 0,
    })
}

/// 获取内存信息
fn get_memory_info() -> Value {
    // 通过系统命令获取内存信息（跨平台兼容方式）
    let output = Command::new("cmd")
        .args(["/C", "wmic OS get TotalVisibleMemorySize,FreePhysicalMemory /format:csv"])
        .output()
        .ok();

    if let Some(output) = output {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let lines: Vec<&str> = stdout.lines().collect();
        if lines.len() >= 2 {
            let parts: Vec<&str> = lines[1].split(',').collect();
            if parts.len() >= 3 {
                let total_kb: u64 = parts[1].trim().parse().unwrap_or(0);
                let free_kb: u64 = parts[2].trim().parse().unwrap_or(0);
                return json!({
                    "total_gb": total_kb as f64 / (1024.0 * 1024.0),
                    "free_gb": free_kb as f64 / (1024.0 * 1024.0),
                    "total_kb": total_kb,
                    "free_kb": free_kb,
                });
            }
        }
    }

    json!({
        "total_gb": "未知",
        "free_gb": "未知",
    })
}
