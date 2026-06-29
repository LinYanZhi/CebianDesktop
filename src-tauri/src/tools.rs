//! 本地工具实现
//!
//! 提供文件操作、系统查询、截图、通知等本地工具

use std::fs;
use std::io::Read;
use std::path::Path;
use std::process::Command;

use serde_json::{json, Value};
use walkdir::WalkDir;

macro_rules! td {
    ($name:expr, $desc:expr, $props:expr, [$($req:expr),* $(,)?]) => {
        tool_def($name, $desc, props($props), vec![$($req),*])
    };
    ($name:expr, $desc:expr, $props:expr, []) => {
        tool_def($name, $desc, props($props), vec![])
    };
}

/// 获取所有工具定义列表
pub fn get_tool_definitions() -> Vec<Value> {
    vec![
        // ─── 文件读取 ───
        td!("read_local_file", "读取本地文件内容",
            &[("path", "string", "要读取的文件路径（绝对路径）")], ["path"]),
        // ─── 文件写入 ───
        td!("write_new_file", "写入内容到文件（若文件已存在则覆盖）",
            &[("path", "string", "文件路径（绝对路径）"), ("content", "string", "文件内容")], ["path", "content"]),
        // ─── 文件编辑 ───
        td!("edit_file", "编辑文件：精确查找替换指定字符串",
            &[("path", "string", "文件路径"), ("old_text", "string", "要被替换的文本"), ("new_text", "string", "替换后的文本")], ["path", "old_text", "new_text"]),
        // ─── 目录操作 ───
        td!("create_directory", "创建目录（递归创建父目录）",
            &[("path", "string", "目录路径（绝对路径）")], ["path"]),
        td!("list_directory", "列出目录中的文件和子目录",
            &[("path", "string", "要列出的目录路径（绝对路径）")], ["path"]),
        // ─── 重命名/移动 ───
        td!("rename_path", "重命名或移动文件/目录",
            &[("old_path", "string", "原路径"), ("new_path", "string", "新路径")], ["old_path", "new_path"]),
        // ─── 删除 ───
        td!("delete_path", "删除文件或目录（目录递归删除）",
            &[("path", "string", "要删除的路径")], ["path"]),
        // ─── 文件搜索 ───
        td!("search_files", "按名称或内容搜索文件",
            &[("directory", "string", "搜索起始目录"), ("pattern", "string", "搜索关键词"), ("mode", "string", "搜索模式: 'name'(按文件名) 或 'content'(按内容)")], ["directory", "pattern"]),
        // ─── 下载 ───
        td!("download_file", "从 URL 下载文件到本地",
            &[("url", "string", "文件下载 URL"), ("destination", "string", "保存路径（绝对路径）")], ["url", "destination"]),
        // ─── 打开文件/目录 ───
        td!("open_path", "使用系统默认程序打开文件或目录",
            &[("path", "string", "要打开的文件或目录路径")], ["path"]),
        // ─── 执行命令 ───
        td!("run_command", "在终端中执行命令并返回输出",
            &[("command", "string", "要执行的命令"), ("cwd", "string", "工作目录（可选）")], ["command"]),
        // ─── 网络请求 ───
        td!("fetch_url", "发起 HTTP 请求获取 URL 内容",
            &[("url", "string", "请求 URL"), ("method", "string", "HTTP 方法 (GET/POST)，默认 GET"), ("body", "string", "请求体（POST 时使用）")], ["url"]),
        // ─── 剪贴板 ───
        td!("clipboard_read", "读取系统剪贴板文本内容",
            &[], []),
        td!("clipboard_write", "写入文本内容到系统剪贴板",
            &[("text", "string", "要写入的文本")], ["text"]),
        // ─── 系统信息 ───
        td!("system_info", "获取系统信息（操作系统、主机名、CPU、内存、磁盘等）",
            &[], []),
        // ─── 进程列表 ───
        td!("list_processes", "列出正在运行的进程（可按名称过滤）",
            &[("name_filter", "string", "进程名过滤关键词（可选）")], []),
        // ─── 窗口列表 ───
        td!("list_windows", "列出当前打开的窗口",
            &[], []),
        // ─── 截屏 ───
        td!("capture_screen", "截取屏幕并保存为图片",
            &[("save_path", "string", "截图保存路径（PNG 格式）")], ["save_path"]),
        // ─── 系统通知 ───
        td!("system_notify", "发送系统通知",
            &[("title", "string", "通知标题"), ("message", "string", "通知内容")], ["title", "message"]),
    ]
}

fn tool_def(name: &str, description: &str, props: Value, required: Vec<&str>) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": props,
            "required": required
        }
    })
}

fn props(entries: &[(&str, &str, &str)]) -> Value {
    let map: serde_json::Map<String, Value> = entries
        .iter()
        .map(|(k, typ, desc)| {
            (k.to_string(), json!({"type": typ, "description": desc}))
        })
        .collect();
    Value::Object(map)
}

/// 执行工具
pub fn execute_tool(name: &str, args: &Value) -> Result<Value, String> {
    match name {
        "read_local_file" => {
            let path = arg_str(args, "path")?;
            Ok(json!({"content": read_local_file(path)?}))
        }
        "write_new_file" => {
            let path = arg_str(args, "path")?;
            let content = arg_str(args, "content")?;
            write_new_file(path, content)?;
            Ok(json!({"message": format!("文件已写入: {}", path)}))
        }
        "edit_file" => {
            let path = arg_str(args, "path")?;
            let old_text = arg_str(args, "old_text")?;
            let new_text = arg_str(args, "new_text")?;
            let replacements = edit_file(path, old_text, new_text)?;
            Ok(json!({"message": format!("完成替换，共 {} 处", replacements), "replacements": replacements}))
        }
        "create_directory" => {
            let path = arg_str(args, "path")?;
            create_directory(path)?;
            Ok(json!({"message": format!("目录已创建: {}", path)}))
        }
        "list_directory" => {
            let path = arg_str(args, "path")?;
            Ok(json!({"entries": list_directory(path)?}))
        }
        "rename_path" => {
            let old_path = arg_str(args, "old_path")?;
            let new_path = arg_str(args, "new_path")?;
            rename_path(old_path, new_path)?;
            Ok(json!({"message": format!("已重命名: {} -> {}", old_path, new_path)}))
        }
        "delete_path" => {
            let path = arg_str(args, "path")?;
            fs_delete(path)?;
            Ok(json!({"message": format!("已删除: {}", path)}))
        }
        "search_files" => {
            let directory = arg_str(args, "directory")?;
            let pattern = arg_str(args, "pattern")?;
            let mode = args.get("mode").and_then(|v| v.as_str()).unwrap_or("name");
            let results = search_files(directory, pattern, mode)?;
            Ok(json!({"results": results, "count": results.len()}))
        }
        "download_file" => {
            let url = arg_str(args, "url")?;
            let destination = arg_str(args, "destination")?;
            let result = download_file(url, destination)?;
            Ok(json!({"message": result}))
        }
        "open_path" => {
            let path = arg_str(args, "path")?;
            let result = open_path(path)?;
            Ok(json!({"message": result}))
        }
        "open_file" => {
            // 兼容旧名称
            let path = arg_str(args, "path")?;
            let result = open_path(path)?;
            Ok(json!({"message": result}))
        }
        "run_command" => {
            let cmd = arg_str(args, "command")?;
            let cwd = args.get("cwd").and_then(|v| v.as_str());
            let output = run_command(cmd, cwd)?;
            Ok(json!({"output": output}))
        }
        "fetch_url" => {
            let url = arg_str(args, "url")?;
            let method = args.get("method").and_then(|v| v.as_str()).unwrap_or("GET");
            let body = args.get("body").and_then(|v| v.as_str());
            let result = fetch_url(url, method, body)?;
            Ok(json!({"content": result}))
        }
        "clipboard_read" => {
            let text = clipboard_read()?;
            Ok(json!({"text": text}))
        }
        "clipboard_write" => {
            let text = arg_str(args, "text")?;
            clipboard_write(text)?;
            Ok(json!({"message": "已写入剪贴板"}))
        }
        "system_info" => {
            let info = system_info()?;
            Ok(info)
        }
        "list_processes" => {
            let filter = args.get("name_filter").and_then(|v| v.as_str());
            let processes = list_processes(filter)?;
            Ok(json!({"processes": processes, "count": processes.len()}))
        }
        "list_windows" => {
            let windows = list_windows()?;
            Ok(json!({"windows": windows, "count": windows.len()}))
        }
        "capture_screen" => {
            let save_path = arg_str(args, "save_path")?;
            capture_screen(save_path)?;
            Ok(json!({"message": format!("截图已保存: {}", save_path)}))
        }
        "system_notify" => {
            let title = arg_str(args, "title")?;
            let message = arg_str(args, "message")?;
            system_notify(title, message)?;
            Ok(json!({"message": "通知已发送"}))
        }
        _ => Err(format!("未知工具: {}", name)),
    }
}

fn arg_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("缺少 {} 参数", key))
}

// ─── 文件读写 ──────────────────────────────────────────

fn read_local_file(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if !p.exists() { return Err(format!("文件不存在: {}", path)); }
    fs::read_to_string(p).map_err(|e| format!("读取失败: {}", e))
}

fn write_new_file(path: &str, content: &str) -> Result<(), String> {
    let p = Path::new(path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(p, content).map_err(|e| format!("写入失败: {}", e))
}

fn edit_file(path: &str, old_text: &str, new_text: &str) -> Result<usize, String> {
    let original = read_local_file(path)?;
    if !original.contains(old_text) {
        return Err("文件中未找到要替换的文本".into());
    }
    let edited = original.replace(old_text, new_text);
    // 统计替换数
    let count = original.matches(old_text).count();
    write_new_file(path, &edited)?;
    Ok(count)
}

// ─── 目录操作 ───────────────────────────────────────────

fn create_directory(path: &str) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("创建目录失败: {}", e))
}

fn list_directory(path: &str) -> Result<Vec<Value>, String> {
    let dir = Path::new(path);
    if !dir.is_dir() { return Err(format!("不是目录: {}", path)); }
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("读取目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let ft = entry.file_type().map_err(|e| format!("获取类型失败: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        entries.push(json!({
            "name": name,
            "is_dir": ft.is_dir(),
            "is_file": ft.is_file(),
        }));
    }
    entries.sort_by(|a, b| {
        let an = a["name"].as_str().unwrap_or("");
        let bn = b["name"].as_str().unwrap_or("");
        // 目录优先
        let a_dir = a["is_dir"].as_bool().unwrap_or(false);
        let b_dir = b["is_dir"].as_bool().unwrap_or(false);
        b_dir.cmp(&a_dir).then(an.to_lowercase().cmp(&bn.to_lowercase()))
    });
    Ok(entries)
}

fn rename_path(old_path: &str, new_path: &str) -> Result<(), String> {
    if !Path::new(old_path).exists() { return Err(format!("路径不存在: {}", old_path)); }
    if let Some(parent) = Path::new(new_path).parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
    }
    fs::rename(old_path, new_path).map_err(|e| format!("重命名失败: {}", e))
}

fn fs_delete(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.exists() { return Err(format!("路径不存在: {}", path)); }
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| format!("删除目录失败: {}", e))
    } else {
        fs::remove_file(p).map_err(|e| format!("删除文件失败: {}", e))
    }
}

fn search_files(directory: &str, pattern: &str, mode: &str) -> Result<Vec<Value>, String> {
    let dir = Path::new(directory);
    if !dir.is_dir() { return Err(format!("不是目录: {}", directory)); }

    let mut results = Vec::new();
    let pattern_lower = pattern.to_lowercase();
    let max_results = 50;

    for entry in WalkDir::new(dir).max_depth(10).into_iter().filter_map(|e| e.ok()) {
        if results.len() >= max_results { break; }
        let path = entry.path();
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_lowercase();

        match mode {
            "content" => {
                if entry.file_type().is_file() {
                    if let Ok(content) = fs::read_to_string(path) {
                        let content_lower = content.to_lowercase();
                        if content_lower.contains(&pattern_lower) {
                            // 找到关键词所在行
                            let matched_lines: Vec<String> = content
                                .lines()
                                .filter(|l| l.to_lowercase().contains(&pattern_lower))
                                .take(3)
                                .map(|l| l.trim().to_string())
                                .collect();
                            results.push(json!({
                                "path": path.display().to_string(),
                                "matched_lines": matched_lines,
                            }));
                        }
                    }
                }
            }
            _ => {
                // "name" 模式
                if name.contains(&pattern_lower) {
                    results.push(json!({
                        "path": path.display().to_string(),
                        "is_dir": entry.file_type().is_dir(),
                    }));
                }
            }
        }
    }
    Ok(results)
}

// ─── 下载 ────────────────────────────────────────────────

fn download_file(url: &str, destination: &str) -> Result<String, String> {
    let resp = ureq::get(url).call().map_err(|e| format!("下载失败: {}", e))?;
    let mut body: Vec<u8> = Vec::new();
    resp.into_reader().read_to_end(&mut body).map_err(|e| format!("读取响应失败: {}", e))?;
    let dest = Path::new(destination);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(dest, &body).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(format!("已下载到: {}", destination))
}

// ─── 打开 ────────────────────────────────────────────────

fn open_path(path: &str) -> Result<String, String> {
    if !Path::new(path).exists() { return Err(format!("路径不存在: {}", path)); }
    Command::new("cmd").args(["/C", "start", "", path])
        .spawn().map_err(|e| format!("打开失败: {}", e))?;
    Ok(format!("已打开: {}", path))
}

// ─── 命令执行 ────────────────────────────────────────────

fn run_command(cmd: &str, cwd: Option<&str>) -> Result<String, String> {
    let shell = if cfg!(windows) { "cmd" } else { "sh" };
    let shell_arg = if cfg!(windows) { "/C" } else { "-c" };

    let mut command = Command::new(shell);
    command.args([shell_arg, cmd]);

    if let Some(dir) = cwd {
        command.current_dir(dir);
    }

    let output = command.output().map_err(|e| format!("执行失败: {}", e))?;

    let mut result = String::new();
    if !output.stdout.is_empty() {
        result.push_str(&String::from_utf8_lossy(&output.stdout));
    }
    if !output.stderr.is_empty() {
        if !result.is_empty() { result.push('\n'); }
        result.push_str("STDERR:\n");
        result.push_str(&String::from_utf8_lossy(&output.stderr));
    }

    Ok(result.trim().to_string())
}

// ─── 网络请求 ────────────────────────────────────────────

fn fetch_url(url: &str, method: &str, body: Option<&str>) -> Result<String, String> {
    let resp = match method.to_uppercase().as_str() {
        "POST" => {
            ureq::post(url)
                .set("Content-Type", "application/json")
                .send_string(body.unwrap_or(""))
                .map_err(|e| format!("请求失败: {}", e))?
        }
        _ => {
            ureq::get(url).call().map_err(|e| format!("请求失败: {}", e))?
        }
    };
    resp.into_string().map_err(|e| format!("读取响应失败: {}", e))
}

// ─── 剪贴板 ──────────────────────────────────────────────

fn clipboard_read() -> Result<String, String> {
    clipboard_win::get_clipboard_string().map_err(|e| format!("读取剪贴板失败: {}", e))
}

fn clipboard_write(text: &str) -> Result<(), String> {
    let _clip = clipboard_win::Clipboard::new().map_err(|e| format!("打开剪贴板失败: {}", e))?;
    clipboard_win::set_clipboard_string(text).map_err(|e| format!("写入剪贴板失败: {}", e))
}

// ─── 系统信息 ────────────────────────────────────────────

fn system_info() -> Result<Value, String> {
    use sysinfo::System;

    let os_info = format!("{} {}", std::env::consts::OS, std::env::consts::ARCH);
    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "未知".into());

    let mut sys = System::new_all();
    sys.refresh_all();

    // CPU
    let cpu_count = sys.cpus().len();
    let cpu_name = sys.cpus().first().map(|c| c.brand().to_string()).unwrap_or_else(|| "未知".into());

    // 内存
    let total_mem_gb = sys.total_memory() as f64 / (1024.0 * 1024.0 * 1024.0);
    let used_mem_gb = sys.used_memory() as f64 / (1024.0 * 1024.0 * 1024.0);

    // 磁盘
    let mut disks = Vec::new();
    for disk in sysinfo::Disks::new_with_refreshed_list().list() {
        let total_gb = disk.total_space() as f64 / (1024.0 * 1024.0 * 1024.0);
        let avail_gb = disk.available_space() as f64 / (1024.0 * 1024.0 * 1024.0);
        disks.push(json!({
            "mount": disk.mount_point().display().to_string(),
            "name": disk.name().to_string_lossy(),
            "total_gb": format!("{:.1}", total_gb),
            "available_gb": format!("{:.1}", avail_gb),
        }));
    }

    Ok(json!({
        "os": os_info,
        "hostname": hostname,
        "cpu": { "name": cpu_name, "cores": cpu_count },
        "memory": { "total_gb": format!("{:.1}", total_mem_gb), "used_gb": format!("{:.1}", used_mem_gb) },
        "disks": disks,
        "username": std::env::var("USERNAME").unwrap_or_default(),
        "computer_name": std::env::var("COMPUTERNAME").unwrap_or_default(),
    }))
}

// ─── 进程列表 ────────────────────────────────────────────

fn list_processes(name_filter: Option<&str>) -> Result<Vec<Value>, String> {
    use sysinfo::System;
    let mut sys = System::new_all();
    sys.refresh_all();

    let filter_lower = name_filter.map(|f| f.to_lowercase());
    let mut results = Vec::new();

    for (pid, proc) in sys.processes() {
        let name = proc.name().to_string_lossy().to_string();
        if let Some(ref f) = filter_lower {
            if !name.to_lowercase().contains(f) { continue; }
        }
        let mem_mb = proc.memory() as f64 / (1024.0 * 1024.0);
        let cpu_pct = proc.cpu_usage();
        results.push(json!({
            "pid": pid.as_u32(),
            "name": name,
            "memory_mb": format!("{:.1}", mem_mb),
            "cpu_percent": format!("{:.1}", cpu_pct),
        }));
    }

    results.sort_by(|a, b| {
        let am = a["memory_mb"].as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
        let bm = b["memory_mb"].as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
        bm.partial_cmp(&am).unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(results.into_iter().take(40).collect())
}

// ─── 窗口列表 ────────────────────────────────────────────

fn list_windows() -> Result<Vec<Value>, String> {
    // PowerShell 获取有标题的窗口
    let ps_script = r#"
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWinProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    public delegate bool EnumWinProc(IntPtr hWnd, IntPtr lParam);
}
"@
$windows = @()
$callback = [Win+EnumWinProc]{
    param($hWnd, $lParam)
    if ([Win]::IsWindowVisible($hWnd)) {
        $sb = New-Object System.Text.StringBuilder(256)
        [Win]::GetWindowText($hWnd, $sb, 256)
        $title = $sb.ToString()
        if ($title.Length -gt 0) {
            $windows += @{title=$title;hwnd=$hWnd.ToString()}
        }
    }
    return $true
}
[Win]::EnumWindows($callback, [IntPtr]::Zero)
$windows | ConvertTo-Json
"#;

    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", ps_script])
        .output()
        .map_err(|e| format!("获取窗口列表失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if stdout.trim().is_empty() {
        return Ok(Vec::new());
    }

    let windows: Vec<Value> = serde_json::from_str(&stdout).unwrap_or_default();
    Ok(windows.into_iter().take(30).collect())
}

// ─── 截屏 ────────────────────────────────────────────────

fn capture_screen(save_path: &str) -> Result<(), String> {
    if !save_path.to_lowercase().ends_with(".png") {
        return Err("截图格式仅支持 PNG，路径必须以 .png 结尾".into());
    }
    if let Some(parent) = Path::new(save_path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
    }

    let ps_script = format!(r#"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bounds = $screen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$g.Dispose()
$bmp.Save('{}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"#, save_path.replace("'", "''"));

    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &ps_script])
        .output()
        .map_err(|e| format!("截图失败: {}", e))?;

    if output.status.success() && Path::new(save_path).exists() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("截图失败: {}", stderr.trim()))
    }
}

// ─── 系统通知 ────────────────────────────────────────────

fn system_notify(title: &str, message: &str) -> Result<(), String> {
    notify_rust::Notification::new()
        .summary(title)
        .body(message)
        .appname("CebianDesktop")
        .show()
        .map_err(|e| format!("发送通知失败: {}", e))?;
    Ok(())
}
