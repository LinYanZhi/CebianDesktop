# CebianDesktop 内置工具（vs Cebian）

## CebianDesktop 工具列表（20 个内置 + 技能管理 + 动态技能）

### 文件操作
| 工具 | 说明 | 参数 |
|------|------|------|
| `read_local_file` | 读取本地文本文件内容 | `path` |
| `write_new_file` | 写入内容到文件（创建/覆盖） | `path`, `content` |
| `edit_file` | 精确查找替换编辑文件 | `path`, `old_text`, `new_text` |

### 目录操作
| 工具 | 说明 | 参数 |
|------|------|------|
| `list_directory` | 列出目录下的文件和子目录 | `path` |
| `create_directory` | 创建目录 | `path` |
| `rename_path` | 重命名/移动文件或目录 | `old_path`, `new_path` |
| `delete_path` | 删除文件或目录 | `path` |
| `search_files` | 按文件名或内容搜索文件 | `directory`, `pattern`, `mode` |

### 文件网络
| 工具 | 说明 | 参数 |
|------|------|------|
| `download_file` | 从 URL 下载文件到本地 | `url`, `destination` |
| `open_path` | 用系统默认程序打开文件/目录 | `path` |

### 系统操作
| 工具 | 说明 | 参数 |
|------|------|------|
| `run_command` | 执行系统命令 | `command`, `cwd`（可选） |
| `system_info` | 获取系统信息（OS/CPU/内存/磁盘） | 无参数 |
| `system_notify` | 发送桌面通知 | `title`, `message` |

### 进程窗口
| 工具 | 说明 | 参数 |
|------|------|------|
| `list_processes` | 列出运行中进程 | `name_filter`（可选） |
| `list_windows` | 列出打开的窗口 | 无参数 |
| `capture_screen` | 截取屏幕截图 | `save_path` |

### 网络
| 工具 | 说明 | 参数 |
|------|------|------|
| `fetch_url` | HTTP 请求（GET/POST） | `url`, `method`（可选）, `body`（可选） |

### 剪贴板
| 工具 | 说明 | 参数 |
|------|------|------|
| `clipboard_read` | 读取剪贴板文本 | 无参数 |
| `clipboard_write` | 写入剪贴板文本 | `text` |

### 交互式
| 工具 | 说明 |
|------|------|
| `ask_user` | 向用户展示表单/提问（紧凑/表单/分步向导三种模式） |

### 技能管理
| 工具 | 说明 |
|------|------|
| `skill_list` | 列出已安装技能 |
| `skill_create` | 创建新技能文件 |
| `skill_read` | 读取技能定义内容 |
| `skill_delete` | 删除技能 |
| `skill_xxx`（动态） | 每个技能文件自动注册为独立工具，AI 可按需调用 |

### MCP
| 工具 | 说明 |
|------|------|
| MCP 工具（动态） | 通过 MCP 协议发现的外部工具（实验性） |

---

## Cebian（浏览器扩展）工具列表（18 个核心）

### 浏览器页面交互
| 工具 | 说明 |
|------|------|
| `read_page` | 读取当前页面内容（Markdown/JSON/文本） |
| `interact` | 模拟用户操作页面（点击、输入、滚动等） |
| `inspect` | 检查 DOM 元素、获取 CSS 选择器 |
| `screenshot` | 截取当前标签页截图 |
| `tab` | 管理标签页（新建、切换、关闭、列表） |
| `execute_js` | 在当前页面执行任意 JavaScript |
| `pdf` | 读取/搜索 PDF 标签页内容 |

### VFS 虚拟文件系统（IndexedDB）
| 工具 | 说明 |
|------|------|
| `fs_read_file` | 读取 VFS 文件 |
| `fs_create_file` | 创建 VFS 文件 |
| `fs_edit_file` | 编辑 VFS 文件 |
| `fs_list` | 列出 VFS 目录 |
| `fs_search` | 搜索 VFS 文件 |
| `fs_mkdir` | 创建 VFS 目录 |
| `fs_rename` | 重命名 VFS 文件/目录 |
| `fs_delete` | 删除 VFS 文件/目录 |
| `fs_save_url` | 从 URL 下载保存到 VFS |

### 浏览器 API
| 工具 | 说明 |
|------|------|
| `chrome_api` | 调用 Chrome API（书签、历史、cookie、下载等） |

### 其他
| 工具 | 说明 |
|------|------|
| `ask_user` | 向用户提问/展示表单 |
| `run_skill` | 执行技能脚本（沙箱隔离） |
| MCP 工具（动态） | 通过 MCP 协议发现的外部工具 |

---

## 差异总结

### CebianDesktop 独有（桌面能力）
- `run_command` — 执行系统命令（Cebian 完全没有）
- `system_info` — 获取系统信息
- `list_processes` / `list_windows` — 进程和窗口管理
- `capture_screen` — 截取全屏截图
- `clipboard_read` / `clipboard_write` — 系统剪贴板
- `download_file` / `open_path` — 真实文件系统操作
- 所有文件操作（`read_local_file` / `write_new_file` 等）— 操作真实磁盘，非 VFS
- 完整的技能管理（CRUD + 自动注册为工具）

### Cebian 独有（浏览器能力）
- `read_page` / `interact` / `inspect` — 页面交互（桌面应用天然无法对标）
- `execute_js` — 在页面中执行 JS
- `screenshot`（浏览器标签页截图，vs 全屏截图）
- `tab` — 标签页管理
- `pdf` — 浏览器内 PDF 阅读
- `chrome_api` — 浏览器 API 调用
- VFS 虚拟文件系统（IndexedDB 内存）

### 两者共有
- `ask_user`（交互式表单）
- 技能系统（Cebian：`run_skill`；CebianDesktop：自动注册 `skill_xxx` 工具）
- MCP 扩展

### 完善程度评价

| 维度 | CebianDesktop | Cebian |
|------|:-:|:-:|
| 文件系统操作 | ★★★★★（真实磁盘） | ★★★☆☆（VFS 虚拟） |
| 系统交互 | ★★★★★ | ☆☆☆☆☆ |
| 浏览器页面交互 | ☆☆☆☆☆ | ★★★★★ |
| 浏览器 API 访问 | ☆☆☆☆☆ | ★★★★★ |
| 网络请求 | ★★★★☆ | ★★★★☆ |
| 剪贴板 | ★★★★☆ | ☆☆☆☆☆ |
| 截图 | ★★★★☆（全屏） | ★★★★☆（标签页） |
| 技能系统 | ★★★★★（CRUD + 自动注册） | ★★★★☆（手动编写 + 沙箱执行） |
| 交互式表单 | ★★★★★ | ★★★★☆ |

**结论：两者定位不同，在各自领域都较为完善。CebianDesktop 是「桌面 AI 助手」，Cebian 是「浏览器 AI 助手」。**
