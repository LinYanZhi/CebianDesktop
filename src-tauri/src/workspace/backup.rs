use std::fs;
use std::io::Write;
use tauri::Manager;

use super::zip::add_dir_to_zip;

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
