/**
 * 统一 Tool Registry
 *
 * 合并 Rust 后端内置工具 + MCP 工具，提供统一访问入口。
 * 对齐 Cebian 的 `lib/tools/index.ts` 设计。
 */

import { getTools } from "../commands";
import { getMcpTools } from "../mcp";
import { ToolDef, toOpenAITool } from "./types";

// ─── 内置工具显示标签（对照 Rust 后端实际工具名，未匹配的 fallback 到原始名） ───

const BUILTIN_TOOL_LABELS: Record<string, string> = {
  // 文件操作
  read_local_file: '读取文件',
  read_local_files: '批量读取',
  write_new_file: '写入文件',
  edit_file: '编辑文件',
  list_directory: '浏览目录',
  create_directory: '创建目录',
  rename_path: '重命名',
  batch_rename: '批量重命名',
  copy_path: '复制文件',
  delete_path: '删除',
  search_files: '搜索文件',
  get_file_info: '文件信息',
  open_path: '打开路径',
  // 下载
  download_file: '下载文件',
  // 命令行
  run_command: '执行命令',
  // 系统
  system_info: '系统信息',
  system_notify: '发送通知',
  system_get_languages: '语言列表',
  system_add_language: '添加语言',
  list_processes: '进程列表',
  list_windows: '窗口列表',
  capture_screen: '截取屏幕',
  get_env: '环境变量',
  // 剪贴板
  clipboard_read: '读取剪贴板',
  clipboard_write: '写入剪贴板',
  // 网络
  fetch_url: '网络请求',
  // 用户交互
  ask_user: '询问用户',
  // Excel
  read_excel: '读取 Excel',
  read_excel_as_json: 'Excel 转 JSON',
  excel_query: 'Excel 查询',
  excel_summary: 'Excel 统计',
  excel_transform: 'Excel 转换',
  excel_dedup: 'Excel 去重',
  excel_join: 'Excel 合并',
  excel_union: 'Excel 纵向合并',
  json_to_xlsx: 'JSON 转 Excel',
  data_pipeline: '数据流水线',
  // 压缩
  extract_archive: '解压文件',
  compress_files: '压缩文件',
  // CSV
  read_csv_as_json: 'CSV 转 JSON',
  // 技能
  skill_list: '技能列表',
  skill_create: '创建技能',
  skill_read: '读取技能',
  skill_delete: '删除技能',
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
