import type { AIConfig } from "./types";
import { DEFAULT_PROVIDERS } from "./types";

export const DEFAULT_AI_CONFIG: AIConfig = {
  providers: DEFAULT_PROVIDERS.map(p => ({ ...p })),
  activeProviderId: "openai",
  max_tokens: 8192,
  temperature: 0.7,
  thinking_level: "medium",
  primary_hue: 200,
  aiPermissionMode: "safe",
};

export const TOOL_EXPORT_LABELS: Record<string, { label: string; desc: string }> = {
  read_local_file: { label: "读取文件", desc: "读取本地文件内容" },
  write_new_file: { label: "写入文件", desc: "创建新文件并写入内容" },
  edit_file: { label: "编辑文件", desc: "修改已有文件内容" },
  list_directory: { label: "浏览目录", desc: "列出目录中的文件和子目录" },
  create_directory: { label: "创建目录", desc: "新建文件夹" },
  rename_path: { label: "重命名", desc: "重命名文件或文件夹" },
  delete_path: { label: "删除", desc: "删除文件或文件夹" },
  search_files: { label: "搜索文件", desc: "按名称或内容搜索文件" },
  download_file: { label: "下载文件", desc: "从 URL 下载文件到本地" },
  open_path: { label: "打开路径", desc: "用系统默认程序打开文件或目录" },
  run_command: { label: "执行命令", desc: "在终端中执行系统命令" },
  system_info: { label: "系统信息", desc: "获取操作系统、CPU、内存、磁盘等信息" },
  system_notify: { label: "系统通知", desc: "发送桌面通知消息" },
  list_processes: { label: "进程列表", desc: "列出当前运行的进程" },
  list_windows: { label: "窗口列表", desc: "列出当前打开的窗口" },
  capture_screen: { label: "截取屏幕", desc: "截取屏幕截图" },
  fetch_url: { label: "网络请求", desc: "发送 HTTP 请求获取网页或 API 数据" },
  clipboard_read: { label: "读取剪贴板", desc: "读取系统剪贴板内容" },
  clipboard_write: { label: "写入剪贴板", desc: "写入内容到系统剪贴板" },
  ask_user: { label: "询问用户", desc: "向用户提问并等待回复" },
};
