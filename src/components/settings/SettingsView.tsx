import { useState, useRef, useEffect } from "react";
import {
  ArrowLeft, Bot, Key, MessageSquare, FileText, Puzzle, Plug,
  DatabaseBackup, HardDrive, Sliders, Info, Eye, EyeOff, Save, Unplug
} from "lucide-react";
import { toast } from "sonner";
import type { AIConfig, ProviderInfo } from "../../lib/types";

interface SettingsViewProps {
  config: AIConfig;
  onConfigChange: (config: AIConfig) => void;
  serverPort: number;
  serverRunning: boolean;
  onStartServer: () => void;
  onStopServer: () => void;
  onPortChange: (port: number) => void;
  onBack: () => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: typeof Bot;
}

const NAV_ITEMS: NavItem[] = [
  { id: "providers", label: "AI 提供商", icon: Key },
  { id: "appearance", label: "外观", icon: Bot },
  { id: "instructions", label: "指引", icon: MessageSquare },
  { id: "prompts", label: "提示词", icon: FileText },
  { id: "skills", label: "技能", icon: Puzzle },
  { id: "mcp", label: "MCP 服务", icon: Plug },
  { id: "backup", label: "备份与恢复", icon: DatabaseBackup },
  { id: "storage", label: "文件系统", icon: HardDrive },
  { id: "advanced", label: "高级", icon: Sliders },
  { id: "about", label: "关于", icon: Info },
];

// ─── 各 Section 组件 ───────────────────────────────────

function ProvidersSection({ config, onChange }: { config: AIConfig; onChange: (c: AIConfig) => void }) {
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const updateProvider = (id: string, patch: Partial<ProviderInfo>) => {
    onChange({
      ...config,
      providers: config.providers.map(p => p.id === id ? { ...p, ...patch } : p),
    });
  };

  const handleSave = async (provider: ProviderInfo) => {
    const trimmedKey = provider.api_key.trim();
    if (!trimmedKey) return;
    if (saving[provider.id]) return;

    setSaving(s => ({ ...s, [provider.id]: true }));

    try {
      // 发送一条测试消息验证 API Key
      const verifyModel = provider.selectedModel || provider.models[0];
      const endpoint = provider.endpoint.trim().replace(/\/$/, "");

      const resp = await fetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${trimmedKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: verifyModel,
          messages: [{ role: "user", content: "Reply only: ok" }],
          max_tokens: 5,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}${body ? ` - ${body.slice(0, 200)}` : ""}`);
      }

      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content ?? "";
      if (!text.toLowerCase().includes("ok")) {
        throw new Error("回复内容不符合预期");
      }

      // 验证通过
      onChange({
        ...config,
        providers: config.providers.map(p =>
          p.id === provider.id
            ? { ...p, api_key: trimmedKey, connected: true }
            : p
        ),
        activeProviderId: provider.id,
      });
      toast.success(`${provider.name} 连接成功`);
    } catch (err: any) {
      // 验证失败，但仍保存 key（下次可重试）
      const reason = err instanceof Error ? err.message : "未知错误";
      console.error(`[Verify] ${provider.name}:`, reason);
      onChange({
        ...config,
        providers: config.providers.map(p =>
          p.id === provider.id
            ? { ...p, api_key: trimmedKey, connected: false }
            : p
        ),
      });
      toast.warning(`${provider.name} 验证失败，已保存密钥`, {
        description: reason,
      });
    } finally {
      setSaving(s => ({ ...s, [provider.id]: false }));
    }
  };

  const handleDisconnect = (provider: ProviderInfo) => {
    updateProvider(provider.id, { connected: false });
  };

  const statusBadge = (provider: ProviderInfo) => {
    if (saving[provider.id]) {
      return <span className="text-[0.65rem] px-1.5 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-500">验证中...</span>;
    }
    if (provider.connected) {
      return <span className="text-[0.65rem] px-1.5 py-0.5 rounded border border-green-500/30 bg-green-500/10 text-green-500">已连接</span>;
    }
    if (provider.api_key.trim()) {
      return <span className="text-[0.65rem] px-1.5 py-0.5 rounded border border-yellow-500/30 bg-yellow-500/10 text-yellow-500">未验证</span>;
    }
    return <span className="text-[0.65rem] px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground">未配置</span>;
  };

  return (
    <section>
      <h2 className="text-base font-semibold mb-4">AI 提供商</h2>
      <div className="space-y-5">
        {config.providers.map((provider) => (
          <div key={provider.id}>
            {/* 提供商名称 + 状态标签 */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium">{provider.name}</span>
              {statusBadge(provider)}
            </div>

            {/* API Key 输入 + 保存 + 断开 */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input type={showKeys[provider.id] ? "text" : "password"}
                  value={provider.api_key}
                  onChange={(e) => updateProvider(provider.id, { api_key: e.target.value })}
                  placeholder="API Key"
                  className="w-full bg-background border border-input rounded-lg px-3 py-1.5 text-sm outline-none focus:border-ring transition-colors pr-8 font-mono" />
                <button onClick={() => setShowKeys(s => ({ ...s, [provider.id]: !s[provider.id] }))}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-0.5">
                  {showKeys[provider.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>

              <button onClick={() => handleSave(provider)}
                disabled={saving[provider.id] || !provider.api_key.trim()}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="保存并连接">
                {saving[provider.id]
                  ? <span className="inline-block w-3.5 h-3.5 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
                  : <Save size={14} />}
              </button>

              <button onClick={() => handleDisconnect(provider)}
                disabled={!provider.connected}
                className="p-1.5 rounded-md text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="断开连接">
                <Unplug size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function InstructionsSection() {
  return (
    <section>
      <h2 className="text-base font-semibold mb-4">指引</h2>
      <p className="text-sm text-muted-foreground mb-4">自定义 AI 助手的行为指引。</p>
      <textarea className="w-full h-32 bg-background border border-input rounded-lg p-3 text-sm outline-none focus:border-ring transition-colors resize-none"
        placeholder="设置 AI 助手的个性化行为指令..." />
    </section>
  );
}

function PromptsSection({ config, onChange }: { config: AIConfig; onChange: (c: AIConfig) => void }) {
  return (
    <section>
      <h2 className="text-base font-semibold mb-4">系统提示词</h2>
      <textarea value={config.system_prompt || ''}
        onChange={(e) => onChange({ ...config, system_prompt: e.target.value })}
        className="w-full h-40 bg-background border border-input rounded-lg p-3 text-sm outline-none focus:border-ring transition-colors resize-none font-mono"
        placeholder="在这里配置 AI 助手的系统提示词..." />
      <p className="text-xs text-muted-foreground mt-2">提示词决定了 AI 助手的行为和角色定位。</p>
    </section>
  );
}

function SkillsSection() {
  return (
    <section>
      <h2 className="text-base font-semibold mb-4">技能</h2>
      <p className="text-sm text-muted-foreground">暂无可用技能。技能可以扩展 AI 的能力。</p>
    </section>
  );
}

function MCPSection({ port, running, onStart, onStop, onPortChange }: {
  port: number; running: boolean;
  onStart: () => void; onStop: () => void; onPortChange: (p: number) => void;
}) {
  return (
    <section>
      <h2 className="text-base font-semibold mb-4">MCP 服务器</h2>
      <div className="bg-card border border-border rounded-lg p-4 space-y-4">
        <div className="flex items-center gap-3">
          <label className="text-sm text-muted-foreground">端口:</label>
          <input type="number" value={port}
            onChange={(e) => onPortChange(parseInt(e.target.value) || 8080)}
            className="w-24 bg-background border border-input rounded-lg px-3 py-1.5 text-sm outline-none focus:border-ring" />
          <button onClick={running ? onStop : onStart}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${running ? 'bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/30' : 'bg-primary text-primary-foreground hover:bg-primary/90'}`}>
            {running ? '停止' : '启动'}
          </button>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className={`w-2 h-2 rounded-full ${running ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
          <span className="text-muted-foreground">{running ? `服务运行中 (端口 ${port})` : '服务未启动'}</span>
        </div>
      </div>
    </section>
  );
}

function BackupSection() {
  return (
    <section>
      <h2 className="text-base font-semibold mb-4">备份与恢复</h2>
      <div className="flex gap-2">
        <button className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90">导出备份</button>
        <button className="px-4 py-2 bg-background border border-input rounded-lg text-xs font-medium text-muted-foreground hover:border-ring">导入恢复</button>
      </div>
    </section>
  );
}

function StorageSection() {
  return (
    <section>
      <h2 className="text-base font-semibold mb-4">文件系统</h2>
      <p className="text-sm text-muted-foreground">对话数据存储于应用本地目录。</p>
    </section>
  );
}

function AdvancedSection() {
  return (
    <section>
      <h2 className="text-base font-semibold mb-4">高级设置</h2>
      <p className="text-sm text-muted-foreground">暂无高级设置项。</p>
    </section>
  );
}

// ─── 外观（主题色自定义） ───────────────────────────────

const PRESET_COLORS = [
  { hue: 24,  label: "橙色", class: "bg-[hsl(24,95%,53%)]" },
  { hue: 210, label: "蓝色", class: "bg-[hsl(210,95%,53%)]" },
  { hue: 160, label: "绿色", class: "bg-[hsl(160,64%,52%)]" },
  { hue: 270, label: "紫色", class: "bg-[hsl(270,70%,60%)]" },
  { hue: 330, label: "粉色", class: "bg-[hsl(330,80%,60%)]" },
  { hue: 0,   label: "红色", class: "bg-[hsl(0,88%,60%)]" },
  { hue: 180, label: "青色", class: "bg-[hsl(180,70%,50%)]" },
  { hue: 45,  label: "黄色", class: "bg-[hsl(45,90%,55%)]" },
];

function AppearanceSection({ config, onChange }: { config: AIConfig; onChange: (c: AIConfig) => void }) {
  const currentHue = config.primary_hue ?? 24;

  return (
    <section>
      <h2 className="text-base font-semibold mb-4">外观</h2>

      {/* 预设颜色 */}
      <div className="mb-5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">预设主题色</p>
        <div className="flex flex-wrap gap-2.5">
          {PRESET_COLORS.map(({ hue, label, class: bgClass }) => (
            <button key={hue} onClick={() => onChange({ ...config, primary_hue: hue })}
              className="flex flex-col items-center gap-1.5 group"
              title={label}>
              <div className={`w-8 h-8 rounded-full border-2 transition-all ${currentHue === hue ? 'border-foreground scale-110' : 'border-transparent group-hover:border-muted-foreground/50'} ${bgClass}`} />
              <span className="text-[0.6rem] text-muted-foreground">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 色相滑块 */}
      <div className="mb-5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">自定义色相</p>
        <div className="flex items-center gap-3">
          <input type="range" min="0" max="360" value={currentHue}
            onChange={(e) => onChange({ ...config, primary_hue: parseInt(e.target.value) })}
            className="flex-1 h-2 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, 
                hsl(0,95%,53%), hsl(30,95%,53%), hsl(60,95%,53%), 
                hsl(120,95%,53%), hsl(180,95%,53%), hsl(240,95%,53%), 
                hsl(300,95%,53%), hsl(360,95%,53%))`,
            }} />
          <span className="text-xs font-mono tabular-nums text-muted-foreground w-10 text-right">{currentHue}°</span>
        </div>
      </div>

      {/* 实时预览 */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">预览</p>
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg shrink-0" style={{ background: `hsl(${currentHue}, 95%, 53%)` }} />
            <div>
              <p className="text-sm font-medium" style={{ color: `hsl(${currentHue}, 95%, 40%)` }}>
                主色调 {currentHue}°
              </p>
              <p className="text-xs text-muted-foreground">按钮、链接、图标等元素将使用此颜色</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button style={{ background: `hsl(${currentHue}, 95%, 53%)`, color: currentHue > 60 && currentHue < 200 ? '#000' : '#fff' }}
              className="px-4 py-1.5 rounded-lg text-xs font-medium">
              主要按钮
            </button>
            <button style={{ borderColor: `hsl(${currentHue}, 95%, 53%)`, color: `hsl(${currentHue}, 95%, 53%)` }}
              className="px-4 py-1.5 rounded-lg text-xs font-medium border">
              次要按钮
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function AboutSection() {
  return (
    <section>
      <h2 className="text-base font-semibold mb-4">关于</h2>
      <div className="bg-card border border-border rounded-lg p-4 space-y-4">
        {/* 应用信息 */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
            <Bot size={22} className="text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">CebianDesktop</p>
            <p className="text-xs text-muted-foreground">版本 0.1.0</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          CebianDesktop 是 CeBian 浏览器扩展的桌面伴侣应用，提供原生的 AI 对话体验、文件操作、MCP 工具集成等能力。
        </p>

        {/* 分隔线 */}
        <div className="border-t border-border" />

        {/* 作者信息 */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">作者</p>
          <div className="inline-flex items-center gap-2.5 text-sm">
            <a href="https://github.com/LinYanZhi" target="_blank" rel="noopener noreferrer" className="shrink-0">
              <img src="https://github.com/LinYanZhi.png" alt="LinYanZhi"
                className="w-8 h-8 rounded-full ring-2 ring-border hover:ring-primary/50 transition-all" />
            </a>
            <div>
              <a href="https://github.com/LinYanZhi" target="_blank" rel="noopener noreferrer"
                className="block font-medium text-primary hover:underline">
                LinYanZhi
              </a>
              <a href="https://github.com/LinYanZhi/CebianDesktop" target="_blank" rel="noopener noreferrer"
                className="block text-xs text-muted-foreground hover:underline transition-colors">
                github.com/LinYanZhi/CebianDesktop
              </a>
            </div>
          </div>
        </div>

        {/* 技术栈 */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">当前项目技术栈</p>
          <div className="flex flex-wrap gap-1.5">
            {["Tauri v2", "React", "TypeScript", "Tailwind CSS", "Rust"].map((tech) => (
              <span key={tech}
                className="px-2 py-0.5 rounded-md bg-accent/50 border border-border text-[0.65rem] text-muted-foreground">
                {tech}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── 主组件 ────────────────────────────────────────────

export default function SettingsView(props: SettingsViewProps) {
  const [active, setActive] = useState("providers");
  const [navMode, setNavMode] = useState<"wide" | "medium" | "compact">("wide");
  const measureRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const fullWidthRef = useRef(0);

  // 1. 测量所有项（图标+文字）的实际总宽度（仅一次）
  useEffect(() => {
    if (measureRef.current) {
      fullWidthRef.current = measureRef.current.scrollWidth;
    }
  }, []);

  // 2. 响应式：用 ResizeObserver 监测 nav 容器，window 宽度决定竖向
  useEffect(() => {
    const fullWidth = fullWidthRef.current || 450;
    const check = (entry?: ResizeObserverEntry) => {
      const windowW = window.innerWidth;
      const availableW = entry?.contentBoxSize?.[0]?.inlineSize ?? navRef.current?.clientWidth ?? windowW;

      // 竖向：窗口宽度足够放侧栏（w-44=176px）+ 内容区（至少 fullWidth）
      const wideThreshold = fullWidth + 276;
      if (windowW >= wideThreshold) {
        setNavMode("wide");
        return;
      }
      // 横向：nav 容器宽度能否放下所有项（有 8px 滞后缓冲）
      if (availableW >= fullWidth - 8) {
        setNavMode("medium");
      } else {
        setNavMode("compact");
      }
    };

    // 立即执行一次
    check();

    // ResizeObserver 监测 nav 容器
    const ro = new ResizeObserver((entries) => {
      check(entries[0]);
    });
    if (navRef.current) ro.observe(navRef.current);

    // window resize 也触发（影响竖向判定）
    const onResize = () => { check(); };
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const renderSection = () => {
    switch (active) {
      case "providers": return <ProvidersSection config={props.config} onChange={props.onConfigChange} />;
      case "appearance": return <AppearanceSection config={props.config} onChange={props.onConfigChange} />;
      case "instructions": return <InstructionsSection />;
      case "prompts": return <PromptsSection config={props.config} onChange={props.onConfigChange} />;
      case "skills": return <SkillsSection />;
      case "mcp": return <MCPSection port={props.serverPort} running={props.serverRunning} onStart={props.onStartServer} onStop={props.onStopServer} onPortChange={props.onPortChange} />;
      case "backup": return <BackupSection />;
      case "storage": return <StorageSection />;
      case "advanced": return <AdvancedSection />;
      case "about": return <AboutSection />;
      default: return null;
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* 顶部栏 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <button onClick={props.onBack} className="p-1 rounded-md hover:bg-accent text-muted-foreground">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-sm font-semibold">设置</h1>
      </div>

      {/* 测量容器（始终渲染，用于预测量图标+文字宽度） */}
      <div ref={measureRef}
        className="flex gap-1 px-3 py-2 invisible absolute pointer-events-none overflow-hidden"
        aria-hidden="true">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap shrink-0">
              <Icon size={14} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* 竖向导航 */}
      {navMode === "wide" ? (
        <div className="flex-1 flex min-h-0">
          <nav className="w-44 border-r border-border bg-card p-2 flex flex-col gap-1 shrink-0 overflow-y-auto">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} onClick={() => setActive(item.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${active === item.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"}`}>
                  <Icon size={16} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 min-w-0">
            {renderSection()}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {/* 横向导航 */}
          <nav ref={navRef}
            className="flex gap-1 px-3 py-2 border-b border-border bg-card shrink-0 overflow-x-auto scrollbar-hidden">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = active === item.id;
              return (
                <button key={item.id} onClick={() => setActive(item.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors shrink-0 ${
                    isActive ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"
                  }`}
                  title={navMode === "compact" ? item.label : undefined}>
                  <Icon size={14} />
                  {/* medium: 显示文字 / compact: 仅图标 */}
                  {navMode === "medium" && <span>{item.label}</span>}
                </button>
              );
            })}
          </nav>
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 min-w-0">
            {renderSection()}
          </div>
        </div>
      )}
    </div>
  );
}
