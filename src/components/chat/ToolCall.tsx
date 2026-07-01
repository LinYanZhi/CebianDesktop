import { useState, useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ToolCall } from "../../lib/types";
import {
  ToolCategory,
  TOOL_CATEGORY_META,
  getToolCategory,
  getToolLabel,
  getToolColor,
  getToolDesc,
} from "./chat-types";
import AskBrowserAiResult from "./AskBrowserAiResult";

/** 下载进度事件载荷 */
interface DownloadProgress {
  status: string;
  url: string;
  destination: string;
  engine: string;
  bytes: number;
  total: number | null;
  percent: number | null;
}

/** 工具调用卡片：仿 Cebian ToolCard，每个工具独立可折叠，显示参数+结果 */
export function ToolCallCards({ tool_calls, results, cancelled }: {
  tool_calls: ToolCall[];
  results?: Map<string, string>;
  cancelled?: boolean;
}) {
  return (
    <div className="space-y-1.5 my-2">
      {tool_calls.map((tc, i) => {
        const resultContent = results?.get(tc.id);
        const status = cancelled ? "cancelled" : (resultContent !== undefined ? "done" : "running");
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
  label: string; color: string; toolName: string; category: ToolCategory; status: 'running' | 'done' | 'cancelled'; args: string; result?: string;
}) {
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const startTimeRef = useRef<number>(0);
  const desc = getToolDesc(toolName);
  const hasArgs = args !== "{}" && args !== "{\n}";
  const catMeta = TOOL_CATEGORY_META[category];

  // ── Browser AI 实时进度 & 计时 ──
  const isBrowserAi = toolName === "ask_browser_ai";
  const [browserAiSteps, setBrowserAiSteps] = useState<any[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const finalElapsedRef = useRef(0);

  // 计时器：running 时每秒递增
  useEffect(() => {
    if (status !== "running" || !isBrowserAi) { 
      // done 或 cancelled 时保存最终用时
      if (!isBrowserAi || status === "cancelled") { setElapsed(0); }
      return; 
    }
    startTimeRef.current = Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [status, isBrowserAi]);

  // 监听 browser-ai-progress 事件，流式更新执行步骤
  useEffect(() => {
    if (status !== "running" || !isBrowserAi) {
      setBrowserAiSteps([]);
      return;
    }
    // 自动展开卡片以显示实时进度
    setOpen(true);
    let cancelled = false;

    // 先拉取已有进度缓存（避免组件挂载前错过的进度事件）
    (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const data: any = await invoke("get_bridge_agent_progress");
        if (cancelled) return;
        const progresses = data?.progresses;
        if (progresses && typeof progresses === "object") {
          // 取最新的有 steps 的进度
          const entries = Object.values(progresses) as any[];
          const latest = entries
            .filter((p: any) => Array.isArray(p?.steps) && p.steps.length > 0)
            .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0))[0];
          if (latest?.steps) {
            setBrowserAiSteps(latest.steps);
          }
        }
      } catch { /* 首次拉取失败不影响后续实时监听 */ }
    })();

    // 注册实时进度监听
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<any>("browser-ai-progress", (event) => {
        if (cancelled) return;
        const steps = event.payload?.steps;
        if (Array.isArray(steps) && steps.length > 0) {
          setBrowserAiSteps(steps);
        }
      });
      if (cancelled) { unlisten(); return; }
      unlistenRef.current = unlisten;
    })();
    return () => { cancelled = true; unlistenRef.current?.(); unlistenRef.current = null; };
  }, [status, isBrowserAi]);

  // 解析参数
  const parsedArgs = (() => {
    try { return JSON.parse(args) as Record<string, string>; } catch { return {}; }
  })();
  const isDownload = toolName === "download_file";
  const argUrl = parsedArgs.url;
  const argDest = parsedArgs.destination;

  // 下载进度监听
  useEffect(() => {
    if (!isDownload || !argUrl || !argDest) return;
    if (status !== "running") return;

    const setup = async () => {
      const unlisten = await listen<DownloadProgress>("download-progress", (event) => {
        const p = event.payload;
        // 按 URL + destination 匹配
        if (p.url === argUrl && p.destination === argDest) {
          // 首次收到 downloading 时记录开始时间
          if (p.status === "downloading" && startTimeRef.current === 0) {
            startTimeRef.current = Date.now();
          }
          // 下载结束或出错时重置开始时间
          if (p.status === "finished" || p.status === "error") {
            startTimeRef.current = 0;
          }
          setProgress(p);
        }
      });
      unlistenRef.current = unlisten;
    };
    setup();

    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, [isDownload, argUrl, argDest, status]);

  const engineLabel = (() => {
    switch (progress?.engine) {
      case "ureq": return "系统证书";
      case "ureq_insecure": return "跳过证书";
      case "curl": return "curl";
      case "powershell": return "PowerShell";
      case "bits": return "BITS";
      default: return "";
    }
  })();

  // 计算下载速度和时间
  const downloadInfo = (() => {
    if (!progress || progress.status !== "downloading" || startTimeRef.current === 0) return null;
    const elapsed = (Date.now() - startTimeRef.current) / 1000; // 秒
    if (elapsed <= 0) return null;
    const speed = progress.bytes / elapsed; // bytes/s
    let eta: number | null = null;
    if (progress.total && progress.total > 0 && speed > 0) {
      eta = (progress.total - progress.bytes) / speed;
    }
    return { elapsed, speed, eta };
  })();

  const statusText = (() => {
    if (status === 'cancelled') return "已取消";
    if (isBrowserAi && elapsed > 0) {
      const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const s = String(elapsed % 60).padStart(2, '0');
      return status === 'running' ? `浏览器 AI 执行中... ${m}:${s}` : `用时 ${m}:${s}`;
    }
    if (status === 'running' && isBrowserAi) {
      return "浏览器 AI 执行中... 00:00";
    }
    if (!progress) return desc;
    switch (progress.status) {
      case "connecting": return `正在尝试 ${engineLabel || (isDownload ? "下载引擎" : "")}...`;
      case "downloading": {
        const pct = progress.percent != null ? `${progress.percent}%` : "";
        const size = progress.total ? `${fmtSize(progress.bytes)} / ${fmtSize(progress.total)}` : fmtSize(progress.bytes);
        let parts = [`下载中 ${pct} (${size})`];
        if (downloadInfo) {
          parts.push(`${fmtSpeed(downloadInfo.speed)}`);
          parts.push(`已用 ${fmtDuration(downloadInfo.elapsed)}`);
          if (downloadInfo.eta !== null && downloadInfo.eta > 0) {
            parts.push(`剩余 ${fmtDuration(downloadInfo.eta)}`);
          }
        }
        if (engineLabel) parts.push(engineLabel);
        return parts.join(" · ");
      }
      case "engine_fallback": return `${engineLabel} 不可用，切换下一引擎...`;
      case "finished": return "下载完成";
      case "error": return "下载失败";
      default: return desc;
    }
  })();

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
        ) : status === 'cancelled' ? (
          <svg className="size-4 text-muted-foreground shrink-0" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" />
            <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
          <span className="text-[0.6rem] text-muted-foreground/60 truncate block">{statusText}</span>
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
          {/* 下载进度条 */}
          {isDownload && progress?.status === "downloading" && progress.total != null && progress.total > 0 && (
            <div className="px-3.5 py-2 bg-background border-b border-border/30">
              <div className="flex items-center justify-between text-[0.6rem] text-muted-foreground/60 mb-1">
                <span>{fmtSize(progress.bytes)} / {fmtSize(progress.total)}</span>
                <span>{progress.percent}%</span>
              </div>
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-200"
                  style={{ width: `${Math.min(progress.percent ?? 0, 100)}%` }}
                />
              </div>
              {/* 速度 + 时间信息 */}
              {downloadInfo && (
                <div className="flex items-center gap-3 mt-1.5 text-[0.55rem] text-muted-foreground/50">
                  <span>⬇ {fmtSpeed(downloadInfo.speed)}</span>
                  <span>已用 {fmtDuration(downloadInfo.elapsed)}</span>
                  {downloadInfo.eta !== null && downloadInfo.eta > 0 && (
                    <>
                      <span className="text-muted-foreground/30">|</span>
                      <span>剩余 {fmtDuration(downloadInfo.eta)}</span>
                    </>
                  )}
                </div>
              )}
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
          {/* Browser AI 实时执行进度（流式） */}
          {status === 'running' && isBrowserAi && (
            <div className="px-3.5 py-2.5 bg-background border-t border-border/50">
              <div className="text-[0.65rem] text-muted-foreground/60 mb-1.5 font-medium">实时执行过程</div>
              <div className="space-y-1 max-h-48 overflow-y-auto text-[0.6rem] font-mono leading-relaxed" style={{ scrollbarWidth: 'thin' }}>
                {browserAiSteps.length === 0 ? (
                  <div className="text-muted-foreground/50 animate-pulse">等待浏览器 AI 响应...</div>
                ) : (
                  browserAiSteps.map((step: any, i: number) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <span className={`shrink-0 font-medium ${
                        step.type === "tool_call" ? "text-amber-500/70" :
                        step.type === "tool_result" ? "text-emerald-500/70" :
                        step.type === "error" ? "text-red-500/70" :
                        "text-muted-foreground/50"
                      }`}>
                        [{step.type}]
                      </span>
                      <span className="text-muted-foreground/70 break-all">
                        {step.tool ? `[${step.tool}] ` : ""}{step.content}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          {result !== undefined && (
            <div className={`px-3.5 py-2.5 bg-background ${hasArgs ? "border-t border-border/50" : ""}`}>
              <div className="text-[0.65rem] text-muted-foreground/60 mb-1.5 font-medium">结果</div>
              {toolName === "ask_browser_ai" ? (
                <AskBrowserAiResult result={result} />
              ) : (
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all font-mono max-h-48 overflow-y-auto">
                  <code>{result}</code>
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 格式化字节数为可读字符串 */
function fmtSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** 格式化速度为可读字符串 */
function fmtSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

/** 格式化秒数为可读时长 */
function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}秒`;
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  if (min < 60) return `${min}分${sec}秒`;
  const hour = Math.floor(min / 60);
  const remainMin = min % 60;
  return `${hour}时${remainMin}分${sec}秒`;
}
