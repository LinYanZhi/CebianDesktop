//! CeBianDesktop 后端库
//!
//! 初始化 Tauri 应用并注册所有 IPC 命令

mod ai;
mod commands;
mod config_storage;
mod server;
mod tools;

use commands::McpServerState;

/// 运行 Tauri 桌面应用
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // 窗口状态插件：记住窗口大小和位置
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_window_state::Builder::default().build())?;
            Ok(())
        })
        .manage(McpServerState::new())
        .invoke_handler(tauri::generate_handler![
            commands::get_tools,
            commands::execute_tool,
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
        ])
        .run(tauri::generate_context!())
        .expect("启动应用时出错");
}
