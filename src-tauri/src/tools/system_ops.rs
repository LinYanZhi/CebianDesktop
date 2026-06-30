use std::fs;
use std::path::Path;
use std::process::Command;
use serde_json::{json, Value};
#[cfg(windows)]
use winreg::enums::*;
#[cfg(windows)]
use winreg::RegKey;

// ─── 系统信息 ────────────────────────────────────────────

/// 从 Windows 注册表读取已安装软件列表（仅 Windows）
#[cfg(windows)]
pub(crate) fn get_installed_software() -> Vec<Value> {
    let mut software: Vec<Value> = Vec::new();
    // 用 DisplayName 去重，因为同一软件可能出现在多个注册表路径
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    let reg_paths = [
        (HKEY_LOCAL_MACHINE, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_LOCAL_MACHINE, r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Uninstall"),
    ];

    for (hkey, subkey) in &reg_paths {
        if let Ok(key) = RegKey::predef(*hkey).open_subkey_with_flags(*subkey, KEY_READ) {
            for name in key.enum_keys().filter_map(|k| k.ok()) {
                if let Ok(sub) = key.open_subkey_with_flags(&name, KEY_READ) {
                    let display_name: Option<String> = sub.get_value("DisplayName").ok();
                    if let Some(ref dn) = display_name {
                        if dn.trim().is_empty() || !seen.insert(dn.trim().to_lowercase()) {
                            continue;
                        }
                        let version: Option<String> = sub.get_value("DisplayVersion").ok();
                        let install_loc: Option<String> = sub.get_value("InstallLocation").ok();
                        let publisher: Option<String> = sub.get_value("Publisher").ok();
                        software.push(json!({
                            "name": dn.trim(),
                            "version": version.unwrap_or_default(),
                            "install_location": install_loc.unwrap_or_default(),
                            "publisher": publisher.unwrap_or_default(),
                        }));
                    }
                }
            }
        }
    }

    software.sort_by(|a, b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
    software
}

/// 获取非 Windows 系统的空软件列表
#[cfg(not(windows))]
pub(crate) fn get_installed_software() -> Vec<Value> {
    Vec::new()
}

/// Windows 上从注册表读取第一块网卡 MAC 地址
#[cfg(windows)]
pub(crate) fn get_windows_mac() -> Option<String> {
    let net_path = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e972-e325-11ce-bfc1-08002be10318}";
    if let Ok(key) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(net_path, KEY_READ) {
        for name in key.enum_keys().filter_map(|k| k.ok()) {
            if let Ok(sub) = key.open_subkey_with_flags(&name, KEY_READ) {
                if let Ok(mac) = sub.get_value::<String, _>("NetworkAddress") {
                    let mac = mac.trim().to_uppercase();
                    if mac.len() >= 12 && mac != "000000000000" {
                        return Some(mac);
                    }
                }
            }
        }
    }
    // Fallback: try WMI path in registry
    if let Ok(key) = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey_with_flags(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\NetworkList\DefaultAdapterMac", KEY_READ)
    {
        if let Ok(val) = key.get_value::<String, _>("") {
            return Some(val);
        }
    }
    None
}

#[cfg(not(windows))]
pub(crate) fn get_windows_mac() -> Option<String> {
    None
}

/// 读取环境变量。name 为 None 时返回全部（过滤敏感信息）。
pub(crate) fn get_env(name: Option<&str>) -> Result<Value, String> {
    if let Some(n) = name {
        let val = std::env::var(n).map_err(|_| format!("环境变量不存在: {}", n))?;
        return Ok(json!({ "name": n, "value": val }));
    }

    // 敏感 key 前缀过滤（防止泄露密钥、token 等）
    let sensitive_prefixes = ["KEY", "TOKEN", "SECRET", "PASSWORD", "API_KEY", "ACCESS_KEY",
                              "SECRET_KEY", "AUTH", "CREDENTIALS", "CONNECTION_STRING",
                              "PRIVATE_KEY", "CERTIFICATE", "ENCRYPTION"];
    let mut vars: Vec<Value> = std::env::vars()
        .filter(|(k, _)| !sensitive_prefixes.iter().any(|p| k.to_uppercase().contains(p)))
        .map(|(k, v)| json!({ "name": k, "value": v }))
        .collect();
    vars.sort_by(|a, b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));

    Ok(json!({ "variables": vars, "count": vars.len() }))
}

pub(crate) fn system_info() -> Result<Value, String> {
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

    // 软件列表
    let software = get_installed_software();
    let software_count = software.len();

    // 网络信息
    let local_ip = std::net::UdpSocket::bind("0.0.0.0:0")
        .ok()
        .and_then(|s| s.connect("8.8.8.8:53").ok().map(|_| s.local_addr().ok()))
        .flatten()
        .map(|a| a.ip().to_string());
    #[cfg(windows)]
    let mac_address = get_windows_mac();
    #[cfg(not(windows))]
    let mac_address = None;

    Ok(json!({
        "os": os_info,
        "hostname": hostname,
        "cpu": { "name": cpu_name, "cores": cpu_count },
        "memory": { "total_gb": format!("{:.1}", total_mem_gb), "used_gb": format!("{:.1}", used_mem_gb) },
        "disks": disks,
        "username": std::env::var("USERNAME").unwrap_or_default(),
        "computer_name": std::env::var("COMPUTERNAME").unwrap_or_default(),
        "network": {
            "local_ip": local_ip,
            "mac_address": mac_address,
        },
        "installed_software": software,
        "installed_software_count": software_count,
    }))
}

// ─── 进程列表 ────────────────────────────────────────────

pub(crate) fn list_processes(name_filter: Option<&str>) -> Result<Vec<Value>, String> {
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

pub(crate) fn list_windows() -> Result<Vec<Value>, String> {
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

pub(crate) fn capture_screen(save_path: &str) -> Result<(), String> {
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

pub(crate) fn system_notify(title: &str, message: &str) -> Result<(), String> {
    notify_rust::Notification::new()
        .summary(title)
        .body(message)
        .appname("CebianDesktop")
        .show()
        .map_err(|e| format!("发送通知失败: {}", e))?;
    Ok(())
}

// ─── 系统语言 ────────────────────────────────────────────

/// 获取 Windows 已安装的语言列表（通过 PowerShell）
pub(crate) fn system_get_languages() -> Result<Vec<Value>, String> {
    let ps_script = r#"
$langs = Get-WinUserLanguageList
$langs | ForEach-Object {
    [PSCustomObject]@{
        LanguageTag = $_.LanguageTag
        LocalizedName = $_.LocalizedName
        EnglishName = $_.EnglishName
        InputMethods = ($_.InputMethodTips -join ", ")
    }
} | ConvertTo-Json
"#;

    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", ps_script])
        .output()
        .map_err(|e| format!("获取语言列表失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("获取语言列表失败: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if stdout.trim().is_empty() {
        return Ok(Vec::new());
    }

    let languages: Vec<Value> = serde_json::from_str(&stdout).unwrap_or_default();
    Ok(languages)
}

/// 向 Windows 添加语言（包括对应输入法）
pub(crate) fn system_add_language(language_tag: &str, _language_name: &str) -> Result<(), String> {
    let ps_script = format!(
        "$langList = Get-WinUserLanguageList; $langList.Add(\"{}\"); Set-WinUserLanguageList -LanguageList $langList -Force; Write-Output 'OK'",
        language_tag
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &ps_script])
        .output()
        .map_err(|e| format!("添加语言失败: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("添加语言失败: {}\n\n可能原因：\n- 当前环境权限不足（沙盒/受限账户）\n- 语言标签无效（常见有效值：zh-CN, en-US, zh-TW, ja-JP）\n- 系统策略限制", stderr.trim()))
    }
}
