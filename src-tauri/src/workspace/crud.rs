use std::fs;
use std::path::Path;

use super::types::*;
use super::path::subdir_path;
use super::md::{parse_md_file, build_md_content};

/// 列出工作区子目录下的所有文件和子目录（递归）
pub fn list_files(app: &tauri::AppHandle, sub: WorkspaceDir) -> Result<Vec<WorkspaceFile>, String> {
    let dir = subdir_path(app, sub)?;
    let mut files = Vec::new();
    list_files_recursive(&dir, &dir, &mut files)?;
    files.sort_by(|a, b| {
        let a_is_dir = a.filename.ends_with('/');
        let b_is_dir = b.filename.ends_with('/');
        if a_is_dir != b_is_dir { return a_is_dir.cmp(&b_is_dir).reverse(); }
        a.filename.cmp(&b.filename)
    });
    Ok(files)
}

fn list_files_recursive(base: &Path, scan_dir: &Path, files: &mut Vec<WorkspaceFile>) -> Result<(), String> {
    let mut entries: Vec<_> = fs::read_dir(scan_dir)
        .map_err(|e| format!("读取目录失败: {}", e))?
        .filter_map(|e| e.ok())
        .collect();
    entries.sort_by(|a, b| a.file_name().cmp(&b.file_name()));

    for entry in entries {
        let path = entry.path();
        let rel = path.strip_prefix(base).map_err(|_| "路径错误".to_string())?;
        let rel_str = rel.to_string_lossy().replace('\\', "/");

        if path.is_dir() {
            files.push(WorkspaceFile {
                filename: rel_str.clone() + "/",
                id: rel_str.clone(),
                name: rel_str,
                description: String::new(),
                content: String::new(),
                created_at: 0,
                updated_at: 0,
            });
            list_files_recursive(base, &path, files)?;
        } else if path.extension().and_then(|s| s.to_str()) == Some("md") {
            let raw = fs::read_to_string(&path)
                .map_err(|e| format!("读取文件失败: {}", e))?;
            let id = rel_str.strip_suffix(".md").unwrap_or(&rel_str).to_string();
            if let Some((meta, content)) = parse_md_file(&raw) {
                files.push(WorkspaceFile {
                    filename: rel_str,
                    id,
                    name: meta.name,
                    description: meta.description,
                    content,
                    created_at: meta.created_at,
                    updated_at: meta.updated_at,
                });
            } else {
                files.push(WorkspaceFile {
                    filename: rel_str.clone(),
                    id: id.clone(),
                    name: id,
                    description: String::new(),
                    content: raw,
                    created_at: 0,
                    updated_at: 0,
                });
            }
        } else {
            files.push(WorkspaceFile {
                filename: rel_str.clone(),
                id: rel_str,
                name: String::new(),
                description: String::new(),
                content: fs::read_to_string(&path).unwrap_or_default(),
                created_at: 0,
                updated_at: 0,
            });
        }
    }
    Ok(())
}

/// 读取工作区文件
/// id 可含扩展名（如 "1.js"），否则自动尝试 .md
pub fn read_file(app: &tauri::AppHandle, sub: WorkspaceDir, id: &str) -> Result<WorkspaceFile, String> {
    let dir = subdir_path(app, sub)?;
    // 尝试直接使用 id 作为文件名，或补 .md
    let path = {
        let p = dir.join(id);
        if p.exists() {
            p
        } else {
            let p = dir.join(format!("{}.md", id));
            if p.exists() {
                p
            } else {
                return Err(format!("文件 '{}' 不存在", id));
            }
        }
    };
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("读取文件失败: {}", e))?;
    let filename = path.file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_default();
    let actual_id = if id.contains('.') { id.to_string() } else { id.to_string() };

    // .md 文件尝试解析 frontmatter
    if filename.ends_with(".md") {
        if let Some((meta, content)) = parse_md_file(&raw) {
            Ok(WorkspaceFile {
                filename,
                id: actual_id,
                name: meta.name,
                description: meta.description,
                content,
                created_at: meta.created_at,
                updated_at: meta.updated_at,
            })
        } else {
            // 无 frontmatter 的纯文本
            Ok(WorkspaceFile {
                filename,
                id: actual_id.clone(),
                name: actual_id,
                description: String::new(),
                content: raw,
                created_at: 0,
                updated_at: 0,
            })
        }
    } else {
        // 非 .md 文件直接返回内容
        Ok(WorkspaceFile {
            filename,
            id: actual_id,
            name: String::new(),
            description: String::new(),
            content: raw,
            created_at: 0,
            updated_at: 0,
        })
    }
}

/// 读取工作区文件的原始 Markdown 内容（用于导出）
pub fn read_file_raw(app: &tauri::AppHandle, sub: WorkspaceDir, id: &str) -> Result<String, String> {
    let dir = subdir_path(app, sub)?;
    let path = {
        let p = dir.join(id);
        if p.exists() { p } else { dir.join(format!("{}.md", id)) }
    };
    if !path.exists() {
        return Err(format!("文件 '{}' 不存在", id));
    }
    fs::read_to_string(&path)
        .map_err(|e| format!("读取文件失败: {}", e))
}

/// 从原始 Markdown 内容导入工作区文件（解析 frontmatter，生成新 id）
pub fn import_file_raw(app: &tauri::AppHandle, sub: WorkspaceDir, raw_content: &str) -> Result<String, String> {
    let dir = subdir_path(app, sub)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // 尝试解析 frontmatter
    let (name, description, body) = if let Some((meta, body)) = parse_md_file(raw_content) {
        (meta.name, meta.description, body)
    } else {
        // 无 frontmatter：纯文本当作 content
        ("".to_string(), "".to_string(), raw_content.to_string())
    };

    let id = generate_id();
    let meta = WorkspaceFileMeta {
        name,
        description,
        created_at: now,
        updated_at: now,
    };
    let md_content = build_md_content(&meta, &body);
    let path = dir.join(format!("{}.md", id));
    fs::write(&path, &md_content)
        .map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(id)
}

/// 写入工作区文件（创建或更新）
/// id 可包含扩展名（如 "1.js"），否则补 ".md"
pub fn write_file(
    app: &tauri::AppHandle,
    sub: WorkspaceDir,
    id: &str,
    name: &str,
    description: &str,
    content: &str,
) -> Result<(), String> {
    let dir = subdir_path(app, sub)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // 完全尊重传入的 id，不再自动补 .md
    let filename = id.to_string();

    let path = dir.join(&filename);
    // 只有 .md 文件才写 frontmatter
    if filename.ends_with(".md") {
        let meta = WorkspaceFileMeta {
            name: name.to_string(),
            description: description.to_string(),
            created_at: now,
            updated_at: now,
        };
        let md_content = build_md_content(&meta, content);
        fs::write(&path, &md_content)
            .map_err(|e| format!("写入文件失败: {}", e))
    } else {
        // 非 .md 文件直接写内容
        fs::write(&path, content)
            .map_err(|e| format!("写入文件失败: {}", e))
    }
}

/// 删除工作区文件
/// id 可含扩展名（如 "1.js"），否则自动尝试 .md
pub fn delete_file(app: &tauri::AppHandle, sub: WorkspaceDir, id: &str) -> Result<(), String> {
    let dir = subdir_path(app, sub)?;
    // 先尝试 id 原样路径，再尝试补 .md
    let path = {
        let p = dir.join(id);
        if p.exists() {
            p
        } else {
            let p = dir.join(format!("{}.md", id));
            if p.exists() {
                p
            } else {
                return Err(format!("文件 '{}' 不存在", id));
            }
        }
    };
    fs::remove_file(&path)
        .map_err(|e| format!("删除文件失败: {}", e))
}

/// 重命名工作区文件（实际重命名磁盘上的文件）
/// new_filename 可包含扩展名（如 myfile.js），否则默认 .md
pub fn rename_file(app: &tauri::AppHandle, sub: WorkspaceDir, id: &str, new_name: &str) -> Result<(), String> {
    if new_name.is_empty() {
        return Err("文件名不能为空".to_string());
    }
    if new_name.contains('\\') || new_name.contains('\0') {
        return Err("文件名包含非法字符".to_string());
    }
    let dir = subdir_path(app, sub)?;
    // 先尝试带 .md 后缀，再尝试原样路径
    let old_path = {
        let p = dir.join(format!("{}.md", id));
        if p.exists() {
            p
        } else {
            let p = dir.join(id);
            if !p.exists() {
                return Err(format!("文件 '{}' 不存在", id));
            }
            p
        }
    };
    // 完全尊重传入的 new_name
    let final_name = new_name.to_string();
    let new_path = dir.join(&final_name);
    if new_path.exists() {
        return Err(format!("文件 '{}' 已存在", final_name));
    }
    fs::rename(&old_path, &new_path)
        .map_err(|e| format!("重命名文件失败: {}", e))
}

/// 生成新文件 ID
pub fn generate_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{:x}", ts)
}
