//! AI 调用命令

use std::sync::Arc;

use tauri::Emitter;

use crate::ai::{call_llm, AIConfig, ChatMessage};
use crate::bridge::BridgeState;

/// 调用 AI LLM
///
/// # 参数
/// * `config` - AI 配置（包括 base_url、api_key、model 等）
/// * `messages` - 聊天消息列表
///
/// # 返回
/// AI 回复消息
#[tauri::command]
pub fn call_ai(config: AIConfig, messages: Vec<ChatMessage>) -> Result<ChatMessage, String> {
    call_llm(&config, &messages)
}

/// 流式调用 AI（通过 Tauri 事件返回结果）
///
/// 在后台线程中运行流式处理，通过以下 Tauri 事件向前端推送实时结果：
/// - "ai:token" - 每个内容 token
/// - "ai:thinking" - 思考过程 token
/// - "ai:tool_call" - 工具调用
/// - "ai:tool_result" - 工具执行结果
/// - "ai:done" - 流式完成
/// - "ai:error" - 发生错误
///
/// # 参数
/// * `app_handle` - Tauri 应用句柄
/// * `bridge_state` - 桥接状态（用于浏览器工具）
/// * `config` - AI 配置
/// * `messages` - 聊天消息列表
#[tauri::command]
pub async fn call_ai_streaming(
    app_handle: tauri::AppHandle,
    bridge_state: tauri::State<'_, Arc<BridgeState>>,
    config: AIConfig,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    let handle = app_handle.clone();
    let bridge = bridge_state.inner().clone();
    let tokio_handle = tokio::runtime::Handle::current();
    // 在后台线程中运行流式处理，避免阻塞 Tauri 的异步运行时
    std::thread::spawn(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            crate::ai::call_llm_streaming(&config, &messages, &handle, Some((&bridge, &tokio_handle)))
        }));
        match result {
            Ok(Err(e)) => {
                let _ = handle.emit("ai:error", serde_json::json!({"error": e}));
                // 广播错误到所有浏览器
                let step = serde_json::json!({
                    "type": "error",
                    "content": e,
                    "tool": null,
                    "timestamp": std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64,
                });
                tokio_handle.block_on(async {
                    crate::bridge::update_desktop_ai_progress(&bridge, step).await;
                });
            }
            Err(panic_err) => {
                let msg = if let Some(s) = panic_err.downcast_ref::<&str>() {
                    s.to_string()
                } else if let Some(s) = panic_err.downcast_ref::<String>() {
                    s.clone()
                } else {
                    "未知线程错误".to_string()
                };
                eprintln!("[call_ai_streaming] thread panicked: {}", msg);
                let _ = handle.emit("ai:error", serde_json::json!({"error": format!("线程错误: {}", msg)}));
                // 广播 panic 错误到所有浏览器
                let step = serde_json::json!({
                    "type": "error",
                    "content": format!("桌面 AI 线程崩溃: {}", msg),
                    "tool": null,
                    "timestamp": std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64,
                });
                tokio_handle.block_on(async {
                    crate::bridge::update_desktop_ai_progress(&bridge, step).await;
                });
            }
            _ => {}
        }
    });
    Ok(())
}
