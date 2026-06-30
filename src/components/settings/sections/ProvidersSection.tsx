import { useState } from "react";
import { Eye, EyeOff, Save, Unplug, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { save, open } from "@tauri-apps/plugin-dialog";
import { exportProvidersConfig, importProvidersConfig } from "../../../lib/commands";
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

  const handleExport = async () => {
    try {
      const filePath = await save({
        filters: [{ name: "JSON", extensions: ["json"] }],
        defaultPath: "cebiandesktop-providers.json",
        title: "导出 AI 提供商配置",
      });
      if (!filePath) return;
      await exportProvidersConfig(filePath, config);
      toast.success("提供商配置已导出");
    } catch (err: any) {
      toast.error("导出失败", { description: err.message || String(err) });
    }
  };

  const handleImport = async () => {
    try {
      const filePath = await open({
        filters: [{ name: "JSON", extensions: ["json"] }],
        multiple: false,
        title: "导入 AI 提供商配置",
      });
      if (!filePath) return;
      const imported = await importProvidersConfig(filePath as string);
      if (!Array.isArray(imported) || imported.length === 0) {
        toast.error("导入失败：文件中没有有效的提供商配置");
        return;
      }
      onChange({
        ...config,
        providers: imported.map((p: any) => ({
          id: p.id || "",
          name: p.name || p.id || "",
          api_key: p.api_key || "",
          endpoint: p.endpoint || "",
          models: p.models || [],
          selectedModel: p.selected_model || p.selectedModel || "",
          connected: false,
        })),
      });
      toast.success(`已导入 ${imported.length} 个提供商配置`);
    } catch (err: any) {
      toast.error("导入失败", { description: err.message || String(err) });
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold">AI 提供商</h2>
        <div className="flex items-center gap-1">
          <button onClick={handleImport}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="导入配置">
            <Upload size={14} />导入
          </button>
          <button onClick={handleExport}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="导出配置">
            <Download size={14} />导出
          </button>
        </div>
      </div>
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
