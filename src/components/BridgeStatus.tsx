import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface BrowserInfo {
  name: string;
  client_name: string;
  port: number;
  remote_addr: string | null;
  connected_at: number;
  disabled?: boolean;
}

interface BridgeStatusData {
  running: boolean;
  running_ports: number[];
  local_addresses: string[];
  browsers: BrowserInfo[];
  browser_count: number;
}

interface BridgeStatusProps {
  onNavigateToBridge?: () => void;
}

export function BridgeStatus({ onNavigateToBridge }: BridgeStatusProps) {
  const [status, setStatus] = useState<BridgeStatusData | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await invoke<BridgeStatusData>("get_bridge_status");
        if (!cancelled) setStatus(data);
      } catch { /* ignore */ }
    };
    poll();
    const timer = setInterval(poll, 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  if (!status) return null;

  const hasBrowsers = status.running && status.browser_count > 0;
  const noBrowsers = status.running && status.browser_count === 0;
  const activeCount = status.browsers.filter(b => !b.disabled).length;
  const disabledCount = status.browsers.filter(b => b.disabled).length;
  const hasActive = activeCount > 0;

  const label = !status.running
    ? "未启动"
    : hasActive
    ? `${activeCount} 活跃`
    : hasBrowsers
    ? "全部禁用"
    : "等待连接";

  return (
    <div
      onClick={() => {
        if (onNavigateToBridge && (hasBrowsers || noBrowsers)) {
          onNavigateToBridge();
        }
      }}
      className={`relative flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground transition-colors group ${hasBrowsers || noBrowsers ? "hover:bg-accent cursor-pointer" : "cursor-default"}`}
    >
      <span
        className={`w-2 h-2 rounded-full shrink-0 transition-colors ${
          !status.running
            ? "bg-gray-400"
            : hasActive
              ? "bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]"
              : hasBrowsers
                ? "bg-gray-400"
                : "bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.6)]"
        }`}
      />
      <span className="hidden sm:inline">{label}</span>

      {/* Tooltip */}
      <div className="absolute top-full right-0 mt-1 min-w-72 bg-popover border border-border rounded-lg shadow-lg p-3 hidden group-hover:block z-50 pointer-events-none"
        onClick={(e) => e.stopPropagation()}
      >
        {hasBrowsers ? (
          <div className="text-[11px] space-y-1">
            {/* 表头 */}
            <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-x-2 text-[10px] text-muted-foreground/50 font-medium mb-1.5 pb-1 border-b border-border/50">
              <span>浏览器</span>
              <span>端口</span>
              <span className="text-right">IP 地址</span>
              <span className="text-right">状态</span>
            </div>
            {/* 数据行 */}
            {status.browsers.map((b, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto] gap-x-2 items-center py-0.5">
                <span className="truncate font-medium text-foreground/80">
                  {b.client_name || b.name}
                </span>
                <span className="font-mono tabular-nums text-muted-foreground">{b.port}</span>
                <span className="text-right font-mono tabular-nums text-muted-foreground/60 break-all">
                  {b.remote_addr || status.local_addresses?.[0] || "-"}
                </span>
                <span className={`text-right text-[10px] ${b.disabled ? 'text-muted-foreground/50' : 'text-green-500'}`}>
                  {b.disabled ? '禁用' : '活跃'}
                </span>
              </div>
            ))}
            {disabledCount > 0 && (
              <div className="pt-1.5 mt-1.5 border-t border-border/50 text-[10px] text-muted-foreground/60">
                {disabledCount} 个已禁用 · {activeCount} 个活跃
              </div>
            )}
          </div>
        ) : noBrowsers ? (
          <div className="text-[11px] text-muted-foreground">
            <div className="font-medium mb-1">等待浏览器连接...</div>
            <div className="text-muted-foreground/60">
              本机 IP：{status.local_addresses?.join(" / ") || "获取中..."}
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-muted-foreground">
            <span>桥接未启动</span>
          </div>
        )}
      </div>
    </div>
  );
}
