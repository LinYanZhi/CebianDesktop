<div align="center">

# CeBianDesktop

**Cebian AI 助手的桌面客户端 — 用 Tauri v2 构建**

[![版本](https://img.shields.io/badge/版本-0.1.0-blue?style=for-the-badge)](https://github.com/LinYanZhi/CebianDesktop)
[![License](https://img.shields.io/badge/License-AGPL--3.0-green?style=for-the-badge)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-63%25-3178C6?style=for-the-badge&logo=typescript)
![Rust](https://img.shields.io/badge/Rust-35%25-000000?style=for-the-badge&logo=rust)

</div>

---

## 📖 简介

**CeBianDesktop** 是 [Cebian](https://github.com/maotoumao/Cebian) 浏览器扩展的桌面版 AI 助手。它将原先存在于浏览器侧面板的 AI 助手，打造成一个原生桌面应用，提供更强大的文件系统访问、Excel 数据处理、系统命令执行和本地工具链支持。

> 两套系统协同工作：[CeBian](https://github.com/maotoumao/Cebian) 是浏览器 AI（操作网页），CeBianDesktop 是桌面 AI（操作本地电脑）。详细架构对比见 [docs/cebian-vs-cebiandesktop.md](./docs/cebian-vs-cebiandesktop.md)。

---

## ✨ 核心特性

| 特性 | 说明 |
| :---: | :--- |
| **💬 多会话并发对话** | 同时与 AI 进行多个流式对话，切换会话不中断流式输出 |
| **🧩 技能系统** | 用户自定义知识模块，内建 CodeMirror 6 编辑器、文件树导航、搜索过滤、拖拽整理 |
| **🛠️ 44+ 本地工具** | 文件读写、Excel 分析、系统命令、网络请求、剪贴板、截图、进程/窗口管理、技能搜索与执行 |
| **📊 Excel 深度处理** | 读取/查询/变换/流水线，支持条件筛选、分组统计、列运算、多表合并 |
| **📝 导出 Word** | AI 生成的报告可直接导出为 .docx 格式，支持标题/加粗/斜体/列表 |
| **🎨 自定义主题** | 深色/浅色模式一键切换，8 种预设色盘 + 色相滑块自由定制 |
| **🔌 MCP 服务端** | 内置 MCP (Model Context Protocol) 服务，可被外部 MCP 客户端调用；也支持连接外部 MCP 服务 |
| **🌐 双 AI 桥接** | 通过 WebSocket 桥接与 Browser AI（CeBian 浏览器扩展）通信，浏览器任务自动委托 |
| **📝 交互式表单** | `ask_user` 工具支持三种模式：紧凑（一键选择）、表单（多字段）、分步向导 |
| **💾 本地优先** | 所有对话记录、配置、技能文件均存储在本地，无需注册账号 |
| **🧠 上下文压缩** | 长对话自动压缩早期内容，节省 token 消耗 |
| **🗣️ 语音输入** | 基于 Web Speech API 的麦克风语音识别输入 |
| **⏱ 响应耗时显示** | 每条 AI 回复显示首 token 延迟（TTFT）和总耗时 |

---

## 🚀 快速开始

### 环境要求

| 工具 | 版本 |
| :--: | :--: |
| Node.js | >= 20 |
| pnpm | latest |
| Rust | stable（需要 Tauri v2 支持） |

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/LinYanZhi/CebianDesktop.git
cd CebianDesktop

# 安装依赖
pnpm install

# 前端开发模式（浏览器预览）
pnpm run dev

# 启动 Tauri 桌面应用
pnpm run tauri dev
```

### 构建

```bash
# 构建前端
pnpm run build

# 构建桌面安装包
pnpm run tauri build
```

---

## 🧩 技术栈

| 分层 | 技术 |
| :--: | :--- |
| **前端框架** | React + TypeScript + Vite |
| **桌面框架** | Tauri v2 (Rust) |
| **编辑器** | CodeMirror 6（Markdown / JS / YAML 语法高亮） |
| **样式** | Tailwind CSS + PostCSS |
| **图标** | Lucide React |
| **Markdown 渲染** | react-markdown + rehype-highlight（highlight.js） + remark-gfm |
| **MCP** | Model Context Protocol（服务端 + 客户端） |
| **包管理** | pnpm |
| **通知** | Sonner |

---

## 🛠️ 内置工具

共 **44+ 个内置工具** + 动态加载的技能工具。

### 文件与目录操作（9）
| 工具 | 说明 |
|------|------|
| `read_local_file` | 读取本地文本文件 |
| `write_local_file` | 写入/创建新文件 |
| `edit_file` | 精确查找替换编辑文件 |
| `list_directory` | 列出目录内容 |
| `create_directory` | 创建目录 |
| `rename_path` | 重命名/移动文件或目录 |
| `copy_path` | 复制文件或目录到新位置 |
| `delete_path` | 删除文件或目录 |
| `search_codebase` / `Glob` / `Grep` | 按名称或内容搜索文件 |

### 文件信息（3）
| 工具 | 说明 |
|------|------|
| `get_file_info` | 获取文件/目录的元数据（大小、类型、日期、权限） |
| `open_path` | 用默认程序打开文件/目录/URL |
| `get_env` | 读取系统环境变量 |

### Excel 数据处理（12）
| 工具 | 说明 |
|------|------|
| `read_excel_as_json` | 读取 Excel 为结构化 JSON（推荐） |
| `read_excel` | 读取 Excel 为 Markdown 表格 |
| `excel_query` | 条件筛选行（支持 WHERE、ORDER BY） |
| `excel_transform` | 列运算、分组统计、去重、重命名 |
| `excel_merge` | 表关联合并（横向 left-join） |
| `excel_merge_multi` | 多表纵向合并（append） |
| `excel_pipeline` | 完整数据处理流水线 |
| `write_excel_json` | 写入 JSON 数据为 Excel 文件 |
| `excel_aggregate` | 分组聚合统计（sum/avg/count/min/max） |
| `excel_unique` | 列去重筛选 |
| `excel_search` | 按关键字搜索表格内容 |
| `excel_summary` | 数据概览统计 |

### 系统操作（5）
| 工具 | 说明 |
|------|------|
| `run_command` | 执行系统命令 |
| `get_system_info` | 获取系统信息（OS/CPU/内存/磁盘） |
| `list_process` | 列出运行进程 |
| `list_windows` | 列出打开窗口 |
| `capture_screen` | 截取屏幕并保存为 PNG |

### 网络与传输（4）
| 工具 | 说明 |
|------|------|
| `download_file` | 从 URL 下载到本地（带文件大小校验） |
| `fetch_url` | HTTP 请求（GET/POST） |
| `export_to_docx` | 将文本内容导出为 Word 文档（支持 Markdown 标记） |
| `open_path` | 用默认程序打开文件/目录/URL |

### 剪贴板（2）
| 工具 | 说明 |
|------|------|
| `clipboard_read` | 读取剪贴板 |
| `clipboard_write` | 写入剪贴板 |

### AI 桥接（3）
| 工具 | 说明 |
|------|------|
| `ask_browser_ai` | 向浏览器 AI 委托网页操作任务 |
| `get_connected_browsers` | 检查是否有已连接的浏览器扩展 |
| `ask_user` | 向用户展示交互式表单/提问 |

### 技能管理（6）
| 工具 | 说明 |
|------|------|
| `skill_list` | 列出已安装技能 |
| `skill_search` | 按关键字搜索所有技能文件内容 |
| `skill_read` | 读取单个技能定义 |
| `skill_create` | 创建新技能文件 |
| `skill_edit` | 编辑已有技能 |
| `skill_delete` | 删除技能 |
| `skill_xxx`（动态） | 每个技能文件自动注册为独立调用工具 |

### 压缩工具（2）
| 工具 | 说明 |
|------|------|
| `zip_create` | 将文件或目录打包为 ZIP |
| `zip_extract` | 解压 ZIP 文件到指定目录 |

> 完整工具清单见 [src-tauri/src/tools/mod.rs](./src-tauri/src/tools/mod.rs)。

---

## 🗂️ 项目结构

```
CebianDesktop/
├── src/                          # React 前端源码
│   ├── App.tsx                   # 主应用组件（状态管理、流式对话、工具调用循环）
│   ├── main.tsx                  # 入口文件
│   ├── index.css                 # 全局样式（Tailwind + CSS 变量）
│   ├── components/
│   │   ├── chat/                 # 对话视图（ChatView, MessageBlock, ToolCall, AskUser 等）
│   │   ├── editor/               # CodeMirror 编辑器组件
│   │   └── settings/             # 设置面板（技能、提示词、MCP、AI 配置、外观等）
│   └── lib/
│       ├── agent/                # AI 代理线程（流式请求、超时管理、重试逻辑）
│       ├── tools/                # 前端工具标签、权限、类型定义
│       ├── commands.ts           # Tauri IPC 命令封装
│       ├── db.ts                 # 本地存储（IndexedDB）
│       ├── workspace.ts          # 工作区文件操作
│       ├── types.ts              # TypeScript 类型定义
│       ├── prompts.ts            # AI 系统提示词（中文 Workflows）
│       └── interactive-bridge.ts # 桌面 AI ↔ 浏览器 AI 桥接
├── src-tauri/                    # Tauri Rust 后端
│   ├── src/
│   │   ├── main.rs               # 入口
│   │   ├── lib.rs                # 插件注册 + 命令注册
│   │   ├── ai.rs                 # AI 请求流式处理
│   │   ├── bridge.rs             # WebSocket 桥接通信
│   │   ├── tools/                # 工具模块目录
│   │   │   ├── mod.rs            # 工具注册（td! 宏）+ execute_tool 路由
│   │   │   ├── file_ops.rs       # 文件读写、搜索、路径操作
│   │   │   ├── excel_tools.rs    # Excel 全套处理工具
│   │   │   ├── system_ops.rs     # 系统信息、进程、截图
│   │   │   ├── net_ops.rs        # 网络请求、文件下载
│   │   │   └── docx_tools.rs     # Word 文档导出
│   │   ├── commands/             # Tauri IPC 命令
│   │   │   ├── mod.rs            # 命令聚合
│   │   │   ├── tools.rs          # 工具分类、权限、标签
│   │   │   ├── ai.rs             # AI 命令
│   │   │   ├── config.rs         # 配置命令
│   │   │   ├── mcp.rs            # MCP 命令
│   │   │   └── workspace.rs      # 工作区命令
│   │   ├── workspace/            # 工作区文件管理
│   │   └── mcp_client.rs         # MCP 客户端
│   ├── tauri.conf.json           # Tauri 配置
│   └── Cargo.toml                # Rust 依赖
├── docs/
│   └── cebian-vs-cebiandesktop.md # CeBian 架构对比文档
├── index.html                    # HTML 入口
├── package.json                  # 前端依赖
├── vite.config.ts                # Vite 构建配置
├── tailwind.config.js            # Tailwind 配置
├── postcss.config.js             # PostCSS 配置
└── pnpm-workspace.yaml           # pnpm 工作区配置
```

---

## ⚙️ 配置说明

### AI 提供商
支持 OpenAI、Anthropic、Google Gemini 以及任何兼容 OpenAI API 格式的自定义提供商。在设置页面配置 API Key 和端点地址即可使用。

### MCP 服务
- **服务端模式**：内置 MCP 服务器，默认端口 8080，可被外部 MCP 客户端调用
- **客户端模式**：可连接外部 MCP 服务，自动发现并注册为 AI 可用工具（实验性）

### 主题定制
- **深色/浅色模式**：一键切换，默认跟随系统偏好
- **主色定制**：8 种预设色盘 + 自由色相滑块，实时预览

---

## 🛡️ 安全性

- **本地优先**：所有数据存储在本地，不经过第三方服务器
- **危险操作确认**：删除文件、执行系统命令等中高风险操作需用户二次确认
- **路径安全防护**：系统关键目录（C:\Windows、Program Files 等）硬拦截
- **大文件保护**：base64 数据自动截断，防止 token 溢出
- **开源透明**：AGPL-3.0 许可证，代码完全可审查

---

## 🤝 贡献指南

欢迎贡献代码、提交 Issue 或功能建议！

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feat/amazing-feature`
3. 提交改动：`git commit -m 'feat: 添加某个很棒的功能'`
4. 推送分支：`git push origin feat/amazing-feature`
5. 提交 Pull Request

---

## 📄 许可证

CeBianDesktop 基于 **GNU Affero General Public License v3.0 (AGPL-3.0)** 许可证开源。

CeBianDesktop 是 [Cebian](https://github.com/maotoumao/Cebian)（AGPL-3.0）的衍生作品。

---

## 🙏 致谢

- [maotoumao/Cebian](https://github.com/maotoumao/Cebian) — 原始浏览器扩展项目，本项目的设计与交互大量参考了 Cebian
- [Tauri](https://tauri.app) — 桌面应用框架
- 所有贡献者和用户 ❤️
