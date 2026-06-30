use std::fs;
use std::path::PathBuf;
use tauri::Manager;

use super::types::WorkspaceDir;
use super::crud::generate_id;

/// 获取工作区根目录
pub(super) fn workspace_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {}", e))?;
    let root = dir.join("workspace");
    fs::create_dir_all(&root)
        .map_err(|e| format!("创建工作区目录失败: {}", e))?;
    Ok(root)
}

/// 获取子目录路径并确保存在
pub(super) fn subdir_path(app: &tauri::AppHandle, sub: WorkspaceDir) -> Result<PathBuf, String> {
    let path = workspace_root(app)?.join(sub.as_str());
    fs::create_dir_all(&path)
        .map_err(|e| format!("创建 {} 目录失败: {}", sub.as_str(), e))?;
    Ok(path)
}

/// 提取文件名中的 id（去掉 .md 后缀）
#[allow(dead_code)]
pub(super) fn filename_to_id(filename: &str) -> String {
    filename.strip_suffix(".md").unwrap_or(filename).to_string()
}

/// 将技能名转换为安全的文件名（仅保留 ASCII 字母、数字、下划线、连字符）
pub(super) fn sanitize_to_filename(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect();
    let s = s.trim_matches('_').to_string();
    if s.is_empty() { "unnamed".to_string() } else { s }
}

/// 获取子目录的绝对路径
pub fn get_subdir_path(app: &tauri::AppHandle, sub: WorkspaceDir) -> Result<PathBuf, String> {
    subdir_path(app, sub)
}

/// 根据文件 ID 获取文件的绝对路径
pub fn get_file_path(app: &tauri::AppHandle, sub: WorkspaceDir, id: &str) -> Result<PathBuf, String> {
    let dir = subdir_path(app, sub)?;
    let path = {
        let p = dir.join(id);
        if p.exists() { p } else { dir.join(format!("{}.md", id)) }
    };
    if !path.exists() {
        return Err(format!("文件 '{}' 不存在", id));
    }
    Ok(path)
}

/// 基于技能名生成安全的 .md 文件名，自动处理冲突（追加 _1, _2, …）
pub fn resolve_skill_filename(app: &tauri::AppHandle, sub: WorkspaceDir, name: &str) -> Result<String, String> {
    let dir = subdir_path(app, sub)?;
    let base = sanitize_to_filename(name);
    let candidate = format!("{}.md", base);
    if !dir.join(&candidate).exists() {
        return Ok(candidate);
    }
    // 同名文件已存在，追加数字后缀
    for i in 1..100 {
        let candidate = format!("{}_{}.md", base, i);
        if !dir.join(&candidate).exists() {
            return Ok(candidate);
        }
    }
    // 极端情况：100+ 个同名，用时间戳后缀
    let ts = generate_id();
    let suffix = &ts[..6];
    Ok(format!("{}_{}.md", base, suffix))
}
