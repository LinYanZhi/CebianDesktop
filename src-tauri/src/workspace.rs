//! 工作区模块
//!
//! 管理 `app_data_dir/workspace/` 下的文件式存储。
//! 子目录：
//!   - prompts/ — 提示词文件 (.md)
//!   - skills/  — 技能文件 (.md)
//!
//! 每个文件使用 Markdown 格式，YAML frontmatter 存放元数据：
//! ```md
//! ---
//! name: my-prompt
//! description: Does something
//! created_at: 1700000000
//! updated_at: 1700000000
//! ---
//! body content here
//! ```

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// 工作区子目录
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceDir {
    Prompts,
    Skills,
}

impl WorkspaceDir {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Prompts => "prompts",
            Self::Skills => "skills",
        }
    }
}

/// 文件元信息（frontmatter 解析结果）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceFileMeta {
    pub name: String,
    pub description: String,
    pub created_at: u64,
    pub updated_at: u64,
}

/// 工作区文件完整信息
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceFile {
    /// 文件名（含扩展名），如 abc123.md
    pub filename: String,
    /// 不带扩展名的文件名，作为唯一标识
    pub id: String,
    pub name: String,
    pub description: String,
    pub content: String,
    pub created_at: u64,
    pub updated_at: u64,
}

/// 获取工作区根目录
fn workspace_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
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
fn subdir_path(app: &tauri::AppHandle, sub: WorkspaceDir) -> Result<PathBuf, String> {
    let path = workspace_root(app)?.join(sub.as_str());
    fs::create_dir_all(&path)
        .map_err(|e| format!("创建 {} 目录失败: {}", sub.as_str(), e))?;
    Ok(path)
}

/// 提取文件名中的 id（去掉 .md 后缀）
fn filename_to_id(filename: &str) -> String {
    filename.strip_suffix(".md").unwrap_or(filename).to_string()
}

/// 从文件内容解析 frontmatter + body
fn parse_md_file(content: &str) -> Option<(WorkspaceFileMeta, String)> {
    let content = content.trim();
    if !content.starts_with("---") {
        return None;
    }

    let end = content[3..].find("\n---")?;
    let fm_str = &content[3..3 + end];
    let body = content[3 + end + 5..].trim().to_string();

    // 简易 frontmatter 解析（不使用额外依赖）
    let mut name = String::new();
    let mut description = String::new();
    let mut created_at = 0u64;
    let mut updated_at = 0u64;

    for line in fm_str.lines() {
        if let Some(val) = line.strip_prefix("name: ") {
            name = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("description: ") {
            description = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("created_at: ") {
            created_at = val.trim().parse().unwrap_or(0);
        } else if let Some(val) = line.strip_prefix("updated_at: ") {
            updated_at = val.trim().parse().unwrap_or(0);
        }
    }

    Some((
        WorkspaceFileMeta {
            name,
            description,
            created_at,
            updated_at,
        },
        body,
    ))
}

/// 生成带 frontmatter 的内容
fn build_md_content(meta: &WorkspaceFileMeta, body: &str) -> String {
    format!(
        "---\nname: {}\ndescription: {}\ncreated_at: {}\nupdated_at: {}\n---\n{}",
        meta.name, meta.description, meta.created_at, meta.updated_at, body
    )
}

// ─── 公开 API ─────────────────────────────────────────────

/// 列出工作区子目录下的所有文件
pub fn list_files(app: &tauri::AppHandle, sub: WorkspaceDir) -> Result<Vec<WorkspaceFile>, String> {
    let dir = subdir_path(app, sub)?;
    let mut files = Vec::new();

    for entry in fs::read_dir(&dir).map_err(|e| format!("读取目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let filename = path.file_name()
            .and_then(|s| s.to_str())
            .map(|s| s.to_string())
            .unwrap_or_default();
        let id = filename_to_id(&filename);

        let raw = fs::read_to_string(&path)
            .map_err(|e| format!("读取文件失败: {}", e))?;

        if let Some((meta, content)) = parse_md_file(&raw) {
            files.push(WorkspaceFile {
                filename,
                id,
                name: meta.name,
                description: meta.description,
                content,
                created_at: meta.created_at,
                updated_at: meta.updated_at,
            });
        }
    }

    // 按 updated_at 降序
    files.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(files)
}

/// 读取工作区文件
pub fn read_file(app: &tauri::AppHandle, sub: WorkspaceDir, id: &str) -> Result<WorkspaceFile, String> {
    let dir = subdir_path(app, sub)?;
    let path = dir.join(format!("{}.md", id));
    if !path.exists() {
        return Err(format!("文件 '{}' 不存在", id));
    }
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("读取文件失败: {}", e))?;
    let filename = path.file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_default();

    if let Some((meta, content)) = parse_md_file(&raw) {
        Ok(WorkspaceFile {
            filename,
            id: id.to_string(),
            name: meta.name,
            description: meta.description,
            content,
            created_at: meta.created_at,
            updated_at: meta.updated_at,
        })
    } else {
        // 没有 frontmatter 的纯文本文件也支持
        Ok(WorkspaceFile {
            filename: filename.clone(),
            id: id.to_string(),
            name: id.to_string(),
            description: String::new(),
            content: raw,
            created_at: 0,
            updated_at: 0,
        })
    }
}

/// 写入工作区文件（创建或更新）
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

    let meta = WorkspaceFileMeta {
        name: name.to_string(),
        description: description.to_string(),
        created_at: now,
        updated_at: now,
    };
    let md_content = build_md_content(&meta, content);
    let path = dir.join(format!("{}.md", id));
    fs::write(&path, &md_content)
        .map_err(|e| format!("写入文件失败: {}", e))
}

/// 删除工作区文件
pub fn delete_file(app: &tauri::AppHandle, sub: WorkspaceDir, id: &str) -> Result<(), String> {
    let dir = subdir_path(app, sub)?;
    let path = dir.join(format!("{}.md", id));
    if !path.exists() {
        return Err(format!("文件 '{}' 不存在", id));
    }
    fs::remove_file(&path)
        .map_err(|e| format!("删除文件失败: {}", e))
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

// ─── 备份与恢复 ──────────────────────────────────────────

/// 导出备份：将工作区 + 配置文件打包为 zip 字节
pub fn export_backup(app: &tauri::AppHandle) -> Result<Vec<u8>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {}", e))?;

    let mut buf = Vec::new();
    {
        let cursor = std::io::Cursor::new(&mut buf);
        let mut zip_writer = zip::ZipWriter::new(cursor);
        let options = zip::write::FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        // 配置文件列表
        let config_files = ["config.json", "conversations.json", "mcp_servers.json", "prompts.json"];

        for fname in &config_files {
            let path = data_dir.join(fname);
            if path.exists() {
                let content = fs::read_to_string(&path)
                    .map_err(|e| format!("读取 {} 失败: {}", fname, e))?;
                zip_writer.start_file(*fname, options.clone())
                    .map_err(|e| format!("zip 写入失败: {}", e))?;
                zip_writer.write_all(content.as_bytes())
                    .map_err(|e| format!("zip 写入失败: {}", e))?;
            }
        }

        // 工作区目录
        let workspace_dir = data_dir.join("workspace");
        if workspace_dir.exists() {
            add_dir_to_zip(&mut zip_writer, &workspace_dir, "workspace", &options)?;
        }

        zip_writer.finish().map_err(|e| format!("zip 完成失败: {}", e))?;
    }
    Ok(buf)
}

/// 导入备份：从 zip 字节恢复
pub fn import_backup(app: &tauri::AppHandle, zip_data: Vec<u8>) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {}", e))?;

    let reader = std::io::Cursor::new(zip_data);
    let mut archive = zip::ZipArchive::new(reader)
        .map_err(|e| format!("读取 zip 失败: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("读取 zip 条目失败: {}", e))?;
        let out_path = data_dir.join(file.name());

        if file.name().ends_with('/') {
            fs::create_dir_all(&out_path)
                .map_err(|e| format!("创建目录失败: {}", e))?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("创建目录失败: {}", e))?;
            }
            let mut content = Vec::new();
            std::io::Read::read_to_end(&mut file, &mut content)
                .map_err(|e| format!("读取 zip 内容失败: {}", e))?;
            fs::write(&out_path, &content)
                .map_err(|e| format!("写入文件失败: {}", e))?;
        }
    }

    Ok(())
}

fn add_dir_to_zip<W: std::io::Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    dir: &Path,
    prefix: &str,
    options: &zip::write::FileOptions<()>,
) -> Result<(), String> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(dir).map_err(|e| format!("读取目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let path = entry.path();
        let name = path.file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        let zip_name = format!("{}/{}", prefix, name);

        if path.is_dir() {
            add_dir_to_zip(zip, &path, &zip_name, options)?;
        } else {
            let content = fs::read(&path)
                .map_err(|e| format!("读取文件失败: {}", e))?;
            zip.start_file(&zip_name, options.clone())
                .map_err(|e| format!("zip 写入失败: {}", e))?;
            zip.write_all(&content)
                .map_err(|e| format!("zip 写入失败: {}", e))?;
        }
    }
    Ok(())
}

use std::io::Write;
