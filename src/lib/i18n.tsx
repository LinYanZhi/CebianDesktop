/**
 * 轻量 i18n 模块 — 无外部依赖的 React 国际化方案
 *
 * 使用方式：
 *   const { t, lang, setLang } = useI18n();
 *   t("settings.title")   =>  "设置"
 */

import React, { createContext, useContext, useState, useCallback, useRef } from "react";

// ─── 类型 ─────────────────────────────────────────────

type Lang = "zh" | "en";

type TranslationDict = Record<string, string>;

// ─── 翻译数据 ──────────────────────────────────────────

const zh: TranslationDict = {
  /* 通用 */
  "common.settings": "设置",
  "common.back": "返回",
  "common.search": "搜索",
  "common.save": "保存",
  "common.delete": "删除",
  "common.cancel": "取消",
  "common.confirm": "确认",
  "common.loading": "加载中...",
  "common.no_data": "暂无数据",
  "common.enabled": "已启用",
  "common.disabled": "已禁用",

  /* 聊天 */
  "chat.new_conversation": "新的对话",
  "chat.start_new": "开始新的对话",
  "chat.hint_configure": "配置 AI 提供商后即可开始对话",
  "chat.hint_select_model": "选择模型并输入消息开始交流",
  "chat.input_placeholder": "输入消息...",
  "chat.send": "发送",
  "chat.stop": "终止回答",
  "chat.rollback": "回滚到此处",
  "chat.retry": "重试",
  "chat.web_search": "联网搜索",
  "chat.voice_input": "语音输入",
  "chat.voice_input_hint": "语音输入中...",
  "chat.copied": "已复制",
  "chat.copy": "复制",
  "chat.compacted": "上下文已压缩 — 早期对话已折叠为摘要，减少 token 消耗",
  "chat.agent_name": "助手",
  "chat.cancelled": "已取消",
  "chat.no_messages": "暂无对话",
  "chat.cumulative_tokens": "累计消耗",
  "chat.tokens": "tokens",
  "chat.input_token": "输入 token",
  "chat.output_token": "输出 token",
  "chat.total_token": "总计 token",

  /* 设置导航 */
  "nav.providers": "AI 提供商",
  "nav.appearance": "外观",
  "nav.instructions": "系统提示词",
  "nav.prompts": "提示词",
  "nav.skills": "技能",
  "nav.mcp": "MCP",
  "nav.backup": "备份",
  "nav.storage": "存储",
  "nav.advanced": "高级",
  "nav.about": "关于",
  "nav.language": "语言",

  /* 设置 - 提供商 */
  "providers.title": "AI 提供商",
  "providers.no_providers": "未配置 AI 提供商",
  "providers.add": "添加提供商",
  "providers.api_key": "API 密钥",
  "providers.endpoint": "端点",
  "providers.model": "模型",
  "providers.test": "测试连接",
  "providers.connect": "连接",
  "providers.disconnect": "断开",
  "providers.remove": "移除",
  "providers.connected": "已连接",
  "providers.disconnected": "未连接",

  /* 设置 - 外观 */
  "appearance.title": "外观",
  "appearance.preset": "预设主题色",
  "appearance.custom_hue": "自定义色相",
  "appearance.preview": "预览",
  "appearance.primary_btn": "主要按钮",
  "appearance.secondary_btn": "次要按钮",

  /* 设置 - 系统提示词 */
  "instructions.title": "系统提示词",
  "instructions.edit": "编辑系统提示词",
  "instructions.placeholder": "在此输入系统提示词...",
  "instructions.hint": "系统提示词帮助 AI 理解对话上下文和行为准则",

  /* 设置 - 提示词 */
  "prompts.title": "提示词",
  "prompts.desc": "在输入框输入 / 即可快速插入预设提示词。每个提示词是一个 .md 文件，存放在工作区的 prompts/ 目录。",
  "prompts.new": "新建提示词",
  "prompts.empty": "暂无提示词",
  "prompts.unnamed": "(未命名)",
  "prompts.name": "名称",
  "prompts.shortcut": "快捷指令",
  "prompts.content": "内容",
  "prompts.unsaved": "有未保存的修改",
  "prompts.saving": "保存中...",
  "prompts.name_required": "请输入提示词名称",
  "prompts.save_success": "保存成功",
  "prompts.save_failed": "保存失败",
  "prompts.delete_success": "已删除",
  "prompts.delete_failed": "删除失败",
  "prompts.select_hint": "请选择或创建一个提示词",

  /* 设置 - 技能 */
  "skills.title": "技能",
  "skills.desc": "技能是可以让 AI 按需调用的能力模块。每个技能是一个 .md 文件，存放在工作区的 skills/ 目录。",
  "skills.new": "新建技能",
  "skills.empty": "暂无技能",
  "skills.name": "名称",
  "skills.description": "描述",
  "skills.content": "技能定义内容（Markdown 格式）",
  "skills.name_required": "请输入技能名称",
  "skills.save_success": "保存成功",
  "skills.save_failed": "保存失败",
  "skills.delete_success": "已删除",
  "skills.delete_failed": "删除失败",
  "skills.select_hint": "请选择或创建一个技能",

  /* 设置 - MCP */
  "mcp.title": "MCP",
  "mcp.builtin": "内置 MCP 服务器",
  "mcp.port": "端口",
  "mcp.start": "启动",
  "mcp.stop": "停止",
  "mcp.status.running": "运行中",
  "mcp.status.stopped": "已停止",
  "mcp.servers": "外置 MCP 服务器",
  "mcp.add_server": "添加服务器",
  "mcp.server_name": "名称",
  "mcp.server_command": "命令",
  "mcp.server_args": "参数",
  "mcp.server_env": "环境变量",
  "mcp.auto_connect": "自动连接",
  "mcp.test": "测试连接",

  /* 设置 - 备份 */
  "backup.title": "备份与恢复",
  "backup.desc": "导出备份包含：工作区文件（提示词、技能）、对话记录、AI 配置、MCP 配置。",
  "backup.export": "导出备份",
  "backup.import": "导入恢复",
  "backup.exporting": "导出中...",
  "backup.importing": "导入中...",
  "backup.export_success": "备份下载完成",
  "backup.export_failed": "导出失败",
  "backup.import_success": "备份恢复成功，请重启应用以生效",
  "backup.import_failed": "导入失败",

  /* 设置 - 存储 */
  "storage.title": "存储",
  "storage.hint": "管理应用数据存储",
  "storage.clear_conversations": "清空所有对话",
  "storage.clear_cache": "清理缓存",

  /* 设置 - 高级 */
  "advanced.title": "高级设置",

  /* 设置 - 关于 */
  "about.title": "关于",
  "about.description": "CebianDesktop 是一款基于 Tauri 的桌面 AI 助手，支持多模型、工具调用和可扩展技能。",
  "about.tech_stack": "当前项目技术栈",
  "about.version": "版本",

  /* 语言 */
  "language.title": "语言",
  "language.label": "界面语言",
  "language.zh": "中文",
  "language.en": "English",

  /* 历史记录 */
  "history.title": "历史记录",
  "history.new": "新建对话",
  "history.rename": "重命名",
  "history.delete": "删除会话",
  "history.delete_confirm": "确定要删除这个会话吗？",
  "history.empty": "暂无记录",
};

const en: TranslationDict = {
  /* Common */
  "common.settings": "Settings",
  "common.back": "Back",
  "common.search": "Search",
  "common.save": "Save",
  "common.delete": "Delete",
  "common.cancel": "Cancel",
  "common.confirm": "Confirm",
  "common.loading": "Loading...",
  "common.no_data": "No data",
  "common.enabled": "Enabled",
  "common.disabled": "Disabled",

  /* Chat */
  "chat.new_conversation": "New Conversation",
  "chat.start_new": "Start a new conversation",
  "chat.hint_configure": "Configure an AI provider to start chatting",
  "chat.hint_select_model": "Select a model and type a message to start",
  "chat.input_placeholder": "Type a message...",
  "chat.send": "Send",
  "chat.stop": "Stop",
  "chat.rollback": "Rollback to here",
  "chat.retry": "Retry",
  "chat.web_search": "Web Search",
  "chat.voice_input": "Voice Input",
  "chat.voice_input_hint": "Listening...",
  "chat.copied": "Copied",
  "chat.copy": "Copy",
  "chat.compacted": "Context compressed — earlier messages folded into a summary to reduce token usage",
  "chat.agent_name": "Assistant",
  "chat.cancelled": "Cancelled",
  "chat.no_messages": "No conversations",
  "chat.cumulative_tokens": "Total",
  "chat.tokens": "tokens",
  "chat.input_token": "Input tokens",
  "chat.output_token": "Output tokens",
  "chat.total_token": "Total tokens",

  /* Settings Nav */
  "nav.providers": "AI Providers",
  "nav.appearance": "Appearance",
  "nav.instructions": "System Prompt",
  "nav.prompts": "Prompts",
  "nav.skills": "Skills",
  "nav.mcp": "MCP",
  "nav.backup": "Backup",
  "nav.storage": "Storage",
  "nav.advanced": "Advanced",
  "nav.about": "About",
  "nav.language": "Language",

  /* Settings - Providers */
  "providers.title": "AI Providers",
  "providers.no_providers": "No AI providers configured",
  "providers.add": "Add Provider",
  "providers.api_key": "API Key",
  "providers.endpoint": "Endpoint",
  "providers.model": "Model",
  "providers.test": "Test Connection",
  "providers.connect": "Connect",
  "providers.disconnect": "Disconnect",
  "providers.remove": "Remove",
  "providers.connected": "Connected",
  "providers.disconnected": "Disconnected",

  /* Settings - Appearance */
  "appearance.title": "Appearance",
  "appearance.preset": "Preset Colors",
  "appearance.custom_hue": "Custom Hue",
  "appearance.preview": "Preview",
  "appearance.primary_btn": "Primary Button",
  "appearance.secondary_btn": "Secondary Button",

  /* Settings - Instructions */
  "instructions.title": "System Prompt",
  "instructions.edit": "Edit System Prompt",
  "instructions.placeholder": "Enter system prompt here...",
  "instructions.hint": "The system prompt helps the AI understand the conversation context and guidelines",

  /* Settings - Prompts */
  "prompts.title": "Prompts",
  "prompts.desc": "Type / in the input box to quickly insert preset prompts. Each prompt is a .md file stored in the workspace prompts/ directory.",
  "prompts.new": "New Prompt",
  "prompts.empty": "No prompts",
  "prompts.unnamed": "(unnamed)",
  "prompts.name": "Name",
  "prompts.shortcut": "Shortcut",
  "prompts.content": "Content",
  "prompts.unsaved": "Unsaved changes",
  "prompts.saving": "Saving...",
  "prompts.name_required": "Please enter a prompt name",
  "prompts.save_success": "Saved successfully",
  "prompts.save_failed": "Save failed",
  "prompts.delete_success": "Deleted",
  "prompts.delete_failed": "Delete failed",
  "prompts.select_hint": "Select or create a prompt",

  /* Settings - Skills */
  "skills.title": "Skills",
  "skills.desc": "Skills are capability modules that AI can invoke on demand. Each skill is a .md file stored in the workspace skills/ directory.",
  "skills.new": "New Skill",
  "skills.empty": "No skills",
  "skills.name": "Name",
  "skills.description": "Description",
  "skills.content": "Skill definition (Markdown format)",
  "skills.name_required": "Please enter a skill name",
  "skills.save_success": "Saved successfully",
  "skills.save_failed": "Save failed",
  "skills.delete_success": "Deleted",
  "skills.delete_failed": "Delete failed",
  "skills.select_hint": "Select or create a skill",

  /* Settings - MCP */
  "mcp.title": "MCP",
  "mcp.builtin": "Built-in MCP Server",
  "mcp.port": "Port",
  "mcp.start": "Start",
  "mcp.stop": "Stop",
  "mcp.status.running": "Running",
  "mcp.status.stopped": "Stopped",
  "mcp.servers": "External MCP Servers",
  "mcp.add_server": "Add Server",
  "mcp.server_name": "Name",
  "mcp.server_command": "Command",
  "mcp.server_args": "Arguments",
  "mcp.server_env": "Environment Variables",
  "mcp.auto_connect": "Auto Connect",
  "mcp.test": "Test Connection",

  /* Settings - Backup */
  "backup.title": "Backup & Restore",
  "backup.desc": "Export includes: workspace files (prompts, skills), conversations, AI config, MCP config.",
  "backup.export": "Export Backup",
  "backup.import": "Import Backup",
  "backup.exporting": "Exporting...",
  "backup.importing": "Importing...",
  "backup.export_success": "Backup downloaded",
  "backup.export_failed": "Export failed",
  "backup.import_success": "Backup restored. Please restart the app.",
  "backup.import_failed": "Import failed",

  /* Settings - Storage */
  "storage.title": "Storage",
  "storage.hint": "Manage app data storage",
  "storage.clear_conversations": "Clear All Conversations",
  "storage.clear_cache": "Clear Cache",

  /* Settings - Advanced */
  "advanced.title": "Advanced Settings",

  /* Settings - About */
  "about.title": "About",
  "about.description": "CebianDesktop is a Tauri-based desktop AI assistant with multi-model support, tool calling, and extensible skills.",
  "about.tech_stack": "Tech Stack",
  "about.version": "Version",

  /* Language */
  "language.title": "Language",
  "language.label": "Interface Language",
  "language.zh": "中文",
  "language.en": "English",

  /* History */
  "history.title": "History",
  "history.new": "New Conversation",
  "history.rename": "Rename",
  "history.delete": "Delete Session",
  "history.delete_confirm": "Are you sure you want to delete this session?",
  "history.empty": "No records",
};

const dicts: Record<Lang, TranslationDict> = { zh, en };

// ─── Context ────────────────────────────────────────────

interface I18nContextType {
  lang: Lang;
  t: (key: string, fallback?: string) => string;
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18nContextType>({
  lang: "zh",
  t: (k) => k,
  setLang: () => {},
});

// ─── Storage keys ──────────────────────────────────────

const STORAGE_KEY = "cebiandesktop_lang";

function getSavedLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {}
  // 根据浏览器语言自动选择
  const navLang = navigator.language?.toLowerCase() || "";
  return navLang.startsWith("zh") ? "zh" : "en";
}

// ─── Provider ───────────────────────────────────────────

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getSavedLang);
  const dictRef = useRef(dicts[lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    dictRef.current = dicts[l];
    try { localStorage.setItem(STORAGE_KEY, l); } catch {}
  }, []);

  const t: I18nContextType["t"] = useCallback((key, fallback) => {
    return dictRef.current[key] ?? fallback ?? key;
  }, []);

  return (
    <I18nContext.Provider value={{ lang, t, setLang }}>
      {children}
    </I18nContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────

export function useI18n(): I18nContextType {
  return useContext(I18nContext);
}

/** 在非 React 环境使用（如工具函数），确保先调用 initI18nForNonReact */
const nonReactDict: { current: TranslationDict } = { current: zh };

export function initI18nForNonReact(lang: Lang) {
  nonReactDict.current = dicts[lang];
}

export function tStatic(key: string, fallback?: string) {
  return nonReactDict.current[key] ?? fallback ?? key;
}
