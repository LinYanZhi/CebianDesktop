//! 双 AI 桥接服务器
//!
//! 桌面端启动 WebSocket 服务，浏览器扩展（Cebian）作为客户端连接。
//! 支持配置多个端口，每个端口对应一个浏览器连接（如 Chrome、Edge）。
//!
//! ## 协议（JSON-RPC 2.0 over WebSocket）
//!
//! ```json
//! // 桌面 → 浏览器：工具调用请求
//! { "jsonrpc": "2.0", "id": "req_xxx", "method": "tools/call", "params": { "name": "search_web", "arguments": { ... } } }
//!
//! // 浏览器 → 桌面：成功响应
//! { "jsonrpc": "2.0", "id": "req_xxx", "result": { ... } }
//!
//! // 浏览器 → 桌面：错误响应
//! { "jsonrpc": "2.0", "id": "req_xxx", "error": { "code": -1, "message": "..." } }
//! ```

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::{oneshot, Mutex};

use crate::config_storage::BridgePortConfig;

/// 桥接服务器默认监听端口
pub const DEFAULT_BRIDGE_PORT: u16 = 37421;

// ─── Shared State ──────────────────────────────────────────

/// 一个已连接的浏览器会话
pub(crate) struct BrowserSession {
    /// 浏览器名称（如 "Chrome"、"Edge"）
    pub name: String,
    /// 客户端自定义名称（从 session/register 的 client_name 字段获取）
    pub client_name: String,
    /// 连接的端口
    pub port: u16,
    /// 向浏览器发送消息的通道
    pub ws_sender: tokio::sync::mpsc::UnboundedSender<Message>,
    /// 连接时间
    pub connected_at: Instant,
}

/// 桥接服务器共享状态
pub struct BridgeState {
    pub(crate) inner: Mutex<BridgeInner>,
}

pub(crate) struct BridgeInner {
    /// 所有已连接的浏览器会话（key = 浏览器名称+端口）
    pub browsers: HashMap<String, BrowserSession>,
    /// 待处理的 RPC 请求（id → 响应回调）
    pending_requests: HashMap<String, oneshot::Sender<Result<Value, String>>>,
    /// 当前配置的端口列表（用于 WS 处理器识别所属端口名称）
    pub port_configs: HashMap<u16, String>, // port → name
}

impl BridgeState {
    /// 创建新的桥接状态
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(BridgeInner {
                browsers: HashMap::new(),
                pending_requests: HashMap::new(),
                port_configs: HashMap::new(),
            }),
        }
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
        .route("/ws", get(move |ws, state: State<Arc<BridgeState>>| {
            ws_handler_with_port(ws, state, port)
        }))
        .route("/health", get(health))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("绑定桥接端口 {} 失败: {}", port, e))?;

    eprintln!("[bridge] WebSocket 服务器已启动，端口: {}", port);

    axum::serve(listener, app)
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

/// WebSocket 升级端点（带端口信息，通过闭包传入）
async fn ws_handler_with_port(
    ws: WebSocketUpgrade,
    State(state): State<Arc<BridgeState>>,
    local_port: u16,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws_connection(socket, state, local_port))
}

/// 处理 WebSocket 连接
async fn handle_ws_connection(socket: WebSocket, state: Arc<BridgeState>, local_port: u16) {
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

    // 创建会话
    let session_key = port_name.clone();
    {
        let mut inner = state.inner.lock().await;
        inner.browsers.insert(
            session_key.clone(),
            BrowserSession {
                name: port_name.clone(),
                client_name: "未知".to_string(), // 等注册消息更新
                port: local_port,
                ws_sender: tx.clone(),
                connected_at: Instant::now(),
            },
        );
        // 清理此浏览器之前可能残留的 pending 请求（断线重连时）
        retain_pending_for_browser(&mut inner, &session_key);
        eprintln!("[bridge] 浏览器「{}」已连接（端口 {})", port_name, local_port);
    }

    // ── 任务 1：转发桌面端的消息到 WebSocket ──
    let send_task = tokio::spawn(relay_to_websocket(ws_sender, rx));

    // ── 任务 2：从 WebSocket 读取响应并匹配 ──
    let recv_state = state.clone();
    let recv_session = session_key.clone();
    let recv_task = tokio::spawn(relay_from_websocket(ws_receiver, recv_state, recv_session));

    // 等待任意一个任务结束（浏览器断开连接）
    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    // 清理连接
    let mut inner = state.inner.lock().await;
    inner.browsers.remove(&session_key);
    // 清理此浏览器所有的 pending 请求
    inner.pending_requests.retain(|id, _| {
        !id.starts_with(&format!("{}_", session_key))
    });
    eprintln!("[bridge] 浏览器「{}」已断开", port_name);
}

/// 保留属于指定浏览器的 pending 请求（重连时不清，非本浏览器的保留）
fn retain_pending_for_browser(inner: &mut BridgeInner, session_key: &str) {
    let prefix = format!("{}_", session_key);
    inner.pending_requests.retain(|id, _| !id.starts_with(&prefix));
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

/// 从 WebSocket 读取浏览器的响应，匹配到 pending_requests
async fn relay_from_websocket(
    mut ws_receiver: futures_util::stream::SplitStream<WebSocket>,
    state: Arc<BridgeState>,
    session_key: String,
) {
    while let Some(Ok(msg)) = ws_receiver.next().await {
        match msg {
            Message::Text(text) => {
                if let Ok(parsed) = serde_json::from_str::<Value>(&text) {
                    // 注册消息（浏览器连接后发送）
                    if parsed.get("method").and_then(|m| m.as_str()) == Some("session/register") {
                        if let Some(client_name) = parsed
                            .pointer("/params/client_name")
                            .and_then(|v| v.as_str())
                        {
                            let mut inner = state.inner.lock().await;
                            if let Some(session) = inner.browsers.get_mut(&session_key) {
                                session.client_name = client_name.to_string();
                                eprintln!(
                                    "[bridge] 浏览器注册: {} ({})",
                                    client_name, session.name
                                );
                            }
                        }
                        continue;
                    }

                    // 响应消息（有 id 字段）
                    if let Some(id) = parsed.get("id").and_then(|v| v.as_str()) {
                        let mut inner = state.inner.lock().await;
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

// ─── 工具调用 ──────────────────────────────────────────────

/// 通过桥接执行浏览器工具
///
/// `browser_name`: 指定目标浏览器名称。为 None 时使用第一个已连接的浏览器。
pub async fn execute_browser_tool(
    state: &BridgeState,
    name: &str,
    args: &Value,
    browser_name: Option<&str>,
) -> Result<Value, String> {
    let (tx, rx) = oneshot::channel();
    let request_id = format!(
        "req_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );

    // 查找目标浏览器（分两步避免双重借用）
    let (ws_sender, session_key_name) = {
        let inner = state.inner.lock().await;

        if inner.browsers.is_empty() {
            return Err(
                "尚未连接任何浏览器，请确保已安装 CeBian 扩展并加载。".to_string(),
            );
        }

        let session = if let Some(bname) = browser_name {
            // 按名称查找：支持精确匹配和包含匹配
            inner
                .browsers
                .values()
                .find(|s| {
                    s.name == bname
                        || s.client_name == bname
                        || s.name.contains(bname)
                        || s.client_name.contains(bname)
                        || format!("{}", s.port) == bname
                })
                .ok_or_else(|| {
                    let keys: Vec<String> = inner.browsers.keys().cloned().collect();
                    format!(
                        "未找到浏览器「{}」，当前已连接的浏览器：{}",
                        bname,
                        keys.join("、")
                    )
                })?
        } else {
            // 未指定时使用第一个
            inner.browsers.values().next().ok_or("没有已连接的浏览器")?
        };

        (session.ws_sender.clone(), session.name.clone())
    };

    // 用带 session_key 前缀的 id 注册，方便按浏览器清理
    let full_id = format!("{}_{}", get_key(&session_key_name), request_id);
    {
        let mut inner = state.inner.lock().await;
        inner.pending_requests.insert(full_id.clone(), tx);
    }

    // 发送请求到浏览器
    let request = json!({
        "jsonrpc": "2.0",
        "id": full_id,
        "method": "tools/call",
        "params": {
            "name": name,
            "arguments": args,
        }
    });

    let request_id_str = full_id.clone();
    ws_sender
        .send(Message::Text(request.to_string().into()))
        .map_err(|e| format!("发送请求到浏览器失败: {}", e))?;

    // 等待响应（带 120 秒超时）
    match tokio::time::timeout(std::time::Duration::from_secs(120), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("浏览器已断开连接，未能获取响应".to_string()),
        Err(_) => {
            let mut inner = state.inner.lock().await;
            inner.pending_requests.remove(&request_id_str);
            Err("浏览器工具执行超时（120秒），浏览器可能无响应".to_string())
        }
    }
}

/// 获取浏览器 session 在 pending_requests 中的 key（去掉特殊字符）
fn get_key(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .collect::<String>()
        .to_lowercase()
}

// ─── 工具定义 ──────────────────────────────────────────────

/// 获取浏览器工具的定义列表（用于注入到桌面 AI 的工具列表）
///
/// 每个工具添加可选的 `browser_name` 参数，AI 可指定目标浏览器。
pub fn get_browser_tool_definitions() -> Vec<Value> {
    let browser_param = json!({
        "type": "string",
        "description": "目标浏览器名称（如「Chrome」「Edge」）。不填则使用默认浏览器。可用浏览器可向用户询问或通过 get_bridge_status 获取。"
    });

    vec![
        json!({
            "name": "search_web",
            "description": "在互联网上搜索信息，返回搜索结果的标题、摘要和链接列表。当用户询问最新信息或本地没有的知识时使用。可指定 browser_name 选择目标浏览器。",
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
            "name": "execute_js",
            "description": "在当前浏览器标签页的上下文中执行 JavaScript 代码，返回执行结果。可指定 browser_name 选择目标浏览器。",
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
            "description": "在当前浏览器页面中填写表单字段。通过 CSS 选择器定位元素并设置值。可指定 browser_name 选择目标浏览器。",
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
            "description": "在当前浏览器标签页中点击指定的页面元素。通过 CSS 选择器定位目标。可指定 browser_name 选择目标浏览器。",
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
    ]
}

/// 浏览器工具名称列表
pub fn get_browser_tool_names() -> Vec<&'static str> {
    vec![
        "search_web",
        "read_current_page",
        "take_screenshot",
        "get_tab_info",
        "execute_js",
        "fill_form",
        "click_element",
        "get_page_html",
    ]
}
