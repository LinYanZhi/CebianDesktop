import { useState, useEffect, useCallback, useRef } from "react";
import { Settings, MessageSquarePlus, Bot, History, Server, X, Trash2, Sun, Moon } from "lucide-react";
import ChatView from "./components/chat/ChatView";
import SettingsView from "./components/settings/SettingsView";
import { getTools, executeTool, confirmExecution, cancelExecution, startMcpServer, stopMcpServer } from "./lib/commands";
import { loadAIConfig, saveAIConfig, loadConversationsFromStorage, saveConversationsToStorage, loadTheme, saveTheme } from "./lib/db";
import type { Conversation, ChatMessage, AIConfig, SendAttachment, ToolCall, StreamState } from "./lib/types";
import { getActiveConfig } from "./lib/types";
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
  setPending: (p: any) => void,
  resolveRef: { current: ((value: string | null) => void) | null },
): Promise<string | null> {
  const form = parseAskUserArgs(args);

  // 先设置表单状态
  setPending({ toolCallId: "", ...form });

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
  setPending: (p: any) => void,
  resolveRef: { current: ((value: boolean) => void) | null },
): Promise<boolean> {
  setPending({ details, token });
  await yieldToUI();
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  return new Promise<boolean>((resolve) => {
    resolveRef.current = resolve;
  });
}

export default function App() {
  const [currentView, setCurrentView] = useState<"chat" | "settings">("chat");
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

  /** 交互式工具（ask_user）的等待状态 */
  const [pendingInteractive, setPendingInteractive] = useState<{
    toolCallId: string;
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

  /** 危险操作二次确认状态 */
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    details: any;
    token: string;
  } | null>(null);
  const confirmResolveRef = useRef<((value: boolean) => void) | null>(null);

  // 切换主题
  useEffect(() => {
    document.documentElement.classList.toggle("light", !darkMode);
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
          const partial: ChatMessage = {
            role: "assistant",
            content: state.fullContent,
            reasoning_content: state.fullThinking || undefined,
          };
          const msgs = [...state.prevMessages, partial];
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
      const partial: ChatMessage = {
        role: "assistant",
        content: streamState.fullContent,
        reasoning_content: streamState.fullThinking || undefined,
      };
      const msgs = [...streamState.prevMessages, partial];
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

  // 发送消息（流式）— 支持多会话并发，内置工具调用循环
  const handleSend = useCallback(
    async (content: string, _attachments?: SendAttachment[]) => {
      if (!content.trim()) return;

      const streamSessionId = currentSessionId;
      if (!streamSessionId) return;

      // 如果这个会话已经在流式，不允许重复发送
      if (activeStreamsRef.current.has(streamSessionId)) return;

      const userMsg: ChatMessage = { role: "user", content };
      const updated = [...messages, userMsg];
      updateCurrentConversation(updated);

      const placeholder: ChatMessage = { role: "assistant", content: "" };
      setMessages([...updated, placeholder]);
      forceRender((n) => n + 1); // 触发重渲染，UI 显示 loading 状态

      // 注册流状态
      const controller = new AbortController();
      (window as any).__streamController = controller;
      const streamState: StreamState = {
        controller,
        persistTimer: null,
        sessionId: streamSessionId,
        prevMessages: updated,
        fullContent: "",
        fullThinking: "",
      };
      activeStreamsRef.current.set(streamSessionId, streamState);

      let fullContent = "";
      let fullThinking = "";
      let currentMessages = [...updated];
      let accumulatedUsage: { input: number; output: number } | undefined;

      try {
        const active = getActiveConfig(aiConfig);
        if (!active.api_key.trim() || !active.endpoint.trim()) {
          toast.error("请先配置 AI 提供商");
          throw new Error("未配置 API");
        }
        console.log("[handleSend] calling streaming:", {
          endpoint: active.endpoint,
          model: active.model,
          session: streamSessionId,
          msgCount: updated.length,
        });

        // 获取工具定义（一次获取，全程复用）
        let toolDefs: any[] = [];
        try {
          toolDefs = await getTools();
          console.log(`[handleSend] 获取到 ${toolDefs.length} 个工具`);
        } catch (e) {
          console.warn("[handleSend] 获取工具列表失败:", e);
        }
        const openaiTools = toolDefs.map((t: any) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        }));

        // 启动定期持久化
        startStreamPersist(streamState);

        // ─── 消息校验：确保 tool 消息之前有对应的 assistant(tool_calls) ───
        // 避免 API 报 "Messages with role 'tool' must be a response to a preceding message with 'tool_calls'"
        for (let i = 0; i < currentMessages.length; i++) {
          const msg = currentMessages[i];
          if (msg.role === "tool") {
            // 查找前面的最后一条 assistant 消息
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
              i--; // 回退索引
            } else if (!msg.tool_call_id) {
              console.warn(`[handleSend] tool 消息缺少 tool_call_id，填充占位符`);
              (msg as any).tool_call_id = `fallback_${i}`;
            }
          }
        }

        // ─── 工具调用循环（最大 10 轮） ──────────────────────
        const MAX_TOOL_DEPTH = 10;
        for (let depth = 0; depth <= MAX_TOOL_DEPTH; depth++) {
          if (depth === MAX_TOOL_DEPTH) {
            throw new Error("工具调用超过最大递归深度");
          }

          // ── 上下文压缩：当消息数超过阈值时压缩早期对话 ──
          if (currentMessages.length > 30) {
            try {
              const compacted = await compactMessages(currentMessages, aiConfig);
              if (compacted !== currentMessages) {
                currentMessages = compacted;
                // 持久化压缩后的消息
                persistSessionMessages(streamSessionId, currentMessages);
                console.log("[handleSend] 上下文已压缩，当前消息数:", currentMessages.length);
              }
            } catch (e) {
              console.warn("[handleSend] 压缩失败，继续:", e);
            }
          }

          // 构建 API 消息（含 tool 角色消息）
          let systemPrompt = aiConfig.system_prompt || getDefaultSystemPrompt();
          const systemMsg: ChatMessage = { role: "system", content: systemPrompt };

          const apiMessages: any[] = [systemMsg];
          for (let i = 0; i < currentMessages.length; i++) {
            const msg = currentMessages[i];
            if (msg.role === "user") {
              apiMessages.push({ role: "user", content: msg.content });
            } else if (msg.role === "assistant") {
              const m: any = { role: "assistant", content: msg.content };
              if (msg.tool_calls && msg.tool_calls.length > 0) {
                m.tool_calls = msg.tool_calls.map((tc: ToolCall) => ({
                  id: tc.id,
                  type: "function",
                  function: { name: tc.function.name, arguments: tc.function.arguments },
                }));
              }
              apiMessages.push(m);
            } else if (msg.role === "tool") {
              apiMessages.push({
                role: "tool",
                content: msg.content,
                tool_call_id: msg.tool_call_id,
              });
            } else {
              apiMessages.push({ role: msg.role, content: msg.content });
            }
          }

          // 本轮内容积累
          let roundContent = "";
          // 按 index 积累工具调用（SSE 分块发送）
          const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>();

          const resp = await fetch(`${active.endpoint}/chat/completions`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${active.api_key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: active.model,
              messages: apiMessages,
              max_tokens: active.max_tokens,
              temperature: active.temperature,
              stream: true,
              stream_options: { include_usage: true },
              ...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
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
                // 捕获 token 用量（流末尾 chunk 携带）
                if (chunk.usage) {
                  accumulatedUsage = {
                    input: chunk.usage.prompt_tokens || 0,
                    output: chunk.usage.completion_tokens || 0,
                  };
                }
                const choices = chunk.choices;
                if (!choices || choices.length === 0) continue;
                const delta = choices[0].delta || {};

                if (delta.content) {
                  roundContent += delta.content;
                  fullContent += delta.content;
                  streamState.fullContent = fullContent;
                  // 仅在当前显示的会话是此流时才更新 UI
                  if (sessionIdRef.current === streamSessionId) {
                    setMessages((prev) => {
                      if (prev.length === 0) return prev;
                      const updatedMsgs = [...prev];
                      const last = updatedMsgs[updatedMsgs.length - 1];
                      if (last?.role === "assistant") {
                        updatedMsgs[updatedMsgs.length - 1] = {
                          ...last,
                          content: fullContent,
                          reasoning_content: fullThinking || undefined,
                        };
                      }
                      return updatedMsgs;
                    });
                  }
                }
                if (delta.reasoning_content) {
                  fullThinking += delta.reasoning_content || "";
                  streamState.fullThinking = fullThinking;
                  if (sessionIdRef.current === streamSessionId) {
                    setMessages((prev) => {
                      if (prev.length === 0) return prev;
                      const updatedMsgs = [...prev];
                      const last = updatedMsgs[updatedMsgs.length - 1];
                      if (last?.role === "assistant") {
                        updatedMsgs[updatedMsgs.length - 1] = {
                          ...last,
                          content: fullContent,
                          reasoning_content: fullThinking || undefined,
                        };
                      }
                      return updatedMsgs;
                    });
                  }
                }
                // ═══ 积累工具调用（SSE 分 chunk 发送，按 index 合并）═══
                if (delta.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const index = tc.index ?? 0;
                    if (!toolCallMap.has(index)) {
                      toolCallMap.set(index, { id: "", name: "", arguments: "" });
                    }
                    const entry = toolCallMap.get(index)!;
                    if (tc.id) entry.id += tc.id;
                    if (tc.function?.name) entry.name += tc.function.name;
                    if (tc.function?.arguments) entry.arguments += tc.function.arguments;
                  }
                }
              } catch {
                // 跳过无法解析的行
              }
            }
          }

          // 将积累的工具调用转换为 ToolCall 列表，按 index 排序
          const indices = Array.from(toolCallMap.keys()).sort((a, b) => a - b);
          const roundToolCalls: ToolCall[] = indices.map(idx => {
            const entry = toolCallMap.get(idx)!;
            return {
              id: entry.id,
              type: "function",
              function: { name: entry.name, arguments: entry.arguments },
            };
          });

          if (roundToolCalls.length === 0) {
            // ─── 没有工具调用 → 本轮就是最终结果 ───
            stopStreamPersist(streamState);
            const finalAssistantMsg: ChatMessage = {
              role: "assistant",
              content: fullContent,
              reasoning_content: fullThinking || undefined,
              usage: accumulatedUsage,
            };
            const finalMsgs = [...currentMessages, finalAssistantMsg];
            persistSessionMessages(streamSessionId, finalMsgs);
            if (sessionIdRef.current === streamSessionId) {
              setMessages(finalMsgs);
            }
            cleanupStream(streamSessionId);
            cleanupListeners();
            return;
          }

          // ─── 有工具调用 → 执行工具，继续下一轮 ───
          console.log(`[handleSend] 第 ${depth + 1} 轮检测到 ${roundToolCalls.length} 个工具调用`);

          // 构建 assistant 消息并加入历史
          const assistantMsg: ChatMessage = {
            role: "assistant",
            content: roundContent,
            tool_calls: roundToolCalls,
            reasoning_content: fullThinking || undefined,
          };
          currentMessages = [...currentMessages, assistantMsg];

          // 更新 UI 显示"正在执行工具..."
          persistSessionMessages(streamSessionId, currentMessages);
          if (sessionIdRef.current === streamSessionId) {
            setMessages([...currentMessages, { role: "assistant", content: "" } as ChatMessage]);
          }

          // 执行每个工具调用
          const toolResults: ChatMessage[] = [];
          for (const tc of roundToolCalls) {
            try {
              const args = JSON.parse(tc.function.arguments);
              const toolName = tc.function.name;

              // ── ask_user 交互式工具：展示内嵌表单/按钮卡片等待用户响应 ──
              if (toolName === "ask_user") {
                const userResponse = await askUserInteractive(
                  args,
                  setPendingInteractive,
                  interactiveResolveRef,
                );
                if (userResponse === null) {
                  toolResults.push({
                    role: "tool",
                    content: JSON.stringify({ cancelled: true, message: "用户已取消操作" }),
                    tool_call_id: tc.id,
                    name: toolName,
                  } as ChatMessage);
                } else {
                  toolResults.push({
                    role: "tool",
                    content: JSON.stringify({ response: userResponse }),
                    tool_call_id: tc.id,
                    name: toolName,
                  } as ChatMessage);
                }
                continue;
              }

              // ── 通用执行：调用后端 execute_tool，处理二次确认 ──
              console.log(`[handleSend] 执行工具: ${toolName}`, tc.function.arguments);
              const result = await executeTool(toolName, args);

              if (result && result.needs_confirmation) {
                // 后端返回 needs_confirmation → 需要用户二次确认
                const confirmed = await askConfirmation(
                  result.details,
                  result.token,
                  setPendingConfirmation,
                  confirmResolveRef,
                );
                if (confirmed) {
                  // 用户点击「运行」→ 调用 confirm_tool_execution 执行
                  const execResult = await confirmExecution(result.token);
                  toolResults.push({
                    role: "tool",
                    content: JSON.stringify(execResult, null, 2),
                    tool_call_id: tc.id,
                    name: toolName,
                  } as ChatMessage);
                } else {
                  // 用户点击「取消」→ 取消执行
                  await cancelExecution(result.token).catch(() => {});
                  toolResults.push({
                    role: "tool",
                    content: JSON.stringify({ error: `用户取消了 ${toolName} 操作` }),
                    tool_call_id: tc.id,
                    name: toolName,
                  } as ChatMessage);
                }
              } else {
                toolResults.push({
                  role: "tool",
                  content: JSON.stringify(result, null, 2),
                  tool_call_id: tc.id,
                  name: toolName,
                } as ChatMessage);
              }
            } catch (err: any) {
              console.error(`[handleSend] 工具执行失败: ${tc.function.name}`, err);
              toolResults.push({
                role: "tool",
                content: `工具执行失败: ${err.message || err}`,
                tool_call_id: tc.id,
                name: tc.function.name,
              } as ChatMessage);
            }
          }

          // 将工具结果加入消息列表
          currentMessages = [...currentMessages, ...toolResults];
          persistSessionMessages(streamSessionId, currentMessages);

          // 让出 UI 线程，让浏览器有机会渲染最新的消息和工具结果
          await yieldToUI();

          // 重置本轮内容，准备下一轮流式请求
          fullContent = "";
          fullThinking = "";
          streamState.fullContent = "";
          streamState.fullThinking = "";

          // 继续下一轮循环
        }
      } catch (err: any) {
        if (err?.name === "AbortError") {
          // 中止：保留已生成的部分内容，追加已取消标记
          stopStreamPersist(streamState);
          const cancelledMsg: ChatMessage = {
            role: "assistant",
            content: fullContent,
            reasoning_content: fullThinking || undefined,
            cancelled: true,
            usage: accumulatedUsage,
          };
          const cancelledMsgs = [...currentMessages, cancelledMsg];
          persistSessionMessages(streamSessionId, cancelledMsgs);
          if (sessionIdRef.current === streamSessionId) {
            setMessages(cancelledMsgs);
          }
          cleanupStream(streamSessionId);
          cleanupListeners();
          return;
        }
        console.error("[handleSend] 流式请求错误:", err);
        stopStreamPersist(streamState);
        const errMsg = `**错误**: ${err.message || "请求失败，请检查配置"}`;
        const errMsgs = [...currentMessages, { role: "assistant", content: errMsg } as ChatMessage];
        persistSessionMessages(streamSessionId, errMsgs);
        if (sessionIdRef.current === streamSessionId) {
          setMessages(errMsgs);
        }
        cleanupStream(streamSessionId);
        cleanupListeners();
      } finally {
        delete (window as any).__streamController;
      }
    },
    [
      messages, aiConfig, currentSessionId,
      updateCurrentConversation, persistSessionMessages, cleanupListeners,
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
    interactiveResolveRef.current?.(value);
    interactiveResolveRef.current = null;
    setPendingInteractive(null);
  }, []);

  /** 用户对二次确认对话框的响应 */
  const handleConfirmResolve = useCallback((confirmed: boolean) => {
    confirmResolveRef.current?.(confirmed);
    confirmResolveRef.current = null;
    setPendingConfirmation(null);
  }, []);

  // 停止当前会话的流式输出
  const handleStop = useCallback(() => {
    if (!currentSessionId) return;
    const streamState = activeStreamsRef.current.get(currentSessionId);
    if (streamState) {
      streamState.controller.abort();
      cleanupStream(currentSessionId);
    }
  }, [currentSessionId, cleanupStream]);

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
      setTimeout(() => handleSend(lastUserMsg.content), 0);
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
        const streamState = activeStreamsRef.current.get(id);
        if (streamState) {
          const partial: ChatMessage = {
            role: "assistant",
            content: streamState.fullContent,
            reasoning_content: streamState.fullThinking || undefined,
          };
          const liveMsgs = [...streamState.prevMessages, partial];
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
      if (msg.role === "user") {
        md += `## 用户\n\n${msg.content}\n\n`;
      } else if (msg.role === "assistant") {
          if (msg.tool_calls?.length) {
            md += `## 助手\n\n${msg.content || ""}\n\n`;
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
          md += `## 助手\n\n${msg.content}\n\n`;
        }
      } else if (msg.role === "tool") {
        md += `### 工具结果（${msg.name || "tool"}）\n\n\`\`\`\n${msg.content}\n\`\`\`\n\n`;
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
            if (currentView !== "settings") {
              historyBeforeSettingsRef.current = showHistory;
              setShowHistory(false);
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
                      <p className="truncate flex items-center gap-1.5">
                        {conv.title}
                        {isSessionStreaming(conv.id) && (
                          <span className="text-[0.55rem] text-primary font-medium">· 响应中</span>
                        )}
                      </p>
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
              onBack={() => setCurrentView("chat")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
