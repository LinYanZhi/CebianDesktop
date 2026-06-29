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

**CeBianDesktop** 是 [Cebian](https://github.com/maotoumao/Cebian) 浏览器扩展的桌面版实现。它将原先存在于浏览器侧面板的 AI 助手，打造成一个原生桌面应用，提供更强大的文件系统访问、系统命令执行和本地工具链支持。

> Cebian 是一个浏览器扩展 AI 助手，而 CeBianDesktop 让你在桌面环境中与 AI 直接交互。

---

## ✨ 核心特性

| 特性 | 说明 |
| :---: | :--- |
| **💬 多会话并发对话** | 同时与 AI 进行多个流式对话，切换会话不中断流式输出 |
| **🧩 技能编辑器** | 内建 CodeMirror 6 编辑器，Markdown/JS/YAML 语法高亮，文件树浏览、搜索过滤、拖拽整理 |
| **🛠️ 20+ 本地工具** | 文件读写、目录操作、系统命令、剪贴板、截图、进程/窗口列表、网络请求等，AI 可直接调用你的电脑资源 |
| **🎨 自定义主题** | 深色/浅色模式一键切换，8 种预设色盘 + 色相滑块自由定制 |
| **🔌 MCP 服务端** | 内置 MCP (Model Context Protocol) 服务，可被外部 MCP 客户端调用；也支持连接外部 MCP 服务 |
| **📝 交互式表单** | `ask_user` 工具支持三种模式：紧凑（一键选择）、表单（多字段）、分步向导，覆盖各种交互场景 |
| **💾 本地优先** | 所有对话记录、配置、技能文件均存储在本地，无需注册账号 |
| **🧠 上下文压缩** | 长对话自动压缩早期内容，节省 token 消耗 |
| **🗣️ 语音输入** | 基于 Web Speech API 的麦克风语音识别输入 |

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

共 **24 个内置工具** + 动态加载的技能工具。

### 文件操作（3）
| 工具 | 说明 |
|------|------|
| `read_local_file` | 读取本地文本文件 |
| `write_new_file` | 写入/创建新文件 |
| `edit_file` | 精确查找替换编辑文件 |

### 目录操作（5）
| 工具 | 说明 |
|------|------|
| `list_directory` | 列出目录内容 |
| `create_directory` | 创建目录 |
| `rename_path` | 重命名/移动文件或目录 |
| `delete_path` | 删除文件或目录 |
| `search_files` | 按文件名或内容搜索 |

### 系统操作（3）
| 工具 | 说明 |
|------|------|
| `run_command` | 执行系统命令 |
| `system_info` | 获取系统信息（OS/CPU/内存/磁盘） |
| `system_notify` | 发送桌面系统通知 |

### 进程与窗口（3）
| 工具 | 说明 |
|------|------|
| `list_processes` | 列出运行进程 |
| `list_windows` | 列出打开窗口 |
| `capture_screen` | 截取屏幕并保存为 PNG |

### 文件网络（2）
| 工具 | 说明 |
|------|------|
| `download_file` | 从 URL 下载到本地 |
| `open_path` | 用默认程序打开文件/目录 |

### 网络 & 剪贴板（4）
| 工具 | 说明 |
|------|------|
| `fetch_url` | HTTP 请求（GET/POST） |
| `clipboard_read` | 读取剪贴板 |
| `clipboard_write` | 写入剪贴板 |
| `ask_user` | 向用户展示表单/提问 |

### 技能管理（4）
| 工具 | 说明 |
|------|------|
| `skill_list` | 列出已安装技能 |
| `skill_create` | 创建技能文件 |
| `skill_read` | 读取技能定义 |
| `skill_delete` | 删除技能 |
| `skill_xxx`（动态） | 每个技能文件自动注册为独立调用工具 |

> 完整对比（vs Cebian）见 [BUILTIN_TOOLS.md](./BUILTIN_TOOLS.md)。

---

## 🖥️ 界面截图

### 对话界面
工具调用卡片可折叠，支持自由滚动 + 一键回底。Ask_user 表单支持紧凑/表单/分步向导三种模式。

### 技能编辑器
CodeMirror 6 编辑器 + 文件树导航 + 搜索过滤 + 拖拽整理。支持 F2 快捷键重命名文件，右键菜单支持删除/重命名/导出。

---

## 🗂️ 项目结构

```
CebianDesktop/
├── src/                        # React 前端源码
│   ├── App.tsx                 # 主应用组件（状态管理、流式对话、工具调用循环）
│   ├── main.tsx                # 入口文件
│   ├── index.css               # 全局样式（Tailwind + CSS 变量）
│   ├── components/
│   │   ├── chat/               # 对话视图（ChatView, AgentMessage, ToolCallCards）
│   │   ├── editor/             # CodeMirror 编辑器组件
│   │   └── settings/           # 设置视图（技能、提示词、MCP、AI 配置等）
│   └── lib/
│       ├── commands.ts         # Tauri IPC 命令封装
│       ├── db.ts               # 本地存储（IndexedDB）
│       ├── workspace.ts        # 工作区文件操作
│       ├── types.ts            # TypeScript 类型定义
│       └── i18n.ts             # 国际化（中/英）
├── src-tauri/                  # Tauri Rust 后端
│   ├── src/
│   │   ├── main.rs             # 入口
│   │   ├── lib.rs              # 插件注册 + 命令注册
│   │   ├── commands.rs         # Tauri IPC 命令实现
│   │   ├── tools.rs            # 24 个内置工具定义与实现
│   │   └── workspace.rs        # 工作区文件管理
│   ├── tauri.conf.json         # Tauri 配置
│   └── Cargo.toml              # Rust 依赖
├── index.html                  # HTML 入口
├── package.json                # 前端依赖
├── vite.config.ts              # Vite 构建配置
├── tailwind.config.js          # Tailwind 配置
└── postcss.config.js           # PostCSS 配置
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

## 🔄 最新更新

| 日期 | 更新内容 |
| :--: | :------- |
| 2026-06 | 工具卡片添加说明描述，无参工具隐藏空 `{}` 参数 |
| 2026-06 | 对话导出使用原生 Windows 文件保存对话框 |
| 2026-06 | Markdown 语法高亮 + 代码块头部（语言标签 + 复制按钮） |
| 2026-06 | 进入/退出设置页保持历史面板状态 |
| 2026-06 | F2 快捷键重命名技能文件（限制仅在技能面板焦点内） |
| 2026-06 | 历史对话右键菜单（重命名 + 另存为 Markdown 导出） |
| 2026-06 | 工具调用过程完整保留（修复流式消息丢失 bug） |
| 2026-06 | 自由滚动 + ArrowDown 一键回底按钮 |
| 2026-06 | 移除思考级别图标 + 移除联网搜索空壳开关 |
| 2026-06 | ask_user 表单三模式（紧凑/表单/分步向导） |
| 2026-06 | 技能文件名使用技能名替代 hex ID |
| 2026-05 | 多会话并发支持 + 语音输入 + 上下文压缩 |
| 2026-05 | 技能编辑器大重构（CodeMirror + 文件树 + 拖拽） |
| 2026-05 | 初始版本发布 |

---

## 🛡️ 安全性

- **本地优先**：所有数据存储在本地，不经过第三方服务器
- **危险操作确认**：删除文件、执行系统命令等操作需用户二次确认
- **命令黑名单检测**：自动识别并拦截 `format`、`rmdir` 等危险命令模式
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
