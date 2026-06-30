//! CeBianDesktop 后端库
//!
//! 初始化 Tauri 应用并注册所有 IPC 命令

mod ai;
mod bridge;
mod commands;
mod config_storage;
mod mcp_client;
mod server;
mod tools;
mod workspace;

use std::sync::Arc;

use commands::McpServerState;
use mcp_client::McpClientManager;

/// 运行 Tauri 桌面应用
pub fn run() {
    // 提前创建桥接状态和句柄，以便在 setup 中同时用于 manage 和启动服务器
    let bridge_state = Arc::new(bridge::BridgeState::new());
    let bridge_state_for_setup = bridge_state.clone();
    let bridge_handle = commands::BridgeServerHandle::new();
    let bridge_handle_for_setup = bridge_handle.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            // 窗口状态插件：记住窗口大小和位置
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_window_state::Builder::default().build())?;

            // 设置 AppHandle 到桥接状态（供 run_desktop_task 使用）
            bridge_state_for_setup.set_app_handle(app.handle().clone());

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

            // 自动启动双 AI 桥接 WebSocket 服务器（从配置读取多端口）
            if let Ok(config) = crate::config_storage::load_config(app.handle()) {
                if !config.bridge_ports.is_empty() {
                    let state_clone = bridge_state_for_setup.clone();
                    let handle_clone = bridge_handle_for_setup.clone();
                    let configs: Vec<(String, u16)> = config
                        .bridge_ports
                        .iter()
                        .map(|p| (p.name.clone(), p.port))
                        .collect();

                    // 先将端口配置注册到 handle，再逐个 spawn
                    let handle_for_setup = bridge_handle_for_setup;
                    tauri::async_runtime::block_on(async {
                        handle_for_setup
                            .set_port_configs(&configs)
                            .await;
                    });

                    for (name, port) in configs {
                        let s = state_clone.clone();
                        let h = handle_clone.clone();
                        let port_for_name = name.clone();
                        let join_handle = tauri::async_runtime::spawn(async move {
                            // 注册端口配置到桥接状态
                            {
                                let mut inner = s.inner.lock().await;
                                inner.port_configs.insert(port, name);
                            }
                            if let Err(e) = bridge::run_bridge_server(s, port).await {
                                eprintln!("[bridge] 桥接服务器（{}:{}）启动失败: {}", port_for_name, port, e);
                            }
                        });
                        // 将 JoinHandle 存到 BridgeServerHandle 中
                        tauri::async_runtime::block_on(async {
                            h.add_handle(port, join_handle).await;
                        });
                    }
                    eprintln!(
                        "[bridge] 已启动 {} 个桥接服务器",
                        config.bridge_ports.len()
                    );
                }
            }

            Ok(())
        })
        .manage(McpServerState::new())
        .manage(McpClientManager::new())
        .manage(bridge_state)
        .manage(bridge_handle)
        .invoke_handler(tauri::generate_handler![
            commands::get_tools,
            commands::get_tool_permission_list,
            commands::execute_tool,
            commands::confirm_tool_execution,
            commands::cancel_tool_execution,
            commands::call_ai,
            commands::call_ai_streaming,
            commands::start_mcp_server,
            commands::stop_mcp_server,
            commands::get_server_status,
            commands::start_bridge_server,
            commands::stop_bridge_server,
            commands::reload_bridge_config,
            commands::get_bridge_status,
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
            commands::export_providers_config,
            commands::import_providers_config,
        ])
        .run(tauri::generate_context!())
        .expect("启动应用时出错");
}
