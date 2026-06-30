import { useEffect, useState, useCallback } from "react";
import { Plus, Trash2, Wifi, Play, Square, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { AIConfig } from "../../../lib/types";
import { getBridgeStatus, startBridgeServer, stopBridgeServer, reloadBridgeConfig } from "../../../lib/commands";

interface BridgeSectionProps {
  config: AIConfig;
  onChange: (config: AIConfig) => void;
}

interface BrowserInfo {
  session_id: string;
  name: string;
  port_name: string;
  browser: string;
  version: string;
  profile: string;
  profile_avatar: string;
  windows: number;
  port: number;
  connected_at: number;
}

interface BridgeStatusData {
  running: boolean;
  running_ports: number[];
  browsers: BrowserInfo[];
  browser_count: number;
}

const BROWSER_COLORS: Record<string, string> = {
  edge: "bg-blue-500",
  chrome: "bg-green-500",
  firefox: "bg-orange-500",
  safari: "bg-cyan-500",
  opera: "bg-red-500",
};

const BROWSER_LABELS: Record<string, string> = {
  edge: "Edge",
  chrome: "Chrome",
  firefox: "Firefox",
  safari: "Safari",
  opera: "Opera",
};

export function BridgeSection({ config, onChange }: BridgeSectionProps) {
  const ports = config.bridgePorts ?? [{ name: "默认浏览器", port: 37421 }];
  const [status, setStatus] = useState<BridgeStatusData | null>(null);
  const [loading, setLoading] = useState(false);

  const pollStatus = useCallback(async () => {
    try {
      const data = await getBridgeStatus();
      setStatus(data);
    } catch {
      // bridge not available
    }
  }, []);

  useEffect(() => {
    pollStatus();
    const timer = setInterval(pollStatus, 3000);
    return () => clearInterval(timer);
  }, [pollStatus]);

  const updatePort = (index: number, field: "name" | "port", value: string | number) => {
    const updated = ports.map((p, i) =>
      i === index ? { ...p, [field]: value } : p
    );
    onChange({ ...config, bridgePorts: updated });
  };

  const addPort = () => {
    const newPort = ports.length > 0 ? Math.max(...ports.map(p => p.port)) + 1 : 37421;
    onChange({ ...config, bridgePorts: [...ports, { name: "", port: newPort }] });
  };

  const removePort = (index: number) => {
    const updated = ports.filter((_, i) => i !== index);
    onChange({ ...config, bridgePorts: updated.length > 0 ? updated : undefined });
  };

  const handleStart = async () => {
    setLoading(true);
    try {
      const msg = await startBridgeServer();
      toast.success(msg);
      pollStatus();
    } catch (e: any) {
      toast.error("启动失败: " + (e?.toString() || "未知错误"));
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      const msg = await stopBridgeServer();
      toast.success(msg);
      pollStatus();
    } catch (e: any) {
      toast.error("停止失败: " + (e?.toString() || "未知错误"));
    } finally {
      setLoading(false);
    }
  };

  const handleRestart = async () => {
    setLoading(true);
    try {
      const msg = await reloadBridgeConfig();
      toast.success(msg);
      pollStatus();
    } catch (e: any) {
      toast.error("重启失败: " + (e?.toString() || "未知错误"));
    } finally {
      setLoading(false);
    }
  };

  const isRunning = status?.running ?? false;

  return (
    <section>
      <h2 className="text-base font-semibold mb-4">双 AI 桥接</h2>

      {/* 服务状态 */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wifi size={16} className="text-muted-foreground" />
            <span className="text-sm font-medium">桥接服务</span>
          </div>
          <div className="flex items-center gap-2">
            {isRunning ? (
              <>
                <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]" />
                <span className="text-xs text-muted-foreground">运行中</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-gray-400" />
                <span className="text-xs text-muted-foreground">未启动</span>
              </>
            )}
          </div>
        </div>

        {/* 控制按钮 */}
        <div className="flex items-center gap-2">
          {isRunning ? (
            <>
              <button onClick={handleStop} disabled={loading}
                className="flex items-center gap-1 px-3 py-1.5 bg-destructive/10 text-destructive border border-destructive/30 rounded-lg text-xs font-medium hover:bg-destructive/20 transition-colors">
                <Square size={12} />停止
              </button>
              <button onClick={handleRestart} disabled={loading}
                className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors">
                <RefreshCw size={12} />重启
              </button>
            </>
          ) : (
            <button onClick={handleStart} disabled={loading}
              className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors">
              <Play size={12} />启动
            </button>
          )}
        </div>

        {/* 已连接浏览器列表 */}
        {isRunning && status && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              已连接浏览器 ({status.browser_count})
            </p>
            {status.browsers.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">等待浏览器连接...</p>
            ) : (
              <div className="space-y-1.5">
                {status.browsers.map((b) => (
                  <div key={b.session_id} className="flex items-center gap-2 p-2 rounded-md bg-background/50 border border-border">
                    {/* 浏览器类型指示器 */}
                    <span className={`w-2 h-2 rounded-full shrink-0 ${BROWSER_COLORS[b.browser] || "bg-gray-400"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium">{b.name || b.port_name}</span>
                        {b.profile && (
                          <span className="text-[0.6rem] px-1 py-0.5 rounded bg-accent text-muted-foreground">
                            {b.profile}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[0.6rem] text-muted-foreground">
                        <span>{BROWSER_LABELS[b.browser] || b.browser} {b.version}</span>
                        {b.windows > 0 && <span>{b.windows} 个窗口</span>}
                        <span>已连 {b.connected_at}s</span>
                      </div>
                    </div>
                    <span className="text-[0.6rem] text-muted-foreground">端口 {b.port}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 端口配置 */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">端口配置</p>
          <button onClick={addPort}
            className="flex items-center gap-1 px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded-md transition-colors">
            <Plus size={12} />添加端口
          </button>
        </div>

        <div className="space-y-2">
          {ports.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="text" placeholder="端口名称" value={p.name}
                onChange={(e) => updatePort(i, "name", e.target.value)}
                className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-background border border-border rounded-md outline-none focus:border-ring placeholder:text-muted-foreground/50" />
              <input type="number" min={1024} max={65535} value={p.port}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 1024 && v <= 65535) updatePort(i, "port", v);
                }}
                className="w-20 px-2 py-1.5 text-xs bg-background border border-border rounded-md outline-none focus:border-ring text-center" />
              <button onClick={() => removePort(i)}
                className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                title="移除">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <p className="text-[0.65rem] text-muted-foreground">
          修改端口配置后点击「重启」按钮即可生效，无需重启应用。
        </p>
      </div>
    </section>
  );
}
