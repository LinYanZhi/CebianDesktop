import type { AIConfig } from "../../../lib/types";

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

export function AppearanceSection({ config, onChange }: { config: AIConfig; onChange: (c: AIConfig) => void }) {
  const currentHue = config.primary_hue ?? 24;
  return (
    <section>
      <h2 className="text-base font-semibold mb-4">外观</h2>
      <div className="mb-5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">预设主题色</p>
        <div className="flex flex-wrap gap-2.5">
          {PRESET_COLORS.map(({ hue, label, class: bgClass }) => (
            <button key={hue} onClick={() => onChange({ ...config, primary_hue: hue })}
              className="flex flex-col items-center gap-1.5 group" title={label}>
              <div className={`w-8 h-8 rounded-full border-2 transition-all ${currentHue === hue ? 'border-foreground scale-110' : 'border-transparent group-hover:border-muted-foreground/50'} ${bgClass}`} />
              <span className="text-[0.6rem] text-muted-foreground">{label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="mb-5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">自定义色相</p>
        <div className="flex items-center gap-3">
          <input type="range" min="0" max="360" value={currentHue}
            onChange={(e) => onChange({ ...config, primary_hue: parseInt(e.target.value) })}
            className="flex-1 h-2 rounded-full appearance-none cursor-pointer"
            style={{ background: `linear-gradient(to right, hsl(0,95%,53%), hsl(30,95%,53%), hsl(60,95%,53%), hsl(120,95%,53%), hsl(180,95%,53%), hsl(240,95%,53%), hsl(300,95%,53%), hsl(360,95%,53%))` }} />
          <span className="text-xs font-mono tabular-nums text-muted-foreground w-10 text-right">{currentHue}°</span>
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">预览</p>
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg shrink-0" style={{ background: `hsl(${currentHue}, 95%, 53%)` }} />
            <div>
              <p className="text-sm font-medium" style={{ color: `hsl(${currentHue}, 95%, 40%)` }}>主色调 {currentHue}°</p>
              <p className="text-xs text-muted-foreground">按钮、链接、图标等元素将使用此颜色</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button style={{ background: `hsl(${currentHue}, 95%, 53%)`, color: currentHue > 60 && currentHue < 200 ? '#000' : '#fff' }}
              className="px-4 py-1.5 rounded-lg text-xs font-medium">主要按钮</button>
            <button style={{ borderColor: `hsl(${currentHue}, 95%, 53%)`, color: `hsl(${currentHue}, 95%, 53%)` }}
              className="px-4 py-1.5 rounded-lg text-xs font-medium border">次要按钮</button>
          </div>
        </div>
      </div>
    </section>
  );
}
