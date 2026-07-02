import { useEffect, useState, useCallback, useRef } from "react";
import {
  Play, Square, RefreshCw, Plus, Trash2, Copy, Check,
  WifiOff, Globe, Zap, Network, Link2, Bot, Power,
  GripVertical, Wifi,
} from "lucide-react";
import { toast } from "sonner";
import type { AIConfig } from "../../../lib/types";
import {
  getBridgeStatus, startBridgeServer, stopBridgeServer,
  reloadBridgeConfig, pingBrowser, disconnectBrowser, updateBrowserName,
  toggleBrowserDisabled,
} from "../../../lib/commands";

interface BridgeSectionProps {
  config: AIConfig;
  onChange: (config: AIConfig) => void;
}

/* ─── 类型 ─── */

interface BrowserInfo {
  session_id: string;
  name: string;
  port_name: string;
  client_name: string;
  browser: string;
  version: string;
  profile: string;
  windows: number;
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

/* ─── 常量 ─── */

const BROWSER_META: Record<string, { label: string; color: string }> = {
  chrome: { label: "Chrome", color: "bg-green-500" },
  edge: { label: "Edge", color: "bg-blue-500" },
  firefox: { label: "Firefox", color: "bg-orange-500" },
  safari: { label: "Safari", color: "bg-cyan-500" },
  opera: { label: "Opera", color: "bg-red-500" },
};

function getBrowserMeta(b: string) {
  return BROWSER_META[b] ?? { label: b, color: "bg-gray-400" };
}

/* ─── 浏览器 SVG 图标 ─── */

function ChromeIcon({ size = 14 }: { size?: number }) {
  return <img src="/google2.ico" alt="Chrome" width={size} height={size} className="rounded-[2px]" />;
}
function EdgeIcon({ size = 14 }: { size?: number }) {
  return <img src="/edge.ico" alt="Edge" width={size} height={size} className="rounded-[2px]" />;
}
function FirefoxIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="11" fill="#FF7139" />
      <path d="M12 1C6 1 2 5 2 11s4 10 10 10a7 7 0 0 0 7-7c0-2-1-4-2.5-5.5S14 6 12 6a3.5 3.5 0 0 0-3.5 3.5A3.5 3.5 0 0 0 12 13c1 0 2-.5 2.5-1A3.5 3.5 0 0 1 12 10a2 2 0 0 1 2-2c2 0 4 1.5 4 4a6 6 0 0 1-6 6A7 7 0 0 1 5 11a7 7 0 0 1 7-7c1 0 2 .2 3 .6A10 10 0 0 0 12 1z" fill="#fff" opacity="0.85" />
      <circle cx="12" cy="12" r="2" fill="#FF7139" />
    </svg>
  );
}
function BrowserIcon({ browser, size = 14 }: { browser: string; size?: number }) {
  switch (browser) {
    case "chrome": return <ChromeIcon size={size} />;
    case "edge": return <EdgeIcon size={size} />;
    case "firefox": return <FirefoxIcon size={size} />;
    default: return <Globe size={size} className="text-muted-foreground" />;
  }
}

function fmtDuration(secs: number): string {
  const m = Math.max(1, Math.round(secs / 60));
  return `${m}分钟`;
}

/* ═══════════════════════ 主组件 ═══════════════════════ */

export function BridgeSection({ config, onChange }: BridgeSectionProps) {
  const ports = config.bridgePorts ?? [{ name: "默认浏览器", port: 37421 }];

  const [status, setStatus] = useState<BridgeStatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [editingPort, setEditingPort] = useState<number | null>(null);
  const [editPortNum, setEditPortNum] = useState(0);
  // 自动 ping 延迟：session_id → ms
  const [latencies, setLatencies] = useState<Record<string, number>>({});

  const pollStatus = useCallback(async () => {
    try { const data = await getBridgeStatus(); setStatus(data); }
    catch { /* ignore */ }
  }, []);

  useEffect(() => {
    pollStatus();
    const timer = setInterval(pollStatus, 3000);
    return () => clearInterval(timer);
  }, [pollStatus]);

  // 自动 ping 所有已连接浏览器，每 8 秒刷新延迟
  useEffect(() => {
    const browsers = status?.browsers ?? [];
    if (browsers.length === 0) return;
    const pingAll = async () => {
      for (const b of browsers) {
        try { const res = await pingBrowser(b.session_id); setLatencies(l => ({ ...l, [b.session_id]: res.ping_ms })); }
        catch { setLatencies(l => { const c = { ...l }; delete c[b.session_id]; return c; }); }
      }
    };
    pingAll();
    const pingTimer = setInterval(pingAll, 8000);
    return () => clearInterval(pingTimer);
  }, [status?.browsers]);

  const startEditPort = (i: number) => { setEditingPort(i); setEditPortNum(ports[i].port); };
  const saveEditPort = (i: number) => {
    onChange({ ...config, bridgePorts: ports.map((p, idx) => idx === i ? { name: p.name, port: editPortNum } : p) });
    setEditingPort(null);
  };
  const cancelEditPort = () => setEditingPort(null);

  const addPort = () => {
    const next = ports.length > 0 ? Math.max(...ports.map(p => p.port)) + 1 : 37421;
    onChange({ ...config, bridgePorts: [...ports, { name: "", port: next }] });
  };
  const removePort = (index: number) => {
    const updated = ports.filter((_, i) => i !== index);
    onChange({ ...config, bridgePorts: updated.length > 0 ? updated : undefined });
  };

  const handleStart = async () => {
    setLoading(true);
    try { toast.success(await startBridgeServer()); await pollStatus(); }
    catch (e: any) { toast.error("启动失败: " + (e?.toString() || "未知错误")); }
    finally { setLoading(false); }
  };
  const handleStop = async () => {
    setLoading(true);
    try { toast.success(await stopBridgeServer()); setTestResult(null); await pollStatus(); }
    catch (e: any) { toast.error("停止失败: " + (e?.toString() || "未知错误")); }
    finally { setLoading(false); }
  };
  const handleRestart = async () => {
    setLoading(true);
    try { toast.success(await reloadBridgeConfig()); setTestResult(null); await pollStatus(); }
    catch (e: any) { toast.error("重启失败: " + (e?.toString() || "未知错误")); }
    finally { setLoading(false); }
  };

  const handleDisconnect = async (sessionId: string) => {
    try { await disconnectBrowser(sessionId); toast.success("已断开连接"); await pollStatus(); }
    catch (e: any) { toast.error("断开失败: " + (e?.toString() || "未知错误")); }
  };
  const handleUpdateName = async (sessionId: string, name: string) => {
    try { await updateBrowserName(sessionId, name); await pollStatus(); }
    catch (e: any) { toast.error("更新名称失败: " + (e?.toString() || "未知错误")); }
  };
  const handleToggleDisabled = async (sessionId: string, disabled: boolean) => {
    try { await toggleBrowserDisabled(sessionId, disabled); await pollStatus(); }
    catch (e: any) { toast.error("切换状态失败: " + (e?.toString() || "未知错误")); }
  };
  const handleTestAll = async () => {
    if (!status || status.browsers.length === 0) return;
    setTestRunning(true); setTestResult(null);
    let ok = 0;
    const total = status.browsers.length;
    for (const b of status.browsers) {
      try { await pingBrowser(b.session_id); ok++; }
      catch { /* ignore */ }
    }
    setTestResult(`测试完成：${ok}/${total} 正常`);
    setTestRunning(false);
  };

  const isRunning = status?.running ?? false;
  const localAddrs = status?.local_addresses ?? [];
  const browserList = status?.browsers ?? [];

  const activeCount = browserList.filter(b => !b.disabled).length;
  const disabledCount = browserList.filter(b => b.disabled).length;

  const browserByPort: Record<number, BrowserInfo[]> = {};
  for (const b of browserList) {
    if (!browserByPort[b.port]) browserByPort[b.port] = [];
    browserByPort[b.port].push(b);
  }

  /* ═══════════════════════ 渲染 ═══════════════════════ */

  return (
    <div className="flex-1 space-y-5">
      {/* 标题栏 */}
      <div className="flex items-center justify-between bg-card border border-border rounded-xl px-4 py-3">
        <div className="flex items-center gap-3">
          <div className={`size-9 rounded-xl flex items-center justify-center ${isRunning ? 'bg-green-500/10' : 'bg-muted'}`}>
            <Network size={16} className={isRunning ? 'text-green-500' : 'text-muted-foreground/50'} />
          </div>
          <div>
            <h2 className="text-sm font-semibold">AI 桥接</h2>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5">
              {isRunning
                ? activeCount > 0
                  ? `桥接服务运行中 · ${activeCount} 活跃${disabledCount > 0 ? ` · ${disabledCount} 已禁用` : ''}`
                  : browserList.length > 0
                    ? '全部浏览器已禁用'
                    : '等待浏览器连接...'
                : '连接本地 AI 与浏览器 AI 的桥梁'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isRunning ? (
            <>
              {/* 综合状态指示器 */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/30 border border-border/50">
                <div className="flex items-center gap-1.5">
                  {activeCount > 0 ? (
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex size-full rounded-full bg-green-400 opacity-75 animate-ping" />
                      <span className="relative inline-flex size-2 rounded-full bg-green-500" />
                    </span>
                  ) : browserList.length > 0 ? (
                    <span className="size-2 rounded-full bg-muted-foreground/40" />
                  ) : (
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex size-full rounded-full bg-red-400 opacity-75 animate-ping" />
                      <span className="relative inline-flex size-2 rounded-full bg-red-500" />
                    </span>
                  )}
                  <span className={`text-[11px] font-medium ${
                    activeCount > 0 ? 'text-green-600' : browserList.length > 0 ? 'text-muted-foreground/60' : 'text-red-600'
                  }`}>
                    {activeCount > 0 ? '运行中' : browserList.length > 0 ? '全部禁用' : '等待连接'}
                  </span>
                </div>
                <span className="w-px h-3 bg-border/60" />
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-muted-foreground">
                    <span className="font-semibold text-foreground/80">{activeCount}</span> 活跃
                  </span>
                  {disabledCount > 0 && (
                    <>
                      <span className="text-muted-foreground/30">|</span>
                      <span className="text-muted-foreground">
                        <span className="font-semibold text-muted-foreground/60">{disabledCount}</span> 已禁用
                      </span>
                    </>
                  )}
                </div>
              </div>
              <button onClick={handleStop} disabled={loading}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-destructive/10 text-destructive border border-destructive/20 rounded-lg hover:bg-destructive/20 disabled:opacity-50 transition-colors"
              ><Square size={11} />停止</button>
              <button onClick={handleRestart} disabled={loading}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors"
              ><RefreshCw size={11} className={loading ? "animate-spin" : ""} />重启</button>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted px-3 py-1.5 rounded-full border border-border/50">
                <span className="size-2 rounded-full bg-muted-foreground/30" />
                未启动
              </span>
              <button onClick={handleStart} disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors"
              ><Play size={11} />启动</button>
            </>
          )}
        </div>
      </div>

      {/* 拓扑图 */}
      {isRunning ? (
        <SvgTopology
          running={isRunning}
          localAddrs={localAddrs}
          ports={ports}
          browserByPort={browserByPort}
          browserList={browserList}
          latencies={latencies}
          editingPort={editingPort}
          editPortNum={editPortNum}
          setEditPortNum={setEditPortNum}
          startEditPort={startEditPort}
          saveEditPort={saveEditPort}
          cancelEditPort={cancelEditPort}
          handleDisconnect={handleDisconnect}
          handleUpdateName={handleUpdateName}
          handleToggleDisabled={handleToggleDisabled}
          addPort={addPort}
          removePort={removePort}
          handleTestAll={handleTestAll}
          testRunning={testRunning}
          testResult={testResult}
        />
      ) : (
        <div className="border border-dashed border-border rounded-xl bg-card p-10 flex flex-col items-center justify-center text-center">
          <div className="size-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <WifiOff size={24} className="text-muted-foreground/30" />
          </div>
          <p className="text-sm font-medium text-muted-foreground mb-1">桥接服务未启动</p>
          <p className="text-xs text-muted-foreground/50 mb-5 max-w-xs">
            CeBian 浏览器扩展依赖桥接服务连接本地 AI，启动后可查看已连接的浏览器列表和网络状态。
          </p>
          <button onClick={handleStart} disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors"
          ><Play size={11} />启动桥接服务</button>
        </div>
      )}

      {/* 端口配置（未运行） */}
      {!isRunning && (
        <div className="border border-border rounded-xl bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between bg-muted/20">
            <div className="flex items-center gap-2">
              <GripVertical size={12} className="text-muted-foreground/30" />
              <span className="text-xs font-medium">端口配置</span>
            </div>
            <button onClick={addPort} className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors">
              <Plus size={11} />添加端口
            </button>
          </div>
          <div className="divide-y divide-border">
            {ports.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-muted-foreground/50">暂无端口配置</p>
              </div>
            ) : (
              ports.map((p, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/10 transition-colors">
                  <GripVertical size={12} className="text-muted-foreground/20 shrink-0" />
                  <input value={p.name} onChange={e => onChange({ ...config, bridgePorts: ports.map((pp, j) => j === i ? { ...pp, name: e.target.value } : pp) })}
                    placeholder="端口名称（如：默认浏览器）"
                    className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-background border border-border rounded-lg outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/30"
                  />
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[11px] text-muted-foreground/40 font-mono">端口</span>
                    <input value={p.port} onChange={e => { const v = parseInt(e.target.value.replace(/\D/g, ''), 10); if (!isNaN(v) && v >= 1024 && v <= 65535) onChange({ ...config, bridgePorts: ports.map((pp, j) => j === i ? { ...pp, port: v } : pp) }); }}
                      type="text" inputMode="numeric"
                      className="w-20 px-2 py-1.5 text-xs bg-background border border-border rounded-lg outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all text-center font-mono"
                    />
                    <button onClick={() => removePort(i)} className="p-1.5 text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 连接指引 */}
      {isRunning && localAddrs.length > 0 && status && status.running_ports.length > 0 && (
        <div className="border border-border rounded-xl bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/20 flex items-center gap-2">
            <Link2 size={13} className="text-muted-foreground" />
            <span className="text-xs font-medium">CeBian 扩展连接地址</span>
          </div>
          <div className="p-3 space-y-2">
            {localAddrs.flatMap(ip => status.running_ports.map(p => ({ ip, p }))).map(({ ip, p }, i) => (
              <CopyBtn key={i} text={`ws://${ip}:${p}/ws`} />
            ))}
            <div className="flex items-center gap-2 pt-1.5 border-t border-border mt-1.5">
              <div className="size-1.5 rounded-full bg-amber-400" />
              <p className="text-[10px] text-muted-foreground/50">
                在 CeBian 扩展设置中添加上述地址即可连接到此桌面
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   纯 SVG 横向拓扑图 — 列宽随容器宽度动态分配
   ═══════════════════════════════════════════════════════ */

const ROW_H = 68;
const ROW_GAP = 6;
const PADDING = 16;
const LABEL_H = 22;
const DESKTOP_H = 72;
const PORT_H = 44;

function SvgTopology(props: {
  running: boolean;
  localAddrs: string[];
  ports: { name: string; port: number }[];
  browserByPort: Record<number, BrowserInfo[]>;
  browserList: BrowserInfo[];
  latencies: Record<string, number>;
  editingPort: number | null;
  editPortNum: number;
  setEditPortNum: (v: number) => void;
  startEditPort: (i: number) => void;
  saveEditPort: (i: number) => void;
  cancelEditPort: () => void;
  handleDisconnect: (sessionId: string) => void;
  handleUpdateName: (sessionId: string, name: string) => void;
  handleToggleDisabled: (sessionId: string, disabled: boolean) => void;
  addPort: () => void;
  removePort: (index: number) => void;
  handleTestAll: () => void;
  testRunning: boolean;
  testResult: string | null;
}) {
  const {
    running, localAddrs, ports, browserByPort, browserList, latencies,
    editingPort, editPortNum,
    setEditPortNum, startEditPort, saveEditPort, cancelEditPort,
    handleDisconnect, handleUpdateName, handleToggleDisabled, addPort, removePort, handleTestAll, testRunning, testResult,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const [cWidth, setCWidth] = useState(700);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setCWidth(e.contentRect.width);
    });
    ro.observe(el);
    setCWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // 按比例分配列宽
  const availW = Math.max(580, cWidth - PADDING * 2);
  const NODE_W = Math.round(availW * 0.16);
  const GAP = Math.round(availW * 0.06);
  const PORT_W = Math.round(availW * 0.14);
  const BROWSER_W = availW - NODE_W - PORT_W - GAP * 2;

  const X_DESKTOP = PADDING;
  const X_PORT = X_DESKTOP + NODE_W + GAP;
  const X_BROWSER = X_PORT + PORT_W + GAP;

  const mainIp = localAddrs[0] ?? "127.0.0.1";
  const moreIps = localAddrs.slice(1);

  // 每个连接行：端口 + 浏览器（port 可能重复）
  interface ConnRow {
    port: number; portName: string; portIndex: number;
    browser: BrowserInfo | null;
  }
  const connRows: ConnRow[] = [];
  for (let pi = 0; pi < ports.length; pi++) {
    const pc = ports[pi];
    const browsers = browserByPort[pc.port] ?? [];
    if (browsers.length > 0) {
      for (const b of browsers) {
        connRows.push({ port: pc.port, portName: pc.name, portIndex: pi, browser: b });
      }
    } else {
      connRows.push({ port: pc.port, portName: pc.name, portIndex: pi, browser: null });
    }
  }

  const numRows = connRows.length || 1;
  const totalH = numRows * (ROW_H + ROW_GAP) + PADDING * 2 - ROW_GAP + LABEL_H;
  const Y_START = PADDING + LABEL_H;

  // 每行中心 Y
  const rowCYs = connRows.map((_, i) => Y_START + i * (ROW_H + ROW_GAP) + ROW_H / 2);

  // 桌面节点 → 高度固定，居中
  // 桌面节点 → 在内容区域（行区域）内垂直居中
  const contentTop = Y_START;
  const contentBot = Y_START + numRows * (ROW_H + ROW_GAP) - ROW_GAP;
  const desktopY = contentTop + Math.max(0, (contentBot - contentTop - DESKTOP_H) / 2);

  // 标签位置
  const labelTop = 8;
  const labelColor = "hsl(var(--muted-foreground))";

  // 构建连线
  interface LineDef { x1: number; y1: number; x2: number; y2: number; dashed?: boolean; bi?: boolean; }
  const lines: LineDef[] = [];

  // 桌面到端口：从桌面节点右侧点到点连接到各端口节点左侧
  const desktopCenterY = desktopY + DESKTOP_H / 2;
  for (const cy of rowCYs) {
    lines.push({ x1: X_DESKTOP + NODE_W, y1: desktopCenterY, x2: X_PORT, y2: cy });
  }

  // 端口到浏览器：每行独立横线，双向箭头
  for (const cy of rowCYs) {
    lines.push({ x1: X_PORT + PORT_W, y1: cy, x2: X_BROWSER, y2: cy, bi: true });
  }

  const SVG_W = X_BROWSER + BROWSER_W + PADDING;

  // 需要处理重复端口：同一端口只在第一个行显示端口节点
  const seenPorts = new Set<number>();

  return (
    <div ref={containerRef} className="border border-border rounded-xl bg-card overflow-auto">
      <svg width="100%" height={totalH + 8} viewBox={`0 0 ${SVG_W} ${totalH + 8}`} className="block">
        <defs>
          <marker id="arr" markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">
            <polygon points="0 0, 7 2.5, 0 5" fill="#888" />
          </marker>
          <marker id="arr-rev" markerWidth="7" markerHeight="5" refX="0" refY="2.5" orient="auto">
            <polygon points="7 0, 0 2.5, 7 5" fill="#888" />
          </marker>
        </defs>

        {/* 列标签 */}
        <text x={X_DESKTOP + NODE_W / 2} y={labelTop + 10}
          textAnchor="middle" fill={labelColor} fontSize="10" fontWeight="600" letterSpacing="0.5"
          fontFamily="system-ui, sans-serif"
        >本地 AI</text>
        <text x={X_PORT + PORT_W / 2} y={labelTop + 10}
          textAnchor="middle" fill={labelColor} fontSize="10" fontWeight="600" letterSpacing="0.5"
          fontFamily="system-ui, sans-serif"
        >端口</text>
        <text x={X_BROWSER + BROWSER_W / 2} y={labelTop + 10}
          textAnchor="middle" fill={labelColor} fontSize="10" fontWeight="600" letterSpacing="0.5"
          fontFamily="system-ui, sans-serif"
        >浏览器</text>

        {/* 连线 */}
        {lines.map((l, i) => (
          <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
            stroke={l.dashed ? "#999" : "#888"}
            strokeWidth={1.5}
            strokeDasharray={l.dashed ? "4 3" : "none"}
            markerStart={l.bi ? "url(#arr-rev)" : undefined}
            markerEnd={l.bi ? "url(#arr)" : undefined}
          />
        ))}

        {/* 同一端口有多浏览器时，在端口侧画竖线连接 */}
        {(() => {
          const portGroups: { port: number; ys: number[] }[] = [];
          for (const [pi, pc] of ports.entries()) {
            const browsers = browserByPort[pc.port] ?? [];
            if (browsers.length > 1) {
              const indices: number[] = [];
              for (let ri = 0; ri < connRows.length; ri++) {
                if (connRows[ri].portIndex === pi && connRows[ri].browser) {
                  indices.push(ri);
                }
              }
              const ys = indices.map(i => rowCYs[i]);
              if (ys.length > 1) {
                portGroups.push({ port: pc.port, ys });
              }
            }
          }
          // 同一端口多浏览器，在端口和浏览器之间画竖线
          return portGroups.flatMap((g, gi) => {
            const minY = Math.min(...g.ys) - ROW_H / 2;
            const maxY = Math.max(...g.ys) + ROW_H / 2;
            const x = X_PORT + PORT_W;
            return (
              <line key={`v-${gi}`} x1={x} y1={minY} x2={x} y2={maxY}
                stroke="#888" strokeWidth={1.5}
              />
            );
          });
        })()}

        {/* 【桌面节点】左侧 */}
        <foreignObject x={X_DESKTOP} y={desktopY} width={NODE_W} height={DESKTOP_H}>
          <div className="w-full h-full flex flex-col items-center justify-center rounded-xl bg-gradient-to-b from-primary/8 to-primary/3 border-2 border-primary/25 shadow-sm p-2">
            <div className="size-8 rounded-lg bg-primary/15 flex items-center justify-center mb-1.5 shadow-sm">
              <Bot size={16} className="text-primary" />
            </div>
            <div className="text-[11px] font-bold tracking-tight text-center leading-tight">CebianDesktop</div>
            <div className="text-[9px] text-muted-foreground/50 leading-tight">Agent</div>
            <div className="text-[9px] text-muted-foreground/40 mt-1 font-mono">{mainIp}</div>
            {moreIps.length > 0 && (
              <div className="flex flex-wrap justify-center gap-1 mt-0.5">
                {moreIps.slice(0, 2).map((ip, i) => (
                  <span key={i} className="text-[8px] text-muted-foreground/30 font-mono">{ip}</span>
                ))}
                {moreIps.length > 2 && <span className="text-[8px] text-muted-foreground/30">+{moreIps.length - 2}</span>}
              </div>
            )}
          </div>
        </foreignObject>

        {/* 【端口节点 + 浏览器节点】逐行 */}
        {connRows.map((row, ri) => {
          const cy = rowCYs[ri];
          const showPort = !seenPorts.has(row.portIndex);
          if (showPort) seenPorts.add(row.portIndex);

          return (
            <g key={ri}>
              {/* 桌面到端口的连线状态标识：只要服务运行就显示绿色 */}
              <text x={(X_DESKTOP + NODE_W + X_PORT) / 2}
                y={(desktopCenterY + cy) / 2 - 7}
                textAnchor="middle" fill={running ? "#22c55e" : "#999"}
                fontSize="11" fontWeight="bold" fontFamily="system-ui, sans-serif"
              >
                {running ? "✓" : "✕"}
              </text>

              {/* 端口节点（每个端口在第一行显示） */}
              {showPort && (
                <foreignObject x={X_PORT} y={cy - PORT_H / 2} width={PORT_W} height={PORT_H}>
                  <PortNodeComp
                    port={row.port} index={row.portIndex}
                    editingPort={editingPort} editPortNum={editPortNum}
                    setEditPortNum={setEditPortNum}
                    startEditPort={startEditPort} saveEditPort={saveEditPort}
                    cancelEditPort={cancelEditPort} removePort={removePort}
                  />
                </foreignObject>
              )}

              {/* 端口到浏览器的连线状态标识 */}
              <text x={X_PORT + PORT_W + (X_BROWSER - X_PORT - PORT_W) / 2} y={cy - 8}
                textAnchor="middle" 
                fill={row.browser ? (latencies[row.browser.session_id] !== undefined ? (latencies[row.browser.session_id] < 100 ? "#22c55e" : latencies[row.browser.session_id] < 300 ? "#eab308" : "#ef4444") : "#888") : "#999"}
                fontSize="11" fontWeight="bold" fontFamily="system-ui, sans-serif"
              >
                {row.browser && latencies[row.browser.session_id] !== undefined ? `${latencies[row.browser.session_id]}ms` : row.browser ? "检测中..." : "✕"}
              </text>

              {/* 浏览器节点（每行都有） */}
              <foreignObject x={X_BROWSER} y={cy - ROW_H / 2} width={BROWSER_W} height={ROW_H}>
                {row.browser ? (
                  <BrowserNodeComp info={row.browser} handleDisconnect={handleDisconnect} handleUpdateName={handleUpdateName} handleToggleDisabled={handleToggleDisabled} />
                ) : (
                <div className="w-full h-full flex items-center justify-center border border-dashed border-border/60 rounded-lg bg-muted/5">
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground/30">
                    <Wifi size={12} />
                    等待连接...
                  </span>
                </div>
                )}
              </foreignObject>
            </g>
          );
        })}
      </svg>

      {/* 底部操作栏 */}
      <div className="border-t border-border px-3 py-2.5 flex items-center justify-between bg-muted/10">
        <button onClick={addPort} className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors">
          <Plus size={11} />添加端口
        </button>
        {browserList.length > 0 && (
          <button onClick={handleTestAll} disabled={testRunning}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            <Zap size={11} className={testRunning ? "animate-pulse" : ""} />{testRunning ? "测速中..." : "测速"}
          </button>
        )}
      </div>
      {testResult && (
        <div className="px-3 py-2 border-t border-border flex items-center gap-2 text-[11px] text-muted-foreground bg-muted/20">
          <div className={`size-1.5 rounded-full ${testResult.includes("正") ? "bg-green-400" : "bg-amber-400"}`} />
          {testResult}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════ SVG 内嵌节点组件 ═══════════════════════ */

/* PortNodeComp — 端口节点 */
function PortNodeComp({
  port, index, editingPort, editPortNum,
  setEditPortNum, startEditPort, saveEditPort, cancelEditPort, removePort,
}: {
  port: number; index: number;
  editingPort: number | null; editPortNum: number;
  setEditPortNum: (v: number) => void;
  startEditPort: (i: number) => void; saveEditPort: (i: number) => void; cancelEditPort: () => void;
  removePort: (i: number) => void;
}) {
  if (editingPort === index) {
    return (
      <div className="w-full h-full flex items-center px-2 border-2 border-primary/50 rounded-lg bg-background shadow-sm">
        <input value={editPortNum}
          onChange={e => { const v = parseInt(e.target.value.replace(/\D/g, ''), 10); setEditPortNum(v || 0); }}
          onKeyDown={e => { if (e.key === 'Enter') saveEditPort(index); if (e.key === 'Escape') cancelEditPort(); }}
          onBlur={() => saveEditPort(index)}
          type="text" inputMode="numeric" autoFocus
          className="w-full px-1 py-1 text-xs text-center font-mono bg-transparent outline-none"
        />
      </div>
    );
  }
  return (
    <div className="w-full h-full flex items-center px-2 rounded-lg bg-card border border-border shadow-sm group cursor-pointer hover:border-primary/30 hover:shadow-md transition-all"
      onClick={() => startEditPort(index)} title="点击编辑端口号"
    >
      <div className="flex-1 flex flex-col items-center justify-center min-w-0">
        <span className="text-[10px] text-muted-foreground/40 leading-none">port</span>
        <span className="font-mono text-sm font-bold tabular-nums">{port}</span>
      </div>
      <button onClick={e => { e.stopPropagation(); removePort(index); }}
        className="p-1 text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 rounded-md opacity-0 group-hover:opacity-100 transition-all shrink-0"
        title="删除端口"
      >
        <Trash2 size={10} />
      </button>
    </div>
  );
}

/* BrowserNodeComp — 浏览器节点 */
function BrowserNodeComp({
  info: b, handleDisconnect, handleUpdateName, handleToggleDisabled,
}: {
  info: BrowserInfo;
  handleDisconnect: (sessionId: string) => void;
  handleUpdateName: (sessionId: string, name: string) => void;
  handleToggleDisabled: (sessionId: string, disabled: boolean) => void;
}) {
  const meta = getBrowserMeta(b.browser);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(b.client_name || b.port_name);
  const isDisabled = b.disabled ?? false;

  const saveName = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== (b.client_name || b.port_name)) {
      handleUpdateName(b.session_id, trimmed);
    }
    setEditing(false);
  };
  const cancelName = () => {
    setEditName(b.client_name || b.port_name);
    setEditing(false);
  };

  return (
    <div className={`w-full h-full flex items-center gap-2.5 px-3 rounded-lg shadow-sm group transition-all ${
      isDisabled
        ? "border border-dashed border-muted/40 bg-muted/5"
        : "border border-border bg-card hover:border-primary/25 hover:shadow-md"
    }`}>
      {/* 浏览器图标 */}
      <div className="size-10 rounded-lg flex items-center justify-center bg-background border border-border/50 shrink-0 shadow-sm">
        <BrowserIcon browser={b.browser} size={24} />
      </div>
      {/* 浏览器信息 */}
      <div className="min-w-0 flex-1 flex flex-col justify-center gap-0.5">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          {editing ? (
            <input value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') cancelName(); }}
              onBlur={saveName}
              autoFocus
              className="w-28 px-1.5 py-0.5 text-sm font-medium border-2 border-primary/50 rounded-md bg-background outline-none"
            />
          ) : (
            <span className={`text-sm font-medium truncate cursor-pointer hover:text-primary transition-colors ${isDisabled ? "text-muted-foreground" : ""}`}
              onClick={() => { setEditName(b.client_name || b.port_name); setEditing(true); }}
              title="点击编辑名称"
            >{b.client_name || b.port_name}</span>
          )}
          <span className="text-[10px] text-muted-foreground bg-muted/80 px-1.5 py-0.5 rounded whitespace-nowrap shrink-0">{meta.label} {b.version}</span>
          {b.profile && <span className="text-[10px] text-muted-foreground bg-muted/80 px-1.5 py-0.5 rounded whitespace-nowrap shrink-0">{b.profile}</span>}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground min-w-0">
          <span className="inline-flex items-center gap-1 shrink-0" title={`会话 ID: ${b.session_id}`}><Network size={9} />{b.remote_addr ?? "?"}</span>
          <span className="shrink-0 text-muted-foreground/50">·</span>
          <span className="shrink-0 text-muted-foreground/60">{fmtDuration(b.connected_at)}</span>
          {b.windows > 0 && (
            <>
              <span className="shrink-0 text-muted-foreground/50">·</span>
              <span className="shrink-0 text-muted-foreground/60">{b.windows} 窗口</span>
            </>
          )}
          {isDisabled && (
            <span className="text-[10px] text-muted-foreground/50 bg-muted/60 px-1.5 py-0.5 rounded whitespace-nowrap shrink-0">已禁用</span>
          )}
        </div>
      </div>
      {/* 操作按钮 */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button onClick={() => handleToggleDisabled(b.session_id, !isDisabled)}
          className={`p-1.5 rounded-md transition-all ${
            isDisabled
              ? "text-green-500/70 hover:text-green-600 hover:bg-green-500/10"
              : "text-red-500/70 hover:text-red-600 hover:bg-red-500/10"
          }`}
          title={isDisabled ? "点击启用此浏览器" : "点击禁用此浏览器"}
        >
          <Power size={12} />
        </button>
        <button onClick={() => handleDisconnect(b.session_id)}
          className="p-1.5 text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 rounded-md opacity-0 group-hover:opacity-100 transition-all"
          title="断开连接"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

/* ── 复制按钮 ── */

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const doCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <button onClick={doCopy}
      className="inline-flex items-center gap-2 w-full px-3 py-2 text-[11px] font-mono bg-background border border-border rounded-lg hover:bg-accent hover:border-primary/30 transition-all group"
    >
      <span className="truncate flex-1 text-left">{text}</span>
      <span className={`flex items-center gap-1 shrink-0 text-[10px] transition-all ${
        copied ? "text-green-500" : "text-muted-foreground/40 group-hover:text-muted-foreground/70"
      }`}>
        {copied ? (
          <><Check size={11} />已复制</>
        ) : (
          <><Copy size={11} />复制</>
        )}
      </span>
    </button>
  );
}
