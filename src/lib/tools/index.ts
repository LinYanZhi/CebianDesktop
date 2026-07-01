/**
 * 统一 Tool Registry
 *
 * 合并 Rust 后端内置工具 + MCP 工具，提供统一访问入口。
 * 对齐 Cebian 的 `lib/tools/index.ts` 设计。
 */

import { getTools } from "../commands";
import { getMcpTools } from "../mcp";
import { ToolDef, toOpenAITool } from "./types";

// ─── 内置工具元数据（补充 Rust 后端返回的原始定义） ───

const BUILTIN_TOOL_LABELS: Record<string, string> = {
  ask_browser_ai: 'Ask Browser AI',
  execute_code: 'Execute Code',
  search_web: 'Search Web',
  read_file: 'Read File',
  write_file: 'Write File',
  list_files: 'List Files',
  run_command: 'Run Command',
  create_file: 'Create File',
  edit_file: 'Edit File',
  delete_file: 'Delete File',
  rename_file: 'Rename File',
  mkdir: 'Create Directory',
  save_url: 'Save URL',
  ask_user: 'Ask User',
  fs_create_file: 'Create File',
  fs_edit_file: 'Edit File',
  fs_delete: 'Delete File',
  fs_rename: 'Rename File',
  fs_mkdir: 'Create Directory',
  fs_read_file: 'Read File',
  fs_list: 'List Files',
  fs_search: 'Search',
  fs_save_url: 'Save URL',
};

/**
 * 从 Rust 后端加载内置工具，包装为统一格式
 */
async function loadBuiltinTools(): Promise<ToolDef[]> {
  try {
    const rawTools: any[] = await getTools();
    return rawTools.map((t: any) => ({
      name: t.name || t.function?.name || 'unknown',
      label: BUILTIN_TOOL_LABELS[t.name || ''] || t.name || 'Unknown',
      description: t.description || t.function?.description || '',
      parameters: t.inputSchema || t.parameters || t.function?.parameters || {},
      source: 'builtin' as const,
    }));
  } catch (err) {
    console.error('[ToolRegistry] 加载内置工具失败:', err);
    return [];
  }
}

/**
 * 从 MCP 服务器加载工具，包装为统一格式
 */
async function loadMcpTools(): Promise<ToolDef[]> {
  try {
    const mcpTools = await getMcpTools();
    return mcpTools.map((t: any) => ({
      name: t.prefixed_name || t.name || 'unknown',
      label: t.original_name || t.name || 'Unknown',
      description: t.description || '',
      parameters: t.input_schema || {},
      source: 'mcp' as const,
      serverName: t.server_name || '',
    }));
  } catch (err) {
    console.error('[ToolRegistry] 加载 MCP 工具失败:', err);
    return [];
  }
}

/**
 * 工具注册表
 */
export class ToolRegistry {
  private builtinTools: ToolDef[] = [];
  private mcpTools: ToolDef[] = [];
  private loaded = false;

  /** 获取所有工具的统一列表 */
  getAllTools(): ToolDef[] {
    return [...this.builtinTools, ...this.mcpTools];
  }

  /** 获取内置工具 */
  getBuiltinTools(): ToolDef[] {
    return [...this.builtinTools];
  }

  /** 获取 MCP 工具 */
  getMcpTools(): ToolDef[] {
    return [...this.mcpTools];
  }

  /** 按名称查找工具 */
  getTool(name: string): ToolDef | undefined {
    return this.getAllTools().find(t => t.name === name);
  }

  /** 刷新工具列表（从 Rust 后端 + MCP） */
  async refresh(): Promise<void> {
    const [builtin, mcp] = await Promise.all([
      loadBuiltinTools(),
      loadMcpTools(),
    ]);
    this.builtinTools = builtin;
    this.mcpTools = mcp;
    this.loaded = true;
  }

  /** 转换为 OpenAI 兼容的 tool 数组 */
  toOpenAITools(): any[] {
    return this.getAllTools().map(toOpenAITool);
  }

  /** 是否已加载 */
  isLoaded(): boolean {
    return this.loaded;
  }
}

/** 全局单例 */
export const toolRegistry = new ToolRegistry();
