import { Shield, ShieldCheck } from "lucide-react";
import type { AIConfig, PermissionMode } from "../../../lib/types";

const MODES: { value: PermissionMode; icon: typeof Shield; label: string; desc: string; details: string[] }[] = [
  {
    value: "safe",
    icon: Shield,
    label: "安全模式",
    desc: "写入/删除/重命名/执行命令等操作需用户确认",
    details: [
      "读取文件、系统信息等 → 自动放行",
      "写入文件、编辑文件、删除、重命名 → 需确认",
      "执行终端命令 → 需确认",
      "硬性安全护栏始终有效（保护系统目录和破坏性命令）",
    ],
  },
  {
    value: "trusted",
    icon: ShieldCheck,
    label: "信任模式",
    desc: "所有工具调用自动执行，适合高度信任场景",
    details: [
      "所有工具调用自动执行，不弹确认框",
      "硬性安全护栏仍然有效",
      "系统关键路径和破坏性命令仍会被拦截",
    ],
  },
];

export function PermissionSection({ config, onChange }: { config: AIConfig; onChange: (c: AIConfig) => void }) {
  const current = config.aiPermissionMode || "safe";

  return (
    <section className="flex flex-col min-h-0 flex-1">
      <h2 className="text-base font-semibold mb-1">AI 权限模式</h2>
      <p className="text-sm text-muted-foreground mb-5">
        控制 AI 在哪些操作上需要经过你的确认。
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
              {isActive && (
                <ul className="mt-1 space-y-1">
                  {mode.details.map((d, i) => (
                    <li key={i} className="text-[11px] text-muted-foreground/70 flex items-start gap-1.5">
                      <span className="mt-0.5 shrink-0">•</span>
                      {d}
                    </li>
                  ))}
                </ul>
              )}
            </button>
          );
        })}
      </div>

      {/* 硬性护栏提示 */}
      <div className="mb-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
        <p className="text-xs text-amber-600 dark:text-amber-400 font-medium mb-1">硬性安全护栏（始终生效）</p>
        <p className="text-xs text-muted-foreground">
          无论选择哪种模式，以下限制始终有效：
          禁止写入系统关键目录（C:\Windows、Program Files 等）、
          禁止执行破坏性命令（format、rm -rf 等）、
          禁止禁用系统安全组件（Defender / UAC）。
          用户目录、桌面、文档、网络共享路径均可正常读写。
        </p>
      </div>
    </section>
  );
}
