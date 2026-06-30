import type { Conversation } from "./types";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function yieldToUI(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 16)); // ~60fps 一帧
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

/**
 * 解析 ask_user 参数，构建表单定义。
 * 支持两种格式：
 *   1. 新版：args.questions 是 JSON 字符串，含完整字段定义
 *   2. 旧版：args.question + args.type + args.options（单字段简化版）
 */
function parseAskUserArgs(args: any): {
  title?: string;
  description?: string;
  submit_label?: string;
  pagination?: {
    type: "wizard";
    show_progress?: boolean;
    allow_skip?: boolean;
    allow_review?: boolean;
  };
  questions: Array<{
    id: string;
    type: string;
    question: string;
    message?: string;
    placeholder?: string;
    options?: { label: string; value: string; description?: string; recommended?: boolean }[];
    required?: boolean;
    allow_free_text?: boolean;
    min_select?: number;
    max_select?: number;
    step?: number;
    step_title?: string;
  }>;
} {
  // 新版：questions JSON 数组
  if (args.questions) {
    try {
      const qs = typeof args.questions === "string" ? JSON.parse(args.questions) : args.questions;
      if (Array.isArray(qs) && qs.length > 0) {
        return {
          title: args.title,
          description: args.description,
          submit_label: args.submit_label,
          pagination: args.pagination,
          questions: qs.map((q: any) => ({
            id: q.id || `q_${Math.random().toString(36).slice(2, 6)}`,
            type: q.type || "text",
            question: q.question || q.label || "",
            message: q.message,
            placeholder: q.placeholder,
            options: q.options,
            required: q.required,
            allow_free_text: q.allow_free_text,
            min_select: q.min_select,
            max_select: q.max_select,
            step: q.step,
            step_title: q.step_title,
          })),
        };
      }
    } catch { /* fall through to legacy */ }
  }

  // 旧版：单字段
  const question = args.question || "请输入：";
  const type = args.type || "text";
  let options: { label: string; value: string; description?: string; recommended?: boolean }[] | undefined;
  if (args.options) {
    try {
      options = typeof args.options === "string" ? JSON.parse(args.options) : args.options;
    } catch { /* ignore */ }
  }
  return {
    questions: [{
      id: "q0",
      type,
      question,
      options,
      required: true,
    }],
  };
}

function createNewConversation(): Conversation {
  return {
    id: generateId(),
    title: "新对话",
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export { generateId, yieldToUI, formatTime, parseAskUserArgs, createNewConversation };
