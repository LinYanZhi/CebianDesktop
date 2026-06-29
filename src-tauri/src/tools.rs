//! 本地工具实现
//!
//! 提供文件操作、系统查询、截图、通知等本地工具

use std::fs;
use std::io::Read;
use std::path::Path;
use std::process::Command;

use serde_json::{json, Value};
use walkdir::WalkDir;

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
             \n\n注意：路径必须是绝对路径。写入文本内容，适合创建新文件或完全替换文件内容。如需部分修改请使用 edit_file 工具。\
             \n\n适合场景：创建新文件、保存 AI 生成的内容、写入代码文件等。",
            &[("path", "string", "文件绝对路径，例如 C:\\Users\\用户名\\Documents\\report.md"), ("content", "string", "要写入的文件内容")], ["path", "content"]),

        td!("edit_file",
            "精确查找并替换文件中的指定文本。这是部分修改文件内容的工具，不会影响文件的其他部分。\
             \n\n注意：old_text 必须完全匹配文件中的内容（区分大小写）。如果有多处匹配，会全部替换。\
             \n\n适合场景：修改配置文件中的某个值、替换代码中的变量名、更新版本号等局部修改。如需整体重写请使用 write_new_file。",
            &[("path", "string", "文件绝对路径"), ("old_text", "string", "要被替换的现有文本（区分大小写，需完全匹配）"), ("new_text", "string", "替换后的新文本")], ["path", "old_text", "new_text"]),

        // ═══════════════════════════════════════════════════════════
        //  目录操作
        // ═══════════════════════════════════════════════════════════
        td!("list_directory",
            "列出指定目录下的文件和子目录。返回每个条目的名称、类型（文件/目录），按目录优先、名称排序。\
             \n\n注意：不会递归列出子目录的内容。如需递归搜索请使用 search_files 工具。路径必须是绝对目录路径。\
             \n\n适合场景：查看文件夹内容、浏览目录结构、确认文件是否存在等。",
            &[("path", "string", "要列出的目录绝对路径，例如 C:\\Users\\用户名\\Desktop")], ["path"]),

        td!("create_directory",
            "创建一个或多个目录。会递归创建所有不存在的父目录。\
             \n\n注意：如果目录已存在，不会报错（幂等操作）。路径必须是绝对路径。\
             \n\n适合场景：为项目创建目录结构、创建输出文件夹等。",
            &[("path", "string", "要创建的目录绝对路径，例如 D:\\Projects\\my-app\\src")], ["path"]),

        td!("rename_path",
            "重命名或移动文件/目录。可以用于重命名文件，或将文件/目录移动到新位置。\
             \n\n注意：如果目标位置的父目录不存在，会自动创建。如果目标已存在，行为取决于操作系统（可能覆盖或报错）。\
             \n\n适合场景：重命名文件、整理文件夹、移动项目文件到新位置。",
            &[("old_path", "string", "原路径（文件或目录的当前绝对路径）"), ("new_path", "string", "新路径（目标绝对路径）")], ["old_path", "new_path"]),

        td!("delete_path",
            "删除文件或目录。如果是目录，会递归删除其所有内容。\
             \n\n警告：此操作不可撤销！删除目录会一并删除其所有子文件和子目录。\
             \n\n适合场景：清理不需要的文件、删除临时目录、移除旧项目等。",
            &[("path", "string", "要删除的文件或目录的绝对路径")], ["path"]),

        td!("search_files",
            "按文件名或文件内容搜索文件。支持递归搜索子目录，最大深度 10 层，最多返回 50 条结果。\
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
             \n\n在 Windows 上使用 cmd.exe，在 macOS/Linux 上使用 sh。可以指定工作目录。\
             \n\n注意：\
             \n- 命令在用户系统上实际执行，请谨慎操作（尤其是删除、格式化等危险命令）\
             \n- 交互式命令（如需要用户输入）会挂起，应避免使用\
             \n- 返回 stdout 和 stderr 的输出\
             \n\n适合场景：运行 git 命令、执行构建脚本、查询系统状态、启动程序等。",
            &[("command", "string", "要执行的命令，例如 dir 或 git status"), ("cwd", "string", "工作目录（可选，不指定则使用应用默认目录）")], ["command"]),

        td!("system_notify",
            "发送系统桌面通知。会在用户的操作系统通知区域显示一条通知消息。\
             \n\n适合场景：通知用户任务完成、提醒重要事件、后台任务结束时提醒等。",
            &[("title", "string", "通知标题（简短，如「下载完成」）"), ("message", "string", "通知正文内容")], ["title", "message"]),

        td!("system_info",
            "获取计算机的完整系统信息。包括：\
             \n- 操作系统类型和架构\
             \n- 主机名和用户名\
             \n- CPU 型号和核心数\
             \n- 内存总量和已用量\
             \n- 所有磁盘（硬盘）的容量和可用空间\
             \n\n适合场景：了解用户电脑配置、检查磁盘空间、确认操作系统类型等。",
            &[], []),

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
             \n\n你可以：\
             \n- 一次展示多个字段（questions 数组），构成完整表单\
             \n- 为表单添加 title 和 description\
             \n- 为每个字段设置 required、placeholder、message 辅助文字\
             \n- 为选择字段设置 options（每个含 label、value、description、recommended）\
             \n\nquestion 是旧版单字段模式的参数，新用法请使用 questions 数组。\
             \n每个 question 对象需要 id（唯一键名）和 question（显示文本）。",
            &[
                ("title", "string", "（可选）表单标题，多字段时建议提供"),
                ("description", "string", "（可选）表单说明文字"),
                ("submit_label", "string", "（可选）提交按钮文字，默认「提交」"),
                ("questions", "string", "（推荐）JSON 字符串，字段数组。每个元素包含 id（唯一键名）、question（问题文本）、type（可选，text/textarea/confirm/single_select/multi_select/dropdown）、options（可选，选择类型的选项数组）、required（可选，是否必填）、placeholder（可选）、message（可选，辅助说明）、allow_free_text（可选）、min_select（可选）、max_select（可选）"),
                ("question", "string", "（旧版，单字段时使用）向用户提出的问题"),
                ("type", "string", "（旧版，仅配合 question 使用）问题类型：text / confirm / select"),
                ("options", "string", "（旧版，仅配合 question+select 使用）JSON 选项数组"),
            ], []),

        // ═══════════════════════════════════════════════════════════
        //  技能管理
        // ═══════════════════════════════════════════════════════════
        td!("skill_list",
            "列出工作区中所有已安装的技能。返回每个技能的名称、描述、文件名和更新时间。\
             \n\n适合场景：查看有哪些可用技能、获取技能列表供用户选择。",
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
            "从工作区中彻底删除一个技能文件。注意：此操作不可撤销。",
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
            Ok(json!({"content": read_local_file(path)?}))
        }
        "write_new_file" => {
            let path = arg_str(args, "path")?;
            let content = arg_str(args, "content")?;
            write_new_file(path, content)?;
            Ok(json!({"message": format!("文件已写入: {}", path)}))
        }
        "edit_file" => {
            let path = arg_str(args, "path")?;
            let old_text = arg_str(args, "old_text")?;
            let new_text = arg_str(args, "new_text")?;
            let replacements = edit_file(path, old_text, new_text)?;
            Ok(json!({"message": format!("完成替换，共 {} 处", replacements), "replacements": replacements}))
        }
        "create_directory" => {
            let path = arg_str(args, "path")?;
            create_directory(path)?;
            Ok(json!({"message": format!("目录已创建: {}", path)}))
        }
        "list_directory" => {
            let path = arg_str(args, "path")?;
            Ok(json!({"entries": list_directory(path)?}))
        }
        "rename_path" => {
            let old_path = arg_str(args, "old_path")?;
            let new_path = arg_str(args, "new_path")?;
            rename_path(old_path, new_path)?;
            Ok(json!({"message": format!("已重命名: {} -> {}", old_path, new_path)}))
        }
        "delete_path" => {
            let path = arg_str(args, "path")?;
            fs_delete(path)?;
            Ok(json!({"message": format!("已删除: {}", path)}))
        }
        "search_files" => {
            let directory = arg_str(args, "directory")?;
            let pattern = arg_str(args, "pattern")?;
            let mode = args.get("mode").and_then(|v| v.as_str()).unwrap_or("name");
            let results = search_files(directory, pattern, mode)?;
            Ok(json!({"results": results, "count": results.len()}))
        }
        "download_file" => {
            let url = arg_str(args, "url")?;
            let destination = arg_str(args, "destination")?;
            let result = download_file(url, destination)?;
            Ok(json!({"message": result}))
        }
        "open_path" => {
            let path = arg_str(args, "path")?;
            let result = open_path(path)?;
            Ok(json!({"message": result}))
        }
        "open_file" => {
            // 兼容旧名称
            let path = arg_str(args, "path")?;
            let result = open_path(path)?;
            Ok(json!({"message": result}))
        }
        "run_command" => {
            let cmd = arg_str(args, "command")?;
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

// ─── 文件读写 ──────────────────────────────────────────

fn read_local_file(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if !p.exists() { return Err(format!("文件不存在: {}", path)); }
    fs::read_to_string(p).map_err(|e| format!("读取失败: {}", e))
}

fn write_new_file(path: &str, content: &str) -> Result<(), String> {
    let p = Path::new(path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(p, content).map_err(|e| format!("写入失败: {}", e))
}

fn edit_file(path: &str, old_text: &str, new_text: &str) -> Result<usize, String> {
    let original = read_local_file(path)?;
    if !original.contains(old_text) {
        return Err("文件中未找到要替换的文本".into());
    }
    let edited = original.replace(old_text, new_text);
    // 统计替换数
    let count = original.matches(old_text).count();
    write_new_file(path, &edited)?;
    Ok(count)
}

// ─── 目录操作 ───────────────────────────────────────────

fn create_directory(path: &str) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("创建目录失败: {}", e))
}

fn list_directory(path: &str) -> Result<Vec<Value>, String> {
    let dir = Path::new(path);
    if !dir.is_dir() { return Err(format!("不是目录: {}", path)); }
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("读取目录失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
        let ft = entry.file_type().map_err(|e| format!("获取类型失败: {}", e))?;
        let name = entry.file_name().to_string_lossy().to_string();
        entries.push(json!({
            "name": name,
            "is_dir": ft.is_dir(),
            "is_file": ft.is_file(),
        }));
    }
    entries.sort_by(|a, b| {
        let an = a["name"].as_str().unwrap_or("");
        let bn = b["name"].as_str().unwrap_or("");
        // 目录优先
        let a_dir = a["is_dir"].as_bool().unwrap_or(false);
        let b_dir = b["is_dir"].as_bool().unwrap_or(false);
        b_dir.cmp(&a_dir).then(an.to_lowercase().cmp(&bn.to_lowercase()))
    });
    Ok(entries)
}

fn rename_path(old_path: &str, new_path: &str) -> Result<(), String> {
    if !Path::new(old_path).exists() { return Err(format!("路径不存在: {}", old_path)); }
    if let Some(parent) = Path::new(new_path).parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
    }
    fs::rename(old_path, new_path).map_err(|e| format!("重命名失败: {}", e))
}

fn fs_delete(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.exists() { return Err(format!("路径不存在: {}", path)); }
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| format!("删除目录失败: {}", e))
    } else {
        fs::remove_file(p).map_err(|e| format!("删除文件失败: {}", e))
    }
}

fn search_files(directory: &str, pattern: &str, mode: &str) -> Result<Vec<Value>, String> {
    let dir = Path::new(directory);
    if !dir.is_dir() { return Err(format!("不是目录: {}", directory)); }

    let mut results = Vec::new();
    let pattern_lower = pattern.to_lowercase();
    let max_results = 50;

    for entry in WalkDir::new(dir).max_depth(10).into_iter().filter_map(|e| e.ok()) {
        if results.len() >= max_results { break; }
        let path = entry.path();
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_lowercase();

        match mode {
            "content" => {
                if entry.file_type().is_file() {
                    if let Ok(content) = fs::read_to_string(path) {
                        let content_lower = content.to_lowercase();
                        if content_lower.contains(&pattern_lower) {
                            // 找到关键词所在行
                            let matched_lines: Vec<String> = content
                                .lines()
                                .filter(|l| l.to_lowercase().contains(&pattern_lower))
                                .take(3)
                                .map(|l| l.trim().to_string())
                                .collect();
                            results.push(json!({
                                "path": path.display().to_string(),
                                "matched_lines": matched_lines,
                            }));
                        }
                    }
                }
            }
            _ => {
                // "name" 模式
                if name.contains(&pattern_lower) {
                    results.push(json!({
                        "path": path.display().to_string(),
                        "is_dir": entry.file_type().is_dir(),
                    }));
                }
            }
        }
    }
    Ok(results)
}

// ─── 下载 ────────────────────────────────────────────────

fn download_file(url: &str, destination: &str) -> Result<String, String> {
    let resp = ureq::get(url).call().map_err(|e| format!("下载失败: {}", e))?;
    let mut body: Vec<u8> = Vec::new();
    resp.into_reader().read_to_end(&mut body).map_err(|e| format!("读取响应失败: {}", e))?;
    let dest = Path::new(destination);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    fs::write(dest, &body).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(format!("已下载到: {}", destination))
}

// ─── 打开 ────────────────────────────────────────────────

fn open_path(path: &str) -> Result<String, String> {
    if !Path::new(path).exists() { return Err(format!("路径不存在: {}", path)); }
    Command::new("cmd").args(["/C", "start", "", path])
        .spawn().map_err(|e| format!("打开失败: {}", e))?;
    Ok(format!("已打开: {}", path))
}

// ─── 命令执行 ────────────────────────────────────────────

fn run_command(cmd: &str, cwd: Option<&str>) -> Result<String, String> {
    let shell = if cfg!(windows) { "cmd" } else { "sh" };
    let shell_arg = if cfg!(windows) { "/C" } else { "-c" };

    let mut command = Command::new(shell);
    command.args([shell_arg, cmd]);

    if let Some(dir) = cwd {
        command.current_dir(dir);
    }

    let output = command.output().map_err(|e| format!("执行失败: {}", e))?;

    let mut result = String::new();
    if !output.stdout.is_empty() {
        result.push_str(&String::from_utf8_lossy(&output.stdout));
    }
    if !output.stderr.is_empty() {
        if !result.is_empty() { result.push('\n'); }
        result.push_str("STDERR:\n");
        result.push_str(&String::from_utf8_lossy(&output.stderr));
    }

    Ok(result.trim().to_string())
}

// ─── 网络请求 ────────────────────────────────────────────

fn fetch_url(url: &str, method: &str, body: Option<&str>) -> Result<String, String> {
    let resp = match method.to_uppercase().as_str() {
        "POST" => {
            ureq::post(url)
                .set("Content-Type", "application/json")
                .send_string(body.unwrap_or(""))
                .map_err(|e| format!("请求失败: {}", e))?
        }
        _ => {
            ureq::get(url).call().map_err(|e| format!("请求失败: {}", e))?
        }
    };
    resp.into_string().map_err(|e| format!("读取响应失败: {}", e))
}

// ─── 剪贴板 ──────────────────────────────────────────────

fn clipboard_read() -> Result<String, String> {
    clipboard_win::get_clipboard_string().map_err(|e| format!("读取剪贴板失败: {}", e))
}

fn clipboard_write(text: &str) -> Result<(), String> {
    let _clip = clipboard_win::Clipboard::new().map_err(|e| format!("打开剪贴板失败: {}", e))?;
    clipboard_win::set_clipboard_string(text).map_err(|e| format!("写入剪贴板失败: {}", e))
}

// ─── 系统信息 ────────────────────────────────────────────

fn system_info() -> Result<Value, String> {
    use sysinfo::System;

    let os_info = format!("{} {}", std::env::consts::OS, std::env::consts::ARCH);
    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "未知".into());

    let mut sys = System::new_all();
    sys.refresh_all();

    // CPU
    let cpu_count = sys.cpus().len();
    let cpu_name = sys.cpus().first().map(|c| c.brand().to_string()).unwrap_or_else(|| "未知".into());

    // 内存
    let total_mem_gb = sys.total_memory() as f64 / (1024.0 * 1024.0 * 1024.0);
    let used_mem_gb = sys.used_memory() as f64 / (1024.0 * 1024.0 * 1024.0);

    // 磁盘
    let mut disks = Vec::new();
    for disk in sysinfo::Disks::new_with_refreshed_list().list() {
        let total_gb = disk.total_space() as f64 / (1024.0 * 1024.0 * 1024.0);
        let avail_gb = disk.available_space() as f64 / (1024.0 * 1024.0 * 1024.0);
        disks.push(json!({
            "mount": disk.mount_point().display().to_string(),
            "name": disk.name().to_string_lossy(),
            "total_gb": format!("{:.1}", total_gb),
            "available_gb": format!("{:.1}", avail_gb),
        }));
    }

    Ok(json!({
        "os": os_info,
        "hostname": hostname,
        "cpu": { "name": cpu_name, "cores": cpu_count },
        "memory": { "total_gb": format!("{:.1}", total_mem_gb), "used_gb": format!("{:.1}", used_mem_gb) },
        "disks": disks,
        "username": std::env::var("USERNAME").unwrap_or_default(),
        "computer_name": std::env::var("COMPUTERNAME").unwrap_or_default(),
    }))
}

// ─── 进程列表 ────────────────────────────────────────────

fn list_processes(name_filter: Option<&str>) -> Result<Vec<Value>, String> {
    use sysinfo::System;
    let mut sys = System::new_all();
    sys.refresh_all();

    let filter_lower = name_filter.map(|f| f.to_lowercase());
    let mut results = Vec::new();

    for (pid, proc) in sys.processes() {
        let name = proc.name().to_string_lossy().to_string();
        if let Some(ref f) = filter_lower {
            if !name.to_lowercase().contains(f) { continue; }
        }
        let mem_mb = proc.memory() as f64 / (1024.0 * 1024.0);
        let cpu_pct = proc.cpu_usage();
        results.push(json!({
            "pid": pid.as_u32(),
            "name": name,
            "memory_mb": format!("{:.1}", mem_mb),
            "cpu_percent": format!("{:.1}", cpu_pct),
        }));
    }

    results.sort_by(|a, b| {
        let am = a["memory_mb"].as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
        let bm = b["memory_mb"].as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);
        bm.partial_cmp(&am).unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(results.into_iter().take(40).collect())
}

// ─── 窗口列表 ────────────────────────────────────────────

fn list_windows() -> Result<Vec<Value>, String> {
    // PowerShell 获取有标题的窗口
    let ps_script = r#"
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Win {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWinProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    public delegate bool EnumWinProc(IntPtr hWnd, IntPtr lParam);
}
"@
$windows = @()
$callback = [Win+EnumWinProc]{
    param($hWnd, $lParam)
    if ([Win]::IsWindowVisible($hWnd)) {
        $sb = New-Object System.Text.StringBuilder(256)
        [Win]::GetWindowText($hWnd, $sb, 256)
        $title = $sb.ToString()
        if ($title.Length -gt 0) {
            $windows += @{title=$title;hwnd=$hWnd.ToString()}
        }
    }
    return $true
}
[Win]::EnumWindows($callback, [IntPtr]::Zero)
$windows | ConvertTo-Json
"#;

    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", ps_script])
        .output()
        .map_err(|e| format!("获取窗口列表失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if stdout.trim().is_empty() {
        return Ok(Vec::new());
    }

    let windows: Vec<Value> = serde_json::from_str(&stdout).unwrap_or_default();
    Ok(windows.into_iter().take(30).collect())
}

// ─── 截屏 ────────────────────────────────────────────────

fn capture_screen(save_path: &str) -> Result<(), String> {
    if !save_path.to_lowercase().ends_with(".png") {
        return Err("截图格式仅支持 PNG，路径必须以 .png 结尾".into());
    }
    if let Some(parent) = Path::new(save_path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
    }

    let ps_script = format!(r#"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bounds = $screen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$g.Dispose()
$bmp.Save('{}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"#, save_path.replace("'", "''"));

    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &ps_script])
        .output()
        .map_err(|e| format!("截图失败: {}", e))?;

    if output.status.success() && Path::new(save_path).exists() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("截图失败: {}", stderr.trim()))
    }
}

// ─── 系统通知 ────────────────────────────────────────────

fn system_notify(title: &str, message: &str) -> Result<(), String> {
    notify_rust::Notification::new()
        .summary(title)
        .body(message)
        .appname("CebianDesktop")
        .show()
        .map_err(|e| format!("发送通知失败: {}", e))?;
    Ok(())
}

// ─── 技能工具（动态加载自 workspace/skills/） ────────────

use crate::workspace;

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
