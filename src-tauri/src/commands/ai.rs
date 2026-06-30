//! AI 调用命令

use crate::ai::{call_llm, AIConfig, ChatMessage};
use tauri::Emitter;

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
/// * `config` - AI 配置
/// * `messages` - 聊天消息列表
#[tauri::command]
pub async fn call_ai_streaming(
    app_handle: tauri::AppHandle,
    config: AIConfig,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    // 在后台线程中运行流式处理，避免阻塞 Tauri 的异步运行时
    let handle = app_handle.clone();
    std::thread::spawn(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            crate::ai::call_llm_streaming(&config, &messages, &handle)
        }));
        match result {
            Ok(Err(e)) => {
                let _ = handle.emit("ai:error", serde_json::json!({"error": e}));
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
            }
            _ => {}
        }
    });
    Ok(())
}
