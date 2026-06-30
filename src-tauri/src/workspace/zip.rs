use std::fs;
use std::io::Write;
use std::path::Path;

use super::types::WorkspaceDir;
use super::path::subdir_path;

/// 将工作区子目录下的指定文件打包为 ZIP 字节
pub fn export_files_as_zip(app: &tauri::AppHandle, sub: WorkspaceDir, ids: &[String]) -> Result<Vec<u8>, String> {
    let dir = subdir_path(app, sub)?;
    let mut buf = Vec::new();
    {
        let cursor = std::io::Cursor::new(&mut buf);
        let mut zip_writer = zip::ZipWriter::new(cursor);
        let options = zip::write::FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        if ids.is_empty() {
            // 导出全部
            add_dir_to_zip(&mut zip_writer, &dir, sub.as_str(), &options)?;
        } else {
            for id in ids {
                // id 可能是 "subdir/file" 或 "file"
                let rel_path = if id.contains('.') {
                    id.to_string()
                } else {
                    format!("{}.md", id)
                };
                let full_path = dir.join(&rel_path);
                if !full_path.exists() {
                    // 尝试补 .md
                    let alt = dir.join(format!("{}.md", id));
                    if alt.exists() {
                        let content = fs::read_to_string(&alt)
                            .map_err(|e| format!("读取 {} 失败: {}", id, e))?;
                        let zip_name = format!("{}/{}", sub.as_str(), alt.file_name().and_then(|s| s.to_str()).unwrap_or(&rel_path));
                        zip_writer.start_file(&zip_name, options.clone())
                            .map_err(|e| format!("zip 写入失败: {}", e))?;
                        zip_writer.write_all(content.as_bytes())
                            .map_err(|e| format!("zip 写入失败: {}", e))?;
                        continue;
                    }
                    return Err(format!("文件 '{}' 不存在", id));
                }
                let content = fs::read_to_string(&full_path)
                    .map_err(|e| format!("读取 {} 失败: {}", id, e))?;
                let zip_name = format!("{}/{}", sub.as_str(), rel_path);
                zip_writer.start_file(&zip_name, options.clone())
                    .map_err(|e| format!("zip 写入失败: {}", e))?;
                zip_writer.write_all(content.as_bytes())
                    .map_err(|e| format!("zip 写入失败: {}", e))?;
            }
        }

        zip_writer.finish().map_err(|e| format!("zip 完成失败: {}", e))?;
    }
    Ok(buf)
}

/// 从 ZIP 字节导入文件到工作区子目录
pub fn import_files_from_zip(app: &tauri::AppHandle, sub: WorkspaceDir, zip_data: Vec<u8>) -> Result<usize, String> {
    let dir = subdir_path(app, sub)?;
    let reader = std::io::Cursor::new(zip_data);
    let mut archive = zip::ZipArchive::new(reader)
        .map_err(|e| format!("读取 zip 失败: {}", e))?;

    let mut count = 0;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("读取 zip 条目失败: {}", e))?;
        let name = file.name().to_string();

        // 跳过目录条目
        if name.ends_with('/') { continue; }

        // 只处理 .md 和 .js/.ts 等技能相关文件
        let filename = name.rsplit('/').next().unwrap_or(&name).to_string();
        if filename.starts_with('.') { continue; }

        let out_path = if dir.join(&filename).exists() {
            // 冲突：追加时间戳
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let stem = match filename.rfind('.') {
                Some(pos) => &filename[..pos],
                None => &filename,
            };
            let ext = match filename.rfind('.') {
                Some(pos) => &filename[pos + 1..],
                None => "md",
            };
            dir.join(format!("{}_{}.{}", stem, ts, ext))
        } else {
            dir.join(&filename)
        };

        let mut content = Vec::new();
        std::io::Read::read_to_end(&mut file, &mut content)
            .map_err(|e| format!("读取 zip 内容失败: {}", e))?;
        fs::write(&out_path, &content)
            .map_err(|e| format!("写入文件失败: {}", e))?;
        count += 1;
    }
    Ok(count)
}

/// 从本地目录导入文件到工作区子目录（递归复制 .md 文件）
pub fn import_files_from_directory(app: &tauri::AppHandle, sub: WorkspaceDir, src_dir: &str) -> Result<usize, String> {
    let src = Path::new(src_dir);
    if !src.is_dir() {
        return Err(format!("'{}' 不是有效的目录", src_dir));
    }
    let dest = subdir_path(app, sub)?;
    let mut count = 0;

    for entry in walkdir::WalkDir::new(src)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
        // 只导入常见的技能文件类型
        if !matches!(ext, "md" | "js" | "ts" | "jsx" | "tsx" | "yaml" | "yml" | "json" | "css" | "py" | "rs" | "sh" | "toml") {
            continue;
        }
        let filename = path.file_name()
            .and_then(|s| s.to_str())
            .ok_or_else(|| "无效文件名".to_string())?;
        let content = fs::read_to_string(path)
            .map_err(|e| format!("读取文件失败: {}", e))?;
        let out_path = dest.join(filename);
        if out_path.exists() {
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            let stem = filename.rsplit('.').nth(1).unwrap_or(filename);
            let new_name = format!("{}_{}.{}", stem, ts, ext);
            fs::write(dest.join(&new_name), &content)
                .map_err(|e| format!("写入文件失败: {}", e))?;
        } else {
            fs::write(&out_path, &content)
                .map_err(|e| format!("写入文件失败: {}", e))?;
        }
        count += 1;
    }
    if count == 0 {
        return Err("目录中未找到可导入的文件".to_string());
    }
    Ok(count)
}

/// 从 ZIP 文件路径导入到工作区子目录（读取本地文件）
pub fn import_files_from_zip_path(app: &tauri::AppHandle, sub: WorkspaceDir, zip_path: &str) -> Result<usize, String> {
    let data = fs::read(zip_path).map_err(|e| format!("读取 ZIP 文件失败: {}", e))?;
    import_files_from_zip(app, sub, data)
}

/// 将工作区子目录下指定文件导出为 ZIP 并写入到指定路径
pub fn export_files_as_zip_to_path(app: &tauri::AppHandle, sub: WorkspaceDir, ids: &[String], out_path: &str) -> Result<usize, String> {
    let data = export_files_as_zip(app, sub, ids)?;
    fs::write(out_path, &data).map_err(|e| format!("写入 ZIP 文件失败: {}", e))?;
    Ok(data.len())
}

/// 递归将目录添加到 ZIP
pub(super) fn add_dir_to_zip<W: std::io::Write + std::io::Seek>(
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
