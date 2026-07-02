import { useState, useEffect, useRef } from "react";
import {
  ChevronRight,
  Brain,
  Wrench,
  CheckCircle2,
  XCircle,
  Loader2,
  Terminal,
  ImageIcon,
  Search,
  FileText,
  ExternalLink,
} from "lucide-react";
import type { AgentProgressMap, AgentProgressStep } from "../../lib/types";

// ─── 智能内容检测 ──────────────────────────────────────────

/** 检测字符串是否为 base64 图片 */
function isBase64Image(str: string): boolean {
  return /^[A-Za-z0-9+/=]{100,}$/.test(str.trim()) || str.startsWith("data:image");
}

/** 检测字符串是否为可解析的 JSON */
function tryParseJSON(str: string): Record<string, any> | null {
  try {
    const obj = JSON.parse(str);
    if (typeof obj === "object" && obj !== null) return obj;
    return null;
  } catch {
    return null;
  }
}

/** 检测是否为搜索结果 */
function isSearchResult(str: string): boolean {
  const lower = str.toLowerCase();
  return lower.includes("搜索结果") || lower.includes("search result") ||
    lower.includes("找到") || (lower.includes("条结果") || lower.includes("results"));
}

/** 检测是否为页面内容 */
function isPageContent(str: string): boolean {
  const lower = str.toLowerCase();
  return (lower.includes("title") && lower.includes("url")) &&
    (lower.includes("content") || lower.includes("text"));
}

// ─── 步骤图标 ───────────────────────────────────────────────

function StepIcon({ type, resultType }: { type: AgentProgressStep["type"]; resultType?: string }) {
  if (type === "tool_result" && resultType === "screenshot") {
    return <ImageIcon size={14} className="text-blue-500 shrink-0" />;
  }
  switch (type) {
    case "thinking":
      return <Brain size={14} className="text-violet-500 shrink-0" />;
    case "tool_call":
      return <Wrench size={14} className="text-amber-500 shrink-0" />;
    case "tool_result":
      return <Terminal size={14} className="text-emerald-500 shrink-0" />;
    case "error":
      return <XCircle size={14} className="text-red-500 shrink-0" />;
  }
}

function StepTypeLabel({ type }: { type: AgentProgressStep["type"] }) {
  switch (type) {
    case "thinking": return "思考";
    case "tool_call": return "工具调用";
    case "tool_result": return "工具结果";
    case "error": return "错误";
  }
}

// ─── 渲染函数 ────────────────────────────────────────────────

/** 渲染工具调用为视觉卡片 */
function ToolCallCard({ tool, content }: { tool?: string; content: string }) {
  let args: Record<string, any> = {};
  try {
    const parsed = JSON.parse(content);
    if (parsed.name === tool || parsed.arguments) {
      args = typeof parsed.arguments === "string" ? JSON.parse(parsed.arguments) : (parsed.arguments || parsed);
    } else {
      args = parsed;
    }
  } catch {
    return null;
  }

  return (
    <div className="mt-1 rounded-md border border-amber-500/20 bg-amber-500/5 overflow-hidden">
      <div className="flex items-center gap-1.5 px-2 py-1 text-[0.55rem] text-amber-600 dark:text-amber-400 font-medium bg-amber-500/10">
        <Wrench size={10} />
        {tool || "工具调用"}
      </div>
      <div className="px-2 py-1.5 space-y-1">
        {Object.entries(args).map(([key, val]) => (
          <div key={key} className="flex gap-2 text-[0.6rem]">
            <span className="text-muted-foreground/60 shrink-0 min-w-[4rem] font-mono">{key}</span>
            <span className="text-foreground/80 break-all line-clamp-3">
              {typeof val === "string" ? val : JSON.stringify(val)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 渲染截图结果 */
function ScreenshotResult({ data }: { data: string }) {
  const src = data.startsWith("data:") ? data : `data:image/png;base64,${data}`;
  return (
    <div className="mt-1 rounded-md overflow-hidden border border-border">
      <div className="flex items-center gap-1.5 px-2 py-1 text-[0.55rem] text-muted-foreground bg-muted/50">
        <ImageIcon size={10} />
        截图预览
      </div>
      <img
        src={src}
        alt="浏览器截图"
        className="w-full h-auto max-h-40 object-contain bg-muted/30"
        loading="lazy"
      />
    </div>
  );
}

/** 渲染页面内容预览 */
function PageContentCard({ content }: { content: string }) {
  const data = tryParseJSON(content);
  if (!data) return null;

  return (
    <div className="mt-1 rounded-md border border-border overflow-hidden">
      <div className="flex items-center gap-1.5 px-2 py-1 text-[0.55rem] text-muted-foreground bg-muted/50">
        <FileText size={10} />
        页面内容
      </div>
      <div className="px-2 py-1.5 space-y-1">
        {data.title && (
          <div className="text-[0.65rem] font-medium text-foreground/90 truncate">
            {data.title}
          </div>
        )}
        {data.url && (
          <div className="flex items-center gap-1 text-[0.55rem] text-primary/70 truncate">
            <ExternalLink size={8} />
            {data.url}
          </div>
        )}
        {data.text && (
          <div className="text-[0.55rem] text-muted-foreground/70 line-clamp-3 leading-relaxed mt-1">
            {data.text.slice(0, 200)}
          </div>
        )}
      </div>
    </div>
  );
}

/** 渲染搜索结果 */
function SearchResultCard({ content }: { content: string }) {
  const data = tryParseJSON(content);
  if (!data || !data.results) return null;

  const results = Array.isArray(data.results) ? data.results : [];

  return (
    <div className="mt-1 rounded-md border border-border overflow-hidden">
      <div className="flex items-center gap-1.5 px-2 py-1 text-[0.55rem] text-muted-foreground bg-muted/50">
        <Search size={10} />
        搜索结果{data.query ? `: ${data.query}` : ""}
      </div>
      <div className="divide-y divide-border/50 max-h-32 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        {results.slice(0, 5).map((r: any, i: number) => (
          <div key={i} className="px-2 py-1.5">
            <div className="text-[0.6rem] font-medium text-foreground/80 truncate">{r.title || r.name}</div>
            {r.url && (
              <div className="text-[0.5rem] text-primary/60 truncate">{r.url}</div>
            )}
            {r.snippet && (
              <div className="text-[0.55rem] text-muted-foreground/70 line-clamp-1">{r.snippet}</div>
            )}
          </div>
        ))}
        {results.length > 5 && (
          <div className="px-2 py-1 text-[0.5rem] text-muted-foreground/50 text-center">
            还有 {results.length - 5} 条结果...
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 智能内容渲染分发 ──────────────────────────────────────

function SmartContent({ step }: { step: AgentProgressStep }) {
  // 截图检测
  if (step.resultType === "screenshot" || (step.tool === "take_screenshot" && isBase64Image(step.content))) {
    return <ScreenshotResult data={step.content} />;
  }

  // 工具调用渲染
  if (step.type === "tool_call") {
    return <ToolCallCard tool={step.tool} content={step.content} />;
  }

  // 页面内容检测
  if (step.resultType === "page_content" || (step.tool === "read_current_page" && isPageContent(step.content))) {
    const card = <PageContentCard content={step.content} />;
    if (card) return card;
  }

  // 搜索结果检测
  if (step.resultType === "search_result" || (step.tool === "search_web" && isSearchResult(step.content))) {
    const card = <SearchResultCard content={step.content} />;
    if (card) return card;
  }

  // JSON 智能渲染
  const jsonData = tryParseJSON(step.content);
  if (jsonData && typeof jsonData === "object" && !Array.isArray(jsonData)) {
    // 如果 JSON 有 title/url/text，做页面内容渲染
    if (jsonData.title && jsonData.url) {
      return <PageContentCard content={step.content} />;
    }
    // 如果 JSON 有 results/query，做搜索结果渲染
    if (jsonData.results || jsonData.query) {
      return <SearchResultCard content={step.content} />;
    }
  }

  return null;
}

// ─── 单个步骤组件 ───────────────────────────────────────────

function StepItem({ step, isLast }: { step: AgentProgressStep; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  const isError = step.type === "error";
  const isThinking = step.type === "thinking";
  const hasDetails = step.content.length > 60 || !!step.tool;
  const smartContent = <SmartContent step={step} />;
  const hasSmartContent = smartContent !== null;

  return (
    <div className="relative pl-7 pb-3">
      {/* 时间线连接线 */}
      {!isLast && (
        <div className="absolute left-[11px] top-[18px] bottom-0 w-px bg-border" />
      )}
      {/* 时间线圆点 */}
      <div className={`absolute left-2 top-[5px] size-[14px] rounded-full border-2 flex items-center justify-center ${
        isError
          ? "border-red-500 bg-red-500/10"
          : "border-border bg-background"
      }`}>
        <div className={`size-[6px] rounded-full ${
          isError ? "bg-red-500" : "bg-muted-foreground/30"
        }`} />
      </div>
      {/* 步骤内容 */}
      <div className="min-w-0">
        {/* 标题行 */}
        <div className="flex items-center gap-1.5">
          <StepIcon type={step.type} resultType={step.resultType} />
          <span className="text-xs font-medium text-foreground/80">
            <StepTypeLabel type={step.type} />
            {step.tool && step.type !== "tool_call" && (
              <code className="ml-1 text-[0.6rem] bg-accent/50 px-1 py-0.5 rounded font-mono">
                {step.tool}
              </code>
            )}
          </span>
          {isThinking && (
            <span className="inline-block size-2 bg-violet-500 rounded-full animate-pulse" />
          )}
        </div>

        {/* 思考内容直接显示文本 */}
        {isThinking && (
          <div className="text-[0.65rem] text-muted-foreground/70 mt-0.5 leading-relaxed">
            {step.content.slice(0, 300)}
            {step.content.length > 300 && "..."}
          </div>
        )}

        {/* 工具调用智能卡片 */}
        {step.type === "tool_call" && hasSmartContent && (
          <div className="mt-0.5">{smartContent}</div>
        )}

        {/* 工具结果智能渲染 */}
        {step.type === "tool_result" && hasSmartContent && (
          <div className="mt-0.5">{smartContent}</div>
        )}

        {/* 文本摘要（非 thinking、无智能卡片时显示） */}
        {!isThinking && !hasSmartContent && !isError && (
          <div className="text-[0.65rem] text-muted-foreground/70 mt-0.5 line-clamp-2 leading-relaxed">
            {step.content.slice(0, 120)}
            {step.content.length > 120 && "..."}
          </div>
        )}

        {/* 错误信息 */}
        {isError && (
          <div className="text-[0.65rem] text-red-500/80 mt-0.5 leading-relaxed">
            {step.content.slice(0, 200)}
          </div>
        )}

        {/* 展开/收起详细信息（仅对有额外内容的步骤） */}
        {hasDetails && !hasSmartContent && (
          <>
            <button
              onClick={() => setOpen(!open)}
              className="flex items-center gap-1 text-[0.55rem] text-primary/60 hover:text-primary mt-0.5"
            >
              <ChevronRight size={10} className={`transition-transform ${open ? "rotate-90" : ""}`} />
              {open ? "收起详情" : "查看详情"}
            </button>
            {open && (
              <>
                <pre className="mt-1 p-2 rounded-md bg-muted/50 border border-border text-[0.6rem] font-mono leading-relaxed whitespace-pre-wrap break-words max-h-48 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                  {step.content}
                </pre>
                {/* 底部收起：内容长时无需回顶 */}
                <button
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-1 text-[0.55rem] text-muted-foreground/40 hover:text-primary/60 mt-1"
                >
                  <ChevronRight size={10} className="-rotate-90" />
                  收起详情
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── 主组件 ─────────────────────────────────────────────────

interface AiThoughtProcessProps {
  progresses: AgentProgressMap;
}

export default function AiThoughtProcess({ progresses }: AiThoughtProcessProps) {
  const [open, setOpen] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const entries = Object.entries(progresses);
  if (entries.length === 0) return null;

  const firstProgress = entries[0][1];
  const isRunning = firstProgress.status === "running";
  const isError = firstProgress.status === "error";
  const totalSteps = firstProgress.steps.length;

  // 运行时自动展开
  useEffect(() => {
    if (isRunning) setOpen(true);
  }, [isRunning]);

  // 滚动到最新步骤
  useEffect(() => {
    if (isRunning && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [totalSteps, isRunning]);

  const statusInfo = (() => {
    if (isRunning) {
      return {
        icon: <Loader2 size={12} className="animate-spin text-primary" />,
        text: "浏览器 AI 执行中...",
        className: "text-primary",
      };
    }
    if (isError) {
      return {
        icon: <XCircle size={12} className="text-red-500" />,
        text: "浏览器 AI 执行出错",
        className: "text-red-500",
      };
    }
    return {
      icon: <CheckCircle2 size={12} className="text-emerald-500" />,
      text: "浏览器 AI 已完成",
      className: "text-emerald-500",
    };
  })();

  return (
    <div className="border border-border rounded-lg overflow-hidden mb-2">
      {/* 头部 */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors select-none"
      >
        <ChevronRight
          size={12}
          className={`transition-transform shrink-0 ${open ? "rotate-90" : ""}`}
        />
        <span className="flex items-center gap-1.5">
          {statusInfo.icon}
          <span className={statusInfo.className}>{statusInfo.text}</span>
        </span>
        <span className="ml-auto text-[0.6rem] text-muted-foreground/50 tabular-nums">
          {totalSteps} 步
        </span>
      </button>

      {/* 可折叠内容 */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-2">
            {/* 任务描述 */}
            <div className="mb-2 text-[0.6rem] text-muted-foreground/60 bg-muted/30 rounded-md px-2 py-1.5 border border-border/50 italic leading-relaxed line-clamp-2">
              任务：{firstProgress.task}
            </div>
            {/* 步骤时间线 */}
            <div ref={listRef} className="max-h-80 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              {firstProgress.steps.length === 0 ? (
                <div className="text-[0.65rem] text-muted-foreground/50 text-center py-4">
                  等待浏览器 AI 响应...
                </div>
              ) : (
                firstProgress.steps.map((step, i) => (
                  <StepItem
                    key={i}
                    step={step}
                    isLast={i === firstProgress.steps.length - 1}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
