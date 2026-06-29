import { useState, useRef, useEffect } from "react";
import { FileText, Plus, Download, Upload, FolderOpen, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { listWorkspaceFiles,
  writeWorkspaceFile,
  deleteWorkspaceFile,
  generateWorkspaceId,
  exportWorkspaceFileContent,
  importWorkspaceFileContent,
  openWorkspaceDir,
} from "../../../lib/workspace";
import { save, open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceFile } from "../../../lib/workspace";
import { ContextMenu } from "../ContextMenu";

export function PromptsSection() {
  const [prompts, setPrompts] = useState<WorkspaceFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorkspaceFile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; fileId?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const list = await listWorkspaceFiles("prompts");
    setPrompts(list);
  };
  useEffect(() => { load(); }, []);

  const selectFile = (id: string) => {
    setSelectedId(id);
    const file = prompts.find(p => p.id === id);
    if (file) setEditing({ ...file });
    setDirty(false);
  };

  const handleNew = async () => {
    if (dirty) { toast.warning("请先保存当前编辑"); return; }
    const id = await generateWorkspaceId();
    await writeWorkspaceFile("prompts", id, "新提示词", "", "");
    await load();
    setSelectedId(id);
    const file = prompts.find(p => p.id === id);
    if (file) setEditing({ ...file });
    setDirty(false);
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { toast.error("请输入提示词名称"); return; }
    setLoading(true);
    try {
      await writeWorkspaceFile("prompts", editing.id, editing.name, editing.description, editing.content);
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
      await deleteWorkspaceFile("prompts", id);
      toast.success("已删除");
      if (selectedId === id) { setSelectedId(null); setEditing(null); setDirty(false); }
      await load();
    } catch (e: any) {
      toast.error("删除失败: " + (e?.toString() || "未知错误"));
    }
  };

  const handleRename = async (id: string, newName: string) => {
    if (!newName.trim()) return;
    const file = prompts.find(p => p.id === id);
    if (!file) return;
    await writeWorkspaceFile("prompts", id, newName.trim(), file.description, file.content);
    await load();
    if (editing?.id === id) setEditing({ ...editing, name: newName.trim() });
    setDirty(true);
  };

  const handleExportFile = async (id: string) => {
    try {
      const raw = await exportWorkspaceFileContent("prompts", id);
      const file = prompts.find(p => p.id === id);
      const filename = file?.filename || `${id}.md`;
      const filePath = await save({
        defaultPath: filename,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!filePath) return;
      await invoke("write_file_to_path", { path: filePath, content: raw });
      toast.success("导出成功");
    } catch (e: any) {
      toast.error("导出失败: " + (e?.toString() || "未知错误"));
    }
  };

  const handleExportAll = async () => {
    const dir = await open({ directory: true, multiple: false, title: "选择导出目录" });
    if (!dir) return;
    for (const p of prompts) {
      try {
        const raw = await exportWorkspaceFileContent("prompts", p.id);
        const filename = p.filename || `${p.id}.md`;
        await invoke("write_file_to_path", { path: `${dir}/${filename}`, content: raw });
      } catch (e: any) {
        toast.error(`导出 ${p.filename} 失败: ${e?.toString()}`);
      }
    }
    toast.success("全部导出成功");
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await importWorkspaceFileContent("prompts", text);
      toast.success("导入成功");
      await load();
    } catch (e: any) {
      toast.error("导入失败: " + (e?.toString() || "未知错误"));
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <section className="flex flex-col flex-1 min-h-0">
      <h2 className="text-base font-semibold mb-4">提示词</h2>
      <p className="text-sm text-muted-foreground mb-4">
        在输入框中输入 <code className="text-primary text-xs bg-primary/10 px-1 rounded">/</code> 可快速唤出提示词列表。
        模板变量：<code className="text-xs bg-muted px-1 rounded">{`{{date}}`}</code> <code className="text-xs bg-muted px-1 rounded">{`{{time}}`}</code> <code className="text-xs bg-muted px-1 rounded">{`{{clipboard}}`}</code>
      </p>

      <div className="flex items-center gap-2 mb-4">
        <button onClick={handleNew}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-input text-xs text-muted-foreground hover:text-foreground hover:border-ring transition-colors">
          <Plus size={13} /> 新建
        </button>
        <div className="w-px h-4 bg-border" />
        <button onClick={handleExportAll} disabled={prompts.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-input text-xs text-muted-foreground hover:text-foreground hover:border-ring transition-colors disabled:opacity-30">
          <Download size={13} /> 导出全部
        </button>
        <button onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-input text-xs text-muted-foreground hover:text-foreground hover:border-ring transition-colors">
          <Upload size={13} /> 导入
        </button>
        <input ref={fileInputRef} type="file" accept=".md" onChange={handleImport} className="hidden" />
        <div className="flex-1" />
        <button onClick={() => openWorkspaceDir("skills")}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-input text-xs text-muted-foreground hover:text-foreground hover:border-ring transition-colors"
          title="在文件管理器中打开">
          <FolderOpen size={13} /> 打开位置
        </button>
      </div>

      <div className="flex gap-0 flex-1 min-h-0 border border-border rounded-lg overflow-hidden">
        <div className="w-52 shrink-0 border-r border-border bg-card flex flex-col">
          <div className="flex items-center gap-1 px-3 py-2 border-b border-border">
            <FileText size={12} className="text-muted-foreground" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">prompts/</span>
            <span className="text-[10px] text-muted-foreground/60">({prompts.length})</span>
          </div>
          <div className="flex-1 overflow-y-auto p-1 space-y-0.5"
            onContextMenu={(e) => {
              e.preventDefault();
              setCtxMenu({ x: e.clientX, y: e.clientY });
            }}>
            {prompts.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-8">空目录</p>
            ) : (
              prompts.map(p => (
                <div key={p.id}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCtxMenu({ x: e.clientX, y: e.clientY, fileId: p.id });
                  }}>
                  <button onClick={() => selectFile(p.id)}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors text-left ${
                      selectedId === p.id
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    }`}
                    title={p.filename}>
                    <FileText size={12} className="shrink-0 opacity-60" />
                    <span className="truncate">{p.name || p.id}</span>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {!editing ? (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground bg-background">
            <div className="text-center">
              <FileText size={32} className="mx-auto mb-2 opacity-20" />
              <p>选择或新建一个提示词文件</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col bg-background min-w-0">
            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-muted/30 shrink-0">
              <FileText size={12} className="text-primary shrink-0" />
              {renaming === editing.id ? (
                <input type="text" value={renameValue}
                  autoFocus
                  onBlur={() => setRenaming(null)}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter") { await handleRename(editing.id, renameValue); setRenaming(null); }
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="flex-1 text-xs bg-background border border-input rounded px-1.5 py-0.5 outline-none focus:border-ring" />
              ) : (
                <span className="text-xs font-medium text-foreground truncate">{editing.filename}</span>
              )}
              <span className="text-[10px] text-muted-foreground/60 ml-auto shrink-0">
                {editing.name ? `${editing.name} — ` : ""}{editing.description || "无描述"}
              </span>
            </div>

            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex items-center gap-2 px-4 pt-3 pb-1">
                <input type="text" value={editing.name}
                  onChange={(e) => { setEditing({ ...editing, name: e.target.value }); setDirty(true); }}
                  placeholder="name: 提示词名称"
                  className="flex-1 text-xs bg-muted/50 border border-border/50 rounded px-2 py-1 font-mono outline-none focus:border-ring/50 placeholder:text-muted-foreground/30" />
                <input type="text" value={editing.description}
                  onChange={(e) => { setEditing({ ...editing, description: e.target.value }); setDirty(true); }}
                  placeholder="description: 简短描述"
                  className="flex-1 text-xs bg-muted/50 border border-border/50 rounded px-2 py-1 font-mono outline-none focus:border-ring/50 placeholder:text-muted-foreground/30" />
              </div>
              <div className="px-4 pb-1">
                <div className="text-[10px] text-muted-foreground/40 font-mono border-b border-border/30 pb-1">--- frontmatter end ---</div>
              </div>
              <div className="flex-1 min-h-0 px-4 pb-3">
                <textarea value={editing.content}
                  onChange={(e) => { setEditing({ ...editing, content: e.target.value }); setDirty(true); }}
                  className="w-full h-full bg-background border border-border/20 rounded p-2 text-xs font-mono outline-none focus:border-ring/50 transition-colors resize-none"
                  placeholder="在此编写提示词内容..." />
              </div>
              <div className="flex items-center gap-2 px-4 py-1.5 border-t border-border bg-muted/20 shrink-0">
                <button onClick={handleSave} disabled={loading || !dirty}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-[10px] font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors">
                  {loading ? "保存中..." : "保存"}
                </button>
                <div className="flex-1" />
                {dirty && <span className="text-[10px] text-amber-500">● 未保存</span>}
                <span className="text-[9px] text-muted-foreground/40">{(editing.content.match(/\n/g) || []).length + 1} 行</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {ctxMenu && (
        <ContextMenu x={ctxMenu.x} y={ctxMenu.y}
          items={
            ctxMenu.fileId
              ? [
                  { label: "重命名", icon: <FileText size={12} />, onClick: () => {
                    const f = prompts.find(p => p.id === ctxMenu.fileId);
                    if (f) { setRenaming(f.id); setRenameValue(f.name || f.id); }
                  }},
                  { label: "导出文件", icon: <Download size={12} />, onClick: () => handleExportFile(ctxMenu.fileId!) },
                  { label: "删除文件", icon: <Trash2 size={12} />, danger: true, onClick: () => handleDelete(ctxMenu.fileId!) },
                ]
              : [
                  { label: "新建提示词文件", icon: <Plus size={12} />, onClick: handleNew },
                  { label: "导入文件", icon: <Upload size={12} />, onClick: () => fileInputRef.current?.click() },
                ]
          }
          onClose={() => setCtxMenu(null)} />
      )}
    </section>
  );
}
