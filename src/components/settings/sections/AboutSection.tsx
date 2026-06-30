import { Bot } from "lucide-react";
import type { AIConfig } from "../../../lib/types";

interface AboutSectionProps {
  config: AIConfig;
  onChange: (config: AIConfig) => void;
}

export function AboutSection({ config: _config, onChange: _onChange }: AboutSectionProps) {
  return (
    <section>
      <h2 className="text-base font-semibold mb-4">关于</h2>
      <div className="bg-card border border-border rounded-lg p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center shrink-0"><Bot size={22} className="text-primary" /></div>
          <div><p className="text-sm font-semibold">CebianDesktop</p><p className="text-xs text-muted-foreground">版本 0.1.0</p></div>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">CebianDesktop 是 CeBian 浏览器扩展的桌面伴侣应用。</p>

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
