import { useState, useRef, useEffect } from "react";
import {
  ArrowLeft, Bot, Key, MessageSquare, FileText, Puzzle, Plug,
  DatabaseBackup, HardDrive, Sliders, Info, Shield,
} from "lucide-react";
import type { AIConfig } from "../../lib/types";
import { ProvidersSection } from "./sections/ProvidersSection";
import { InstructionsSection } from "./sections/InstructionsSection";
import { PermissionSection } from "./sections/PermissionSection";
import { PromptsSection } from "./sections/PromptsSection";
import { SkillsSection } from "./sections/SkillsSection";
import { MCPSection } from "./sections/MCPSection";
import { BackupSection } from "./sections/BackupSection";
import { StorageSection } from "./sections/StorageSection";
import { AdvancedSection } from "./sections/AdvancedSection";
import { AboutSection } from "./sections/AboutSection";

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
  { id: "instructions", label: "指引", icon: MessageSquare },
  { id: "permission", label: "AI 权限", icon: Shield },
  { id: "prompts", label: "提示词", icon: FileText },
  { id: "skills", label: "技能", icon: Puzzle },
  { id: "mcp", label: "MCP 服务", icon: Plug },
  { id: "backup", label: "备份与恢复", icon: DatabaseBackup },
  { id: "storage", label: "文件系统", icon: HardDrive },
  { id: "advanced", label: "高级", icon: Sliders },
  { id: "about", label: "关于", icon: Info },
];

function renderSection(props: SettingsViewProps, active: string) {
  switch (active) {
    case "providers": return <ProvidersSection config={props.config} onChange={props.onConfigChange} />;
    case "instructions": return <InstructionsSection config={props.config} onChange={props.onConfigChange} />;
    case "permission": return <PermissionSection config={props.config} onChange={props.onConfigChange} />;
    case "prompts": return <PromptsSection />;
    case "skills": return <SkillsSection />;
    case "mcp": return (
      <MCPSection
        port={props.serverPort}
        running={props.serverRunning}
        onStart={props.onStartServer}
        onStop={props.onStopServer}
        onPortChange={props.onPortChange}
      />
    );
    case "backup": return <BackupSection />;
    case "storage": return <StorageSection />;
    case "advanced": return <AdvancedSection />;
    case "about": return <AboutSection />;
    default: return null;
  }
}

export default function SettingsView(props: SettingsViewProps) {
  const [active, setActive] = useState("providers");
  const [navMode, setNavMode] = useState<"wide" | "medium" | "compact">("wide");
  const measureRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const fullWidthRef = useRef(0);

  useEffect(() => {
    if (measureRef.current) fullWidthRef.current = measureRef.current.scrollWidth;
  }, []);

  // ⚠ 模式检测只用 window.innerWidth，不用 nav.clientWidth。
  //   因为 compact 模式下 nav 有 min-width: max-content，nav 自身宽度会被内容撑开，
  //   如果用 nav.clientWidth 检测会导致「nav 变宽→切 medium→文字变多→触发 resize→再切 compact」的死循环。
  useEffect(() => {
    const fullWidth = fullWidthRef.current || 450;
    const check = () => {
      const w = window.innerWidth;
      const wideThreshold = fullWidth + 276;
      if (w >= wideThreshold) { setNavMode("wide"); return; }
      if (w >= fullWidth) { setNavMode("medium"); } else { setNavMode("compact"); }
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return (
    <div className="w-full h-full flex flex-col min-w-0">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <button onClick={props.onBack} className="p-1 rounded-md hover:bg-accent text-muted-foreground">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-sm font-semibold">设置</h1>
      </div>

      {/* 隐形测量元素（图标+文字），用于计算 medium/compact 切换阈值 */}
      <div ref={measureRef} className="flex gap-1 px-3 py-2 invisible absolute pointer-events-none overflow-hidden" aria-hidden="true">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap shrink-0">
              <Icon size={14} /><span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {navMode === "wide" ? (
        <div className="flex-1 flex min-h-0">
          <nav className="w-44 border-r border-border bg-card px-3 py-2 flex flex-col gap-1 shrink-0 self-stretch overflow-y-auto">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} onClick={() => setActive(item.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs leading-none transition-colors ${active === item.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"}`}>
                  <Icon size={14} /><span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div className={`flex-1 overflow-y-auto min-w-0 flex flex-col min-h-0 ${active === 'skills' ? 'p-0' : 'p-6'}`}>
            <div className="settings-content flex-1 flex flex-col min-h-0">{renderSection(props, active)}</div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <nav ref={navRef} className="flex gap-1 px-3 py-2 border-b border-border bg-card shrink-0 scrollbar-hidden">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = active === item.id;
              return (
                <button key={item.id} onClick={() => setActive(item.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs leading-none whitespace-nowrap transition-colors shrink-0 ${isActive ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"}`}
                  title={navMode === "compact" ? item.label : undefined}>
                  <Icon size={14} />
                  {navMode === "medium" && <span>{item.label}</span>}
                </button>
              );
            })}
          </nav>
          <div className={`flex-1 overflow-y-auto min-w-0 flex flex-col min-h-0 ${active === 'skills' ? 'p-0' : 'p-4'}`}>
            <div className="settings-content flex-1 flex flex-col min-h-0">{renderSection(props, active)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
