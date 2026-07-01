import { useState, useMemo } from "react";
import { FileText, X, CheckCircle, XCircle, ChevronDown, ChevronRight, Clock } from "lucide-react";
import type { ToolExecutionRecord } from "../../lib/types";
import { TOOL_EXPORT_LABELS } from "../../lib/constants";

interface ToolLogViewerProps {
  toolLogs: ToolExecutionRecord[];
  /** 关闭日志查看器 */
  onClose: () => void;
}

/**
 * 工具执行日志查看器 — 以时间线方式展示所有工具调用记录
 */
export function ToolLogViewer({ toolLogs, onClose }: ToolLogViewerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 按轮次分组
  const groupedLogs = useMemo(() => {
    const groups = new Map<number, ToolExecutionRecord[]>();
    for (const log of toolLogs) {
      const list = groups.get(log.round) || [];
      list.push(log);
      groups.set(log.round, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a - b);
  }, [toolLogs]);

  const successCount = toolLogs.filter(l => l.success).length;
  const failCount = toolLogs.filter(l => !l.success).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border border-border rounded-xl shadow-2xl w-[800px] max-w-[90vw] max-h-[85vh] flex flex-col">
        {/* ── 头部 ── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-primary" />
            <span className="font-semibold text-base">工具执行日志</span>
            <span className="text-xs text-muted-foreground ml-2">
              {toolLogs.length} 条调用
              {failCount > 0 && (
                <span className="text-destructive ml-2">
                  ({failCount} 条失败)
                </span>
              )}
            </span>
          </div>
          <button
            onClick={onClose}
            className="size-7 flex items-center justify-center rounded-md hover:bg-accent transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── 统计摘要 ── */}
        <div className="flex gap-4 px-5 py-3 border-b border-border/50 bg-muted/20 shrink-0">
          <div className="flex items-center gap-1.5 text-xs">
            <CheckCircle size={14} className="text-green-500" />
            <span>成功: {successCount}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <XCircle size={14} className="text-destructive" />
            <span>失败: {failCount}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock size={14} />
            <span>{groupedLogs.length} 轮</span>
          </div>
        </div>

        {/* ── 日志列表 ── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {groupedLogs.length === 0 && (
            <div className="text-center text-muted-foreground py-8 text-sm">
              暂无工具调用记录
            </div>
          )}

          {groupedLogs.map(([round, logs]) => (
            <div key={round} className="border border-border/60 rounded-lg overflow-hidden">
              <div className="bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground font-medium border-b border-border/40">
                第 {round + 1} 轮工具调用
              </div>
              {logs.map((log, idx) => {
                const label = TOOL_EXPORT_LABELS[log.toolName]?.label || log.toolName;
                const isExpanded = expandedId === log.toolCallId;
                return (
                  <div key={log.toolCallId} className={idx < logs.length - 1 ? "border-b border-border/30" : ""}>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : log.toolCallId)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/40 transition-colors text-left"
                    >
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span className={`size-2 rounded-full shrink-0 ${log.success ? "bg-green-500" : "bg-destructive"}`} />
                      <span className="text-sm font-medium">{label}</span>
                      <span className="text-[11px] text-muted-foreground ml-auto">
                        {new Date(log.timestamp).toLocaleTimeString("zh-CN")}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="px-3 pb-3 space-y-2">
                        {/* 参数 */}
                        <div>
                          <div className="text-[11px] text-muted-foreground mb-1">参数</div>
                          <pre className="text-xs bg-muted/30 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto">
                            {(() => {
                              try {
                                return JSON.stringify(JSON.parse(log.arguments), null, 2);
                              } catch {
                                return log.arguments;
                              }
                            })()}
                          </pre>
                        </div>
                        {/* 结果 */}
                        <div>
                          <div className="text-[11px] text-muted-foreground mb-1">结果</div>
                          <pre className={`text-xs rounded p-2 overflow-x-auto max-h-48 overflow-y-auto ${log.success ? "bg-muted/30" : "bg-destructive/10 text-destructive"}`}>
                            {log.result}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
