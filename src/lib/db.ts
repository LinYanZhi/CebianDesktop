/**
 * 本地持久化服务
 *
 * 通过 Tauri 命令读取/写入 app_data_dir/config.json
 * 和 app_data_dir/conversations.json
 */

import { invoke } from "@tauri-apps/api/core";
import type { AIConfig, Conversation, ThinkingLevel } from "./types";

// ─── 应用配置（config.json）─────────────────────────────────

interface AppConfigJson {
  providers: ProviderConfigJson[];
  active_provider_id: string;
  max_tokens: number;
  temperature: number;
  thinking_level: string;
  system_prompt: string;
  theme: string;
}

interface ProviderConfigJson {
  id: string;
  name: string;
  api_key: string;
  endpoint: string;
  models: string[];
  selected_model: string;
  connected: boolean;
}

/**
 * 从本地 JSON 加载 AI 配置
 */
export async function loadAIConfig(): Promise<AIConfig | null> {
  try {
    const raw: AppConfigJson = await invoke("load_app_config");
    if (!raw.providers || raw.providers.length === 0) {
      return null; // 无配置，使用默认
    }
    const ds = raw.providers.find(p => p.id === "deepseek");
    console.log("[loadAIConfig] deepseek key loaded:", ds ? { keyPrefix: (ds.api_key || "").slice(0, 8), keyLen: (ds.api_key || "").length } : "not found");
    return {
      providers: raw.providers.map(p => ({
        id: p.id,
        name: p.name,
        api_key: p.api_key || "",
        endpoint: p.endpoint || "",
        models: p.models || [],
        selectedModel: p.selected_model || "",
        connected: p.connected || false,
      })),
      activeProviderId: raw.active_provider_id || raw.providers[0]?.id || "",
      max_tokens: raw.max_tokens || 4096,
      temperature: raw.temperature ?? 0.7,
      thinking_level: (raw.thinking_level as ThinkingLevel) || "medium",
      system_prompt: raw.system_prompt || "",
    };
  } catch (e) {
    console.error("loadAIConfig 失败:", e);
    return null;
  }
}

/**
 * 保存 AI 配置到本地 JSON
 */
export async function saveAIConfig(config: AIConfig): Promise<void> {
  try {
    const json: AppConfigJson = {
      providers: config.providers.map(p => ({
        id: p.id,
        name: p.name,
        api_key: p.api_key || "",
        endpoint: p.endpoint || "",
        models: p.models || [],
        selected_model: p.selectedModel || "",
        connected: p.connected || false,
      })),
      active_provider_id: config.activeProviderId || "",
      max_tokens: config.max_tokens ?? 4096,
      temperature: config.temperature ?? 0.7,
      thinking_level: config.thinking_level || "medium",
      system_prompt: config.system_prompt || "",
      theme: document.documentElement.classList.contains("light") ? "light" : "dark",
    };
    const ds = json.providers.find(p => p.id === "deepseek");
    console.log("[saveAIConfig] deepseek key save:", ds ? { keyPrefix: ds.api_key.slice(0, 8), keyLen: ds.api_key.length } : "not found");
    await invoke("save_app_config", { config: json });
  } catch (e) {
    console.error("saveAIConfig 失败:", e);
  }
}

/**
 * 保存主题
 */
export async function saveTheme(darkMode: boolean): Promise<void> {
  try {
    // 主题单独存为 setting（通过先读取再写回的方式）
    const raw: AppConfigJson = await invoke("load_app_config");
    raw.theme = darkMode ? "dark" : "light";
    await invoke("save_app_config", { config: raw });
  } catch (e) {
    console.error("saveTheme 失败:", e);
  }
}

/**
 * 加载主题
 */
export async function loadTheme(): Promise<boolean> {
  try {
    const raw: AppConfigJson = await invoke("load_app_config");
    return raw.theme !== "light";
  } catch {
    return true; // 默认深色
  }
}

// ─── 对话（conversations.json）───────────────────────────────

/**
 * 从本地 JSON 加载对话列表
 */
export async function loadConversationsFromStorage(): Promise<Conversation[]> {
  try {
    const raw: any[] = await invoke("load_conversations");
    return raw.map((r: any) => ({
      id: r.id,
      title: r.title || "",
      messages: r.messages || [],
      createdAt: typeof r.createdAt === "number" ? r.createdAt : new Date(r.createdAt || Date.now()).getTime(),
      updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : new Date(r.updatedAt || Date.now()).getTime(),
    }));
  } catch (e) {
    console.error("loadConversations 失败:", e);
    return [];
  }
}

/**
 * 保存对话列表到本地 JSON
 */
export async function saveConversationsToStorage(conversations: Conversation[]): Promise<void> {
  try {
    // 转为 Rust 端接受的格式（number timestamp → ISO string）
    const payload = conversations.map(c => ({
      id: c.id,
      title: c.title,
      messages: c.messages,
      createdAt: typeof c.createdAt === "number" ? new Date(c.createdAt).toISOString() : String(c.createdAt),
      updatedAt: typeof c.updatedAt === "number" ? new Date(c.updatedAt).toISOString() : String(c.updatedAt),
    }));
    await invoke("save_conversations", { conversations: payload });
  } catch (e) {
    console.error("saveConversations 失败:", e);
  }
}
