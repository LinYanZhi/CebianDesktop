import { useRef, useEffect, useState, memo, useCallback, useMemo } from "react";
import {
  Bot, Mic, ChevronDown, Settings, ChevronRight, Lightbulb,
  Copy, Check, Paperclip, Search, X, Image, FileText, Square, RefreshCw, Undo2, ArrowUp, ArrowDown,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
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

/** 工具类型分类 */
type ToolCategory = "builtin" | "skill" | "mcp";

/** 工具类型信息 */
const TOOL_CATEGORY_META: Record<ToolCategory, { label: string; color: string; bg: string }> = {
  builtin: { label: "系统", color: "text-blue-500", bg: "bg-blue-500/10" },
  skill: { label: "技能", color: "text-purple-500", bg: "bg-purple-500/10" },
  mcp: { label: "MCP", color: "text-amber-500", bg: "bg-amber-500/10" },
};

/** 根据工具名判断类型 */
function getToolCategory(name: string): ToolCategory {
  if (name.startsWith("mcp:")) return "mcp";
  if (name.startsWith("skill_")) return "skill";
  return "builtin";
}

const TOOL_LABELS: Record<string, { label: string; color: string; desc: string }> = {
  read_local_file: { label: "读取文件", color: "text-blue-400", desc: "读取本地文件内容" },
  write_new_file: { label: "写入文件", color: "text-emerald-400", desc: "创建新文件并写入内容" },
  edit_file: { label: "编辑文件", color: "text-amber-400", desc: "修改已有文件内容" },
  list_directory: { label: "浏览目录", color: "text-cyan-400", desc: "列出目录中的文件和子目录" },
  create_directory: { label: "创建目录", color: "text-teal-400", desc: "新建文件夹" },
  rename_path: { label: "重命名", color: "text-violet-400", desc: "重命名文件或文件夹" },
  delete_path: { label: "删除", color: "text-red-400", desc: "删除文件或文件夹" },
  search_files: { label: "搜索文件", color: "text-sky-400", desc: "按名称或内容搜索文件" },
  download_file: { label: "下载文件", color: "text-indigo-400", desc: "从 URL 下载文件到本地" },
  open_path: { label: "打开路径", color: "text-yellow-400", desc: "用系统默认程序打开文件或目录" },
  run_command: { label: "执行命令", color: "text-orange-400", desc: "在终端中执行系统命令" },
  system_info: { label: "系统信息", color: "text-pink-400", desc: "获取操作系统、CPU、内存、磁盘等信息" },
  system_notify: { label: "系统通知", color: "text-rose-400", desc: "发送桌面通知消息" },
  list_processes: { label: "进程列表", color: "text-fuchsia-400", desc: "列出当前运行的进程" },
  list_windows: { label: "窗口列表", color: "text-purple-400", desc: "列出当前打开的窗口" },
  capture_screen: { label: "截取屏幕", color: "text-gray-400", desc: "截取屏幕截图" },
  fetch_url: { label: "网络请求", color: "text-lime-400", desc: "发送 HTTP 请求获取网页或 API 数据" },
  clipboard_read: { label: "读取剪贴板", color: "text-stone-400", desc: "读取系统剪贴板内容" },
  clipboard_write: { label: "写入剪贴板", color: "text-neutral-400", desc: "写入内容到系统剪贴板" },
  ask_user: { label: "询问用户", color: "text-sky-400", desc: "向用户提问并等待回复" },
  // 技能管理工具
  skill_list: { label: "技能列表", color: "text-purple-400", desc: "列出所有已安装的技能" },
  skill_create: { label: "创建技能", color: "text-purple-400", desc: "创建一个新的技能" },
  skill_read: { label: "读取技能", color: "text-purple-400", desc: "读取技能的详细内容" },
  skill_delete: { label: "删除技能", color: "text-red-400", desc: "删除一个技能" },
};

function getToolLabel(name: string): string {
  return TOOL_LABELS[name]?.label || name;
}

function getToolColor(name: string): string {
  return TOOL_LABELS[name]?.color || "text-muted-foreground";
}

function getToolDesc(name: string): string {
  return TOOL_LABELS[name]?.desc || "";
}

/** 工具调用卡片：仿 Cebian ToolCard，每个工具独立可折叠，显示参数+结果 */
function ToolCallCards({ tool_calls, results }: {
  tool_calls: ToolCall[];
  results?: Map<string, string>;
}) {
  return (
    <div className="space-y-1.5 my-2">
      {tool_calls.map((tc, i) => {
        const resultContent = results?.get(tc.id);
        const status = resultContent !== undefined ? "done" : "running";
        const argsStr = (() => {
          try {
            return JSON.stringify(JSON.parse(tc.function.arguments), null, 2);
          } catch { return tc.function.arguments; }
        })();
        const category = getToolCategory(tc.function.name);
        return <ToolCardItem key={tc.id || i} category={category} label={getToolLabel(tc.function.name)} toolName={tc.function.name} color={getToolColor(tc.function.name)} status={status} args={argsStr} result={resultContent} />;
      })}
    </div>
  );
}

/** 单个工具卡片（可折叠） */
function ToolCardItem({ label, color, toolName, category, status, args, result }: {
  label: string; color: string; toolName: string; category: ToolCategory; status: 'running' | 'done'; args: string; result?: string;
}) {
  const [open, setOpen] = useState(false);
  const desc = getToolDesc(toolName);
  const hasArgs = args !== "{}" && args !== "{\n}";
  const catMeta = TOOL_CATEGORY_META[category];
  return (
    <div className="border border-border rounded-lg overflow-hidden text-[0.8rem] min-w-0">
      {/* Header */}
      <button
        type="button"
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 bg-card hover:bg-accent/50 transition-colors text-left cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        {status === 'running' ? (
          <svg className="size-4 text-primary animate-spin shrink-0" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" />
          </svg>
        ) : (
          <svg className="size-4 text-green-500 shrink-0" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" />
            <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`truncate ${color}`}>{label}</span>
            <span className={`shrink-0 text-[0.55rem] font-medium px-1.5 py-0.5 rounded-full ${catMeta.color} ${catMeta.bg}`}>
              {catMeta.label}
            </span>
          </div>
          {!hasArgs && desc && (
            <span className="text-[0.6rem] text-muted-foreground/60 truncate block">{desc}</span>
          )}
        </div>
        <ChevronRight size={14} className={`shrink-0 text-muted-foreground/50 transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
      </button>
      {/* Expandable body */}
      {open && (
        <div className="border-t border-border">
          {desc && hasArgs && (
            <div className="px-3.5 py-2 bg-background border-b border-border/30">
              <span className="text-[0.6rem] text-muted-foreground/60">{desc}</span>
            </div>
          )}
          {hasArgs && (
            <div className="px-3.5 py-2.5 bg-background">
              <div className="text-[0.65rem] text-muted-foreground/60 mb-1.5 font-medium">参数</div>
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all font-mono">
                <code>{args}</code>
              </pre>
            </div>
          )}
          {result !== undefined && (
            <div className={`px-3.5 py-2.5 bg-background ${hasArgs ? "border-t border-border/50" : ""}`}>
              <div className="text-[0.65rem] text-muted-foreground/60 mb-1.5 font-medium">结果</div>
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all font-mono max-h-48 overflow-y-auto">
                <code>{result}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  交互式 AskUser 表单（对话区域内嵌，由 AI 动态控制）
//  支持三种模式：
//    A. Compact 紧凑模式（单字段、无标题、无提交按钮）
//    B. Form 表单模式（多字段或有标题）
//    C. Wizard 分步向导模式（pagination.type === "wizard"）
// ═══════════════════════════════════════════════════════════

/** 单个字段的渲染组件 */
function FormFieldWidget({
  field, value, onChange, error
}: {
  field: NonNullable<ChatViewProps['pendingInteractive']>['questions'][0];
  value: string | string[];
  onChange: (v: string | string[]) => void;
  error?: string;
}) {
  const type = field.type || "text";
  const hasError = !!error;
  const options = field.options || [];

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
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label} {opt.recommended ? "★" : ""}
            </option>
          ))}
        </select>
        {hasError && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>
    );
  }

  // ── single_select（标准 radio） ──
  if (type === "single_select") {
    return (
      <div>
        <div className="space-y-1.5">
          {options.map((opt) => (
            <label key={opt.value}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border cursor-pointer text-xs transition-colors hover:bg-accent/50 ${
                value === opt.value ? "border-primary bg-primary/10" : "border-border"
              }`}
            >
              <input type="radio" name="ss" value={opt.value}
                checked={value === opt.value}
                onChange={(e) => onChange(e.target.value)}
                className="size-3.5 accent-primary shrink-0"
              />
              <span className="flex-1">{opt.label}</span>
              {opt.recommended && (
                <span className="text-[0.6rem] text-primary/70 font-medium px-1 py-0.5 rounded bg-primary/10 shrink-0">
                  推荐
                </span>
              )}
            </label>
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

  // ── multi_select（标准 checkbox） ──
  if (type === "multi_select") {
    const selected = (value as string[]) || [];
    return (
      <div>
        <div className="space-y-1.5">
          {options.map((opt) => {
            const isSelected = selected.includes(opt.value);
            return (
              <label key={opt.value}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border cursor-pointer text-xs transition-colors hover:bg-accent/50 ${
                  isSelected ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <input type="checkbox" value={opt.value}
                  checked={isSelected}
                  onChange={() => {
                    if (isSelected) {
                      onChange(selected.filter((v) => v !== opt.value));
                    } else {
                      if (field.max_select && selected.length >= field.max_select) return;
                      onChange([...selected, opt.value]);
                    }
                  }}
                  className="size-3.5 accent-primary rounded shrink-0"
                />
                <span className="flex-1">{opt.label}</span>
                {opt.recommended && (
                  <span className="text-[0.6rem] text-primary/70 font-medium px-1 py-0.5 rounded bg-primary/10 shrink-0">
                    推荐
                  </span>
                )}
              </label>
            );
          })}
        </div>
        {selected.length > 0 && field.min_select !== undefined && selected.length < field.min_select && (
          <p className="text-xs text-amber-400 mt-1">至少选择 {field.min_select} 项</p>
        )}
        {field.allow_free_text && (
          <div className="mt-2 flex gap-1.5">
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
              className="flex-1 px-3 py-2 rounded-lg border border-border text-sm bg-background text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 transition-colors"
            />
          </div>
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

// ─── 表单校验 ───

function validateForm(
  questions: NonNullable<ChatViewProps['pendingInteractive']>['questions'],
  values: Record<string, string | string[]>,
): Record<string, string> {
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
  return errs;
}

// ─── Mode A: Compact 紧凑模式（单字段、无标题、无提交按钮） ───

function AskUserCompactBlock({
  field, onResolve
}: {
  field: NonNullable<ChatViewProps['pendingInteractive']>['questions'][0];
  onResolve: (value: string | null) => void;
}) {
  const [value, setValue] = useState<string | string[]>(() => {
    if (field.type === "multi_select") return [];
    return "";
  });
  const [error, setError] = useState<string | null>(null);
  const type = field.type || "text";
  const isConfirm = type === "confirm";

  // confirm 模式
  if (isConfirm) {
    return (
      <div className="my-3 p-4 rounded-xl border bg-card shadow-sm animate-form-enter">
        <div className="text-sm whitespace-pre-wrap text-foreground mb-3">{field.question}</div>
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

  // 有 options → single_select 紧凑模式（选项按钮 + 可取消）
  const hasOptions = (field.options && field.options.length > 0) || false;
  if (hasOptions) {
    return (
      <div className="my-3 p-4 rounded-xl border bg-card shadow-sm animate-form-enter">
        <div className="text-sm whitespace-pre-wrap text-foreground mb-3">{field.question}</div>
        <div className="flex flex-wrap gap-2">
          {field.options?.map((opt) => (
            <button key={opt.value} onClick={() => onResolve(opt.value)}
              className="px-3 py-1.5 rounded-lg text-sm border border-border hover:bg-accent hover:text-foreground text-muted-foreground transition-colors"
            >
              {opt.label}
            </button>
          ))}
          <button onClick={() => onResolve(null)}
            className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors">
            取消
          </button>
        </div>
      </div>
    );
  }

  // text/textarea 紧凑模式
  const handleSubmit = () => {
    if ((typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0)) {
      setError("此项为必填");
      return;
    }
    const result: Record<string, any> = {};
    result[field.id] = field.type === "multi_select" ? value : (typeof value === "string" ? value : "");
    onResolve(JSON.stringify(result));
  };

  return (
    <div className="my-3 p-4 rounded-xl border bg-card shadow-sm animate-form-enter">
      <div className="text-sm whitespace-pre-wrap text-foreground mb-3">{field.question}</div>
      <FormFieldWidget field={field} value={value} onChange={(v) => { setValue(v); setError(null); }} error={error || undefined} />
      <div className="flex gap-2 mt-3">
        <button onClick={handleSubmit}
          className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
          确认
        </button>
        <button onClick={() => onResolve(null)}
          className="px-4 py-1.5 rounded-lg border border-border text-muted-foreground text-sm hover:bg-accent transition-colors">
          取消
        </button>
      </div>
    </div>
  );
}

// ─── Mode B: 表单模式（多字段或有标题） ───

function FormBlock({
  title, description, submit_label, questions, onResolve
}: {
  title?: string;
  description?: string;
  submit_label?: string;
  questions: NonNullable<ChatViewProps['pendingInteractive']>['questions'];
  onResolve: (value: string | null) => void;
}) {
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

  const updateField = (id: string, v: string | string[]) => {
    setValues((prev) => ({ ...prev, [id]: v }));
    setErrors((prev) => { const n = { ...prev }; delete n[id]; return n; });
  };

  const handleSubmit = () => {
    if (submitting) return;
    const errs = validateForm(questions, values);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSubmitting(true);
    const result: Record<string, any> = {};
    for (const q of questions) {
      const v = values[q.id];
      result[q.id] = q.type === "multi_select" ? (Array.isArray(v) ? v : []) : (typeof v === "string" ? v : "");
    }
    onResolve(JSON.stringify(result));
  };

  return (
    <div className="my-3 rounded-xl border bg-card shadow-sm overflow-hidden animate-form-enter">
      {title && (
        <div className="px-4 pt-4 pb-1">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && (
            <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{description}</p>
          )}
        </div>
      )}
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
            <FormFieldWidget field={q} value={values[q.id] ?? ""} onChange={(v) => updateField(q.id, v)} error={errors[q.id]} />
          </div>
        ))}
      </div>
      <div className="px-4 pb-4 flex gap-2">
        <button onClick={handleSubmit} disabled={submitting}
          className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          {submit_label || "提交"}
        </button>
        <button onClick={() => { setSubmitting(true); onResolve(null); }} disabled={submitting}
          className="px-4 py-1.5 rounded-lg border border-border text-muted-foreground text-sm hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          取消
        </button>
      </div>
    </div>
  );
}

// ─── Mode C: Wizard 分步向导模式 ───

function WizardBlock({
  title, description, submit_label, pagination, questions, onResolve
}: {
  title?: string;
  description?: string;
  submit_label?: string;
  pagination?: { type: "wizard"; show_progress?: boolean; allow_skip?: boolean; allow_review?: boolean };
  questions: NonNullable<ChatViewProps['pendingInteractive']>['questions'];
  onResolve: (value: string | null) => void;
}) {
  // 按 step 分组
  const steps = (() => {
    const map = new Map<number, { id: number; title?: string; questions: typeof questions }>();
    for (const q of questions) {
      const stepNum = q.step ?? 1;
      if (!map.has(stepNum)) map.set(stepNum, { id: stepNum, title: q.step_title, questions: [] });
      const step = map.get(stepNum)!;
      if (q.step_title && !step.title) step.title = q.step_title;
      step.questions.push(q);
    }
    return Array.from(map.values()).sort((a, b) => a.id - b.id);
  })();

  const showProgress = pagination?.show_progress !== false;
  const allowReview = pagination?.allow_review !== false;
  const allowSkip = pagination?.allow_skip === true;

  const allSteps = allowReview ? [...steps, { id: -1, title: "确认", questions: [] }] : steps;
  const [currentIdx, setCurrentIdx] = useState(0);
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

  const updateField = (id: string, v: string | string[]) => {
    setValues((prev) => ({ ...prev, [id]: v }));
    setErrors((prev) => { const n = { ...prev }; delete n[id]; return n; });
  };

  const currentStep = allSteps[currentIdx];
  const isReviewStep = allowReview && currentIdx === allSteps.length - 1;
  const currentQuestions = isReviewStep ? questions : (currentStep && 'questions' in currentStep ? (currentStep as any).questions : []);

  const handleNext = () => {
    // 校验当前步骤
    if (!isReviewStep) {
      const stepQs = (currentStep as any).questions || [];
      const stepErrs = validateForm(stepQs, values);
      setErrors(stepErrs);
      if (Object.keys(stepErrs).length > 0) return;
    }
    if (currentIdx < allSteps.length - 1) {
      setCurrentIdx(currentIdx + 1);
    }
  };

  const handlePrev = () => {
    if (currentIdx > 0) setCurrentIdx(currentIdx - 1);
  };

  const handleSubmit = () => {
    if (submitting) return;
    const errs = validateForm(questions, values);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setSubmitting(true);
    const result: Record<string, any> = {};
    for (const q of questions) {
      const v = values[q.id];
      result[q.id] = q.type === "multi_select" ? (Array.isArray(v) ? v : []) : (typeof v === "string" ? v : "");
    }
    onResolve(JSON.stringify(result));
  };

  return (
    <div className="my-3 rounded-xl border bg-card shadow-sm overflow-hidden animate-form-enter">
      {/* 进度条 */}
      {showProgress && allSteps.length > 1 && (
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-center gap-1">
            {allSteps.map((_, i) => (
              <div key={i} className={`flex-1 h-1 rounded-full transition-colors ${
                i <= currentIdx ? "bg-primary" : "bg-border"
              }`} />
            ))}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-muted-foreground">
              {title || (typeof (currentStep as any)?.title === "string" ? (currentStep as any).title : `步骤 ${currentIdx + 1}/${allSteps.length}`)}
            </span>
            <span className="text-[10px] text-muted-foreground">{currentIdx + 1}/{allSteps.length}</span>
          </div>
        </div>
      )}

      {/* 标题 */}
      {title && (
        <div className="px-4 pt-2 pb-1">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && (
            <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{description}</p>
          )}
        </div>
      )}

      {/* Review 步骤 */}
      {isReviewStep ? (
        <div className="px-4 py-3 space-y-3">
          <p className="text-sm font-medium text-foreground">请确认以下信息</p>
          {questions.map((q) => {
            const v = values[q.id];
            const display = q.type === "multi_select"
              ? (Array.isArray(v) ? (v as string[]).join(", ") : "")
              : (typeof v === "string" ? v : "");
            return (
              <div key={q.id} className="text-xs">
                <span className="text-muted-foreground">{q.question}：</span>
                <span className="text-foreground font-medium">{display || "（未填写）"}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="px-4 py-3 space-y-4">
          {(currentQuestions || []).map((q: any) => (
            <div key={q.id}>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                {q.question}
                {q.required && <span className="text-red-400 ml-0.5">*</span>}
              </label>
              {q.message && (
                <p className="text-xs text-muted-foreground mb-2">{q.message}</p>
              )}
              <FormFieldWidget field={q} value={values[q.id] ?? ""} onChange={(v) => updateField(q.id, v)} error={errors[q.id]} />
            </div>
          ))}
        </div>
      )}

      {/* 导航按钮 */}
      <div className="px-4 pb-4 flex items-center justify-between">
        <div>
          {currentIdx > 0 && (
            <button onClick={handlePrev}
              className="px-3 py-1.5 rounded-lg border border-border text-muted-foreground text-sm hover:bg-accent transition-colors">
              上一步
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {allowSkip && !isReviewStep && currentIdx < allSteps.length - 1 && (
            <button onClick={() => setCurrentIdx(currentIdx + 1)}
              className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors">
              跳过
            </button>
          )}
          {isReviewStep ? (
            <button onClick={handleSubmit} disabled={submitting}
              className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {submit_label || "提交"}
            </button>
          ) : (
            <button onClick={handleNext}
              className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
              {currentIdx < allSteps.length - 1 ? "下一步" : "确认"}
            </button>
          )}
          <button onClick={() => { setSubmitting(true); onResolve(null); }} disabled={submitting}
            className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 主分发组件 ───

function AskUserBlock({
  title, description, submit_label, pagination, questions, onResolve
}: {
  title?: string;
  description?: string;
  submit_label?: string;
  pagination?: { type: "wizard"; show_progress?: boolean; allow_skip?: boolean; allow_review?: boolean };
  questions: NonNullable<ChatViewProps['pendingInteractive']>['questions'];
  onResolve: (value: string | null) => void;
}) {
  // Mode C: Wizard 分步向导
  if (pagination?.type === "wizard") {
    return (
      <WizardBlock title={title} description={description} submit_label={submit_label} pagination={pagination} questions={questions} onResolve={onResolve} />
    );
  }

  // Mode A: Compact 紧凑模式（单字段、无标题、无 description）
  if (questions.length === 1 && !title && !description) {
    return <AskUserCompactBlock field={questions[0]} onResolve={onResolve} />;
  }

  // Mode B: 表单模式
  return (
    <FormBlock title={title} description={description} submit_label={submit_label} questions={questions} onResolve={onResolve} />
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
//  Markdown 渲染（语法高亮 + 代码块头部）
// ═══════════════════════════════════════════════════════════

/** 从 hast 节点中递归提取纯文本 */
function hastToText(nodes: any[] | undefined): string {
  if (!nodes) return '';
  let out = '';
  for (const n of nodes) {
    if (n.type === 'text') out += n.value;
    else if (n.type === 'element') out += hastToText(n.children);
  }
  return out;
}

/** 代码块容器：语言标签 + 复制按钮 + 语法高亮 */
function CodeBlock({ node, children }: { node?: any; children?: React.ReactNode }) {
  const codeNode = node?.children?.find(
    (c: any) => c.type === 'element' && c.tagName === 'code'
  );
  const lang = (() => {
    const cls = codeNode?.properties?.className;
    if (Array.isArray(cls)) {
      for (const c of cls) {
        if (typeof c === 'string' && c.startsWith('language-')) return c.slice(9);
      }
    }
    return '';
  })();
  const text = hastToText(codeNode?.children);

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border bg-background/50">
      <div className="flex items-center justify-between pl-3 pr-1 py-1 text-xs text-muted-foreground/70 border-b border-border/40">
        <span className="font-mono">{lang || 'code'}</span>
        <CopyButton text={text} />
      </div>
      <pre className="overflow-x-auto p-3 text-sm font-mono leading-relaxed !bg-transparent !border-0 !my-0">
        {children}
      </pre>
    </div>
  );
}

const MarkdownRenderer = memo(function MarkdownRenderer({ content }: { content: string }) {
  if (!content) return null;
  return (
    <div className="max-w-none wrap-break-word text-sm leading-relaxed space-y-3">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ node, children }) => <CodeBlock node={node}>{children}</CodeBlock>,
          code: ({ className, children, ...props }) => {
            // rehype-highlight 会加 className="hljs language-xxx"
            // 不能用 startsWith 因为 "hljs " 在前面
            const isBlock = !!className && /(?:^|\s)(?:hljs|language-)/.test(className);
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

function AgentMessageBlock({ msg, isStreaming, isLast, onRetry, toolResults }: {
  msg: ChatMessage; isStreaming?: boolean; isLast?: boolean; onRetry?: () => void;
  toolResults?: ChatMessage[];
}) {
  const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;

  // 构建工具名 → 结果的映射
  const toolResultsMap = useMemo(() => {
    if (!toolResults || !hasToolCalls) return undefined;
    const map = new Map<string, string>();
    for (const tr of toolResults) {
      if (tr.tool_call_id && tr.content) {
        map.set(tr.tool_call_id, tr.content);
      }
    }
    return map;
  }, [toolResults, hasToolCalls]);

  return (
    <div className="self-start w-full">
      <div className="flex items-center gap-2 mb-1.5">
        <Bot size={14} className="text-primary shrink-0" />
        <span className="font-medium text-xs text-muted-foreground">Cebian Agent</span>
      </div>
      {msg.reasoning_content && <ThinkingBlock content={msg.reasoning_content} isLive={isStreaming} />}
      {/* 工具调用卡片（每个卡片独立可折叠） */}
      {hasToolCalls && (
        <ToolCallCards tool_calls={msg.tool_calls!} results={toolResultsMap} />
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
//  思考级别选择器（仿 Cebian：无图标，纯文字 + 下拉箭头）
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
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[0.7rem] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <span>思考：{current?.label ?? level}</span>
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

  // ── Slash Prompts ──
  const [showSlash, setShowSlash] = useState(false);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedPromptIdx, setSelectedPromptIdx] = useState(0);

  // ── Speech Recognition ──
  // 语音识别到的文本在 textarea 中的 range（start/end 字符索引）
  // 每次 interim 更新时，替换这个 range 内的文本，而非覆盖整个 textarea
  const voiceRangeRef = useRef<{start: number; end: number} | null>(null);
  const lastVoiceTextRef = useRef("");
  const speech = useSpeechRecognition(
    undefined,
    (speechText) => {
      const el = textareaRef.current;
      if (!el) return;

      const currentValue = el.value;
      const cursorPos = el.selectionStart;

      let newValue: string;
      let newCursorPos: number;

      if (voiceRangeRef.current === null) {
        // 首次语音结果：在光标位置插入
        newValue = currentValue.slice(0, cursorPos) + speechText + currentValue.slice(cursorPos);
        newCursorPos = cursorPos + speechText.length;
        voiceRangeRef.current = { start: cursorPos, end: newCursorPos };
      } else {
        const { start, end } = voiceRangeRef.current;
        // 检查语音 range 中的文本是否仍是上次的语音文本（用户可能手动编辑过）
        if (start <= currentValue.length && currentValue.slice(start, Math.min(end, currentValue.length)) === lastVoiceTextRef.current) {
          // range 有效：替换旧语音文本
          newValue = currentValue.slice(0, start) + speechText + currentValue.slice(end);
          newCursorPos = start + speechText.length;
          voiceRangeRef.current = { start, end: newCursorPos };
        } else {
          // range 失效（用户编辑过）：在当前光标位置重新插入
          newValue = currentValue.slice(0, cursorPos) + speechText + currentValue.slice(cursorPos);
          newCursorPos = cursorPos + speechText.length;
          voiceRangeRef.current = { start: cursorPos, end: newCursorPos };
        }
      }

      lastVoiceTextRef.current = speechText;
      setInputValue(newValue);

      // React 重渲染后恢复光标到语音文本末尾
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = newCursorPos;
      });
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
    if (speech.listening) speech.stop();
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
              {speech.supported && (
                <button
                  onClick={() => {
                    if (speech.listening) {
                      speech.stop();
                    } else {
                      voiceRangeRef.current = null; // 重置语音 range，新语音从光标处开始
                      lastVoiceTextRef.current = "";
                      speech.start();
                    }
                  }}
                  disabled={loading}
                  className={`p-1.5 rounded-md transition-colors disabled:opacity-30 ${
                    speech.listening
                      ? "text-primary bg-primary/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                  title={speech.listening ? "停止语音输入" : "语音输入"}
                >
                  {speech.listening ? (
                    <span className="relative flex">
                      <Mic size={15} />
                      <span className="animate-ping absolute inset-0 m-auto w-full h-full rounded-full bg-primary/40" />
                    </span>
                  ) : (
                    <Mic size={15} />
                  )}
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
//  自动滚动 Hook（仿 Cebian useStickToBottom）
// ═══════════════════════════════════════════════════════════

function useStickToBottom(containerRef: React.RefObject<HTMLDivElement | null>) {
  const stickRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const lastProgrammaticAtRef = useRef(0);
  const PROGRAMMATIC_GUARD_MS = 80;
  const BOTTOM_THRESHOLD_PX = 60;

  const isAtBottomNow = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD_PX;
  }, [containerRef]);

  const scrollToBottom = useCallback((opts?: { force?: boolean }) => {
    const el = containerRef.current;
    if (!el) return;
    if (opts?.force) {
      if (!stickRef.current) {
        stickRef.current = true;
        setIsAtBottom(true);
      }
    } else if (!stickRef.current) {
      return;
    }
    lastProgrammaticAtRef.current = Date.now();
    el.scrollTop = el.scrollHeight;
  }, [containerRef]);

  // 监听用户滚动事件
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (Date.now() - lastProgrammaticAtRef.current < PROGRAMMATIC_GUARD_MS) return;
      const atBottom = isAtBottomNow();
      if (stickRef.current !== atBottom) {
        stickRef.current = atBottom;
        setIsAtBottom(atBottom);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [containerRef, isAtBottomNow]);

  // ResizeObserver：内容变化时自动跟随（仅当用户未向上滚动时）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { scrollToBottom(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, scrollToBottom]);

  return { isAtBottom, scrollToBottom };
}

// ═══════════════════════════════════════════════════════════
//  主组件
// ═══════════════════════════════════════════════════════════

export default function ChatView({
  messages, onSend, onStop, onRetry, loading, aiConfig, onConfigChange, onNavigateSettings, onRollback,
  pendingInteractive, onInteractiveResolve, pendingConfirmation, onConfirmResolve,
}: ChatViewProps) {
  const [inputValue, setInputValue] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const { isAtBottom, scrollToBottom } = useStickToBottom(containerRef);

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
    <div className="flex-1 w-full min-w-0 flex flex-col h-full relative">
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
          <div />
        </div>
        {/* 回底按钮：用户向上滚动后出现在消息区域右下角 */}
        {!isAtBottom && (
          <button
            onClick={() => scrollToBottom({ force: true })}
            className="sticky bottom-4 right-4 size-8 flex items-center justify-center rounded-full bg-background border border-border/60 shadow-md hover:bg-accent transition-colors"
            title="回到底部"
          >
            <ArrowDown size={14} />
          </button>
        )}
      </div>
      <ChatInput inputValue={inputValue} setInputValue={setInputValue}
        onSend={(atts) => send(atts)}
        onStop={onStop}
        loading={loading} aiConfig={aiConfig}
        onConfigChange={onConfigChange} onNavigateSettings={onNavigateSettings} />
    </div>
  );
}
