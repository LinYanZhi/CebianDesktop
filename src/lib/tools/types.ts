/**
 * 工具注册系统 — 对齐 Cebian 的 AgentTool 接口
 *
 * CebianDesktop 的工具定义来自两个来源：
 * 1. Rust 后端内置工具（通过 Tauri `get_tools`）
 * 2. MCP 服务器工具（通过 `getMcpTools`）
 *
 * 此模块提供统一的工具类型和注册机制。
 */

/** 从 Rust 后端获取的原始工具定义 */
export interface RawToolDef {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

/** MCP 工具定义 */
export interface McpToolDef {
  prefixed_name: string;
  original_name: string;
  server_name: string;
  description: string;
  input_schema: any;
}

/**
 * 统一工具定义 — 对齐 Cebian 的 AgentTool<TParameters> 接口
 * 但保持简单：CebianDesktop 的工具执行始终通过 Tauri IPC
 */
export interface ToolDef {
  /** 工具名称 */
  name: string;
  /** UI 显示标签 */
  label: string;
  /** 工具描述 */
  description: string;
  /** JSON Schema 参数定义 */
  parameters: Record<string, any>;
  /** 来源: 'builtin' | 'mcp' */
  source: 'builtin' | 'mcp';
  /** MCP 服务器名称（仅 mcp 来源） */
  serverName?: string;
  /** 执行模式: 'sequential' | 'parallel' */
  executionMode?: 'sequential' | 'parallel';
}

/** 转换为 OpenAI 兼容的工具格式 */
export function toOpenAITool(tool: ToolDef): any {
  // 确保 parameters 有 type: "object"，否则 OpenAI API 会拒绝（要求 JSON Schema type: object）
  const params = tool.parameters && typeof tool.parameters === 'object'
    ? (tool.parameters.type ? tool.parameters : { ...tool.parameters, type: 'object' })
    : { type: 'object' };
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: params,
    },
  };
}
