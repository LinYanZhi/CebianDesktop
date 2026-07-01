import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface BrowserInfo {
  name: string;
  client_name: string;
  port: number;
  remote_addr: string | null;
  connected_at: number;
}

interface BridgeStatusData {
  running: boolean;
  running_ports: number[];
  local_addresses: string[];
  browsers: BrowserInfo[];
  browser_count: number;
}

export function BridgeStatus() {
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
    const timer = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  if (!status) return null;

  const hasBrowsers = status.running && status.browser_count > 0;
  const noBrowsers = status.running && status.browser_count === 0;

  const getState = () => {
    if (hasBrowsers) return "connected" as const;
    if (noBrowsers) return "listening" as const;
    return "offline" as const;
  };

  const state = getState();
  const label = hasBrowsers
    ? `${status.browser_count} 个已连接`
    : noBrowsers
    ? "等待连接"
    : "未启动";

  return (
    <div
      className="relative flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:bg-accent transition-colors cursor-default group"
    >
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${
          hasBrowsers
            ? "bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]"
            : noBrowsers
            ? "bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.6)]"
            : "bg-gray-400"
        }`}
      />
      <span className="hidden sm:inline">{label}</span>

      {/* Tooltip */}
      <div className="absolute top-full right-0 mt-1 w-56 bg-popover border border-border rounded-lg shadow-lg p-3 hidden group-hover:block z-50 pointer-events-none">
        <div className="space-y-1 text-[11px]">
          <div className="font-medium mb-1">
            {hasBrowsers ? "已连接浏览器：" : noBrowsers ? "等待浏览器连接..." : "桥接未就绪"}
          </div>
          {hasBrowsers && status.browsers.map((b, i) => (
            <div key={i} className="flex items-center gap-2 text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
              <span className="truncate">{b.client_name || b.name}</span>
              <span className="text-[10px] opacity-60">:{b.port}</span>
              {b.remote_addr && (
                <span className="text-[10px] opacity-40 ml-auto">←{b.remote_addr}</span>
              )}
            </div>
          ))}
          {noBrowsers && (
            <div className="text-muted-foreground/60">
              本机 IP：{status.local_addresses?.join(" / ") || "获取中..."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
