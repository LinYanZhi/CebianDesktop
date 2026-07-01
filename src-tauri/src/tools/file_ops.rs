use std::fs;
use std::path::Path;
use serde_json::{json, Value};
use walkdir::WalkDir;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use image::GenericImageView;
use std::io::{Read, Write};

// ─── 文件信息查询 ──────────────────────────────────────

pub(crate) fn get_file_info(path: &str) -> Result<Value, String> {
    let p = Path::new(path);
    if !p.exists() { return Err(format!("路径不存在: {}", path)); }

    let metadata = fs::metadata(p).map_err(|e| format!("读取文件元数据失败: {}", e))?;
    let file_size = metadata.len();

    let modified = metadata.modified()
        .ok()
        .map(|t| {
            let duration = t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
            duration.as_secs()
        });

    let created = metadata.created()
        .ok()
        .map(|t| {
            let duration = t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
            duration.as_secs()
        });

    let is_dir = metadata.is_dir();
    let is_file = metadata.is_file();
    let is_symlink = metadata.is_symlink();
    let extension = if is_file {
        p.extension().map(|e| e.to_string_lossy().to_string())
    } else {
        None
    };
    let file_name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();

    // 人类可读格式
    let size_display = if file_size < 1024 {
        format!("{} B", file_size)
    } else if file_size < 1024 * 1024 {
        format!("{:.1} KB", file_size as f64 / 1024.0)
    } else if file_size < 1024 * 1024 * 1024 {
        format!("{:.1} MB", file_size as f64 / (1024.0 * 1024.0))
    } else {
        format!("{:.2} GB", file_size as f64 / (1024.0 * 1024.0 * 1024.0))
    };

    Ok(json!({
        "path": path,
        "name": file_name,
        "size": file_size,
        "size_display": size_display,
        "is_dir": is_dir,
        "is_file": is_file,
        "is_symlink": is_symlink,
        "extension": extension,
        "modified_at": modified,
        "created_at": created,
    }))
}

// ─── 文件读写 ──────────────────────────────────────────

pub(crate) fn read_local_file(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if !p.exists() { return Err(format!("文件不存在: {}", path)); }
    fs::read_to_string(p).map_err(|e| format!("读取失败: {}", e))
}

pub(crate) fn write_new_file(path: &str, content: &str) -> Result<(), String> {
    let p = Path::new(path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(p, content).map_err(|e| format!("写入失败: {}", e))
}

pub(crate) fn edit_file(path: &str, old_text: &str, new_text: &str) -> Result<usize, String> {
    let original = read_local_file(path)?;
    if !original.contains(old_text) {
        return Err("文件中未找到要替换的文本".into());
    }
    let edited = original.replace(old_text, new_text);
    // 统计替换数
    let count = original.matches(old_text).count();
    write_new_file(path, &edited)?;
    Ok(count)
}

// ─── 目录操作 ───────────────────────────────────────────

pub(crate) fn create_directory(path: &str) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("创建目录失败: {}", e))
}

pub(crate) fn list_directory(path: &str) -> Result<Vec<Value>, String> {
    let dir = Path::new(path);
    if !dir.is_dir() { return Err(format!("不是目录: {}", path)); }
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("读取目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let ft = entry.file_type().map_err(|e| format!("获取类型失败: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        entries.push(json!({
            "name": name,
            "is_dir": ft.is_dir(),
            "is_file": ft.is_file(),
        }));
    }
    entries.sort_by(|a, b| {
        let an = a["name"].as_str().unwrap_or("");
        let bn = b["name"].as_str().unwrap_or("");
        // 目录优先
        let a_dir = a["is_dir"].as_bool().unwrap_or(false);
        let b_dir = b["is_dir"].as_bool().unwrap_or(false);
        b_dir.cmp(&a_dir).then(an.to_lowercase().cmp(&bn.to_lowercase()))
    });
    Ok(entries)
}

pub(crate) fn rename_path(old_path: &str, new_path: &str) -> Result<(), String> {
    if !Path::new(old_path).exists() { return Err(format!("路径不存在: {}", old_path)); }
    if let Some(parent) = Path::new(new_path).parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
    }
    fs::rename(old_path, new_path).map_err(|e| format!("重命名失败: {}", e))
}

pub(crate) fn fs_delete(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.exists() { return Err(format!("路径不存在: {}", path)); }
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| format!("删除目录失败: {}", e))
    } else {
        fs::remove_file(p).map_err(|e| format!("删除文件失败: {}", e))
    }
}

pub(crate) fn search_files(directory: &str, pattern: &str, mode: &str) -> Result<Vec<Value>, String> {
    let dir = Path::new(directory);
    if !dir.is_dir() { return Err(format!("不是目录: {}", directory)); }

    let mut results = Vec::new();
    let pattern_lower = pattern.to_lowercase();
    let max_results = 50;

    for entry in WalkDir::new(dir).max_depth(10).into_iter().filter_map(|e| e.ok()) {
        if results.len() >= max_results { break; }
        let path = entry.path();
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_lowercase();

        match mode {
            "content" => {
                if entry.file_type().is_file() {
                    if let Ok(content) = fs::read_to_string(path) {
                        let content_lower = content.to_lowercase();
                        if content_lower.contains(&pattern_lower) {
                            // 找到关键词所在行
                            let matched_lines: Vec<String> = content
                                .lines()
                                .filter(|l| l.to_lowercase().contains(&pattern_lower))
                                .take(3)
                                .map(|l| l.trim().to_string())
                                .collect();
                            results.push(json!({
                                "path": path.display().to_string(),
                                "matched_lines": matched_lines,
                            }));
                        }
                    }
                }
            }
            _ => {
                // "name" 模式
                if name.contains(&pattern_lower) {
                    results.push(json!({
                        "path": path.display().to_string(),
                        "is_dir": entry.file_type().is_dir(),
                    }));
                }
            }
        }
    }
    Ok(results)
}

// ─── Excel 读取 ──────────────────────────────────────────

pub(crate) fn read_excel(path: &str) -> Result<Value, String> {
    use calamine::{open_workbook_auto, Data, Reader};

    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }

    let mut workbook = open_workbook_auto(path)
        .map_err(|e| format!("无法打开 Excel 文件: {}", e))?;

    let sheet_names = workbook.sheet_names().to_vec();
    let mut sheets: Vec<Value> = Vec::new();

    for name in &sheet_names {
        let range = workbook
            .worksheet_range(name)
            .map_err(|e| format!("读取 sheet '{}' 失败: {}", e, name))?;

        let mut rows: Vec<Vec<String>> = Vec::new();
        for row in range.rows() {
            let cells: Vec<String> = row
                .iter()
                .map(|c| match c {
                    Data::String(s) => s.clone(),
                    Data::Float(f) => f.to_string(),
                    Data::Int(i) => i.to_string(),
                    Data::Bool(b) => b.to_string(),
                    Data::DateTime(dt) => dt.to_string(),
                    Data::DateTimeIso(dt) => dt.to_string(),
                    Data::DurationIso(d) => d.to_string(),
                    Data::Error(e) => format!("[ERR: {}]", e),
                    Data::Empty => String::new(),
                })
                .collect();
            rows.push(cells);
        }

        let preview: Vec<Vec<String>> = rows.iter().take(200).cloned().collect();

        sheets.push(json!({
            "name": name,
            "row_count": range.height(),
            "col_count": range.width(),
            "rows": preview,
        }));
    }

    Ok(json!({
        "file": path,
        "sheet_count": sheets.len(),
        "sheets": sheets,
    }))
}

// ─── 批量文件读取 ────────────────────────────────────────

pub(crate) fn read_local_files(paths: Vec<String>) -> Result<Value, String> {
    let image_extensions = [
        "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "tiff", "tif", "ico",
    ];
    let text_extensions = [
        "txt", "md", "json", "xml", "html", "css", "js", "ts", "py", "rs",
        "yaml", "yml", "toml", "ini", "cfg", "log", "csv", "tsv", "sql",
        "sh", "bat", "ps1", "env", "gitignore", "java", "c", "cpp", "h",
        "hpp", "go", "rb", "php",
    ];

    let mut results = Vec::new();

    for path in &paths {
        let p = Path::new(path);
        if !p.exists() {
            results.push(json!({
                "path": path,
                "error": format!("路径不存在: {}", path),
            }));
            continue;
        }

        if !p.is_file() {
            results.push(json!({
                "path": path,
                "error": "不是文件".to_string(),
            }));
            continue;
        }

        let ext = p.extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        let file_name = p.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let metadata = fs::metadata(p).map_err(|e| format!("读取元数据失败: {}", e))?;
        let size = metadata.len();

        if image_extensions.contains(&ext.as_str()) {
            // 图片类型：读取为 base64 data URI
            match fs::read(p) {
                Ok(bytes) => {
                    let b64 = STANDARD.encode(&bytes);
                    let mime = match ext.as_str() {
                        "png" => "image/png",
                        "jpg" | "jpeg" => "image/jpeg",
                        "gif" => "image/gif",
                        "webp" => "image/webp",
                        "bmp" => "image/bmp",
                        "svg" => "image/svg+xml",
                        "tiff" | "tif" => "image/tiff",
                        "ico" => "image/x-icon",
                        _ => "application/octet-stream",
                    };
                    let data_uri = format!("data:{};base64,{}", mime, b64);

                    // 尝试获取图片尺寸
                    let (width, height) = image::open(p)
                        .ok()
                        .map(|img| img.dimensions())
                        .unwrap_or((0, 0));

                    results.push(json!({
                        "path": path,
                        "name": file_name,
                        "size": size,
                        "type": "image",
                        "content": data_uri,
                        "width": width,
                        "height": height,
                    }));
                }
                Err(e) => {
                    results.push(json!({
                        "path": path,
                        "error": format!("读取图片失败: {}", e),
                    }));
                }
            }
        } else if text_extensions.contains(&ext.as_str()) {
            // 文本类型：读取为 UTF-8 字符串
            match fs::read_to_string(p) {
                Ok(content) => {
                    results.push(json!({
                        "path": path,
                        "name": file_name,
                        "size": size,
                        "type": "text",
                        "content": content,
                    }));
                }
                Err(e) => {
                    results.push(json!({
                        "path": path,
                        "name": file_name,
                        "size": size,
                        "type": "binary",
                        "note": format!("文本解码失败，作为二进制处理: {}", e),
                    }));
                }
            }
        } else {
            // 二进制类型：返回大小和类型信息
            results.push(json!({
                "path": path,
                "name": file_name,
                "size": size,
                "type": "binary",
                "extension": ext,
            }));
        }
    }

    Ok(json!({"files": results}))
}

// ─── CSV 读取 ────────────────────────────────────────────

pub(crate) fn read_csv_as_json(path: &str, _encoding: Option<&str>) -> Result<Value, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }

    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_path(p)
        .map_err(|e| format!("无法打开 CSV 文件: {}", e))?;

    let headers: Vec<String> = rdr.headers()
        .map_err(|e| format!("读取 CSV 表头失败: {}", e))?
        .iter()
        .map(|h| h.to_string())
        .collect();

    let mut data: Vec<Value> = Vec::new();

    for result in rdr.records() {
        let record = result.map_err(|e| format!("读取 CSV 行失败: {}", e))?;
        let mut obj = serde_json::Map::new();
        for (i, field) in record.iter().enumerate() {
            if i < headers.len() {
                obj.insert(headers[i].clone(), Value::String(field.to_string()));
            }
        }
        data.push(Value::Object(obj));
    }

    Ok(json!({
        "sheets": {
            "csv": data
        },
        "sheet_names": ["csv"]
    }))
}

// ─── 解压压缩包 ──────────────────────────────────────────

pub(crate) fn extract_archive(path: &str, target_dir: Option<&str>) -> Result<Value, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("文件不存在: {}", path));
    }

    let dest = target_dir.map(|d| d.to_string()).unwrap_or_else(|| {
        // 默认解压到与压缩包同名的目录（不含扩展名）
        let stem = p.file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "extracted".to_string());
        if let Some(parent) = p.parent() {
            parent.join(&stem).to_string_lossy().to_string()
        } else {
            stem
        }
    });

    // 确保目标目录存在
    fs::create_dir_all(&dest).map_err(|e| format!("创建目标目录失败: {}", e))?;

    let path_lower = path.to_lowercase();

    let file_count = if path_lower.ends_with(".zip") {
        // 解压 zip
        let file = fs::File::open(p).map_err(|e| format!("打开文件失败: {}", e))?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| format!("读取 zip 失败: {}", e))?;

        let count = archive.len();
        archive.extract(&dest)
            .map_err(|e| format!("解压 zip 失败: {}", e))?;
        count
    } else if path_lower.ends_with(".tar.gz") || path_lower.ends_with(".tgz") {
        // 解压 tar.gz
        let file = fs::File::open(p).map_err(|e| format!("打开文件失败: {}", e))?;
        let decoder = flate2::read::GzDecoder::new(file);
        let mut archive = tar::Archive::new(decoder);

        // 先统计文件数量
        let count = archive.entries()
            .map_err(|e| format!("读取 tar 条目失败: {}", e))?
            .filter_map(|e| e.ok())
            .count();

        // 重新打开并解压
        let file = fs::File::open(p).map_err(|e| format!("打开文件失败: {}", e))?;
        let decoder = flate2::read::GzDecoder::new(file);
        let mut archive = tar::Archive::new(decoder);
        archive.unpack(&dest).map_err(|e| format!("解压 tar.gz 失败: {}", e))?;
        count
    } else if path_lower.ends_with(".tar") {
        // 解压 tar
        let file = fs::File::open(p).map_err(|e| format!("打开文件失败: {}", e))?;
        let mut archive = tar::Archive::new(file);

        // 先统计文件数量
        let count = archive.entries()
            .map_err(|e| format!("读取 tar 条目失败: {}", e))?
            .filter_map(|e| e.ok())
            .count();

        // 重新打开并解压
        let file = fs::File::open(p).map_err(|e| format!("打开文件失败: {}", e))?;
        let mut archive = tar::Archive::new(file);
        archive.unpack(&dest).map_err(|e| format!("解压 tar 失败: {}", e))?;
        count
    } else {
        return Err(format!("不支持的压缩格式: {}", path));
    };

    Ok(json!({
        "success": true,
        "extracted": path,
        "file_count": file_count,
        "target_dir": dest,
    }))
}

// ─── 压缩为 zip ──────────────────────────────────────────

pub(crate) fn compress_files(paths: Vec<String>, output: &str) -> Result<Value, String> {
    let output_path = Path::new(output);
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    let file = fs::File::create(output_path)
        .map_err(|e| format!("创建输出文件失败: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);

    let options: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut file_count = 0usize;

    for path_str in &paths {
        let p = Path::new(path_str);
        if !p.exists() {
            continue;
        }

        if p.is_dir() {
            // 遍历目录，递归添加文件
            for entry in WalkDir::new(p).into_iter().filter_map(|e| e.ok()) {
                let entry_path = entry.path();
                let relative = entry_path
                    .strip_prefix(p.parent().unwrap_or(p))
                    .map_err(|e| format!("计算相对路径失败: {}", e))?
                    .to_string_lossy()
                    .to_string()
                    .replace('\\', "/");

                if entry.file_type().is_dir() {
                    zip.add_directory(&relative, options)
                        .map_err(|e| format!("添加目录失败: {}", e))?;
                } else {
                    let mut f = fs::File::open(entry_path)
                        .map_err(|e| format!("打开文件失败: {}", e))?;
                    zip.start_file(&relative, options)
                        .map_err(|e| format!("添加文件失败: {}", e))?;
                    let mut buffer = Vec::new();
                    f.read_to_end(&mut buffer)
                        .map_err(|e| format!("读取文件失败: {}", e))?;
                    zip.write_all(&buffer)
                        .map_err(|e| format!("写入 zip 失败: {}", e))?;
                    file_count += 1;
                }
            }
        } else {
            // 单个文件
            let file_name = p.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let mut f = fs::File::open(p)
                .map_err(|e| format!("打开文件失败: {}", e))?;
            zip.start_file(&file_name, options)
                .map_err(|e| format!("添加文件失败: {}", e))?;
            let mut buffer = Vec::new();
            f.read_to_end(&mut buffer)
                .map_err(|e| format!("读取文件失败: {}", e))?;
            zip.write_all(&buffer)
                .map_err(|e| format!("写入 zip 失败: {}", e))?;
            file_count += 1;
        }
    }

    // 完成 zip 写入
    let zipped = zip.finish()
        .map_err(|e| format!("完成 zip 写入失败: {}", e))?;

    let size = zipped.metadata()
        .map(|m| m.len())
        .unwrap_or(0);

    Ok(json!({
        "success": true,
        "output": output,
        "file_count": file_count,
        "size": size,
    }))
}
