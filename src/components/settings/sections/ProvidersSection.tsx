import { useState } from "react";
import { Eye, EyeOff, Save, Unplug } from "lucide-react";
import { toast } from "sonner";
import type { AIConfig, ProviderInfo } from "../../../lib/types";

export function ProvidersSection({ config, onChange }: { config: AIConfig; onChange: (c: AIConfig) => void }) {
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const updateProvider = (id: string, patch: Partial<ProviderInfo>) => {
    onChange({
      ...config,
      providers: config.providers.map(p => p.id === id ? { ...p, ...patch } : p),
    });
  };

  const handleSave = async (provider: ProviderInfo) => {
    const trimmedKey = provider.api_key.trim();
    if (!trimmedKey) return;
    if (saving[provider.id]) return;

    setSaving(s => ({ ...s, [provider.id]: true }));

    try {
      const verifyModel = provider.selectedModel || provider.models[0];
      const endpoint = provider.endpoint.trim().replace(/\/$/, "");

      const resp = await fetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${trimmedKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: verifyModel,
          messages: [{ role: "user", content: "Reply only: ok" }],
          max_tokens: 50,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}${body ? ` - ${body.slice(0, 200)}` : ""}`);
      }

      onChange({
        ...config,
        providers: config.providers.map(p =>
          p.id === provider.id
            ? { ...p, api_key: trimmedKey, connected: true }
            : p
        ),
        activeProviderId: provider.id,
      });
      toast.success(`${provider.name} 连接成功`);
    } catch (err: any) {
      const reason = err instanceof Error ? err.message : "未知错误";
      console.error(`[Verify] ${provider.name}:`, reason);
      onChange({
        ...config,
        providers: config.providers.map(p =>
          p.id === provider.id
            ? { ...p, api_key: trimmedKey, connected: false }
            : p
        ),
      });
      toast.warning(`${provider.name} 验证失败，已保存密钥`, {
        description: reason,
      });
    } finally {
      setSaving(s => ({ ...s, [provider.id]: false }));
    }
  };

  const handleDisconnect = (provider: ProviderInfo) => {
    updateProvider(provider.id, { connected: false });
  };

  const statusBadge = (provider: ProviderInfo) => {
    if (saving[provider.id]) {
      return <span className="text-[0.65rem] px-1.5 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-500">验证中...</span>;
    }
    if (provider.connected) {
      return <span className="text-[0.65rem] px-1.5 py-0.5 rounded border border-green-500/30 bg-green-500/10 text-green-500">已连接</span>;
    }
    if (provider.api_key.trim()) {
      return <span className="text-[0.65rem] px-1.5 py-0.5 rounded border border-yellow-500/30 bg-yellow-500/10 text-yellow-500">未验证</span>;
    }
    return <span className="text-[0.65rem] px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground">未配置</span>;
  };

  return (
    <section>
      <h2 className="text-base font-semibold mb-4">AI 提供商</h2>
      <div className="space-y-5">
        {config.providers.map((provider) => (
          <div key={provider.id}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium">{provider.name}</span>
              {statusBadge(provider)}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input type={showKeys[provider.id] ? "text" : "password"}
                  value={provider.api_key}
                  onChange={(e) => updateProvider(provider.id, { api_key: e.target.value })}
                  placeholder="API Key"
                  className="w-full bg-background border border-input rounded-lg px-3 py-1.5 text-sm outline-none focus:border-ring transition-colors pr-8 font-mono" />
                <button onClick={() => setShowKeys(s => ({ ...s, [provider.id]: !s[provider.id] }))}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-0.5">
                  {showKeys[provider.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <button onClick={() => handleSave(provider)}
                disabled={saving[provider.id] || !provider.api_key.trim()}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="保存并连接">
                {saving[provider.id]
                  ? <span className="inline-block w-3.5 h-3.5 border-2 border-muted-foreground/30 border-t-primary rounded-full animate-spin" />
                  : <Save size={14} />}
              </button>
              <button onClick={() => handleDisconnect(provider)}
                disabled={!provider.connected}
                className="p-1.5 rounded-md text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="断开连接">
                <Unplug size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
