import { useState, useEffect, useCallback, useRef } from "react";
import { Settings, MessageSquarePlus, Bot, History, X, Trash2, Sun, Moon } from "lucide-react";
import ChatView from "./components/chat/ChatView";

import SettingsView from "./components/settings/SettingsView";
import { SkinPopover } from "./components/SkinPopover";
import { BridgeStatus } from "./components/BridgeStatus";
import { executeTool, confirmExecution, cancelExecution, startMcpServer, stopMcpServer } from "./lib/commands";
import { toolRegistry } from "./lib/tools";
import { loadAIConfig, saveAIConfig, loadConversationsFromStorage, saveConversationsToStorage, loadTheme, saveTheme } from "./lib/db";
import type { Conversation, ChatMessage, AIConfig, SendAttachment, ToolCall, StreamState } from "./lib/types";
import { getMessageText } from "./lib/types";
import { getActiveConfig } from "./lib/types";
import { Agent } from "./lib/agent";
import { DEFAULT_AI_CONFIG, TOOL_EXPORT_LABELS } from "./lib/constants";
import { yieldToUI, parseAskUserArgs, createNewConversation } from "./lib/utils";
import { getDefaultSystemPrompt } from "./lib/prompts";
import { compactMessages } from "./lib/compact";
import { toast } from "sonner";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

/**
 * 显示 ask_user 交互式对话框，等待用户响应 —— 通过 pendingInteractive 状态
 * 让 ChatView 渲染内嵌表单卡片，用户操作后 resolve。
 * 返回 JSON 字符串（各字段答案）或 null（取消）。
 *
 * 关键：setPending 后立即 yieldToUI()，让 React 有机会渲染表单UI，
 * 然后才阻塞等待用户输入，避免"卡住"。
 */
async function askUserInteractive(
  args: any,
  sessionId: string,
  setPending: (p: any) => void,
  resolveRef: { current: ((value: string | null) => void) | null },
  toolCallId?: string,
): Promise<string | null> {
  const form = parseAskUserArgs(args);

  // 先设置表单状态（带上 toolCallId + sessionId 用于会话内联匹配与隔离）
  setPending({ toolCallId: toolCallId || "", sessionId, ...form });

  // ── 让出 UI 线程，让 React 渲染表单后再等待用户输入 ──
  await yieldToUI();
  // 再等一帧确保动画起始帧已经渲染
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

  // 然后才阻塞等待用户响应
  return new Promise<string | null>((resolve) => {
    resolveRef.current = resolve;
  });
}

/**
 * 危险操作二次确认 —— 暂停流程，展示确认对话框等待用户决策。
 * 返回 true 表示用户点击「运行」，false 表示用户点击「取消」。
 */
async function askConfirmation(
  details: any,
  token: string,
  sessionId: string,
  setPending: (p: any) => void,
  resolveRef: { current: ((value: boolean) => void) | null },
  aiExplanation?: string,
): Promise<boolean> {
  setPending({ details, token, sessionId, aiExplanation });
  await yieldToUI();
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  return new Promise<boolean>((resolve) => {
    resolveRef.current = resolve;
  });
}

/** localStorage key 用于持久化 ask_user 待处理表单（重启恢复） */
const PENDING_INTERACTIVE_KEY = "cebiandesktop_pending_interactive";

export default function App() {
  const [currentView, setCurrentView] = useState<"chat" | "settings">("chat");
  const [settingsSection, setSettingsSection] = useState<string | undefined>(undefined);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [aiConfig, setAiConfig] = useState<AIConfig>(DEFAULT_AI_CONFIG);
  const [serverRunning, setServerRunning] = useState(false);
  const [serverPort, setServerPort] = useState(8080);
  const [showHistory, setShowHistory] = useState(false);
  const historyBeforeSettingsRef = useRef(false); // 进入设置前保存历史状态
  const [darkMode, setDarkMode] = useState(window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [historyWidth, setHistoryWidth] = useState(280);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [ctxConv, setCtxConv] = useState<{ x: number; y: number; id: string } | null>(null);
  const unlistenRef = useRef<(() => void)[]>([]);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  /** 渲染触发器：activeStreamsRef 变化时触发重渲染 */
  const [, forceRender] = useState(0);
  /** 所有进行中的流，key = 会话 ID */
  const activeStreamsRef = useRef<Map<string, StreamState>>(new Map());

  /** 交互式工具（ask_user）的等待状态（按 sessionId 隔离） */
  const [pendingInteractive, setPendingInteractive] = useState<{
    toolCallId: string;
    sessionId: string;
    title?: string;
    description?: string;
    submit_label?: string;
    pagination?: {
      type: "wizard";
      show_progress?: boolean;
      allow_skip?: boolean;
      allow_review?: boolean;
    };
    questions: Array<{
      id: string;
      type: string;
      question: string;
      message?: string;
      placeholder?: string;
      options?: { label: string; value: string; description?: string; recommended?: boolean }[];
      required?: boolean;
      allow_free_text?: boolean;
      min_select?: number;
      max_select?: number;
      step?: number;
      step_title?: string;
    }>;
  } | null>(null);
  const interactiveResolveRef = useRef<((value: string | null) => void) | null>(null);

  /** 危险操作二次确认状态（按 sessionId 隔离） */
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    details: any;
    token: string;
    sessionId: string;
  } | null>(null);
  const confirmResolveRef = useRef<((value: boolean) => void) | null>(null);
  /** 工具执行取消标记（按 sessionId 隔离） */
  const cancelledSessionsRef = useRef<Set<string>>(new Set());
  /** Agent 实例 Map（按 sessionId 隔离，支持多会话并发） */
  const agentMapRef = useRef<Map<string, Agent>>(new Map());
  /** 当前工具调用轮次（由 onToolCalls 更新，供 executeToolCallsForAgent 使用） */
  const currentRoundRef = useRef(0);

  // 切换主题 + HTML 背景色
  useEffect(() => {
    document.documentElement.classList.toggle("light", !darkMode);
    const bg = darkMode ? "hsl(220,12%,5%)" : "hsl(60,9%,98%)";
    document.documentElement.style.backgroundColor = bg;
    saveTheme(darkMode).catch(e => console.error("保存主题失败:", e));
  }, [darkMode]);

  // 应用主题色
  useEffect(() => {
    const hue = aiConfig.primary_hue ?? 200;
    document.documentElement.style.setProperty("--primary-hue", String(hue));
  }, [aiConfig.primary_hue]);

  // 初始化 - 从数据库加载所有数据
  useEffect(() => {
    (async () => {
      try {
        const savedDark = await loadTheme();
        setDarkMode(savedDark);

        const savedConfig = await loadAIConfig();
        if (savedConfig) {
          setAiConfig(savedConfig);
          // 恢复上次浏览位置
          if (savedConfig.viewState?.currentView === "settings") {
            setCurrentView("settings");
            if (savedConfig.viewState.settingsSection) {
              setSettingsSection(savedConfig.viewState.settingsSection);
            }
          }
        }

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

        // 恢复持久化的 pendingInteractive（重启后恢复提问状态）
        try {
          const saved = localStorage.getItem(PENDING_INTERACTIVE_KEY);
          if (saved) {
            const parsed = JSON.parse(saved);
            // 检查关联的会话是否还存在
            const convs = loaded && loaded.length > 0 ? loaded : [];
            if (convs.find((c: Conversation) => c.id === parsed.sessionId)) {
              setPendingInteractive(parsed);
            } else {
              localStorage.removeItem(PENDING_INTERACTIVE_KEY);
            }
          }
        } catch {
          localStorage.removeItem(PENDING_INTERACTIVE_KEY);
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

  // 保持 sessionIdRef 与 state 同步
  useEffect(() => {
    sessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  // 保持 messagesRef 与 state 同步
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // pendingInteractive 自动持久化到 localStorage（重启后恢复）
  // 仅持久化未解决的表单（过滤 _resolved 状态），且不保存运行时动态字段
  useEffect(() => {
    if (pendingInteractive && !(pendingInteractive as any)._resolved) {
      const toStore = (({ _resolved, _submittedValue, ...rest }) => rest)(pendingInteractive as any);
      localStorage.setItem(PENDING_INTERACTIVE_KEY, JSON.stringify(toStore));
    } else {
      localStorage.removeItem(PENDING_INTERACTIVE_KEY);
    }
  }, [pendingInteractive]);

  // 浏览位置变化时自动保存到配置
  useEffect(() => {
    setAiConfig(prev => ({
      ...prev,
      viewState: {
        ...(prev.viewState || {}),
        currentView,
        settingsSection: settingsSection || "",
      },
    }));
  }, [currentView, settingsSection]);

  // visibilitychange：用户切换页面时，保存所有进行中的流
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState !== "hidden") return;
      // 收集所有活跃流的数据并持久化
      const streams = activeStreamsRef.current;
      if (streams.size === 0) return;
      setConversations((prev) => {
        let updated = [...prev];
        for (const [, state] of streams) {
          // 使用 currentMessages（包含完整的 tool_calls + tool results）
          // 如果 currentMessages 有数据，用它；否则回退到 prevMessages + partial
          let msgs: ChatMessage[];
          if (state.currentMessages && state.currentMessages.length > state.prevMessages.length) {
            msgs = state.currentMessages;
          } else {
            const partial: ChatMessage = {
              role: "assistant",
              content: state.fullContent,
              reasoning_content: state.fullThinking || undefined,
            };
            msgs = [...state.prevMessages, partial];
          }
          updated = updated.map((c) =>
            c.id === state.sessionId ? { ...c, messages: msgs, updatedAt: Date.now() } : c
          );
        }
        persistConversations(updated);
        return updated;
      });
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [persistConversations]);

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

  /** 持久化指定会话的消息（不修改 currentSessionId 相关逻辑） */
  const persistSessionMessages = useCallback(
    (sessionId: string, msgs: ChatMessage[], title?: string) => {
      setConversations((prev) => {
        const existing = prev.find((c) => c.id === sessionId);
        if (!existing) return prev;
        const updated = prev.map((c) =>
          c.id === sessionId
            ? {
                ...c,
                messages: msgs,
                updatedAt: Date.now(),
                title:
                  title ??
                  (c.title === "新对话" && msgs.length > 0 && msgs[0].role === "user"
                    ? msgs[0].content.slice(0, 30) + (msgs[0].content.length > 30 ? "..." : "")
                    : c.title),
              }
            : c
        );
        persistConversations(updated);
        return updated;
      });
    },
    [persistConversations]
  );

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

  /** 启动一个流的定期持久化（每 800ms） */
  const startStreamPersist = (streamState: StreamState) => {
    if (streamState.persistTimer) clearTimeout(streamState.persistTimer);
    const doPersist = () => {
      // 如果流已被移除，不再续 timer
      if (!activeStreamsRef.current.has(streamState.sessionId)) return;
      // 优先用 currentMessages（包含 tool_calls），回退到 prevMessages + partial
      let msgs: ChatMessage[];
      if (streamState.currentMessages && streamState.currentMessages.length > streamState.prevMessages.length) {
        msgs = streamState.currentMessages;
      } else {
        const partial: ChatMessage = {
          role: "assistant",
          content: streamState.fullContent,
          reasoning_content: streamState.fullThinking || undefined,
        };
        msgs = [...streamState.prevMessages, partial];
      }
      persistSessionMessages(streamState.sessionId, msgs);
      streamState.persistTimer = setTimeout(doPersist, 800);
    };
    streamState.persistTimer = setTimeout(doPersist, 800);
  };

  /** 停止一个流的定时器 */
  const stopStreamPersist = (streamState: StreamState) => {
    if (streamState.persistTimer) {
      clearTimeout(streamState.persistTimer);
      streamState.persistTimer = null;
    }
  };

  /** 清理一个流的所有资源 */
  const cleanupStream = (sessionId: string) => {
    const state = activeStreamsRef.current.get(sessionId);
    if (!state) return;
    stopStreamPersist(state);
    activeStreamsRef.current.delete(sessionId);
    forceRender((n) => n + 1);
  };

  /**
   * 当 Agent 进入 awaiting_tool 状态时，由 onStateChange 触发。
   * 从 currentMessages 中找到最后一轮的 tool_calls，依次执行每个工具，
   * 然后通过 agent.resolveTools() 把结果传回 Agent 循环。
   */
  const executeToolCallsForAgent = useCallback(async (
    agent: Agent,
    currentMsgs: ChatMessage[],
    sessionId: string,
    _roundDepth: number,
  ) => {
    // 如果会话已被取消，直接返回
    if (cancelledSessionsRef.current.has(sessionId)) {
      agent.resolveTools([]);
      return;
    }

    // 找到最后一条 assistant 消息中的 tool_calls 和 AI 解释
    let lastToolCalls: ToolCall[] = [];
    let aiExplanation = ""; // AI 执行工具前的思考/解释
    for (let i = currentMsgs.length - 1; i >= 0; i--) {
      const msg = currentMsgs[i];
      if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
        lastToolCalls = msg.tool_calls;
        aiExplanation = getMessageText(msg);
        break;
      }
    }
    if (lastToolCalls.length === 0) {
      agent.resolveTools([]);
      return;
    }

    const isCancelled = () => cancelledSessionsRef.current.has(sessionId);
    const toolResults: ChatMessage[] = [];

    for (const tc of lastToolCalls) {
      if (isCancelled()) break;

      let toolExecContent = "";
      const toolName = tc.function.name;

      try {
        const args = JSON.parse(tc.function.arguments);

        // ── ask_user ──
        if (toolName === "ask_user") {
          const userResponse = await askUserInteractive(
            args, sessionId,
            setPendingInteractive,
            interactiveResolveRef,
            tc.id,
          );
          // 先记录工具结果（即使已取消也要推，让工具卡片状态更新为 "cancelled"）
          toolExecContent = userResponse === null
            ? JSON.stringify({ cancelled: true, message: "用户已取消操作" })
            : JSON.stringify({ response: userResponse });
          toolResults.push({
            role: "tool", content: toolExecContent,
            tool_call_id: tc.id, name: toolName,
          } as ChatMessage);
          if (isCancelled()) break;
          continue;
        }

        // ── 通用执行 ──
        console.log(`[Agent] 执行工具: ${toolName}`, tc.function.arguments);
        const result = await executeTool(toolName, args, aiConfig.aiPermissionMode);

        if (result && result.needs_confirmation) {
          // 取消时不弹确认框，直接标记已取消
          if (isCancelled()) {
            toolExecContent = JSON.stringify({ error: "用户已取消操作" });
          } else {
            const confirmed = await askConfirmation(
              result.details, result.token, sessionId,
              setPendingConfirmation, confirmResolveRef, aiExplanation,
            );
            if (isCancelled()) {
              await cancelExecution(result.token).catch(() => {});
              toolExecContent = JSON.stringify({ error: "用户已取消操作" });
            } else if (confirmed) {
              const execResult = await confirmExecution(result.token);
              toolExecContent = JSON.stringify(execResult, null, 2);
            } else {
              await cancelExecution(result.token).catch(() => {});
              toolExecContent = JSON.stringify({ error: `用户取消了 ${toolName} 操作` });
            }
          }
        } else {
          if (toolName === "ask_browser_ai" && result && typeof result === "object" && result.summary) {
            toolExecContent = result.summary;
            if (result.conversation_id) {
              toolExecContent += `\n\n> 💡 会话延续 ID: \`${result.conversation_id}\` —— 下次调用 ask_browser_ai 时传入此 ID 可延续浏览器 AI 的上下文`;
            }
          } else {
          // 剥离大型二进制数据，避免上下文膨胀
          let processedResult = result;
          if (result && typeof result === "object" && !Array.isArray(result)) {
            const r = result as Record<string, unknown>;
            if ((toolName === "take_screenshot" || toolName === "capture_screen") && typeof r.data === "string" && (r.data as string).length > 1000) {
              processedResult = { ...r, data: `[base64 data: ${(r.data as string).length} chars]` };
            }
          }
          toolExecContent = JSON.stringify(processedResult, null, 2);
        }
        }
      } catch (err: any) {
        // 取消时也产生结果（标记为 cancelled），让卡片更新状态
        if (isCancelled() || err?.name === "AbortError") {
          toolExecContent = JSON.stringify({ cancelled: true, message: "工具执行被中止" });
        } else {
          console.error(`[Agent] 工具执行失败: ${tc.function.name}`, err);
          toolExecContent = `工具执行失败: ${err.message || err}`;
        }
      }

      // 无论是否取消，都记录工具结果（让卡片能显示最终状态）
      if (toolExecContent) {
        toolResults.push({
          role: "tool", content: toolExecContent,
          tool_call_id: tc.id, name: tc.function.name,
        } as ChatMessage);
      }
      if (isCancelled()) break;
      await yieldToUI();
    }

    if (isCancelled()) {
      // 把已收集的工具结果传给 Agent（包含 cancelled 状态），让 onDone 包含完整消息
      agent.resolveTools(toolResults);
      agentMapRef.current.delete(sessionId);
      return;
    }

    agent.resolveTools(toolResults);
  }, [aiConfig, setPendingInteractive, interactiveResolveRef, setPendingConfirmation, confirmResolveRef]);

  /**
   * 用 ref 始终指向最新的 executeToolCallsForAgent，
   * 确保已运行的 Agent 在 onStateChange 中能读取到最新的权限设置。
   */
  const executeToolCallsRef = useRef(executeToolCallsForAgent);
  useEffect(() => {
    executeToolCallsRef.current = executeToolCallsForAgent;
  }, [executeToolCallsForAgent]);

  // 发送消息（流式）— 使用 Agent 层管理 SSE + 工具调用循环
  const handleSend = useCallback(
    async (content: string, _attachments?: SendAttachment[]) => {
      if (!content.trim()) return;

      const streamSessionId = currentSessionId;
      if (!streamSessionId) return;

      // 如果这个会话已经在流式，不允许重复发送
      if (activeStreamsRef.current.has(streamSessionId)) return;

      // 新消息发送时清除已提交的表单（仅当前会话的）
      if (pendingInteractive?.sessionId === streamSessionId) {
        setPendingInteractive(null);
      }

      const userMsg: ChatMessage = {
        role: "user",
        content,
        attachments: _attachments?.filter(a => a.type === 'file' && a.path),
      };
      const updated = [...messages, userMsg];
      updateCurrentConversation(updated);

      const placeholder: ChatMessage = { role: "assistant", content: "" };
      setMessages([...updated, placeholder]);
      forceRender((n) => n + 1); // 触发重渲染，UI 显示 loading 状态

      // 重置取消标记（按 sessionId 隔离）
      cancelledSessionsRef.current.delete(streamSessionId);

      // 注册流状态
      const controller = new AbortController();
      (window as any).__streamController = controller;
      const streamState: StreamState = {
        controller,
        persistTimer: null,
        sessionId: streamSessionId,
        prevMessages: updated,
        currentMessages: updated,
        fullContent: "",
        fullThinking: "",
      };
      activeStreamsRef.current.set(streamSessionId, streamState);

      let fullContent = "";
      let currentMessages = [...updated];

      // ─── 消息校验：确保 tool 消息之前有对应的 assistant(tool_calls) ───
      for (let i = 0; i < currentMessages.length; i++) {
        const msg = currentMessages[i];
        if (msg.role === "tool") {
          let hasPreceding = false;
          for (let j = i - 1; j >= 0; j--) {
            const prev = currentMessages[j];
            if (prev.role === "assistant" && prev.tool_calls && prev.tool_calls.length > 0) {
              hasPreceding = true;
              break;
            }
            if (prev.role === "user" || prev.role === "system") break;
          }
          if (!hasPreceding) {
            console.warn(`[handleSend] 孤立的 tool 消息 (tool_call_id=${msg.tool_call_id})，移除`);
            currentMessages.splice(i, 1);
            i--;
          } else if (!msg.tool_call_id) {
            console.warn(`[handleSend] tool 消息缺少 tool_call_id，填充占位符`);
            (msg as any).tool_call_id = `fallback_${i}`;
          }
        }
      }

      // 上下文压缩：当消息数超过 30 条时，自动将旧消息压缩为摘要
      try {
        currentMessages = await compactMessages(currentMessages, aiConfig);
      } catch {
        // compactMessages 失败不影响主流程
      }

      try {
        const active = getActiveConfig(aiConfig);
        if (!active.api_key.trim() || !active.endpoint.trim()) {
          toast.error("请先配置 AI 提供商");
          throw new Error("未配置 API");
        }

        // 获取工具定义（通过 ToolRegistry 统一加载）
        try {
          await toolRegistry.refresh();
        } catch (e) {
          console.warn("[handleSend] 刷新工具列表失败:", e);
        }
        const openaiTools = toolRegistry.toOpenAITools();

        // 构建 system prompt
        let systemPrompt = aiConfig.system_prompt || getDefaultSystemPrompt();
        const permissionMode = aiConfig.aiPermissionMode || "safe";
        const permissionDesc = permissionMode === "trusted"
          ? "\n\n[安全设置] 当前模式：信任模式 — 所有工具调用自动执行，无需用户确认。请谨慎操作。\n[路径权限] 允许在工作区目录、用户目录（桌面/下载/文档）、临时目录和网络共享路径（UNC/映射驱动器）内读写。系统关键目录（C:\\Windows、Program Files 等）和破坏性命令被硬性拦截。"
          : "\n\n[安全设置] 当前模式：安全模式 — 写入/编辑/删除文件、执行命令等操作均需用户确认。\n[路径权限] 允许在工作区目录、用户目录（桌面/下载/文档）、临时目录和网络共享路径（UNC/映射驱动器）内读写。系统关键目录（C:\\Windows、Program Files 等）和破坏性命令被硬性拦截。\n\n[批量操作指引] 如果需要批量操作多个文件，请使用 tools/files 或 tools/operations 数组参数一次完成，避免多次确认弹窗。例如：delete_path({paths:[...]})、write_new_file({files:[...]})、download_file({files:[...]})、batch_rename({operations:[...]})。";
        systemPrompt += permissionDesc;

        // 启动定期持久化
        startStreamPersist(streamState);

        // ─── 创建 Agent ───
        const agent = new Agent({
          config: {
            endpoint: active.endpoint,
            model: active.model,
            apiKey: active.api_key,
            maxTokens: active.max_tokens,
            temperature: active.temperature,
            systemPrompt,
          },
          events: {
            onToken: ({ content, thinking }) => {
              fullContent = content;
              streamState.fullContent = content;
              streamState.fullThinking = thinking || "";
              if (sessionIdRef.current === streamSessionId) {
                setMessages((prev) => {
                  const updatedMsgs = [...prev];
                  const last = updatedMsgs[updatedMsgs.length - 1];
                  if (last?.role === "assistant") {
                    // 更新最后一条 assistant 消息（正常流式场景）
                    updatedMsgs[updatedMsgs.length - 1] = {
                      ...last,
                      content,
                      reasoning_content: thinking || undefined,
                    };
                  } else {
                    // 最后一条不是 assistant（如在多轮工具调用后新一轮开始），
                    // 需要追加新的 assistant 占位，避免覆盖上一轮的思考/工具调用
                    updatedMsgs.push({
                      role: "assistant",
                      content,
                      reasoning_content: thinking || undefined,
                    });
                  }
                  return updatedMsgs;
                });
              }
            },

            /** 流式工具调用参数逐步构建，实时更新 UI 让用户看到参数在填充 */
            onToolCallStream: (toolCalls) => {
              if (sessionIdRef.current === streamSessionId) {
                setMessages((prev) => {
                  const updatedMsgs = [...prev];
                  const last = updatedMsgs[updatedMsgs.length - 1];
                  // 确保最后一条是 assistant 消息，然后更新 tool_calls
                  if (last?.role === "assistant") {
                    updatedMsgs[updatedMsgs.length - 1] = {
                      ...last,
                      tool_calls: toolCalls as any,
                    };
                  } else {
                    // 如果还没有 assistant 消息（极少见），追加一条
                    updatedMsgs.push({
                      role: "assistant",
                      content: "",
                      tool_calls: toolCalls as any,
                    });
                  }
                  return updatedMsgs;
                });
              }
            },

            onToolCalls: (_toolCalls, round) => {
              currentRoundRef.current = round;
            },

            onRoundComplete: (msgs) => {
              currentMessages = msgs;
              streamState.currentMessages = msgs;
              persistSessionMessages(streamSessionId, msgs);
              // 同步 UI 状态，确保下一轮 onToken 时 setMessages 的 prev
              // 包含完整的消息列表（含上一轮的 assistant + tool 结果），
              // 避免 onToken 错误地覆盖上一轮的消息
              if (sessionIdRef.current === streamSessionId) {
                setMessages(msgs);
              }
            },

            onDone: (finalMessages, _usage) => {
              currentMessages = finalMessages;
              stopStreamPersist(streamState);
              persistSessionMessages(streamSessionId, finalMessages);
              if (sessionIdRef.current === streamSessionId) {
                setMessages(finalMessages);
              }
              cleanupStream(streamSessionId);
              cleanupListeners();
              agentMapRef.current.delete(streamSessionId);
            },

            onError: (err) => {
              console.error("[handleSend] Agent 错误:", err);
              stopStreamPersist(streamState);
              const errMsg = `**错误**: ${err.message || "请求失败，请检查配置"}`;
              const errMsgs = [...currentMessages, { role: "assistant", content: errMsg } as ChatMessage];
              persistSessionMessages(streamSessionId, errMsgs);
              if (sessionIdRef.current === streamSessionId) {
                setMessages(errMsgs);
              }
              cleanupStream(streamSessionId);
              cleanupListeners();
              agentMapRef.current.delete(streamSessionId);
            },

            onStateChange: (state) => {
              if (state === "awaiting_tool" as any) {
                executeToolCallsRef.current(agent, currentMessages, streamSessionId, currentRoundRef.current);
              }
            },
          },
        });

        agentMapRef.current.set(streamSessionId, agent);
        agent.send(currentMessages, openaiTools);

        // ─── 异步等待 Agent 完成 ───
        // Agent 内部通过事件驱动，这里不需要等待
      } catch (err: any) {
        stopStreamPersist(streamState);
        if (err?.name === "AbortError") {
          // 找到最后一个 assistant 消息，标记为已取消（保留 tool_calls）
          let lastAssistantIdx = -1;
          for (let i = currentMessages.length - 1; i >= 0; i--) {
            if ((currentMessages[i] as ChatMessage).role === "assistant") {
              lastAssistantIdx = i;
              break;
            }
          }
          let cancelledMsgs: ChatMessage[];
          if (lastAssistantIdx >= 0) {
            cancelledMsgs = [...currentMessages];
            cancelledMsgs[lastAssistantIdx] = {
              ...cancelledMsgs[lastAssistantIdx],
              cancelled: true,
              content: (cancelledMsgs[lastAssistantIdx] as ChatMessage).content || fullContent,
            };
          } else {
            cancelledMsgs = [...currentMessages, { role: "assistant", content: fullContent || "已取消", cancelled: true } as ChatMessage];
          }
          persistSessionMessages(streamSessionId, cancelledMsgs);
          if (sessionIdRef.current === streamSessionId) {
            setMessages(cancelledMsgs);
          }
        } else {
          console.error("[handleSend] 流式请求错误:", err);
          const errMsg = `**错误**: ${err.message || "请求失败，请检查配置"}`;
          const errMsgs = [...currentMessages, { role: "assistant", content: errMsg } as ChatMessage];
          persistSessionMessages(streamSessionId, errMsgs);
          if (sessionIdRef.current === streamSessionId) {
            setMessages(errMsgs);
          }
        }
        cleanupStream(streamSessionId);
        cleanupListeners();
        agentMapRef.current.delete(streamSessionId);
      } finally {
        delete (window as any).__streamController;
      }
    },
    [
      messages, aiConfig, currentSessionId,
      updateCurrentConversation, persistSessionMessages, cleanupListeners,
      executeToolCallsForAgent, pendingInteractive,
    ]
  );

  // 回滚到指定用户消息：删除该消息及之后所有消息，并把内容填入输入框
  const handleRollback = useCallback((index: number) => {
    if (!currentSessionId) return;
    if (activeStreamsRef.current.has(currentSessionId)) return;
    setMessages((prev) => {
      const truncated = prev.slice(0, index);
      updateCurrentConversation(truncated);
      return truncated;
    });
  }, [currentSessionId, updateCurrentConversation]);

  /** 用户对交互式工具的响应 */
  const handleInteractiveResolve = useCallback((value: string | null) => {
    // 持久化表单已清除
    localStorage.removeItem(PENDING_INTERACTIVE_KEY);

    if (interactiveResolveRef.current) {
      // 正常在线场景：resolve Promise 让 Agent 继续
      interactiveResolveRef.current(value);
      interactiveResolveRef.current = null;
      setPendingInteractive(prev => (prev ? { ...prev, _resolved: true, _submittedValue: value } : null));
    } else {
      // 重启恢复场景：resolveRef 已不存在（Agent 已销毁）
      // 清除表单，如果用户提交了内容，作为新消息发送让 AI 继续
      setPendingInteractive(null);
      if (value !== null && currentSessionId) {
        let answerText = value;
        try {
          const parsed = JSON.parse(value);
          answerText = parsed.response || value;
        } catch { /* 保持原始值 */ }
        // 在下一帧触发发送，确保状态已更新
        setTimeout(() => {
          handleSend(`[继续] ${answerText}`);
        }, 0);
      }
    }
  }, [currentSessionId, handleSend]);

  /** 用户对二次确认对话框的响应 */
  const handleConfirmResolve = useCallback((confirmed: boolean) => {
    confirmResolveRef.current?.(confirmed);
    confirmResolveRef.current = null;
    setPendingConfirmation(null);
  }, []);

  // 停止当前会话的流式输出
  const handleStop = useCallback(() => {
    const sessionId = currentSessionId;
    if (!sessionId) return;
    // 标记该会话已取消（按 sessionId 隔离）
    cancelledSessionsRef.current.add(sessionId);

    // 1. 关闭待处理的交互式对话框（ask_user，仅当前会话的）
    if (interactiveResolveRef.current && pendingInteractive?.sessionId === sessionId) {
      interactiveResolveRef.current(null);
      interactiveResolveRef.current = null;
      // 标记为已解决（保留表单展示只读已取消视图，而非直接消失）
      setPendingInteractive(prev => prev ? { ...prev, _resolved: true, _submittedValue: null } : null);
    }

    // 2. 关闭待处理的二次确认对话框（仅当前会话的）
    if (confirmResolveRef.current && pendingConfirmation?.sessionId === sessionId) {
      confirmResolveRef.current(false);
      confirmResolveRef.current = null;
      setPendingConfirmation(null);
    }

    // 3. 通知桥接层取消浏览器 AI 正在执行的任务
    invoke("cancel_browser_ai").catch(() => {});

    // 4. 优雅地停止 Agent：保留 toolResolve，让 executeToolCallsForAgent
    //    能推完已执行工具的结果后主动 resolveTools，工具卡片更新最终状态
    const agent = agentMapRef.current.get(sessionId);
    const streamState = activeStreamsRef.current.get(sessionId);
    if (agent) {
      agent.stopGracefully();
      // 不 delete — executeToolCallsForAgent 推完结果后会 resolveTools + 清理
    }
    if (streamState) {
      streamState.controller.abort();
      cleanupStream(sessionId);
    }
  }, [currentSessionId, cleanupStream, pendingConfirmation, pendingInteractive]);

  // 重试：删除最后一条助手消息，重新发送最后一条用户消息
  const handleRetry = useCallback(() => {
    if (!currentSessionId) return;
    if (activeStreamsRef.current.has(currentSessionId)) return;
    setMessages((prev) => {
      // 找到最后一条 user 消息
      let lastUserIdx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === "user") { lastUserIdx = i; break; }
      }
      if (lastUserIdx === -1) return prev;
      const lastUserMsg = prev[lastUserIdx];
      const truncated = prev.slice(0, lastUserIdx + 1);
      // 异步发送
      setTimeout(() => handleSend(getMessageText(lastUserMsg)), 0);
      return truncated;
    });
  }, [currentSessionId, handleSend]);

  // 选择对话 — 不再 abort 其他会话的流，只是切换视图
  const handleSelectSession = useCallback(
    (id: string) => {
      const conv = conversations.find((c) => c.id === id);
      if (conv) {
        setCurrentSessionId(id);
        // 如果此会话有进行中的流，从流状态重建消息（比持久化状态更新）
        // 优先使用 currentMessages（包含 tool_calls，由 onRoundComplete 更新），
        // 回退到 prevMessages + partial（流刚开始时）
        const streamState = activeStreamsRef.current.get(id);
        if (streamState) {
          let liveMsgs: ChatMessage[];
          if (streamState.currentMessages && streamState.currentMessages.length > streamState.prevMessages.length) {
            liveMsgs = streamState.currentMessages;
          } else {
            const partial: ChatMessage = {
              role: "assistant",
              content: streamState.fullContent,
              reasoning_content: streamState.fullThinking || undefined,
            };
            liveMsgs = [...streamState.prevMessages, partial];
          }
          setMessages(liveMsgs);
        } else {
          setMessages(conv.messages);
        }
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
      // 如果这个会话正在流式，中止它
      const streamState = activeStreamsRef.current.get(id);
      if (streamState) {
        streamState.controller.abort();
        cleanupStream(id);
      }
      setConversations((prev) => {
        const updated = prev.filter((c) => c.id !== id);
        persistConversations(updated);
        if (id === currentSessionId) {
          if (updated.length > 0) {
            // 找到第一个不是当前会话的活跃流会话，显示它
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
  const isCurrentStreaming = currentSessionId ? activeStreamsRef.current.has(currentSessionId) : false;

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

  // 导出对话为 Markdown 文件
  const handleExportConversation = useCallback(async (id: string) => {
    const conv = conversations.find(c => c.id === id);
    if (!conv) return;
    let md = `# ${conv.title || "对话导出"}\n\n`;
    md += `> 导出时间：${new Date().toLocaleString("zh-CN")}\n\n---\n\n`;
    for (const msg of conv.messages) {
      const text = getMessageText(msg);
      if (msg.role === "user") {
        md += `## 用户\n\n${text}\n\n`;
      } else if (msg.role === "assistant") {
          if (msg.tool_calls?.length) {
            md += `## 助手\n\n${text || ""}\n\n`;
            for (const tc of msg.tool_calls) {
              const toolName = tc.function.name;
              const toolLabel = TOOL_EXPORT_LABELS[toolName]?.label || toolName;
              const toolDesc = TOOL_EXPORT_LABELS[toolName]?.desc || "";
              const argsObj = (() => { try { return JSON.parse(tc.function.arguments); } catch { return null; } })();
              const argsStr = argsObj && Object.keys(argsObj).length > 0 ? `\`\`\`json\n${JSON.stringify(argsObj, null, 2)}\n\`\`\`` : "";
              md += `### 调用工具：${toolLabel}\n\n`;
              if (toolDesc) md += `> ${toolDesc}\n\n`;
              if (argsStr) md += `${argsStr}\n\n`;
            }
        } else {
          md += `## 助手\n\n${text}\n\n`;
        }
      } else if (msg.role === "tool") {
        md += `### 工具结果（${msg.name || "tool"}）\n\n\`\`\`\n${text}\n\`\`\`\n\n`;
      } else if (msg.role === "compactionSummary") {
        md += `## 上下文压缩摘要\n\n${text}\n\n`;
      }
    }
    try {
      const filePath = await save({
        defaultPath: `${conv.title || "对话"}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!filePath) return; // 用户取消
      await invoke("write_file_to_path", { path: filePath, content: md });
      setCtxConv(null);
      toast.success("对话已导出");
    } catch (e: any) {
      toast.error(`导出失败: ${e}`);
    }
  }, [conversations]);

  // 关闭右键菜单
  useEffect(() => {
    if (!ctxConv) return;
    const close = () => setCtxConv(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [ctxConv]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  };

  // 在历史列表中显示某个会话是否正在流式
  const isSessionStreaming = (id: string) => activeStreamsRef.current.has(id);

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
          <BridgeStatus onNavigateToBridge={() => {
            historyBeforeSettingsRef.current = showHistory;
            setShowHistory(false);
            setSettingsSection("bridge");
            setCurrentView("settings");
          }} />
          <button onClick={() => setDarkMode(!darkMode)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title={darkMode ? "切换浅色主题" : "切换深色主题"}>
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <SkinPopover config={aiConfig} onChange={setAiConfig} />
          <button onClick={() => {
            if (currentView !== "settings") {
              historyBeforeSettingsRef.current = showHistory;
              setShowHistory(false);
              setSettingsSection(undefined);
              setCurrentView("settings");
            } else {
              setCurrentView("chat");
              setShowHistory(historyBeforeSettingsRef.current);
            }
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
        <div className={`shrink-0 border-r bg-card flex flex-col overflow-hidden transition-[width] duration-200 ease-out ${showHistory ? '' : 'w-0 border-r-0 !duration-200'}`}
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
                  onContextMenu={(e) => { e.preventDefault(); setCtxConv({ x: e.clientX, y: e.clientY, id: conv.id }); }}
                  className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${
                    conv.id === currentSessionId
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  }`}>
                  <div className="relative shrink-0">
                    <Bot size={14} className="text-primary" />
                    {isSessionStreaming(conv.id) && (
                      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary animate-pulse" />
                    )}
                  </div>
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
                      <p className="truncate">
                        {conv.title}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      {isSessionStreaming(conv.id) && (
                        <span className="text-primary font-medium">· 响应中</span>
                      )}
                      <span>{formatTime(conv.updatedAt)}</span>
                    </p>
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

        {/* 对话右键菜单 */}
        {ctxConv && (
          <>
            <div className="fixed inset-0 z-50" onClick={() => setCtxConv(null)} />
            <div className="fixed z-50 w-36 bg-popover border border-border rounded-lg shadow-lg py-1 text-xs"
              style={{ left: ctxConv.x, top: ctxConv.y }}>
              <button onClick={() => { handleRenameStart(ctxConv.id, conversations.find(c => c.id === ctxConv.id)?.title || ""); setCtxConv(null); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-left">
                <span className="size-4 shrink-0 flex items-center justify-center text-[10px]">✎</span>
                重命名
              </button>
              <button onClick={() => handleExportConversation(ctxConv.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-left">
                <span className="size-4 shrink-0 flex items-center justify-center text-[10px]">↓</span>
                另存为
              </button>
            </div>
          </>
        )}

        {/* 拖拽手柄 */}
        {showHistory && (
          <div
            onMouseDown={handleDragStart}
            className="w-[5px] shrink-0 cursor-col-resize hover:bg-primary/50 active:bg-primary transition-colors"
          />
        )}
        </>)}

        {/* 聊天/设置 — 同时渲染，设置层叠在聊天上方用 transition 滑入滑出 */}
        <div className="flex-1 min-w-0 flex flex-col relative overflow-hidden">
          <ChatView
            messages={messages}
            onSend={handleSend}
            onStop={handleStop}
            onRetry={handleRetry}
            loading={isCurrentStreaming}
            aiConfig={aiConfig}
            onConfigChange={setAiConfig}
            onNavigateSettings={() => setCurrentView("settings")}
            onRollback={handleRollback}
            currentSessionId={currentSessionId ?? undefined}
            pendingInteractive={pendingInteractive}
            onInteractiveResolve={handleInteractiveResolve}
            pendingConfirmation={pendingConfirmation}
            onConfirmResolve={handleConfirmResolve}
          />

          <div
            className={`absolute inset-0 z-10 bg-background transition-all duration-[350ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
              currentView === "settings"
                ? "translate-x-0 opacity-100"
                : "translate-x-full opacity-0 pointer-events-none"
            }`}
          >
            <SettingsView
              config={aiConfig}
              onConfigChange={setAiConfig}
              serverPort={serverPort}
              serverRunning={serverRunning}
              onStartServer={handleStartServer}
              onStopServer={handleStopServer}
              onPortChange={setServerPort}
              onBack={() => {
                setCurrentView("chat");
                setSettingsSection(undefined);
                setShowHistory(historyBeforeSettingsRef.current);
              }}
              defaultSection={settingsSection}
              onSectionChange={(section) => setSettingsSection(section)}
            />
          </div>
        </div>
      </div>

    </div>
  );
}
