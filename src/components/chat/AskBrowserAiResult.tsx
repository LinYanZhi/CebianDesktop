import { useState } from "react";
import { ChevronRight, CheckCircle2, FileText, Terminal } from "lucide-react";

// ─── 解析执行报告 ─────────────────────────────────────────

interface ParsedReport {
  summary: string;
  task: string;
  executionLog: string;
  hasResult: boolean;
}

/**
 * 解析浏览器 AI 执行报告文本，提取结构化内容。
 * 报告格式为 markdown 风格：
 *   ✅ 总结段落...
 *   ## 任务\n...
 *   ## 执行记录\n```\n...\n```
 */
function parseExecutionReport(text: string): ParsedReport {
  // 按 ## 分割（保留标题标记以便识别）
  const parts = text.split(/(?=^## )/m);

  const result: ParsedReport = {
    summary: "",
    task: "",
    executionLog: "",
    hasResult: true,
  };

  for (const part of parts) {
    const trimmed = part.trim();

    // 以 ## 开头的是章节
    if (trimmed.startsWith("## ")) {
      const headerEnd = trimmed.indexOf("\n");
      const header = headerEnd > 0 ? trimmed.slice(3, headerEnd).trim() : trimmed.slice(3).trim();
      const body = headerEnd > 0 ? trimmed.slice(headerEnd).trim() : "";

      if (header === "任务" || header.includes("任务")) {
        result.task = body;
      } else if (header === "执行记录" || header.includes("执行记录") || header === "执行日志") {
        // 去除代码块标记
        result.executionLog = body
          .replace(/^```[\w]*\n?/, "")
          .replace(/\n```$/, "")
          .trim();
      }
    } else {
      // 第一个非 ## 部分为总结
      result.summary = trimmed;
    }
  }

  return result;
}

// ─── 执行记录渲染 ─────────────────────────────────────────

function ExecutionLog({ log }: { log: string }) {
  const [open, setOpen] = useState(false);

  if (!log) return null;

  // 将日志行分割为独立条目
  const lines = log.split("\n").filter(Boolean);
  const entries = lines.map((line) => {
    // 尝试解析 [结果] type: content
    const match = line.match(/^\[(\w+)\]\s*(.+)/);
    if (match) {
      return { type: match[1], content: match[2] };
    }
    return { type: "info", content: line };
  });

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[0.6rem] text-muted-foreground/60 hover:text-foreground transition-colors"
      >
        <Terminal size={10} />
        <span>执行日志（{entries.length} 条）</span>
        <ChevronRight size={10} className={`transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="mt-1 p-2 rounded-md bg-muted/40 border border-border text-[0.55rem] font-mono leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap break-words" style={{ scrollbarWidth: 'thin' }}>
          {entries.map((entry, i) => (
            <div key={i} className="mb-0.5 last:mb-0">
              <span className={`font-medium ${
                entry.type === "结果" ? "text-emerald-500/70" :
                entry.type === "错误" ? "text-red-500/70" :
                "text-muted-foreground/50"
              }`}>
                [{entry.type}]
              </span>
              <span className="text-muted-foreground/70"> {entry.content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────────────

interface AskBrowserAiResultProps {
  result: string;
}

export default function AskBrowserAiResult({ result }: AskBrowserAiResultProps) {
  const report = parseExecutionReport(result);

  return (
    <div className="space-y-2 text-[0.7rem]">
      {/* 状态总结 */}
      {report.summary && (
        <div className="flex items-start gap-1.5 text-muted-foreground/80 leading-relaxed">
          <CheckCircle2 size={12} className="text-emerald-500 shrink-0 mt-0.5" />
          <span>{report.summary}</span>
        </div>
      )}

      {/* 任务描述 */}
      {report.task && (
        <div className="rounded-md border border-border/60 bg-accent/20 overflow-hidden">
          <div className="flex items-center gap-1.5 px-2 py-1 text-[0.55rem] text-muted-foreground/60 bg-muted/30 border-b border-border/30">
            <FileText size={10} />
            委派任务
          </div>
          <div className="px-2 py-1.5 text-muted-foreground/80 leading-relaxed">
            {report.task}
          </div>
        </div>
      )}

      {/* 执行日志（可折叠） */}
      <ExecutionLog log={report.executionLog} />
    </div>
  );
}
