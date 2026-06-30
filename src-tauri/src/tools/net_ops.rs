use std::fs;
use std::io::Read;
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

// ─── 工具函数 ─────────────────────────────────────────────

/// 解码命令输出：先试 UTF-8，失败则试 GBK（中文 Windows 的 cmd.exe 输出）
///
/// ⚠ 历史踩坑：之前用 `String::from_utf8_lossy`，中文 Windows 上 cmd.exe
///   输出 GBK 编码，from_utf8_lossy 当成 UTF-8 解析，中文全变 �，只剩 \ 符号
///   被 JSON 转义成 \\，用户看到「系统找不到文件 \\。」（已修复）。
///   不要删掉 GBK 回退，否则 cmd 中文输出依然乱码。
fn decode_output(bytes: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    let (cow, _, _) = encoding_rs::GBK.decode(bytes);
    cow.to_string()
}

/// 模拟 Chrome 120 的请求头（绕过 CDN 反爬 / 浏览器指纹检测）
const CHROME_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                         (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

fn browser_headers() -> Vec<(&'static str, &'static str)> {
    vec![
        ("Accept", "*/*"),
        ("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8"),
        ("Sec-Ch-Ua", "\"Not_A Brand\";v=\"8\", \"Chromium\";v=\"120\", \"Google Chrome\";v=\"120\""),
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

/// 构建带浏览器指纹的 ureq Agent
///
/// ⚠ Cargo.toml 中 ureq 已配置 `native-tls`（不用 rustls），因为 rustls
///   不信任 Windows 系统证书，导致火绒/代理等 HTTPS 中间人场景下
///   `UnknownIssuer` 错误（已修复）。
fn build_agent(insecure: bool) -> Result<ureq::Agent, String> {
    let mut builder = ureq::AgentBuilder::new()
        .user_agent(CHROME_UA)
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(600));

    if insecure {
        let tls = native_tls::TlsConnector::builder()
            .danger_accept_invalid_certs(true)
            .build()
            .map_err(|e| format!("创建 TLS 连接器失败: {}", e))?;
        builder = builder.tls_connector(Arc::new(tls));
    }

    Ok(builder.build())
}

// ─── 下载（4 层回退） ──────────────────────────────────────

/// ⚠ 下载策略回退链（不要减少层数）：
///   1. ureq + native-tls（系统证书）
///   2. ureq + insecure（跳过证书验证，应对代理 MITM）
///   3. PowerShell WebClient（Windows 原生 HTTP 栈，不同 TLS 指纹）
///   4. BITS（Windows 系统级后台传输，最兜底）

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

fn ureq_download(url: &str, destination: &str, insecure: bool) -> Result<(), String> {
    let agent = build_agent(insecure)?;
    let mut req = agent.get(url);
    for (key, val) in browser_headers() {
        req = req.set(key, val);
    }

    let resp = req.call().map_err(|e| format!("下载失败: {}", e))?;
    let mut body: Vec<u8> = Vec::new();
    resp.into_reader()
        .read_to_end(&mut body)
        .map_err(|e| format!("读取响应失败: {}", e))?;

    let dest = Path::new(destination);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(dest, &body).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(())
}

pub(crate) fn download_file(url: &str, destination: &str) -> Result<String, String> {
    if let Some(parent) = Path::new(destination).parent() {
        let _ = fs::create_dir_all(parent);
    }

    // 收集所有错误信息，最后全部返回给用户
    let mut errors: Vec<String> = Vec::new();

    // 1. ureq + native-tls（系统证书）
    if let Err(e) = ureq_download(url, destination, false) {
        eprintln!("[download] ureq native-tls 失败: {}", e);
        errors.push(format!("ureq: {}", e));
    } else {
        return Ok(format!("已下载到: {}", destination));
    }

    // 2. ureq + insecure（跳过证书验证）
    if let Err(e) = ureq_download(url, destination, true) {
        eprintln!("[download] ureq insecure 失败: {}", e);
        errors.push(format!("ureq insecure: {}", e));
    } else {
        return Ok(format!("已下载到: {} (跳过证书验证)", destination));
    }

    // 3. PowerShell 回退
    match powershell_download(url, destination) {
        Ok(msg) => return Ok(format!("{} (PowerShell)", msg)),
        Err(e) => errors.push(format!("PowerShell: {}", e)),
    }

    // 4. BITS 回退
    match bits_download(url, destination) {
        Ok(msg) => return Ok(format!("{} (BITS)", msg)),
        Err(e) => errors.push(format!("BITS: {}", e)),
    }

    Err(format!(
        "所有下载方式均失败。\n\
         - 详细错误:\n{}\n\
         - 请检查网络连接和代理设置\n\
         - 或手动在浏览器中打开链接下载:\n\
         {}",
        errors.iter().map(|e| format!("     {}", e)).collect::<Vec<_>>().join("\n"),
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

/// ⚠ 历史踩坑：
///   - 之前用 `String::from_utf8_lossy` 解码 stdout/stderr，中文乱码（GBK 问题）
///   - 修复后改用 `decode_output` 先试 UTF-8 再试 GBK
///   - 不要改回 `from_utf8_lossy`
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

/// ⚠ 历史踩坑：同 download_file，之前没有 TLS 回退。
///   现在 native-tls 失败后自动重试 insecure 模式。
pub(crate) fn fetch_url(url: &str, method: &str, body: Option<&str>) -> Result<String, String> {
    let mut last_err = String::new();
    for insecure in &[false, true] {
        let agent = match build_agent(*insecure) {
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

        match resp {
            Ok(r) => return r.into_string().map_err(|e| format!("读取响应失败: {}", e)),
            Err(e) => {
                last_err = e;
                if last_err.contains("certificate") || last_err.contains("UnknownIssuer") || last_err.contains("tls") {
                    continue;
                }
                return Err(last_err);
            }
        }
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
