use serde::{Deserialize, Serialize};

/// 工作区子目录
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceDir {
    Prompts,
    Skills,
}

impl WorkspaceDir {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Prompts => "prompts",
            Self::Skills => "skills",
        }
    }
}

/// 文件元信息（frontmatter 解析结果）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceFileMeta {
    pub name: String,
    pub description: String,
    pub created_at: u64,
    pub updated_at: u64,
}

/// 工作区文件完整信息
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceFile {
    /// 文件名（含扩展名），如 abc123.md
    pub filename: String,
    /// 不带扩展名的文件名，作为唯一标识
    pub id: String,
    pub name: String,
    pub description: String,
    pub content: String,
    pub created_at: u64,
    pub updated_at: u64,
}
