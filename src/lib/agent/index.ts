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

/** 将 HTTP 错误码转为人性化的中文提示 */
function formatHttpError(status: number, body: string): string {
  // 尝试从 JSON body 中提取 error.message
  let detail = "";
  try {
    const parsed = JSON.parse(body);
    detail = parsed.error?.message || parsed.error || "";
  } catch {}
  const msg = detail || body.slice(0, 200);

  switch (status) {
    case 401: return `API 认证失败（401），请检查 API Key 是否正确。${msg ? `详情: ${msg}` : ""}`;
    case 403: return `API 无权限（403），当前 API Key 无权访问该模型。${msg ? `详情: ${msg}` : ""}`;
    case 404: return `API 地址错误（404），请检查 Endpoint 配置。${msg ? `详情: ${msg}` : ""}`;
    case 429: return `请求过于频繁（429），API 限流中，请稍后再试。${msg ? `详情: ${msg}` : ""}`;
    case 500: return `AI 服务器内部错误（500），请稍后重试。${msg ? `详情: ${msg}` : ""}`;
    case 502: return `AI 服务器网关错误（502），请稍后重试。${msg ? `详情: ${msg}` : ""}`;
    case 503: return `AI 服务暂不可用（503），可能是负载过高，请稍后重试。${msg ? `详情: ${msg}` : ""}`;
    case 504: return `AI 服务器超时（504），可能是负载过高，请稍后重试。${msg ? `详情: ${msg}` : ""}`;
    default: return `请求失败（HTTP ${status}）${msg ? `: ${msg}` : ""}`;
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
  /** handleStop 时设置，表示本轮工具结果处理完后 stop，不再发起新一轮 API 请求 */
  private _gracefulStop = false;
  /** send() 调用的时间戳，用于计算响应耗时 */
  private _startTime = 0;
  /** 首次收到 token 的时间戳，用于计算 TTFT */
  private _firstTokenTime = 0;

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
    this._startTime = performance.now();
    this._firstTokenTime = 0;
    const signal = this.controller.signal;

    try {
      await this.runLoop(apiMessages, openaiTools, signal);
    } catch (err: any) {
      // runLoop 内部已处理 AbortError + gracefulStop 场景，不会走到这里。
      // 走到这里的都是真正的异常。
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

  /**
   * 优雅停止：不 fire onDone([])，不清除 toolResolve。
   * 保留 toolResolve 让 executeToolCallsForAgent 能继续推结果 + resolveTools，
   * 这样工具卡片能收到最终状态（包括 cancelled）。
   */
  stopGracefully() {
    this._gracefulStop = true;
    this.controller?.abort();
    this.controller = null;
    // askUser 必须释放（避免表单卡死）
    if (this.askUserResolve) {
      this.askUserResolve(null);
      this.askUserResolve = null;
    }
    // 不释放 toolResolve — 等待 App.tsx 推完结果后主动 resolveTools
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
      let roundContent = "", roundToolCalls: ToolCall[] = [], fullThinking = "", usage: { input: number; output: number } | undefined;
      try {
        const result = await this.fetchStreamWithRetry(apiMessages, openaiTools, signal);
        roundContent = result.roundContent;
        roundToolCalls = result.roundToolCalls;
        fullThinking = result.fullThinking;
        usage = result.usage;
      } catch (err: any) {
        if (err.name === "AbortError") {
          // 优雅停止（stopGracefully）或外部强制停止 → 以当前消息结束
          this.setState(AgentState.stopped);
          this.events.onDone?.(currentMessages, accumulatedUsage);
          return;
        }
        throw err; // 真正的网络/HTTP 异常
      }

      if (usage) accumulatedUsage = usage;

      if (roundToolCalls.length === 0) {
        // ─── 没有工具调用 → 最终结果 ───
        this.setState(AgentState.stopped);
        const now = Date.now();
        const responseTime = this._firstTokenTime > 0 ? {
          ttft: Math.round(this._firstTokenTime - this._startTime),
          total: Math.round(performance.now() - this._startTime),
        } : undefined;
        const finalMsg: ChatMessage = {
          role: "assistant",
          content: buildContentBlocks(roundContent, fullThinking, []),
          reasoning_content: fullThinking || undefined,
          usage: accumulatedUsage,
          timestamp: now,
          responseTime,
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

      // 优雅停止 → 追加本轮结果后结束（不会发起新一轮 API 请求）
      if (this._gracefulStop) {
        this.setState(AgentState.stopped);
        currentMessages = [...currentMessages, ...toolResults];
        this.events.onDone?.(currentMessages, accumulatedUsage);
        return;
      }

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
        const m: any = { role: "assistant" };
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          // 有 tool_calls 时 content 必须为 null（OpenAI/DeepSeek 拒绝空字符串）
          m.content = text || null;
          m.tool_calls = msg.tool_calls.map((tc: ToolCall) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.function.name, arguments: tc.function.arguments },
          }));
        } else {
          m.content = text;
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
    const CONNECT_TIMEOUT_MS = 30_000; // 30 秒连接超时
    const STREAM_IDLE_TIMEOUT_MS = 60_000; // 60 秒流空闲超时

    let timedOut = false;
    let connectTimeoutId: ReturnType<typeof setTimeout> | undefined;

    // 使用一个独立的超时控制器，避免与外部 stop signal 冲突
    const timeoutController = new AbortController();
    connectTimeoutId = setTimeout(() => {
      timedOut = true;
      timeoutController.abort(new Error("连接超时：30秒内未收到响应"));
    }, CONNECT_TIMEOUT_MS);

    // 合并外部 signal（用户停止）和超时 signal
    const combinedSignal = "any" in AbortSignal
      ? AbortSignal.any([signal, timeoutController.signal])
      : signal;

    let resp: Response;
    try {
      resp = await fetch(`${this.config.endpoint}/chat/completions`, {
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
        signal: combinedSignal,
      });
    } catch (err: any) {
      clearTimeout(connectTimeoutId);
      if (timedOut) {
        throw new Error("连接超时：30秒内未收到响应，请检查网络或 API 地址");
      }
      if (err.name === "AbortError") {
        throw err; // 用户主动停止
      }
      throw new Error(`网络请求失败: ${err.message}`);
    } finally {
      clearTimeout(connectTimeoutId);
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(formatHttpError(resp.status, body));
    }

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let roundContent = "";
    let fullThinking = "";
    const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>();
    let usage: { input: number; output: number } | undefined;

    // 流式空闲超时检测
    let lastChunkTime = Date.now();
    let idleTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const startIdleChecker = () => {
      idleTimeoutId = setTimeout(() => {
        if (Date.now() - lastChunkTime >= STREAM_IDLE_TIMEOUT_MS) {
          timedOut = true;
          timeoutController.abort(new Error(`响应中断：${STREAM_IDLE_TIMEOUT_MS / 1000}秒内未收到新数据`));
        } else {
          startIdleChecker();
        }
      }, 10_000); // 每 10s 检查一次
    };
    startIdleChecker();

    while (true) {
      let chunkResult: ReadableStreamReadResult<Uint8Array>;
      try {
        chunkResult = await reader.read();
      } catch (err: any) {
        clearTimeout(idleTimeoutId);
        if (timedOut) {
          throw new Error("响应中断：60秒内未收到新数据，可能是网络不稳定或服务器超时");
        }
        if (err.name === "AbortError") {
          throw err; // 用户主动停止
        }
        throw new Error(`流式读取失败: ${err.message}`);
      }

      const { done, value } = chunkResult;
      if (done) break;
      lastChunkTime = Date.now();

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

        // 记录首次收到 token 的时间（TTFT 起点）
        if ((delta.content || delta.reasoning_content) && this._firstTokenTime === 0) {
          this._firstTokenTime = performance.now();
        }

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
          // 实时推送当前正在构建的工具调用，让 UI 能逐步显示参数
          if (this.events.onToolCallStream) {
            const indices = Array.from(toolCallMap.keys()).sort((a, b) => a - b);
            const currentToolCalls: ToolCall[] = indices.map((idx) => {
              const entry = toolCallMap.get(idx)!;
              return {
                id: entry.id,
                type: "function" as const,
                function: { name: entry.name, arguments: entry.arguments },
              };
            });
            this.events.onToolCallStream(currentToolCalls);
          }
        }
      }
    }

    clearTimeout(idleTimeoutId);

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

  private async fetchStreamWithRetry(
    apiMessages: any[],
    openaiTools: any[] | undefined,
    signal: AbortSignal,
  ): Promise<{
    roundContent: string;
    roundToolCalls: ToolCall[];
    fullThinking: string;
    usage?: { input: number; output: number };
  }> {
    const maxRetries = 3;
    const retryDelays = [1000, 2000, 4000];
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.fetchStream(apiMessages, openaiTools, signal);
      } catch (err: any) {
        if (err.name === "AbortError") throw err;

        const isRetryable = err.message.includes("HTTP 503") || err.message.includes("HTTP 429")
          || err.message.includes("HTTP 502") || err.message.includes("HTTP 504")
          || err.message.includes("连接超时");
        if (!isRetryable || attempt >= maxRetries - 1) {
          throw err;
        }

        lastError = err;
        const delay = retryDelays[attempt];
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error("Unknown error");
  }
}
