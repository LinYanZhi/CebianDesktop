import type { ChatMessage, AIConfig } from "./types";
import { getActiveConfig } from "./types";

/**
 * Conversation context compression — summarize older conversation messages
 * using the AI model into a single system message, reducing token consumption.
 *
 * Threshold: triggers when total messages > 30, keeps the last 8 messages intact.
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

  // Build compaction request
  const compactPrompt = `Summarize the following conversation concisely in English. Keep key information: user requests, AI actions and tools used, important file paths and results. Be objective and do not add information not present in the conversation. Here is the conversation to summarize:

${toCompact.map(m => {
  const role = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : m.role === "tool" ? "Tool Result" : "System";
  let text = `[${role}]: ${m.content.slice(0, 500)}`;
  if (m.tool_calls?.length) {
    text += `\n[Called tools: ${m.tool_calls.map(tc => tc.function.name).join(", ")}]`;
  }
  return text;
}).join("\n\n")}

Summarize the core content and completed steps in 3-5 sentences.`;

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
      console.warn("[compactMessages] Compaction request failed:", resp.status);
      return messages;
    }

    const data = await resp.json();
    const summary = data.choices?.[0]?.message?.content?.trim() || "";

    if (!summary) return messages;

    // Replace compacted portion with a system summary message
    const compactedMsg: ChatMessage = {
      role: "system",
      content: `Below is a compressed summary of the earlier conversation to help maintain continuity. No need to repeat completed steps:\n\n${summary}`,
      compacted: true,
    };

    return [compactedMsg, ...keep];
  } catch (e) {
    console.warn("[compactMessages] Compaction failed:", e);
    return messages;
  }
}

export { compactMessages };
