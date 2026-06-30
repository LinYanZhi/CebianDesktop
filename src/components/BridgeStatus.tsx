import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface BrowserInfo {
  name: string;
  client_name: string;
  port: number;
  connected_at: number;
}

interface BridgeStatusData {
  running: boolean;
  running_ports: number[];
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
      } catch {
        // 桥接命令未注册或调用失败，忽略
      }
    };

    // 立即查询一次
    poll();

    // 每 3 秒轮询
    const timer = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!status) {
    return null;
  }

  const hasBrowsers = status.running && status.browser_count > 0;
  const noBrowsers = status.running && status.browser_count === 0;

  // 构建 tooltip 详细内容
  const tooltipLines: string[] = [];
  if (hasBrowsers) {
    tooltipLines.push(`已连接 ${status.browser_count} 个浏览器：`);
    for (const b of status.browsers) {
      tooltipLines.push(`  ${b.name}（${b.client_name}）- 端口 ${b.port}`);
    }
  } else if (noBrowsers) {
    tooltipLines.push(`桥接服务器已启动，等待浏览器连接...`);
    tooltipLines.push(`监听端口：${status.running_ports.join(", ")}`);
  } else {
    tooltipLines.push("双 AI 桥接未就绪");
  }

  return (
    <button
      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:bg-accent transition-colors cursor-default"
      title={tooltipLines.join("\n")}
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
      <span className="hidden sm:inline">
        {hasBrowsers
          ? `${status.browser_count} 个浏览器已连接`
          : noBrowsers
          ? "等待浏览器..."
          : "桥接未就绪"}
      </span>
    </button>
  );
}
