use std::fs;

use super::types::WorkspaceDir;
use super::path::subdir_path;

/// 在工作区子目录下创建子文件夹
pub fn create_subdir(app: &tauri::AppHandle, sub: WorkspaceDir, dir_name: &str) -> Result<(), String> {
    if dir_name.is_empty() {
        return Err("文件夹名不能为空".to_string());
    }
    if dir_name.contains('/') || dir_name.contains('\\') || dir_name.contains('\0') {
        return Err("文件夹名包含非法字符".to_string());
    }
    let dir = subdir_path(app, sub)?;
    let new_dir = dir.join(dir_name);
    fs::create_dir_all(&new_dir)
        .map_err(|e| format!("创建文件夹失败: {}", e))
}

/// 删除工作区子目录（递归删除）
pub fn delete_subdir(app: &tauri::AppHandle, sub: WorkspaceDir, dir_name: &str) -> Result<(), String> {
    if dir_name.is_empty() {
        return Err("文件夹名不能为空".to_string());
    }
    if dir_name.contains('/') || dir_name.contains('\\') || dir_name.contains('\0') {
        return Err("文件夹名包含非法字符".to_string());
    }
    let dir = subdir_path(app, sub)?;
    let target = dir.join(dir_name);
    if !target.exists() {
        return Err(format!("文件夹 '{}' 不存在", dir_name));
    }
    fs::remove_dir_all(&target)
        .map_err(|e| format!("删除文件夹失败: {}", e))
}

/// 将文件移动到目标目录
/// target_dir 为相对 skills 根目录的路径（如 "subdir"），空字符串表示根目录
pub fn move_file_to_dir(app: &tauri::AppHandle, sub: WorkspaceDir, file_id: &str, target_dir: &str) -> Result<(), String> {
    let dir = subdir_path(app, sub)?;

    // 判断是目录还是文件
    let is_dir = file_id.ends_with('/');
    let source_name = if is_dir {
        // 去掉尾部的 /
        file_id.trim_end_matches('/').to_string()
    } else {
        file_id.to_string()
    };

    // 原路径：先尝试原始名称，再尝试 .md 文件
    let old_path = if is_dir {
        let p = dir.join(&source_name);
        if !p.is_dir() {
            return Err(format!("目录 '{}' 不存在", source_name));
        }
        p
    } else if file_id.contains('.') {
        let p = dir.join(&source_name);
        if !p.exists() {
            return Err(format!("文件 '{}' 不存在", source_name));
        }
        p
    } else {
        let p = dir.join(format!("{}.md", source_name));
        if p.exists() {
            p
        } else {
            let p = dir.join(&source_name);
            if !p.exists() {
                return Err(format!("文件 '{}' 不存在", source_name));
            }
            p
        }
    };

    // 获取文件名/目录名
    let filename = old_path.file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    // 目标路径
    let new_path = if target_dir.is_empty() {
        dir.join(&filename)
    } else {
        let target = dir.join(target_dir);
        if !target.is_dir() {
            return Err(format!("目标目录 '{}' 不存在", target_dir));
        }
        target.join(&filename)
    };

    if new_path.exists() {
        return Err(format!("目标位置已存在同名{}: {}", if is_dir { "目录" } else { "文件" }, filename));
    }

    fs::rename(&old_path, &new_path)
        .map_err(|e| format!("移动{}失败: {}", if is_dir { "目录" } else { "文件" }, e))
}
