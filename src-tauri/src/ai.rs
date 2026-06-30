//! AI LLM 客户端
//!
//! 提供与 OpenAI 兼容 API 的交互功能，包括聊天补全、工具调用以及流式 AI 支持

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Emitter;

use crate::tools;

/// 思考模式（对应 CeBian 的三档）
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum ThinkingLevel {
    /// 低思考 - 快速响应，适合简单任务
    #[serde(rename = "low")]
    Low,
    /// 中思考 - 平衡模式
    #[serde(rename = "medium")]
    Medium,
    /// 高思考 - 深度推理，适合复杂任务
    #[serde(rename = "high")]
    High,
}

impl ThinkingLevel {
    /// 返回当前思考模式对应的最大 token 数
    pub fn max_tokens(self) -> u32 {
        match self {
            ThinkingLevel::Low => 2048,
            ThinkingLevel::Medium => 4096,
            ThinkingLevel::High => 8192,
        }
    }

    /// 返回当前思考模式的显示标签
    #[allow(dead_code)]
    pub fn label(self) -> &'static str {
        match self {
            ThinkingLevel::Low => "低",
            ThinkingLevel::Medium => "中",
            ThinkingLevel::High => "高",
        }
    }
}

impl Default for ThinkingLevel {
    fn default() -> Self {
        ThinkingLevel::Medium
    }
}

/// AI 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIConfig {
    /// API 基础地址，例如 https://api.openai.com/v1
    #[serde(default, rename = "endpoint")]
    pub base_url: String,
    /// API 密钥
    #[serde(default)]
    pub api_key: String,
    /// 模型名称，例如 gpt-3.5-turbo
    #[serde(default = "default_model")]
    pub model: String,
    /// 最大生成 token 数（0 表示根据 thinking_level 自动选择）
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    /// 温度参数（0.0 ~ 2.0），控制输出的随机性
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    /// 系统提示词
    #[serde(default)]
    pub system_prompt: String,
    /// 是否启用双 AI 模式
    #[serde(default)]
    pub dual_ai: bool,
    /// 思考模式
    #[serde(default)]
    pub thinking_level: ThinkingLevel,
    /// 权限模式（conservative / balanced / trusted）
    #[serde(default)]
    pub permission_mode: Option<String>,
}

fn default_model() -> String {
    "gpt-3.5-turbo".to_string()
}

fn default_max_tokens() -> u32 {
    4096
}

fn default_temperature() -> f32 {
    0.7
}

impl Default for AIConfig {
    fn default() -> Self {
        Self {
            base_url: String::new(),
            api_key: String::new(),
            model: default_model(),
            max_tokens: default_max_tokens(),
            temperature: default_temperature(),
            system_prompt: String::new(),
            dual_ai: false,
            thinking_level: ThinkingLevel::default(),
            permission_mode: None,
        }
    }
}

/// 聊天消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    /// 消息角色：system、user、assistant、tool
    pub role: String,
    /// 消息文本内容
    #[serde(default)]
    pub content: String,
    /// 工具调用列表（仅 assistant 消息包含）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    /// 工具调用 ID（用于响应工具执行结果）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// 工具名称
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// 工具调用
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    /// 工具调用唯一 ID
    pub id: String,
    /// 调用类型（固定为 "function"）
    #[serde(rename = "type")]
    pub type_: String,
    /// 函数调用信息
    pub function: ToolCallFunction,
}

/// 工具调用中的函数信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallFunction {
    /// 函数/工具名称
    pub name: String,
    /// 参数（JSON 字符串格式）
    pub arguments: String,
}

/// 内部辅助：将 ChatMessage 列表转换为 API 请求的 JSON 消息数组
fn build_api_messages(config: &AIConfig, messages: &[ChatMessage]) -> Vec<Value> {
    let mut api_messages: Vec<Value> = Vec::new();

    // 始终注入应用层系统提示词（先于用户自定义提示词），指导 AI 行为规范
    let permission_mode = config.permission_mode.as_deref().unwrap_or("conservative");
    let permission_rules = match permission_mode {
        "trusted" => "当前安全模式：**信任模式** — 你的所有工具调用都会自动执行，无需用户确认。请谨慎操作。",
        "balanced" => "当前安全模式：**平衡模式** — 高风险操作（删除文件、执行命令、删除技能）需要用户确认，其他操作自动执行。",
        _ => "当前安全模式：**保守模式** — 中高风险操作（写入/编辑/删除文件、执行命令、修改系统设置）都需要用户确认后才能执行。",
    };
    let base_system_prompt = format!(
        "{}",
        format!(
            "你是 CeBianDesktop 桌面应用的 AI 助手，通过内置工具与用户系统和文件交互。\n\n\
             {}\n\n\
             核心规则：\n\
             1. 优先使用内置工具完成任务。不要通过 run_command 自行编写脚本绕过工具限制。\n\
             2. 一次对话中最多允许 10 轮工具调用（思考→调工具→看结果→再思考的循环），\
                超限会自动中止。尽量在 5 轮内完成一个独立任务。\n\
             3. 如果某个工具连续失败 2 次，说明当前方案不可行，应换思路或明确告知用户，不要盲目重试。\n\
             4. 对于系统管理类操作（安装软件、修改系统设置、添加输入法等），\
                优先使用专门的内置工具（如 system_add_language），不要用 run_command 拼命令。\n\
             5. 如果当前环境（沙盒、受限账户等）限制了操作，明确告知用户原因，不要反复尝试。\n\
             6. 工具执行返回错误时，分析错误原因，不要用相同参数重复调用。\n\
             7. 禁止在桌面、文档等用户可见目录创建临时脚本文件（.ps1/.bat/.cmd/.vbs）。\
                用 run_command 执行内联命令（如 powershell -Command \"...\"），\
                如需写脚本文件则存到临时目录（%TEMP%）并在执行后立即删除。\n\
             8. 你的回答应当简洁、准确，直接给出结果或结论，避免长篇大论。",
            permission_rules
        )
    );
    api_messages.push(json!({
        "role": "system",
        "content": base_system_prompt
    }));

    // 添加用户自定义系统提示词
    if !config.system_prompt.is_empty() {
        api_messages.push(json!({
            "role": "system",
            "content": config.system_prompt
        }));
    }

    // 添加聊天历史
    for msg in messages {
        let mut api_msg = json!({
            "role": msg.role,
            "content": msg.content,
        });

        // 添加工具调用（如果有）
        if let Some(tool_calls) = &msg.tool_calls {
            let calls: Vec<Value> = tool_calls
                .iter()
                .map(|tc| {
                    json!({
                        "id": tc.id,
                        "type": tc.type_,
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        }
                    })
                })
                .collect();
            api_msg["tool_calls"] = Value::Array(calls);
        }

        // 添加工具调用 ID（用于 tool 角色消息）
        if let Some(tool_call_id) = &msg.tool_call_id {
            api_msg["tool_call_id"] = Value::String(tool_call_id.clone());
        }

        // 添加工具名称
        if let Some(name) = &msg.name {
            api_msg["name"] = Value::String(name.clone());
        }

        api_messages.push(api_msg);
    }

    api_messages
}

/// 获取有效的 max_tokens 值（优先使用用户设置，否则根据思考模式自动选择）
fn effective_max_tokens(config: &AIConfig) -> u32 {
    if config.max_tokens > 0 {
        config.max_tokens
    } else {
        config.thinking_level.max_tokens()
    }
}

/// 构建 AI 请求中使用的工具定义列表（OpenAI 函数调用格式）
fn build_openai_tools(app_handle: Option<&tauri::AppHandle>) -> Vec<Value> {
    let tools = tools::get_tool_definitions();
    let mut result: Vec<Value> = tools
        .iter()
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": tool["name"],
                    "description": tool["description"],
                    "parameters": tool["inputSchema"],
                }
            })
        })
        .collect();

    // 追加动态技能工具（去重，避免与内置工具重名）
    if let Some(handle) = app_handle {
        if let Ok(skill_tools) = tools::get_skill_tools(handle) {
            for st in skill_tools {
                let name = st["name"].as_str().unwrap_or("");
                if !result.iter().any(|r| r["function"]["name"].as_str() == Some(name)) {
                    result.push(json!({
                        "type": "function",
                        "function": {
                            "name": st["name"],
                            "description": st["description"],
                            "parameters": st["inputSchema"],
                        }
                    }));
                }
            }
        }
    }

    result
}

/// 调用 AI LLM（OpenAI 兼容 API）
///
/// 向 OpenAI 兼容的 API 发送聊天补全请求，支持工具调用功能。
///
/// # 参数
/// * `config` - AI 配置
/// * `messages` - 聊天历史消息列表
///
/// # 返回
/// AI 的回复消息
pub fn call_llm(config: &AIConfig, messages: &[ChatMessage]) -> Result<ChatMessage, String> {
    let api_key = config.api_key.trim();
    if config.base_url.is_empty() {
        return Err("base_url 未设置".to_string());
    }
    if api_key.is_empty() {
        return Err("api_key 未设置".to_string());
    }

    // 构建请求 URL
    let url = format!(
        "{}/chat/completions",
        config.base_url.trim_end_matches('/')
    );

    // 构建消息列表
    let api_messages = build_api_messages(config, messages);

    // 构建请求体
    let openai_tools = build_openai_tools(None);
    let mut request_body = json!({
        "model": config.model,
        "messages": api_messages,
        "max_tokens": effective_max_tokens(config),
        "temperature": config.temperature,
    });

    // 如果有工具定义，添加到请求中
    if !openai_tools.is_empty() {
        request_body["tools"] = Value::Array(openai_tools);
    }

    // 发送请求
    let response = ureq::post(&url)
        .set("Authorization", &format!("Bearer {}", api_key))
        .set("Content-Type", "application/json")
        .send_json(&request_body)
        .map_err(|e| format!("API 请求失败: {}", e))?;

    let response_body: Value = response
        .into_json()
        .map_err(|e| format!("解析 API 响应失败: {}", e))?;

    // 检查 API 错误
    if let Some(error) = response_body.get("error") {
        let message = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("未知错误");
        return Err(format!("API 错误: {}", message));
    }

    // 提取回复消息
    let choice = response_body
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|c| c.first())
        .ok_or("API 响应中没有 choices")?;

    let message = choice
        .get("message")
        .ok_or("API 响应中没有 message")?;

    let role = message
        .get("role")
        .and_then(|r| r.as_str())
        .unwrap_or("assistant")
        .to_string();

    let content = message
        .get("content")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string();

    let tool_calls = message.get("tool_calls").and_then(|tc| {
        tc.as_array().map(|arr| {
            arr.iter()
                .map(|tc_val| ToolCall {
                    id: tc_val["id"].as_str().unwrap_or("").to_string(),
                    type_: tc_val["type"].as_str().unwrap_or("function").to_string(),
                    function: ToolCallFunction {
                        name: tc_val["function"]["name"]
                            .as_str()
                            .unwrap_or("")
                            .to_string(),
                        arguments: tc_val["function"]["arguments"]
                            .as_str()
                            .unwrap_or("{}")
                            .to_string(),
                    },
                })
                .collect()
        })
    });

    Ok(ChatMessage {
        role,
        content,
        tool_calls,
        tool_call_id: None,
        name: None,
    })
}

/// 执行 AI 请求的工具调用
///
/// 解析 assistant 消息中的工具调用请求，执行对应的本地工具，并返回工具执行结果消息。
///
/// # 参数
/// * `tool_calls` - 助手消息中的工具调用列表
/// * `app_handle` - Tauri 应用句柄（用于执行技能相关工具）
///
/// # 返回
/// 工具执行结果消息列表（每条结果对应一个工具调用）
pub fn execute_tool_call(tool_calls: &[ToolCall], app_handle: Option<&tauri::AppHandle>) -> Vec<ChatMessage> {
    let mut results = Vec::new();

    for call in tool_calls {
        let tool_name = &call.function.name;

        // 解析参数
        let args: Value = serde_json::from_str(&call.function.arguments).unwrap_or(json!({}));

        // 执行工具
        let result = if tool_name.starts_with("skill_") {
            // 技能执行工具（skill_xxx）
            if let Some(handle) = app_handle {
                tools::execute_skill(handle, tool_name, &args)
            } else {
                Err("缺少 app_handle，无法执行技能".to_string())
            }
        } else if matches!(tool_name.as_str(), "skill_list" | "skill_create" | "skill_read" | "skill_delete") {
            // 技能管理工具需要 app_handle
            if let Some(handle) = app_handle {
                crate::commands::execute_tool_internal(tool_name, &args, handle)
            } else {
                Err("缺少 app_handle，无法执行技能管理工具".to_string())
            }
        } else {
            tools::execute_tool(tool_name, &args)
        };

        let content = match result {
            Ok(value) => serde_json::to_string_pretty(&value).unwrap_or_default(),
            Err(e) => format!("工具执行失败: {}", e),
        };

        results.push(ChatMessage {
            role: "tool".to_string(),
            content,
            tool_calls: None,
            tool_call_id: Some(call.id.clone()),
            name: Some(tool_name.clone()),
        });
    }

    results
}

/// 流式调用 AI（OpenAI 兼容 SSE）
///
/// 通过 Tauri 事件向前端发送流式 token。
///
/// 事件列表：
/// - "ai:token" - { token: String } 每个内容 token
/// - "ai:thinking" - { token: String } 思考过程 token（如有）
/// - "ai:tool_call" - { id, name, arguments } 检测到工具调用
/// - "ai:tool_result" - { id, name, content } 工具执行完毕
/// - "ai:done" - { content: String } 流式完成
/// - "ai:error" - { error: String } 发生错误
///
/// # 参数
/// * `config` - AI 配置
/// * `messages` - 聊天消息列表
/// * `app_handle` - Tauri 应用句柄，用于发送事件
///
/// # 返回
/// 成功返回 Ok(()), 失败返回 Err(String)
pub fn call_llm_streaming(
    config: &AIConfig,
    messages: &[ChatMessage],
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    let api_key = config.api_key.trim();
    if config.base_url.is_empty() {
        return Err("base_url 未设置".to_string());
    }
    if api_key.is_empty() {
        return Err("api_key 未设置".to_string());
    }

    let key_prefix = if api_key.len() > 8 {
        &api_key[..8]
    } else {
        api_key
    };
    eprintln!(
        "[ai::call_llm_streaming] url={}, model={}, api_key_prefix={}, key_len={}",
        config.base_url.trim_end_matches('/'),
        config.model,
        key_prefix,
        api_key.len()
    );

    let url = format!(
        "{}/chat/completions",
        config.base_url.trim_end_matches('/')
    );

    // 创建带超时的 Agent
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(30))
        .build();

    let mut current_messages: Vec<ChatMessage> = messages.to_vec();

    loop {

        // 构建请求体
        let api_messages = build_api_messages(config, &current_messages);
        let openai_tools = build_openai_tools(Some(app_handle));
        let mut request_body = json!({
            "model": config.model,
            "messages": api_messages,
            "max_tokens": effective_max_tokens(config),
            "temperature": config.temperature,
            "stream": true,
        });

        if !openai_tools.is_empty() {
            request_body["tools"] = Value::Array(openai_tools);
        }

        // 发送流式请求（带超时）
        let response = agent
            .post(&url)
            .set("Authorization", &format!("Bearer {}", api_key))
            .set("Content-Type", "application/json")
            .send_json(&request_body)
            .map_err(|e| match e {
                ureq::Error::Status(code, resp) => {
                    let body = resp.into_string().unwrap_or_default();
                    format!("API 流式请求失败: HTTP {} - {}", code, body)
                }
                e => format!("API 流式请求失败: {}", e),
            })?;

        // 逐行读取 SSE 响应
        let reader = BufReader::new(response.into_reader());
        let mut content = String::new();
        // 按 index 积累工具调用（工具调用可能分多个 chunk 发送）
        let mut tool_call_map: HashMap<usize, AccumulatedToolCall> = HashMap::new();

        for line_result in reader.lines() {
            let line = line_result.map_err(|e| format!("读取 SSE 流失败: {}", e))?;

            if !line.starts_with("data: ") {
                continue;
            }

            let data = &line[6..]; // 去掉 "data: " 前缀

            if data == "[DONE]" {
                break;
            }

            let chunk: Value = serde_json::from_str(data)
                .map_err(|e| format!("解析 SSE 数据失败: {} (data: {})", e, data))?;

            let choices = match chunk.get("choices").and_then(|c| c.as_array()) {
                Some(c) => c,
                None => continue,
            };

            if choices.is_empty() {
                continue;
            }

            let delta = &choices[0]["delta"];

            // 提取内容 token 并发送事件
            if let Some(token) = delta.get("content").and_then(|c| c.as_str()) {
                if !token.is_empty() {
                    content.push_str(token);
                    let _ = app_handle.emit("ai:token", json!({"token": token}));
                }
            }

            // 提取思考/推理 token 并发送事件（如 DeepSeek 的 reasoning_content）
            if let Some(token) = delta.get("reasoning_content").and_then(|c| c.as_str()) {
                if !token.is_empty() {
                    let _ = app_handle.emit("ai:thinking", json!({"token": token}));
                }
            }

            // 积累工具调用（工具调用是分多个 chunk 按 index 发送的）
            if let Some(tool_calls) = delta.get("tool_calls").and_then(|tc| tc.as_array()) {
                for tc in tool_calls {
                    let index = tc.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;

                    let entry = tool_call_map.entry(index).or_insert(AccumulatedToolCall {
                        id: String::new(),
                        name: String::new(),
                        arguments: String::new(),
                    });

                    if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                        entry.id.push_str(id);
                    }

                    if let Some(name) = tc
                        .get("function")
                        .and_then(|f| f.get("name"))
                        .and_then(|v| v.as_str())
                    {
                        entry.name.push_str(name);
                    }

                    if let Some(args) = tc
                        .get("function")
                        .and_then(|f| f.get("arguments"))
                        .and_then(|v| v.as_str())
                    {
                        entry.arguments.push_str(args);
                    }
                }
            }
        }

        // 将积累的工具调用转换为 ToolCall 列表
        let mut indices: Vec<usize> = tool_call_map.keys().cloned().collect();
        indices.sort();

        let tool_calls: Vec<ToolCall> = indices
            .iter()
            .map(|idx| {
                let entry = &tool_call_map[idx];
                ToolCall {
                    id: entry.id.clone(),
                    type_: "function".to_string(),
                    function: ToolCallFunction {
                        name: entry.name.clone(),
                        arguments: entry.arguments.clone(),
                    },
                }
            })
            .collect();

        if tool_calls.is_empty() {
            // 没有工具调用，流式完成
            let _ = app_handle.emit("ai:done", json!({"content": content}));
            return Ok(());
        }

        // ---- 工具调用处理 ----

        // 构建 assistant 消息并加入历史
        let assistant_msg = ChatMessage {
            role: "assistant".to_string(),
            content: content.clone(),
            tool_calls: Some(tool_calls.clone()),
            tool_call_id: None,
            name: None,
        };

        // 发送工具调用事件
        for tc in &tool_calls {
            let _ = app_handle.emit(
                "ai:tool_call",
                json!({
                    "id": tc.id,
                    "name": tc.function.name,
                    "arguments": tc.function.arguments,
                }),
            );
        }

        // 执行工具调用
        let tool_results = execute_tool_call(&tool_calls, Some(app_handle));

        // 发送工具执行结果事件
        for tr in &tool_results {
            let _ = app_handle.emit(
                "ai:tool_result",
                json!({
                    "id": tr.tool_call_id,
                    "name": tr.name,
                    "content": tr.content,
                }),
            );
        }

        // 将 assistant 消息和工具结果加入消息列表，继续下一轮流式调用
        current_messages.push(assistant_msg);
        current_messages.extend(tool_results);
        // continue loop for next iteration
    }
}

/// 内部结构：用于在 SSE 流式响应中按 index 积累工具调用参数
#[derive(Debug, Clone)]
struct AccumulatedToolCall {
    id: String,
    name: String,
    arguments: String,
}
