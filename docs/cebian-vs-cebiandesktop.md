# CeBian vs CebianDesktop 架构对比

> 目的：记录两个项目的核心差异，避免后续开发中重复踩坑。
> 最后更新：2026-07-02

---

## 一、核心定位差异

| | CeBian | CebianDesktop |
|--|--------|--------------|
| **本质** | 浏览器 AI（Chrome 扩展） | 桌面 AI（Tauri 桌面应用） |
| **运行时** | Chrome 扩展沙箱 | Windows 原生进程 |
| **交互对象** | 浏览器标签页、VFS 虚拟文件系统 | 真实文件系统、进程、系统 API |
| **主要能力** | 看网页、点元素、填表单、搜网页 | 操作文件、处理 Excel、控制系统 |
| **AI 模型** | 用户配置（OpenAI / Anthropic / 本地） | 用户配置（同左） |
| **与对方的关系** | Browser AI，接收 Desktop 委托 | Desktop AI，委托 Browser 做网页任务 |

**核心原则**：CeBian 不能访问真实文件系统，CebianDesktop 不能操作浏览器 DOM。
双方通过桥接协议互补。

---

## 二、系统提示词构建方式

### CeBian

```
composeSystemPrompt()  // agent.ts
  ├── 读取 userInstructions（用户自定义指令）
  ├── scanSkillIndex() → 扫描所有已安装技能
  ├── buildSkillsBlock() → 渲染为 <skills> XML 块
  ├── 记忆开关 → MEMORY_LIMITATION / MEMORY_SECTION
  └── buildSystemPrompt(base, skillsBlock, instructions, vars)
       → [DEFAULT_SYSTEM_PROMPT 含 {{SESSION_ID}}]
       → [<skills>...</skills>]（可选）
       → [<user-instructions>...</user-instructions>]（可选）
```

关键设计：
- **技能通过 XML 块动态拼接到提示词末尾**，而不是注册为工具
- **skills 块缓存**：skills 不变时逐字节一致，命中 LLM 的 system 缓存前缀（省钱）
- **user-instructions** 也拼在后面，与核心规则不冲突
- **SESSION_ID 作为模板变量**注入，AI 会话隔离

### CebianDesktop

```
getDefaultSystemPrompt()  // prompts.ts
  → 返回纯字符串，没有任何动态拼接
```

关键问题：
- 技能没有注入到提示词中，只通过 `skill_xxx` 工具名让 AI 猜
- 用户自定义指令没有注入机制
- 没有会话 ID 上下文
- **应该模仿 CeBian**：将技能摘要/索引注入提示词尾部

### 建议

```typescript
// 伪代码 — 应该实现 composeSystemPrompt():
// 1. 读所有技能文件摘要 → 拼成 <skills> 块
// 2. 读用户自定义指令 → 拼成 <instructions> 块
// 3. 传入当前会话上下文（时间、工作目录等）
// 4. 返回完整系统提示词
```

---

## 三、技能系统差异

| | CeBian | CebianDesktop |
|--|--------|--------------|
| **存储** | VFS（IndexedDB）虚拟文件系统 | 真实磁盘文件 |
| **路径** | `~/.cebian/skills/<name>/SKILL.md` | `{app_data}/workspace/skills/<name>.md` |
| **格式** | Markdown + YAML frontmatter | 纯 Markdown（无 frontmatter） |
| **入口文件** | `SKILL.md`（目录内） | 每个 `.md` 文件就是单个技能 |
| **执行方式** | `run_skill` 沙箱执行 JS 脚本 | `skill_read` + 内置工具 |
| **权限声明** | SKILL.md 的 `metadata.permissions` | 无权限声明 |
| **索引扫描** | `scanSkillIndex()` 30 分钟 TTL 缓存 | `skill_search` 关键字搜索 |
| **注入提示词** | 是（`<skills>` XML 块） | 否（只有工具名） |

CeBian 的技能系统比 CebianDesktop 成熟得多。关键差距：

1. **技能注入提示词**：CeBian 把技能摘要注入到 AI 的上下文中，AI 在思考时就知道有什么技能。CebianDesktop 的 AI 只能盲猜 `skill_xxx` 工具名。
2. **前 matter 元数据**：CeBian 的技能可以声明权限，AI 知道什么技能需要什么权限。CebianDesktop 没有这个机制。
3. **沙箱执行**：CeBian 的技能脚本在沙箱中运行，有隔离。CebianDesktop 的技能直接通过内置工具操作，没有隔离。

### 建议

- 至少实现**技能摘要注入提示词**：`export_to_docx` 已加，但技能的内容摘要也应该在提示词中可见
- 考虑 skill frontmatter 格式：`name`、`description`、`author` 等

---

## 四、桥接协议

> 这是两个项目通信的方式

### CeBian 侧（Browser AI 工作流）

1. Desktop AI 通过 `ask_browser_ai` 发出任务
2. 创建一个 `bridge-agent` 实例（独立会话，有独立的系统提示 `BRIDGE_SYSTEM_PROMPT`）
3. Bridge Agent 执行浏览器操作，返回结构化回复（摘要 + 步骤 + 状态）
4. Desktop AI 收到结果，直接使用（**不需要额外验证**）

关键设计：
- Bridge Agent 有自己的系统提示（中文），不是用 `composeSystemPrompt`
- Bridge Agent 也可以使用 `execute_desktop_tool` 回调 Desktop AI 的工具
- 回复格式固定：`[执行总结]\n[执行详情]\n[当前状态]`

### CebianDesktop 侧

目前通过 `ask_browser_ai` 单一工具实现，主要问题是：
- **AI 不清楚 Browser AI 的具体能力边界**，可能乱用或不敢用
- **没有处理 Browser AI 离线的情况**（离线提示不够友好）
- **桥接回复展示在 UI 中**（`AskBrowserAiResult.tsx`），但 AI 没有把回放给用户的摘要写好

---

## 五、记忆/内存系统

| | CeBian | CebianDesktop |
|--|--------|--------------|
| **跨会话记忆** | ✅ 有 | ❌ 没有 |
| **存储** | VFS 文件 (`~/.cebian/memories/`) | 无 |
| **类型** | 4 类：user / feedback / context / reference | 无 |
| **注入方式** | `<memories>` 索引 + `<user_profile>` 全文 | 无 |

CeBian 的记忆系统设计要点：
- **user**：用户的身份/核心偏好（始终完整注入）
- **feedback**：AI 行为修正和确认（搜索型）
- **context**：用户当前目标/项目（搜索型）
- **reference**：常用资源位置（搜索型）
- 写入纪律：不存页面内容、不存密码、不存一次性任务状态
- 整理机制：独立 agent 做去重和过期

**CebianDesktop 如果要做记忆**，可以直接复用这个 4 类分类法，但存储改到真实文件系统。

---

## 六、提示词架构对比

### CeBian 结构

```
Identity（身份：你是 Browser AI）
Critical Rules（3 条绝对规则）
Environment（VFS 布局 + 消息结构）
Tools（按分组列出 + 场景说明）
Workflows（6 个完整工作流）
Output & Communication（输出规范）
Limitations（能力边界）
Dual AI Architecture（与 Desktop AI 的关系）
Runtime Extensions（<skills> + <user-instructions>）
```

### CebianDesktop（改版后）

```
Identity（身份：你是 Desktop AI）
Core Rules（5 条绝对规则）
Tool Selection（场景 → 工具表格）
Workflows（6 个工作流）
Error Recovery（5 种错误场景）
Output（输出要求）
Runtime Extensions（<skills> + <user-instructions>）
```

改版后结构已经对齐。需要持续维护的是：

1. **工具选择表** — 每次新增工具都要在表格加一行
2. **工作流** — 新功能要配新工作流
3. **错误恢复** — 新失败场景要加一条

---

## 七、常见错误历史（避坑）

| 日期 | 问题 | 根因 | 修复 |
|------|------|------|------|
| 2026-07-02 | 复制文件到桌面失败 6 次 | 没有 `copy_path` 工具，AI 只能 `run_command` 调用 Windows copy/xcopy/robocopy，路径引号混乱 | 新增 `copy_path` 工具（Rust `fs::copy`） |
| 2026-07-02 | 下载 UU 远程只得到 3KB 文件 | AI 从页面 HTML 中猜了个重定向链接，`download_file` 拿到的是跳转页而非安装包 | 新增文件大小校验 + 提示词规则 |
| 2026-07-02 | AI 不主动用 ask_user | 提示词只说"可以用 ask_user"，没有强力要求 | 强化规则 6 + 工作流 "询问用户" 章节 |
| 2026-07-02 | AI 找不到 UU 远程技能内容 | AI 只看工具名 `skill_software-source_network`，不知道里面有什么 | 新增 `skill_search` 工具 + 提示词 13-15 |
| 2026-07-02 | 消息列表滚动卡顿 | 流式每 token 全量重渲染所有消息 | rAF 合并 + useMemo |
| 2026-07-02 | 提示词模板字符串中 \`ask_user\` 报错 | 第 96 行反引号未转义，提前结束了模板字符串 | 反斜杠转义 |

**模式总结**：CebianDesktop 的大部分交互问题都可以归类为：
1. **缺少工具**（AI 没有合适工具 → 用 run_command 乱试）
2. **提示词不够具体**（AI 不知道该怎么做 → 猜着做）
3. **结果判断缺失**（AI 拿到错误结果也不知道 → 继续往下走）

---

## 八、开发注意事项清单

### 8.1 新增工具时

- [ ] 在 `mod.rs` 加 `td!()` 定义
- [ ] 在 `commands/tools.rs` 加权限分类 + 内置工具名 + 分类列表
- [ ] 在 `tools/index.ts` 加前端导出标签
- [ ] 在提示词 **工具选择表** 加一行
- [ ] 如果涉及新的操作场景，加一个 **工作流** 条目
- [ ] 如果是文件写操作，标记为 "medium" 风险

### 8.2 修改提示词时

- [ ] **不要用模板字符串**（`` ` ``），用 `'` 或 `"`，或者转义所有反引号
- [ ] 中文提示词，不要中英混杂
- [ ] 每条规则都要有明确的"怎么做"（workflow），不是只有"别做什么"
- [ ] Error Recovery 要覆盖错误场景
- [ ] 记住结尾的 `\`` + `;` 不要漏

### 8.3 与 CeBian 对齐时

- [ ] 考虑**技能注入提示词**的机制，不只是工具名
- [ ] 考虑**用户自定义指令**的注入机制
- [ ] 考虑跨对话记忆
- [ ] 考虑提示词缓存（不变时复用）

### 8.4 桥接相关

- [ ] AI 在调用 `ask_browser_ai` 前先检查连接
- [ ] 离线时告诉用户安装扩展
- [ ] 回复已经足够详细，不需要额外验证

### 8.5 测试发布前

- [ ] `cargo check` 通过
- [ ] TypeScript 零错误
- [ ] 提示词中反引号无漏转义
