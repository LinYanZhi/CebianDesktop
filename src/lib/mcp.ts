/**
 * MCP 客户端管理
 *
 * 通过 Tauri IPC 与 Rust 后端的 McpClientManager 通信。
 * 支持连接/断开外部 MCP 服务器，获取 MCP 工具，调用 MCP 工具。
 */

import { invoke } from "@tauri-apps/api/core";

/** MCP 服务器配置 */
export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  auto_start: boolean;
}

/** MCP 工具定义 */
export interface McpToolDef {
  prefixed_name: string;
  original_name: string;
  server_name: string;
  description: string;
  input_schema: any;
}

/** 连接（启动）一个 MCP 服务器 */
export async function connectMcpServer(name: string, command: string, args: string[]): Promise<void> {
  return invoke("connect_mcp_server", { name, command, args });
}

/** 断开一个 MCP 服务器 */
export async function disconnectMcpServer(name: string): Promise<void> {
  return invoke("disconnect_mcp_server", { name });
}

/** 列出所有已连接的 MCP 服务器 */
export async function listMcpConnections(): Promise<string[]> {
  return invoke("list_mcp_connections");
}

/** 获取所有 MCP 工具定义 */
export async function getMcpTools(): Promise<McpToolDef[]> {
  return invoke("get_mcp_tools");
}

/** 调用 MCP 工具 */
export async function callMcpTool(name: string, args: any): Promise<any> {
  return invoke("call_mcp_tool", { name, args });
}

/** 保存 MCP 服务器配置 */
export async function saveMcpConfig(servers: McpServerConfig[]): Promise<void> {
  return invoke("save_mcp_config", { servers });
}

/** 加载 MCP 服务器配置 */
export async function loadMcpConfig(): Promise<McpServerConfig[]> {
  return invoke("load_mcp_config");
}
