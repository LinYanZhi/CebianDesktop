import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export async function getTools(): Promise<any[]> {
  return invoke("get_tools");
}

export async function executeTool(name: string, args: any): Promise<any> {
  return invoke("execute_tool", { name, args });
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
