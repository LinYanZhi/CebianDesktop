//! 配置 Dialog/Prompt 管理命令

use crate::config_storage::{
    save_config, load_config, AppConfig, Conversation, Prompt,
    save_conversations as storage_save_convs, load_conversations as storage_load_convs,
};

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
