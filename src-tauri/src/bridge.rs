//! 双 AI 桥接服务器
//!
//! 桌面端启动 WebSocket 服务，浏览器扩展（Cebian）作为客户端连接。
//! 桌面 AI 可以通过桥接调用浏览器工具（搜索网页、读当前页、截图等），
//! 浏览器 AI 也可以通过桥接调用桌面工具（文件操作、命令执行、下载等）。
//!
//! ## 协议（JSON-RPC 2.0 over WebSocket）
//!
//! ```json
//! // 桌面 → 浏览器：工具调用请求
//! { "jsonrpc": "2.0", "id": "req_xxx", "method": "tools/call", "params": { "name": "search_web", "arguments": { "query": "..." } } }
//!
//! // 浏览器 → 桌面：成功响应
//! { "jsonrpc": "2.0", "id": "req_xxx", "result": { ... } }
//!
//! // 浏览器 → 桌面：错误响应
//! { "jsonrpc": "2.0", "id": "req_xxx", "error": { "code": -1, "message": "..." } }
//!
//! // 浏览器 → 桌面：注册（连接后立即发送）
//! { "jsonrpc": "2.0", "method": "session/register", "params": { "client_name": "Cebian" } }
//! ```

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::{oneshot, Mutex};

/// 桥接服务器监听端口（硬编码，两个项目共用）
pub const BRIDGE_PORT: u16 = 37421;

// ─── Shared State ──────────────────────────────────────────

/// 桥接服务器共享状态
pub struct BridgeState {
    pub(crate) inner: Mutex<BridgeInner>,
}

pub(crate) struct BridgeInner {
    /// 浏览器是否已连接
    pub browser_connected: bool,
    /// 向浏览器发送消息的通道
    ws_sender: Option<tokio::sync::mpsc::UnboundedSender<Message>>,
    /// 待处理的 RPC 请求（id → 响应回调）
    pending_requests: HashMap<String, oneshot::Sender<Result<Value, String>>>,
}

impl BridgeState {
    /// 创建新的桥接状态
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(BridgeInner {
                browser_connected: false,
                ws_sender: None,
                pending_requests: HashMap::new(),
            }),
        }
    }
}

// ─── Server ────────────────────────────────────────────────

/// 启动 WebSocket 桥接服务器（阻塞，通常在 tokio::spawn 中运行）
pub async fn run_bridge_server(state: Arc<BridgeState>) -> Result<(), String> {
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/health", get(health))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], BRIDGE_PORT));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("绑定桥接端口 {} 失败: {}", BRIDGE_PORT, e))?;

    eprintln!("[bridge] WebSocket 服务器已启动，端口: {}", BRIDGE_PORT);

    axum::serve(listener, app)
        .await
        .map_err(|e| format!("桥接服务器运行失败: {}", e))
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

/// WebSocket 升级端点
async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<BridgeState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws_connection(socket, state))
}

/// 处理 WebSocket 连接
async fn handle_ws_connection(socket: WebSocket, state: Arc<BridgeState>) {
    // 拆分为发送端和接收端
    let (ws_sender, ws_receiver) = socket.split();

    // 创建内部消息通道（用于跨任务发送 WS 消息）
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Message>();

    // 注册浏览器连接
    {
        let mut inner = state.inner.lock().await;
        inner.browser_connected = true;
        inner.ws_sender = Some(tx.clone());
        // 清理之前可能残留的 pending 请求（浏览器重连时）
        inner.pending_requests.clear();
        eprintln!("[bridge] 浏览器扩展已连接");
    }

    // ── 任务 1：转发桌面端的消息到 WebSocket ──
    //    从 mpsc 通道读取 → 写入 WS 发送端
    let send_task = tokio::spawn(relay_to_websocket(ws_sender, rx));

    // ── 任务 2：从 WebSocket 读取响应并匹配 ──
    //    从 WS 接收端读取 → 匹配到 pending_requests → 通过 oneshot 返回
    let recv_task = tokio::spawn(relay_from_websocket(ws_receiver, state.clone()));

    // 等待任意一个任务结束（浏览器断开连接）
    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    // 清理连接
    let mut inner = state.inner.lock().await;
    inner.browser_connected = false;
    inner.ws_sender = None;
    eprintln!("[bridge] 浏览器扩展已断开");
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
) {
    while let Some(Ok(msg)) = ws_receiver.next().await {
        match msg {
            Message::Text(text) => {
                if let Ok(parsed) = serde_json::from_str::<Value>(&text) {
                    // 注册消息（浏览器连接后发送）
                    if parsed.get("method").and_then(|m| m.as_str()) == Some("session/register") {
                        eprintln!("[bridge] 收到浏览器注册: {:?}", parsed.get("params"));
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
/// 发送 JSON-RPC 请求到浏览器，等待响应。
pub async fn execute_browser_tool(
    state: &BridgeState,
    name: &str,
    args: &Value,
) -> Result<Value, String> {
    let (tx, rx) = oneshot::channel();
    let request_id = format!(
        "req_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );

    // 注册 pending request 并获取 ws sender
    let ws_tx = {
        let mut inner = state.inner.lock().await;
        if !inner.browser_connected {
            return Err(
                "浏览器未连接，请确保在浏览器中登录并启用了 CeBian 扩展。".to_string(),
            );
        }
        inner
            .pending_requests
            .insert(request_id.clone(), tx);
        inner
            .ws_sender
            .clone()
            .ok_or("内部错误：缺少 WS 发送通道".to_string())?
    };

    // 发送请求到浏览器
    let request = json!({
        "jsonrpc": "2.0",
        "id": request_id,
        "method": "tools/call",
        "params": {
            "name": name,
            "arguments": args,
        }
    });

    ws_tx
        .send(Message::Text(request.to_string().into()))
        .map_err(|e| format!("发送请求到浏览器失败: {}", e))?;

    // 等待响应（带 120 秒超时）
    match tokio::time::timeout(std::time::Duration::from_secs(120), rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("浏览器已断开连接，未能获取响应".to_string()),
        Err(_) => {
            // 超时：清理 pending request
            let mut inner = state.inner.lock().await;
            inner.pending_requests.remove(&request_id);
            Err("浏览器工具执行超时（120秒），浏览器可能无响应".to_string())
        }
    }
}

// ─── 工具定义 ──────────────────────────────────────────────

/// 获取浏览器工具的定义列表（用于注入到桌面 AI 的工具列表）
pub fn get_browser_tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "search_web",
            "description": "在互联网上搜索信息，返回搜索结果的标题、摘要和链接列表。当用户询问最新信息或本地没有的知识时使用。",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词，应该清晰具体"
                    }
                },
                "required": ["query"]
            }
        }),
        json!({
            "name": "read_current_page",
            "description": "读取当前浏览器活动标签页的文本内容。当用户询问当前正在浏览的网页内容时使用。",
            "input_schema": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }),
        json!({
            "name": "take_screenshot",
            "description": "截取当前浏览器活动标签页的可见区域截图，返回 base64 编码的图片数据。",
            "input_schema": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }),
        json!({
            "name": "get_tab_info",
            "description": "获取当前浏览器活动标签页的基本信息，包括 URL、页面标题、favicon 等。",
            "input_schema": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }),
        json!({
            "name": "execute_js",
            "description": "在当前浏览器标签页的上下文中执行 JavaScript 代码，返回执行结果。用于获取页面动态数据或操作页面。",
            "input_schema": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "要在页面中执行的 JavaScript 代码"
                    }
                },
                "required": ["code"]
            }
        }),
        json!({
            "name": "fill_form",
            "description": "在当前浏览器页面中填写表单字段。通过 CSS 选择器定位元素并设置值。",
            "input_schema": {
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS 选择器，用于定位目标表单元素"
                    },
                    "value": {
                        "type": "string",
                        "description": "要填写的内容"
                    }
                },
                "required": ["selector", "value"]
            }
        }),
        json!({
            "name": "click_element",
            "description": "在当前浏览器标签页中点击指定的页面元素。通过 CSS 选择器定位目标。",
            "input_schema": {
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS 选择器，用于定位要点击的元素"
                    }
                },
                "required": ["selector"]
            }
        }),
        json!({
            "name": "get_page_html",
            "description": "获取当前浏览器标签页的完整 HTML 源代码。用于深度分析页面结构。",
            "input_schema": {
                "type": "object",
                "properties": {},
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
