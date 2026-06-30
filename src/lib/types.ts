export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high';

export interface SendAttachment {
  id: string;
  type: 'image' | 'file';
  name: string;
  mimeType: string;
  data: string; // base64
  size?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  thinking?: string;
  /** 思考推理过程内容（流式逐 token 积累） */
  reasoning_content?: string;
  /** 此消息是否被用户中止生成 */
  cancelled?: boolean;
  /** 此消息是否为上下文压缩摘要 */
  compacted?: boolean;
  /** 模型返回的 token 用量 */
  usage?: {
    input: number;
    output: number;
  };
}

export interface ToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export interface ProviderInfo {
  id: string;
  name: string;
  api_key: string;
  endpoint: string;
  models: string[];
  selectedModel: string;
  connected: boolean;
}

export const DEFAULT_PROVIDERS: ProviderInfo[] = [
  { id: "openai", name: "OpenAI", api_key: "", endpoint: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    selectedModel: "gpt-4o", connected: false },
  { id: "anthropic", name: "Anthropic", api_key: "", endpoint: "https://api.anthropic.com/v1",
    models: ["claude-3-5-sonnet-20240620", "claude-3-haiku-20240307", "claude-3-opus-20240229"],
    selectedModel: "claude-3-5-sonnet-20240620", connected: false },
  { id: "deepseek", name: "DeepSeek", api_key: "", endpoint: "https://api.deepseek.com/v1",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    selectedModel: "deepseek-v4-flash", connected: false },
  { id: "gemini", name: "Google Gemini", api_key: "", endpoint: "https://generativelanguage.googleapis.com/v1beta",
    models: ["gemini-2.0-flash", "gemini-2.0-pro", "gemini-1.5-pro"],
    selectedModel: "gemini-2.0-flash", connected: false },
];

export interface AIConfig {
  providers: ProviderInfo[];
  activeProviderId: string;
  max_tokens: number;
  temperature: number;
  thinking_level: ThinkingLevel;
  system_prompt?: string;
  /** 主色调色相 (0-360) */
  primary_hue?: number;
}

/** 从多 Provider 配置中提取当前激活的扁平配置（向后兼容后端） */
export function getActiveConfig(config: AIConfig): {
  endpoint: string; model: string; api_key: string;
  max_tokens: number; temperature: number; thinking_level: ThinkingLevel;
  system_prompt?: string;
} {
  const p = config.providers.find(p => p.id === config.activeProviderId);
  const result = {
    endpoint: p?.endpoint || "",
    model: p?.selectedModel || "",
    api_key: p?.api_key || "",
    max_tokens: config.max_tokens,
    temperature: config.temperature,
    thinking_level: config.thinking_level,
    system_prompt: config.system_prompt,
  };
  console.log("[getActiveConfig] activeProviderId:", config.activeProviderId,
    "found:", p?.id, "model:", result.model,
    "api_key length:", result.api_key.length,
    "endpoint:", result.endpoint);
  return result;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  /** 最近一次上下文压缩的时间戳 */
  compactedAt?: number;
}

export interface MCPServerStatus {
  running: boolean;
  port: number;
}

/** 是否存在至少一个已连接的 AI 提供商 */
export function hasUsableModel(config: AIConfig): boolean {
  return config.providers.some(p => p.connected && p.api_key.trim() !== "");
}

/** 单流状态（每个进行中的流一个实例） */
export interface StreamState {
  controller: AbortController;
  persistTimer: ReturnType<typeof setTimeout> | null;
  sessionId: string;
  /** 流开始前的消息（含刚发出的用户消息），用于重建完整数组 */
  prevMessages: ChatMessage[];
  fullContent: string;
  fullThinking: string;
  usage?: { input: number; output: number };
}
