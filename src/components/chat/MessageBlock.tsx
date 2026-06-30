import { useState, useEffect, memo, useMemo } from "react";
import { Bot, ChevronRight, Lightbulb, RefreshCw, Undo2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { ChatMessage } from "../../lib/types";
import { CopyButton } from "./chat-types";
import { ToolCallCards } from "./ToolCall";

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
//  用户消息（含悬浮回滚按钮）
// ═══════════════════════════════════════════════════════════

export function UserMessageBlock({ msg, index, onRollback }: {
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
