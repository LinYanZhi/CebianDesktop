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
        <p className="text-sm text-muted-foreground leading-relaxed">
          CebianDesktop 是 CeBian 浏览器扩展的桌面伴侣应用，采用 <strong className="text-foreground/80">Rust + Tauri</strong> 原生开发，追求极致的运行效率与最小的资源占用。
        </p>
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div className="bg-background/50 rounded-lg p-2.5 space-y-0.5">
            <span className="font-medium text-foreground/70 block">⚡ 极致性能</span>
            <span>纯 Rust 编译，毫秒级工具调度</span>
          </div>
          <div className="bg-background/50 rounded-lg p-2.5 space-y-0.5">
            <span className="font-medium text-foreground/70 block">📦 轻量紧凑</span>
            <span>安装包极小，内存占用低</span>
          </div>
          <div className="bg-background/50 rounded-lg p-2.5 space-y-0.5">
            <span className="font-medium text-foreground/70 block">🛠️ 功能全面</span>
            <span>文件/Excel/系统/网络 30+ 工具</span>
          </div>
          <div className="bg-background/50 rounded-lg p-2.5 space-y-0.5">
            <span className="font-medium text-foreground/70 block">🔌 双 AI 桥接</span>
            <span>桌面 AI ↔ 浏览器 AI 协同</span>
          </div>
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
