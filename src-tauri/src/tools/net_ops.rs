use std::fs;
use std::io::Read;
use std::path::Path;
use std::process::Command;

// ─── 下载 ────────────────────────────────────────────────

pub(crate) fn download_file(url: &str, destination: &str) -> Result<String, String> {
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

pub(crate) fn open_path(path: &str) -> Result<String, String> {
    if !Path::new(path).exists() { return Err(format!("路径不存在: {}", path)); }
    Command::new("cmd").args(["/C", "start", "", path])
        .spawn().map_err(|e| format!("打开失败: {}", e))?;
    Ok(format!("已打开: {}", path))
}

// ─── 命令执行 ────────────────────────────────────────────

pub(crate) fn run_command(cmd: &str, cwd: Option<&str>) -> Result<String, String> {
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

pub(crate) fn fetch_url(url: &str, method: &str, body: Option<&str>) -> Result<String, String> {
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

pub(crate) fn clipboard_read() -> Result<String, String> {
    clipboard_win::get_clipboard_string().map_err(|e| format!("读取剪贴板失败: {}", e))
}

pub(crate) fn clipboard_write(text: &str) -> Result<(), String> {
    let _clip = clipboard_win::Clipboard::new().map_err(|e| format!("打开剪贴板失败: {}", e))?;
    clipboard_win::set_clipboard_string(text).map_err(|e| format!("写入剪贴板失败: {}", e))
}
