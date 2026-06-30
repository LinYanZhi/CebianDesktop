import { Bot, Plus, Trash2, Wifi } from "lucide-react";
import type { AIConfig } from "../../../lib/types";

interface AboutSectionProps {
  config: AIConfig;
  onChange: (config: AIConfig) => void;
}

export function AboutSection({ config, onChange }: AboutSectionProps) {
  const ports = config.bridgePorts ?? [{ name: "默认浏览器", port: 37421 }];

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

  return (
    <section>
      <h2 className="text-base font-semibold mb-4">关于</h2>
      <div className="bg-card border border-border rounded-lg p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center shrink-0"><Bot size={22} className="text-primary" /></div>
          <div><p className="text-sm font-semibold">CebianDesktop</p><p className="text-xs text-muted-foreground">版本 0.1.0</p></div>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">CebianDesktop 是 CeBian 浏览器扩展的桌面伴侣应用。</p>

        {/* 桥接端口配置 */}
        <div className="border-t border-border" />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wifi size={14} className="text-muted-foreground" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">双 AI 桥接</p>
            </div>
            <button
              onClick={addPort}
              className="flex items-center gap-1 px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded-md transition-colors"
            >
              <Plus size={12} />
              添加端口
            </button>
          </div>

          <div className="space-y-2">
            {ports.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="浏览器名称"
                  value={p.name}
                  onChange={(e) => updatePort(i, "name", e.target.value)}
                  className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-background border border-border rounded-md outline-none focus:border-ring placeholder:text-muted-foreground/50"
                />
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={p.port}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 1024 && v <= 65535) {
                      updatePort(i, "port", v);
                    }
                  }}
                  className="w-20 px-2 py-1.5 text-xs bg-background border border-border rounded-md outline-none focus:border-ring text-center"
                />
                <button
                  onClick={() => removePort(i)}
                  className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                  title="移除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <p className="text-[0.65rem] text-muted-foreground">修改后需重启应用生效。每个端口对应一个浏览器连接。</p>
        </div>

        <div className="border-t border-border" />
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">作者</p>
          <div className="inline-flex items-center gap-2.5 text-sm">
            <a href="https://github.com/LinYanZhi" target="_blank" rel="noopener noreferrer">
              <img src="https://github.com/LinYanZhi.png" alt="LinYanZhi" className="w-8 h-8 rounded-full ring-2 ring-border" /></a>
            <div>
              <a href="https://github.com/LinYanZhi" target="_blank" rel="noopener noreferrer" className="block font-medium text-primary hover:underline">LinYanZhi</a>
              <a href="https://github.com/LinYanZhi/CebianDesktop" target="_blank" rel="noopener noreferrer" className="block text-xs text-muted-foreground hover:underline">github.com/LinYanZhi/CebianDesktop</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
