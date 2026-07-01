//! 双 AI 桥接服务器
//!
//! 桌面端启动 WebSocket 服务，浏览器扩展（Cebian）作为客户端连接。
//! 支持配置多个端口，同一端口可接受多个浏览器连接。
//!
//! ## 协议（JSON-RPC 2.0 over WebSocket）
//!
//! ```json
//! // 桌面 → 浏览器：工具调用请求
//! { "jsonrpc": "2.0", "id": "req_xxx", "method": "tools/call", "params": { "name": "search_web", "arguments": { ... } } }
//!
//! // 浏览器 → 桌面：注册（连接后立即发送）
//! { "jsonrpc": "2.0", "method": "session/register", "params": { "session_id": "...", "client_name": "我的 Edge", "browser": "edge", "version": "120.0", "profile": "Work", "windows": 3 } }
//!
//! // 浏览器 → 桌面：成功响应
//! { "jsonrpc": "2.0", "id": "req_xxx", "result": { ... } }
//!
//! // 浏览器 → 桌面：错误响应
//! { "jsonrpc": "2.0", "id": "req_xxx", "error": { "code": -1, "message": "..." } }
//!
//! // 浏览器 AI → 桌面：请求执行桌面工具
//! // 桌面 AI 收到后执行对应的工具（read_local_file、list_directory 等），返回结果
//! // 工具名称须在白名单中，否则返回错误
//! { "jsonrpc": "2.0", "id": "desktop_req_xxx", "method": "desktop/execute_tool", "params": { "name": "read_local_file", "arguments": { "path": "C:/file.txt" } } }
//! // 桌面 → 浏览器：成功响应
//! { "jsonrpc": "2.0", "id": "desktop_req_xxx", "result": { "content": "..." } }
//!
//! // 浏览器 AI → 桌面：委托任务给桌面 AI（推荐）
//! // 桌面 AI 收到后自行规划工具调用来完成任务，返回最终结果
//! { "jsonrpc": "2.0", "id": "desktop_req_xxx", "method": "desktop/delegate_task", "params": { "task": "读取桌面上的 B站首页封面 文件夹的内容" } }
//! // 桌面 → 浏览器：成功响应
//! { "jsonrpc": "2.0", "id": "desktop_req_xxx", "result": { "content": "文件夹包含 3 个文件..." } }
//! ```

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::connect_info::ConnectInfo;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tauri::Emitter;
use tokio::sync::{oneshot, Mutex};

use crate::ai::{call_llm, AIConfig, ChatMessage, ThinkingLevel};
use crate::config_storage::BridgePortConfig;

/// 桥接服务器默认监听端口
pub const DEFAULT_BRIDGE_PORT: u16 = 37421;

/// 执行桌面任务（由浏览器 AI 通过 desktop/delegate_task 调用）
///
/// 创建一个独立的 AI 代理会话，让 Desktop AI 自主规划工具调用完成任务。
pub async fn run_desktop_task(state: &Arc<BridgeState>, task: &str) -> Result<String, String> {
    let app_handle = state
        .app_handle
        .lock()
        .unwrap()
        .clone()
        .ok_or("桥接服务未初始化（AppHandle 未设置）")?;
    let config = crate::config_storage::load_config(&app_handle)?;
    let active_provider = config
        .providers
        .iter()
        .find(|p| p.id == config.active_provider_id)
        .ok_or("没有激活的 AI 提供商，请先在设置中配置")?;

    let ai_config = AIConfig {
        base_url: active_provider.endpoint.clone(),
        api_key: active_provider.api_key.clone(),
        model: active_provider.selected_model.clone(),
        max_tokens: config.max_tokens,
        temperature: config.temperature as f32,
        system_prompt: config.system_prompt.clone(),
        dual_ai: false,
        thinking_level: ThinkingLevel::Medium,
        permission_mode: None,
    };

    let mut messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: "你是「桌面 AI」，运行在用户的本地计算机上，拥有本地文件系统、命令执行、文件操作等全套桌面工具。\
                      你是「双 AI 桥接」架构中的一端，另一端是「浏览器 AI」（运行在浏览器扩展中）。\
                      \n\n\
                      ## 核心原则：识别并委托浏览器任务\n\
                      \n\
                      如果用户的任务涉及以下内容，请使用 ask_browser_ai 工具委托给浏览器 AI 执行：\n\
                      - 浏览器本身（Chrome、Edge、Firefox 等）\n\
                      - 浏览器扩展的技能（Skills）、配置\n\
                      - 网页操作（搜索、打开网页、读取页面、截图等）\n\
                      - 任何需要在浏览器中完成的操作\n\
                      \n\
                      ## 浏览器选择规则（重要：多浏览器场景）\n\
                      \n\
                      在调用 ask_browser_ai 前，必须先调用 get_connected_browsers 查看浏览器连接状态。\n\
                      \n\
                      如果连接了多个浏览器，**必须使用 ask_user 工具让用户选择**，\
                      不能自作主张选择某一个。例如：\n\
                      \n\
                      1. 调用 get_connected_browsers 获取列表\n\
                      2. 用 ask_user 的 single_select 或 dropdown 类型展示给用户\n\
                      3. options 的 value 设为浏览器的 session_id、port_name 或 browser_type+profile\n\
                      4. label 要清晰，如「Chrome (端口 37422)」「Edge (默认浏览器)」\n\
                      5. 用户选择后，将选项值传入 ask_browser_ai 的 browser_name 参数\n\
                      \n\
                      例外情况（不需要问用户）：\n\
                      - 用户已经明确说了用哪个浏览器（如「用 Chrome 打开百度」）\n\
                      - 只有一个浏览器连接\n\
                      \n\
                      ## 具体案例\n\
                      \n\
                      用户说「帮我读读 edge 的 skill」= Edge 浏览器扩展中的技能，不是桌面的本地技能。\
                      你应该先用 get_connected_browsers 查看已连接的浏览器，然后用 ask_browser_ai 委托浏览器 AI\
                      去读取它自己那边的技能。\n\
                      \n\
                      ## 会话延续（重要：多轮协作）\n\
                      \n\
                      ask_browser_ai 支持会话延续。每次调用返回的结果中包含 conversation_id 字段。\
                      如果你需要让浏览器 AI 基于之前的操作继续工作（例如先让浏览器 AI 列出技能，\
                      读完技能后让它再创建新技能），请把上次返回的 conversation_id 传入下一次 \
                      ask_browser_ai 调用的 conversation_id 参数中。\n\
                      \n\
                      这样浏览器 AI 就会记得它之前做了什么，保持上下文连续性，而不是每次重新开始。\n\
                      \n\
                      ## 你的本地工具（不要误用于浏览器任务）\n\
                      \n\
                      - skill_list / skill_read / skill_create 等：这些操作的是桌面端的技能文件，与浏览器扩展的技能完全无关\n\
                      - 本地文件操作：读写桌面文件、执行命令等\n\
                      \n\
                      请根据用户的任务描述，自主规划并执行工具调用来完成它。\
                      完成所有必要的操作后，用中文给出最终回复。"
                .to_string(),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        },
        ChatMessage {
            role: "user".to_string(),
            content: task.to_string(),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        },
    ];

    let max_rounds: usize = 15;
    for _round in 0..max_rounds {
        let response = call_llm(&ai_config, &messages)?;

        if response.tool_calls.is_none() || response.tool_calls.as_ref().unwrap().is_empty() {
            // LLM 给出最终回复，任务完成
            let final_content = response.content.trim().to_string();
            if final_content.is_empty() {
                return Ok("任务已完成（无具体回复内容）".to_string());
            }
            return Ok(final_content);
        }

        let tool_calls = response.tool_calls.clone().unwrap();
        let tokio_handle = tokio::runtime::Handle::current();
        let results = crate::ai::execute_tool_call(
            &tool_calls,
            Some(&app_handle),
            Some((state, &tokio_handle)),
        );

        messages.push(response);
        messages.extend(results);
    }

    Err(format!(
        "桌面 AI 任务执行超过 {} 轮工具调用上限，请简化任务描述",
        max_rounds
    ))
}

// ─── Shared State ──────────────────────────────────────────

/// 一个已连接的浏览器会话
pub(crate) struct BrowserSession {
    /// 唯一会话 ID（由扩展端生成，UUID v4）
    pub session_id: String,
    /// 此会话所属的端口
    pub port: u16,
    /// 端口名称（如 "默认浏览器"）
    pub port_name: String,
    /// 客户端自定义名称（从 session/register 的 client_name 字段获取）
    pub client_name: String,
    /// 浏览器类型（chrome / edge / firefox）
    pub browser_type: String,
    /// 浏览器版本号
    pub version: String,
    /// 浏览器用户画像名称（如 "Default"、"Work"、"个人"）
    pub profile_name: String,
    /// 浏览器用户画像头像 URL
    pub profile_avatar: String,
    /// 当前窗口数量
    pub window_count: i32,
    /// 客户端的远程地址（IP:端口）
    pub remote_addr: Option<String>,
    /// 向浏览器发送消息的通道
    pub ws_sender: tokio::sync::mpsc::UnboundedSender<Message>,
    /// 连接时间
    pub connected_at: Instant,
}

/// 桥接服务器共享状态
/// 获取本机非回环 IPv4 地址
fn get_local_ip_addresses() -> Vec<String> {
    let mut addrs = Vec::new();
    // UDP 连接技巧：连接一个外部地址但不发送数据，内核会选出正确的本地接口
    if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(local) = socket.local_addr() {
                let ip = local.ip().to_string();
                if ip != "127.0.0.1" && !addrs.contains(&ip) {
                    addrs.push(ip);
                }
            }
        }
    }
    // 也尝试直接获取主机名解析
    if addrs.is_empty() {
        if let Ok(hostname) = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
        {
            if let Ok(Ok(resolved)) = tokio::task::block_in_place(|| {
                std::thread::spawn(move || std::net::ToSocketAddrs::to_socket_addrs(&(hostname, 0)))
                    .join()
            }) {
                for addr in resolved {
                    let ip = addr.ip().to_string();
                    if !ip.starts_with("127.") && !addrs.contains(&ip) {
                        addrs.push(ip);
                    }
                }
            }
        }
    }
    if addrs.is_empty() {
        addrs.push("127.0.0.1".to_string());
    }
    addrs
}

pub struct BridgeState {
    pub(crate) inner: Mutex<BridgeInner>,
    pub(crate) app_handle: std::sync::Mutex<Option<tauri::AppHandle>>,
    /// 本机 IP 地址列表（用于 UI 展示，方便用户在 Cebian 中配置）
    pub local_addresses: Vec<String>,
}

pub(crate) struct BridgeInner {
    /// 所有已连接的浏览器会话（key = session_id）
    pub browsers: HashMap<String, BrowserSession>,
    /// 待处理的 RPC 请求（id → 响应回调）
    pub(crate) pending_requests: HashMap<String, oneshot::Sender<Result<Value, String>>>,
    /// 浏览器 AI 执行进度（request_id → 最新进度 JSON）
    pub pending_progress: HashMap<String, Value>,
    /// 桌面 AI 执行进度（当前会话的最新进度，用于推送到浏览器）
    pub desktop_ai_progress: Value,
    /// 当前配置的端口列表（用于 WS 处理器识别所属端口名称）
    pub port_configs: HashMap<u16, String>, // port → name
}

impl BridgeState {
    /// 创建新的桥接状态
    pub fn new() -> Self {
        let addrs = get_local_ip_addresses();
        Self {
            inner: Mutex::new(BridgeInner {
                browsers: HashMap::new(),
                pending_requests: HashMap::new(),
                pending_progress: HashMap::new(),
                desktop_ai_progress: json!({"steps": [], "status": "idle", "task": ""}),
                port_configs: HashMap::new(),
            }),
            app_handle: std::sync::Mutex::new(None),
            local_addresses: addrs,
        }
    }

    /// 设置 AppHandle（在 setup 中调用）
    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        *self.app_handle.lock().unwrap() = Some(handle);
    }
}

// ─── Server ────────────────────────────────────────────────

/// 启动指定端口列表的桥接服务器（每个端口一个 axum 实例）
pub async fn start_bridge_servers(
    state: Arc<BridgeState>,
    configs: &[BridgePortConfig],
) -> Vec<Result<(), String>> {
    let mut results = Vec::new();
    for cfg in configs {
        // 注册端口配置到共享状态
        {
            let mut inner = state.inner.lock().await;
            inner.port_configs.insert(cfg.port, cfg.name.clone());
        }
        let result = run_bridge_server(state.clone(), cfg.port).await;
        results.push(result);
    }
    results
}

/// 启动单个端口的 WebSocket 桥接服务器（阻塞，通常在 tokio::spawn 中运行）
pub async fn run_bridge_server(state: Arc<BridgeState>, port: u16) -> Result<(), String> {
    let app = Router::new()
        .route("/ws", get({
            move |ws: WebSocketUpgrade,
                  State(state): State<Arc<BridgeState>>,
                  ConnectInfo(remote_addr): ConnectInfo<SocketAddr>| {
                async move {
                    ws.on_upgrade(move |socket| {
                        handle_ws_connection(socket, state, port, Some(remote_addr))
                    })
                }
            }
        }))
        .route("/health", get(health))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("绑定桥接端口 {} 失败: {}", port, e))?;

    eprintln!("[bridge] WebSocket 服务器已启动，端口: {}", port);

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .map_err(|e| format!("桥接服务器运行失败（端口 {}）: {}", port, e))
}

/// 健康检查端点
async fn health() -> impl IntoResponse {
    axum::Json(json!({
        "status": "ok",
        "service": "cebian-bridge",
        "version": "0.1.0"
    }))
}

// ─── WebSocket 连接处理 ────────────────────────────────────

/// 处理 WebSocket 连接
async fn handle_ws_connection(
    socket: WebSocket,
    state: Arc<BridgeState>,
    local_port: u16,
    remote_addr: Option<SocketAddr>,
) {
    let (ws_sender, ws_receiver) = socket.split();

    // 创建内部消息通道
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Message>();

    // 获取此端口对应的浏览器名称
    let port_name = {
        let inner = state.inner.lock().await;
        inner
            .port_configs
            .get(&local_port)
            .cloned()
            .unwrap_or_else(|| format!("端口{}", local_port))
    };

    // ── 关键改动：会话创建推迟到 session/register 消息到达 ──
    // 先创建一个临时 session_key 用于收发注册消息
    // 真正的 session 在收到寄存器消息后用 session_id 创建
    let temp_key = format!("_pending_{}", uuid_v4());

    // 发送任务和接收任务共享的 session_id（注册后更新）
    let session_id = Arc::new(tokio::sync::Mutex::new(temp_key.clone()));

    // 创建临时会话占位（防止清理冲突）
    {
        let mut inner = state.inner.lock().await;
        let remote_addr_str = remote_addr.map(|a| a.to_string());
        inner.browsers.insert(
            temp_key.clone(),
            BrowserSession {
                session_id: temp_key.clone(),
                port: local_port,
                port_name: port_name.clone(),
                client_name: String::new(),
                browser_type: String::new(),
                version: String::new(),
                profile_name: String::new(),
                profile_avatar: String::new(),
                window_count: 0,
                remote_addr: remote_addr_str,
                ws_sender: tx.clone(),
                connected_at: Instant::now(),
            },
        );
    }

    // ── 任务 1：转发桌面端的消息到 WebSocket ──
    let send_task = tokio::spawn(relay_to_websocket(ws_sender, rx));

    // ── 任务 2：从 WebSocket 读取响应并匹配 ──
    let recv_state = state.clone();
    let recv_session_id = session_id.clone();
    let recv_sender = tx.clone();
    let recv_task = tokio::spawn(relay_from_websocket(ws_receiver, recv_state, recv_session_id, port_name.clone(), recv_sender));

    // 等待任意一个任务结束（浏览器断开连接）
    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    // 清理连接
    let final_session_id = session_id.lock().await.clone();
    let mut inner = state.inner.lock().await;
    if let Some(session) = inner.browsers.remove(&final_session_id) {
        let display = if !session.client_name.is_empty() {
            session.client_name.clone()
        } else {
            format!("{}:{}", session.browser_type, session.port)
        };
        // 清理此浏览器所有的 pending 请求
        inner.pending_requests.retain(|id, _| {
            !id.starts_with(&format!("{}_", get_key(&final_session_id)))
        });
        eprintln!("[bridge] 浏览器「{}」已断开", display);
    }
}

/// 从 WebSocket 读取浏览器的响应，匹配到 pending_requests
/// 同时处理浏览器发起的 desktop/execute_tool 请求
async fn relay_from_websocket(
    mut ws_receiver: futures_util::stream::SplitStream<WebSocket>,
    state: Arc<BridgeState>,
    session_id: Arc<tokio::sync::Mutex<String>>,
    port_name: String,
    ws_sender: tokio::sync::mpsc::UnboundedSender<Message>, // ← 新增：用于发送响应回浏览器
) {
    while let Some(Ok(msg)) = ws_receiver.next().await {
        match msg {
            Message::Text(text) => {
                if let Ok(parsed) = serde_json::from_str::<Value>(&text) {
                    // 注册消息（浏览器连接后发送）
                    if parsed.get("method").and_then(|m| m.as_str()) == Some("session/register") {
                        handle_session_register(&parsed, &state, &session_id, &port_name).await;
                        continue;
                    }

                    // 进度通知（浏览器 AI 执行中的流式进度）
                    if parsed.get("method").and_then(|m| m.as_str()) == Some("agent/progress") {
                        if let Some(params) = parsed.get("params") {
                            if let Some(req_id) = params.get("request_id").and_then(|v| v.as_str()) {
                                let mut inner = state.inner.lock().await;
                                inner.pending_progress.insert(req_id.to_string(), params.clone());
                                // 发射 Tauri 事件，前端可实时接收
                                if let Some(handle) = state.app_handle.lock().unwrap().clone() {
                                    let _ = handle.emit("browser-ai-progress", params.clone());
                                }
                            }
                        }
                        continue;
                    }

                    // ── 浏览器 AI 请求执行桌面工具 ──
                    if parsed.get("method").and_then(|m| m.as_str()) == Some("desktop/execute_tool") {
                        let id = parsed.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let name = parsed.pointer("/params/name").and_then(|v| v.as_str()).unwrap_or("");
                        let args = parsed.pointer("/params/arguments").and_then(|v| v.as_object()).cloned().unwrap_or_default();
                        let result = execute_desktop_tool(name, &args).await;
                        let response = match result {
                            Ok(val) => json!({ "jsonrpc": "2.0", "id": id, "result": val }),
                            Err(e) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -1, "message": e } }),
                        };
                        let _ = ws_sender.send(Message::Text(response.to_string().into()));
                        continue;
                    }

                    // ── 浏览器 AI 委托任务给桌面 AI ──
                    if parsed.get("method").and_then(|m| m.as_str()) == Some("desktop/delegate_task") {
                        let id = parsed.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let task = parsed.pointer("/params/task").and_then(|v| v.as_str()).unwrap_or("");
                        if task.is_empty() {
                            let response = json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -1, "message": "缺少 task 参数" } });
                            let _ = ws_sender.send(Message::Text(response.to_string().into()));
                            continue;
                        }
                        // 创建一个独立的 AI 代理来执行任务
                        let result = run_desktop_task(&state, task).await;
                        let response = match result {
                            Ok(val) => json!({ "jsonrpc": "2.0", "id": id, "result": { "content": val } }),
                            Err(e) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -1, "message": e } }),
                        };
                        let _ = ws_sender.send(Message::Text(response.to_string().into()));
                        continue;
                    }

                    // 响应消息（有 id 字段）
                    if let Some(id) = parsed.get("id").and_then(|v| v.as_str()) {
                        let mut inner = state.inner.lock().await;
                        // 请求完成，清除进度
                        inner.pending_progress.remove(id);
                        if let Some(sender) = inner.pending_requests.remove(id) {
                            if let Some(error) = parsed.get("error") {
                                let msg = error
                                    .get("message")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("未知错误")
                                    .to_string();
                                let _ = sender.send(Err(msg));
                            } else {
                                let result = parsed.get("result").cloned().unwrap_or(json!(null));
                                let _ = sender.send(Ok(result));
                            }
                        }
                    }
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
}

// ─── 桌面工具白名单 ──────────────────────────────────────────

/// 浏览器 AI 允许调用的桌面工具白名单
const DESKTOP_TOOL_WHITELIST: &[&str] = &[
    "read_local_file",
    "list_directory",
    "get_system_info",
];

/// 执行桌面工具（由浏览器 AI 通过 desktop/execute_tool 请求）
async fn execute_desktop_tool(name: &str, args: &serde_json::Map<String, Value>) -> Result<Value, String> {
    // 白名单检查
    if !DESKTOP_TOOL_WHITELIST.contains(&name) {
        return Err(format!("桌面工具「{}」不在白名单中，不允许浏览器 AI 调用", name));
    }

    match name {
        "read_local_file" => {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or("缺少 path 参数")?;
            let content = tokio::fs::read_to_string(path).await
                .map_err(|e| format!("读取文件失败: {}", e))?;
            Ok(json!({ "content": content, "path": path, "size": content.len() }))
        }
        "list_directory" => {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or("缺少 path 参数")?;
            let mut entries = Vec::new();
            let mut dir = tokio::fs::read_dir(path).await
                .map_err(|e| format!("读取目录失败: {}", e))?;
            while let Some(entry) = dir.next_entry().await
                .map_err(|e| format!("读取目录条目失败: {}", e))? {
                entries.push(json!({
                    "name": entry.file_name().to_string_lossy(),
                    "is_dir": entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false),
                    "size": entry.metadata().await.map(|m| m.len()).unwrap_or(0),
                }));
            }
            Ok(json!({ "entries": entries, "path": path }))
        }
        "get_system_info" => {
            let info = json!({
                "os": std::env::consts::OS,
                "arch": std::env::consts::ARCH,
                "hostname": hostname(),
                "username": whoami(),
            });
            Ok(info)
        }
        _ => Err(format!("未知的桌面工具: {}", name)),
    }
}

/// 获取主机名
fn hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown".to_string())
}

/// 获取当前用户名
fn whoami() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "unknown".to_string())
}

/// 处理浏览器 session/register 消息
async fn handle_session_register(
    parsed: &Value,
    state: &Arc<BridgeState>,
    session_id_mutex: &Arc<tokio::sync::Mutex<String>>,
    port_name: &str,
) {
    let temp_key = session_id_mutex.lock().await.clone();

    // 解析 rich metadata
    let sid = parsed
        .pointer("/params/session_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let client_name = parsed
        .pointer("/params/client_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let browser_type = parsed
        .pointer("/params/browser")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let version = parsed
        .pointer("/params/version")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let profile_name = parsed
        .pointer("/params/profile")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let profile_avatar = parsed
        .pointer("/params/profile_avatar")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let window_count = parsed
        .pointer("/params/windows")
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as i32;

    let final_session_id = if !sid.is_empty() { sid } else { uuid_v4() };

    let mut inner = state.inner.lock().await;

    // 如果已有同 session_id 的连接，先移除旧的
    if inner.browsers.contains_key(&final_session_id) {
        inner.browsers.remove(&final_session_id);
    }

    // 从临时 key 中取出 ws_sender
    let session = inner.browsers.remove(&temp_key);
    if let Some(mut s) = session {
        s.session_id = final_session_id.clone();
        s.client_name = client_name.clone();
        s.browser_type = browser_type.clone();
        s.version = version.clone();
        s.profile_name = profile_name.clone();
        s.profile_avatar = profile_avatar.clone();
        s.window_count = window_count;

        inner.browsers.insert(final_session_id.clone(), s);
        // 更新 session_id 引用
        *session_id_mutex.lock().await = final_session_id.clone();

        let display = if !client_name.is_empty() {
            client_name.clone()
        } else {
            format!("{}@{}", browser_type, port_name)
        };
        eprintln!(
            "[bridge] 浏览器注册: {}（type={}, profile={}, windows={}）",
            display, browser_type, profile_name, window_count
        );
    } else {
        eprintln!("[bridge] 警告：session/register 时未找到临时会话 {}", temp_key);
    }
}

/// 将桌面端的消息转发到 WebSocket（给浏览器）
async fn relay_to_websocket(
    mut ws_sender: SplitSink<WebSocket, Message>,
    mut rx: tokio::sync::mpsc::UnboundedReceiver<Message>,
) {
    while let Some(msg) = rx.recv().await {
        if ws_sender.send(msg).await.is_err() {
            break;
        }
    }
}

// ─── 工具调用 ──────────────────────────────────────────────

/// 获取已连接的浏览器列表（AI 工具用）
pub async fn get_connected_browsers_inner(state: &BridgeState) -> Result<Value, String> {
    let inner = state.inner.lock().await;
    let browsers: Vec<Value> = inner
        .browsers
        .values()
        .map(|b| {
            json!({
                "session_id": b.session_id,
                "port": b.port,
                "port_name": b.port_name,
                "client_name": b.client_name,
                "browser": b.browser_type,
                "version": b.version,
                "profile": b.profile_name,
                "profile_avatar": b.profile_avatar,
                "windows": b.window_count,
                "remote_addr": b.remote_addr,
                "connected_seconds": b.connected_at.elapsed().as_secs_f64().round() as i64,
            })
        })
        .collect();
    Ok(json!({
        "browsers": browsers,
        "count": browsers.len(),
    }))
}

/// 通过桥接执行浏览器工具
///
/// `browser_name`: 指定目标浏览器名称。为 None 时使用第一个已连接的浏览器。
/// 支持按 port_name、client_name、browser_type、profile_name 匹配。
pub async fn execute_browser_tool(
    state: &BridgeState,
    name: &str,
    args: &Value,
    browser_name: Option<&str>,
) -> Result<Value, String> {
    // get_connected_browsers 是内置查询，不转发到浏览器
    if name == "get_connected_browsers" {
        return get_connected_browsers_inner(state).await;
    }

    let (tx, rx) = oneshot::channel();
    let request_id = format!(
        "req_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );

    // 查找目标浏览器（分两步避免双重借用）
    let (ws_sender, found_session_id) = {
        let inner = state.inner.lock().await;

        if inner.browsers.is_empty() {
            return Err(
                "尚未连接任何浏览器，请确保已安装 CeBian 扩展并加载。".to_string(),
            );
        }

        let session = if let Some(bname) = browser_name {
            // 按名称查找：支持 port_name、client_name、browser_type、profile_name 匹配
            inner
                .browsers
                .values()
                .find(|s| {
                    s.port_name == bname
                        || s.client_name == bname
                        || s.browser_type == bname
                        || s.profile_name == bname
                        || s.port_name.contains(bname)
                        || s.client_name.contains(bname)
                        || s.browser_type.contains(bname)
                        || s.profile_name.contains(bname)
                        || format!("{}:{}", s.browser_type, s.profile_name) == bname
                        || format!("{}", s.port) == bname
                })
                .ok_or_else(|| {
                    let info: Vec<String> = inner
                        .browsers
                        .values()
                        .map(|s| {
                            if !s.client_name.is_empty() {
                                format!("「{}」({}:{})", s.client_name, s.browser_type, s.profile_name)
                            } else {
                                format!("{}:{}:{}", s.browser_type, s.profile_name, s.port)
                            }
                        })
                        .collect();
                    format!(
                        "未找到浏览器「{}」，当前已连接的浏览器：{}",
                        bname,
                        info.join("、")
                    )
                })?
        } else {
            // 未指定时使用第一个
            inner.browsers.values().next().ok_or("没有已连接的浏览器")?
        };

        (session.ws_sender.clone(), session.session_id.clone())
    };

    // 用带 session_id 前缀的 id 注册，方便按浏览器清理
    let full_id = format!("{}_{}", get_key(&found_session_id), request_id);
    {
        let mut inner = state.inner.lock().await;
        inner.pending_requests.insert(full_id.clone(), tx);
    }

    // 发送请求到浏览器
    // ask_browser_ai 使用 agent/prompt 方法（让浏览器 AI 自主执行），其他工具使用 tools/call
    let is_agent_prompt = name == "ask_browser_ai";
    let request = if is_agent_prompt {
        let task = args.get("task").and_then(|v| v.as_str()).unwrap_or("");
        // 提取 conversation_id，如果有则透传给浏览器以延续会话上下文
        let conversation_id = args.get("conversation_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());
        let mut params = json!({
            "task": task,
            "timeout": 300_000,
        });
        if let Some(cid) = conversation_id {
            params["conversation_id"] = json!(cid);
        }
        json!({
            "jsonrpc": "2.0",
            "id": full_id,
            "method": "agent/prompt",
            "params": params,
        })
    } else {
        json!({
            "jsonrpc": "2.0",
            "id": full_id,
            "method": "tools/call",
            "params": {
                "name": name,
                "arguments": args,
            }
        })
    };

    let request_id_str = full_id.clone();
    ws_sender
        .send(Message::Text(request.to_string().into()))
        .map_err(|e| format!("发送请求到浏览器失败: {}", e))?;

    // 等待响应。ask_browser_ai 可能需要更长时间（AI 思考+工具调用）
    let timeout_secs = if is_agent_prompt { 300u64 } else { 120u64 };
    let raw_result = match tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), rx).await {
        Ok(Ok(result)) => match result {
            Ok(v) => v,
            Err(e) => return Err(e),
        },
        Ok(Err(_)) => return Err("浏览器已断开连接，未能获取响应".to_string()),
        Err(_) => {
            let mut inner = state.inner.lock().await;
            inner.pending_requests.remove(&request_id_str);
            if is_agent_prompt {
                return Err("浏览器 AI 执行超时（300秒），任务可能过于复杂或浏览器 AI 模型不可用".to_string())
            } else {
                return Err("浏览器工具执行超时（120秒），浏览器可能无响应".to_string())
            }
        }
    };

    // ── ask_browser_ai 结果后处理 ──
    // 展平返回结构，提取有意义的文本内容，让桌面 AI 直接能看懂
    // 同时提取浏览器返回的 conversation_id，供后续会话延续
    if is_agent_prompt {
        let task_text = args.get("task").and_then(|v| v.as_str()).unwrap_or("");

        // 尝试提取 result 字符串（这是 bridge-agent.ts 返回的结构化报告）
        let report_text = raw_result
            .get("result")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        // 提取浏览器返回的 conversation_id（如果浏览器支持会话延续）
        let browser_conversation_id = raw_result
            .get("conversation_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let success = raw_result
            .get("success")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        // 构建带 conversation_id 的响应，方便桌面 AI 后续延续对话
        let make_response = |summary: String| -> Value {
            let mut resp = json!({
                "summary": summary,
            });
            if !browser_conversation_id.is_empty() {
                resp["conversation_id"] = json!(browser_conversation_id);
            }
            resp
        };

        if !report_text.is_empty() {
            // 检查报告是否包含有意义的工具调用记录或 AI 回复
            let has_tool_calls = report_text.contains("执行记录") || report_text.contains("[工具]");
            let has_ai_reply = report_text.contains("浏览器 AI 回复") || report_text.contains("执行总结");
            let has_error = report_text.contains("错误");

            if has_tool_calls || has_ai_reply || has_error {
                // 报告内容有意义，直接返回。同时附加一条「结果说明」帮助桌面 AI 理解
                let summary = if has_error {
                    "浏览器 AI 执行出错，详见下方报告。".to_string()
                } else if report_text.len() > 50 {
                    format!(
                        "✅ 浏览器 AI 已完成任务（调用了工具，生成了执行报告）。\n桌面 AI 注意：以下报告已经包含了完整的浏览器状态和执行详情，直接以此回复用户即可，无需再调用 get_tab_info 或 get_browser_state 验证。\n\n{}",
                        report_text
                    )
                } else {
                    report_text.to_string()
                };
                return Ok(make_response(summary));
            }
        }

        // 报告为空或没有有意义的内容，生成更友好的替代消息
        if success {
            Ok(make_response(format!(
                "✅ 浏览器 AI 已成功完成任务「{}」。\n\
                 （浏览器 AI 未返回详细执行报告，但操作已执行完毕。\n\
                 桌面 AI 注意：浏览器状态已更新，不需要额外验证或补救操作。）",
                task_text
            )))
        } else {
            Ok(make_response(format!(
                "❌ 浏览器 AI 执行失败，错误信息: {}",
                report_text
            )))
        }
    } else {
        // 普通工具调用，原样返回
        Ok(raw_result)
    }
}

/// 获取浏览器 session 在 pending_requests 中的 key（去掉特殊字符）
fn get_key(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .collect::<String>()
        .to_lowercase()
}

/// 生成简易 UUID v4（非加密，仅用于唯一标识）
fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        (ts >> 64) as u32,
        (ts >> 48) as u16,
        (ts >> 32) as u16 & 0xfff,
        (ts >> 16) as u16 & 0xffff,
        ts as u64 & 0xffffffffffff
    )
}

// ─── 工具定义 ──────────────────────────────────────────────

/// 获取浏览器工具的定义列表（用于注入到桌面 AI 的工具列表）
///
/// 每个工具添加可选的 `browser_name` 参数，AI 可指定目标浏览器。
/// AI 应先调用 get_connected_browsers 获取当前可用浏览器列表。
pub fn get_browser_tool_definitions() -> Vec<Value> {
    let browser_param = json!({
        "type": "string",
        "description": "目标浏览器标识（可填浏览器类型如「edge/chrome/firefox」、画像名如「Default/Work」、或自定义名称）。先用 get_connected_browsers 查看当前已连接的浏览器再决定。不填则使用默认浏览器。"
    });

    vec![
        // ── 查询工具 ──
        json!({
            "name": "get_connected_browsers",
            "description": "获取当前通过桥接连接的所有浏览器列表，包含浏览器类型、名称、画像名、版本等信息。在调用其他浏览器工具之前应优先调用此工具了解可用的浏览器。无需任何参数。",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }),
        // ── 操作工具 ──
        json!({
            "name": "search_web",
            "description": "【仅限简单搜索】在互联网上搜索信息，返回搜索结果的标题、摘要和链接列表。注意：这只做搜索，不会打开结果页面。如果需要搜索后进一步操作（如打开结果），请用 ask_browser_ai。可指定 browser_name 选择目标浏览器。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词，应该清晰具体"
                    },
                    "browser_name": browser_param.clone()
                },
                "required": ["query"]
            }
        }),
        json!({
            "name": "read_current_page",
            "description": "读取当前浏览器活动标签页的文本内容。当用户询问当前正在浏览的网页内容时使用。可指定 browser_name 选择目标浏览器。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "browser_name": browser_param.clone()
                },
                "required": []
            }
        }),
        json!({
            "name": "take_screenshot",
            "description": "截取当前浏览器活动标签页的可见区域截图，返回 base64 编码的图片数据。可指定 browser_name 选择目标浏览器。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "browser_name": browser_param.clone()
                },
                "required": []
            }
        }),
        json!({
            "name": "get_tab_info",
            "description": "获取当前浏览器活动标签页的基本信息，包括 URL、页面标题、favicon 等。可指定 browser_name 选择目标浏览器。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "browser_name": browser_param.clone()
                },
                "required": []
            }
        }),
        json!({
            "name": "get_browser_state",
            "description": "获取浏览器的完整当前状态，包括所有窗口、所有标签页的 URL 和标题、当前活跃标签页、窗口数量等。在调用其他浏览器工具前调用此工具可以了解当前的浏览器状况，避免重复打开页面或操作错误的标签页。可指定 browser_name 选择目标浏览器。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "browser_name": browser_param.clone()
                },
                "required": []
            }
        }),
        json!({
            "name": "execute_js",
            "description": "【警告：高风险，仅在绝对必要时使用】在当前浏览器标签页上下文中执行 JavaScript 代码。此工具会直接修改页面状态，如果使用不当会破坏页面状态。首选 ask_browser_ai。可指定 browser_name 选择目标浏览器。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "要在页面中执行的 JavaScript 代码"
                    },
                    "browser_name": browser_param.clone()
                },
                "required": ["code"]
            }
        }),
        json!({
            "name": "fill_form",
            "description": "【警告：仅在极简单场景使用】在当前浏览器页面中填写表单字段。注意：这个工具是低级操作，只适用于非常简单的单字段表单。对于多步骤操作（搜索→打开→填写→提交等），请用 ask_browser_ai。可指定 browser_name 选择目标浏览器。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS 选择器，用于定位目标表单元素"
                    },
                    "value": {
                        "type": "string",
                        "description": "要填写的内容"
                    },
                    "browser_name": browser_param.clone()
                },
                "required": ["selector", "value"]
            }
        }),
        json!({
            "name": "click_element",
            "description": "【警告：仅在极简单场景使用】在当前浏览器标签页中点击指定的页面元素。注意：这个工具是低级操作，只适用于非常简单的单次点击。对于任何涉及打开页面后的操作，请用 ask_browser_ai。可指定 browser_name 选择目标浏览器。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS 选择器，用于定位要点击的元素"
                    },
                    "browser_name": browser_param.clone()
                },
                "required": ["selector"]
            }
        }),
        json!({
            "name": "get_page_html",
            "description": "获取当前浏览器标签页的完整 HTML 源代码。用于深度分析页面结构。可指定 browser_name 选择目标浏览器。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "browser_name": browser_param.clone()
                },
                "required": []
            }
        }),
        // ── AI 代理工具（首选方案）──
        // 这是执行浏览器操作的首选工具。对于任何涉及多步骤、需要理解页面内容、
        // 或者可能出错的浏览器操作，都应该优先使用 ask_browser_ai 而不是手动
        // 调用多个低级工具。ask_browser_ai 返回完整的执行报告，包含每一步的
        // 工具调用和结果，以及浏览器 AI 的总结。
        json!({
            "name": "ask_browser_ai",
            "description": "【⭐⭐⭐ 强烈推荐：所有浏览器操作的默认首选】让浏览器端的 AI 助手自主执行一个高层次任务。浏览器 AI 拥有搜索网页、读取页面内容、点击元素、填写表单、执行 JS、截图等完整工具链，会自主规划、执行并返回完整的执行报告（做了什么、结果如何、当前浏览器状态）。\n\n使用原则：\n1. 重要：ask_browser_ai 返回的结果已包含完整的浏览器状态和执行详情，你不需要再额外调用任何工具验证\n2. 对于任何多步骤的浏览器操作（搜索+阅读、打开多个页面、填写表单+提交等），必须使用此工具，不要手动调用多个低级工具\n3. 对于简单的单步操作（如只需要打开一个页面、只需要截图），也可以直接用对应的低级工具\n\n可指定 browser_name 选择目标浏览器。\n\n会话延续：如果需要让浏览器 AI 基于之前的操作继续工作（延续上下文），把上次返回的 conversation_id 填入此参数。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "要浏览器 AI 执行的任务描述。应该是一个高层次的目标，描述清晰完整。例如：\n- 「先打开百度首页 https://www.baidu.com，然后在百度搜索框输入「今日天气」并截图搜索结果」\n- 「打开 B 站热门视频页 https://www.bilibili.com/v/popular，找到播放量最高的 3 个视频并告诉我标题和播放量」\n- 「在 Google 搜索「Cebian 浏览器扩展」并打开搜索结果中的第一个链接，然后读取该页面的内容并总结」"
                    },
                    "browser_name": browser_param.clone(),
                    "conversation_id": {
                        "type": "string",
                        "description": "（可选）浏览器 AI 会话延续 ID。传入上次 ask_browser_ai 返回结果中的 conversation_id，可以让浏览器 AI 在上次对话的基础上继续工作，保留之前的操作上下文。\n\n首次调用时不需要传，浏览器 AI 会自动创建新会话并在结果中返回 conversation_id。后续如果需要让浏览器 AI 基于前一次的工作继续（例如「刚才打开的页面，再帮我点击某个按钮」），请传入上一次返回的 conversation_id。\n\n每次返回结果都包含 conversation_id，下次继续时传入即可。"
                    }
                },
                "required": ["task"]
            }
        }),
    ]
}

/// 浏览器工具名称列表
pub fn get_browser_tool_names() -> Vec<&'static str> {
    vec![
        "get_connected_browsers",
        "get_browser_state",
        "search_web",
        "read_current_page",
        "take_screenshot",
        "get_tab_info",
        "execute_js",
        "fill_form",
        "click_element",
        "get_page_html",
        "ask_browser_ai",
    ]
}

/// 获取最新的浏览器 AI 执行进度
pub async fn get_agent_progress(state: &BridgeState, request_id: &str) -> Option<Value> {
    let inner = state.inner.lock().await;
    inner.pending_progress.get(request_id).cloned()
}

/// 获取所有正在进行的浏览器 AI 进度（用于前端轮询）
pub async fn get_all_agent_progresses(state: &BridgeState) -> Value {
    let inner = state.inner.lock().await;
    let mut progresses = serde_json::Map::new();
    for (req_id, progress) in &inner.pending_progress {
        progresses.insert(req_id.clone(), progress.clone());
    }
    json!({ "progresses": progresses })
}

// ─── 桌面 AI 进度广播 ─────────────────────────────────────

/// 将消息广播到所有已连接的浏览器
pub async fn broadcast_to_all_browsers(state: &BridgeState, message: &str) {
    let inner = state.inner.lock().await;
    let browsers: Vec<_> = inner.browsers.values().collect();
    for browser in browsers {
        let _ = browser.ws_sender.send(Message::Text(message.to_string().into()));
    }
}

/// 更新桌面 AI 执行进度并广播到所有浏览器
///
/// 在桌面 AI 执行过程中调用，每次有新的 thinking/tool_call/tool_result 时：
/// 1. 更新本地存储的进度快照
/// 2. 通过 WebSocket 广播到所有浏览器
pub async fn update_desktop_ai_progress(state: &BridgeState, step: Value) {
    let msg = json!({
        "jsonrpc": "2.0",
        "method": "desktop/progress",
        "params": {
            "step": step,
        }
    });
    let msg_str = msg.to_string();

    let inner = state.inner.lock().await;
    // 更新进度快照
    let mut current = inner.desktop_ai_progress.clone();
    if let Some(steps) = current.get_mut("steps").and_then(|s| s.as_array_mut()) {
        steps.push(step);
    }
    // 广播到所有浏览器
    for browser in inner.browsers.values() {
        let _ = browser.ws_sender.send(Message::Text(msg_str.clone().into()));
    }
}

/// 重置桌面 AI 进度（新对话开始时调用）
pub async fn reset_desktop_ai_progress(state: &BridgeState) {
    let mut inner = state.inner.lock().await;
    inner.desktop_ai_progress = json!({"steps": [], "status": "idle", "task": ""});
    // 通知浏览器重置
    let msg = json!({
        "jsonrpc": "2.0",
        "method": "desktop/progress",
        "params": {
            "reset": true,
        }
    });
    for browser in inner.browsers.values() {
        let _ = browser.ws_sender.send(Message::Text(msg.to_string().into()));
    }
}

/// 获取桌面 AI 当前进度（给前端 IPC 用）
pub async fn get_desktop_ai_progress(state: &BridgeState) -> Value {
    let inner = state.inner.lock().await;
    inner.desktop_ai_progress.clone()
}

/// 取消所有浏览器 AI 任务（用户终止桌面 AI 时调用）
///
/// 向所有已连接的浏览器广播 tools/cancel 消息，
/// 通知浏览器停止正在执行的 agent/prompt 任务。
pub async fn cancel_browser_ai_tasks(state: &BridgeState) {
    let msg = json!({
        "jsonrpc": "2.0",
        "method": "tools/cancel",
        "params": {}
    });
    let msg_str = msg.to_string();
    let inner = state.inner.lock().await;
    for browser in inner.browsers.values() {
        let _ = browser.ws_sender.send(Message::Text(msg_str.clone().into()));
    }
    eprintln!("[bridge] 已向所有浏览器广播取消消息");
}

/// 对指定浏览器会话发送 ping 并测量延迟（毫秒）
pub async fn ping_session(state: &BridgeState, session_id: &str) -> Result<f64, String> {
    let request_id = format!(
        "ping_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );

    let (ws_sender, browser_name) = {
        let inner = state.inner.lock().await;
        let session = inner
            .browsers
            .get(session_id)
            .ok_or_else(|| format!("会话 {} 不存在", session_id))?;
        (session.ws_sender.clone(), session.client_name.clone())
    };

    let (tx, rx) = oneshot::channel();
    {
        let mut inner = state.inner.lock().await;
        // 设置 5 秒超时
        inner.pending_requests.insert(request_id.clone(), tx);
    }

    let ping_msg = json!({"jsonrpc": "2.0", "id": &request_id, "method": "_ping"});
    ws_sender
        .send(Message::Text(ping_msg.to_string().into()))
        .map_err(|_| "发送 ping 失败".to_string())?;

    let start = Instant::now();
    match tokio::time::timeout(Duration::from_secs(5), rx).await {
        Ok(Ok(_)) => {
            let ms = start.elapsed().as_secs_f64() * 1000.0;
            Ok(ms)
        }
        Ok(Err(e)) => Err(format!("ping 响应错误: {}", e)),
        Err(_) => Err(format!("浏览器「{}」ping 超时（5秒）", browser_name)),
    }
}
