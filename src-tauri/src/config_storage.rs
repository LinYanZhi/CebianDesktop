use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

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
