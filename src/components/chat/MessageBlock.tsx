import { useState, useEffect, memo, useMemo } from "react";
import { Bot, ChevronRight, Lightbulb, RefreshCw, Undo2, FileText, FileSpreadsheet, Clock } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { ChatMessage, SendAttachment } from "../../lib/types";
import { getMessageText, getMessageThinking } from "../../lib/types";
import { CopyButton } from "./chat-types";
import { ToolCallCards } from "./ToolCall";

// ─── 工具函数：格式化时间戳 ───
function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/** 格式化耗时（ms → 可读字符串） */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

// ─── 工具函数：从消息文本中剥离附件路径段落 ───
// 路径段落格式由 ChatView.send() 拼接：
//   "\n\n---\n以下文件由用户选择：\n- `path`..."
function stripAttachmentPaths(text: string): string {
  const marker = '\n---\n以下文件由用户选择：';
  const idx = text.indexOf(marker);
  if (idx >= 0) {
    return text.substring(0, idx).trim();
  }
  return text.trim();
}

// ─── 文件 chip 展示 ───
function FileChip({ attachment }: { attachment: SendAttachment }) {
  const ext = attachment.name.split('.').pop()?.toLowerCase();
  const isExcel = ext === 'xlsx' || ext === 'xls';
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (attachment.path) {
      navigator.clipboard.writeText(attachment.path).then(() => {
        toast.success(`已复制路径: ${attachment.path}`);
      }).catch(() => {
        toast.error('复制路径失败');
      });
    }
  };
  return (
    <div
      onContextMenu={handleContextMenu}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/5 border border-primary/15 text-xs text-muted-foreground max-w-56 group cursor-context-menu"
      title={attachment.path}
    >
      {isExcel ? <FileSpreadsheet size={14} className="shrink-0 text-primary/60" /> : <FileText size={14} className="shrink-0 text-primary/60" />}
      <span className="truncate">{attachment.name}</span>
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

export function AgentMessageBlock({ msg, isStreaming, isLast, onRetry, toolResults }: {
  msg: ChatMessage; isStreaming?: boolean; isLast?: boolean; onRetry?: () => void;
  toolResults?: ChatMessage[];
}) {
  const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;

  // 构建工具名 → 结果的映射
  const toolResultsMap = useMemo(() => {
    if (!toolResults || !hasToolCalls) return undefined;
    const map = new Map<string, string>();
    for (const tr of toolResults) {
      if (tr.tool_call_id && getMessageText(tr)) {
        map.set(tr.tool_call_id, getMessageText(tr));
      }
    }
    return map;
  }, [toolResults, hasToolCalls]);

  return (
    <div className="self-start w-full">
      <div className="flex items-center gap-2 mb-1.5">
        <Bot size={14} className="text-primary shrink-0" />
        <span className="font-medium text-xs text-muted-foreground">Cebian Agent</span>
        {msg.timestamp && !isStreaming && (
          <span className="text-[0.55rem] text-muted-foreground/50 ml-auto tabular-nums">
            {formatTimestamp(msg.timestamp)}
          </span>
        )}
      </div>
      {(msg.reasoning_content || getMessageThinking(msg)) && (
        <ThinkingBlock content={msg.reasoning_content || getMessageThinking(msg) || ""} isLive={isStreaming} />
      )}
      <div className="text-sm leading-relaxed">
        <MarkdownRenderer content={getMessageText(msg)} />
        {isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-primary rounded-sm animate-pulse ml-0.5 align-text-bottom" />
        )}
      </div>
      {/* 工具调用卡片（每个卡片独立可折叠） */}
      {hasToolCalls && (
        <ToolCallCards tool_calls={msg.tool_calls!} results={toolResultsMap} cancelled={msg.cancelled} />
      )}
      {msg.cancelled && (
        <div className="text-xs text-muted-foreground/80 italic mt-1">已取消</div>
      )}
      {!isStreaming && getMessageText(msg) && (
        <div className="flex items-center gap-2 mt-1">
          <CopyButton text={getMessageText(msg)} />
          {msg.responseTime && (
            <span className="inline-flex items-center gap-1 text-[0.6rem] text-muted-foreground/70 tabular-nums bg-muted/50 px-1.5 py-0.5 rounded-md" title={`等待响应 ${formatDuration(msg.responseTime.ttft)}，总耗时 ${formatDuration(msg.responseTime.total)}`}>
              <Clock size={10} className="shrink-0" />
              <span title="首 token 延迟（网络 + 供应商处理）">⏱ {formatDuration(msg.responseTime.ttft)}</span>
              <span className="text-muted-foreground/30">·</span>
              <span title="总耗时">总计 {formatDuration(msg.responseTime.total)}</span>
            </span>
          )}
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
//  用户消息（含悬浮回滚按钮）
// ═══════════════════════════════════════════════════════════

export function UserMessageBlock({ msg, index, onRollback }: {
  msg: ChatMessage; index: number; onRollback?: (index: number, msg: ChatMessage) => void;
}) {
  const hasAttachments = msg.attachments && msg.attachments.length > 0;
  const displayText = hasAttachments ? stripAttachmentPaths(getMessageText(msg)) : getMessageText(msg).trim();
  return (
    <div className="flex flex-col items-end w-full">
      <div className="flex items-center gap-1.5 mb-0.5">
        {msg.timestamp && (
          <span className="text-[0.55rem] text-muted-foreground/50 tabular-nums">
            {formatTimestamp(msg.timestamp)}
          </span>
        )}
      </div>
      <div className="flex justify-end group w-full">
        <div className="flex items-start gap-1.5 max-w-[85%]">
          {onRollback && (
            <button
              onClick={() => onRollback(index, msg)}
              className="mt-3 p-1 rounded-md text-muted-foreground/30 hover:text-foreground hover:bg-accent transition-all opacity-0 group-hover:opacity-100 shrink-0"
              title="回滚到此处：删除本条及之后消息，内容保留到输入框"
            >
              <Undo2 size={14} />
            </button>
          )}
          <div className="bg-card border border-border px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap break-words space-y-2">
            {hasAttachments && (
              <div className="flex flex-wrap gap-1.5">
                {msg.attachments!.map(att => (
                  <FileChip key={att.id} attachment={att} />
                ))}
              </div>
            )}
            {displayText && <div>{displayText}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
