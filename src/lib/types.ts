export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high';

/** AI 权限模式 */
export type PermissionMode = 'conservative' | 'balanced' | 'trusted' | 'custom';
/** 工具权限值 */
export type ToolPermission = 'allow' | 'confirm' | 'deny';

export interface SendAttachment {
  id: string;
  type: 'image' | 'file';
  name: string;
  mimeType: string;
  data: string; // base64
  size?: number;
}

// ─── ContentBlock 体系（对齐 Cebian / pi-agent-core） ───

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ThinkingContent {
  type: 'thinking';
  thinking: string;
}

export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface ToolCallContent {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export type ContentBlock = TextContent | ThinkingContent | ImageContent | ToolCallContent;

/** 上下文压缩摘要消息类型（对齐 Cebian CompactionSummaryMessage） */
export interface CompactionSummaryMessage {
  role: 'compactionSummary';
  summary: string;
  tokensBefore: number;
  timestamp: number;
}

export interface ToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

// ─── 主消息类型 ───

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'compactionSummary';
  /** 
   * 消息内容。可以是纯文本（string）或 ContentBlock[]。
   * - assistant 消息逐步迁移为 ContentBlock[]（text / thinking / toolCall）
   * - user / system / tool 消息暂时保持 string，后续也支持 ContentBlock[]
   */
  content: string | ContentBlock[];
  /** 工具调用列表（过渡字段，后续将迁移到 ContentBlock[] 中） */
  tool_calls?: ToolCall[];
  /** 工具调用 ID（仅 tool 角色） */
  tool_call_id?: string;
  /** 工具名称（仅 tool 角色） */
  name?: string;
  /** 从 API 流式获取的思考推理过程（临时保留，后续会迁移到 ContentBlock[] 中） */
  reasoning_content?: string;
  /** 此消息是否被用户中止生成 */
  cancelled?: boolean;
  /** 此消息是否为老式上下文压缩摘要（compact.ts 生成） */
  compacted?: boolean;
  /** 模型返回的 token 用量 */
  usage?: {
    input: number;
    output: number;
  };
  /** 消息时间戳 */
  timestamp?: number;
}

// ─── 兼容层：CompactionSummaryMessage ↔ ChatMessage 互转 ───

export function compactionSummaryToChatMessage(cs: CompactionSummaryMessage): ChatMessage {
  return {
    role: 'compactionSummary',
    content: cs.summary,
    timestamp: cs.timestamp,
  } as ChatMessage;
}

export function chatMessageToCompactionSummary(msg: ChatMessage): CompactionSummaryMessage | null {
  if (msg.role === 'compactionSummary') {
    return {
      role: 'compactionSummary',
      summary: typeof msg.content === 'string' ? msg.content : '',
      tokensBefore: 0,
      timestamp: msg.timestamp || Date.now(),
    };
  }
  return null;
}

/** 从消息中提取纯文本（兼容 string / ContentBlock[] 两种格式） */
export function getMessageText(msg: ChatMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  return msg.content
    .filter((b): b is TextContent => b.type === 'text')
    .map(b => b.text)
    .join('');
}

/** 检查消息是否包含 ThinkingContent 块 */
export function getMessageThinking(msg: ChatMessage): string | undefined {
  if (typeof msg.content === 'object' && Array.isArray(msg.content)) {
    const tb = msg.content.find(b => b.type === 'thinking') as ThinkingContent | undefined;
    return tb?.thinking;
  }
  return undefined;
}

/** 将消息内容规范化为 ContentBlock[] */
export function normalizeContent(content: string | ContentBlock[]): ContentBlock[] {
  if (typeof content === 'string') {
    return content ? [{ type: 'text' as const, text: content }] : [];
  }
  return content;
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
  /** AI 权限模式 */
  aiPermissionMode?: PermissionMode;
  /** 自定义模式下各工具的独立权限配置 */
  toolPermissions?: Record<string, ToolPermission>;
  /** 双 AI 桥接端口配置列表 */
  bridgePorts?: { name: string; port: number }[];
  /** 界面浏览状态（当前视图、设置栏目等） */
  viewState?: Record<string, string>;
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
  /** 当前工作消息列表（随工具调用轮次动态增长，包含完整 tool_calls + tool results）
   *  供 visibilitychange 等需要保存最新状态的场景使用 */
  currentMessages: ChatMessage[];
  fullContent: string;
  fullThinking: string;
  usage?: { input: number; output: number };
}

/** 浏览器 AI / 本地 AI 执行步骤 */
export interface AgentProgressStep {
  type: "thinking" | "tool_call" | "tool_result" | "error";
  content: string;
  tool?: string;
  status?: string;
  timestamp: number;
  resultType?: "screenshot" | "page_content" | "search_result" | "tab_info" | "text";
}

/** 浏览器 AI / 本地 AI 执行进度（按 request_id 映射） */
export interface AgentProgressMap {
  [request_id: string]: {
    task: string;
    steps: AgentProgressStep[];
    status: "running" | "completed" | "error";
  };
}
