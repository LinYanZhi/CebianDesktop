import { useState, useRef, useEffect } from "react";
import {
  FileCode, Search, FilePlus, MoreHorizontal, Download, Upload, FolderOpen, Trash2, Plus, Save, Pencil, FileText,
} from "lucide-react";
import { toast } from "sonner";
import {
  listWorkspaceFiles,
  writeWorkspaceFile,
  deleteWorkspaceFile,
  generateWorkspaceId,
  exportWorkspaceFileContent,
  importWorkspaceFileContent,
  openWorkspaceDir,
} from "../../../lib/workspace";
import type { WorkspaceFile } from "../../../lib/workspace";
import { CodeMirrorEditor } from "../../editor/CodeMirrorEditor";
import { ContextMenu } from "../ContextMenu";

export function SkillsSection() {
  const [skills, setSkills] = useState<WorkspaceFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorkspaceFile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [search, setSearch] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; fileId?: string } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(240);
  const draggingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const list = await listWorkspaceFiles("skills");
    setSkills(list);
  };
  useEffect(() => { load(); }, []);

  const filtered = skills.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.id.toLowerCase().includes(search.toLowerCase())
  );

  const selectFile = (id: string) => {
    setSelectedId(id);
    const file = skills.find(s => s.id === id);
    if (file) setEditing({ ...file });
    setDirty(false);
  };

  const handleNew = async () => {
    if (dirty) { toast.warning("请先保存当前编辑"); return; }
    const id = await generateWorkspaceId();
    await writeWorkspaceFile("skills", id, "新技能", "", "");
    await load();
    setSelectedId(id);
    const file = skills.find(s => s.id === id);
    if (file) setEditing({ ...file });
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSave(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

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
    if (editing?.id === id) { setEditing({ ...editing, name: newName.trim() }); }
    setDirty(true);
  };

  const handleExportFile = async (id: string) => {
    try {
      const raw = await exportWorkspaceFileContent("skills", id);
      const file = skills.find(s => s.id === id);
      const filename = file?.filename || `${id}.md`;
      const blob = new Blob([raw], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      toast.success("导出成功");
    } catch (e: any) {
      toast.error("导出失败: " + (e?.toString() || "未知错误"));
    }
  };

  const handleExportAll = async () => {
    for (const s of skills) await handleExportFile(s.id);
  };

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

  // 拖拽分割条
  const handleMouseDown = () => {
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const settingsContent = document.querySelector('.settings-content');
    const containerLeft = settingsContent?.getBoundingClientRect().left ?? 0;
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      setLeftWidth(Math.max(160, Math.min(400, e.clientX - containerLeft)));
    };
    const onUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <section className="flex flex-col flex-1 min-h-0">
      <h2 className="text-base font-semibold mb-3 shrink-0">技能</h2>

      <div className="flex-1 flex min-h-0 bg-card border border-border rounded-lg overflow-hidden">
        {/* ── 左侧：搜索 + 文件树 ── */}
        <div className="flex flex-col shrink-0 border-r border-border" style={{ width: leftWidth }}>
          {/* 搜索 + 操作按钮 */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border shrink-0">
            <div className="relative flex-1">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索..."
                className="w-full h-7 pl-7 pr-2 text-[11px] bg-background border border-input rounded outline-none focus:border-ring transition-colors placeholder:text-muted-foreground/40" />
            </div>
            <button onClick={handleNew}
              className="flex items-center justify-center w-7 h-7 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
              title="新建技能文件">
              <FilePlus size={14} />
            </button>
            <div className="relative">
              <button onClick={() => setMoreOpen(!moreOpen)}
                className="flex items-center justify-center w-7 h-7 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title="更多操作">
                <MoreHorizontal size={14} />
              </button>
              {moreOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 w-36 bg-popover border border-border rounded-lg shadow-lg py-1 text-xs">
                    <button onClick={() => { setMoreOpen(false); handleExportAll(); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-left">
                      <Download size={12} /> 导出全部
                    </button>
                    <button onClick={() => { setMoreOpen(false); fileInputRef.current?.click(); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-left">
                      <Upload size={12} /> 导入文件
                    </button>
                    <button onClick={() => { setMoreOpen(false); openWorkspaceDir("skills"); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-left">
                      <FolderOpen size={12} /> 打开位置
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 文件树 */}
          <div className="flex-1 overflow-y-auto p-1 space-y-0.5"
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}>
            {filtered.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-8">{search ? "无匹配" : "空目录"}</p>
            ) : (
              filtered.map(s => (
                <div key={s.id}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, fileId: s.id }); }}>
                  <button onClick={() => selectFile(s.id)}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors text-left group ${
                      selectedId === s.id
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    }`}
                    title={s.filename}>
                    <FileCode size={13} className="shrink-0 opacity-60" />
                    <span className="truncate flex-1">{s.name || s.id}</span>
                    <span className="text-[9px] text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity">{s.id.slice(0, 6)}</span>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 拖拽手柄 */}
        <div onMouseDown={handleMouseDown}
          className="w-[3px] shrink-0 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors relative z-10">
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>

        {/* ── 右侧：编辑器 ── */}
        {!editing ? (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground bg-background min-w-0">
            <div className="text-center"><FileCode size={36} className="mx-auto mb-2 opacity-20" /><p>选择一个技能文件开始编辑</p></div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col bg-background min-w-0">
            {/* 面包屑 + 文件路径 */}
            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border bg-muted/20 shrink-0">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground/70 font-mono truncate">
                <span className="text-muted-foreground/40">workspace/skills/</span>
                <span className="text-foreground/80">{editing.filename}</span>
              </div>
              <div className="flex-1" />
              {renaming === editing.id ? (
                <input type="text" value={renameValue} autoFocus
                  onBlur={() => setRenaming(null)}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter") { await handleRename(editing.id, renameValue); setRenaming(null); }
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="text-[11px] bg-background border border-input rounded px-1.5 py-0.5 w-28 outline-none focus:border-ring" />
              ) : (
                <button onClick={() => { setRenaming(editing.id); setRenameValue(editing.name || editing.id); }}
                  className="text-[10px] text-muted-foreground/50 hover:text-foreground transition-colors shrink-0">
                  <Pencil size={11} />
                </button>
              )}
              <span className="text-[9px] uppercase text-muted-foreground/30 font-mono border border-border/30 rounded px-1.5 py-0.5">
                {editing.filename.endsWith('.md') ? 'md' : editing.filename.split('.').pop() || 'txt'}
              </span>
            </div>

            {/* Frontmatter 编辑行 */}
            <div className="flex items-center gap-2 px-4 pt-2 pb-1 shrink-0">
              <input type="text" value={editing.name}
                onChange={(e) => { setEditing({ ...editing, name: e.target.value }); setDirty(true); }}
                placeholder="name: 技能名称"
                className="flex-1 text-[11px] bg-transparent border border-border/30 rounded px-2 py-1 font-mono outline-none focus:border-ring/50 placeholder:text-muted-foreground/30" />
              <input type="text" value={editing.description}
                onChange={(e) => { setEditing({ ...editing, description: e.target.value }); setDirty(true); }}
                placeholder="description: 简短描述"
                className="flex-1 text-[11px] bg-transparent border border-border/30 rounded px-2 py-1 font-mono outline-none focus:border-ring/50 placeholder:text-muted-foreground/30" />
            </div>
            <div className="px-4 pb-1 shrink-0">
              <div className="text-[9px] text-muted-foreground/30 font-mono border-b border-border/20 pb-1">--- frontmatter ---</div>
            </div>

            {/* CodeMirror 编辑器 */}
            <div className="flex-1 min-h-0 px-4 pb-3">
              <div className="h-full border border-border/20 rounded overflow-hidden">
                <CodeMirrorEditor
                  value={editing.content}
                  onChange={(val) => { setEditing({ ...editing, content: val }); setDirty(true); }}
                  language={editing.filename.endsWith('.js') || editing.filename.endsWith('.ts') ? 'javascript' : editing.filename.endsWith('.yaml') || editing.filename.endsWith('.yml') ? 'yaml' : 'markdown'}
                  placeholder="在此编写技能定义（Markdown/代码格式）..."
                />
              </div>
            </div>

            {/* 底部状态栏 */}
            <div className="flex items-center gap-2 px-4 py-1 border-t border-border bg-muted/20 shrink-0">
              <div className="flex items-center gap-2">
                <button onClick={handleSave} disabled={loading || !dirty}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-[10px] font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors">
                  <Save size={11} /> {loading ? "保存中..." : "保存"}
                </button>
                <button onClick={() => handleExportFile(editing.id)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-input text-[10px] text-muted-foreground hover:text-foreground hover:border-ring transition-colors">
                  <Download size={11} /> 导出
                </button>
                <button onClick={() => { if (window.confirm(`确认删除「${editing.name || editing.id}」？`)) handleDelete(editing.id); }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md border border-destructive/30 text-[10px] text-destructive hover:bg-destructive/10 transition-colors">
                  <Trash2 size={11} /> 删除
                </button>
              </div>
              <div className="flex-1" />
              {dirty && <span className="text-[10px] text-amber-500">● 未保存</span>}
              <span className="text-[9px] text-muted-foreground/40">{(editing.content.match(/\n/g) || []).length + 1} 行</span>
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
                  { label: "重命名", icon: <FileText size={12} />, onClick: () => { const f = skills.find(s => s.id === ctxMenu.fileId); if (f) { setRenaming(f.id); setRenameValue(f.name || f.id); } } },
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

      <input ref={fileInputRef} type="file" accept=".md" onChange={handleImport} className="hidden" />
    </section>
  );
}
