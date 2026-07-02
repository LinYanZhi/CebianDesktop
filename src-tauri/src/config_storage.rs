use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// 双 AI 桥接端口配置
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BridgePortConfig {
    /// 浏览器别名，如 "Chrome"、"Edge"
    pub name: String,
    /// 监听端口号
    pub port: u16,
}

/// 应用完整配置，对应前端 AIConfig 结构
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    /// AI 提供商列表
    pub providers: Vec<ProviderConfig>,
    /// 当前激活的 provider id
    pub active_provider_id: String,
    /// 最大 token
    pub max_tokens: u32,
    /// 温度
    pub temperature: f64,
    /// 思考模式
    pub thinking_level: String,
    /// 系统提示词
    pub system_prompt: String,
    /// 主题: "dark" / "light"
    pub theme: String,
    /// 主色调色相 (0-360)，默认 24（橙色）
    #[serde(default)]
    pub primary_hue: f64,
    /// AI 权限模式：conservative（保守）/ balanced（平衡）/ trusted（信任）/ custom（自定义）
    #[serde(default)]
    pub ai_permission_mode: String,
    /// 自定义模式下每个工具的独立权限（tool_name → "allow" / "confirm" / "deny"）
    #[serde(default)]
    pub tool_permissions: HashMap<String, String>,
    /// 双 AI 桥接端口配置列表
    #[serde(default = "default_bridge_ports")]
    pub bridge_ports: Vec<BridgePortConfig>,
    /// 界面浏览状态（如当前在设置/对话、设置栏目等）
    #[serde(default)]
    pub view_state: HashMap<String, String>,
}

fn default_bridge_ports() -> Vec<BridgePortConfig> {
    vec![BridgePortConfig {
        name: "默认浏览器".to_string(),
        port: 37421,
    }]
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub api_key: String,
    pub endpoint: String,
    pub models: Vec<String>,
    pub selected_model: String,
    pub connected: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            providers: vec![],
            active_provider_id: String::new(),
            max_tokens: 4096,
            temperature: 0.7,
            thinking_level: "medium".into(),
            system_prompt: String::new(),
            theme: "dark".into(),
            primary_hue: 200.0,
            ai_permission_mode: "conservative".into(),
            tool_permissions: HashMap::new(),
            bridge_ports: default_bridge_ports(),
            view_state: HashMap::new(),
        }
    }
}

/// 获取 `app_data_dir` 并确保目录存在
fn ensure_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取 app_data_dir 失败: {}", e))?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("创建 app_data_dir 失败: {}", e))?;
    Ok(dir)
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_data_dir(app)?.join("config.json"))
}

pub fn save_config(app: &tauri::AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("序列化配置失败: {}", e))?;
    fs::write(&path, &json)
        .map_err(|e| format!("写入配置文件失败: {}", e))?;
    Ok(())
}

pub fn load_config(app: &tauri::AppHandle) -> Result<AppConfig, String> {
    let path = config_path(app)?;
    if !path.exists() {
        // 无配置时返回默认值
        return Ok(AppConfig::default());
    }
    let json = fs::read_to_string(&path)
        .map_err(|e| format!("读取配置文件失败: {}", e))?;
    serde_json::from_str(&json)
        .map_err(|e| format!("解析配置文件失败: {}", e))
}

// ─── 对话存储 ────────────────────────────────────────────────

/// 单个对话，与前端 Conversation 类型对应
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub messages: Vec<serde_json::Value>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

fn conversations_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_data_dir(app)?.join("conversations.json"))
}

pub fn save_conversations(app: &tauri::AppHandle, convs: &[Conversation]) -> Result<(), String> {
    let path = conversations_path(app)?;
    let json = serde_json::to_string_pretty(convs)
        .map_err(|e| format!("序列化对话失败: {}", e))?;
    fs::write(&path, &json)
        .map_err(|e| format!("写入对话文件失败: {}", e))
}

pub fn load_conversations(app: &tauri::AppHandle) -> Result<Vec<Conversation>, String> {
    let path = conversations_path(app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let json = fs::read_to_string(&path)
        .map_err(|e| format!("读取对话文件失败: {}", e))?;
    serde_json::from_str(&json)
        .map_err(|e| format!("解析对话文件失败: {}", e))
}

// ─── Prompt 存储 ────────────────────────────────────────────

/// 单个提示词，对应前端的 Slash Prompt
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Prompt {
    /// 唯一标识（生成后不变，用于删除/更新）
    pub id: String,
    /// 前端显示的简称，如 translate-selection
    pub name: String,
    /// 简短说明
    pub description: String,
    /// Prompt 正文（模板变量会在前端替换）
    pub content: String,
    /// 创建时间戳
    pub created_at: u64,
    /// 更新时间戳
    pub updated_at: u64,
}

fn prompts_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_data_dir(app)?.join("prompts.json"))
}

pub fn save_prompts(app: &tauri::AppHandle, prompts: &[Prompt]) -> Result<(), String> {
    let path = prompts_path(app)?;
    let json = serde_json::to_string_pretty(prompts)
        .map_err(|e| format!("序列化提示词失败: {}", e))?;
    fs::write(&path, &json)
        .map_err(|e| format!("写入提示词文件失败: {}", e))
}

pub fn load_prompts(app: &tauri::AppHandle) -> Result<Vec<Prompt>, String> {
    let path = prompts_path(app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let json = fs::read_to_string(&path)
        .map_err(|e| format!("读取提示词文件失败: {}", e))?;
    serde_json::from_str(&json)
        .map_err(|e| format!("解析提示词文件失败: {}", e))
}

pub fn delete_prompt(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let mut prompts = load_prompts(app)?;
    let len_before = prompts.len();
    prompts.retain(|p| p.id != id);
    if prompts.len() == len_before {
        return Err(format!("未找到 ID 为 '{}' 的提示词", id));
    }
    save_prompts(app, &prompts)
}

// ─── MCP 服务器配置存储 ──────────────────────────────────────

/// MCP 服务器配置
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct McpServerConfig {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    /// 是否自动启动
    #[serde(default)]
    pub auto_start: bool,
}

fn mcp_servers_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_data_dir(app)?.join("mcp_servers.json"))
}

pub fn save_mcp_servers(app: &tauri::AppHandle, servers: &[McpServerConfig]) -> Result<(), String> {
    let path = mcp_servers_path(app)?;
    let json = serde_json::to_string_pretty(servers)
        .map_err(|e| format!("序列化 MCP 配置失败: {}", e))?;
    fs::write(&path, &json)
        .map_err(|e| format!("写入 MCP 配置文件失败: {}", e))
}

pub fn load_mcp_servers(app: &tauri::AppHandle) -> Result<Vec<McpServerConfig>, String> {
    let path = mcp_servers_path(app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let json = fs::read_to_string(&path)
        .map_err(|e| format!("读取 MCP 配置文件失败: {}", e))?;
    serde_json::from_str(&json)
        .map_err(|e| format!("解析 MCP 配置文件失败: {}", e))
}
