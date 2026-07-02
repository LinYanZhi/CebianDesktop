/**
 * CebianDesktop 共享库入口
 *
 * 对齐 Cebian 的 lib 设计，提供统一的模块导出。
 */

// ─── 类型定义 ───
export type {
  ThinkingLevel, PermissionMode,
  SendAttachment,
  TextContent, ThinkingContent, ImageContent, ToolCallContent, ContentBlock,
  CompactionSummaryMessage,
  ToolCall, ChatMessage, ProviderInfo, AIConfig, Conversation, StreamState,
  AgentProgressStep, AgentProgressMap,
} from './types';
export {
  getActiveConfig, hasUsableModel,
  compactionSummaryToChatMessage, chatMessageToCompactionSummary,
  getMessageText, getMessageThinking, normalizeContent,
} from './types';

// ─── Agent ───
export { Agent } from './agent';
export { AgentState } from './agent/types';
export type { AgentEvents, AgentConfig, AgentOptions, BeforeToolCallResult } from './agent/types';

// ─── Interactive Bridge ───
export { createInteractiveBridge, INTERACTIVE_CANCELLED } from './interactive-bridge';
export type { InteractiveBridge, PendingRequest } from './interactive-bridge';

// ─── Permission Gate ───
export {
  PermissionGate,
  createFileSystemGate, createNetworkGate, createGatesForMode, getToolPermission,
} from './permission-gate';
export type { PermissionDecision, PermissionRequest, ToolGate } from './permission-gate';

// ─── 持久化 ───
export { loadAIConfig, saveAIConfig, loadConversationsFromStorage, saveConversationsToStorage } from './db';

// ─── Tauri 命令 ───
export {
  executeTool, confirmExecution, cancelExecution,
  callAI, callAiStreaming, listenAiEvents,
  startMcpServer, stopMcpServer, getServerStatus,
  saveConfig, loadConfig,
  exportProvidersConfig, importProvidersConfig,
  getBridgeStatus, pingBrowser, disconnectBrowser,
  updateBrowserName, toggleBrowserDisabled,
  startBridgeServer, stopBridgeServer, reloadBridgeConfig,
  getBridgeAgentProgress, sendBrowserMessage,
  getToolPermissionList,
} from './commands';

// ─── 工具相关 ───
export { getTools } from './commands';
export type { ToolDef, RawToolDef, McpToolDef } from './tools/types';
export { toOpenAITool } from './tools/types';
export { ToolRegistry, toolRegistry } from './tools';
