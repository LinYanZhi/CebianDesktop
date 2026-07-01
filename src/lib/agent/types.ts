import type { ChatMessage, ToolCall } from "../types";

/** beforeToolCall 返回结果 */
export interface BeforeToolCallResult {
  block: boolean;
  reason?: string;
}

/** Agent 状态机 */
export const enum AgentState {
  /** 空闲，可接收新输入 */
  idle = "idle",
  /** 正在请求 LLM API */
  running = "running",
  /** 等待工具执行结果 */
  awaiting_tool = "awaiting_tool",
  /** 已停止（用户中止或出错） */
  stopped = "stopped",
}

/** Agent 事件回调 */
export interface AgentEvents {
  /** 流式 token 更新（content 或 thinking 变化） */
  onToken?: (params: { content: string; thinking?: string }) => void;
  /** 工具执行前检查（对齐 Cebian beforeToolCall hook）。返回 block=true 阻止执行 */
  onBeforeToolCall?: (toolCall: ToolCall) => Promise<BeforeToolCallResult> | BeforeToolCallResult;
  /** 模型本轮发出了工具调用（包含轮次信息） */
  onToolCalls?: (toolCalls: ToolCall[], round: number) => void;
  /** 单个工具执行完成 */
  onToolResult?: (result: {
    toolCallId: string;
    toolName: string;
    arguments: string;
    content: string;
    success: boolean;
  }) => void;
  /** 一轮工具调用全部完成（可在此处 persist） */
  onRoundComplete?: (messages: ChatMessage[]) => void;
  /** 整个流结束 */
  onDone?: (finalMessages: ChatMessage[], usage?: { input: number; output: number }) => void;
  /** 出错 */
  onError?: (error: Error) => void;
  /** 状态变化 */
  onStateChange?: (state: AgentState) => void;
  /** 需要 ask_user 交互式输入 */
  onAskUser?: (args: any, resolve: (value: string | null) => void) => void;
  /** 需要二次确认 */
  onConfirm?: (details: any, token: string, resolve: (confirmed: boolean) => void) => void;
}

/** Agent 配置 */
export interface AgentConfig {
  endpoint: string;
  model: string;
  apiKey: string;
  maxTokens: number;
  temperature: number;
  systemPrompt: string;
  thinkingLevel?: string;
}

/** Agent 选项 */
export interface AgentOptions {
  config: AgentConfig;
  events: AgentEvents;
  /** 是否启用工具调用 */
  enableTools?: boolean;
}
