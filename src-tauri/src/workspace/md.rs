use super::types::WorkspaceFileMeta;

/// 从文件内容解析 frontmatter + body
pub(super) fn parse_md_file(content: &str) -> Option<(WorkspaceFileMeta, String)> {
    let content = content.trim();
    if !content.starts_with("---") {
        return None;
    }

    let end = content[3..].find("\n---")?;
    let fm_str = &content[3..3 + end];
    let body = content.get(3 + end + 5..).map(|s| s.trim().to_string()).unwrap_or_default();

    // 简易 frontmatter 解析（不使用额外依赖）
    let mut name = String::new();
    let mut description = String::new();
    let mut created_at = 0u64;
    let mut updated_at = 0u64;

    for line in fm_str.lines() {
        if let Some(val) = line.strip_prefix("name: ") {
            name = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("description: ") {
            description = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("created_at: ") {
            created_at = val.trim().parse().unwrap_or(0);
        } else if let Some(val) = line.strip_prefix("updated_at: ") {
            updated_at = val.trim().parse().unwrap_or(0);
        }
    }

    Some((
        WorkspaceFileMeta {
            name,
            description,
            created_at,
            updated_at,
        },
        body,
    ))
}

/// 生成带 frontmatter 的内容
pub(super) fn build_md_content(meta: &WorkspaceFileMeta, body: &str) -> String {
    format!(
        "---\nname: {}\ndescription: {}\ncreated_at: {}\nupdated_at: {}\n---\n{}",
        meta.name, meta.description, meta.created_at, meta.updated_at, body
    )
}
