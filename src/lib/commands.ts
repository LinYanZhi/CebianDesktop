import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export async function getTools(): Promise<any[]> {
  return invoke("get_tools");
}

export async function executeTool(name: string, args: any, permissionMode?: string): Promise<any> {
  return invoke("execute_tool", { name, args, permissionMode: permissionMode || null });
}

export async function getToolPermissionList(): Promise<any[]> {
  return invoke("get_tool_permission_list");
}

export async function confirmExecution(token: string): Promise<any> {
  return invoke("confirm_tool_execution", { token });
}

export async function cancelExecution(token: string): Promise<any> {
  return invoke("cancel_tool_execution", { token });
}

export async function callAI(config: any, messages: any[]): Promise<any> {
  return invoke("call_ai", { config, messages });
}

export async function callAiStreaming(config: any, messages: any[]): Promise<void> {
  return invoke("call_ai_streaming", { config, messages });
}

export function listenAiEvents(handlers: {
  onToken?: (token: string) => void;
  onThinking?: (token: string) => void;
  onToolCall?: (call: { id: string; name: string; arguments: string }) => void;
  onToolResult?: (result: { id: string; name: string; content: string }) => void;
  onDone?: (content: string) => void;
  onError?: (error: string) => void;
}): Promise<UnlistenFn[]> {
  return Promise.all([
    listen<string>("ai:token", (e) => handlers.onToken?.(e.payload)),
    listen<string>("ai:thinking", (e) => handlers.onThinking?.(e.payload)),
    listen<any>("ai:tool_call", (e) => handlers.onToolCall?.(e.payload)),
    listen<any>("ai:tool_result", (e) => handlers.onToolResult?.(e.payload)),
    listen<any>("ai:done", (e) => handlers.onDone?.(e.payload)),
    listen<any>("ai:error", (e) => handlers.onError?.(e.payload)),
  ]);
}

export async function startMcpServer(port: number): Promise<string> {
  return invoke("start_mcp_server", { port });
}

export async function stopMcpServer(): Promise<string> {
  return invoke("stop_mcp_server");
}

export async function getServerStatus(): Promise<boolean> {
  return invoke("get_server_status");
}

export async function saveConfig(config: any): Promise<void> {
  return invoke("save_app_config", { config });
}

export async function loadConfig(): Promise<any> {
  return invoke("load_app_config");
}

export async function exportProvidersConfig(path: string, config: any): Promise<void> {
  // 将前端驼峰字段映射为后端蛇形命名
  const snakeConfig = {
    providers: (config.providers || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      api_key: p.api_key,
      endpoint: p.endpoint,
      models: p.models,
      selected_model: p.selectedModel,
      connected: p.connected,
    })),
    active_provider_id: config.activeProviderId,
    max_tokens: config.max_tokens ?? 4096,
    temperature: config.temperature ?? 0.7,
    thinking_level: config.thinking_level || "medium",
    system_prompt: config.system_prompt || "",
    theme: config.theme || "dark",
    primary_hue: config.primary_hue ?? 200,
  };
  return invoke("export_providers_config", { path, config: snakeConfig });
}

export async function importProvidersConfig(path: string): Promise<any[]> {
  return invoke("import_providers_config", { path });
}

// ─── 桥接服务器命令 ───

export async function getBridgeStatus(): Promise<any> {
  return invoke("get_bridge_status");
}

export async function pingBrowser(sessionId: string): Promise<any> {
  return invoke("ping_browser", { sessionId });
}

export async function disconnectBrowser(sessionId: string): Promise<any> {
  return invoke("disconnect_browser", { sessionId });
}

export async function updateBrowserName(sessionId: string, name: string): Promise<any> {
  return invoke("update_browser_name", { sessionId, name });
}

export async function toggleBrowserDisabled(sessionId: string, disabled: boolean): Promise<any> {
  return invoke("toggle_browser_disabled", { sessionId, disabled });
}

export async function startBridgeServer(): Promise<string> {
  return invoke("start_bridge_server");
}

export async function stopBridgeServer(): Promise<string> {
  return invoke("stop_bridge_server");
}

export async function reloadBridgeConfig(): Promise<string> {
  return invoke("reload_bridge_config");
}

export async function getBridgeAgentProgress(): Promise<any> {
  return invoke("get_bridge_agent_progress");
}

export async function sendBrowserMessage(task: string, browserSessionId?: string): Promise<any> {
  return invoke("send_browser_message", { task, browserSessionId: browserSessionId || null });
}
