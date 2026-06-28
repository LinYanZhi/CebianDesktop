import { useRef, useEffect, useState, memo } from "react";
import { Bot, Mic, Brain, ChevronDown, Settings, ChevronRight, Lightbulb, Copy, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, AIConfig, ThinkingLevel } from "../../lib/types";
import { getActiveConfig } from "../../lib/types";

interface ChatViewProps {
  messages: ChatMessage[];
  onSend: (content: string) => void;
  loading: boolean;
  streamingContent: string;
  streamingThinking: string;
  aiConfig: AIConfig;
  onConfigChange: (c: AIConfig) => void;
  onNavigateSettings: () => void;
}

const THINKING_OPTIONS: { key: ThinkingLevel; label: string }[] = [
  { key: "low", label: "低" },
  { key: "medium", label: "中" },
  { key: "high", label: "高" },
];

// ─── 复制按钮 ───────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      title="复制"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

// ─── 思考块 ────────────────────────────────────────────────

function ThinkingBlock({ content, isLive }: { content: string; isLive?: boolean }) {
  const [open, setOpen] = useState(isLive ?? false);
  useEffect(() => {
    if (isLive) setOpen(true);
  }, [isLive]);

  if (!content) return null;

  return (
    <div className="border border-border rounded-lg overflow-hidden mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors select-none"
      >
        <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        <Lightbulb size={12} />
        <span>{isLive ? "思考中..." : "思考过程"}</span>
      </button>
      <div className={`grid transition-[grid-template-rows] duration-300 ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="overflow-hidden">
          <div className="px-3 pb-2 text-xs text-muted-foreground/80 italic leading-relaxed whitespace-pre-wrap">
            {content}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Markdown 渲染 ─────────────────────────────────────────

const MarkdownRenderer = memo(function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="max-w-none wrap-break-word text-sm leading-relaxed space-y-3">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => (
            <pre className="bg-background/50 border border-border rounded-lg p-3 overflow-x-auto text-sm font-mono leading-relaxed my-2">
              {children}
            </pre>
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = className?.startsWith("language-");
            if (isBlock) {
              return <code className={className} {...props}>{children}</code>;
            }
            return (
              <code className="bg-accent/50 text-accent-foreground px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                {children}
              </code>
            );
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:text-primary/80">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="border-collapse border border-border rounded-lg text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border border-border px-3 py-1.5 bg-muted/50 text-left font-medium">{children}</th>,
          td: ({ children }) => <td className="border border-border px-3 py-1.5">{children}</td>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/30 pl-4 italic text-muted-foreground my-2">{children}</blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

// ─── AI 消息组件 ───────────────────────────────────────────

function AgentMessageBlock({ msg, isStreaming }: { msg: ChatMessage; isStreaming?: boolean }) {
  return (
    <div className="self-start w-full">
      <div className="flex items-center gap-2 mb-1.5">
        <Bot size={14} className="text-primary shrink-0" />
        <span className="font-medium text-xs text-muted-foreground">Cebian Agent</span>
      </div>
      {msg.reasoning_content && <ThinkingBlock content={msg.reasoning_content} />}
      <div className="text-sm leading-relaxed">
        <MarkdownRenderer content={msg.content || ""} />
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-primary rounded-sm animate-pulse ml-0.5 align-text-bottom" />
        )}
      </div>
      {!isStreaming && msg.content && (
        <div className="flex items-center gap-1 mt-1">
          <CopyButton text={msg.content} />
        </div>
      )}
    </div>
  );
}

// ─── 模型选择器 ────────────────────────────────────────────

function ModelSelector({ aiConfig, onNavigate, onModelSelect }: { aiConfig: AIConfig; onNavigate: () => void; onModelSelect: (providerId: string, model: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = getActiveConfig(aiConfig);
  const connectedProvider = aiConfig.providers.find(p => p.connected);
  const configured = active.api_key.trim() !== "" && active.endpoint.trim() !== "";

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors ${
          configured
            ? "text-muted-foreground hover:text-foreground hover:bg-accent"
            : "text-destructive hover:text-destructive hover:bg-destructive/10"
        }`}>
        <span>{configured ? active.model : "未配置"}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-52 bg-popover border border-border rounded-lg shadow-lg p-1 z-50 max-h-80 overflow-y-auto">
          {configured && connectedProvider ? (
            <>
              <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border mb-1">{connectedProvider.name}</div>
              {connectedProvider.models.map(m => (
                <button key={m}
                  onClick={() => { onModelSelect(connectedProvider.id, m); setOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 rounded text-xs transition-colors ${
                    m === connectedProvider.selectedModel
                      ? "bg-accent text-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}>
                  {m}
                </button>
              ))}
              <div className="border-t border-border mt-1 pt-1">
                <button onClick={() => { onNavigate(); setOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                  <Settings size={12} />
                  <span>前往设置管理模型</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="px-3 py-2 text-xs text-destructive border-b border-border mb-1">尚未配置 AI 模型</div>
              <button onClick={() => { onNavigate(); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                <Settings size={12} />
                <span>前往设置管理模型</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 输入框组件 ────────────────────────────────────────────

function ChatInput({
  inputValue, setInputValue, onSend, loading, aiConfig, onConfigChange, onNavigateSettings
}: {
  inputValue: string; setInputValue: (v: string) => void; onSend: () => void; loading: boolean;
  aiConfig: AIConfig; onConfigChange: (c: AIConfig) => void; onNavigateSettings: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleModelSelect = (providerId: string, model: string) => {
    onConfigChange({
      ...aiConfig,
      providers: aiConfig.providers.map(p => p.id === providerId ? { ...p, selectedModel: model } : p),
    });
  };

  const handleInput = () => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 192) + "px";
  };

  return (
    <footer className="px-4 py-3 border-t border-border bg-background">
      <div className="border border-input rounded-xl bg-card focus-within:ring-2 focus-within:ring-ring/20 transition-shadow">
        <textarea
          ref={textareaRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
          onInput={handleInput}
          placeholder="输入消息..."
          rows={1}
          className="w-full bg-transparent resize-none px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-between px-3 pb-3">
          <div className="flex items-center gap-2">
            <ModelSelector aiConfig={aiConfig} onNavigate={onNavigateSettings} onModelSelect={handleModelSelect} />
            <div className="flex items-center gap-0.5 border-l border-border pl-2 ml-1">
              <Brain size={12} className="text-muted-foreground" />
              {THINKING_OPTIONS.map(({ key, label }) => (
                <button key={key} onClick={() => onConfigChange({ ...aiConfig, thinking_level: key })}
                  className={`px-1.5 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    aiConfig.thinking_level === key
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-30" disabled title="语音输入">
              <Mic size={15} />
            </button>
            <button onClick={onSend} disabled={!inputValue.trim() || loading}
              className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {loading ? "停止" : "发送"}
            </button>
          </div>
        </div>
      </div>
      <div className="text-[10px] text-muted-foreground/50 text-center mt-1">
        Enter 发送 · Shift+Enter 换行
      </div>
    </footer>
  );
}

// ─── 主组件 ────────────────────────────────────────────────

export default function ChatView({
  messages, onSend, loading, streamingContent, streamingThinking, aiConfig, onConfigChange, onNavigateSettings
}: ChatViewProps) {
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, streamingContent, streamingThinking, loading]);

  const send = () => {
    const text = inputValue.trim();
    if (!text || loading) return;
    onSend(text);
    setInputValue("");
  };

  // ── 欢迎页 ──
  if (messages.length === 0 && !loading) {
    return (
      <div className="flex-1 w-full min-w-0 flex flex-col">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center px-6">
            <Bot size={48} className="mx-auto mb-4 text-primary/30" />
            <h2 className="text-lg font-semibold mb-1">开始新的对话</h2>
            <p className="text-sm text-muted-foreground">输入消息与 AI 助手交流</p>
          </div>
        </div>
        <ChatInput inputValue={inputValue} setInputValue={setInputValue} onSend={send} loading={loading}
          aiConfig={aiConfig} onConfigChange={onConfigChange} onNavigateSettings={onNavigateSettings} />
      </div>
    );
  }

  return (
    <div className="flex-1 w-full min-w-0 flex flex-col">
      <div ref={containerRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex flex-col gap-4 py-4 px-5">
          {messages.map((msg, i) =>
            msg.role === "user" ? (
              <div key={i} className="self-end max-w-[85%]">
                <div className="ml-auto w-fit bg-card border border-border px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap break-words">
                  {msg.content}
                </div>
              </div>
            ) : (
              <AgentMessageBlock
                key={i}
                msg={msg}
                isStreaming={loading && i === messages.length - 1}
              />
            )
          )}
          {loading && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="self-start w-full">
              <div className="flex items-center gap-2 mb-1.5">
                <Bot size={14} className="text-primary" />
                <span className="font-medium text-xs text-muted-foreground">Cebian Agent</span>
              </div>
              <span className="inline-block w-1.5 h-4 bg-primary rounded-sm animate-pulse align-text-bottom" />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>
      <ChatInput inputValue={inputValue} setInputValue={setInputValue} onSend={send} loading={loading}
        aiConfig={aiConfig} onConfigChange={onConfigChange} onNavigateSettings={onNavigateSettings} />
    </div>
  );
}
