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
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;
use tauri::Manager;
use tauri::Emitter;

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
    let body = content.get(3 + end + 5..).map(|s| s.trim().to_string()).unwrap_or_default();

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

/// 获取子目录的绝对路径
pub fn get_subdir_path(app: &tauri::AppHandle, sub: WorkspaceDir) -> Result<PathBuf, String> {
    subdir_path(app, sub)
}

/// 将技能名转换为安全的文件名（仅保留 ASCII 字母、数字、下划线、连字符）
fn sanitize_to_filename(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect();
    let s = s.trim_matches('_').to_string();
    if s.is_empty() { "unnamed".to_string() } else { s }
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

/// 启动文件系统监听，检测 changes 时通过 Tauri 事件通知前端。
/// 放在后台线程运行，不阻塞启动。
pub fn start_watcher(app: tauri::AppHandle, sub: WorkspaceDir) -> Result<(), String> {
    let dir = subdir_path(&app, sub)?;
    let event_name = format!("workspace:changed:{}", sub.as_str());

    std::thread::spawn(move || {
        use notify::{Event, RecursiveMode, Watcher};

        let (tx, rx) = mpsc::channel::<Result<Event, notify::Error>>();
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[workspace] 创建 watcher 失败: {}", e);
                return;
            }
        };

        if let Err(e) = watcher.watch(&dir, RecursiveMode::Recursive) {
            eprintln!("[workspace] 监听目录失败: {}", e);
            return;
        }

        // 防抖：1 秒内多次变更只发一次事件
        let mut last_emit = std::time::Instant::now();
        loop {
            match rx.recv_timeout(Duration::from_secs(1)) {
                Ok(Ok(_event)) => {
                    let now = std::time::Instant::now();
                    if now.duration_since(last_emit) > Duration::from_millis(500) {
                        last_emit = now;
                        let _ = app.emit(&event_name, serde_json::json!({}));
                    }
                }
                Ok(Err(e)) => {
                    eprintln!("[workspace] watcher 错误: {}", e);
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    // 超时正常，继续循环
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    break;
                }
            }
        }
    });

    Ok(())
}
