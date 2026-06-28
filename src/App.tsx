import { useState, useEffect, useCallback, useRef } from "react";
import { Settings, MessageSquarePlus, Bot, History, Server, X, Trash2, Sun, Moon } from "lucide-react";
import ChatView from "./components/chat/ChatView";
import SettingsView from "./components/settings/SettingsView";
import { startMcpServer, stopMcpServer } from "./lib/commands";
import { loadAIConfig, saveAIConfig, loadConversationsFromStorage, saveConversationsToStorage, loadTheme, saveTheme } from "./lib/db";
import type { Conversation, ChatMessage, AIConfig } from "./lib/types";
import { DEFAULT_PROVIDERS, getActiveConfig } from "./lib/types";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

const DEFAULT_AI_CONFIG: AIConfig = {
  providers: DEFAULT_PROVIDERS.map(p => ({ ...p })),
  activeProviderId: "openai",
  max_tokens: 4096,
  temperature: 0.7,
  thinking_level: "medium",
};

function createNewConversation(): Conversation {
  return {
    id: generateId(),
    title: "新对话",
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export default function App() {
  const [currentView, setCurrentView] = useState<"chat" | "settings">("chat");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [aiConfig, setAiConfig] = useState<AIConfig>(DEFAULT_AI_CONFIG);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverPort, setServerPort] = useState(8080);
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [historyWidth, setHistoryWidth] = useState(280);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const unlistenRef = useRef<(() => void)[]>([]);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  // 切换主题
  useEffect(() => {
    document.documentElement.classList.toggle("light", !darkMode);
    saveTheme(darkMode).catch(e => console.error("保存主题失败:", e));
  }, [darkMode]);

  // 初始化 - 从数据库加载所有数据
  useEffect(() => {
    (async () => {
      try {
        // 加载主题
        const savedDark = await loadTheme();
        setDarkMode(savedDark);

        // 加载 AI 配置
        const savedConfig = await loadAIConfig();
        console.log("[App] loadAIConfig result:", savedConfig ? {
          activeProviderId: savedConfig.activeProviderId,
          providerCount: savedConfig.providers.length,
          deepseekKeyLen: savedConfig.providers.find(p => p.id === "deepseek")?.api_key?.length,
        } : "null");
        if (savedConfig) {
          setAiConfig(savedConfig);
        }

        // 加载对话记录
        const loaded = await loadConversationsFromStorage();
        if (loaded && loaded.length > 0) {
          setConversations(loaded);
          const last = loaded[loaded.length - 1];
          setCurrentSessionId(last.id);
          setMessages(last.messages);
        } else {
          const fresh = createNewConversation();
          setConversations([fresh]);
          setCurrentSessionId(fresh.id);
        }
      } catch (e) {
        console.error("初始化加载数据失败:", e);
        const fresh = createNewConversation();
        setConversations([fresh]);
        setCurrentSessionId(fresh.id);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistConversations = useCallback((convs: Conversation[]) => {
    saveConversationsToStorage(convs).catch(e => console.error("保存对话失败:", e));
  }, []);

  // AI 配置变化时自动保存（防抖）
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveAIConfig(aiConfig).catch(e => console.error("保存 AI 配置失败:", e));
    }, 1000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [aiConfig]);

  const updateCurrentConversation = useCallback(
    (msgs: ChatMessage[]) => {
      setMessages(msgs);
      setConversations((prev) => {
        const existing = prev.find((c) => c.id === currentSessionId);
        if (!existing) return prev;
        const updated = prev.map((c) =>
          c.id === currentSessionId
            ? {
                ...c,
                messages: msgs,
                updatedAt: Date.now(),
                title:
                  c.title === "新对话" && msgs.length > 0 && msgs[0].role === "user"
                    ? msgs[0].content.slice(0, 30) + (msgs[0].content.length > 30 ? "..." : "")
                    : c.title,
              }
            : c
        );
        persistConversations(updated);
        return updated;
      });
    },
    [currentSessionId, persistConversations]
  );

  const cleanupListeners = useCallback(() => {
    unlistenRef.current.forEach((fn) => fn());
    unlistenRef.current = [];
  }, []);

  // 发送消息（流式）
  const handleSend = useCallback(
    async (content: string) => {
      if (!content.trim() || loading) return;
      const userMsg: ChatMessage = { role: "user", content };
      const updated = [...messages, userMsg];
      updateCurrentConversation(updated);

      const placeholder: ChatMessage = { role: "assistant", content: "" };
      const withPlaceholder = [...updated, placeholder];
      setMessages(withPlaceholder);
      setStreamingContent("");
      setStreamingThinking("");
      setLoading(true);

      try {
        const active = getActiveConfig(aiConfig);
        console.log("[handleSend] calling streaming with:", {
          endpoint: active.endpoint,
          model: active.model,
          apiKeyPrefix: active.api_key.slice(0, 8),
          apiKeyLen: active.api_key.length,
          msgCount: updated.length,
        });

        const systemMsg: ChatMessage = {
          role: "system",
          content: aiConfig.system_prompt || "你是一个有用的 AI 助手，可以通过 MCP 工具与外部系统交互。",
        };
        const apiMessages = [systemMsg, ...updated];

        // 直接在前端用 fetch 发起流式请求（参考 CeBian 的方式）
        const controller = new AbortController();
        // 保存 controller 用于可能的取消操作
        (window as any).__streamController = controller;

        const resp = await fetch(`${active.endpoint}/chat/completions`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${active.api_key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: active.model,
            messages: apiMessages.map(m => ({ role: m.role, content: m.content })),
            max_tokens: active.max_tokens,
            temperature: active.temperature,
            stream: true,
          }),
          signal: controller.signal,
        });

        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`HTTP ${resp.status} - ${body}`);
        }

        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // 本地累加器，确保流结束后能正确写入 messages
        let fullContent = "";
        let fullThinking = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const chunk = JSON.parse(data);
              const choices = chunk.choices;
              if (!choices || choices.length === 0) continue;
              const delta = choices[0].delta || {};

              if (delta.content) {
                fullContent += delta.content;
                setStreamingContent((prev) => prev + delta.content);
              }
              if (delta.reasoning_content) {
                fullThinking += delta.reasoning_content || "";
                setStreamingThinking((prev) => prev + (delta.reasoning_content || ""));
              }
            } catch {
              // 跳过无法解析的行
            }
          }
        }

        // 流式完成 — 最终写入 messages
        setMessages((prev) => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === "assistant") {
            updated[updated.length - 1] = {
              ...last,
              content: fullContent,
              reasoning_content: fullThinking || undefined,
            };
          }
          return updated;
        });
        cleanupListeners();
        setLoading(false);
      } catch (err: any) {
        console.error("[handleSend] 流式请求错误:", err);
        cleanupListeners();
        const errMsg: ChatMessage = {
          role: "assistant",
          content: `**错误**: ${err.message || "请求失败，请检查配置"}`,
        };
        setMessages((prev) => [...prev.slice(0, -1), errMsg]);
        setLoading(false);
      } finally {
        delete (window as any).__streamController;
      }
    },
    [messages, aiConfig, loading, updateCurrentConversation, cleanupListeners]
  );

  // 定期保存流式内容到消息
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant") {
          updated[updated.length - 1] = {
            ...last,
            content: streamingContent,
            reasoning_content: streamingThinking || undefined,
          };
        }
        return updated;
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [streamingContent, streamingThinking, loading]);

  // 选择对话
  const handleSelectSession = useCallback(
    (id: string) => {
      const conv = conversations.find((c) => c.id === id);
      if (conv) {
        setCurrentSessionId(id);
        setMessages(conv.messages);
      }
    },
    [conversations]
  );

  const handleNewSession = useCallback(() => {
    const fresh = createNewConversation();
    setConversations((prev) => {
      const updated = [...prev, fresh];
      persistConversations(updated);
      return updated;
    });
    setCurrentSessionId(fresh.id);
    setMessages([]);
  }, [persistConversations]);

  const handleDeleteSession = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setConversations((prev) => {
        const updated = prev.filter((c) => c.id !== id);
        persistConversations(updated);
        if (id === currentSessionId) {
          if (updated.length > 0) {
            setCurrentSessionId(updated[updated.length - 1].id);
            setMessages(updated[updated.length - 1].messages);
          } else {
            const fresh = createNewConversation();
            updated.push(fresh);
            persistConversations(updated);
            setCurrentSessionId(fresh.id);
            setMessages([]);
          }
        }
        return updated;
      });
    },
    [currentSessionId, persistConversations]
  );

  const handleStartServer = useCallback(async () => {
    try { await startMcpServer(serverPort); setServerRunning(true); } catch {}
  }, [serverPort]);

  const handleStopServer = useCallback(async () => {
    try { await stopMcpServer(); setServerRunning(false); } catch {}
  }, []);

  const currentConv = conversations.find((c) => c.id === currentSessionId);

  // 拖拽调整宽度
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: historyWidth };
    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = ev.clientX - dragRef.current.startX;
      const w = Math.max(180, Math.min(500, dragRef.current.startW + delta));
      setHistoryWidth(w);
    };
    const handleUp = () => { dragRef.current = null; };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp, { once: true });
  }, [historyWidth]);

  // 重命名对话
  const handleRenameStart = useCallback((id: string, title: string) => {
    setRenamingId(id);
    setEditingTitle(title);
  }, []);

  const handleRenameSave = useCallback((id: string) => {
    const t = editingTitle.trim();
    if (!t) { setRenamingId(null); return; }
    setConversations((prev) => {
      const updated = prev.map((c) => c.id === id ? { ...c, title: t, updatedAt: Date.now() } : c);
      persistConversations(updated);
      return updated;
    });
    setRenamingId(null);
  }, [editingTitle, persistConversations]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent, id: string) => {
    if (e.key === "Enter") { e.preventDefault(); handleRenameSave(id); }
    if (e.key === "Escape") setRenamingId(null);
  }, [handleRenameSave]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  };

  return (
    <div className={`h-screen flex flex-col overflow-hidden ${darkMode ? "" : "light"}`}
      style={{ background: darkMode ? "hsl(220,12%,5%)" : "hsl(60,9%,98%)", color: darkMode ? "hsl(220,8%,92%)" : "hsl(24,10%,10%)" }}>
      {/* ====== 顶部栏 ====== */}
      <header className="flex items-center justify-between px-3 py-2 border-b shrink-0"
        style={{ borderColor: darkMode ? "hsl(220,15%,25%)" : "hsl(20,6%,82%)", background: darkMode ? "hsl(220,12%,5%)" : "hsl(60,9%,98%)" }}>
        <div className="flex items-center gap-1">
          <button onClick={handleNewSession}
            disabled={currentView !== "chat"}
            className={`p-1.5 rounded-md transition-colors ${currentView !== "chat" ? "opacity-30 cursor-not-allowed" : "hover:bg-accent text-muted-foreground hover:text-foreground"}`}
            title="新建对话">
            <MessageSquarePlus size={18} />
          </button>
          <button onClick={() => setShowHistory(!showHistory)}
            disabled={currentView !== "chat"}
            className={`p-1.5 rounded-md transition-colors ${currentView !== "chat" ? "opacity-30 cursor-not-allowed" : showHistory ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
            title="历史记录">
            <History size={18} />
          </button>
        </div>

        <span className="text-sm font-medium truncate max-w-[200px]">
          {currentConv?.title || "新对话"}
        </span>

        <div className="flex items-center gap-1">
          <div className="flex items-center gap-1.5 mr-2">
            <Server size={12} className="text-muted-foreground" />
            <span className={`w-1.5 h-1.5 rounded-full ${serverRunning ? "bg-emerald-500" : "bg-destructive"}`} />
          </div>
          <button onClick={() => setDarkMode(!darkMode)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title={darkMode ? "切换浅色主题" : "切换深色主题"}>
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button onClick={() => {
            setCurrentView(currentView === "settings" ? "chat" : "settings");
            setShowHistory(false);
          }}
            className={`p-1.5 rounded-md transition-colors ${currentView === "settings" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
            title="设置">
            <Settings size={18} />
          </button>
        </div>
      </header>

      {/* ====== 主内容区域 ====== */}
      <div className="flex-1 flex overflow-hidden">
        {/* 历史面板：仅对话模式可用 */}
         {currentView === "chat" && (<>
        <div className={`shrink-0 border-r bg-card flex flex-col overflow-hidden transition-[width] duration-200 ease-out ${showHistory ? '' : 'w-0 !duration-200'}`}
          style={{
            width: showHistory ? historyWidth : 0,
            borderColor: darkMode ? "hsl(220,15%,25%)" : "hsl(20,6%,82%)",
            background: darkMode ? "hsl(220,15%,10%)" : "hsl(0,0%,100%)"
          }}>
          <div className="h-full flex flex-col" style={{ width: historyWidth }}>
            <div className="flex items-center justify-between px-4 py-3 border-b shrink-0"
              style={{borderColor: darkMode ? "hsl(220,15%,25%)" : "hsl(20,6%,82%)"}}>
              <h2 className="text-sm font-semibold">历史记录</h2>
              <button onClick={() => setShowHistory(false)}
                className="p-1 rounded-md hover:bg-accent text-muted-foreground">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {conversations.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">暂无对话</p>
              )}
              {[...conversations].reverse().map((conv) => (
                <div key={conv.id}
                  onClick={() => handleSelectSession(conv.id)}
                  className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${
                    conv.id === currentSessionId ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}>
                  <Bot size={14} className="shrink-0 text-primary" />
                  <div className="flex-1 min-w-0"
                    onDoubleClick={(e) => { e.stopPropagation(); handleRenameStart(conv.id, conv.title); }}>
                    {renamingId === conv.id ? (
                      <input
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={() => handleRenameSave(conv.id)}
                        onKeyDown={(e) => handleRenameKeyDown(e, conv.id)}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                        className="w-full bg-background border border-ring rounded px-1 py-0.5 text-xs outline-none"
                      />
                    ) : (
                      <p className="truncate">{conv.title}</p>
                    )}
                    <p className="text-xs text-muted-foreground">{formatTime(conv.updatedAt)}</p>
                  </div>
                  <button onClick={(e) => handleDeleteSession(e, conv.id)}
                    className="p-1 rounded hover:bg-background text-muted-foreground hover:text-destructive transition-colors">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 拖拽手柄 */}
        {showHistory && (
          <div
            onMouseDown={handleDragStart}
            className="w-[5px] shrink-0 cursor-col-resize hover:bg-primary/50 active:bg-primary transition-colors"
          />
        )}
        </>)}

        {/* 聊天/设置 */}
        <div className="flex-1 min-w-0 flex flex-col">
          {currentView === "chat" ? (
            <ChatView
              messages={messages}
              onSend={handleSend}
              loading={loading}
              streamingContent={streamingContent}
              streamingThinking={streamingThinking}
              aiConfig={aiConfig}
              onConfigChange={setAiConfig}
              onNavigateSettings={() => setCurrentView("settings")}
            />
          ) : (
            <SettingsView
              config={aiConfig}
              onConfigChange={setAiConfig}
              serverPort={serverPort}
              serverRunning={serverRunning}
              onStartServer={handleStartServer}
              onStopServer={handleStopServer}
              onPortChange={setServerPort}
              onBack={() => setCurrentView("chat")}
            />
          )}
        </div>
      </div>
    </div>
  );
}
