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
