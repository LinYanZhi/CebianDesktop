import type { ChatMessage, AIConfig } from "./types";
import { getActiveConfig } from "./types";

/**
 * 对话上下文压缩 —— 将较旧的对话消息用 AI 总结为一段摘要，
 * 替换为一条 compacted system 消息，减少 token 消耗。
 *
 * 阈值：总消息数 > 30 条时触发，保留最后 8 条消息不压缩。
 */
async function compactMessages(
  messages: ChatMessage[],
  aiConfig: AIConfig,
): Promise<ChatMessage[]> {
  const THRESHOLD = 30;
  const KEEP_LATEST = 8;
  if (messages.length <= THRESHOLD) return messages;

  const splitIdx = messages.length - KEEP_LATEST;
  const toCompact = messages.slice(0, splitIdx);
  const keep = messages.slice(splitIdx);

  const active = getActiveConfig(aiConfig);
  if (!active.api_key) return messages;

  // 构建压缩请求
  const compactPrompt = `请用中文简要总结以下对话内容。保留关键信息：用户的要求、AI 执行了哪些操作和工具、重要的文件路径和结果。保持客观，不要添加对话中没有的信息。以下是需要总结的对话内容：

${toCompact.map(m => {
  const role = m.role === "user" ? "用户" : m.role === "assistant" ? "AI" : m.role === "tool" ? "工具结果" : "系统";
  let text = `[${role}]: ${m.content.slice(0, 500)}`;
  if (m.tool_calls?.length) {
    text += `\n[调用了工具: ${m.tool_calls.map(tc => tc.function.name).join(", ")}]`;
  }
  return text;
}).join("\n\n")}

请用 3-5 句话总结以上对话的核心内容和已完成的步骤。`;

  try {
    const resp = await fetch(`${active.endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${active.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: active.model,
        messages: [{ role: "user", content: compactPrompt }],
        max_tokens: 1024,
        temperature: 0.3,
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      console.warn("[compactMessages] 压缩请求失败:", resp.status);
      return messages;
    }

    const data = await resp.json();
    const summary = data.choices?.[0]?.message?.content?.trim() || "";

    if (!summary) return messages;

    // 替换压缩部分为一条 system 摘要消息
    const compactedMsg: ChatMessage = {
      role: "system",
      content: `以下是对之前对话的压缩摘要，帮助你保持上下文连贯性，无需重复已完成的步骤：\n\n${summary}`,
      compacted: true,
    };

    return [compactedMsg, ...keep];
  } catch (e) {
    console.warn("[compactMessages] 压缩失败:", e);
    return messages;
  }
}

export { compactMessages };
