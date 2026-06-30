use std::fs;
use std::path::Path;
use serde_json::{json, Value};
use walkdir::WalkDir;

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
