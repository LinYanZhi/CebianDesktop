//! 本地工具实现
//!
//! 提供文件操作、系统查询、截图、通知等本地工具

use std::path::Path;
use std::sync::OnceLock;

use serde_json::{json, Value};

use crate::workspace;

mod file_ops;
mod system_ops;
mod net_ops;

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
    // 检查当前路径或父目录是否在黑名单中
    let path_lower = p.to_string_lossy().to_lowercase();
    for &blacklisted in PATH_BLACKLIST {
        if path_lower.starts_with(&blacklisted.to_lowercase()) {
            return Err(format!(
                "安全拦截：不允许写入系统关键目录「{}」。这是硬性限制，无法绕过。",
                blacklisted
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
        "write_new_file" | "edit_file" | "rename_path" | "system_add_language" 
        | "capture_screen" | "download_file" | "clipboard_write" => "medium",
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

    // 只读操作允许更宽松的路径（用户目录下的文件）
    if allow_read {
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
    }

    // 检查是否在任何一个安全目录下
    for dir_str in allowed {
        let dir = Path::new(dir_str);
        let dir_canonical = dir.canonicalize().map_err(|_| format!("安全目录无效: {}", dir_str))?;
        if check_path.starts_with(&dir_canonical) {
            return Ok(());
        }
    }

    Err(format!(
        "路径不在允许范围内（仅允许工作区目录和临时目录）: {}",
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
        td!("read_local_file",
            "读取本地文本文件的内容。返回文件全部文本。适用于读取源代码、配置文件、文档、日志等文本文件。\
             \n\n注意：路径必须是绝对路径（如 C:\\Users\\用户名\\Desktop\\test.txt）。不支持读取二进制文件（如图片、视频）。\
             \n\n适合场景：查看用户提到的文件内容、阅读代码、检查配置文件、查看日志等。",
            &[("path", "string", "要读取的文件绝对路径，例如 C:\\Users\\用户名\\Desktop\\note.txt")], ["path"]),

        td!("write_new_file",
            "写入内容到文件。如果文件已存在，会被覆盖；如果目录不存在，会自动创建。\
             \n\n安全限制：仅允许在工作区目录和临时目录下写入文件。路径必须是绝对路径。\
             \n\n适合场景：创建新文件、保存 AI 生成的内容、写入代码文件等。",
            &[("path", "string", "文件绝对路径，例如 C:\\Users\\用户名\\Documents\\report.md"), ("content", "string", "要写入的文件内容")], ["path", "content"]),

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
             \n\n适合场景：重命名文件、整理文件夹、移动项目文件到新位置。",
            &[("old_path", "string", "原路径（文件或目录的当前绝对路径）"), ("new_path", "string", "新路径（目标绝对路径）")], ["old_path", "new_path"]),

        td!("delete_path",
            "删除文件或目录。如果是目录，会递归删除其所有内容。\
             \n\n安全限制：仅允许删除工作区目录和临时目录下的文件和目录。\
             \n无法删除系统关键路径或用户工作区之外的路径。\
             \n警告：此操作不可撤销！删除目录会一并删除其所有子文件和子目录。\
             \n\n适合场景：清理不再需要的文件和目录、删除项目中的临时文件等。",
            &[("path", "string", "要删除的文件或目录的绝对路径")], ["path"]),

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
            "从 URL 下载文件到本地磁盘。支持任何可通过 HTTP/HTTPS 访问的文件。\
             \n\n适合场景：下载网络上的图片、安装包、文档等文件到本地保存。",
            &[("url", "string", "文件下载 URL"), ("destination", "string", "保存的本地绝对路径，例如 C:\\Users\\用户名\\Downloads\\file.pdf")], ["url", "destination"]),

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
pub fn execute_tool(name: &str, args: &Value) -> Result<Value, String> {
    match name {
        "read_local_file" => {
            let path = arg_str(args, "path")?;
            validate_path(path, true)?;
            Ok(json!({"content": read_local_file(path)?}))
        }
        "write_new_file" => {
            let path = arg_str(args, "path")?;
            validate_path(path, false)?;
            let content = arg_str(args, "content")?;
            write_new_file(path, content)?;
            Ok(json!({"message": format!("文件已写入: {}", path)}))
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
        "delete_path" => {
            let path = arg_str(args, "path")?;
            validate_path(path, false)?;
            fs_delete(path)?;
            Ok(json!({"message": format!("已删除: {}", path)}))
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
            let url = arg_str(args, "url")?;
            let destination = arg_str(args, "destination")?;
            validate_path(destination, false)?;
            let result = download_file(url, destination)?;
            Ok(json!({"message": result}))
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
