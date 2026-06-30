use std::sync::mpsc;
use std::time::Duration;
use tauri::Emitter;

use super::types::WorkspaceDir;
use super::path::subdir_path;

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
