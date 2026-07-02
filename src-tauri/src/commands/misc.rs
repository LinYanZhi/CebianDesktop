//! 杂项命令（备份导出导入、文件写入、提供商配置管理、base64 辅助）

use crate::config_storage::{AppConfig, ProviderConfig};

// ─── 备份与恢复 ─────────────────────────────────────────────

/// 导出备份为 base64 字符串（供前端下载）
#[tauri::command]
pub fn export_backup(
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let data = crate::workspace::export_backup(&app_handle)?;
    Ok(base64_encode(&data))
}

/// 从 base64 字符串导入备份
#[tauri::command]
pub fn import_backup(
    app_handle: tauri::AppHandle,
    data: String,
) -> Result<(), String> {
    let bytes = base64_decode(&data)?;
    crate::workspace::import_backup(&app_handle, bytes)
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

// base64 辅助（仅在此模块内使用）
pub(crate) fn base64_encode(data: &[u8]) -> String {
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

pub(crate) fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
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
