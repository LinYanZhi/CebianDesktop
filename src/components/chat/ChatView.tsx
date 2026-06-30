import { useState, useCallback, useEffect } from "react";
import { Bot, Settings, ArrowDown, FileText } from "lucide-react";
import type { ChatMessage, AIConfig, SendAttachment } from "../../lib/types";
import { hasUsableModel } from "../../lib/types";
import { toast } from "sonner";
import { useStickToBottom } from "./useStickToBottom";
import { UserMessageBlock, AgentMessageBlock } from "./MessageBlock";
import { AskUserBlock } from "./AskUser";
import { ChatInput } from "./ChatInput";

// ── 独立回底按钮组件（absolute 定位，放在父 relative 容器内） ──
// ⚠ 历史踩坑：此组件必须放在父 relative 容器内部（见下方第 300 行附近）。
//   移出 relative 容器会导致按钮定位错乱或消失（已修复 4 次）。
function ScrollToBottomButton({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  if (!visible) return null;
  return (
    <button
      onClick={onClick}
      className="absolute bottom-4 right-5 size-8 flex items-center justify-center rounded-full bg-background border border-border/60 shadow-md hover:bg-accent transition-colors z-10"
      title="回到底部"
    >
      <ArrowDown size={14} />
    </button>
  );
}

interface ChatViewProps {
  messages: ChatMessage[];
  onSend: (content: string, attachments?: SendAttachment[]) => void;
  onStop: () => void;
  onRetry: () => void;
  loading: boolean;
  aiConfig: AIConfig;
  onConfigChange: (c: AIConfig) => void;
  onNavigateSettings: () => void;
  /** 回滚到指定用户消息：删除该消息及之后所有消息，并把该消息内容填入输入框 */
  onRollback?: (index: number, content: string) => void;
  /** 待响应的交互式表单（ask_user） */
  pendingInteractive?: {
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
  } | null;
  /** 用户对交互式工具的响应（传入 JSON 字符串或 null 取消） */
  onInteractiveResolve?: (value: string | null) => void;
  /** 待响应的危险操作二次确认 */
  pendingConfirmation?: {
    details: {
      action: string;
      target: string;
      risk: string;
      description: string;
      args_detail: string;
    };
    token: string;
  } | null;
  /** 用户对二次确认的响应 */
  onConfirmResolve?: (confirmed: boolean) => void;
}

// ═══════════════════════════════════════════════════════════
//  主组件
// ═══════════════════════════════════════════════════════════

export default function ChatView({
  messages, onSend, onStop, onRetry, loading, aiConfig, onConfigChange, onNavigateSettings, onRollback,
  pendingInteractive, onInteractiveResolve, pendingConfirmation, onConfirmResolve,
}: ChatViewProps) {
  const INPUT_DRAFT_KEY = "cebiandesktop_chat_input_draft";
  const [inputValue, setInputValue] = useState(() => {
    try { return localStorage.getItem(INPUT_DRAFT_KEY) || ""; } catch { return ""; }
  });

  // 输入框内容变化时自动保存到 localStorage，防止断电丢失
  useEffect(() => {
    try { localStorage.setItem(INPUT_DRAFT_KEY, inputValue); } catch {}
  }, [inputValue]);

  const { containerRef, isAtBottom, scrollToBottom } = useStickToBottom();

  // 发送新消息时强制回底
  const send = (attachments?: SendAttachment[]) => {
    if (!inputValue.trim() || loading) return;
    if (!hasUsableModel(aiConfig)) {
      toast.error("请先配置 AI 提供商", {
        action: { label: "前往设置", onClick: onNavigateSettings },
      });
      return;
    }
    onSend(inputValue, attachments);
    setInputValue("");
    try { localStorage.removeItem(INPUT_DRAFT_KEY); } catch {}
  };

  // 本地回滚处理：通知父组件截断消息，同时本地设置输入内容
  const handleRollback = useCallback((index: number, content: string) => {
    onRollback?.(index, content);
    setInputValue(content);
  }, [onRollback]);

  // ── 欢迎页 ──
  if (messages.length === 0 && !loading) {
    return (
      <div className="flex-1 w-full min-w-0 flex flex-col h-full relative">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center px-8 max-w-sm">
            <Bot size={48} className="mx-auto mb-4 text-primary/30" />
            <h2 className="text-lg font-semibold mb-1">开始新的对话</h2>
            <p className="text-sm text-muted-foreground mb-6">
              {hasUsableModel(aiConfig) ? "选择模型并输入消息开始交流" : "配置 AI 提供商后即可开始对话"}
            </p>
            <div className="flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
              {hasUsableModel(aiConfig) ? (
                aiConfig.providers.filter(p => p.connected).slice(0, 3).map(p => (
                  <span key={p.id} className="px-2 py-1 rounded-full bg-accent/50 border border-border">
                    {p.name} · {p.selectedModel}
                  </span>
                ))
              ) : (
                <button onClick={onNavigateSettings}
                  className="px-4 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  <Settings size={14} className="inline mr-1" />
                  配置 AI 提供商
                </button>
              )}
            </div>
          </div>
        </div>
        <ChatInput inputValue={inputValue} setInputValue={setInputValue}
          onSend={(atts) => send(atts)}
          onStop={onStop}
          loading={loading} aiConfig={aiConfig}
          onConfigChange={onConfigChange} onNavigateSettings={onNavigateSettings} />
      </div>
    );
  }

  return (
    <div className="flex-1 w-full min-w-0 flex flex-col h-full">
      <div className="flex-1 min-h-0 relative">
        <div ref={containerRef} className="h-full overflow-y-auto overflow-x-hidden">
          {/* 累计 Token 用量 */}
          {(() => {
            const total = messages.reduce((acc, m) => {
              if (m.role === "assistant" && m.usage) {
                return acc + m.usage.input + m.usage.output;
              }
              return acc;
            }, 0);
            if (total <= 0) return null;
            return (
              <div className="sticky top-0 z-10 flex justify-center pt-2 pb-1 bg-gradient-to-b from-background to-transparent pointer-events-none">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/70 border border-border text-[0.55rem] text-muted-foreground/60 tabular-nums">
                  <span>累计消耗</span>
                  <span className="font-medium">{total.toLocaleString()}</span>
                  <span>tokens</span>
                </div>
              </div>
            );
          })()}
          <div className="flex flex-col gap-4 py-4 px-5">
            {(() => {
              // 收集后续 tool 消息，用于展示工具调用结果
              const skipIndices = new Set<number>();
              const items: React.ReactNode[] = [];
              for (let i = 0; i < messages.length; i++) {
                if (skipIndices.has(i)) continue;
                const msg = messages[i];

                if (msg.role === "user") {
                  items.push(<UserMessageBlock key={i} msg={msg} index={i} onRollback={handleRollback} />);
                } else if (msg.compacted) {
                  items.push(
                    <div key={i} className="flex justify-center">
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/50 border border-border text-[10px] text-muted-foreground">
                        <FileText size={10} />
                        <span>上下文已压缩 — 早期对话已折叠为摘要，减少 token 消耗</span>
                      </div>
                    </div>
                  );
                } else if (msg.role === "assistant") {
                  // 收集紧接着的 tool 消息作为工具结果
                const toolResults: ChatMessage[] = [];
                if (msg.tool_calls && msg.tool_calls.length > 0) {
                  let j = i + 1;
                  while (j < messages.length && messages[j].role === "tool") {
                    toolResults.push(messages[j]);
                    skipIndices.add(j);
                    j++;
                  }
                }
                items.push(
                  <AgentMessageBlock key={i} msg={msg}
                    isStreaming={loading && i === messages.length - 1}
                    isLast={i === messages.length - 1} onRetry={onRetry}
                    toolResults={toolResults.length > 0 ? toolResults : undefined}
                  />
                );
              }
              // tool 消息跳过（已在 Assistant 的 toolResults 中展示）
            }
            return items;
          })()}
          {/* 交互式工具卡片（ask_user） */}
          {pendingInteractive && (
            <AskUserBlock
              title={pendingInteractive.title}
              description={pendingInteractive.description}
              submit_label={pendingInteractive.submit_label}
              pagination={pendingInteractive.pagination}
              questions={pendingInteractive.questions}
              onResolve={onInteractiveResolve!}
            />
          )}
          {/* ═══ 危险操作二次确认对话框 ═══ */}
          {pendingConfirmation && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
              <div className="w-full max-w-md mx-4 bg-background border border-border rounded-xl shadow-2xl overflow-hidden">
                {/* 头部 */}
                <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
                  <div className={`size-10 rounded-full flex items-center justify-center text-lg font-bold ${
                    pendingConfirmation.details.risk === "high"
                      ? "bg-red-500/10 text-red-500"
                      : "bg-amber-500/10 text-amber-500"
                  }`}>
                    {pendingConfirmation.details.risk === "high" ? "⚠" : "!"}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">确认{pendingConfirmation.details.action}</h3>
                    <p className="text-xs text-muted-foreground">
                      风险等级：{pendingConfirmation.details.risk === "high" ? "高" : "中"}
                    </p>
                  </div>
                </div>
                {/* 内容 */}
                <div className="px-5 py-4 space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">操作描述</p>
                    <p className="text-sm">{pendingConfirmation.details.description}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">目标对象</p>
                    <pre className="text-sm font-mono bg-muted rounded-md px-3 py-2 break-all whitespace-pre-wrap">
                      {pendingConfirmation.details.target}
                    </pre>
                  </div>
                  {pendingConfirmation.details.args_detail && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">详细参数</p>
                      <pre className="text-[0.75rem] font-mono bg-muted rounded-md px-3 py-2 whitespace-pre-wrap" style={{ scrollbarWidth: 'thin', overflowX: 'auto' }}>
                        {pendingConfirmation.details.args_detail}
                      </pre>
                    </div>
                  )}
                </div>
                {/* 操作按钮 */}
                <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/30">
                  <button
                    onClick={() => onConfirmResolve?.(false)}
                    className="px-4 py-1.5 text-sm rounded-lg border border-border bg-background hover:bg-accent transition-colors text-muted-foreground"
                  >
                    取消
                  </button>
                  <button
                    onClick={() => onConfirmResolve?.(true)}
                    className={`px-4 py-1.5 text-sm rounded-lg text-white transition-colors ${
                      pendingConfirmation.details.risk === "high"
                        ? "bg-red-500 hover:bg-red-600"
                        : "bg-amber-500 hover:bg-amber-600"
                    }`}
                  >
                    运行
                  </button>
                </div>
              </div>
            </div>
          )}
          {loading && messages[messages.length - 1]?.role !== "assistant" && !pendingInteractive && (
            <div className="self-start w-full">
              <div className="flex items-center gap-2 mb-1.5">
                <Bot size={14} className="text-primary" />
                <span className="font-medium text-xs text-muted-foreground">Cebian Agent</span>
              </div>
              <span className="inline-block w-1.5 h-4 bg-primary rounded-sm animate-pulse align-text-bottom" />
            </div>
          )}
        </div>
        </div>
        {/*
          ═══ 置底按钮 ── ⚠ 绝对不要移出 `min-h-0 relative` 容器 ═══
          父容器 class="flex-1 min-h-0 relative" 在第 152 行。
          按钮是 absolute 定位，必须在该容器内才能正确计算 bottom: 1rem。
          曾因移出到外层 relative 导致按钮消失（已修复 4 次）。
        */}
        <ScrollToBottomButton visible={!isAtBottom} onClick={() => scrollToBottom({ force: true })} />
      </div>
      <ChatInput inputValue={inputValue} setInputValue={setInputValue}
        onSend={(atts) => send(atts)}
        onStop={onStop}
        loading={loading} aiConfig={aiConfig}
        onConfigChange={onConfigChange} onNavigateSettings={onNavigateSettings} />
    </div>
  );
}
