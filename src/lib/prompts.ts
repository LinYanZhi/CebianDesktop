/**
 * Slash Prompts — 斜杠提示词管理
 *
 * 提示词存储在 app_data_dir/prompts.json，每个 Prompt 包含：
 *   id, name（显示名）, description（说明）, content（正文）
 *
 * 模板变量（在 ChatInput 中使用时替换）：
 *   {{date}} — 当前日期
 *   {{time}} — 当前时间
 *   {{clipboard}} — 剪贴板内容
 */

import { invoke } from "@tauri-apps/api/core";

export interface Prompt {
  id: string;
  name: string;
  description: string;
  content: string;
  created_at: number;
  updated_at: number;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

/** 创建空提示词模板 */
export function createPromptTemplate(): Prompt {
  const now = Date.now();
  return {
    id: generateId(),
    name: "",
    description: "",
    content: "",
    created_at: now,
    updated_at: now,
  };
}

/** 列出所有提示词 */
export async function listPrompts(): Promise<Prompt[]> {
  try {
    return await invoke<Prompt[]>("list_prompts");
  } catch (e) {
    console.error("listPrompts 失败:", e);
    return [];
  }
}

/** 保存单个提示词（创建或更新） */
export async function savePrompt(prompt: Prompt): Promise<void> {
  return invoke("save_prompt", { prompt: { ...prompt, updated_at: Date.now() } });
}

/** 删除一个提示词 */
export async function deletePrompt(id: string): Promise<void> {
  return invoke("delete_prompt", { id });
}

/**
 * 替换 prompt content 中的模板变量。
 * CebianDesktop 的变量比 Cebian 少（没有页面相关变量），
 * 只保留本地可用的。
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

  // {{clipboard}} 需要异步读取
  if (result.includes("{{clipboard}}")) {
    return navigator.clipboard.readText()
      .then((clipText) => result.replace(/\{\{clipboard\}\}/g, clipText))
      .catch(() => result.replace(/\{\{clipboard\}\}/g, ""));
  }

  return Promise.resolve(result);
}
