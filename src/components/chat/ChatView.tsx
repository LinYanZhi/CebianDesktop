import { useRef, useEffect, useState, memo, useCallback } from "react";
import {
  Bot, Mic, Brain, ChevronDown, Settings, ChevronRight, Lightbulb,
  Copy, Check, Paperclip, Globe, Search, X, Image, FileText,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, AIConfig, ThinkingLevel, SendAttachment } from "../../lib/types";
import { getActiveConfig } from "../../lib/types";

interface ChatViewProps {
  messages: ChatMessage[];
  onSend: (content: string, attachments?: SendAttachment[]) => void;
  loading: boolean;
  aiConfig: AIConfig;
  onConfigChange: (c: AIConfig) => void;
  onNavigateSettings: () => void;
}

const THINKING_OPTIONS: { key: ThinkingLevel; label: string }[] = [
  { key: "off", label: "关" },
  { key: "minimal", label: "极简" },
  { key: "low", label: "低" },
  { key: "medium", label: "中" },
  { key: "high", label: "高" },
];

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// ═══════════════════════════════════════════════════════════
//  复制按钮
// ═══════════════════════════════════════════════════════════

function CopyButton({ text }: { text: string }) {
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

// ═══════════════════════════════════════════════════════════
//  思考过程块
// ═══════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════
//  Markdown 渲染
// ═══════════════════════════════════════════════════════════

const MarkdownRenderer = memo(function MarkdownRenderer({ content }: { content: string }) {
  if (!content) return null;
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
            if (isBlock) return <code className={className} {...props}>{children}</code>;
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
          img: ({ src, alt }) => (
            <img src={src} alt={alt || ""} className="max-w-full rounded-lg my-2" loading="lazy" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════
//  AI 消息
// ═══════════════════════════════════════════════════════════

function AgentMessageBlock({ msg, isStreaming }: { msg: ChatMessage; isStreaming?: boolean }) {
  return (
    <div className="self-start w-full">
      <div className="flex items-center gap-2 mb-1.5">
        <Bot size={14} className="text-primary shrink-0" />
        <span className="font-medium text-xs text-muted-foreground">Cebian Agent</span>
      </div>
      {msg.reasoning_content && <ThinkingBlock content={msg.reasoning_content} isLive={isStreaming} />}
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

// ═══════════════════════════════════════════════════════════
//  模型选择器（可搜索）
// ═══════════════════════════════════════════════════════════

function ModelSelector({
  aiConfig, onNavigate, onModelSelect
}: {
  aiConfig: AIConfig; onNavigate: () => void; onModelSelect: (providerId: string, model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const active = getActiveConfig(aiConfig);
  const connectedProviders = aiConfig.providers.filter(p => p.connected);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setSearch(""); } };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open]);

  const configured = active.api_key.trim() !== "" && active.endpoint.trim() !== "";

  // 收集所有模型
  const allModels = connectedProviders.flatMap(p =>
    p.models.map(m => ({ providerId: p.id, providerName: p.name, model: m }))
  );
  const filtered = search.trim()
    ? allModels.filter(m =>
        m.model.toLowerCase().includes(search.toLowerCase()) ||
        m.providerName.toLowerCase().includes(search.toLowerCase())
      )
    : allModels;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors ${
          configured ? "text-muted-foreground hover:text-foreground hover:bg-accent"
          : "text-destructive hover:text-destructive hover:bg-destructive/10"
        }`}
      >
        <span className="max-w-28 truncate">{configured ? active.model : "未配置"}</span>
        <ChevronDown size={12} className="shrink-0" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-64 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden">
          {/* 搜索框 */}
          <div className="p-2 border-b border-border">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/50 rounded-lg">
              <Search size={12} className="text-muted-foreground shrink-0" />
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索模型..."
                className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
              />
            </div>
          </div>

          {/* 模型列表 */}
          <div className="max-h-64 overflow-y-auto p-1">
            {connectedProviders.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                <Settings size={20} className="mx-auto mb-2 opacity-40" />
                <p>尚未连接任何 AI 提供商</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                <p>未找到匹配的模型</p>
              </div>
            ) : (
              <div>
                {connectedProviders.map(provider => {
                  const providerModels = filtered.filter(m => m.providerId === provider.id);
                  if (providerModels.length === 0) return null;
                  return (
                    <div key={provider.id}>
                      <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        {provider.name}
                      </div>
                      {providerModels.map(({ model }) => (
                        <button
                          key={model}
                          onClick={() => { onModelSelect(provider.id, model); setOpen(false); setSearch(""); }}
                          className={`w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors flex items-center gap-2 ${
                            model === connectedProviders.find(p => p.id === provider.id)?.selectedModel
                              ? "bg-accent text-foreground font-medium"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground"
                          }`}
                        >
                          <Bot size={12} className="shrink-0 opacity-50" />
                          <span className="truncate">{model}</span>
                          {model === connectedProviders.find(p => p.id === provider.id)?.selectedModel && (
                            <Check size={10} className="ml-auto shrink-0 text-primary" />
                          )}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 底部门票 */}
          <div className="border-t border-border p-1">
            <button
              onClick={() => { onNavigate(); setOpen(false); setSearch(""); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <Settings size={12} />
              <span>前往设置添加更多提供商</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  思考级别选择器（Popover 下拉，仿 CeBian）
// ═══════════════════════════════════════════════════════════

function ThinkingLevelSelector({
  level, onSelect
}: {
  level: ThinkingLevel; onSelect: (v: ThinkingLevel) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = THINKING_OPTIONS.find(o => o.key === level);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <Brain size={12} className="shrink-0" />
        <span>{current?.label ?? level}</span>
        <ChevronDown size={12} className="shrink-0" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-36 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden p-1">
          {THINKING_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { onSelect(key); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors ${
                level === key
                  ? "bg-accent/50 text-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <span className="flex-1 text-left">{label}</span>
              <Check size={12} className={`shrink-0 text-primary transition-opacity ${level === key ? "opacity-100" : "opacity-0"}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  附件 Chips
// ═══════════════════════════════════════════════════════════

function AttachmentChips({
  attachments, onRemove
}: {
  attachments: SendAttachment[]; onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-4 pt-2">
      {attachments.map(att => (
        <div key={att.id}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent/50 border border-border text-xs text-muted-foreground max-w-48"
        >
          {att.type === "image" ? <Image size={12} /> : <FileText size={12} />}
          <span className="truncate flex-1">{att.name}</span>
          <button onClick={() => onRemove(att.id)}
            className="p-0.5 rounded hover:bg-accent hover:text-foreground transition-colors shrink-0"
          >
            <X size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  输入栏
// ═══════════════════════════════════════════════════════════

function ChatInput({
  inputValue, setInputValue, onSend, loading, aiConfig, onConfigChange, onNavigateSettings,
}: {
  inputValue: string; setInputValue: (v: string) => void;
  onSend: (attachments: SendAttachment[]) => void; loading: boolean;
  aiConfig: AIConfig; onConfigChange: (c: AIConfig) => void; onNavigateSettings: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<SendAttachment[]>([]);
  const [webSearch, setWebSearch] = useState(false);

  // 自动增高
  const adjustHeight = useCallback(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + "px";
  }, []);

  // 文件上传
  const handleFilePick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      const isImage = file.type.startsWith("image/");
      const data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      setAttachments(prev => [...prev, {
        id: generateId(),
        type: isImage ? "image" : "file",
        name: file.name,
        mimeType: file.type,
        data,
        size: file.size,
      }]);
    }
    e.target.value = "";
  };

  // 粘贴图片
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          const reader = new FileReader();
          reader.onload = () => {
            setAttachments(prev => [...prev, {
              id: generateId(),
              type: "image",
              name: `粘贴的图片 - ${file.name}`,
              mimeType: file.type,
              data: reader.result as string,
              size: file.size,
            }]);
          };
          reader.readAsDataURL(file);
        }
      }
    };
    el.addEventListener("paste", handler);
    return () => el.removeEventListener("paste", handler);
  }, []);

  // 清除附件
  const removeAttachment = (id: string) => setAttachments(prev => prev.filter(a => a.id !== id));

  // 模型选择
  const handleModelSelect = (providerId: string, model: string) => {
    onConfigChange({
      ...aiConfig,
      providers: aiConfig.providers.map(p => p.id === providerId ? { ...p, selectedModel: model } : p),
    });
  };

  // 发送
  const handleSend = () => {
    if (!inputValue.trim() || loading) return;
    onSend(attachments);
    setAttachments([]);
  };

  const active = getActiveConfig(aiConfig);
  const isReasoningModel = active.model.toLowerCase().includes("reason") || active.model.toLowerCase().includes("deepseek");

  return (
    <footer className="border-t border-border bg-background shrink-0">
      {/* 附件 chips */}
      <AttachmentChips attachments={attachments} onRemove={removeAttachment} />

      {/* 输入卡片 */}
      <div className="px-4 py-3">
        <div className="border border-input rounded-xl bg-card transition-shadow focus-within:ring-2 focus-within:ring-ring/20">
          {/* Top row: tools */}
          <div className="flex items-center gap-0.5 px-3 pt-2 pb-1">
            <button onClick={handleFilePick}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="上传文件"
            >
              <Paperclip size={14} />
            </button>
            <input ref={fileInputRef} type="file" multiple accept="image/*,.txt,.md,.js,.ts,.py,.json,.csv,.xml,.yaml,.yml"
              onChange={handleFileChange} className="hidden" />
            <button
              onClick={() => setWebSearch(!webSearch)}
              className={`p-1.5 rounded-md transition-colors ${
                webSearch
                  ? "text-primary bg-primary/10 hover:bg-primary/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
              title={webSearch ? "联网搜索已开启" : "联网搜索"}
            >
              <Globe size={14} />
            </button>
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => { setInputValue(e.target.value); adjustHeight(); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="输入消息..."
            rows={1}
            className="w-full bg-transparent resize-none px-4 py-2 text-sm outline-none placeholder:text-muted-foreground/50"
          />

          {/* Bottom row */}
          <div className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center gap-2">
              {/* 模型选择 */}
              <ModelSelector aiConfig={aiConfig} onNavigate={onNavigateSettings} onModelSelect={handleModelSelect} />

              {/* 思考级别 — 下拉选择（仿 CeBian Popover） */}
              {(isReasoningModel || aiConfig.thinking_level !== "off") && (
                <div className="border-l border-border pl-2">
                  <ThinkingLevelSelector
                    level={aiConfig.thinking_level}
                    onSelect={(level) => onConfigChange({ ...aiConfig, thinking_level: level })}
                  />
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-30"
                disabled title="语音输入"
              >
                <Mic size={15} />
              </button>
              <button onClick={handleSend} disabled={!inputValue.trim() || loading}
                className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "停止" : "发送"}
              </button>
            </div>
          </div>
        </div>

        {webSearch && (
          <div className="text-[10px] text-primary/70 mt-1.5 flex items-center gap-1">
            <Globe size={10} />
            <span>联网搜索已开启，AI 将自动获取最新信息</span>
          </div>
        )}
      </div>
    </footer>
  );
}

// ═══════════════════════════════════════════════════════════
//  主组件
// ═══════════════════════════════════════════════════════════

export default function ChatView({
  messages, onSend, loading, aiConfig, onConfigChange, onNavigateSettings
}: ChatViewProps) {
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 自动滚动
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const send = (attachments?: SendAttachment[]) => {
    if (!inputValue.trim() || loading) return;
    onSend(inputValue, attachments);
    setInputValue("");
  };

  // ── 欢迎页 ──
  if (messages.length === 0 && !loading) {
    return (
      <div className="flex-1 w-full min-w-0 flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center px-8 max-w-sm">
            <Bot size={48} className="mx-auto mb-4 text-primary/30" />
            <h2 className="text-lg font-semibold mb-1">开始新的对话</h2>
            <p className="text-sm text-muted-foreground mb-6">选择模型并输入消息开始交流</p>
            <div className="flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
              {aiConfig.providers.filter(p => p.connected).length > 0 ? (
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
          loading={loading} aiConfig={aiConfig}
          onConfigChange={onConfigChange} onNavigateSettings={onNavigateSettings} />
      </div>
    );
  }

  return (
    <div className="flex-1 w-full min-w-0 flex flex-col h-full">
      <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="flex flex-col gap-4 py-4 px-5">
          {messages.map((msg, i) =>
            msg.role === "user" ? (
              <div key={i} className="self-end max-w-[85%]">
                <div className="ml-auto w-fit max-w-full bg-card border border-border px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap break-words">
                  {msg.content}
                </div>
              </div>
            ) : (
              <AgentMessageBlock key={i} msg={msg} isStreaming={loading && i === messages.length - 1} />
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
      <ChatInput inputValue={inputValue} setInputValue={setInputValue}
        onSend={(atts) => send(atts)}
        loading={loading} aiConfig={aiConfig}
        onConfigChange={onConfigChange} onNavigateSettings={onNavigateSettings} />
    </div>
  );
}
