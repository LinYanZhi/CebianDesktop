//! 工作区文件管理命令

use crate::workspace;

/// 列出工作区子目录下的所有文件
#[tauri::command]
pub fn list_workspace_files(
    app_handle: tauri::AppHandle,
    sub: String,
) -> Result<Vec<workspace::WorkspaceFile>, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::list_files(&app_handle, dir)
}

/// 读取工作区文件
#[tauri::command]
pub fn read_workspace_file(
    app_handle: tauri::AppHandle,
    sub: String,
    id: String,
) -> Result<workspace::WorkspaceFile, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::read_file(&app_handle, dir, &id)
}

/// 写入工作区文件（创建或更新）
#[tauri::command]
pub fn write_workspace_file(
    app_handle: tauri::AppHandle,
    sub: String,
    id: String,
    name: String,
    description: String,
    content: String,
) -> Result<(), String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::write_file(&app_handle, dir, &id, &name, &description, &content)
}

/// 删除工作区文件
#[tauri::command]
pub fn delete_workspace_file(
    app_handle: tauri::AppHandle,
    sub: String,
    id: String,
) -> Result<(), String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::delete_file(&app_handle, dir, &id)
}

/// 重命名工作区文件
#[tauri::command]
pub fn rename_workspace_file(
    app_handle: tauri::AppHandle,
    sub: String,
    id: String,
    new_name: String,
) -> Result<(), String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::rename_file(&app_handle, dir, &id, &new_name)
}

/// 在工作区子目录下创建子文件夹
#[tauri::command]
pub fn create_workspace_subdir(
    app_handle: tauri::AppHandle,
    sub: String,
    dir_name: String,
) -> Result<(), String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::create_subdir(&app_handle, dir, &dir_name)
}

/// 删除工作区子目录
#[tauri::command]
pub fn delete_workspace_subdir(
    app_handle: tauri::AppHandle,
    sub: String,
    dir_name: String,
) -> Result<(), String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::delete_subdir(&app_handle, dir, &dir_name)
}

/// 移动工作区文件到目标目录
#[tauri::command]
pub fn move_workspace_file(
    app_handle: tauri::AppHandle,
    sub: String,
    file_id: String,
    target_dir: String,
) -> Result<(), String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::move_file_to_dir(&app_handle, dir, &file_id, &target_dir)
}

/// 生成工作区文件 ID
#[tauri::command]
pub fn generate_workspace_id() -> String {
    workspace::generate_id()
}

/// 导出单个工作区文件（返回原始 Markdown 内容）
#[tauri::command]
pub fn export_workspace_file(
    app_handle: tauri::AppHandle,
    sub: String,
    id: String,
) -> Result<String, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::read_file_raw(&app_handle, dir, &id)
}

/// 导入单个工作区文件（从原始 Markdown 内容）
#[tauri::command]
pub fn import_workspace_file(
    app_handle: tauri::AppHandle,
    sub: String,
    content: String,
) -> Result<String, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::import_file_raw(&app_handle, dir, &content)
}

/// 将工作区子目录下指定文件导出为 ZIP（base64 编码）
#[tauri::command]
pub fn export_workspace_zip(
    app_handle: tauri::AppHandle,
    sub: String,
    ids: Vec<String>,
) -> Result<String, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    let data = workspace::export_files_as_zip(&app_handle, dir, &ids)?;
    Ok(super::misc::base64_encode(&data))
}

/// 从 ZIP 导入文件到工作区子目录
#[tauri::command]
pub fn import_workspace_zip(
    app_handle: tauri::AppHandle,
    sub: String,
    data: String,
) -> Result<usize, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    let bytes = super::misc::base64_decode(&data)?;
    workspace::import_files_from_zip(&app_handle, dir, bytes)
}

/// 从本地目录导入文件到工作区子目录
#[tauri::command]
pub fn import_workspace_directory(
    app_handle: tauri::AppHandle,
    sub: String,
    dir_path: String,
) -> Result<usize, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::import_files_from_directory(&app_handle, dir, &dir_path)
}

/// 将工作区子目录下指定文件导出为 ZIP 并写入到指定路径
#[tauri::command]
pub fn export_workspace_zip_to_path(
    app_handle: tauri::AppHandle,
    sub: String,
    ids: Vec<String>,
    path: String,
) -> Result<usize, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::export_files_as_zip_to_path(&app_handle, dir, &ids, &path)
}

/// 从 ZIP 文件路径导入文件到工作区子目录
#[tauri::command]
pub fn import_workspace_zip_path(
    app_handle: tauri::AppHandle,
    sub: String,
    zip_path: String,
) -> Result<usize, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    workspace::import_files_from_zip_path(&app_handle, dir, &zip_path)
}

// ─── 打开文件管理器 ─────────────────────────────────────────

/// 在文件管理器中打开工作区子目录
#[tauri::command]
pub fn open_workspace_dir(app_handle: tauri::AppHandle, sub: String) -> Result<String, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    let path = workspace::get_subdir_path(&app_handle, dir)?;
    let path_str = path.to_string_lossy().to_string();
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &path_str])
        .spawn()
        .map_err(|e| format!("打开目录失败: {}", e))?;
    Ok(path_str)
}

/// 在文件管理器中打开并定位到工作区中指定文件
#[tauri::command]
pub fn open_file_location(app_handle: tauri::AppHandle, sub: String, id: String) -> Result<String, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    let path = workspace::get_file_path(&app_handle, dir, &id)?;
    let path_str = path.to_string_lossy().to_string();
    // Windows: explorer /select,<path> 会打开目录并选中文件
    std::process::Command::new("explorer")
        .args(["/select,", &path_str])
        .spawn()
        .map_err(|e| format!("打开文件位置失败: {}", e))?;
    Ok(path_str)
}

/// 获取工作区文件的绝对路径（不打开资源管理器）
#[tauri::command]
pub fn get_workspace_file_path(app_handle: tauri::AppHandle, sub: String, id: String) -> Result<String, String> {
    let dir = match sub.as_str() {
        "prompts" => workspace::WorkspaceDir::Prompts,
        "skills" => workspace::WorkspaceDir::Skills,
        _ => return Err(format!("无效的工作区子目录: {}", sub)),
    };
    let path = workspace::get_file_path(&app_handle, dir, &id)?;
    Ok(path.to_string_lossy().to_string())
}
