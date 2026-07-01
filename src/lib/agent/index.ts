import { getMessageText, type ChatMessage, type ToolCall, type TextContent, type ThinkingContent, type ToolCallContent, type ContentBlock } from "../types";
import { AgentState, type AgentEvents, type AgentOptions } from "./types";

/** 从 SSE 流中解析单个 JSON chunk（处理 data: 前缀） */
function parseSSELine(line: string): any | null {
  if (!line.startsWith("data: ")) return null;
  const data = line.slice(6).trim();
  if (data === "[DONE]") return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * 将文本 + 思考 + 工具调用合并为 ContentBlock[]
 * 顺序：thinking → text → toolCalls（对齐 Cebian AssistantMessage 格式）
 */
function buildContentBlocks(
  text: string,
  thinking: string,
  toolCalls: ToolCall[],
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  if (thinking) blocks.push({ type: 'thinking', thinking } as ThinkingContent);
  if (text) blocks.push({ type: 'text', text } as TextContent);
  for (const tc of toolCalls) {
    try {
      blocks.push({
        type: 'toolCall',
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      } as ToolCallContent);
    } catch {
      blocks.push({
        type: 'toolCall',
        id: tc.id,
        name: tc.function.name,
        arguments: {},
      } as ToolCallContent);
    }
  }
  return blocks;
}

/**
 * 桌面端 Agent — 参考 Cebian 的 pi-agent-core 设计
 *
 * 状态机: idle → running → (awaiting_tool → running)* → stopped
 *
 * 使用方式：
 * ```
 * const agent = new Agent({ config, tools, events });
 * agent.send(messages); // 开始
 * agent.stop();         // 停止
 * ```
 */
export class Agent {
  private _state: AgentState = AgentState.idle;
  private controller: AbortController | null = null;
  private config: AgentOptions["config"];
  private events: AgentEvents;
  private enableTools: boolean;

  /** 等待工具结果时挂起的 resolve */
  private toolResolve: ((msgs: ChatMessage[]) => void) | null = null;
  /** 等待 ask_user 响应时挂起的 resolve */
  private askUserResolve: ((value: string | null) => void) | null = null;

  constructor(options: AgentOptions) {
    this.config = options.config;
    this.events = options.events;
    this.enableTools = options.enableTools !== false;
  }

  get state() {
    return this._state;
  }

  private setState(s: AgentState) {
    this._state = s;
    this.events.onStateChange?.(s);
  }

  /** 开始一轮 AI 流式请求 */
  async send(
    apiMessages: ChatMessage[],
    openaiTools?: any[],
  ) {
    if (this._state !== AgentState.idle) {
      throw new Error(`Agent 状态异常: ${this._state}，无法发送新消息`);
    }

    this.controller = new AbortController();
    this.setState(AgentState.running);
    const signal = this.controller.signal;

    try {
      await this.runLoop(apiMessages, openaiTools, signal);
    } catch (err: any) {
      if (err.name === "AbortError") {
        this.setState(AgentState.stopped);
        this.events.onDone?.([], undefined);
        return;
      }
      this.setState(AgentState.stopped);
      this.events.onError?.(err);
    }
  }

  /** 停止当前流 */
  stop() {
    this.controller?.abort();
    this.controller = null;
    this.setState(AgentState.stopped);
    // 释放挂起的 resolve
    if (this.toolResolve) {
      this.toolResolve([]);
      this.toolResolve = null;
    }
    if (this.askUserResolve) {
      this.askUserResolve(null);
      this.askUserResolve = null;
    }
  }

  // ─── 工具执行回调 ───

  /**
   * App.tsx 执行完工具后调用此方法，传入工具结果消息列表。
   * Agent 会将结果追加到历史中并继续下一轮循环。
   */
  resolveTools(toolResults: ChatMessage[]) {
    if (this.toolResolve) {
      const r = this.toolResolve;
      this.toolResolve = null;
      r(toolResults);
    }
  }

  /**
   * App.tsx 用户响应 ask_user 后调用
   */
  resolveAskUser(value: string | null) {
    if (this.askUserResolve) {
      const r = this.askUserResolve;
      this.askUserResolve = null;
      r(value);
    }
  }

  // ─── 核心循环 ───

  private async runLoop(
    initialMessages: ChatMessage[],
    openaiTools: any[] | undefined,
    signal: AbortSignal,
  ) {
    let currentMessages = [...initialMessages];
    let accumulatedUsage: { input: number; output: number } | undefined;

    // 工具调用循环
    for (let depth = 0; ; depth++) {
      // 构建 API 消息
      const apiMessages = this.buildApiMessages(currentMessages);

      // fetch + SSE 解析
      const { roundContent, roundToolCalls, fullThinking, usage } =
        await this.fetchStream(apiMessages, openaiTools, signal);

      if (usage) accumulatedUsage = usage;

      if (roundToolCalls.length === 0) {
        // ─── 没有工具调用 → 最终结果 ───
        this.setState(AgentState.stopped);
        const finalMsg: ChatMessage = {
          role: "assistant",
          content: buildContentBlocks(roundContent, fullThinking, []),
          reasoning_content: fullThinking || undefined,
          usage: accumulatedUsage,
        };
        const finalMessages = [...currentMessages, finalMsg];
        this.events.onDone?.(finalMessages, accumulatedUsage);
        return;
      }

      // ─── 有工具调用 → beforeToolCall 检查（对齐 Cebian Permission Gate 模式） ───
      if (this.events.onBeforeToolCall) {
        let blocked = false;
        for (const tc of roundToolCalls) {
          const result = await this.events.onBeforeToolCall(tc);
          if (result.block) {
            blocked = true;
            this.events.onError?.(new Error(`工具调用被阻止: ${tc.function.name} — ${result.reason || '无权限'}`));
            break;
          }
        }
        if (blocked) {
          this.setState(AgentState.stopped);
          this.events.onDone?.(currentMessages, accumulatedUsage);
          return;
        }
      }

      // ─── 有工具调用 → 执行工具 ───
      this.events.onToolCalls?.(roundToolCalls, depth);

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: buildContentBlocks(roundContent, fullThinking, roundToolCalls),
        tool_calls: roundToolCalls,
        reasoning_content: fullThinking || undefined,
      };
      currentMessages = [...currentMessages, assistantMsg];
      this.events.onRoundComplete?.(currentMessages);

      // 进入 awaiting_tool 状态，等待 App.tsx 执行工具
      this.setState(AgentState.awaiting_tool);

      const toolResults = await new Promise<ChatMessage[]>((resolve) => {
        this.toolResolve = resolve;
      });

      // 如果没有有效结果（用户取消等），结束循环
      if (toolResults.length === 0) {
        this.setState(AgentState.stopped);
        this.events.onDone?.(currentMessages, accumulatedUsage);
        return;
      }

      currentMessages = [...currentMessages, ...toolResults];
      this.events.onRoundComplete?.(currentMessages);

      // 重置 thinking 内容，准备下一轮
      this.setState(AgentState.running);
    }
  }

  private buildApiMessages(messages: ChatMessage[]): any[] {
    const systemMsg: ChatMessage = {
      role: "system",
      content: this.config.systemPrompt,
    };
    const apiMessages: any[] = [systemMsg];

    for (const msg of messages) {
      const text = getMessageText(msg);
      if (msg.role === "user") {
        apiMessages.push({ role: "user", content: text });
      } else if (msg.role === "assistant") {
        const m: any = { role: "assistant", content: text };
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          m.tool_calls = msg.tool_calls.map((tc: ToolCall) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.function.name, arguments: tc.function.arguments },
          }));
        }
        apiMessages.push(m);
      } else if (msg.role === "tool") {
        apiMessages.push({
          role: "tool",
          content: text,
          tool_call_id: msg.tool_call_id,
        });
      } else {
        apiMessages.push({ role: msg.role, content: text });
      }
    }
    return apiMessages;
  }

  private async fetchStream(
    apiMessages: any[],
    openaiTools: any[] | undefined,
    signal: AbortSignal,
  ): Promise<{
    roundContent: string;
    roundToolCalls: ToolCall[];
    fullThinking: string;
    usage?: { input: number; output: number };
  }> {
    const resp = await fetch(`${this.config.endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: apiMessages,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        stream: true,
        stream_options: { include_usage: true },
        ...(openaiTools && openaiTools.length > 0 && this.enableTools
          ? { tools: openaiTools }
          : {}),
      }),
      signal,
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status} - ${body}`);
    }

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let roundContent = "";
    let fullThinking = "";
    const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>();
    let usage: { input: number; output: number } | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const chunk = parseSSELine(line);
        if (!chunk) continue;

        if (chunk.usage) {
          usage = {
            input: chunk.usage.prompt_tokens || 0,
            output: chunk.usage.completion_tokens || 0,
          };
        }

        const choices = chunk.choices;
        if (!choices || choices.length === 0) continue;
        const delta = choices[0].delta || {};

        if (delta.content) {
          roundContent += delta.content;
          this.events.onToken?.({ content: roundContent, thinking: fullThinking || undefined });
        }

        if (delta.reasoning_content) {
          fullThinking += delta.reasoning_content || "";
          this.events.onToken?.({ content: roundContent, thinking: fullThinking });
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const index = tc.index ?? 0;
            if (!toolCallMap.has(index)) {
              toolCallMap.set(index, { id: "", name: "", arguments: "" });
            }
            const entry = toolCallMap.get(index)!;
            if (tc.id) entry.id += tc.id;
            if (tc.function?.name) entry.name += tc.function.name;
            if (tc.function?.arguments) entry.arguments += tc.function.arguments;
          }
        }
      }
    }

    const indices = Array.from(toolCallMap.keys()).sort((a, b) => a - b);
    const roundToolCalls: ToolCall[] = indices.map((idx) => {
      const entry = toolCallMap.get(idx)!;
      return {
        id: entry.id,
        type: "function",
        function: { name: entry.name, arguments: entry.arguments },
      };
    });

    return { roundContent, roundToolCalls, fullThinking, usage };
  }
}
