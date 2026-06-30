//! Tauri IPC 命令
//!
//! 定义前端可调用的所有 IPC 命令，管理 MCP 服务器状态、AI 工具调用的二次确认机制
//!
//! 按功能领域拆分为以下子模块：
//! - ai: AI 调用（call_ai, call_ai_streaming）
//! - tools: 工具管理 + 二次确认（get_tools, execute_tool, confirm_tool_execution 等）
//! - mcp: MCP 服务器 + 客户端（start_mcp_server, connect_mcp_server 等）
//! - config: 配置管理（save_app_config, save_conversations, prompt CRUD）
//! - workspace: 工作区文件管理（list_workspace_files 等）
//! - misc: 杂项（备份导出导入、base64 辅助等）

mod ai;
mod config;
mod mcp;
mod misc;
mod tools;
mod workspace;

pub use ai::*;
pub use config::*;
pub use mcp::*;
pub use misc::*;
pub use tools::*;
pub use workspace::*;
