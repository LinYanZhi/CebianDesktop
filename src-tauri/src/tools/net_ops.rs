use std::env;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::Emitter;

// ─── 工具函数 ─────────────────────────────────────────────

/// 解码命令输出：先试 UTF-8，失败则试 GBK（中文 Windows 的 cmd.exe 输出）
fn decode_output(bytes: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    let (cow, _, _) = encoding_rs::GBK.decode(bytes);
    cow.to_string()
}

/// 模拟 Chrome 120 的请求头
const CHROME_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                         (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

fn browser_headers() -> Vec<(&'static str, &'static str)> {
    vec![
        ("Accept", "*/*"),
        ("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8"),
        (
            "Sec-Ch-Ua",
            "\"Not_A Brand\";v=\"8\", \"Chromium\";v=\"120\", \"Google Chrome\";v=\"120\"",
        ),
        ("Sec-Ch-Ua-Mobile", "?0"),
        ("Sec-Ch-Ua-Platform", "\"Windows\""),
        ("Sec-Fetch-Site", "none"),
        ("Sec-Fetch-Mode", "navigate"),
        ("Sec-Fetch-Dest", "document"),
        ("Upgrade-Insecure-Requests", "1"),
        ("DNT", "1"),
        ("Cache-Control", "no-cache"),
    ]
}

/// 从环境变量读取 HTTP 代理
fn get_proxy_from_env() -> Option<String> {
    // 按优先级读取：HTTPS_PROXY > https_proxy > HTTP_PROXY > http_proxy > ALL_PROXY > all_proxy
    for key in &[
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ] {
        if let Ok(val) = env::var(key) {
            let trimmed = val.trim().to_string();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }
    None
}

/// 构建带浏览器指纹的 ureq Agent（支持代理）
fn build_agent(insecure: bool, timeout_read_secs: u64) -> Result<ureq::Agent, String> {
    let mut builder = ureq::AgentBuilder::new()
        .user_agent(CHROME_UA)
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(timeout_read_secs));

    if insecure {
        let tls = native_tls::TlsConnector::builder()
            .danger_accept_invalid_certs(true)
            .build()
            .map_err(|e| format!("创建 TLS 连接器失败: {}", e))?;
        builder = builder.tls_connector(Arc::new(tls));
    }

    // 自动读取系统代理
    if let Some(proxy_url) = get_proxy_from_env() {
        if let Ok(proxy) = ureq::Proxy::new(&proxy_url) {
            builder = builder.proxy(proxy);
        }
    }

    Ok(builder.build())
}

// ─── 进度事件 ────────────────────────────────────────────

/// 下载进度事件载荷
fn build_progress_event(
    status: &str,
    url: &str,
    destination: &str,
    engine: &str,
    bytes: u64,
    total: Option<u64>,
) -> serde_json::Value {
    serde_json::json!({
        "status": status,
        "url": url,
        "destination": destination,
        "engine": engine,
        "bytes": bytes,
        "total": total,
        "percent": total.map(|t| if t > 0 { (bytes as f64 / t as f64 * 100.0) as u32 } else { 0 }),
    })
}

fn emit_progress(app: &tauri::AppHandle, payload: serde_json::Value) {
    let _ = app.emit("download-progress", payload);
}

// ─── 下载（多引擎回退 + 进度上报） ────────────────────────

/// ⚠ 下载策略回退链（不要减少引擎数）：
///   1. ureq + native-tls（系统证书，支持代理）
///   2. ureq + insecure（跳过证书验证，应对代理 MITM）
///   3. curl（Windows 10/11 自带，支持代理环境变量）
///   4. PowerShell WebClient（Windows 原生 HTTP 栈，不同 TLS 指纹）
///   5. BITS（Windows 系统级后台传输，最兜底）

/// ureq 分块下载，带进度上报
fn ureq_download_with_progress(
    url: &str,
    destination: &str,
    insecure: bool,
    app: Option<&tauri::AppHandle>,
    engine_label: &str,
) -> Result<(), String> {
    let agent = build_agent(insecure, 600)?;
    let mut req = agent.get(url);
    for (key, val) in browser_headers() {
        req = req.set(key, val);
    }

    let resp = req.call().map_err(|e| format!("下载失败: {}", e))?;

    // 获取 Content-Length
    let total_size = resp
        .header("Content-Length")
        .and_then(|v| v.parse::<u64>().ok());

    if let Some(app) = app {
        emit_progress(
            app,
            build_progress_event("downloading", url, destination, engine_label, 0, total_size),
        );
    }

    let mut body = Vec::new();
    let mut buf = [0u8; 65536]; // 64KB 块
    let mut total_read: u64 = 0;
    let mut last_report = Instant::now();
    let report_interval = Duration::from_millis(200); // 每 200ms 报一次

    let mut reader = resp.into_reader();
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("读取响应失败: {}", e))?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&buf[..n]);
        total_read += n as u64;

        if let Some(app) = app {
            if last_report.elapsed() >= report_interval {
                emit_progress(
                    app,
                    build_progress_event(
                        "downloading",
                        url,
                        destination,
                        engine_label,
                        total_read,
                        total_size,
                    ),
                );
                last_report = Instant::now();
            }
        }
    }

    // 写入磁盘
    let dest = Path::new(destination);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(dest, &body).map_err(|e| format!("写入文件失败: {}", e))?;

    if let Some(app) = app {
        emit_progress(
            app,
            build_progress_event("finished", url, destination, engine_label, total_read, total_size),
        );
    }
    Ok(())
}

/// curl 下载（Windows 10/11 自带，支持代理环境变量）
#[cfg(windows)]
fn curl_download(url: &str, destination: &str) -> Result<String, String> {
    let output = Command::new("curl")
        .args([
            "-sSL",
            "--connect-timeout",
            "15",
            "--max-time",
            "300",
            "-o",
            destination,
            url,
        ])
        .output()
        .map_err(|e| format!("启动 curl 失败: {}", e))?;

    if output.status.success() {
        Ok(format!("已下载到: {}", destination))
    } else {
        let err = decode_output(&output.stderr);
        Err(format!("curl 下载失败: {}", err.trim()))
    }
}

#[cfg(not(windows))]
fn curl_download(_url: &str, _destination: &str) -> Result<String, String> {
    Err("curl 回退仅在 Windows 可用".to_string())
}

#[cfg(windows)]
fn powershell_download(url: &str, destination: &str) -> Result<String, String> {
    let ps_code = format!(
        "$ProgressPreference = 'SilentlyContinue'; \
         try {{ \
           (New-Object System.Net.WebClient).DownloadFile('{}', '{}'); \
           exit 0 \
         }} catch {{ \
           Write-Error $_.Exception.Message; \
           exit 1 \
         }}",
        url.replace('\'', "''"),
        destination.replace('\'', "''")
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps_code])
        .output()
        .map_err(|e| format!("启动 PowerShell 失败: {}", e))?;

    if output.status.success() {
        Ok(format!("已下载到: {}", destination))
    } else {
        let err = decode_output(&output.stderr);
        Err(format!("PowerShell 下载失败: {}", err.trim()))
    }
}

#[cfg(not(windows))]
fn powershell_download(_url: &str, _destination: &str) -> Result<String, String> {
    Err("PowerShell 仅在 Windows 可用".to_string())
}

#[cfg(windows)]
fn bits_download(url: &str, destination: &str) -> Result<String, String> {
    let ps_code = format!(
        "$ProgressPreference = 'SilentlyContinue'; \
         try {{ \
           Start-BitsTransfer -Source '{}' -Destination '{}' -ErrorAction Stop; \
           exit 0 \
         }} catch {{ \
           Write-Error $_.Exception.Message; \
           exit 1 \
         }}",
        url.replace('\'', "''"),
        destination.replace('\'', "''")
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps_code])
        .output()
        .map_err(|e| format!("启动 BITS 失败: {}", e))?;

    if output.status.success() {
        Ok(format!("已下载到: {}", destination))
    } else {
        let err = decode_output(&output.stderr);
        Err(format!("BITS 下载失败: {}", err.trim()))
    }
}

#[cfg(not(windows))]
fn bits_download(_url: &str, _destination: &str) -> Result<String, String> {
    Err("BITS 仅在 Windows 可用".to_string())
}

pub(crate) fn download_file(
    url: &str,
    destination: &str,
    app: Option<&tauri::AppHandle>,
) -> Result<String, String> {
    if let Some(parent) = Path::new(destination).parent() {
        let _ = fs::create_dir_all(parent);
    }

    // 收集所有错误信息
    let mut errors: Vec<String> = Vec::new();

    // 通知开始下载
    if let Some(app) = app {
        emit_progress(
            app,
            build_progress_event("connecting", url, destination, "", 0, None),
        );
    }

    // 检查代理环境变量（用于调试输出）
    if let Some(proxy) = get_proxy_from_env() {
        eprintln!("[download] 检测到代理: {}", proxy);
    }

    // 1. ureq + native-tls（系统证书，支持代理）
    if let Some(app) = app {
        emit_progress(
            app,
            build_progress_event("connecting", url, destination, "ureq", 0, None),
        );
    }
    if let Err(e) = ureq_download_with_progress(url, destination, false, app, "ureq") {
        eprintln!("[download] ureq native-tls 失败: {}", e);
        errors.push(format!("ureq(证书): {}", e));
        if let Some(app) = app {
            emit_progress(
                app,
                build_progress_event("engine_fallback", url, destination, "ureq", 0, None),
            );
        }
    } else {
        return Ok(format!("已下载到: {}", destination));
    }

    // 2. ureq + insecure（跳过证书验证）
    if let Some(app) = app {
        emit_progress(
            app,
            build_progress_event("connecting", url, destination, "ureq_insecure", 0, None),
        );
    }
    if let Err(e) = ureq_download_with_progress(url, destination, true, app, "ureq_insecure") {
        eprintln!("[download] ureq insecure 失败: {}", e);
        errors.push(format!("ureq(无证书): {}", e));
        if let Some(app) = app {
            emit_progress(
                app,
                build_progress_event("engine_fallback", url, destination, "ureq_insecure", 0, None),
            );
        }
    } else {
        return Ok(format!("已下载到: {} (跳过证书验证)", destination));
    }

    // 3. curl 回退（Windows 10/11 自带，支持代理环境变量）
    if let Some(app) = app {
        emit_progress(
            app,
            build_progress_event("connecting", url, destination, "curl", 0, None),
        );
    }
    match curl_download(url, destination) {
        Ok(msg) => return Ok(format!("{} (curl)", msg)),
        Err(e) => {
            errors.push(format!("curl: {}", e));
            if let Some(app) = app {
                emit_progress(
                    app,
                    build_progress_event("engine_fallback", url, destination, "curl", 0, None),
                );
            }
        }
    }

    // 4. PowerShell 回退
    if let Some(app) = app {
        emit_progress(
            app,
            build_progress_event("connecting", url, destination, "powershell", 0, None),
        );
    }
    match powershell_download(url, destination) {
        Ok(msg) => return Ok(format!("{} (PowerShell)", msg)),
        Err(e) => {
            errors.push(format!("PowerShell: {}", e));
            if let Some(app) = app {
                emit_progress(
                    app,
                    build_progress_event("engine_fallback", url, destination, "powershell", 0, None),
                );
            }
        }
    }

    // 5. BITS 回退
    if let Some(app) = app {
        emit_progress(
            app,
            build_progress_event("connecting", url, destination, "bits", 0, None),
        );
    }
    match bits_download(url, destination) {
        Ok(msg) => return Ok(format!("{} (BITS)", msg)),
        Err(e) => {
            errors.push(format!("BITS: {}", e));
            if let Some(app) = app {
                emit_progress(
                    app,
                    build_progress_event("engine_fallback", url, destination, "bits", 0, None),
                );
            }
        }
    }

    // 全部失败
    if let Some(app) = app {
        emit_progress(
            app,
            build_progress_event("error", url, destination, "", 0, None),
        );
    }

    Err(format!(
        "所有下载方式均失败。\n\
         - 详细错误:\n{}\n\
         - 请检查网络连接和代理设置\n\
         - 如果配置了代理，请确保环境变量 HTTPS_PROXY/HTTP_PROXY 已设置\n\
         - 或手动在浏览器中打开链接下载:\n\
         {}",
        errors
            .iter()
            .map(|e| format!("     {}", e))
            .collect::<Vec<_>>()
            .join("\n"),
        url
    ))
}

// ─── 打开 ────────────────────────────────────────────────

pub(crate) fn open_path(path: &str) -> Result<String, String> {
    if !Path::new(path).exists() {
        return Err(format!("路径不存在: {}", path));
    }
    Command::new("cmd")
        .args(["/C", "start", "", path])
        .spawn()
        .map_err(|e| format!("打开失败: {}", e))?;
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
        result.push_str(&decode_output(&output.stdout));
    }
    if !output.stderr.is_empty() {
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str("STDERR:\n");
        result.push_str(&decode_output(&output.stderr));
    }

    Ok(result.trim().to_string())
}

// ─── 网络请求 ────────────────────────────────────────────

pub(crate) fn fetch_url(url: &str, method: &str, body: Option<&str>) -> Result<String, String> {
    let mut last_err = String::new();
    for insecure in &[false, true] {
        let agent = match build_agent(*insecure, 600) {
            Ok(a) => a,
            Err(e) => {
                last_err = e;
                continue;
            }
        };

        let mut req = match method.to_uppercase().as_str() {
            "POST" => agent.post(url),
            _ => agent.get(url),
        };
        for (key, val) in browser_headers() {
            req = req.set(key, val);
        }

        let resp = match method.to_uppercase().as_str() {
            "POST" => req
                .set("Content-Type", "application/json")
                .send_string(body.unwrap_or(""))
                .map_err(|e| format!("请求失败: {}", e)),
            _ => req.call().map_err(|e| format!("请求失败: {}", e)),
        };

        return match resp {
            Ok(r) => r
                .into_string()
                .map_err(|e| format!("读取响应失败: {}", e)),
            Err(e) => {
                last_err = e;
                if last_err.contains("certificate")
                    || last_err.contains("UnknownIssuer")
                    || last_err.contains("tls")
                {
                    continue;
                }
                return Err(last_err);
            }
        };
    }

    Err(last_err)
}

// ─── 剪贴板 ──────────────────────────────────────────────

pub(crate) fn clipboard_read() -> Result<String, String> {
    clipboard_win::get_clipboard_string().map_err(|e| format!("读取剪贴板失败: {}", e))
}

pub(crate) fn clipboard_write(text: &str) -> Result<(), String> {
    let _clip = clipboard_win::Clipboard::new()
        .map_err(|e| format!("打开剪贴板失败: {}", e))?;
    clipboard_win::set_clipboard_string(text)
        .map_err(|e| format!("写入剪贴板失败: {}", e))
}
