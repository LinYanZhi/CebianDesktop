import { useState, useEffect, useRef } from "react";
import { Bot, ChevronDown, Settings, Search, Check } from "lucide-react";
import type { AIConfig, ThinkingLevel } from "../../lib/types";
import { getActiveConfig } from "../../lib/types";
import { THINKING_OPTIONS } from "./chat-types";

export function ModelSelector({
  aiConfig, onNavigate, onModelSelect
}: {
  aiConfig: AIConfig; onNavigate: () => void; onModelSelect: (providerId: string, model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const active = getActiveConfig(aiConfig);
  const connectedProviders = aiConfig.providers.filter(p => p.connected);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setSearch(""); } };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open]);

  const configured = active.api_key.trim() !== "" && active.endpoint.trim() !== "";

  // 收集所有模型
  const allModels = connectedProviders.flatMap(p =>
    p.models.map(m => ({ providerId: p.id, providerName: p.name, model: m }))
  );
  const filtered = search.trim()
    ? allModels.filter(m =>
        m.model.toLowerCase().includes(search.toLowerCase()) ||
        m.providerName.toLowerCase().includes(search.toLowerCase())
      )
    : allModels;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors ${
          configured ? "text-muted-foreground hover:text-foreground hover:bg-accent"
          : "text-destructive hover:text-destructive hover:bg-destructive/10"
        }`}
      >
        <span className="max-w-28 truncate">{configured ? active.model : "未配置"}</span>
        <ChevronDown size={12} className="shrink-0" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-64 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden">
          {/* 搜索框 */}
          <div className="p-2 border-b border-border">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/50 rounded-lg">
              <Search size={12} className="text-muted-foreground shrink-0" />
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索模型..."
                className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
              />
            </div>
          </div>

          {/* 模型列表 */}
          <div className="max-h-64 overflow-y-auto p-1">
            {connectedProviders.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                <Settings size={20} className="mx-auto mb-2 opacity-40" />
                <p>尚未连接任何 AI 提供商</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                <p>未找到匹配的模型</p>
              </div>
            ) : (
              <div>
                {connectedProviders.map(provider => {
                  const providerModels = filtered.filter(m => m.providerId === provider.id);
                  if (providerModels.length === 0) return null;
                  return (
                    <div key={provider.id}>
                      <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        {provider.name}
                      </div>
                      {providerModels.map(({ model }) => (
                        <button
                          key={model}
                          onClick={() => { onModelSelect(provider.id, model); setOpen(false); setSearch(""); }}
                          className={`w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors flex items-center gap-2 ${
                            model === connectedProviders.find(p => p.id === provider.id)?.selectedModel
                              ? "bg-accent text-foreground font-medium"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground"
                          }`}
                        >
                          <Bot size={12} className="shrink-0 opacity-50" />
                          <span className="truncate">{model}</span>
                          {model === connectedProviders.find(p => p.id === provider.id)?.selectedModel && (
                            <Check size={10} className="ml-auto shrink-0 text-primary" />
                          )}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 底部门票 */}
          <div className="border-t border-border p-1">
            <button
              onClick={() => { onNavigate(); setOpen(false); setSearch(""); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <Settings size={12} />
              <span>前往设置添加更多提供商</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  思考级别选择器（仿 Cebian：无图标，纯文字 + 下拉箭头）
// ═══════════════════════════════════════════════════════════

export function ThinkingLevelSelector({
  level, onSelect
}: {
  level: ThinkingLevel; onSelect: (v: ThinkingLevel) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = THINKING_OPTIONS.find(o => o.key === level);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[0.7rem] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        <span>思考：{current?.label ?? level}</span>
        <ChevronDown size={12} className="shrink-0" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-36 bg-popover border border-border rounded-xl shadow-xl z-50 overflow-hidden p-1">
          {THINKING_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { onSelect(key); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors ${
                level === key
                  ? "bg-accent/50 text-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <span className="flex-1 text-left">{label}</span>
              <Check size={12} className={`shrink-0 text-primary transition-opacity ${level === key ? "opacity-100" : "opacity-0"}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
