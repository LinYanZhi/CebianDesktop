import { useState, useEffect, useMemo, useCallback } from "react";
import { Shield, ShieldCheck, ShieldAlert, SlidersHorizontal, Search, Check, X, AlertTriangle } from "lucide-react";
import type { AIConfig, PermissionMode, ToolPermission } from "../../../lib/types";
import { getToolPermissionList } from "../../../lib/commands";

// ── 模式卡片定义 ──

const MODES: { value: PermissionMode; icon: typeof Shield; label: string; desc: string; details: string[] }[] = [
  {
    value: "conservative",
    icon: ShieldAlert,
    label: "保守模式",
    desc: "最安全，所有写/删操作需确认",
    details: [
      "写入文件、编辑文件、重命名/移动 → 需确认",
      "删除文件/目录、执行命令、删除技能 → 需确认",
      "截屏、下载文件、添加语言 → 需确认",
      "读取文件、系统信息、剪贴板等 → 自动放行",
    ],
  },
  {
    value: "balanced",
    icon: Shield,
    label: "平衡模式",
    desc: "折中，仅风险高的操作需确认",
    details: [
      "写入文件、编辑文件、重命名 → 自动放行",
      "删除文件/目录、执行命令、删除技能 → 需确认",
      "截屏、下载文件、添加语言 → 自动放行",
      "读取文件、系统信息、剪贴板等 → 自动放行",
    ],
  },
  {
    value: "trusted",
    icon: ShieldCheck,
    label: "信任模式",
    desc: "完全放行，AI 所有操作自动执行",
    details: [
      "所有工具调用自动执行，不弹确认框",
      "适合对 AI 有足够信任的场景",
      "硬性安全护栏仍然有效",
      "系统关键路径和破坏性命令仍会被拦截",
    ],
  },
  {
    value: "custom",
    icon: SlidersHorizontal,
    label: "自定义模式",
    desc: "逐工具精细控制权限",
    details: [
      "为每个工具单独设置「允许 / 需确认 / 拒绝」",
      "包括内置工具、MCP 工具和技能工具",
      "硬性安全护栏始终有效",
      "适合高级用户完全掌控 AI 能力范围",
    ],
  },
];

// ── 三态选择组件 ──

const STATE_OPTIONS: { value: ToolPermission; label: string; icon: typeof Check; cls: string }[] = [
  { value: "allow", label: "允许", icon: Check, cls: "text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/30" },
  { value: "confirm", label: "确认", icon: AlertTriangle, cls: "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30" },
  { value: "deny", label: "拒绝", icon: X, cls: "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/30" },
];

function ThreeStateToggle({ value, onChange }: { value: ToolPermission; onChange: (v: ToolPermission) => void }) {
  const idx = STATE_OPTIONS.findIndex(s => s.value === value);
  const next = (idx + 1) % STATE_OPTIONS.length;
  const cur = STATE_OPTIONS[idx];
  const Icon = cur.icon;
  return (
    <button
      onClick={() => onChange(STATE_OPTIONS[next].value)}
      className={`flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-medium transition-all ${cur.cls}`}
      title={`点击切换到「${STATE_OPTIONS[next].label}」`}
    >
      <Icon size={12} />
      {cur.label}
    </button>
  );
}

// ── 主组件 ──

interface ToolItem {
  name: string;
  description: string;
  category: string;
  source: string;
  type_label?: string;
}

export function PermissionSection({ config, onChange }: { config: AIConfig; onChange: (c: AIConfig) => void }) {
  const current = config.aiPermissionMode || "conservative";
  const [toolList, setToolList] = useState<ToolItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  // 当前工具权限表（本地编辑状态）
  const [localPerms, setLocalPerms] = useState<Record<string, ToolPermission>>({});

  // 当模式切为 custom 时加载工具列表
  useEffect(() => {
    if (current !== "custom") return;
    setLoading(true);
    getToolPermissionList().then((list) => {
      setToolList(list);
      // 用已保存的权限初始化，未设置的默认 "allow"
      const saved = config.toolPermissions || {};
      const merged: Record<string, ToolPermission> = {};
      for (const t of list) {
        merged[t.name] = (saved[t.name] as ToolPermission) || "allow";
      }
      setLocalPerms(merged);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [current]); // 只在切到 custom 时加载一次

  // 当模式不是 custom 时清空搜索和本地状态
  useEffect(() => {
    if (current !== "custom") {
      setSearch("");
      setLocalPerms({});
    }
  }, [current]);

  // 修改某个工具的权限 → 同步保存到 config
  const setToolPerm = useCallback((name: string, perm: ToolPermission) => {
    const next = { ...localPerms, [name]: perm };
    setLocalPerms(next);
    onChange({ ...config, toolPermissions: next });
  }, [config, localPerms, onChange]);

  // 按类别分组 + 搜索过滤
  const grouped = useMemo(() => {
    const map: Record<string, ToolItem[]> = {};
    const q = search.toLowerCase().trim();
    for (const t of toolList) {
      if (q && !t.name.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) continue;
      if (!map[t.category]) map[t.category] = [];
      map[t.category].push(t);
    }
    // 排序：类别内按名称
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [toolList, search]);

  // 统计
  const stats = useMemo(() => {
    const perms = Object.values(localPerms);
    return {
      allow: perms.filter(v => v === "allow").length,
      confirm: perms.filter(v => v === "confirm").length,
      deny: perms.filter(v => v === "deny").length,
    };
  }, [localPerms]);

  // ── 渲染 ──

  return (
    <section className="flex flex-col min-h-0">
      <h2 className="text-base font-semibold mb-1">AI 权限模式</h2>
      <p className="text-sm text-muted-foreground mb-5">
        控制 AI 在什么情况下需要经过你的确认才能执行操作。自定义模式下可为每个工具单独设置权限。
      </p>

      {/* 模式卡片 */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        {MODES.map((mode) => {
          const Icon = mode.icon;
          const isActive = current === mode.value;
          return (
            <button
              key={mode.value}
              onClick={() => onChange({ ...config, aiPermissionMode: mode.value })}
              className={`flex flex-col gap-2 p-3.5 rounded-xl border text-left transition-all ${
                isActive
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border/60 bg-card hover:border-border hover:bg-accent/30"
              }`}
            >
              <div className="flex items-center gap-2">
                <div className={`${isActive ? "text-primary" : "text-muted-foreground"}`}>
                  <Icon size={18} />
                </div>
                <span className={`text-sm font-medium ${isActive ? "text-foreground" : "text-foreground/80"}`}>
                  {mode.label}
                </span>
                {isActive && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium ml-auto">
                    当前
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{mode.desc}</p>
            </button>
          );
        })}
      </div>

      {/* ── 自定义模式：工具权限列表 ── */}
      {current === "custom" && (
        <div className="border border-border rounded-lg overflow-hidden mb-5">
          {/* 统计条 */}
          <div className="flex items-center gap-4 px-3 py-2 bg-muted/30 border-b border-border text-xs text-muted-foreground">
            <span>共 {toolList.length} 个工具</span>
            <span className="text-green-600 dark:text-green-400">允许 {stats.allow}</span>
            <span className="text-amber-600 dark:text-amber-400">确认 {stats.confirm}</span>
            <span className="text-red-600 dark:text-red-400">拒绝 {stats.deny}</span>
          </div>

          {/* 搜索 */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search size={14} className="text-muted-foreground shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索工具名称或描述..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-xs text-muted-foreground hover:text-foreground">
                清除
              </button>
            )}
          </div>

          {/* 工具列表 */}
          {loading ? (
            <div className="p-6 text-center text-sm text-muted-foreground">加载工具列表...</div>
          ) : (
            <div className="flex-1 overflow-y-auto min-h-0">
              {Object.entries(grouped).map(([category, items]) => (
                <div key={category}>
                  <div className="sticky top-0 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground border-b border-border/50 z-10">
                    {category}
                    <span className="ml-2 text-[10px] text-muted-foreground/50">{items.length}</span>
                  </div>
                  {items.map((tool) => {
                    const perm = localPerms[tool.name] || "allow";
                    return (
                      <div
                        key={tool.name}
                        className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/30 last:border-b-0 hover:bg-accent/20 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <code className="text-xs font-mono text-foreground/80 truncate">{tool.name}</code>
                            {tool.source === "skill" && (
                              <span className="text-[10px] px-1 rounded bg-purple-500/10 text-purple-500 shrink-0">技能</span>
                            )}
                            {tool.source === "mcp" && (
                              <span className="text-[10px] px-1 rounded bg-blue-500/10 text-blue-500 shrink-0">MCP</span>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">{tool.description}</p>
                          {tool.type_label && (
                            <p className="text-[10px] text-muted-foreground/40 truncate mt-0.5">{tool.type_label}</p>
                          )}
                        </div>
                        <ThreeStateToggle value={perm} onChange={(v) => setToolPerm(tool.name, v)} />
                      </div>
                    );
                  })}
                </div>
              ))}
              {Object.keys(grouped).length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  {search ? "没有匹配的工具" : "暂无可用工具"}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 硬性护栏提示 */}
      <div className="mt-6 mb-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
        <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mb-1">硬性安全护栏（始终生效）</p>
        <p className="text-xs text-muted-foreground">
          无论选择哪种模式，以下限制始终有效：
          禁止写入系统关键目录（C:\Windows、Program Files 等）、
          禁止执行破坏性命令（format、rm -rf 等）、
          禁止禁用系统安全组件（Defender / UAC）。
          文件写入仅限工作区和临时目录。
        </p>
      </div>
    </section>
  );
}
