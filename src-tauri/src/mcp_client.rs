//! MCP 客户端模块
//!
//! 通过 stdio 与外部 MCP 服务器进程通信（JSON-RPC 2.0 协议）。
//! 每个 MCP 服务器对应一个子进程，通过其 stdin/stdout 交换消息。

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

/// 连接的 MCP 服务器信息
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct McpServerConnection {
    /// 服务器名称（唯一标识）
    pub name: String,
    /// 启动命令
    pub command: String,
    /// 命令参数
    pub args: Vec<String>,
    /// 此服务器提供的工具列表（缓存）
    pub tools: Vec<McpToolDef>,
    /// 是否已连接
    pub connected: bool,
}

/// MCP 工具定义
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct McpToolDef {
    /// 工具全名（含服务器前缀，如 mcp:servername:toolname）
    pub prefixed_name: String,
    /// 原始工具名
    pub original_name: String,
    /// 所属服务器名
    pub server_name: String,
    /// 工具描述
    pub description: String,
    /// 输入参数 schema（JSON Schema 格式）
    pub input_schema: Value,
}

/// 子进程的 stdin/stdout 句柄
struct McpProcess {
    stdin: Mutex<ChildStdinWrapper>,
    stdout: Mutex<BufReader<std::process::ChildStdout>>,
    child: Mutex<Option<Child>>,
}

// 封装 ChildStdin 使其可以跨线程使用
struct ChildStdinWrapper(std::process::ChildStdin);
unsafe impl Send for ChildStdinWrapper {}
unsafe impl Sync for ChildStdinWrapper {}

impl Write for ChildStdinWrapper {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.write(buf)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.0.flush()
    }
}

/// MCP 客户端管理器（全局单例）
pub struct McpClientManager {
    /// 运行的子进程，key = 服务器名
    processes: Mutex<HashMap<String, McpProcess>>,
    /// 缓存的工具定义
    tool_cache: Mutex<Vec<McpToolDef>>,
}

impl McpClientManager {
    pub fn new() -> Self {
        Self {
            processes: Mutex::new(HashMap::new()),
            tool_cache: Mutex::new(Vec::new()),
        }
    }

    /// 启动并连接一个 MCP 服务器
    pub fn connect(&self, name: &str, command: &str, args: &[String]) -> Result<(), String> {
        let mut procs = self.processes.lock().map_err(|e| format!("锁错误: {}", e))?;

        if procs.contains_key(name) {
            return Err(format!("服务器 '{}' 已连接", name));
        }

        let mut child = Command::new(command)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("启动 MCP 服务器 '{}' 失败: {}", name, e))?;

        let stdin = child.stdin.take()
            .ok_or_else(|| format!("无法获取 '{}' 的 stdin", name))?;
        let stdout = child.stdout.take()
            .ok_or_else(|| format!("无法获取 '{}' 的 stdout", name))?;

        let proc = McpProcess {
            stdin: Mutex::new(ChildStdinWrapper(stdin)),
            stdout: Mutex::new(BufReader::new(stdout)),
            child: Mutex::new(Some(child)),
        };

        // 发送 initialize 请求
        let init_response = send_mcp_request(&proc, "initialize", json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": { "name": "cebiandesktop", "version": "0.1.0" }
        }))?;

        if let Some(error) = init_response.get("error") {
            let msg = error["message"].as_str().unwrap_or("unknown error");
            kill_process(&proc);
            return Err(format!("初始化 '{}' 失败: {}", name, msg));
        }

        // 获取工具列表
        let tools_response = send_mcp_request(&proc, "tools/list", json!({}))?;

        if let Some(error) = tools_response.get("error") {
            let msg = error["message"].as_str().unwrap_or("unknown error");
            kill_process(&proc);
            return Err(format!("获取 '{}' 工具列表失败: {}", name, msg));
        }

        let tools_array = tools_response
            .pointer("/result/tools")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let mut tools = Vec::new();
        for t in &tools_array {
            let orig_name = t["name"].as_str().unwrap_or("unknown").to_string();
            let description = t["description"].as_str().unwrap_or("").to_string();
            let input_schema = t.get("inputSchema").cloned().unwrap_or(json!({}));

            tools.push(McpToolDef {
                prefixed_name: format!("mcp:{}:{}", name, orig_name),
                original_name: orig_name,
                server_name: name.to_string(),
                description,
                input_schema,
            });
        }

        procs.insert(name.to_string(), proc);

        // 更新缓存
        if let Ok(mut cache) = self.tool_cache.lock() {
            for t in &tools {
                // 去重
                if !cache.iter().any(|c| c.prefixed_name == t.prefixed_name) {
                    cache.push(t.clone());
                }
            }
        }

        Ok(())
    }

    /// 断开一个 MCP 服务器
    pub fn disconnect(&self, name: &str) -> Result<(), String> {
        let mut procs = self.processes.lock().map_err(|e| format!("锁错误: {}", e))?;

        if let Some(proc) = procs.remove(name) {
            kill_process(&proc);
        }

        if let Ok(mut cache) = self.tool_cache.lock() {
            cache.retain(|t| t.server_name != name);
        }

        Ok(())
    }

    /// 断开所有 MCP 服务器
    #[allow(dead_code)]
    pub fn disconnect_all(&self) {
        if let Ok(mut procs) = self.processes.lock() {
            for (_, proc) in procs.drain() {
                kill_process(&proc);
            }
        }
        if let Ok(mut cache) = self.tool_cache.lock() {
            cache.clear();
        }
    }

    /// 获取所有缓存的 MCP 工具定义
    pub fn get_tools(&self) -> Vec<McpToolDef> {
        self.tool_cache.lock()
            .map(|c| c.clone())
            .unwrap_or_default()
    }

    /// 调用 MCP 工具
    pub fn call_tool(&self, prefixed_name: &str, args: &Value) -> Result<Value, String> {
        let parts: Vec<&str> = prefixed_name.splitn(3, ':').collect();
        if parts.len() < 3 || parts[0] != "mcp" {
            return Err(format!("无效的 MCP 工具名: {}", prefixed_name));
        }
        let server_name = parts[1];
        let tool_name = parts[2];

        let procs = self.processes.lock().map_err(|e| format!("锁错误: {}", e))?;
        let proc = procs.get(server_name)
            .ok_or_else(|| format!("MCP 服务器 '{}' 未连接", server_name))?;

        let response = send_mcp_request(proc, "tools/call", json!({
            "name": tool_name,
            "arguments": args,
        }))?;

        if let Some(error) = response.get("error") {
            let msg = error["message"].as_str().unwrap_or("unknown error");
            return Err(format!("{}: {}", tool_name, msg));
        }

        // 解析 MCP tool call result content
        if let Some(content) = response.pointer("/result/content") {
            let texts: Vec<String> = content.as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| item["text"].as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            if !texts.is_empty() {
                return Ok(json!({ "result": texts.join("\n") }));
            }
            Ok(json!({ "result": content }))
        } else {
            Ok(response)
        }
    }

    /// 获取已连接的服务器列表
    pub fn list_connections(&self) -> Vec<String> {
        self.processes.lock()
            .map(|p| p.keys().cloned().collect())
            .unwrap_or_default()
    }

    /// 检查指定服务器是否已连接
    #[allow(dead_code)]
    pub fn is_connected(&self, name: &str) -> bool {
        self.processes.lock()
            .map(|p| p.contains_key(name))
            .unwrap_or(false)
    }
}

/// 发送 JSON-RPC 请求到 MCP 进程
fn send_mcp_request(proc: &McpProcess, method: &str, params: Value) -> Result<Value, String> {
    let request = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    });

    let mut request_str = serde_json::to_string(&request)
        .map_err(|e| format!("序列化请求失败: {}", e))?;
    request_str.push('\n');

    // 写入 stdin
    {
        let mut stdin = proc.stdin.lock().map_err(|e| format!("stdin 锁错误: {}", e))?;
        stdin.write_all(request_str.as_bytes())
            .map_err(|e| format!("写入 stdin 失败: {}", e))?;
        stdin.flush().map_err(|e| format!("刷新 stdin 失败: {}", e))?;
    }

    // 读取一行响应
    let mut stdout = proc.stdout.lock().map_err(|e| format!("stdout 锁错误: {}", e))?;
    let mut line = String::new();
    stdout.read_line(&mut line)
        .map_err(|e| format!("读取 stdout 失败: {}", e))?;

    serde_json::from_str(&line)
        .map_err(|e| format!("解析 JSON-RPC 响应失败: {}", e))
}

fn kill_process(proc: &McpProcess) {
    if let Ok(mut guard) = proc.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
