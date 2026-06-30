import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ToolCall } from "../../lib/types";
import {
  ToolCategory,
  TOOL_CATEGORY_META,
  getToolCategory,
  getToolLabel,
  getToolColor,
  getToolDesc,
} from "./chat-types";

/** 工具调用卡片：仿 Cebian ToolCard，每个工具独立可折叠，显示参数+结果 */
export function ToolCallCards({ tool_calls, results }: {
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
