import { useState } from "react";
import { Copy, Check } from "lucide-react";
import type { ThinkingLevel } from "../../lib/types";

export const THINKING_OPTIONS: { key: ThinkingLevel; label: string }[] = [
  { key: "off", label: "关" },
  { key: "minimal", label: "极简" },
  { key: "low", label: "低" },
  { key: "medium", label: "中" },
  { key: "high", label: "高" },
];

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      title="复制"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

/** 工具类型分类 */
export type ToolCategory = "builtin" | "skill" | "mcp";

/** 工具类型信息 */
export const TOOL_CATEGORY_META: Record<ToolCategory, { label: string; color: string; bg: string }> = {
  builtin: { label: "系统", color: "text-blue-500", bg: "bg-blue-500/10" },
  skill: { label: "技能", color: "text-purple-500", bg: "bg-purple-500/10" },
  mcp: { label: "MCP", color: "text-amber-500", bg: "bg-amber-500/10" },
};

/** 根据工具名判断类型 */
export function getToolCategory(name: string): ToolCategory {
  if (name.startsWith("mcp:")) return "mcp";
  if (name.startsWith("skill_")) return "skill";
  return "builtin";
}

export const TOOL_LABELS: Record<string, { label: string; color: string; desc: string }> = {
  read_local_file: { label: "读取文件", color: "text-blue-400", desc: "读取本地文件内容" },
  write_new_file: { label: "写入文件", color: "text-emerald-400", desc: "创建新文件并写入内容" },
  edit_file: { label: "编辑文件", color: "text-amber-400", desc: "修改已有文件内容" },
  list_directory: { label: "浏览目录", color: "text-cyan-400", desc: "列出目录中的文件和子目录" },
  create_directory: { label: "创建目录", color: "text-teal-400", desc: "新建文件夹" },
  rename_path: { label: "重命名", color: "text-violet-400", desc: "重命名文件或文件夹" },
  delete_path: { label: "删除", color: "text-red-400", desc: "删除文件或文件夹" },
  search_files: { label: "搜索文件", color: "text-sky-400", desc: "按名称或内容搜索文件" },
  download_file: { label: "下载文件", color: "text-indigo-400", desc: "从 URL 下载文件到本地" },
  open_path: { label: "打开路径", color: "text-yellow-400", desc: "用系统默认程序打开文件或目录" },
  run_command: { label: "执行命令", color: "text-orange-400", desc: "在终端中执行系统命令" },
  system_info: { label: "系统信息", color: "text-pink-400", desc: "获取操作系统、CPU、内存、磁盘等信息" },
  system_notify: { label: "系统通知", color: "text-rose-400", desc: "发送桌面通知消息" },
  list_processes: { label: "进程列表", color: "text-fuchsia-400", desc: "列出当前运行的进程" },
  list_windows: { label: "窗口列表", color: "text-purple-400", desc: "列出当前打开的窗口" },
  capture_screen: { label: "截取屏幕", color: "text-gray-400", desc: "截取屏幕截图" },
  fetch_url: { label: "网络请求", color: "text-lime-400", desc: "发送 HTTP 请求获取网页或 API 数据" },
  clipboard_read: { label: "读取剪贴板", color: "text-stone-400", desc: "读取系统剪贴板内容" },
  clipboard_write: { label: "写入剪贴板", color: "text-neutral-400", desc: "写入内容到系统剪贴板" },
  ask_user: { label: "询问用户", color: "text-sky-400", desc: "向用户提问并等待回复" },
  // 技能管理工具
  skill_list: { label: "技能列表", color: "text-purple-400", desc: "列出所有已安装的技能" },
  skill_create: { label: "创建技能", color: "text-purple-400", desc: "创建一个新的技能" },
  skill_read: { label: "读取技能", color: "text-purple-400", desc: "读取技能的详细内容" },
  skill_delete: { label: "删除技能", color: "text-red-400", desc: "删除一个技能" },
  // 桥接 / 双 AI 工具
  ask_browser_ai: { label: "浏览器 AI 任务", color: "text-cyan-400", desc: "将任务委派给浏览器 AI 执行" },
  delegate_desktop_task: { label: "本地 AI 任务", color: "text-cyan-400", desc: "将任务委派给本地 AI 执行" },
  get_connected_browsers: { label: "浏览器列表", color: "text-cyan-400", desc: "查看已连接的浏览器" },
  get_browser_state: { label: "浏览器状态", color: "text-cyan-400", desc: "查看浏览器的当前状态（标签页、URL 等）" },
  get_tab_info: { label: "标签页信息", color: "text-cyan-400", desc: "获取指定标签页的详细信息" },
};

export function getToolLabel(name: string): string {
  return TOOL_LABELS[name]?.label || name;
}

export function getToolColor(name: string): string {
  return TOOL_LABELS[name]?.color || "text-muted-foreground";
}

export function getToolDesc(name: string): string {
  return TOOL_LABELS[name]?.desc || "";
}
