//! CeBianDesktop 后端库
//!
//! 初始化 Tauri 应用并注册所有 IPC 命令

mod ai;
mod commands;
mod config_storage;
mod mcp_client;
mod server;
mod tools;
mod workspace;

use commands::McpServerState;
use mcp_client::McpClientManager;

/// 运行 Tauri 桌面应用
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 窗口状态插件：记住窗口大小和位置
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_window_state::Builder::default().build())?;

            // 初始化 AI 文件操作的路径沙箱（工作区根目录）
            if let Ok(skills_dir) = workspace::get_subdir_path(app.handle(), workspace::WorkspaceDir::Skills) {
                if let Some(parent) = skills_dir.parent() {
                    tools::init_allowed_dirs(&parent.to_string_lossy());
                }
            }

            // 启动工作区文件监听
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(500));
                let _ = workspace::start_watcher(handle, workspace::WorkspaceDir::Skills);
            });

            Ok(())
        })
        .manage(McpServerState::new())
        .manage(McpClientManager::new())
        .invoke_handler(tauri::generate_handler![
            commands::get_tools,
            commands::execute_tool,
            commands::confirm_tool_execution,
            commands::cancel_tool_execution,
            commands::call_ai,
            commands::call_ai_streaming,
            commands::start_mcp_server,
            commands::stop_mcp_server,
            commands::get_server_status,
            commands::save_app_config,
            commands::load_app_config,
            commands::save_conversations,
            commands::load_conversations,
            commands::list_prompts,
            commands::save_prompt,
            commands::delete_prompt,
            commands::connect_mcp_server,
            commands::disconnect_mcp_server,
            commands::list_mcp_connections,
            commands::get_mcp_tools,
            commands::call_mcp_tool,
            commands::save_mcp_config,
            commands::load_mcp_config,
            commands::list_workspace_files,
            commands::read_workspace_file,
            commands::write_workspace_file,
            commands::delete_workspace_file,
            commands::rename_workspace_file,
            commands::create_workspace_subdir,
            commands::delete_workspace_subdir,
            commands::move_workspace_file,
            commands::generate_workspace_id,
            commands::export_workspace_file,
            commands::import_workspace_file,
            commands::open_workspace_dir,
            commands::export_backup,
            commands::import_backup,
            commands::write_file_to_path,
            commands::export_workspace_zip,
            commands::import_workspace_zip,
            commands::import_workspace_directory,
            commands::export_workspace_zip_to_path,
            commands::import_workspace_zip_path,
            commands::open_file_location,
            commands::get_workspace_file_path,
        ])
        .run(tauri::generate_context!())
        .expect("启动应用时出错");
}
