/**
 * Slash Prompts — 斜杠提示词管理
 *
 * 提示词存储在 app_data_dir/workspace/prompts/ 下，每个文件是 .md 格式
 * 用 workspace.ts 进行文件 CRUD。
 *
 * 模板变量（在 ChatInput 中使用时替换）：
 *   {{date}} — 当前日期
 *   {{time}} — 当前时间
 *   {{clipboard}} — 剪贴板内容
 */

import {
  listWorkspaceFiles,
  writeWorkspaceFile,
  deleteWorkspaceFile,
  generateWorkspaceId,
} from "./workspace";
import type { WorkspaceFile } from "./workspace";

export type { WorkspaceFile };
export type Prompt = WorkspaceFile;

/** 创建空提示词模板 */
export async function createPromptTemplate(): Promise<Prompt> {
  const id = await generateWorkspaceId();
  return {
    id,
    filename: `${id}.md`,
    name: "",
    description: "",
    content: "",
    created_at: Date.now(),
    updated_at: Date.now(),
  };
}

/** 列出所有提示词 */
export async function listPrompts(): Promise<Prompt[]> {
  return listWorkspaceFiles("prompts");
}

/** 保存单个提示词（创建或更新） */
export async function savePrompt(prompt: Prompt): Promise<void> {
  return writeWorkspaceFile("prompts", prompt.id, prompt.name, prompt.description, prompt.content);
}

/** 删除一个提示词 */
export async function deletePrompt(id: string): Promise<void> {
  return deleteWorkspaceFile("prompts", id);
}

/**
 * 替换 prompt content 中的模板变量。
 */
export function replaceTemplateVars(content: string): Promise<string> {
  const now = new Date();
  const dateStr = now.toLocaleDateString("zh-CN");
  const timeStr = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];

  let result = content
    .replace(/\{\{date\}\}/g, dateStr)
    .replace(/\{\{time\}\}/g, timeStr)
    .replace(/\{\{weekday\}\}/g, weekday);

  if (result.includes("{{clipboard}}")) {
    return navigator.clipboard.readText()
      .then((clipText) => result.replace(/\{\{clipboard\}\}/g, clipText))
      .catch(() => result.replace(/\{\{clipboard\}\}/g, ""));
  }

  return Promise.resolve(result);
}

/**
 * Default system prompt — written in English for more reliable model adherence.
 * Models are trained primarily on English data and follow English instructions
 * more precisely, especially for structured tool-use protocols.
 * The final rule tells the model to reply in the user's language.
 * Keep this concise — long prompts dilute attention to critical rules.
 */
export function getDefaultSystemPrompt(): string {
  return `You are CeBianDesktop Agent, an AI assistant running on the user's local computer. You interact with the system and files through built-in tools.

## Core Rules

1. Use built-in tools first. Do NOT use run_command to write scripts that bypass tool restrictions.
2. If a tool fails twice consecutively, STOP trying that approach. Tell the user it failed and ask what they want to do instead.
3. Prefer dedicated tools over shell commands for admin tasks (installing software, modifying system settings).
4. NEVER create temp scripts (.ps1/.bat/.cmd/.vbs) on Desktop/Documents. Write to %TEMP% and delete immediately after execution.
5. Large base64 data in tool results is already truncated. Do NOT try to pass it to another tool.

## Asking the User

6. When you need the user to make a choice, provide information, or answer a question, you MUST use the `ask_user` tool to show an interactive form. Do NOT just list options in your reply text — `ask_user` provides buttons, dropdowns, and input fields that are much more convenient.
7. Exception: Medium/high risk tools (delete files, run commands, etc.) are automatically intercepted by the system — a confirmation form will be shown to the user. Do NOT ask with ask_user for these. Just call the tool directly and wait — the system is waiting for user confirmation.

## Security & Permissions

8. Allowed paths: workspace, user directories (Desktop/Downloads/Documents), temp, and network shares. System dirs (C:\\Windows, Program Files, etc.) are hard-blocked. When unsure, just call the tool — the security system will decide.
9. When a tool returns a permission/security error, explain why to the user and ask what they want to do. **NEVER** bypass security limits (run_command, path re-encoding, writing scripts, etc.).

## Dual AI Bridge

10. You (Desktop AI) delegate browser tasks to the Browser AI via ask_browser_ai. The Browser AI has its own toolchain (search, click, forms, JS execution, etc.).
11. **NEVER** use execute_js, click_element or other low-level tools to manipulate the browser directly — always delegate via ask_browser_ai.
12. Call get_connected_browsers before ask_browser_ai to check connection status. The result from ask_browser_ai already contains complete execution details — **no need for extra verification**.

## Output

- Respond in the same language as the user. After executing tools, briefly summarize what was done.`;
}
