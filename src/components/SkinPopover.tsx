import { useState, useRef, useEffect } from "react";
import { Palette } from "lucide-react";
import type { AIConfig } from "../lib/types";

const PRESET_COLORS = [
  { hue: 0,   label: "红",    class: "bg-[hsl(0,88%,60%)]" },
  { hue: 20,  label: "橙",    class: "bg-[hsl(20,95%,55%)]" },
  { hue: 40,  label: "金",    class: "bg-[hsl(40,90%,55%)]" },
  { hue: 60,  label: "柠",    class: "bg-[hsl(60,85%,50%)]" },
  { hue: 120, label: "翠",    class: "bg-[hsl(120,60%,50%)]" },
  { hue: 160, label: "绿",    class: "bg-[hsl(160,64%,52%)]" },
  { hue: 190, label: "青",    class: "bg-[hsl(190,70%,50%)]" },
  { hue: 210, label: "蓝",    class: "bg-[hsl(210,95%,53%)]" },
  { hue: 250, label: "靛",    class: "bg-[hsl(250,80%,60%)]" },
  { hue: 280, label: "紫",    class: "bg-[hsl(280,70%,60%)]" },
  { hue: 320, label: "粉",    class: "bg-[hsl(320,80%,60%)]" },
  { hue: 350, label: "玫",    class: "bg-[hsl(350,85%,60%)]" },
];

export function SkinPopover({ config, onChange }: { config: AIConfig; onChange: (c: AIConfig) => void }) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const currentHue = config.primary_hue ?? 24;

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  return (
    <div ref={popoverRef} className="relative">
      <button onClick={() => setOpen(!open)}
        className={`p-1.5 rounded-md transition-colors ${open ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
        title="主题色">
        <Palette size={16} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-popover border border-border rounded-xl shadow-xl p-4 space-y-4"
          style={{ maxHeight: "80vh", overflowY: "auto" }}>
          {/* 预设色：3行4列，大色块 */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">预设主题色</p>
            <div className="grid grid-cols-4 gap-3">
              {PRESET_COLORS.map(({ hue, label, class: bgClass }) => (
                <button key={hue} onClick={() => onChange({ ...config, primary_hue: hue })}
                  className="flex flex-col items-center gap-1 group" title={label}>
                  <div className={`w-9 h-9 rounded-full border-[3px] transition-all ${currentHue === hue ? 'border-foreground scale-110 shadow-md' : 'border-transparent group-hover:border-muted-foreground/40'} ${bgClass}`} />
                  <span className="text-[0.6rem] text-muted-foreground">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 色相滑条 */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">自定义色相</p>
            <div className="flex items-center gap-3">
              <input type="range" min="0" max="360" value={currentHue}
                onChange={(e) => onChange({ ...config, primary_hue: parseInt(e.target.value) })}
                className="flex-1 h-2 rounded-full appearance-none cursor-pointer"
                style={{ background: `linear-gradient(to right, hsl(0,95%,53%), hsl(30,95%,53%), hsl(60,95%,53%), hsl(120,95%,53%), hsl(180,95%,53%), hsl(240,95%,53%), hsl(300,95%,53%), hsl(360,95%,53%))` }} />
              <span className="text-xs font-mono tabular-nums text-muted-foreground w-9 text-right">{currentHue}°</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
