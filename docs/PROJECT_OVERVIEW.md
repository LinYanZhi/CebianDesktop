# CeBianDesktop 项目概览

> 本文档帮助下一个 AI 快速理解项目结构、架构和关键代码位置。

## 一、项目定位

**CeBianDesktop** 是 Cebian 浏览器扩展的桌面版实现。它是一个**桌面 AI 助手**——用户在聊天界面中与 AI 对话，AI 通过内置工具直接操作用户的电脑（读写文件、执行命令、截图等）。

关键区别：
| 维度 | CeBianDesktop | Cebian（浏览器扩展） |
|------|:-:|:-:|
| 运行环境 | 原生桌面 (Tauri) | 浏览器侧面板 |
| 文件系统 | 真实磁盘 | 虚拟 VFS (IndexedDB) |
| 系统交互 | 命令执行、窗口/进程管理 | 无 |
| 浏览器能力 | 无 | 页面交互、Chrome API |

---

## 二、技术栈

| 分层 | 技术 | 版本/说明 |
|------|------|-----------|
| **前端框架** | React 18 + TypeScript 5 | Vite 5 构建 |
| **桌面框架** | Tauri 2.x | Rust 后端 + WebView 前端 |
| **样式** | Tailwind CSS 3 + PostCSS | HSL CSS 变量主题系统 |
| **状态管理** | React hooks (useState/useRef) | 无外部状态库 |
| **编辑器** | CodeMirror 6 | Markdown/JS/YAML 语法高亮 |
| **Markdown** | react-markdown + rehype-highlight + remark-gfm | 聊天消息渲染 |
| **图表/图标** | Lucide React | 全部使用图标组件 |
| **通知** | Sonner | toast 通知 |
| **Rust CLI** | ureq, serde_json, tokio, axum, winreg, etc. | 见 Cargo.toml |

---

## 三、目录结构详解

```
CebianDesktop/
├── src/                              # ⬅ 前端（React）
│   ├── main.tsx                      # 入口，挂载 React + I18n + Toaster
│   ├── App.tsx                       # ⭐ 核心：状态管理、流式对话、工具调用循环
│   ├── index.css                     # Tailwind + CSS 变量（深色/浅色主题）
│   │
│   ├── components/
│   │   ├── chat/
│   │   │   ├── ChatView.tsx          # 对话视图（消息列表 + 回底按钮 + 二次确认弹窗）
│   │   │   ├── ChatInput.tsx         # 输入栏（多行输入 + 语音 + 附件 + 模型选择）
│   │   │   ├── MessageBlock.tsx      # 消息渲染（Markdown + 思考块 + 代码高亮）
│   │   │   ├── ToolCall.tsx          # 工具调用卡片（可折叠显示工具调用过程）
│   │   │   ├── AskUser.tsx           # ask_user 交互式表单（紧凑/表单/分步向导）
│   │   │   ├── useStickToBottom.ts   # ⭐ 滚动跟随 hook（自动回底 + ResizeObserver）
│   │   │   ├── ModelSelector.tsx     # 模型选择 + 思考级别选择器
│   │   │   ├── SessionList.tsx       # 会话列表（历史面板）
│   │   │   └── chat-types.tsx        # 公用小组件（CopyButton, generateId）
│   │   │
│   │   ├── editor/
│   │   │   └── CodeMirrorEditor.tsx  # CodeMirror 6 编辑器组件
│   │   │
│   │   └── settings/
│   │       ├── SettingsView.tsx       # 设置页（侧边导航 + 自适应布局）
│   │       └── sections/
│   │           ├── ProvidersSection.tsx    # AI 提供商配置
│   │           ├── PermissionSection.tsx   # ⭐ AI 权限模式（保守/平衡/信任/自定义）
│   │           ├── InstructionsSection.tsx  # 系统提示词
│   │           ├── PromptsSection.tsx       # 斜杠提示词管理
│   │           ├── SkillsSection.tsx        # ⭐ 技能编辑器（CodeMirror + 文件树）
│   │           ├── MCPSection.tsx           # MCP 服务配置
│   │           ├── BackupSection.tsx        # 备份与恢复
│   │           ├── StorageSection.tsx       # 文件系统管理
│   │           ├── AdvancedSection.tsx      # 高级设置
│   │           ├── AppearanceSection.tsx    # 外观（主题色 + 暗色/亮色模式）
│   │           └── AboutSection.tsx         # 关于
│   │
│   └── lib/
│       ├── types.ts                 # ⭐ 核心类型（ChatMessage, AIConfig, ToolCall 等）
│       ├── commands.ts              # Tauri IPC 命令封装（invoke + listen）
│       ├── db.ts                    # 配置/对话/主题的持久化（通过 Rust invoke）
│       ├── constants.ts             # 默认值 + 工具导出标签
│       ├── workspace.ts             # 工作区文件操作封装
│       ├── prompts.ts               # 斜杠提示词管理 + 模板变量替换
│       ├── compact.ts               # 上下文压缩（长对话摘要）
│       ├── utils.ts                 # 工具函数（yieldToUI, parseAskUserArgs 等）
│       ├── i18n.tsx                 # 国际化（中/英）
│       ├── mcp.ts                   # MCP 客户端
│       └── useSpeechRecognition.ts  # Web Speech API 语音输入
│
├── src-tauri/                       # ⬅ 后端（Rust）
│   ├── src/
│   │   ├── main.rs                  # 入口（windows_subsystem, 调用 lib::run）
│   │   ├── lib.rs                   # ⭐ Tauri Builder 设置 + 命令注册
│   │   │
│   │   ├── commands/
│   │   │   ├── mod.rs               # 命令路由（导出所有子模块）
│   │   │   ├── tools.rs             # ⭐ 工具管理（execute_tool, 二次确认系统）
│   │   │   ├── ai.rs                # AI 调用命令（call_ai, call_ai_streaming）
│   │   │   ├── config.rs            # 配置管理命令
│   │   │   ├── mcp.rs               # MCP 服务器管理命令
│   │   │   ├── misc.rs              # 杂项命令（备份等）
│   │   │   └── workspace.rs         # 工作区文件命令
│   │   │
│   │   ├── tools/
│   │   │   ├── mod.rs               # ⭐ 工具核心（风险等级、路径校验、ALLOWED_DIRS）
│   │   │   ├── file_ops.rs          # 文件操作工具（read/write/edit/delete/rename/search）
│   │   │   ├── system_ops.rs        # 系统工具（命令执行、系统信息、进程/窗口、截图）
│   │   │   └── net_ops.rs           # 网络工具（HTTP 请求、文件下载）
│   │   │
│   │   ├── ai.rs                    # ⭐ LLM 客户端（流式 + 非流式、SSE 解析、工具调用循环）
│   │   ├── config_storage.rs        # 配置读写（config.json, conversations.json, prompts）
│   │   ├── mcp_client.rs            # MCP 客户端管理器
│   │   ├── server.rs                # MCP HTTP 服务（axum）
│   │   └── workspace/               # 工作区文件管理
│   │       ├── mod.rs, types.rs     # 文件类型定义
│   │       ├── crud.rs, ops.rs      # 文件 CRUD 操作
│   │       ├── path.rs, md.rs       # 路径解析、Markdown 元数据
│   │       ├── zip.rs, backup.rs    # 压缩、备份恢复
│   │       └── watcher.rs           # 文件系统监听
│   │
│   ├── tauri.conf.json              # Tauri 配置（窗口、bundle、安全）
│   └── Cargo.toml                   # Rust 依赖
│
├── scripts/
│   └── dev.js                       # ⭐ 开发启动脚本（动态端口 + Tauri dev）
├── docs/
│   ├── BUILTIN_TOOLS.md             # 内置工具清单（vs Cebian 浏览器版）
│   └── PROJECT_OVERVIEW.md          # ⬅ 本文档
├── index.html                       # HTML 入口
├── vite.config.ts                   # Vite 配置
├── tailwind.config.js               # Tailwind 配置
├── tsconfig.json                    # TypeScript 配置
├── package.json                     # 前端项目配置
└── postcss.config.js                # PostCSS 配置
```

---

## 四、架构设计

### 4.1 前后端分离

```
┌─────────────────────────────────────────────────────────┐
│                 前端 (React + Vite)                       │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────────┐ │
│  │ App.tsx  │  │ ChatView  │  │ PermissionSection     │ │
│  │ (状态)   │  │ (消息展示) │  │ (权限设置)            │ │
│  └────┬─────┘  └──────────┘  └───────────────────────┘ │
│       │                                                
│  invoke("execute_tool", {name, args}) ← Tauri IPC ──┐  │
│  invoke("save_app_config", {config})                  │  │
│  invoke("call_ai", {config, messages})                │  │
└─────────────────────────────────────────────────────────┘
        │ IPC (JSON)
        ▼
┌─────────────────────────────────────────────────────────┐
│               后端 (Tauri/Rust)                          │
│  commands/      tools/          ai.rs                    │
│  ├── tools.rs   ├── mod.rs      ├── call_llm()          │
│  ├── config.rs  ├── file_ops    ├── call_llm_streaming  │
│  ├── ai.rs      ├── system_ops  └── execute_tool_call() │
│  └── mcp.rs     └── net_ops                             │
└─────────────────────────────────────────────────────────┘
```

**关键通信方式**：
- **IPC 调用**：前端通过 `invoke("command_name", args)` 调用 Rust 端 `#[tauri::command]` 函数
- **事件监听**：后端通过 `app_handle.emit("event_name", payload)` 推送事件，前端用 `listen("event_name", handler)` 接收
- **流式通信**：`call_ai_streaming` 通过 `ai:token`、`ai:thinking`、`ai:tool_call`、`ai:done` 等事件推送

### 4.2 两个并存的 AI 调用路径

| 路径 | 位置 | 用途 |
|------|------|------|
| **前端驱动** | `App.tsx` → `fetch(stream)` + `executeTool` | 当前主要路径 |
| **后端驱动** | `ai.rs` → `call_llm_streaming` + 事件推送 | 备用路径（功能较简单） |

**前端驱动路径**（`App.tsx` `handleSend` 函数）：
1. 前端直接 `fetch` AI API 的流式 endpoint
2. 解析 SSE 获取 token、思考过程、工具调用
3. 检测到工具调用 → 前端 `invoke("execute_tool")` 执行
4. 处理 `needs_confirmation`（二次确认）
5. 把工具结果加入消息列表 → 再次 `fetch` AI API（下一轮）
6. 最多 10 轮工具调用

---

## 五、核心数据流

### 5.1 发送消息流

```
用户输入 → ChatInput → onSend(content)
  → App.handleSend()
  → 1. 构造 userMsg 加入 messages state
  → 2. 添加 placeholder assistant msg（显示 loading）
  → 3. fetch AI API (streaming)
  → 4. SSE 解析 → delta.content → setMessages（逐 token 更新 UI）
                → delta.tool_calls → accumulate in toolCallMap
  → 5. SSE 结束 → 检查 toolCallMap
     ├─ 无工具调用 → 最终消息 + 保存对话 + 完成 ✅
     └─ 有工具调用 →
        → assistantMsg 加入历史
        → 遍历每个 tool_call:
          ├─ ask_user → showInteractiveForm → await response
          └─ 其他 → invoke("execute_tool")
             └─ result.needs_confirmation → showConfirmation → confirm/cancel
        → tool results 加入历史
        → goto step 3（下一轮）
  → 最多 10 轮
```

### 5.2 流式状态管理

`App.tsx` 使用 `activeStreamsRef: Map<string, StreamState>` 管理多会话并发流：

```typescript
interface StreamState {
  controller: AbortController;     // 用于中止流
  persistTimer: Timer | null;      // 定时持久化（每800ms）
  sessionId: string;               // 会话ID
  prevMessages: ChatMessage[];     // 流开始前的消息
  fullContent: string;             // 累积文本
  fullThinking: string;            // 累积思考过程
  usage?: { input, output };       // token用量
}
```

---

## 六、安全模型

### 6.1 三级权限模式

定义在 `PermissionSection.tsx` 和 `commands/tools.rs`：

```
conservative → 中风险+需确认（默认）
balanced     → 仅高风险需确认
trusted      → 全自动执行
custom       → 逐工具设置 allow/confirm/deny
```

风险等级定义在 `tools/mod.rs` `get_tool_risk_level()`：
- **high**: `delete_path`, `run_command`, `skill_delete`
- **medium**: `write_new_file`, `edit_file`, `rename_path`, `download_file`, `capture_screen`, `clipboard_write`, `system_add_language`
- **safe**: 其余所有

### 6.2 硬性安全护栏

定义在 `tools/mod.rs`，**始终有效**，不受权限模式影响：

| 护栏 | 说明 |
|------|------|
| **路径黑名单** | 禁止写入 `C:\Windows`、`Program Files`、`ProgramData` 等系统目录 |
| **命令黑名单** | 拦截 `format`、`rm -rf /`、`diskpart`、`reg delete`、`shutdown` 等 30+ 破坏性命令 |
| **安全组件防护** | 禁止禁用 Windows Defender / UAC |
| **路径沙箱** | 文件写入仅限工作区 + 临时目录 + 桌面/下载/文档 |

### 6.3 路径沙箱（`validate_path`）

关键代码位置：`tools/mod.rs` `init_allowed_dirs()` + `validate_path()`

初始化时注册的允许目录（`ALLOWED_DIRS`）：
1. **工作区根目录**（`workspace/` 的父目录）
2. **系统临时目录**（`%TEMP%`）
3. **用户目录**：`Desktop`、`Downloads`、`Documents`

`validate_path` 检查流程：
```
path → check_path_hard_barrier (系统目录？拦截)
     → canonicalize (解析符号链接)
     → 检查是否在 ALLOWED_DIRS 内
     → 通过 ✅ / 拒绝 ❌
```

---

## 七、工具系统

### 7.1 工具注册流程

1. **定义工具**：`tools/mod.rs` 末尾的 `get_tool_definitions()` 函数中用 `td!` 宏注册
2. **实现执行**：`tools/mod.rs` `execute_tool()` 函数的 `match` 块中添加分支
3. **注册 IPC**：`lib.rs` 中 `generate_handler!` 宏注册 `get_tools` 和 `execute_tool` 命令
4. **前端封装**：`commands.ts` 添加对应的 `invoke` 封装

### 7.2 内置工具清单（20+4+动态）

见 `docs/BUILTIN_TOOLS.md` 完整清单和对比。

### 7.3 工具执行流程（`commands/tools.rs`）

```
front-end invoke("execute_tool", {name, args, permission_mode})
  → commands/tools.rs execute_tool()
  → 1. 自定义模式 → 查 tool_permissions 表
     ├─ "deny" → 返回 permission_denied
     ├─ "confirm" → 生成 token，返回 needs_confirmation
     └─ "allow" → 放行
  → 2. 非自定义模式 → tool_needs_confirmation()
     ├─ 需要确认 → 生成 token，返回 needs_confirmation
     └─ 不需要 → 放行
  → 3. 放行时 → tokio::spawn_blocking → tools::execute_tool()
  → 4. 结果处理：
     ├─ Ok(Err(e)) 且 e.starts_with("未知工具:") → 回退到 execute_skill
     └─ 其他 → 返回真实错误
```

### 7.4 二次确认流程

```
execute_tool 返回 { needs_confirmation: true, token, details }
  → App.tsx 展示确认对话框 (pendingConfirmation state)
  → 用户点击「运行」→ confirm_tool_execution(token) → 执行真实工具
  → 用户点击「取消」→ cancel_tool_execution(token) → 删除 pending 记录
```

### 7.5 MCP 工具

- **服务端模式**：内置 axum HTTP 服务，暴露 MCP 协议 endpoint，供外部客户端调用 CeBianDesktop 工具
- **客户端模式**：可连接外部 MCP 服务，自动发现工具并注册到 AI 工具列表中（前缀 `mcp:`）

### 7.6 技能系统

- 技能是 `.md` 格式文件，存储在 `workspace/skills/` 下
- 每个技能文件自动注册为 `skill_xxx` 工具
- 内置管理工具：`skill_list`、`skill_create`、`skill_read`、`skill_delete`
- 编辑器：内置 CodeMirror 6 + 文件树浏览

---

## 八、关键模块详解

### 8.1 `App.tsx`（前端核心）

> **文件位置**：`src/App.tsx`

这是前端最复杂的文件（~1200 行），承担：

1. **状态管理**：messages, conversations, aiConfig, streaming 状态
2. **流式对话循环**：`handleSend()` 函数实现工具调用循环（最多10轮）
3. **交互式表单**：`ask_user` 工具的 pending/resolve 机制
4. **二次确认**：危险操作的确认/取消流程
5. **多会话并发**：每个会话可独立流式，切换不中断

**重要 hooks/refs**：
- `activeStreamsRef`：所有活跃流的 map（key=sessionId）
- `interactiveResolveRef`：ask_user 表单 resolve 回调
- `confirmResolveRef`：二次确认 resolve 回调

### 8.2 `App.tsx` 中流式对话的两种路径

当前主要使用 **前端驱动** 路径（`handleSend` 中的 `fetch`），`call_ai_streaming` 后端驱动路径存在但暂未启用。

**为什么前端驱动？** 因为前端驱动路径支持更灵活的 UI 更新（逐 token 更新消息、工具调用过程实时显示、ask_user 表单交互、二次确认等）。

### 8.3 滚动回底机制

> **文件位置**：`src/components/chat/useStickToBottom.ts`

```typescript
// 关键阈值
BOTTOM_THRESHOLD_PX = 60;  // 距底部 60px 内视为"在底部"
PROGRAMMATIC_GUARD_MS = 80; // 编程滚动后的静默期（避免被 scroll 事件误判）
```

- 通过 `ResizeObserver` 监听内容变化自动回底
- 用户向上滚动超过 60px 时停止自动跟随
- `scrollToBottom({ force: true })` 强制回底

### 8.4 权限配置存储

| 存储位置 | 文件 | 内容 |
|----------|------|------|
| Rust 侧 | `app_data_dir/config.json` | `ai_permission_mode` + `tool_permissions: HashMap` |
| 前端侧 | `types.ts` | `AIConfig.aiPermissionMode` + `AIConfig.toolPermissions` |
| 持久化 | `commands/tools.rs` 中的 `execute_tool` | 读取 config → 查 tool_permissions |

### 8.5 工具权限列表

权限列表通过 `get_tool_permission_list` 命令获取，返回格式：

```json
{
  "name": "delete_path",
  "description": "...",
  "category": "文件操作",
  "source": "builtin",       // builtin / mcp / skill
  "type_label": "文件/目录删除工具"
}
```

前端 `PermissionSection.tsx` 按 category 分组展示，每个工具可配置 allow/confirm/deny。

### 8.6 设置页的 AI 权限高度铺开

在 `PermissionSection.tsx` 中，自定义模式下工具列表使用 `flex-1 overflow-y-auto min-h-0` 自动占满剩余高度。父容器链：
```
SettingsView → .settings-content (flex-1 flex flex-col min-h-0)
  → PermissionSection (flex flex-col min-h-0)
    → 工具列表 (flex-1 overflow-y-auto min-h-0)
```

### 8.7 前端暗色/亮色主题

通过 CSS 变量实现（`index.css`）：
- `:root` 定义暗色主题变量
- `.light` 类覆盖为亮色变量
- `document.documentElement.classList.toggle("light", !darkMode)`

主色调通过 `--primary-hue` CSS 变量控制，用户可在 AppearanceSection 中调节。

---

## 九、构建与运行

### 9.1 环境要求

| 工具 | 版本 | 说明 |
|------|------|------|
| Node.js | >= 20 | 前端构建 |
| pnpm | latest | 包管理 |
| Rust | stable | Rust 编译（需要 Tauri v2 支持） |
| Windows SDK | - | Windows 构建（仅 Windows 需要） |

### 9.2 常用命令

```bash
# 安装依赖
pnpm install

# 前端开发模式（浏览器预览，无 Tauri 功能）
pnpm dev

# 启动 Tauri 桌面应用（含前端开发服务器）
pnpm tauri:dev        # 使用 scripts/dev.js 自动分配端口
或
pnpm tauri dev        # 标准模式，端口 1742

# 构建安装包
pnpm tauri build      # 输出 NSIS 安装包

# Rust 编译检查（不运行）
cd src-tauri && cargo check

# TypeScript 类型检查
npx tsc --noEmit
```

### 9.3 开发端口

| 服务 | 默认端口 |
|------|----------|
| Vite 开发服务器 | 1742（脚本自动递增找空端口） |
| Vite HMR WebSocket | 1743 |
| MCP 服务端 | 8080 |

### 9.4 数据存储位置

```
%APPDATA%/com.cebian.desktop/
├── config.json              # AI配置、主题、权限设置
├── conversations.json       # 所有对话记录
├── prompts.json             # 提示词列表
├── mcp_servers.json         # MCP 服务器配置
└── workspace/
    ├── skills/              # 技能文件 (.md)
    └── backups/             # 备份文件 (.zip)
```

---

## 十、常见开发注意事项

### 10.1 回底按钮反复消失

这是历史问题（已修复4次）。**绝对不要在重构时把按钮移到 relative 容器外面。**

当前方案（`ChatView.tsx`）：
```tsx
<div className="flex-1 min-h-0 relative">       ← relative容器
  <div ref={containerRef} className="h-full overflow-y-auto">
    ...消息内容...
  </div>                                          ← close scroll
  <ScrollToBottomButton />                        ← ⬅ 必须在 relative 内！
</div>                                            ← close relative
```

### 10.2 IPC 调用约定

- 前端用 `camelCase`（TypeScript 习惯）
- 后端用 `snake_case`（Rust 习惯）
- Tauri 2 会自动转换，**但 `serde` 反序列化不会自动转换**。配置读写时需要在两端手动映射字段名。

### 10.3 工具执行错误处理

不要用 `_` 吞掉 `execute_tool` 的错误。当前逻辑：

```rust
Ok(Err(e)) => {
    if e.starts_with("未知工具:") {
        // 未命中内置工具 → 尝试技能
        crate::tools::execute_skill(&app_handle, &name, &args)
    } else {
        // 工具命中但执行失败 → 返回真实错误
        Err(e)  // ⬅ 不要吞掉这个错误！
    }
}
```

### 10.4 ask_user 交互模式

`ask_user` 支持三种模式，在 `lib/utils.ts` 的 `parseAskUserArgs` 中解析：

1. **紧凑模式**（单字段 + 无 title）：一行内嵌显示
2. **表单模式**（多字段）：多字段表单卡片
3. **分步向导模式**（带 `pagination.type = "wizard"` + `step` 字段）：多步骤流程

### 10.5 `scripts/dev.js` 工作流

这个脚本解决了 Vite 端口被占用的问题：
1. 启动 Vite，从 1742 开始自动递增找空端口
2. 从 Vite 输出中解析实际端口号
3. 写入临时 tauri config 覆盖文件（跳过 beforeDevCommand）
4. 启动 `tauri dev` 使用动态端口
5. 退出时自动清理

---

## 十一、关键文件快速索引

| 功能 | 文件路径 |
|------|----------|
| 前端入口 | `src/main.tsx` |
| 核心状态/流式 | `src/App.tsx` |
| 聊天视图 | `src/components/chat/ChatView.tsx` |
| 滚动回底 | `src/components/chat/useStickToBottom.ts` |
| 权限设置 | `src/components/settings/sections/PermissionSection.tsx` |
| 设置页 | `src/components/settings/SettingsView.tsx` |
| Tauri 启动 | `src-tauri/src/lib.rs` |
| 配置存储 | `src-tauri/src/config_storage.rs` |
| 工具核心 | `src-tauri/src/tools/mod.rs` |
| 工具 IPC | `src-tauri/src/commands/tools.rs` |
| AI 客户端 | `src-tauri/src/ai.rs` |
| 工具注册表 | `src-tauri/src/tools/mod.rs` (get_tool_definitions) |
| 类型定义 | `src/lib/types.ts` |
| IPC 封装 | `src/lib/commands.ts` |
| 持久化 | `src/lib/db.ts` |
| 开发脚本 | `scripts/dev.js` |
| 内置工具文档 | `docs/BUILTIN_TOOLS.md` |
