import { Shield, ShieldCheck, ShieldAlert } from "lucide-react";
import type { AIConfig, PermissionMode } from "../../../lib/types";

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
];

export function PermissionSection({ config, onChange }: { config: AIConfig; onChange: (c: AIConfig) => void }) {
  const current = config.aiPermissionMode || "conservative";

  return (
    <section>
      <h2 className="text-base font-semibold mb-1">AI 权限模式</h2>
      <p className="text-sm text-muted-foreground mb-5">
        控制 AI 在什么情况下需要经过你的确认才能执行操作。修改后立即生效，新对话使用新设置。
      </p>

      <div className="flex flex-col gap-3">
        {MODES.map((mode) => {
          const Icon = mode.icon;
          const isActive = current === mode.value;
          return (
            <button
              key={mode.value}
              onClick={() => onChange({ ...config, aiPermissionMode: mode.value })}
              className={`flex items-start gap-4 p-4 rounded-xl border text-left transition-all ${
                isActive
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border/60 bg-card hover:border-border hover:bg-accent/30"
              }`}
            >
              <div className={`mt-0.5 ${isActive ? "text-primary" : "text-muted-foreground"}`}>
                <Icon size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-sm font-medium ${isActive ? "text-foreground" : "text-foreground/80"}`}>
                    {mode.label}
                  </span>
                  {isActive && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                      当前
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mb-2">{mode.desc}</p>
                <ul className="space-y-0.5">
                  {mode.details.map((d, i) => (
                    <li key={i} className="text-xs text-muted-foreground/70 flex items-start gap-1.5">
                      <span className="mt-1.5 block w-1 h-1 rounded-full bg-muted-foreground/40 shrink-0" />
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
              <div className={`mt-1 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                isActive ? "border-primary" : "border-border"
              }`}>
                {isActive && <div className="w-2 h-2 rounded-full bg-primary" />}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
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
