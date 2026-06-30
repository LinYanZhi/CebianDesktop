//! MCP HTTP 服务器
//!
//! 使用 axum 实现的 MCP（Model Context Protocol）服务器，
//! 处理工具列表查询和工具调用等请求

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::State,
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use serde_json::{json, Value};
use tokio::net::TcpListener;

use crate::tools;

/// MCP 服务器共享状态
struct McpState;

/// 运行 MCP 服务器
///
/// # 参数
/// * `port` - 监听端口
///
/// # 错误
/// 如果绑定端口或启动服务器失败，返回错误信息
pub async fn run_server(port: u16) -> Result<(), String> {
    let state = Arc::new(McpState);

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/mcp", post(handle_mcp))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| format!("绑定端口失败: {}", e))?;

    axum::serve(listener, app)
        .await
        .map_err(|e| format!("服务器运行失败: {}", e))
}

/// 健康检查端点
async fn health_check() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "service": "cebian-bridge-mcp",
        "version": "0.1.0"
    }))
}

/// MCP 请求处理入口
///
/// 解析 JSON-RPC 2.0 请求并分发给对应的处理方法
async fn handle_mcp(
    State(_state): State<Arc<McpState>>,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    // 提取请求 ID（通知类请求可能没有 ID）
    let request_id = body.get("id").cloned();

    // 获取方法名
    let method = match body.get("method").and_then(|m| m.as_str()) {
        Some(m) => m,
        None => {
            return json_rpc_error(
                request_id,
                -32600,
                "请求缺少 method 字段".to_string(),
            );
        }
    };

    // 获取参数（可选）
    let params = body.get("params");

    match method {
        "initialize" => handle_initialize(request_id, params),
        "tools/list" => handle_tools_list(request_id),
        "tools/call" => handle_tools_call(request_id, params),
        "notifications/initialized" => {
            // 初始化通知，无需响应
            (StatusCode::OK, Json(json!({})))
        }
        _ => json_rpc_error(
            request_id,
            -32601,
            format!("不支持的方法: {}", method),
        ),
    }
}

/// 处理初始化请求
///
/// 返回服务器能力信息，包括支持的协议版本和工具能力
fn handle_initialize(
    id: Option<Value>,
    _params: Option<&Value>,
) -> (StatusCode, Json<Value>) {
    let result = json!({
        "protocolVersion": "2024-11-05",
        "capabilities": {
            "tools": {},
            "experimental": {
                "dualAi": {
                    "description": "支持双 AI 模式，可同时运行两个 AI 客户端",
                    "supported": true
                }
            }
        },
        "serverInfo": {
            "name": "cebian-bridge",
            "version": "0.1.0"
        }
    });

    json_rpc_success(id, result)
}

/// 处理工具列表查询
///
/// 返回服务器支持的所有工具定义
fn handle_tools_list(id: Option<Value>) -> (StatusCode, Json<Value>) {
    let tools = tools::get_tool_definitions();
    let result = json!({
        "tools": tools
    });

    json_rpc_success(id, result)
}

/// 处理工具调用请求
///
/// 根据工具名称和参数执行对应的工具函数
fn handle_tools_call(
    id: Option<Value>,
    params: Option<&Value>,
) -> (StatusCode, Json<Value>) {
    let params = match params {
        Some(p) => p,
        None => {
            return json_rpc_error(id, -32602, "请求缺少 params 字段".to_string());
        }
    };

    let tool_name = match params.get("name").and_then(|n| n.as_str()) {
        Some(name) => name,
        None => {
            return json_rpc_error(id, -32602, "缺少工具名称".to_string());
        }
    };

    let arguments = params.get("arguments").cloned().unwrap_or(json!({}));

    match tools::execute_tool(tool_name, &arguments, None) {
        Ok(content) => {
            let result = json!({
                "content": [
                    {
                        "type": "text",
                        "text": serde_json::to_string_pretty(&content).unwrap_or_default()
                    }
                ]
            });
            json_rpc_success(id, result)
        }
        Err(e) => {
            let result = json!({
                "content": [
                    {
                        "type": "text",
                        "text": format!("工具执行失败: {}", e)
                    }
                ],
                "isError": true
            });
            json_rpc_success(id, result)
        }
    }
}

/// 构造 JSON-RPC 成功响应
fn json_rpc_success(id: Option<Value>, result: Value) -> (StatusCode, Json<Value>) {
    let response = json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    });
    (StatusCode::OK, Json(response))
}

/// 构造 JSON-RPC 错误响应
fn json_rpc_error(
    id: Option<Value>,
    code: i32,
    message: String,
) -> (StatusCode, Json<Value>) {
    let response = json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message
        }
    });
    (StatusCode::OK, Json(response))
}
