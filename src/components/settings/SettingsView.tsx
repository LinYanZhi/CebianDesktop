import { useState, useRef, useEffect } from "react";
import {
  ArrowLeft, Bot, Key, MessageSquare, FileText, Puzzle, Plug,
  DatabaseBackup, HardDrive, Sliders, Info, Eye, EyeOff, Save, Unplug, Plus, Trash2, Download, Upload, Globe, Check
} from "lucide-react";
import { toast } from "sonner";
import type { AIConfig, ProviderInfo } from "../../lib/types";
import { listPrompts, savePrompt, deletePrompt, createPromptTemplate } from "../../lib/prompts";
import type { Prompt } from "../../lib/prompts";
import { loadMcpConfig, saveMcpConfig, connectMcpServer, disconnectMcpServer } from "../../lib/mcp";
import type { McpServerConfig } from "../../lib/mcp";
import {
  listWorkspaceFiles,
  writeWorkspaceFile,
  deleteWorkspaceFile,
  generateWorkspaceId,
  exportBackup,
  importBackup,
  exportWorkspaceFileContent,
  importWorkspaceFileContent,
} from "../../lib/workspace";
import type { WorkspaceFile } from "../../lib/workspace";
import { useI18n } from "../../lib/i18n";

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
  { id: "appearance", label: "外观", icon: Bot },
  { id: "instructions", label: "指引", icon: MessageSquare },
  { id: "prompts", label: "提示词", icon: FileText },
  { id: "skills", label: "技能", icon: Puzzle },
  { id: "mcp", label: "MCP 服务", icon: Plug },
  { id: "backup", label: "备份与恢复", icon: DatabaseBackup },
  { id: "storage", label: "文件系统", icon: HardDrive },
  { id: "advanced", label: "高级", icon: Sliders },
  { id: "language", label: "语言", icon: Globe },
  { id: "about", label: "关于", icon: Info },
];

// ─── 各 Section 组件 ───────────────────────────────────

function ProvidersSection({ config, onChange }: { config: AIConfig; onChange: (c: AIConfig) => void }) {
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
      // 发送一条测试消息验证 API Key
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

      // HTTP 200 即验证通过，不需要检查回复内容

      // 验证通过
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
      // 验证失败，但仍保存 key（下次可重试）
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
            {/* 提供商名称 + 状态标签 */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium">{provider.name}</span>
              {statusBadge(provider)}
            </div>

            {/* API Key 输入 + 保存 + 断开 */}
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

function InstructionsSection({ config, onChange }: { config: AIConfig; onChange: (c: AIConfig) => void }) {
  return (
    <section>
      <h2 className="text-base font-semibold mb-4">系统提示词</h2>
      <p className="text-sm text-muted-foreground mb-4">自定义 AI 助手的行为和角色定位。此内容会作为系统消息发送给 AI。</p>
      <textarea value={config.system_prompt || ''}
        onChange={(e) => onChange({ ...config, system_prompt: e.target.value })}
        className="w-full h-48 bg-background border border-input rounded-lg p-3 text-sm outline-none focus:border-ring transition-colors resize-none font-mono"
        placeholder="输入系统提示词，决定 AI 助手的角色和行为..." />
    </section>
  );
}

function PromptsSection() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Prompt | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);

  // 加载提示词列表
  const load = async () => {
    const list = await listPrompts();
    setPrompts(list);
  };
  useEffect(() => { load(); }, []);

  // 选中一个 prompt
  const selectPrompt = async (id: string) => {
    if (dirty) {
      toast.warning("请先保存当前编辑的提示词");
      return;
    }
    setSelectedId(id);
    const p = prompts.find(p => p.id === id);
    setEditing(p ? { ...p } : null);
    setDirty(false);
  };

  // 新建
  const handleNew = async () => {
    if (dirty) {
      toast.warning("请先保存当前编辑的提示词");
      return;
    }
    const blank = await createPromptTemplate();
    setEditing(blank);
    setSelectedId(blank.id);
    setDirty(true);
  };

  // 保存
  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name.trim()) {
      toast.error("请输入提示词名称");
      return;
    }
    if (!editing.content.trim()) {
      toast.error("请输入提示词内容");
      return;
    }
    setLoading(true);
    try {
      await savePrompt(editing);
      toast.success("保存成功");
      setDirty(false);
      await load();
      setSelectedId(editing.id);
    } catch (e: any) {
      toast.error("保存失败: " + (e?.toString() || "未知错误"));
    } finally {
      setLoading(false);
    }
  };

  // 删除
  const handleDelete = async () => {
    if (!editing) return;
    try {
      await deletePrompt(editing.id);
      toast.success("已删除");
      setSelectedId(null);
      setEditing(null);
      setDirty(false);
      await load();
    } catch (e: any) {
      toast.error("删除失败: " + (e?.toString() || "未知错误"));
    }
  };

  return (
    <section>
      <h2 className="text-base font-semibold mb-4">提示词</h2>
      <p className="text-sm text-muted-foreground mb-4">
        在输入框中输入 <code className="text-primary text-xs bg-primary/10 px-1 rounded">/</code> 可快速唤出提示词列表。
        模板变量：<code className="text-xs bg-muted px-1 rounded">{`{{date}}`}</code> <code className="text-xs bg-muted px-1 rounded">{`{{time}}`}</code> <code className="text-xs bg-muted px-1 rounded">{`{{clipboard}}`}</code>
      </p>

      <div className="flex gap-4 h-[400px]">
        {/* 左侧列表 */}
        <div className="w-56 shrink-0 flex flex-col gap-2">
          <button onClick={handleNew}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-input text-sm text-muted-foreground hover:text-foreground hover:border-ring transition-colors"
          >
            <Plus size={14} />
            新建提示词
          </button>
          <div className="flex-1 overflow-y-auto space-y-0.5 border border-border rounded-lg p-1">
            {prompts.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">暂无提示词</p>
            ) : (
              prompts.map(p => (
                <button key={p.id}
                  onClick={() => selectPrompt(p.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    selectedId === p.id
                      ? "bg-accent text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  }`}
                >
                  <div className="truncate">{p.name || "(未命名)"}</div>
                  {p.description && (
                    <div className="text-[10px] text-muted-foreground truncate mt-0.5">{p.description}</div>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* 右侧编辑区 */}
        <div className="flex-1 flex flex-col border border-border rounded-lg p-4 overflow-y-auto">
          {!editing ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              请选择或创建一个提示词
            </div>
          ) : (
            <div className="space-y-4">
              {/* 名称 */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">名称</label>
                <input type="text" value={editing.name}
                  onChange={(e) => { setEditing({ ...editing, name: e.target.value }); setDirty(true); }}
                  placeholder="如 translate-selection"
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm outline-none focus:border-ring"
                />
              </div>

              {/* 描述 */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">描述</label>
                <input type="text" value={editing.description}
                  onChange={(e) => { setEditing({ ...editing, description: e.target.value }); setDirty(true); }}
                  placeholder="简短描述这个提示词的用途"
                  className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm outline-none focus:border-ring"
                />
              </div>

              {/* 内容 */}
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">内容</label>
                <textarea value={editing.content}
                  onChange={(e) => { setEditing({ ...editing, content: e.target.value }); setDirty(true); }}
                  placeholder="输入提示词正文，支持 {{date}} {{time}} {{clipboard}} 等模板变量"
                  rows={10}
                  className="w-full bg-background border border-input rounded-lg p-3 text-sm outline-none focus:border-ring resize-none font-mono"
                />
              </div>

              {/* 操作按钮 */}
              <div className="flex items-center gap-3 pt-2">
                <button onClick={handleSave} disabled={loading || !dirty}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save size={14} />
                  {loading ? "保存中..." : "保存"}
                </button>
                <button onClick={handleDelete}
                  className="flex items-center gap-1.5 px-4 py-2 bg-destructive/10 text-destructive rounded-lg text-xs font-medium hover:bg-destructive/20 border border-destructive/30"
                >
                  <Trash2 size={14} />
                  删除
                </button>
                {dirty && (
                  <span className="text-xs text-amber-500 ml-2">有未保存的修改</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── 自定义右键菜单 ──────────────────────────────────
function ContextMenu({ x, y, items, onClose }: {
  x: number; y: number;
  items: { label: string; icon?: React.ReactNode; danger?: boolean; onClick: () => void }[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div ref={ref}
      className="fixed z-50 min-w-[140px] bg-popover border border-border rounded-lg shadow-xl py-1"
      style={{ left: x, top: y }}>
      {items.map((item, i) => (
        <button key={i} onClick={() => { item.onClick(); onClose(); }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${item.danger ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-accent"}`}>
          {item.icon && <span className="shrink-0">{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>
  );
}

function SkillsSection() {
  const [skills, setSkills] = useState<WorkspaceFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorkspaceFile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // 右键菜单
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; fileId?: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const list = await listWorkspaceFiles("skills");
    setSkills(list);
  };
  useEffect(() => { load(); }, []);

  // 选中文件时加载完整内容
  const selectFile = async (id: string) => {
    setSelectedId(id);
    const file = skills.find(s => s.id === id);
    if (file) setEditing({ ...file });
    setDirty(false);
  };

  const handleNew = async () => {
    if (dirty) { toast.warning("请先保存当前编辑"); return; }
    const id = await generateWorkspaceId();
    const blank: WorkspaceFile = {
      id, filename: `${id}.md`, name: "新技能", description: "", content: "",
      created_at: Date.now(), updated_at: Date.now(),
    };
    // 写入初始文件
    await writeWorkspaceFile("skills", id, "新技能", "", "");
    await load();
    setSelectedId(id);
    setEditing(blank);
    setDirty(false);
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { toast.error("请输入技能名称"); return; }
    setLoading(true);
    try {
      await writeWorkspaceFile("skills", editing.id, editing.name, editing.description, editing.content);
      toast.success("保存成功");
      setDirty(false);
      await load();
      setSelectedId(editing.id);
    } catch (e: any) {
      toast.error("保存失败: " + (e?.toString() || "未知错误"));
    } finally { setLoading(false); }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWorkspaceFile("skills", id);
      toast.success("已删除");
      if (selectedId === id) { setSelectedId(null); setEditing(null); setDirty(false); }
      await load();
    } catch (e: any) {
      toast.error("删除失败: " + (e?.toString() || "未知错误"));
    }
  };

  const handleRename = async (id: string, newName: string) => {
    if (!newName.trim()) return;
    const file = skills.find(s => s.id === id);
    if (!file) return;
    await writeWorkspaceFile("skills", id, newName.trim(), file.description, file.content);
    await load();
    if (editing?.id === id) {
      setEditing({ ...editing, name: newName.trim() });
    }
    setDirty(true);
  };

  // 导出单个文件
  const handleExportFile = async (id: string) => {
    try {
      const raw = await exportWorkspaceFileContent("skills", id);
      const file = skills.find(s => s.id === id);
      const filename = file?.filename || `${id}.md`;
      const blob = new Blob([raw], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("导出成功");
    } catch (e: any) {
      toast.error("导出失败: " + (e?.toString() || "未知错误"));
    }
  };

  // 导出全部（逐个下载为 zip 不便，批量导出为一个 zip 更合理——复用已有备份功能）
  const handleExportAll = async () => {
    try {
      // 利用已有的 exportBackup，但只为 skills 生成 zip
      // 简单方式：逐个下载
      for (const s of skills) {
        await handleExportFile(s.id);
      }
    } catch {}
  };

  // 导入文件
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await importWorkspaceFileContent("skills", text);
      toast.success("导入成功");
      await load();
    } catch (e: any) {
      toast.error("导入失败: " + (e?.toString() || "未知错误"));
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <section>
      <h2 className="text-base font-semibold mb-4">技能</h2>

      {/* 工具栏 */}
      <div className="flex items-center gap-2 mb-4">
        <button onClick={handleNew}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-input text-xs text-muted-foreground hover:text-foreground hover:border-ring transition-colors">
          <Plus size={13} /> 新建
        </button>
        <div className="w-px h-4 bg-border" />
        <button onClick={handleExportAll} disabled={skills.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-input text-xs text-muted-foreground hover:text-foreground hover:border-ring transition-colors disabled:opacity-30">
          <Download size={13} /> 导出全部
        </button>
        <button onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-input text-xs text-muted-foreground hover:text-foreground hover:border-ring transition-colors">
          <Upload size={13} /> 导入
        </button>
        <input ref={fileInputRef} type="file" accept=".md" onChange={handleImport} className="hidden" />
      </div>

      <div className="flex gap-0 h-[420px] border border-border rounded-lg overflow-hidden">
        {/* ── 左侧：文件列表 ── */}
        <div className="w-52 shrink-0 border-r border-border bg-card flex flex-col">
          <div className="flex items-center gap-1 px-3 py-2 border-b border-border">
            <FileText size={12} className="text-muted-foreground" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">skills/</span>
            <span className="text-[10px] text-muted-foreground/60">({skills.length})</span>
          </div>
          <div className="flex-1 overflow-y-auto p-1 space-y-0.5"
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu({ x: e.clientX, y: e.clientY });
            }}>
            {skills.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-8">空目录</p>
            ) : (
              skills.map(s => (
                <div key={s.id}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCtxMenu({ x: e.clientX, y: e.clientY, fileId: s.id });
                  }}>
                  <button onClick={() => selectFile(s.id)}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors text-left ${
                      selectedId === s.id
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    }`}
                    title={s.filename}>
                    <FileText size={12} className="shrink-0 opacity-60" />
                    <span className="truncate">{s.name || s.id}</span>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── 右侧：编辑器 ── */}
        {!editing ? (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground bg-background">
            <div className="text-center">
              <FileText size={32} className="mx-auto mb-2 opacity-20" />
              <p>选择或新建一个技能文件</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col bg-background min-w-0">
            {/* 文件名标签栏 */}
            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-muted/30 shrink-0">
              <FileText size={12} className="text-primary shrink-0" />
              {renaming === editing.id ? (
                <input type="text" value={renameValue}
                  autoFocus
                  onBlur={() => { setRenaming(null); }}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter") {
                      await handleRename(editing.id, renameValue);
                      setRenaming(null);
                    }
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="flex-1 text-xs bg-background border border-input rounded px-1.5 py-0.5 outline-none focus:border-ring" />
              ) : (
                <span className="text-xs font-medium text-foreground truncate">{editing.filename}</span>
              )}
              <span className="text-[10px] text-muted-foreground/60 ml-auto shrink-0">
                {editing.name ? `${editing.name} — ` : ""}{editing.description ? editing.description : "无描述"}
              </span>
            </div>

            {/* 编辑区域 */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Frontmatter 行（直接编辑的样子，用 inline 样式伪装成代码） */}
              <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                <input type="text" value={editing.name}
                  onChange={(e) => { setEditing({ ...editing, name: e.target.value }); setDirty(true); }}
                  placeholder="name: 技能名称"
                  className="flex-1 text-xs bg-muted/50 border border-border/50 rounded px-2 py-1 font-mono outline-none focus:border-ring/50 placeholder:text-muted-foreground/30" />
                <input type="text" value={editing.description}
                  onChange={(e) => { setEditing({ ...editing, description: e.target.value }); setDirty(true); }}
                  placeholder="description: 简短描述"
                  className="flex-1 text-xs bg-muted/50 border border-border/50 rounded px-2 py-1 font-mono outline-none focus:border-ring/50 placeholder:text-muted-foreground/30" />
              </div>
              <div className="px-4 pb-1">
                <div className="text-[10px] text-muted-foreground/40 font-mono border-b border-border/30 pb-1">--- frontmatter end ---</div>
              </div>

              {/* 编辑器主体 */}
              <div className="flex-1 min-h-0 px-4 pb-3">
                <textarea value={editing.content}
                  onChange={(e) => { setEditing({ ...editing, content: e.target.value }); setDirty(true); }}
                  placeholder="在此编写技能定义（Markdown 格式）..."
                  className="w-full h-full bg-muted/20 border border-border/30 rounded-lg p-3 text-xs font-mono leading-relaxed outline-none focus:border-ring/50 resize-none placeholder:text-muted-foreground/20" />
              </div>
            </div>

            {/* 状态栏 */}
            <div className="flex items-center gap-2 px-4 py-1.5 border-t border-border bg-muted/30 shrink-0">
              <div className="flex items-center gap-2">
                <button onClick={handleSave} disabled={loading || !dirty}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-[10px] font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors">
                  <Save size={11} /> {loading ? "保存中..." : "保存"}
                </button>
                <button onClick={async () => {
                  try { await handleExportFile(editing.id); } catch {}
                }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-input text-[10px] text-muted-foreground hover:text-foreground hover:border-ring transition-colors">
                  <Download size={11} /> 导出
                </button>
                <button onClick={() => {
                  if (window.confirm(`确认删除「${editing.name || editing.id}」？`)) {
                    handleDelete(editing.id);
                  }
                }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-destructive/30 text-[10px] text-destructive hover:bg-destructive/10 transition-colors">
                  <Trash2 size={11} /> 删除
                </button>
              </div>
              {dirty && <span className="text-[10px] text-amber-500 ml-auto">● 未保存</span>}
            </div>
          </div>
        )}
      </div>

      {/* ── 右键菜单 ── */}
      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y}
          items={
            ctxMenu.fileId
              ? [
                  { label: "重命名", icon: <FileText size={12} />, onClick: () => {
                    const f = skills.find(s => s.id === ctxMenu.fileId);
                    if (f) { setRenaming(f.id); setRenameValue(f.name || f.id); }
                  }},
                  { label: "导出文件", icon: <Download size={12} />, onClick: () => handleExportFile(ctxMenu.fileId!) },
                  { label: "删除文件", icon: <Trash2 size={12} />, danger: true, onClick: () => handleDelete(ctxMenu.fileId!) },
                ]
              : [
                  { label: "新建技能文件", icon: <Plus size={12} />, onClick: handleNew },
                  { label: "导入文件", icon: <Upload size={12} />, onClick: () => fileInputRef.current?.click() },
                ]
          }
          onClose={() => setCtxMenu(null)} />
      )}
    </section>
  );
}

function MCPSection({ port, running, onStart, onStop, onPortChange }: {
  port: number; running: boolean;
  onStart: () => void; onStop: () => void; onPortChange: (p: number) => void;
}) {
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [connectedServers, setConnectedServers] = useState<string[]>([]);
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null);
  const [loading, setLoading] = useState(false);

  // 加载配置
  useEffect(() => {
    loadMcpConfig().then(setMcpServers).catch(() => {});
    // 查询已连接的服务
    import("../../lib/mcp").then(m => m.listMcpConnections().then(setConnectedServers).catch(() => {}));
  }, []);

  const handleAddServer = () => {
    setEditingServer({ name: "", command: "", args: [], auto_start: false });
  };

  const handleSaveConfig = async () => {
    await saveMcpConfig(mcpServers);
    toast.success("MCP 配置已保存");
  };

  const handleConnect = async (s: McpServerConfig) => {
    setLoading(true);
    try {
      await connectMcpServer(s.name, s.command, s.args);
      setConnectedServers(prev => [...prev.filter(n => n !== s.name), s.name]);
      toast.success(`已连接 ${s.name}`);
    } catch (e: any) {
      toast.error("连接失败: " + (e?.toString() || "未知错误"));
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async (name: string) => {
    try {
      await disconnectMcpServer(name);
      setConnectedServers(prev => prev.filter(n => n !== name));
      toast.success(`已断开 ${name}`);
    } catch (e: any) {
      toast.error("断开失败: " + (e?.toString() || "未知错误"));
    }
  };

  const addServerToList = () => {
    if (!editingServer) return;
    if (!editingServer.name.trim() || !editingServer.command.trim()) return;
    setMcpServers(prev => {
      const filtered = prev.filter(s => s.name !== editingServer.name);
      return [...filtered, { ...editingServer }];
    });
    setEditingServer(null);
  };

  const removeServer = (name: string) => {
    handleDisconnect(name).catch(() => {});
    setMcpServers(prev => prev.filter(s => s.name !== name));
  };

  return (
    <section>
      <h2 className="text-base font-semibold mb-4">MCP</h2>

      {/* ── 内置 MCP 服务器（本应用对外提供工具） ── */}
      <h3 className="text-sm font-medium text-muted-foreground mb-3">内置 MCP 服务器</h3>
      <div className="bg-card border border-border rounded-lg p-4 space-y-4 mb-6">
        <div className="flex items-center gap-3">
          <label className="text-sm text-muted-foreground">端口:</label>
          <input type="number" value={port}
            onChange={(e) => onPortChange(parseInt(e.target.value) || 8080)}
            className="w-24 bg-background border border-input rounded-lg px-3 py-1.5 text-sm outline-none focus:border-ring" />
          <button onClick={running ? onStop : onStart}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${running ? 'bg-destructive/10 text-destructive hover:bg-destructive/20 border border-destructive/30' : 'bg-primary text-primary-foreground hover:bg-primary/90'}`}>
            {running ? '停止' : '启动'}
          </button>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className={`w-2 h-2 rounded-full ${running ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
          <span className="text-muted-foreground">{running ? `服务运行中 (端口 ${port})` : '服务未启动'}</span>
        </div>
      </div>

      {/* ── 外部 MCP 服务器客户端 ── */}
      <h3 className="text-sm font-medium text-muted-foreground mb-3">外部 MCP 服务器</h3>
      <div className="space-y-3">
        {mcpServers.map(s => {
          const isConnected = connectedServers.includes(s.name);
          return (
            <div key={s.name} className="bg-card border border-border rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.command} {s.args.join(" ")}</p>
                </div>
                <div className="flex items-center gap-2">
                  {isConnected ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <button onClick={() => handleDisconnect(s.name)} disabled={loading}
                        className="text-xs text-destructive hover:underline">断开</button>
                    </>
                  ) : (
                    <button onClick={() => handleConnect(s)} disabled={loading}
                      className="px-3 py-1 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90">连接</button>
                  )}
                  <button onClick={() => removeServer(s.name)}
                    className="text-xs text-muted-foreground hover:text-destructive">删除</button>
                </div>
              </div>
            </div>
          );
        })}

        {/* 添加新服务器表单 */}
        {editingServer ? (
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <input type="text" value={editingServer.name}
              onChange={(e) => setEditingServer({ ...editingServer, name: e.target.value })}
              placeholder="服务器名称（如 my-filesystem）"
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm outline-none focus:border-ring" />
            <input type="text" value={editingServer.command}
              onChange={(e) => setEditingServer({ ...editingServer, command: e.target.value })}
              placeholder="启动命令（如 npx）"
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm outline-none focus:border-ring" />
            <input type="text" value={editingServer.args.join(" ")}
              onChange={(e) => setEditingServer({ ...editingServer, args: e.target.value.split(/\s+/) })}
              placeholder="参数（用空格分隔，如 -y @modelcontextprotocol/server-filesystem C:\\path）"
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm outline-none focus:border-ring" />
            <div className="flex gap-2">
              <button onClick={addServerToList}
                disabled={!editingServer.name.trim() || !editingServer.command.trim()}
                className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50">添加</button>
              <button onClick={() => setEditingServer(null)}
                className="px-4 py-1.5 bg-background border border-input rounded-lg text-xs text-muted-foreground hover:border-ring">取消</button>
            </div>
          </div>
        ) : (
          <button onClick={handleAddServer}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-dashed border-input text-sm text-muted-foreground hover:text-foreground hover:border-ring transition-colors">
            <Plug size={14} />
            添加 MCP 服务器
          </button>
        )}

        {/* 保存配置 */}
        {mcpServers.length > 0 && (
          <button onClick={handleSaveConfig}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90">
            <Save size={14} />
            保存 MCP 配置
          </button>
        )}
      </div>
    </section>
  );
}

function BackupSection() {
  const [backingUp, setBackingUp] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setBackingUp(true);
    try {
      const base64 = await exportBackup();
      // 创建下载链接
      const byteChars = atob(base64);
      const bytes = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        bytes[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cebiandesktop-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("备份下载完成");
    } catch (e: any) {
      toast.error("导出失败: " + (e?.toString() || "未知错误"));
    } finally {
      setBackingUp(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const arrayBuf = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      await importBackup(base64);
      toast.success("备份恢复成功，请重启应用以生效");
    } catch (e: any) {
      toast.error("导入失败: " + (e?.toString() || "未知错误"));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <section>
      <h2 className="text-base font-semibold mb-4">备份与恢复</h2>
      <p className="text-sm text-muted-foreground mb-4">
        导出备份包含：工作区文件（提示词、技能）、对话记录、AI 配置、MCP 配置。
      </p>
      <div className="flex gap-3">
        <button onClick={handleExport} disabled={backingUp}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50">
          <Download size={14} />
          {backingUp ? "导出中..." : "导出备份"}
        </button>
        <button onClick={() => fileInputRef.current?.click()} disabled={importing}
          className="flex items-center gap-1.5 px-4 py-2 bg-background border border-input rounded-lg text-xs font-medium text-muted-foreground hover:border-ring disabled:opacity-50">
          <Upload size={14} />
          {importing ? "导入中..." : "导入恢复"}
        </button>
        <input ref={fileInputRef} type="file" accept=".zip" onChange={handleImport} className="hidden" />
      </div>
    </section>
  );
}

function StorageSection() {
  return (
    <section>
      <h2 className="text-base font-semibold mb-4">文件系统</h2>
      <p className="text-sm text-muted-foreground">对话数据存储于应用本地目录。</p>
    </section>
  );
}

function AdvancedSection() {
  return (
    <section>
      <h2 className="text-base font-semibold mb-4">高级设置</h2>
      <p className="text-sm text-muted-foreground">暂无高级设置项。</p>
    </section>
  );
}

// ─── 外观（主题色自定义） ───────────────────────────────

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

function AppearanceSection({ config, onChange }: { config: AIConfig; onChange: (c: AIConfig) => void }) {
  const currentHue = config.primary_hue ?? 24;

  return (
    <section>
      <h2 className="text-base font-semibold mb-4">外观</h2>

      {/* 预设颜色 */}
      <div className="mb-5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">预设主题色</p>
        <div className="flex flex-wrap gap-2.5">
          {PRESET_COLORS.map(({ hue, label, class: bgClass }) => (
            <button key={hue} onClick={() => onChange({ ...config, primary_hue: hue })}
              className="flex flex-col items-center gap-1.5 group"
              title={label}>
              <div className={`w-8 h-8 rounded-full border-2 transition-all ${currentHue === hue ? 'border-foreground scale-110' : 'border-transparent group-hover:border-muted-foreground/50'} ${bgClass}`} />
              <span className="text-[0.6rem] text-muted-foreground">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 色相滑块 */}
      <div className="mb-5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">自定义色相</p>
        <div className="flex items-center gap-3">
          <input type="range" min="0" max="360" value={currentHue}
            onChange={(e) => onChange({ ...config, primary_hue: parseInt(e.target.value) })}
            className="flex-1 h-2 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, 
                hsl(0,95%,53%), hsl(30,95%,53%), hsl(60,95%,53%), 
                hsl(120,95%,53%), hsl(180,95%,53%), hsl(240,95%,53%), 
                hsl(300,95%,53%), hsl(360,95%,53%))`,
            }} />
          <span className="text-xs font-mono tabular-nums text-muted-foreground w-10 text-right">{currentHue}°</span>
        </div>
      </div>

      {/* 实时预览 */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">预览</p>
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg shrink-0" style={{ background: `hsl(${currentHue}, 95%, 53%)` }} />
            <div>
              <p className="text-sm font-medium" style={{ color: `hsl(${currentHue}, 95%, 40%)` }}>
                主色调 {currentHue}°
              </p>
              <p className="text-xs text-muted-foreground">按钮、链接、图标等元素将使用此颜色</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button style={{ background: `hsl(${currentHue}, 95%, 53%)`, color: currentHue > 60 && currentHue < 200 ? '#000' : '#fff' }}
              className="px-4 py-1.5 rounded-lg text-xs font-medium">
              主要按钮
            </button>
            <button style={{ borderColor: `hsl(${currentHue}, 95%, 53%)`, color: `hsl(${currentHue}, 95%, 53%)` }}
              className="px-4 py-1.5 rounded-lg text-xs font-medium border">
              次要按钮
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function LanguageSection() {
  const { lang, setLang, t } = useI18n();

  const langs = [
    { id: "zh" as const, label: "中文" },
    { id: "en" as const, label: "English" },
  ];

  return (
    <section>
      <h2 className="text-base font-semibold mb-4">{t("language.title")}</h2>
      <p className="text-sm text-muted-foreground mb-4">{t("language.label")}</p>
      <div className="flex flex-col gap-2 max-w-xs">
        {langs.map((l) => (
          <button key={l.id} onClick={() => setLang(l.id)}
            className={`flex items-center justify-between px-4 py-3 rounded-lg border text-sm transition-colors ${
              lang === l.id
                ? "border-primary bg-primary/5 text-foreground"
                : "border-input text-muted-foreground hover:text-foreground hover:border-ring"
            }`}>
            <span>{l.label}</span>
            {lang === l.id && <Check size={16} className="text-primary" />}
          </button>
        ))}
      </div>
    </section>
  );
}

function AboutSection() {
  return (
    <section>
      <h2 className="text-base font-semibold mb-4">关于</h2>
      <div className="bg-card border border-border rounded-lg p-4 space-y-4">
        {/* 应用信息 */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
            <Bot size={22} className="text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">CebianDesktop</p>
            <p className="text-xs text-muted-foreground">版本 0.1.0</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          CebianDesktop 是 CeBian 浏览器扩展的桌面伴侣应用，提供原生的 AI 对话体验、文件操作、MCP 工具集成等能力。
        </p>

        {/* 分隔线 */}
        <div className="border-t border-border" />

        {/* 作者信息 */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">作者</p>
          <div className="inline-flex items-center gap-2.5 text-sm">
            <a href="https://github.com/LinYanZhi" target="_blank" rel="noopener noreferrer" className="shrink-0">
              <img src="https://github.com/LinYanZhi.png" alt="LinYanZhi"
                className="w-8 h-8 rounded-full ring-2 ring-border hover:ring-primary/50 transition-all" />
            </a>
            <div>
              <a href="https://github.com/LinYanZhi" target="_blank" rel="noopener noreferrer"
                className="block font-medium text-primary hover:underline">
                LinYanZhi
              </a>
              <a href="https://github.com/LinYanZhi/CebianDesktop" target="_blank" rel="noopener noreferrer"
                className="block text-xs text-muted-foreground hover:underline transition-colors">
                github.com/LinYanZhi/CebianDesktop
              </a>
            </div>
          </div>
        </div>

        {/* 技术栈 */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">当前项目技术栈</p>
          <div className="flex flex-wrap gap-1.5">
            {["Tauri v2", "React", "TypeScript", "Tailwind CSS", "Rust"].map((tech) => (
              <span key={tech}
                className="px-2 py-0.5 rounded-md bg-accent/50 border border-border text-[0.65rem] text-muted-foreground">
                {tech}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── 主组件 ────────────────────────────────────────────

export default function SettingsView(props: SettingsViewProps) {
  const [active, setActive] = useState("providers");
  const [navMode, setNavMode] = useState<"wide" | "medium" | "compact">("wide");
  const measureRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const fullWidthRef = useRef(0);

  // 1. 测量所有项（图标+文字）的实际总宽度（仅一次）
  useEffect(() => {
    if (measureRef.current) {
      fullWidthRef.current = measureRef.current.scrollWidth;
    }
  }, []);

  // 2. 响应式：用 ResizeObserver 监测 nav 容器，window 宽度决定竖向
  useEffect(() => {
    const fullWidth = fullWidthRef.current || 450;
    const check = (entry?: ResizeObserverEntry) => {
      const windowW = window.innerWidth;
      const availableW = entry?.contentBoxSize?.[0]?.inlineSize ?? navRef.current?.clientWidth ?? windowW;

      // 竖向：窗口宽度足够放侧栏（w-44=176px）+ 内容区（至少 fullWidth）
      const wideThreshold = fullWidth + 276;
      if (windowW >= wideThreshold) {
        setNavMode("wide");
        return;
      }
      // 横向：nav 容器宽度能否放下所有项（有 8px 滞后缓冲）
      if (availableW >= fullWidth - 8) {
        setNavMode("medium");
      } else {
        setNavMode("compact");
      }
    };

    // 立即执行一次
    check();

    // ResizeObserver 监测 nav 容器
    const ro = new ResizeObserver((entries) => {
      check(entries[0]);
    });
    if (navRef.current) ro.observe(navRef.current);

    // window resize 也触发（影响竖向判定）
    const onResize = () => { check(); };
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const renderSection = () => {
    switch (active) {
      case "providers": return <ProvidersSection config={props.config} onChange={props.onConfigChange} />;
      case "appearance": return <AppearanceSection config={props.config} onChange={props.onConfigChange} />;
      case "instructions": return <InstructionsSection config={props.config} onChange={props.onConfigChange} />;
      case "prompts": return <PromptsSection />;
      case "skills": return <SkillsSection />;
      case "mcp": return <MCPSection port={props.serverPort} running={props.serverRunning} onStart={props.onStartServer} onStop={props.onStopServer} onPortChange={props.onPortChange} />;
      case "backup": return <BackupSection />;
      case "storage": return <StorageSection />;
      case "advanced": return <AdvancedSection />;
      case "language": return <LanguageSection />;
      case "about": return <AboutSection />;
      default: return null;
    }
  };

  return (
    <div className="w-full h-full flex flex-col min-w-0">
      {/* 顶部栏 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <button onClick={props.onBack} className="p-1 rounded-md hover:bg-accent text-muted-foreground">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-sm font-semibold">设置</h1>
      </div>

      {/* 测量容器（始终渲染，用于预测量图标+文字宽度） */}
      <div ref={measureRef}
        className="flex gap-1 px-3 py-2 invisible absolute pointer-events-none overflow-hidden"
        aria-hidden="true">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap shrink-0">
              <Icon size={14} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* 竖向导航 */}
      {navMode === "wide" ? (
        <div className="flex-1 flex min-h-0 h-full">
          <nav className="w-44 border-r border-border bg-card p-2 flex flex-col gap-1 shrink-0 self-stretch overflow-y-auto">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.id} onClick={() => setActive(item.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${active === item.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"}`}>
                  <Icon size={16} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 min-w-0 flex flex-col">
            {renderSection()}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          {/* 横向导航 */}
          <nav ref={navRef}
            className="flex gap-1 px-3 py-2 border-b border-border bg-card shrink-0 overflow-x-auto scrollbar-hidden">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = active === item.id;
              return (
                <button key={item.id} onClick={() => setActive(item.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors shrink-0 ${
                    isActive ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50"
                  }`}
                  title={navMode === "compact" ? item.label : undefined}>
                  <Icon size={14} />
                  {/* medium: 显示文字 / compact: 仅图标 */}
                  {navMode === "medium" && <span>{item.label}</span>}
                </button>
              );
            })}
          </nav>
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 min-w-0">
            {renderSection()}
          </div>
        </div>
      )}
    </div>
  );
}
