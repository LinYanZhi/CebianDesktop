import { useRef, useEffect, useState, memo, useCallback } from "react";
import {
  Bot, Mic, Brain, ChevronDown, Settings, ChevronRight, Lightbulb,
  Copy, Check, Paperclip, Globe, Search, X, Image, FileText, Square, RefreshCw, Undo2, ArrowUp,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, AIConfig, ThinkingLevel, SendAttachment, ToolCall } from "../../lib/types";
import { getActiveConfig, hasUsableModel } from "../../lib/types";
import { listPrompts, replaceTemplateVars } from "../../lib/prompts";
import type { Prompt } from "../../lib/prompts";
import { useSpeechRecognition } from "../../lib/useSpeechRecognition";
import { toast } from "sonner";

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
    }>;
  } | null;
  /** 用户对交互式工具的响应（传入 JSON 字符串或 null 取消） */
  onInteractiveResolve?: (value: string | null) => void;
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
//  工具调用卡片
// ═══════════════════════════════════════════════════════════

const TOOL_LABELS: Record<string, { label: string; color: string }> = {
  read_local_file: { label: "读取文件", color: "text-blue-400" },
  write_new_file: { label: "写入文件", color: "text-emerald-400" },
  edit_file: { label: "编辑文件", color: "text-amber-400" },
  list_directory: { label: "浏览目录", color: "text-cyan-400" },
  create_directory: { label: "创建目录", color: "text-teal-400" },
  rename_path: { label: "重命名", color: "text-violet-400" },
  delete_path: { label: "删除", color: "text-red-400" },
  search_files: { label: "搜索文件", color: "text-sky-400" },
  download_file: { label: "下载文件", color: "text-indigo-400" },
  open_path: { label: "打开路径", color: "text-yellow-400" },
  run_command: { label: "执行命令", color: "text-orange-400" },
  system_info: { label: "系统信息", color: "text-pink-400" },
  system_notify: { label: "系统通知", color: "text-rose-400" },
  list_processes: { label: "进程列表", color: "text-fuchsia-400" },
  list_windows: { label: "窗口列表", color: "text-purple-400" },
  capture_screen: { label: "截取屏幕", color: "text-gray-400" },
  fetch_url: { label: "网络请求", color: "text-lime-400" },
  clipboard_read: { label: "读取剪贴板", color: "text-stone-400" },
  clipboard_write: { label: "写入剪贴板", color: "text-neutral-400" },
  ask_user: { label: "询问用户", color: "text-sky-400" },
};

function getToolLabel(name: string): string {
  return TOOL_LABELS[name]?.label || name;
}

function getToolColor(name: string): string {
  return TOOL_LABELS[name]?.color || "text-muted-foreground";
}

/** 工具调用卡片：展示 AI 正在执行什么工具 */
function ToolCallCards({ tool_calls, results }: {
  tool_calls: ToolCall[];
  results?: Map<string, string>;
}) {
  return (
    <div className="space-y-1.5 my-2">
      {tool_calls.map((tc, i) => {
        const resultContent = results?.get(tc.id);
        const isDone = resultContent !== undefined;
        return (
          <div key={tc.id || i}
            className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-xs transition-colors ${
              isDone
                ? "bg-accent/30 border-border/50 text-muted-foreground"
                : "bg-accent/50 border-border text-foreground animate-pulse"
            }`}
          >
            <div className={`shrink-0 mt-0.5 ${getToolColor(tc.function.name)}`}>
              {isDone ? "✓" : "⟳"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`font-medium ${getToolColor(tc.function.name)}`}>
                  {getToolLabel(tc.function.name)}
                </span>
                {!isDone && (
                  <span className="text-muted-foreground/60">执行中...</span>
                )}
              </div>
              {isDone && resultContent && (
                <div className="mt-1 text-muted-foreground/70 line-clamp-2 font-mono text-[10px]">
                  {resultContent.length > 120
                    ? resultContent.slice(0, 120) + "..."
                    : resultContent}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  交互式 AskUser 表单（对话区域内嵌，由 AI 动态控制）
// ═══════════════════════════════════════════════════════════

/** 单个字段的渲染组件 */
function FormField({
  field, value, onChange, error
}: {
  field: NonNullable<ChatViewProps['pendingInteractive']>['questions'][0];
  value: string | string[];
  onChange: (v: string | string[]) => void;
  error?: string;
}) {
  const type = field.type || "text";
  const hasError = !!error;

  // ── textarea ──
  if (type === "textarea") {
    return (
      <div>
        <textarea
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || ""}
          rows={3}
          className={`w-full px-3 py-2 rounded-lg border text-sm bg-background text-foreground placeholder:text-muted-foreground/40 outline-none transition-colors resize-y ${
            hasError ? "border-red-400" : "border-border focus:border-primary/50"
          }`}
          autoFocus
        />
        {hasError && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>
    );
  }

  // ── confirm ──
  if (type === "confirm") {
    return (
      <div className="flex gap-2 mt-2">
        <button onClick={() => onChange("yes")}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            value === "yes"
              ? "bg-primary text-primary-foreground"
              : "bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30"
          }`}>
          确认
        </button>
        <button onClick={() => onChange("no")}
          className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${
            value === "no"
              ? "bg-destructive/10 text-destructive border border-destructive/30"
              : "border border-border text-foreground hover:bg-accent"
          }`}>
          取消
        </button>
      </div>
    );
  }

  // ── dropdown ──
  if (type === "dropdown") {
    return (
      <div>
        <select
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full px-3 py-2 rounded-lg border text-sm bg-background text-foreground outline-none transition-colors ${
            hasError ? "border-red-400" : "border-border focus:border-primary/50"
          }`}
        >
          <option value="" disabled>请选择...</option>
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label} {opt.recommended ? "★" : ""}
            </option>
          ))}
        </select>
        {hasError && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>
    );
  }

  // ── single_select ──
  if (type === "single_select") {
    return (
      <div>
        <div className="flex flex-wrap gap-2">
          {field.options?.map((opt) => (
            <button key={opt.value} onClick={() => onChange(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                value === opt.value
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-border hover:bg-accent text-foreground"
              }`}
              title={opt.description}
            >
              {opt.label}
              {opt.recommended && <span className="ml-1 text-[10px] opacity-60">★</span>}
            </button>
          ))}
        </div>
        {field.allow_free_text && (
          <input type="text" value={value as string}
            onChange={(e) => onChange(e.target.value)}
            placeholder="自定义输入..."
            className={`mt-2 w-full px-3 py-2 rounded-lg border text-sm bg-background text-foreground placeholder:text-muted-foreground/40 outline-none transition-colors ${
              hasError ? "border-red-400" : "border-border focus:border-primary/50"
            }`}
          />
        )}
        {hasError && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>
    );
  }

  // ── multi_select ──
  if (type === "multi_select") {
    const selected = (value as string[]) || [];
    return (
      <div>
        <div className="flex flex-wrap gap-2">
          {field.options?.map((opt) => {
            const isSelected = selected.includes(opt.value);
            return (
              <button key={opt.value} onClick={() => {
                if (isSelected) {
                  onChange(selected.filter((v) => v !== opt.value));
                } else {
                  if (field.max_select && selected.length >= field.max_select) return;
                  onChange([...selected, opt.value]);
                }
              }}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-border hover:bg-accent text-foreground"
                }`}
                title={opt.description}
              >
                {isSelected ? "✓ " : ""}{opt.label}
              </button>
            );
          })}
        </div>
        {selected.length > 0 && field.min_select !== undefined && selected.length < field.min_select && (
          <p className="text-xs text-amber-400 mt-1">至少选择 {field.min_select} 项</p>
        )}
        {field.allow_free_text && (
          <input type="text"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) {
                const val = (e.target as HTMLInputElement).value.trim();
                if (!selected.includes(val)) {
                  onChange([...selected, val]);
                }
                (e.target as HTMLInputElement).value = "";
              }
            }}
            placeholder="输入自定义项后按 Enter..."
            className="mt-2 w-full px-3 py-2 rounded-lg border border-border text-sm bg-background text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 transition-colors"
          />
        )}
      </div>
    );
  }

  // ── text（默认） ──
  return (
    <div>
      <input type="text" value={value as string}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder || "输入..."}
        className={`w-full px-3 py-2 rounded-lg border text-sm bg-background text-foreground placeholder:text-muted-foreground/40 outline-none transition-colors ${
          hasError ? "border-red-400" : "border-border focus:border-primary/50"
        }`}
        autoFocus
      />
      {hasError && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
}

/** 主表单组件：根据 AI 传来的 questions 定义动态渲染 */
function AskUserBlock({
  title, description, submit_label, questions, onResolve
}: {
  title?: string;
  description?: string;
  submit_label?: string;
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
  }>;
  onResolve: (value: string | null) => void;
}) {
  // 每个字段的当前值
  const [values, setValues] = useState<Record<string, string | string[]>>(() => {
    const init: Record<string, string | string[]> = {};
    for (const q of questions) {
      if (q.type === "multi_select") init[q.id] = [];
      else init[q.id] = "";
    }
    return init;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // 单字段 confirm + 仅一个问题 → 简化按钮模式（无提交按钮）
  const isSimpleConfirm =
    questions.length === 1 && questions[0].type === "confirm";

  // 更新某个字段的值
  const updateField = (id: string, v: string | string[]) => {
    setValues((prev) => ({ ...prev, [id]: v }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // 校验
  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    for (const q of questions) {
      if (q.required) {
        const v = values[q.id];
        if (q.type === "multi_select") {
          if (!Array.isArray(v) || v.length === 0) errs[q.id] = "此项为必填";
          else if (q.min_select && v.length < q.min_select)
            errs[q.id] = `至少选择 ${q.min_select} 项`;
        } else if (!v || (typeof v === "string" && !v.trim())) {
          errs[q.id] = "此项为必填";
        }
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // 提交
  const handleSubmit = () => {
    if (submitting) return;
    if (!validate()) return;
    setSubmitting(true);

    // 单字段 confirm → 直接返回 "yes"/"no"
    if (isSimpleConfirm) {
      onResolve(values[questions[0].id] === "yes" ? "yes" : "no");
      return;
    }

    // 多字段 → 返回 JSON
    const result: Record<string, any> = {};
    for (const q of questions) {
      const v = values[q.id];
      if (q.type === "multi_select") {
        result[q.id] = Array.isArray(v) ? v : [];
      } else {
        result[q.id] = typeof v === "string" ? v : "";
      }
    }
    onResolve(JSON.stringify(result));
  };

  // 取消
  const handleCancel = () => {
    if (submitting) return;
    setSubmitting(true);
    onResolve(null);
  };

  // 简明 confirm（单字段、无 title）
  if (isSimpleConfirm && !title) {
    return (
      <div className="my-3 p-4 rounded-xl border bg-card shadow-sm animate-form-enter">
        <div className="text-sm whitespace-pre-wrap text-foreground mb-3">{questions[0].question}</div>
        <div className="flex gap-2">
          <button onClick={() => onResolve("yes")}
            className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
            确认
          </button>
          <button onClick={() => onResolve("no")}
            className="px-4 py-1.5 rounded-lg border border-border text-foreground text-sm hover:bg-accent transition-colors">
            取消
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="my-3 rounded-xl border bg-card shadow-sm overflow-hidden animate-form-enter">
      {/* 表单头 */}
      {title && (
        <div className="px-4 pt-4 pb-1">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && (
            <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{description}</p>
          )}
        </div>
      )}

      {/* 字段列表 */}
      <div className="px-4 py-3 space-y-4">
        {questions.map((q) => (
          <div key={q.id}>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {q.question}
              {q.required && <span className="text-red-400 ml-0.5">*</span>}
            </label>
            {q.message && (
              <p className="text-xs text-muted-foreground mb-2">{q.message}</p>
            )}
            <FormField
              field={q}
              value={values[q.id] ?? ""}
              onChange={(v) => updateField(q.id, v)}
              error={errors[q.id]}
            />
          </div>
        ))}
      </div>

      {/* 操作按钮 */}
      <div className="px-4 pb-4 flex gap-2">
        <button onClick={handleSubmit} disabled={submitting}
          className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          {submit_label || "提交"}
        </button>
        <button onClick={handleCancel} disabled={submitting}
          className="px-4 py-1.5 rounded-lg border border-border text-muted-foreground text-sm hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          取消
        </button>
      </div>
    </div>
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
          <div className="px-3 pb-3 text-xs text-muted-foreground leading-relaxed">
            <MarkdownRenderer content={content} />
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

function AgentMessageBlock({ msg, isStreaming, isLast, onRetry }: {
  msg: ChatMessage; isStreaming?: boolean; isLast?: boolean; onRetry?: () => void;
}) {
  return (
    <div className="self-start w-full">
      <div className="flex items-center gap-2 mb-1.5">
        <Bot size={14} className="text-primary shrink-0" />
        <span className="font-medium text-xs text-muted-foreground">Cebian Agent</span>
      </div>
      {msg.reasoning_content && <ThinkingBlock content={msg.reasoning_content} isLive={isStreaming} />}
      {/* 工具调用卡片 */}
      {msg.tool_calls && msg.tool_calls.length > 0 && (
        <ToolCallCards tool_calls={msg.tool_calls} />
      )}
      <div className="text-sm leading-relaxed">
        <MarkdownRenderer content={msg.content || ""} />
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-primary rounded-sm animate-pulse ml-0.5 align-text-bottom" />
        )}
      </div>
      {msg.cancelled && (
        <div className="text-xs text-muted-foreground/80 italic mt-1">已取消</div>
      )}
      {!isStreaming && msg.content && (
        <div className="flex items-center gap-2 mt-1">
          <CopyButton text={msg.content} />
          {msg.usage && (
            <span className="inline-flex items-center gap-1 text-[0.6rem] text-muted-foreground/70 tabular-nums bg-muted/50 px-1.5 py-0.5 rounded-md">
              <span title="输入 token">↑{msg.usage.input}</span>
              <span className="text-muted-foreground/30">·</span>
              <span title="输出 token">↓{msg.usage.output}</span>
              <span className="text-muted-foreground/30">·</span>
              <span title="总计 token" className="font-medium">∑{msg.usage.input + msg.usage.output}</span>
            </span>
          )}
          {isLast && onRetry && (
            <button onClick={onRetry}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="重试">
              <RefreshCw size={14} />
            </button>
          )}
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
  inputValue, setInputValue, onSend, onStop, loading, aiConfig, onConfigChange, onNavigateSettings,
}: {
  inputValue: string; setInputValue: (v: string) => void;
  onSend: (attachments: SendAttachment[]) => void; onStop: () => void; loading: boolean;
  aiConfig: AIConfig; onConfigChange: (c: AIConfig) => void; onNavigateSettings: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const [attachments, setAttachments] = useState<SendAttachment[]>([]);
  const [webSearch, setWebSearch] = useState(false);

  // ── Slash Prompts ──
  const [showSlash, setShowSlash] = useState(false);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedPromptIdx, setSelectedPromptIdx] = useState(0);

  // ── Speech Recognition ──
  const inputValueRef = useRef(inputValue);
  inputValueRef.current = inputValue;
  const speech = useSpeechRecognition(
    (text) => {
      setInputValue(inputValueRef.current + text);
    },
    "zh-CN",
  );

  // 扫描提示词（输入 / 时触发）
  useEffect(() => {
    if (!showSlash) return;
    listPrompts().then(setPrompts).catch(() => setPrompts([]));
  }, [showSlash]);

  // 键盘导航
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlash && prompts.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedPromptIdx((i) => (i + 1) % prompts.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedPromptIdx((i) => (i - 1 + prompts.length) % prompts.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const target = prompts[selectedPromptIdx];
        if (target) handleSelectPrompt(target);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSlash(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 选择 prompt
  const handleSelectPrompt = async (prompt: Prompt) => {
    try {
      const filled = await replaceTemplateVars(prompt.content);
      setInputValue(filled);
      setShowSlash(false);
      textareaRef.current?.focus();
    } catch {
      toast.error("读取提示词失败");
    }
  };

  // 过滤
  const slashFilter = inputValue.startsWith("/") ? inputValue.slice(1).toLowerCase() : "";
  const filteredPrompts = slashFilter
    ? prompts.filter((p) => p.name.toLowerCase().includes(slashFilter) || p.description.toLowerCase().includes(slashFilter))
    : prompts;
  const isSlashVisible = showSlash && (slashFilter === "" || filteredPrompts.length > 0);

  // 高亮索引随列表变化重置
  useEffect(() => {
    setSelectedPromptIdx(0);
  }, [filteredPrompts.length]);

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
    <footer className="border-t border-border bg-background shrink-0 relative">
      {/* 附件 chips */}
      <AttachmentChips attachments={attachments} onRemove={removeAttachment} />

      {/* Slash 提示词菜单 */}
      {isSlashVisible && (
        <div ref={slashMenuRef}
          className="absolute bottom-full left-4 right-4 mb-2 bg-popover border border-border rounded-lg shadow-xl z-50 max-h-52 overflow-y-auto animate-form-enter"
        >
          {filteredPrompts.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3 px-2.5">
              暂无提示词，请在设置中创建
            </p>
          ) : (
            <div className="py-1">
              {filteredPrompts.map((p, idx) => {
                const selected = idx === selectedPromptIdx;
                return (
                  <button key={p.id}
                    onClick={() => handleSelectPrompt(p)}
                    onMouseMove={() => setSelectedPromptIdx(idx)}
                    className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors ${selected ? "bg-accent" : "hover:bg-accent/50"}`}
                  >
                    <FileText className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{p.name}</div>
                      {p.description && (
                        <div className="text-xs text-muted-foreground truncate mt-0.5">{p.description}</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

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
            onChange={(e) => {
              const val = e.target.value;
              setInputValue(val);
              setShowSlash(val.startsWith("/") && !loading);
              adjustHeight();
            }}
            onKeyDown={handleKeyDown}
            placeholder='输入消息，输入 "/" 可唤起提示词...'
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
              {speech.listening ? (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/10 text-primary text-xs">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                  </span>
                  <span className="text-[10px]">{speech.interimText || "语音输入中..."}</span>
                  <button onClick={speech.stop}
                    className="ml-1 p-0.5 rounded hover:bg-primary/20">
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    if (!speech.supported) {
                      toast.error("浏览器不支持语音识别");
                      return;
                    }
                    speech.start();
                  }}
                  disabled={loading}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-30"
                  title="语音输入"
                >
                  <Mic size={15} />
                </button>
              )}
              {loading ? (
                <button onClick={onStop}
                  className="p-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors flex items-center justify-center"
                  title="终止回答"
                >
                  <Square size={12} fill="currentColor" />
                </button>
              ) : (
                <button onClick={handleSend} disabled={!inputValue.trim()}
                  className="p-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                  title="发送"
                >
                  <ArrowUp size={16} />
                </button>
              )}
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
//  用户消息（含悬浮回滚按钮）
// ═══════════════════════════════════════════════════════════

function UserMessageBlock({ msg, index, onRollback }: {
  msg: ChatMessage; index: number; onRollback?: (index: number, content: string) => void;
}) {
  return (
    <div className="flex justify-end group">
      <div className="flex items-start gap-1.5 max-w-[85%]">
        {onRollback && (
          <button
            onClick={() => onRollback(index, msg.content)}
            className="mt-3 p-1 rounded-md text-muted-foreground/30 hover:text-foreground hover:bg-accent transition-all opacity-0 group-hover:opacity-100 shrink-0"
            title="回滚到此处：删除本条及之后消息，内容保留到输入框"
          >
            <Undo2 size={14} />
          </button>
        )}
        <div className="bg-card border border-border px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap break-words">
          {msg.content.trim()}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  主组件
// ═══════════════════════════════════════════════════════════

export default function ChatView({
  messages, onSend, onStop, onRetry, loading, aiConfig, onConfigChange, onNavigateSettings, onRollback,
  pendingInteractive, onInteractiveResolve,
}: ChatViewProps) {
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 自动滚动
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, loading, pendingInteractive]);

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
  };

  // 本地回滚处理：通知父组件截断消息，同时本地设置输入内容
  const handleRollback = useCallback((index: number, content: string) => {
    onRollback?.(index, content);
    setInputValue(content);
  }, [onRollback]);

  // ── 欢迎页 ──
  if (messages.length === 0 && !loading) {
    return (
      <div className="flex-1 w-full min-w-0 flex flex-col h-full">
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
      <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
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
          {messages.map((msg, i) =>
            msg.role === "user" ? (
              <UserMessageBlock key={i} msg={msg} index={i} onRollback={handleRollback} />
            ) : msg.compacted ? (
              <div key={i} className="flex justify-center">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/50 border border-border text-[10px] text-muted-foreground">
                  <FileText size={10} />
                  <span>上下文已压缩 — 早期对话已折叠为摘要，减少 token 消耗</span>
                </div>
              </div>
            ) : (
              <AgentMessageBlock key={i} msg={msg} isStreaming={loading && i === messages.length - 1}
                isLast={i === messages.length - 1} onRetry={onRetry} />
            )
          )}
          {/* 交互式工具卡片（ask_user） */}
          {pendingInteractive && (
            <AskUserBlock
              title={pendingInteractive.title}
              description={pendingInteractive.description}
              submit_label={pendingInteractive.submit_label}
              questions={pendingInteractive.questions}
              onResolve={onInteractiveResolve!}
            />
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
          <div ref={messagesEndRef} />
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
