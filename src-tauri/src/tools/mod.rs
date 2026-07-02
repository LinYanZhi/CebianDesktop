//! 本地工具实现
//!
//! 提供文件操作、系统查询、截图、通知等本地工具

use std::path::Path;
use std::sync::OnceLock;

use serde_json::{json, Value};

use crate::workspace;

mod excel_tools;
mod file_ops;
mod system_ops;
mod net_ops;

use excel_tools::*;
use file_ops::*;
use system_ops::*;
use net_ops::*;

/// 允许 AI 进行文件写/删操作的安全目录列表
/// 由 init_allowed_dirs() 在应用启动时初始化
static ALLOWED_DIRS: OnceLock<Vec<String>> = OnceLock::new();

/// 硬性护栏：禁止 AI 写入的系统关键路径（无论什么模式都拦截）
const PATH_BLACKLIST: &[&str] = &[
    "C:\\Windows",
    "C:\\Windows\\System32",
    "C:\\Windows\\System",
    "C:\\Windows\\SysWOW64",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "C:\\ProgramData",
    "C:\\Boot",
    "C:\\System Volume Information",
    "C:\\$Recycle.Bin",
    "C:\\Recovery",
];

/// 硬性护栏：禁止 AI 执行的破坏性命令（无论什么模式都拦截）
const COMMAND_BLACKLIST: &[&str] = &[
    "format",
    "format.",
    "format c:",
    "format C:",
    "del /f /s",
    "del /f /q",
    "rd /s /q",
    "rmdir /s /q",
    "rm -rf /",
    "rm -rf /*",
    "rm -rf ~",
    ":(){ :|:& };:",  // fork bomb
    "dd if=/dev/zero",
    "dd if=/dev/random",
    "diskpart",
    "reg delete",
    "reg DELETE",
    "fsutil",
    "bcdedit",
    "bootsect",
    "mbr2gpt",
    "powercfg -h",
    "powercfg /h",
    "vssadmin delete",
    "cipher /w:",
    "cipher /w",
    "shutdown -s",
    "shutdown /s",
    "shutdown -r",
    "shutdown /r",
    "init 0",
    "init 6",
    "reboot",
    "poweroff",
    "halt",
];

/// 检查硬性护栏：拦截写入系统关键路径
pub(crate) fn check_path_hard_barrier(path: &str, is_read: bool) -> Result<(), String> {
    if is_read {
        return Ok(()); // 读取不限制
    }
    let p = Path::new(path);
    let path_lower = p.to_string_lossy().to_lowercase();

    // 检查当前路径或父目录是否在黑名单中
    for &blacklisted in PATH_BLACKLIST {
        if path_lower.starts_with(&blacklisted.to_lowercase()) {
            return Err(format!(
                "安全拦截：不允许写入系统关键目录「{}」。这是硬性限制，无法绕过。",
                blacklisted
            ));
        }
    }

    // 检查用户目录下的敏感子路径（启动项、脚本宿主等）
    // 这些路径在用户目录内，validate_path 会放行，但写入它们同样危险
    let sensitive_patterns = &[
        r"appdata\roaming\microsoft\windows\start menu",
        r"appdata\local\microsoft\windows\start menu",
        r"appdata\locallow\microsoft\windows\start menu",
    ];
    for pattern in sensitive_patterns {
        if path_lower.contains(pattern) {
            return Err(format!(
                "安全拦截：不允许写入系统启动/配置目录。这是硬性限制，无法绕过。"
            ));
        }
    }

    Ok(())
}

/// 检查硬性护栏：拦截破坏性命令
pub(crate) fn check_command_hard_barrier(command: &str) -> Result<(), String> {
    let cmd_lower = command.to_lowercase().trim().to_string();
    for &blacklisted in COMMAND_BLACKLIST {
        if cmd_lower.starts_with(&blacklisted.to_lowercase()) {
            return Err(format!(
                "安全拦截：禁止执行破坏性命令「{}」。这是硬性限制，无法绕过。",
                blacklisted
            ));
        }
    }
    // 额外检查：禁止禁用 Windows Defender 或 UAC
    if cmd_lower.contains("disable") && (cmd_lower.contains("defender") || cmd_lower.contains("uac")) {
        return Err("安全拦截：不允许禁用系统安全组件（Windows Defender / UAC）。这是硬性限制。".into());
    }
    Ok(())
}

/// 获取工具的固有风险等级
pub(crate) fn get_tool_risk_level(name: &str) -> &'static str {
    match name {
        // 🔴 高风险
        "delete_path" | "run_command" | "skill_delete" => "high",
        // 🟠 中风险
        "write_new_file" | "edit_file" | "rename_path" | "batch_rename" | "copy_path" | "system_add_language" 
        | "capture_screen" | "download_file" | "clipboard_write" => "medium",
        // 🟢 以下安全工具由 Rust 处理，不走 fallback
        "get_file_info" => "safe",
        // 🟢 低风险 / 安全
        _ => "safe",
    }
}

/// 初始化 AI 文件操作的安全目录列表。
/// 应在应用启动时（setup 阶段）调用一次。
pub fn init_allowed_dirs(workspace_dir: &str) {
    let mut dirs = vec![workspace_dir.to_string()];
    // 系统临时目录（用于导入/导出等操作）
    if let Ok(temp) = std::env::temp_dir().canonicalize() {
        dirs.push(temp.to_string_lossy().to_string());
    }
    // 常用用户目录（桌面、下载、文档）—— 都是用户文件的安全存放位置
    if let Some(home) = std::env::var("USERPROFILE").ok().or_else(|| std::env::var("HOME").ok()) {
        let user_dirs = ["Desktop", "Downloads", "Documents"];
        for sub in &user_dirs {
            let p = std::path::Path::new(&home).join(sub);
            if p.exists() {
                if let Ok(canonical) = p.canonicalize() {
                    dirs.push(canonical.to_string_lossy().to_string());
                }
            }
        }
    }
    let _ = ALLOWED_DIRS.set(dirs);
}

/// 校验路径是否在安全目录范围内。
/// 返回 Err 表示路径不在允许范围内。
pub(crate) fn validate_path(path: &str, allow_read: bool) -> Result<(), String> {
    // 硬性护栏：阻止写入系统关键路径
    check_path_hard_barrier(path, allow_read)?;

    let p = Path::new(path);
    
    // 如果路径不存在，检查父目录
    let check_path = if p.exists() {
        // canonicalize 解析符号链接和 ..，获得真实路径
        p.canonicalize().map_err(|_| format!("路径无效: {}", path))?
    } else if let Some(parent) = p.parent() {
        if parent.as_os_str().is_empty() || parent == Path::new(".") || parent == Path::new("/") {
            return Err(format!("路径无效: {}", path));
        }
        if !parent.exists() {
            return Err(format!("父目录不存在: {}", parent.display()));
        }
        parent.canonicalize().map_err(|_| format!("父目录无效: {}", parent.display()))?
    } else {
        return Err(format!("路径无效: {}", path));
    };

    let allowed = ALLOWED_DIRS.get().ok_or("安全目录未初始化")?;

    // 允许用户目录（桌面/下载/文档）下的读写操作
    if let Some(home) = std::env::var("USERPROFILE").ok().or_else(|| std::env::var("HOME").ok()) {
        let home_path = Path::new(&home);
        if home_path.exists() {
            if let Ok(home_canonical) = home_path.canonicalize() {
                if check_path.starts_with(&home_canonical) {
                    return Ok(());
                }
            }
        }
    }

    // 检查是否在任何一个安全目录下
    for dir_str in allowed {
        let dir = Path::new(dir_str);
        let dir_canonical = dir.canonicalize().map_err(|_| format!("安全目录无效: {}", dir_str))?;
        if check_path.starts_with(&dir_canonical) {
            return Ok(());
        }
    }

    // 允许网络路径（UNC 路径和映射网络驱动器）的读写操作
    // canonicalize 会将映射驱动器（如 Z:\）解析为真实 UNC 路径（\\server\share\...）
    let check_str = check_path.to_string_lossy();
    if check_str.starts_with("\\\\") {
        return Ok(());
    }

    Err(format!(
        "路径不在允许范围内。允许在工作区目录、用户目录（桌面/下载/文档）、临时目录和网络共享路径（UNC/映射驱动器）内读写文件。当前路径: {}。\n【安全建议】请向用户说明该路径受限的原因，询问用户是否要：1) 将文件移动到工作区目录后重试；2) 联系开发者调整安全配置。不要尝试自行绕过此限制。",
        path
    ))
}

macro_rules! td {
    ($name:expr, $desc:expr, $props:expr, [$($req:expr),* $(,)?]) => {
        tool_def($name, $desc, props($props), vec![$($req),*])
    };
    ($name:expr, $desc:expr, $props:expr, []) => {
        tool_def($name, $desc, props($props), vec![])
    };
}

/// 获取所有工具定义列表
pub fn get_tool_definitions() -> Vec<Value> {
    vec![
        // ═══════════════════════════════════════════════════════════
        //  文件操作
        // ═══════════════════════════════════════════════════════════
        td!("get_file_info",
            "获取文件或目录的详细信息。返回文件大小（含人类可读格式）、修改时间、创建时间、类型（文件/目录）、\
             文件扩展名等元数据。\
             \n\n适合场景：查看文件大小、检查修改时间、判断文件是否存在、了解文件类型等基本信息查询。\
             \n注意：路径必须是绝对路径。",
            &[("path", "string", "要查询的文件或目录的绝对路径，例如 C:\\Users\\用户名\\Desktop\\file.txt")], ["path"]),

        td!("read_local_file",
            "读取本地文本文件的内容。返回文件全部文本。适用于读取源代码、配置文件、文档、日志等文本文件。\
             \n\n注意：路径必须是绝对路径（如 C:\\Users\\用户名\\Desktop\\test.txt）。不支持读取二进制文件（如图片、视频）。\
             \n\n适合场景：查看用户提到的文件内容、阅读代码、检查配置文件、查看日志等。",
            &[("path", "string", "要读取的文件绝对路径，例如 C:\\Users\\用户名\\Desktop\\note.txt")], ["path"]),

        td!("read_excel",
            "读取 Excel 文件（.xlsx/.xls/.xlsb/.ods）的内容。返回所有 sheet 的名称、行数/列数，以及每 sheet 的数据内容（纯文本，前 200 行）。\
             \n\n支持格式：.xlsx、.xls、.xlsb、.ods\
             \n不需要安装 Python 或任何外部库。\
             \n注意：路径必须是绝对路径。如果文件很大，最多返回前 200 行数据。\
             \n\n适合场景：查看用户的 Excel 表格数据、分析账单/报表、提取电子表格信息等。",
            &[("path", "string", "Excel 文件的绝对路径，例如 C:\\Users\\用户名\\Desktop\\报表.xlsx")], ["path"]),

        td!("write_new_file",
            "写入内容到文件。支持单次写入和批量写入。\
             \n\n两种用法：\
             \n1. 单次写入：传 path + content 参数\
             \n2. 批量写入：传 files 数组，每个元素含 path 和 content\
             \n\n如果文件已存在，会被覆盖；如果目录不存在，会自动创建。\
             \n\n安全限制：仅允许在工作区目录和临时目录下写入文件。路径必须是绝对路径。\
             \n\n适合场景：创建新文件、保存 AI 生成的内容、批量生成多份文件等。",
            &[("path", "string", "单次写入的文件绝对路径（与 files 二选一）"), ("content", "string", "单次写入的文件内容（与 files 二选一）"), ("files", "array", "批量写入的文件列表，每个元素为 {\"path\": \"绝对路径\", \"content\": \"内容\"}（与 path+content 二选一）")], []),

        td!("edit_file",
            "精确查找并替换文件中的指定文本。这是部分修改文件内容的工具，不会影响文件的其他部分。\
             \n\n安全限制：仅允许编辑工作区目录和临时目录下的文件。\
             \n注意：old_text 必须完全匹配文件中的内容（区分大小写）。如果有多处匹配，会全部替换。\
             \n\n适合场景：修改配置文件中的某个值、替换代码中的变量名、更新版本号等局部修改。如需整体重写请使用 write_new_file。",
            &[("path", "string", "文件绝对路径"), ("old_text", "string", "要被替换的现有文本（区分大小写，需完全匹配）"), ("new_text", "string", "替换后的新文本")], ["path", "old_text", "new_text"]),

        // ═══════════════════════════════════════════════════════════
        //  目录操作
        // ═══════════════════════════════════════════════════════════
        td!("list_directory",
            "列出指定目录下的文件和子目录。返回每个条目的名称、类型（文件/目录），按目录优先、名称排序。\
             \n\n注意：不会递归列出子目录的内容。如需递归搜索请使用 search_files 工具。路径必须是绝对目录路径。\
             \n安全限制：仅允许列出工作区、临时目录或用户目录下的内容。\
             \n\n适合场景：查看文件夹内容、浏览目录结构、确认文件是否存在等。",
            &[("path", "string", "要列出的目录绝对路径，例如 C:\\Users\\用户名\\Desktop")], ["path"]),

        td!("create_directory",
            "创建一个或多个目录。会递归创建所有不存在的父目录。\
             \n\n安全限制：仅允许在工作区目录和临时目录下创建目录。\
             \n注意：如果目录已存在，不会报错（幂等操作）。路径必须是绝对路径。\
             \n\n适合场景：为项目创建目录结构、创建输出文件夹等。",
            &[("path", "string", "要创建的目录绝对路径，例如 D:\\Projects\\my-app\\src")], ["path"]),

        td!("rename_path",
            "重命名或移动文件/目录。可以用于重命名文件，或将文件/目录移动到新位置。\
             \n\n安全限制：仅允许在工作区目录和临时目录下操作。\
             \n注意：如果目标位置的父目录不存在，会自动创建。如果目标已存在，行为取决于操作系统（可能覆盖或报错）。\
             \n\n适合场景：重命名单个文件、移动单个项目文件到新位置。\
             \n\n对于需要批量重命名多个文件的场景，请使用 batch_rename 工具，一次传入所有操作。",
            &[("old_path", "string", "原路径（文件或目录的当前绝对路径）"), ("new_path", "string", "新路径（目标绝对路径）")], ["old_path", "new_path"]),

        td!("batch_rename",
            "批量重命名或移动多个文件/目录。接受一组重命名操作，一次性全部执行。\
             \n\n当你需要重命名多个文件时（例如为多个图片重命名、批量整理文件等），\
             请使用此工具而非多次调用 rename_path。\
             \n\noperations 参数是一个数组，每个元素包含 old_path 和 new_path。\
             \n返回每个操作的成功/失败状态、成功数和失败数。\
             \n\n安全限制：仅允许在工作区目录和临时目录下操作。\
             \n\n适合场景：批量重命名图片、批量整理文件名、批量移动文件到新位置等。",
            &[("operations", "array", "重命名操作列表，每个元素为 {\"old_path\": \"原路径\", \"new_path\": \"新路径\"}")], ["operations"]),

        td!("copy_path",
            "复制文件到指定位置。注意：只支持复制文件，不支持复制目录（目录请使用 rename_path 移动）。\
             \n\n如果目标路径是一个已存在的目录，会自动在目录内保留原文件名。\
             \n如果目标路径是一个不存在的文件路径，且其父目录存在，会直接创建为文件。\
             \n如果目标路径的父目录不存在，会自动创建。\
             \n\n安全限制：源路径必须是允许读取的路径，目标路径必须允许写入。\
             \n\n适合场景：复制文件到另一个目录、备份文件、将文件复制到桌面等。",
            &[("source", "string", "源文件绝对路径"), ("destination", "string", "目标绝对路径（可以是文件路径或目录路径）")], ["source", "destination"]),

        td!("delete_path",
            "删除文件或目录。支持单次删除和批量删除。\
             \n\n两种用法：\
             \n1. 单次删除：传 path 参数（单个文件/目录）\
             \n2. 批量删除：传 paths 数组参数（多个文件/目录）\
             \n\n如果是目录，会递归删除其所有内容。\
             \n\n安全限制：仅允许删除工作区目录和临时目录下的文件和目录。\
             \n无法删除系统关键路径或用户工作区之外的路径。\
             \n警告：此操作不可撤销！删除目录会一并删除其所有子文件和子目录。\
             \n\n适合场景：清理不再需要的文件和目录、批量清理临时文件等。",
            &[("path", "string", "单个文件或目录的绝对路径（与 paths 二选一）"), ("paths", "array", "要删除的文件/目录路径列表（与 path 二选一），例如 [\"C:\\\\file1.txt\", \"C:\\\\file2.txt\"]")], []),

        td!("search_files",
            "按文件名或文件内容搜索文件。支持递归搜索子目录，最大深度 10 层，最多返回 50 条结果。\
             \n\n安全限制：仅允许搜索工作区、临时目录或用户目录下的文件。\
             \n\n搜索模式 (mode 参数)：\
             \n- \"name\"：按文件名匹配（不区分大小写）\
             \n- \"content\"：按文件内容关键词匹配（不区分大小写，会返回匹配的行）\
             \n\n适合场景：查找特定文件、在代码中搜索关键词、找配置文件等。",
            &[("directory", "string", "搜索起始目录绝对路径"), ("pattern", "string", "搜索关键词（不区分大小写）"), ("mode", "string", "搜索模式：\"name\" 按文件名 或 \"content\" 按文件内容")], ["directory", "pattern"]),

        // ═══════════════════════════════════════════════════════════
        //  文件网络操作
        // ═══════════════════════════════════════════════════════════
        td!("download_file",
            "从 URL 下载文件到本地磁盘。支持单次下载和批量下载。\
             \n\n两种用法：\
             \n1. 单次下载：传 url + destination 参数\
             \n2. 批量下载：传 files 数组，每个元素含 url 和 destination\
             \n\n支持任何可通过 HTTP/HTTPS 访问的文件。\
             \n\n适合场景：下载单张图片/单个文件、从多个 URL 批量下载文件到本地。",
            &[("url", "string", "单个文件的下载 URL（与 files 二选一）"), ("destination", "string", "单次下载的保存本地绝对路径（与 files 二选一）"), ("files", "array", "批量下载的文件列表，每个元素为 {\"url\": \"下载URL\", \"destination\": \"保存路径\"}（与 url+destination 二选一）")], []),

        td!("open_path",
            "使用系统默认程序打开文件或目录。相当于在文件资源管理器中双击文件或文件夹。\
             \n\n适合场景：打开文件夹让用户浏览、用默认应用打开文档/图片、在资源管理器中定位文件等。",
            &[("path", "string", "要打开的文件或目录绝对路径")], ["path"]),

        // ═══════════════════════════════════════════════════════════
        //  系统操作
        // ═══════════════════════════════════════════════════════════
        td!("run_command",
            "在终端中执行系统命令并返回输出结果。\
             \n\nWindows 上使用 cmd.exe（不是 PowerShell），macOS/Linux 上使用 sh。\
             \n\n注意：\
             \n- 命令在用户系统上实际执行，请谨慎操作（尤其是删除、格式化等危险命令）\
             \n- 交互式命令（如需要用户输入）会挂起，应避免使用\
             \n- 在 Windows 上通过 cmd.exe 执行 PowerShell 脚本时，$ 变量可能被 cmd 错误解析，\
             \n  导致 PowerShell 命令失败。避免在 run_command 中嵌入复杂 PowerShell 脚本。\
             \n- 如果连续 2 次尝试相同类型命令均失败，说明此路不通，请换思路或告知用户\
             \n- 返回 stdout 和 stderr 的输出\
             \n\n适合场景：运行简单的系统命令、git 操作、启动程序等。\
             \n不适合场景：安装软件、修改系统设置、多行脚本等复杂操作。",
            &[("command", "string", "要执行的命令，例如 dir 或 git status"), ("cwd", "string", "工作目录（可选，不指定则使用应用默认目录）")], ["command"]),

        td!("system_notify",
            "发送系统桌面通知。会在用户的操作系统通知区域显示一条通知消息。\
             \n\n适合场景：通知用户任务完成、提醒重要事件、后台任务结束时提醒等。",
            &[("title", "string", "通知标题（简短，如「下载完成」）"), ("message", "string", "通知正文内容")], ["title", "message"]),

        td!("system_info",
            "获取计算机的完整系统信息。包括：\
             \n- 操作系统类型和架构\
             \n- 主机名、计算机名和当前用户名\
             \n- CPU 型号和核心数\
             \n- 内存总量和已用量\
             \n- 所有磁盘（硬盘）的容量和可用空间\
             \n- 网络信息（内网 IP、外网 IP、MAC 地址、DNS 服务器）\
             \n- 已安装软件列表（名称、版本、安装位置、发布者）及总数\
             \n\n适合场景：了解用户电脑配置、检查磁盘空间、确认操作系统类型、查询已安装软件、查看网络配置等。",
            &[], []),

        td!("get_env",
            "读取系统环境变量。\
             \n如果不指定 name 参数，则返回所有环境变量（自动过滤敏感信息）。\
             \n\n常见环境变量：\
             \n- PATH: 系统路径\
             \n- USERPROFILE / HOME: 用户目录\
             \n- APPDATA: 应用数据目录\
             \n- TEMP / TMP: 临时目录\
             \n- COMPUTERNAME: 计算机名\
             \n\n适合场景：查看用户目录、检查 PATH 配置、了解系统配置等。",
            &[("name", "string", "环境变量名称（可选），例如 \"PATH\" 或 \"USERPROFILE\"。不传则返回全部。")], []),

        td!("system_get_languages",
            "获取当前 Windows 系统已安装的语言和输入法列表。\
             \n返回已安装的语言标签（如 zh-CN、en-US）和对应的本地化名称。\
             \n\n适合场景：查看当前系统语言、检查是否安装了中文输入法、查看用户使用的语言列表等。",
            &[], []),

        td!("system_add_language",
            "向 Windows 系统添加新的语言（包括对应的输入法/键盘布局）。\
             \n\n注意：\
             \n- 需要管理员权限，沙盒或受限环境可能失败\
             \n- 添加后可能需要注销或重启才能生效\
             \n- 常见语言标签：zh-CN（简体中文中国）、zh-TW（繁体中文台湾）、en-US（英语美国）、ja-JP（日语日本）\
             \n- 如果添加失败（如无权限），请告知用户原因，不要反复尝试\
             \n\n适合场景：添加中文输入法、切换系统语言、添加其他语言的键盘布局等。",
            &[("language_tag", "string", "语言标签，例如 \"zh-CN\" 表示简体中文",), ("language_name", "string", "语言显示名称（可选），例如 \"中文(中华人民共和国)\"")], ["language_tag"]),

        // ═══════════════════════════════════════════════════════════
        //  进程与窗口
        // ═══════════════════════════════════════════════════════════
        td!("list_processes",
            "列出正在运行的进程（按内存占用从高到低排序，最多 40 个）。\
             \n可以通过 name_filter 参数按进程名过滤，例如只查看 chrome 相关的进程。\
             \n\n返回每个进程的 PID、名称、内存占用 (MB) 和 CPU 使用率。\
             \n\n适合场景：查看哪些程序在运行、查找特定进程、诊断系统资源占用等。",
            &[("name_filter", "string", "进程名过滤关键词（可选），例如 \"chrome\" 或 \"python\""),], []),

        td!("list_windows",
            "列出当前系统中所有打开的窗口（有标题的窗口）。返回每个窗口的标题和句柄。\
             \n\n适合场景：查看用户当前打开了哪些应用程序窗口、了解用户的桌面工作环境等。",
            &[], []),

        td!("capture_screen",
            "截取当前屏幕（主显示器全屏）并保存为 PNG 图片。\
             \n\n注意：路径必须以 .png 结尾。如果保存目录不存在，会自动创建。\
             \n\n适合场景：让 AI 看到用户当前的屏幕内容、帮助用户分析界面布局、记录桌面状态等。",
            &[("save_path", "string", "截图保存的绝对路径，必须以 .png 结尾，例如 C:\\Users\\用户名\\Desktop\\screenshot.png")], ["save_path"]),

        // ═══════════════════════════════════════════════════════════
        //  网络
        // ═══════════════════════════════════════════════════════════
        td!("fetch_url",
            "发起 HTTP 请求获取 URL 内容。支持 GET 和 POST 方法。\
             \n\n注意：返回的是响应体的原始文本内容。对于 JSON API，会返回 JSON 字符串。\
             \n\n适合场景：查询 API 接口、获取网页内容、检查服务状态等网络请求。",
            &[("url", "string", "请求的 URL 地址"), ("method", "string", "HTTP 方法：\"GET\" 或 \"POST\"（默认 GET）"), ("body", "string", "请求体（仅在 POST 时需要）")], ["url"]),

        // ═══════════════════════════════════════════════════════════
        //  剪贴板
        // ═══════════════════════════════════════════════════════════
        td!("clipboard_read",
            "读取系统剪贴板中的文本内容。\
             \n\n适合场景：获取用户复制的文本、读取 AI 需要处理的剪贴板数据等。",
            &[], []),

        td!("clipboard_write",
            "将文本写入系统剪贴板。写入后用户可以在任何应用中粘贴（Ctrl+V）。\
             \n\n适合场景：将 AI 生成的内容复制给用户使用、方便用户粘贴代码/文本到其他应用。",
            &[("text", "string", "要写入剪贴板的文本内容")], ["text"]),

        // ═══════════════════════════════════════════════════════════
        //  交互式工具
        // ═══════════════════════════════════════════════════════════
        td!("ask_user",
            "向用户展示一个动态表单或提问，等待用户填写并回复。\
             \n\n这是你与用户交互的首选方式。当你需要用户提供信息、做决定、确认操作时，\
             使用此工具而非在回复中直接提问。\
             \n\n支持丰富的表单控件：\
             \n- text: 单行文本输入\
             \n- textarea: 多行文本输入\
             \n- confirm: 是/否确认按钮\
             \n- single_select: 单选（radio 按钮）\
             \n- multi_select: 多选（checkbox）\
             \n- dropdown: 下拉选择\
             \n\n三种展示模式：\
             \n1. 紧凑模式（Compact）：单字段 + 无 title + 无 description 时自动使用，\
             \n   选项直接显示为可点击按钮，点选即返回，无需额外提交。\
             \n2. 表单模式（Form）：多字段或设置了 title/description 时使用，\
             \n   显示完整表单，用户填完后点「提交」。\
             \n3. 分步向导模式（Wizard）：使用 pagination.type=\"wizard\" 启用，\
             \n   配合 step 字段分页展示，适合多步配置场景。\
             \n   - show_progress: 是否显示进度条（默认 true）\
             \n   - allow_skip: 是否允许跳过非必填步骤（默认 false）\
             \n   - allow_review: 是否显示最终确认步骤（默认 true）\
             \n\n你可以：\
             \n- 一次展示多个字段（questions 数组），构成完整表单\
             \n- 为表单添加 title 和 description\
             \n- 为每个字段设置 required、placeholder、message 辅助文字\
             \n- 为选择字段设置 options（每个含 label、value、description、recommended）\
             \n- 多步表单给每个字段设置 step（1-based）和 step_title（步骤标题）\
             \n\nquestion 是旧版单字段模式的参数，新用法请使用 questions 数组。\
             \n每个 question 对象需要 id（唯一键名）和 question（显示文本）。",
            &[
                ("title", "string", "（可选）表单标题，多字段时建议提供"),
                ("description", "string", "（可选）表单说明文字"),
                ("submit_label", "string", "（可选）提交按钮文字，默认「提交」"),
                ("pagination", "string", "（可选）JSON 字符串，分页配置。仅支持 type: wizard。字段：show_progress（是否显示进度条）、allow_skip（是否允许跳过）、allow_review（是否显示确认步骤）"),
                ("questions", "string", "（推荐）JSON 字符串，字段数组。每个元素包含 id（唯一键名）、question（问题文本）、type（可选，text/textarea/confirm/single_select/multi_select/dropdown）、options（可选，选择类型的选项数组，每项含 label、value、description、recommended）、required（可选，是否必填）、placeholder（可选）、message（可选，辅助说明）、allow_free_text（可选）、min_select（可选）、max_select（可选）、step（可选，分步骤号，1-based）、step_title（可选，步骤标题）"),
                ("question", "string", "（旧版，单字段时使用）向用户提出的问题"),
                ("type", "string", "（旧版，仅配合 question 使用）问题类型：text / confirm / select"),
                ("options", "string", "（旧版，仅配合 question+select 使用）JSON 选项数组"),
            ], []),

        // ═══════════════════════════════════════════════════════════
        //  技能管理
        // ═══════════════════════════════════════════════════════════
        td!("skill_list",
            "列出工作区中所有已安装的技能。返回每个技能的名称、描述、文件名、是否为目录（is_dir），\
             \n以及技能工作区的绝对路径（workspace_dir）。\
             \n\n当需要直接操作文件系统中的技能文件或目录时，可以使用 workspace_dir + filename 拼接出完整路径。\
             \n\n适合场景：查看有哪些可用技能、获取技能列表供用户选择、了解技能文件路径用于其他文件操作。",
            &[], []),

        td!("skill_create",
            "创建一个新的技能文件。技能是 AI 的可调用能力模块，创建后 AI 可以在对话中按需调用。\
             \n\n注意：name 用英文小写字母和连字符，如 web-researcher、code-reviewer。\
             \n技能内容用 Markdown 格式，描述该技能的能力和使用方式。\
             \n说明：如果用户想要中文技能名，也可以在创建后通过编辑器手动修改 frontmatter 的 name 字段。\
             \n\n创建完成后，AI 可以立即通过 skill_xxx 工具调用此技能。",
            &[
                ("name", "string", "技能名称（建议英文小写+连字符，如 web-researcher。如果用户希望用中文名，创建后可在编辑器中修改）"),
                ("description", "string", "简短描述这个技能的用途（对 AI 可见）"),
                ("content", "string", "技能定义内容（Markdown 格式），描述该技能的能力、规则和执行方式"),
            ], ["name", "description", "content"]),

        td!("skill_read",
            "读取指定技能的完整定义内容。返回技能的名称、描述、文件名和 Markdown 内容。\
             \n\n适合场景：查看某个技能的具体实现方式、编辑前获取当前内容。",
            &[
                ("name", "string", "技能名称（如 web-researcher）"),
            ], ["name"]),

        td!("skill_delete",
            "从工作区中彻底删除一个技能文件。注意：此操作不可撤销，且只支持删除技能文件（.md），不支持删除技能目录。\
             \n如果需要删除技能目录（is_dir 为 true），请先用 skill_list 获取 workspace_dir，\
             \n再使用 delete_path 工具拼接完整路径进行删除。",
            &[
                ("name", "string", "要删除的技能名称"),
            ], ["name"]),

        // ═══════════════════════════════════════════════════════════
        //  新增：批量文件操作
        // ═══════════════════════════════════════════════════════════
        td!("read_local_files",
            "批量读取多个本地文件。支持图片（返回 base64 data URI）、文本文件和二进制文件。\
             \n\n参数：paths 为文件绝对路径数组。\
             \n- 图片（png/jpg/gif/webp/bmp/svg/tiff/ico）：返回 base64 data URI + 宽高\
             \n- 文本（txt/md/json/xml/js/py/rs 等）：返回纯文本内容\
             \n- 二进制：返回文件大小和类型信息\
             \n\n适合场景：一次读取多个文件、读取图片供 AI 分析、批量查看文档内容等。",
            &[("paths", "array", "文件绝对路径列表，例如 [\"C:\\\\图片\\\\1.png\", \"C:\\\\文档\\\\note.txt\"]")], ["paths"]),

        td!("read_csv_as_json",
            "读取 CSV 文件并解析为 JSON 格式返回。第一行作为列名，每行数据转为 {列名: 值} 对象。\
             \n\n适合场景：查看 CSV 数据内容、分析报表、提取表格信息等。",
            &[("path", "string", "CSV 文件的绝对路径"), ("encoding", "string", "文件编码（可选，默认 utf-8，暂只支持 utf-8）")], ["path"]),

        td!("extract_archive",
            "解压压缩包（.zip / .tar.gz / .tar）到指定目录。\
             \n\n如果不指定 target_dir，会解压到压缩包同目录下的同名文件夹。\
             \n\n适合场景：解压用户下载的压缩包、安装包、导出数据等。",
            &[("path", "string", "压缩包的绝对路径"), ("target_dir", "string", "解压目标目录（可选，默认压缩包同目录下的同名文件夹")], ["path"]),

        td!("compress_files",
            "将多个文件或目录压缩为 .zip 文件。\
             \n\n注意：只支持输出 .zip 格式。目录会递归添加所有子文件。\
             \n\n适合场景：打包多个文件发送、备份文件、归档项目代码等。",
            &[("paths", "array", "要压缩的文件/目录路径列表"), ("output", "string", "输出的 .zip 文件绝对路径")], ["paths", "output"]),

        // ═══════════════════════════════════════════════════════════
        //  新增：Excel 数据处理
        // ═══════════════════════════════════════════════════════════
        td!("read_excel_as_json",
            "读取 Excel 文件（.xlsx/.xls/.xlsb/.ods）的内容，每行数据以列名为键返回 JSON 对象。\
             \n与 read_excel 不同，此工具返回结构化 JSON（列名+值），适合后续数据处理。\
             \nsheet_name 可选，不传则读取第一个 sheet。\
             \n\n适合场景：查看 Excel 数据、为后续 query/transform 等工具做数据准备。",
            &[("path", "string", "Excel 文件的绝对路径"), ("sheet_name", "string", "工作表名（可选，不传则用第一个 sheet）")], ["path"]),

        td!("excel_query",
            "对 Excel 文件进行条件筛选、分组聚合、去重、分页查询。\
             \n\n筛选参数（可组合使用，filter_logic 控制 and/or）：\
             \n- filter_col + filter_val：精确匹配\
             \n- filter_col + filter_like：模糊包含\
             \n- filter_col + filter_in：IN 列表匹配\
             \n- filter_gt：大于（数字），如 \"100\"\
             \n- filter_lt：小于（数字），如 \"50\"\
             \n\n分组聚合：\
             \n- group_by：按某列分组计数\
             \n- agg_col + agg_func（sum/avg/max/min）：聚合计算\
             \n\n去重：\
             \n- distinct：对某列去重，返回所有唯一值\
             \n\n分页：\
             \n- limit：返回行数上限（默认 50）\
             \n- offset：分页偏移（默认 0）\
             \n\n适合场景：从 Excel 中筛选出符合条件的行、按维度分组统计、查找不重复的值等。",
            &[
                ("path", "string", "Excel 文件路径"),
                ("sheet", "string", "工作表名（可选）"),
                ("select", "string", "返回的列，逗号分隔（可选，不传返回全部）"),
                ("filter_col", "string", "筛选条件列名"),
                ("filter_val", "string", "筛选值（精确匹配，传 \"null\" 查空值）"),
                ("filter_like", "string", "模糊匹配关键词"),
                ("filter_in", "string", "IN 列表（JSON 字符串数组）"),
                ("filter_gt", "string", "大于（数字值）"),
                ("filter_lt", "string", "小于（数字值）"),
                ("filter_logic", "string", "多条件逻辑：and（默认）| or"),
                ("group_by", "string", "分组列名"),
                ("agg_col", "string", "聚合列名（配合 group_by）"),
                ("agg_func", "string", "聚合函数：count/sum/avg/max/min"),
                ("limit", "string", "返回行数上限，默认 50"),
                ("offset", "string", "分页偏移，默认 0"),
                ("distinct", "string", "对某列去重"),
            ], ["path"]),

        td!("excel_summary",
            "快速统计 Excel 各列概况：非空值数、唯一值数、数值列最小值/最大值/中位数/总和/平均值、文本列样例值。\
             \n\n适合场景：快速了解 Excel 有多少行、哪些列有缺失值、数值分布范围、文本列有哪些典型值等概览信息。",
            &[("path", "string", "Excel 文件路径"), ("sheet", "string", "工作表名（可选）")], ["path"]),

        td!("excel_transform",
            "对 Excel 某列做正则提取/替换，返回变换结果（不修改原文件）。\
             \n\n典型场景：从箱唛 \"MH-BIHMO-P-YQ902028-LL1\" 提取后缀 \"LL1\"。\
             \n\n参数：\
             \n- source_col：源列名\
             \n- target_col：新列名\
             \n- regex：正则表达式，提取第一个捕获组（group 1）或整个匹配\
             \n- limit：返回样例行数，默认 20",
            &[
                ("path", "string", "Excel 文件路径"),
                ("source_col", "string", "源列名"),
                ("target_col", "string", "新列名（变换后的结果列）"),
                ("regex", "string", "正则表达式，提取第一个捕获组 (group 1)"),
                ("sheet", "string", "工作表名（可选）"),
                ("limit", "string", "返回样例行数，默认 20"),
            ], ["path", "source_col", "target_col", "regex"]),

        td!("excel_dedup",
            "查找 Excel 中的重复行，支持按多列联合判定重复。\
             \n\naction 参数：\
             \n- count（默认）：统计重复组数量和有重复的总行数\
             \n- list：列出重复组详情（key 和重复次数）\
             \n\n适合场景：检查数据是否有重复录入、找出重复的订单号等。",
            &[
                ("path", "string", "Excel 文件路径"),
                ("key_cols", "string", "判定重复的关键列，逗号分隔，如 \"sku,箱唛\""),
                ("action", "string", "操作：count（统计）| list（列出详情），默认 count"),
                ("sheet", "string", "工作表名（可选）"),
                ("limit", "string", "返回上限，默认 50"),
            ], ["path", "key_cols"]),

        td!("excel_join",
            "关联合并两个 Excel 表，支持正则提取关联键。\
             \n\n典型场景：箱唛 \"MH-BIHMO-P-YQ902028-LL1\" 提取后缀 → 匹配三方采购单。\
             \n\n参数：\
             \n- left/right：左右表文件路径\
             \n- left_key/right_key：关联列名\
             \n- left_key_extract/right_key_extract：正则提取关联键（可选）\
             \n- join_type：inner（默认）| left | outer\
             \n- select：返回列，逗号分隔（可选）\
             \n- limit：返回行数上限，默认 50",
            &[
                ("left", "string", "左表文件路径"),
                ("left_key", "string", "左表关联列名"),
                ("right", "string", "右表文件路径"),
                ("right_key", "string", "右表关联列名"),
                ("left_sheet", "string", "左表 sheet 名（可选）"),
                ("right_sheet", "string", "右表 sheet 名（可选）"),
                ("left_key_extract", "string", "左表关联键正则（可选），用于从列值提取实际 key"),
                ("right_key_extract", "string", "右表关联键正则（可选），用于从列值提取实际 key"),
                ("join_type", "string", "关联类型：inner（默认）| left | outer"),
                ("select", "string", "返回列，逗号分隔（可选，不传返回全部）"),
                ("limit", "string", "返回行数上限，默认 50"),
            ], ["left", "left_key", "right", "right_key"]),

        td!("excel_union",
            "纵向合并多个 Excel 文件（按列对齐，追加行），输出到新文件。\
             \n\n典型场景：泰.xlsx + 马来.xlsx + 越.xlsx → 东南亚汇总.xlsx。\
             \n\n适合场景：合并多个结构相同的报表、汇总不同月份的数据等。",
            &[
                ("files", "array", "源文件路径列表"),
                ("output", "string", "输出文件绝对路径"),
                ("sheet", "string", "工作表名，默认 Sheet1"),
            ], ["files", "output"]),

        td!("json_to_xlsx",
            "将 JSON 数组写入 Excel 文件。支持 overwrite（覆盖）和 append（追加）模式。\
             \n\n典型场景：浏览器爬取的数据 → 保存为 xlsx 供后续分析。\
             \n\ndata_json 是一个 JSON 数组字符串，如 '[{\"收货单号\":\"PO123\",\"金额\":100}]'。\
             \noverwrite 为 true 时覆盖已有文件，false 时追加到已有文件。",
            &[
                ("path", "string", "目标 xlsx 文件绝对路径"),
                ("sheet", "string", "工作表名"),
                ("data_json", "string", "JSON 数组字符串"),
                ("mode", "string", "写入模式：overwrite（覆盖，默认）| append（追加）"),
            ], ["path", "sheet", "data_json"]),

        td!("data_pipeline",
            "一次性执行多步骤数据处理流水线（load → transform → join → query → export）。\
             \n\npipeline_json 是一个 JSON 配置，描述所有步骤：\
             \n{\"steps\": [\
             \n  {\"action\": \"load\", \"path\": \"a.xlsx\", \"as\": \"cargo\"},\
             \n  {\"action\": \"transform\", \"source\": \"cargo\", \"col\": \"三方采购单\",\
             \n   \"extract\": \"^(\\\\\\\\w+)\", \"new_col\": \"前缀\"},\
             \n  {\"action\": \"join\", \"left\": \"cargo\", \"right\": \"malay\",\
             \n   \"left_key\": \"前缀\", \"right_key\": \"箱唛后缀\", \"type\": \"left\", \"output\": \"merged\"},\
             \n  {\"action\": \"query\", \"source\": \"merged\",\
             \n   \"filter_col\": \"收货单号\", \"filter_val\": \"null\", \"output\": \"unmatched\"},\
             \n  {\"action\": \"export\", \"source\": \"merged\",\
             \n   \"path\": \"C:/data/结果.xlsx\", \"sheet\": \"result\"}\
             \n]}\
             \n\n支持的 action：load, transform, join, query, export\
             \n\n适合场景：复杂的数据处理流程，避免多次调用独立工具。",
            &[
                ("pipeline_json", "string", "JSON 字符串，描述数据处理步骤"),
                ("limit", "string", "返回步骤摘要数上限，默认 50"),
            ], ["pipeline_json"]),
    ]
}

fn tool_def(name: &str, description: &str, props: Value, required: Vec<&str>) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": props,
            "required": required
        }
    })
}

fn props(entries: &[(&str, &str, &str)]) -> Value {
    let map: serde_json::Map<String, Value> = entries
        .iter()
        .map(|(k, typ, desc)| {
            (k.to_string(), json!({"type": typ, "description": desc}))
        })
        .collect();
    Value::Object(map)
}

/// 执行工具
pub fn execute_tool(name: &str, args: &Value, app: Option<&tauri::AppHandle>) -> Result<Value, String> {
    match name {
        "get_file_info" => {
            let path = arg_str(args, "path")?;
            validate_path(path, true)?;
            Ok(get_file_info(path)?)
        }
        "read_local_file" => {
            let path = arg_str(args, "path")?;
            validate_path(path, true)?;
            Ok(json!({"content": read_local_file(path)?}))
        }
        "read_excel" => {
            let path = arg_str(args, "path")?;
            validate_path(path, true)?;
            read_excel(path)
        }
        "write_new_file" => {
            // 检查是否批量写入
            if let Some(files) = args.get("files").and_then(|v| v.as_array()) {
                let mut file_pairs: Vec<(String, String)> = Vec::new();
                for f in files {
                    let path = f.get("path").and_then(|v| v.as_str())
                        .ok_or_else(|| "files 中的条目缺少 path".to_string())?;
                    let content = f.get("content").and_then(|v| v.as_str())
                        .ok_or_else(|| "files 中的条目缺少 content".to_string())?;
                    validate_path(path, false)?;
                    file_pairs.push((path.to_string(), content.to_string()));
                }
                if file_pairs.is_empty() {
                    return Err("files 数组为空".into());
                }
                write_new_file_batch(file_pairs)
            } else {
                let path = arg_str(args, "path")?;
                validate_path(path, false)?;
                let content = arg_str(args, "content")?;
                write_new_file(path, content)?;
                Ok(json!({"message": format!("文件已写入: {}", path)}))
            }
        }
        "edit_file" => {
            let path = arg_str(args, "path")?;
            validate_path(path, false)?;
            let old_text = arg_str(args, "old_text")?;
            let new_text = arg_str(args, "new_text")?;
            let replacements = edit_file(path, old_text, new_text)?;
            Ok(json!({"message": format!("完成替换，共 {} 处", replacements), "replacements": replacements}))
        }
        "create_directory" => {
            let path = arg_str(args, "path")?;
            validate_path(path, false)?;
            create_directory(path)?;
            Ok(json!({"message": format!("目录已创建: {}", path)}))
        }
        "list_directory" => {
            let path = arg_str(args, "path")?;
            validate_path(path, true)?;
            Ok(json!({"entries": list_directory(path)?}))
        }
        "rename_path" => {
            let old_path = arg_str(args, "old_path")?;
            validate_path(old_path, false)?;
            let new_path = arg_str(args, "new_path")?;
            validate_path(new_path, false)?;
            rename_path(old_path, new_path)?;
            Ok(json!({"message": format!("已重命名: {} -> {}", old_path, new_path)}))
        }
        "batch_rename" => {
            let operations = args.get("operations")
                .and_then(|v| v.as_array())
                .ok_or_else(|| "缺少 operations 参数，需要数组".to_string())?;
            let mut ops: Vec<(String, String)> = Vec::new();
            for op in operations {
                let old = op.get("old_path").and_then(|v| v.as_str())
                    .ok_or_else(|| "operations 中的条目缺少 old_path".to_string())?;
                let new = op.get("new_path").and_then(|v| v.as_str())
                    .ok_or_else(|| "operations 中的条目缺少 new_path".to_string())?;
                validate_path(old, false)?;
                validate_path(new, false)?;
                ops.push((old.to_string(), new.to_string()));
            }
            if ops.is_empty() {
                return Err("operations 数组为空".into());
            }
            batch_rename(ops)
        }
        "copy_path" => {
            let source = arg_str(args, "source")?;
            let destination = arg_str(args, "destination")?;
            validate_path(source, true)?;   // 源只读
            validate_path(destination, false)?; // 目标可写
            copy_path(source, destination)
        }
        "delete_path" => {
            // 检查是否批量删除
            if let Some(paths) = args.get("paths").and_then(|v| v.as_array()) {
                let mut path_list: Vec<String> = Vec::new();
                for p in paths {
                    let p_str = p.as_str().ok_or_else(|| "paths 中包含非字符串元素".to_string())?;
                    validate_path(p_str, false)?;
                    path_list.push(p_str.to_string());
                }
                if path_list.is_empty() {
                    return Err("paths 数组为空".into());
                }
                fs_delete_batch(path_list)
            } else {
                let path = arg_str(args, "path")?;
                validate_path(path, false)?;
                fs_delete(path)?;
                Ok(json!({"message": format!("已删除: {}", path)}))
            }
        }
        "search_files" => {
            let directory = arg_str(args, "directory")?;
            validate_path(directory, true)?;
            let pattern = arg_str(args, "pattern")?;
            let mode = args.get("mode").and_then(|v| v.as_str()).unwrap_or("name");
            let results = search_files(directory, pattern, mode)?;
            Ok(json!({"results": results, "count": results.len()}))
        }
        "download_file" => {
            // 检查是否批量下载
            if let Some(files) = args.get("files").and_then(|v| v.as_array()) {
                let mut file_pairs: Vec<(String, String)> = Vec::new();
                for f in files {
                    let url = f.get("url").and_then(|v| v.as_str())
                        .ok_or_else(|| "files 中的条目缺少 url".to_string())?;
                    let dest = f.get("destination").and_then(|v| v.as_str())
                        .ok_or_else(|| "files 中的条目缺少 destination".to_string())?;
                    validate_path(dest, false)?;
                    file_pairs.push((url.to_string(), dest.to_string()));
                }
                if file_pairs.is_empty() {
                    return Err("files 数组为空".into());
                }
                batch_download(file_pairs, app)
            } else {
                let url = arg_str(args, "url")?;
                let destination = arg_str(args, "destination")?;
                validate_path(destination, false)?;
                let result = download_file(url, destination, app)?;
                Ok(json!({"message": result}))
            }
        }
        "open_path" => {
            let path = arg_str(args, "path")?;
            validate_path(path, true)?;
            let result = open_path(path)?;
            Ok(json!({"message": result}))
        }
        "open_file" => {
            // 兼容旧名称
            let path = arg_str(args, "path")?;
            validate_path(path, true)?;
            let result = open_path(path)?;
            Ok(json!({"message": result}))
        }
        "run_command" => {
            let cmd = arg_str(args, "command")?;
            // 硬性护栏：拦截破坏性命令
            check_command_hard_barrier(cmd)?;
            let cwd = args.get("cwd").and_then(|v| v.as_str());
            let output = run_command(cmd, cwd)?;
            Ok(json!({"output": output}))
        }
        "fetch_url" => {
            let url = arg_str(args, "url")?;
            let method = args.get("method").and_then(|v| v.as_str()).unwrap_or("GET");
            let body = args.get("body").and_then(|v| v.as_str());
            let result = fetch_url(url, method, body)?;
            Ok(json!({"content": result}))
        }
        "clipboard_read" => {
            let text = clipboard_read()?;
            Ok(json!({"text": text}))
        }
        "clipboard_write" => {
            let text = arg_str(args, "text")?;
            clipboard_write(text)?;
            Ok(json!({"message": "已写入剪贴板"}))
        }
        "system_info" => {
            let info = system_info()?;
            Ok(info)
        }
        "system_get_languages" => {
            let languages = system_get_languages()?;
            Ok(json!({"languages": languages}))
        }
        "system_add_language" => {
            let language_tag = arg_str(args, "language_tag")?;
            let language_name = args.get("language_name").and_then(|v| v.as_str()).unwrap_or(language_tag);
            system_add_language(language_tag, language_name)?;
            Ok(json!({"message": format!("已添加语言: {} ({})", language_name, language_tag)}))
        }
        "get_env" => {
            let name = args.get("name").and_then(|v| v.as_str());
            let result = get_env(name)?;
            Ok(result)
        }
        "list_processes" => {
            let filter = args.get("name_filter").and_then(|v| v.as_str());
            let processes = list_processes(filter)?;
            Ok(json!({"processes": processes, "count": processes.len()}))
        }
        "list_windows" => {
            let windows = list_windows()?;
            Ok(json!({"windows": windows, "count": windows.len()}))
        }
        "capture_screen" => {
            let save_path = arg_str(args, "save_path")?;
            validate_path(save_path, false)?;
            capture_screen(save_path)?;
            Ok(json!({"message": format!("截图已保存: {}", save_path)}))
        }
        "system_notify" => {
            let title = arg_str(args, "title")?;
            let message = arg_str(args, "message")?;
            system_notify(title, message)?;
            Ok(json!({"message": "通知已发送"}))
        }
        "ask_user" => {
            // ask_user 是一个交互式工具，前端负责显示表单并收集用户输入。
            // Rust 端只需返回一个信号，前端会拦截此工具调用并展示 UI。
            let question = arg_str(args, "question")?;
            let q_type = args.get("type").and_then(|v| v.as_str()).unwrap_or("text");
            let options = args.get("options").and_then(|v| v.as_str()).unwrap_or("");
            let default_val = args.get("default").and_then(|v| v.as_str()).unwrap_or("");
            Ok(json!({
                "interactive": true,
                "question": question,
                "type": q_type,
                "options": options,
                "default": default_val,
            }))
        }
        // ═══════════════════════════════════════════════════════════
        //  批量文件操作
        // ═══════════════════════════════════════════════════════════
        "read_local_files" => {
            let paths = args.get("paths")
                .and_then(|v| v.as_array())
                .ok_or_else(|| "缺少 paths 参数，需要数组".to_string())?;
            let path_list: Vec<String> = paths.iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.to_string())
                .collect();
            if path_list.is_empty() {
                return Err("paths 数组为空或不包含有效字符串".into());
            }
            for p in &path_list {
                validate_path(p, true)?;
            }
            read_local_files(path_list)
        }
        "read_csv_as_json" => {
            let path = arg_str(args, "path")?;
            validate_path(path, true)?;
            let encoding = args.get("encoding").and_then(|v| v.as_str());
            read_csv_as_json(path, encoding)
        }
        "extract_archive" => {
            let path = arg_str(args, "path")?;
            validate_path(path, true)?;
            let target_dir = args.get("target_dir").and_then(|v| v.as_str());
            if let Some(d) = target_dir {
                validate_path(d, false)?;
            }
            extract_archive(path, target_dir)
        }
        "compress_files" => {
            let paths = args.get("paths")
                .and_then(|v| v.as_array())
                .ok_or_else(|| "缺少 paths 参数，需要数组".to_string())?;
            let path_list: Vec<String> = paths.iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.to_string())
                .collect();
            if path_list.is_empty() {
                return Err("paths 数组为空或不包含有效字符串".into());
            }
            let output = arg_str(args, "output")?;
            validate_path(output, false)?;
            compress_files(path_list, output)
        }
        // ═══════════════════════════════════════════════════════════
        //  Excel 数据处理
        // ═══════════════════════════════════════════════════════════
        "read_excel_as_json" => {
            let path = arg_str(args, "path")?;
            validate_path(path, true)?;
            let sheet_name = args.get("sheet_name").and_then(|v| v.as_str());
            read_excel_as_json(path, sheet_name)
        }
        "excel_query" => {
            let path = arg_str(args, "path")?;
            validate_path(path, true)?;
            let sheet = args.get("sheet").and_then(|v| v.as_str());
            let select = args.get("select").and_then(|v| v.as_str());
            let filter_col = args.get("filter_col").and_then(|v| v.as_str());
            let filter_val = args.get("filter_val").and_then(|v| v.as_str());
            let filter_like = args.get("filter_like").and_then(|v| v.as_str());
            let filter_in_raw = args.get("filter_in").and_then(|v| v.as_str());
            let filter_in: Option<Vec<String>> = filter_in_raw.map(|s| {
                serde_json::from_str::<Vec<String>>(s).unwrap_or_default()
            });
            let filter_gt = args.get("filter_gt").and_then(|v| v.as_str());
            let filter_lt = args.get("filter_lt").and_then(|v| v.as_str());
            let filter_logic = args.get("filter_logic").and_then(|v| v.as_str()).unwrap_or("and");
            let group_by = args.get("group_by").and_then(|v| v.as_str());
            let agg_col = args.get("agg_col").and_then(|v| v.as_str());
            let agg_func = args.get("agg_func").and_then(|v| v.as_str()).unwrap_or("count");
            let limit = args.get("limit").and_then(|v| v.as_str())
                .and_then(|s| s.parse::<usize>().ok()).unwrap_or(50);
            let offset = args.get("offset").and_then(|v| v.as_str())
                .and_then(|s| s.parse::<usize>().ok()).unwrap_or(0);
            let distinct = args.get("distinct").and_then(|v| v.as_str());

            excel_query(path, sheet, select, filter_col, filter_val, filter_like,
                filter_in.as_deref(), filter_gt, filter_lt, filter_logic,
                group_by, agg_col, agg_func, limit, offset, distinct)
        }
        "excel_summary" => {
            let path = arg_str(args, "path")?;
            validate_path(path, true)?;
            let sheet = args.get("sheet").and_then(|v| v.as_str());
            excel_summary(path, sheet)
        }
        "excel_transform" => {
            let path = arg_str(args, "path")?;
            validate_path(path, true)?;
            let source_col = arg_str(args, "source_col")?;
            let target_col = arg_str(args, "target_col")?;
            let regex = arg_str(args, "regex")?;
            let sheet = args.get("sheet").and_then(|v| v.as_str());
            let limit = args.get("limit").and_then(|v| v.as_str())
                .and_then(|s| s.parse::<usize>().ok()).unwrap_or(20);
            excel_transform(path, source_col, target_col, regex, sheet, limit)
        }
        "excel_dedup" => {
            let path = arg_str(args, "path")?;
            validate_path(path, true)?;
            let key_cols = arg_str(args, "key_cols")?;
            let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("count");
            let sheet = args.get("sheet").and_then(|v| v.as_str());
            let limit = args.get("limit").and_then(|v| v.as_str())
                .and_then(|s| s.parse::<usize>().ok()).unwrap_or(50);
            excel_dedup(path, key_cols, action, sheet, limit)
        }
        "excel_join" => {
            let left = arg_str(args, "left")?;
            validate_path(left, true)?;
            let left_key = arg_str(args, "left_key")?;
            let right = arg_str(args, "right")?;
            validate_path(right, true)?;
            let right_key = arg_str(args, "right_key")?;
            let left_sheet = args.get("left_sheet").and_then(|v| v.as_str());
            let right_sheet = args.get("right_sheet").and_then(|v| v.as_str());
            let left_key_extract = args.get("left_key_extract").and_then(|v| v.as_str());
            let right_key_extract = args.get("right_key_extract").and_then(|v| v.as_str());
            let join_type = args.get("join_type").and_then(|v| v.as_str()).unwrap_or("inner");
            let select = args.get("select").and_then(|v| v.as_str());
            let limit = args.get("limit").and_then(|v| v.as_str())
                .and_then(|s| s.parse::<usize>().ok()).unwrap_or(50);
            excel_join(left, left_key, right, right_key, left_sheet, right_sheet,
                left_key_extract, right_key_extract, join_type, select, limit)
        }
        "excel_union" => {
            let files = args.get("files")
                .and_then(|v| v.as_array())
                .ok_or_else(|| "缺少 files 参数，需要数组".to_string())?;
            let file_list: Vec<String> = files.iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.to_string())
                .collect();
            if file_list.is_empty() {
                return Err("files 数组为空或不包含有效字符串".into());
            }
            let output = arg_str(args, "output")?;
            validate_path(output, false)?;
            let sheet = args.get("sheet").and_then(|v| v.as_str()).unwrap_or("Sheet1");
            excel_union(&file_list, output, sheet)
        }
        "json_to_xlsx" => {
            let path = arg_str(args, "path")?;
            validate_path(path, false)?;
            let sheet = arg_str(args, "sheet")?;
            let data_json = arg_str(args, "data_json")?;
            let mode = args.get("mode").and_then(|v| v.as_str()).unwrap_or("overwrite");
            let overwrite = mode != "append";
            json_to_xlsx(path, sheet, data_json, overwrite)
        }
        "data_pipeline" => {
            let pipeline_json = arg_str(args, "pipeline_json")?;
            let limit = args.get("limit").and_then(|v| v.as_str())
                .and_then(|s| s.parse::<usize>().ok()).unwrap_or(50);
            data_pipeline(pipeline_json, limit)
        }
        _ => Err(format!("未知工具: {}", name)),
    }
}

fn arg_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .ok_or_else(|| format!("缺少 {} 参数", key))
}

// ─── 技能工具（动态加载自 workspace/skills/） ────────────

/// 从 workspace/skills/ 加载所有技能，转换为工具定义列表
pub fn get_skill_tools(app_handle: &tauri::AppHandle) -> Result<Vec<Value>, String> {
    let skills = workspace::list_files(app_handle, workspace::WorkspaceDir::Skills)?;
    let mut tools = Vec::new();

    for skill in &skills {
        let tool_name = skill.name.clone();
        if tool_name.is_empty() {
            continue; // 跳过未命名的技能
        }

        // 工具名称：只允许 ASCII 字母、数字、下划线、连字符（符合 ^[a-zA-Z0-9_-]+$）
        let safe_name: String = tool_name
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
            .collect();
        if safe_name.is_empty() {
            continue;
        }

        let desc = if skill.description.is_empty() {
            format!("执行技能「{}」", tool_name)
        } else {
            format!("[技能] {} — {}", tool_name, skill.description)
        };

        tools.push(json!({
            "name": format!("skill_{}", safe_name),
            "description": desc,
            "inputSchema": {
                "type": "object",
                "properties": {
                    "input": {
                        "type": "string",
                        "description": "传递给技能的任务输入或上下文。详细描述你想让这个技能帮你完成什么。"
                    }
                },
                "required": ["input"]
            }
        }));
    }

    Ok(tools)
}

/// 执行一个技能
///
/// 读取技能文件内容，将用户的 input 与技能定义合并返回给 AI。
pub fn execute_skill(app_handle: &tauri::AppHandle, name: &str, args: &Value) -> Result<Value, String> {
    // name 格式：skill_xxx 或直接 xxx
    let skill_name = name.strip_prefix("skill_").unwrap_or(name);

    let skills = workspace::list_files(app_handle, workspace::WorkspaceDir::Skills)?;
    let skill = skills.iter().find(|s| {
        let safe: String = s.name.chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
            .collect();
        safe == skill_name || s.name == skill_name
    }).ok_or_else(|| format!("未找到技能 '{}'", skill_name))?;

    let input = args.get("input")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // 返回技能内容 + 用户输入，AI 可以据此处理
    Ok(json!({
        "skill_name": skill.name,
        "skill_description": skill.description,
        "skill_content": skill.content,
        "user_input": input,
        "message": format!("已执行技能「{}」。技能定义内容已通过 skill_content 字段提供，请根据技能定义处理用户输入。", skill.name),
    }))
}
