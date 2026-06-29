import { useState, useRef, useEffect } from "react";
import {
  FileCode, Search, FilePlus, FolderPlus, MoreHorizontal, Download, Upload, FolderOpen, Trash2, Plus, FileText,
} from "lucide-react";
import { toast } from "sonner";
import {
  listWorkspaceFiles,
  writeWorkspaceFile,
  deleteWorkspaceFile,
  renameWorkspaceFile,
  exportWorkspaceFileContent,
  importWorkspaceFileContent,
  openWorkspaceDir,
  createWorkspaceSubdir,
} from "../../../lib/workspace";
import type { WorkspaceFile } from "../../../lib/workspace";
import { CodeMirrorEditor } from "../../editor/CodeMirrorEditor";
import { ContextMenu } from "../ContextMenu";

/** 获取文件扩展名对应的图标和颜色 */
function fileTypeInfo(filename: string): { label: string; color: string } {
  if (filename.endsWith('.md')) return { label: 'md', color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' };
  if (filename.endsWith('.js') || filename.endsWith('.jsx')) return { label: 'js', color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30' };
  if (filename.endsWith('.ts') || filename.endsWith('.tsx')) return { label: 'ts', color: 'text-blue-500 bg-blue-500/10 border-blue-500/30' };
  if (filename.endsWith('.yaml') || filename.endsWith('.yml')) return { label: 'yaml', color: 'text-purple-400 bg-purple-500/10 border-purple-500/30' };
  if (filename.endsWith('.json')) return { label: 'json', color: 'text-green-400 bg-green-500/10 border-green-500/30' };
  return { label: (filename.split('.').pop() || 'txt').toLowerCase(), color: 'text-muted-foreground bg-muted/50 border-border/50' };
}

export function SkillsSection() {
  const [skills, setSkills] = useState<WorkspaceFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorkspaceFile | null>(null);
  const [dirtyMap, setDirtyMap] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [search, setSearch] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; fileId?: string } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(240);
  const [fontSize, setFontSize] = useState(13);
  const [fontTip, setFontTip] = useState(false);
  const fontTipTimer = useRef<ReturnType<typeof setTimeout>>();
  const draggingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const list = await listWorkspaceFiles("skills");
    setSkills(list);
    return list;
  };
  useEffect(() => { load(); }, []);

  const filtered = skills
    .filter(s =>
      !search || s.filename.toLowerCase().includes(search.toLowerCase()) || s.name.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => a.filename.localeCompare(b.filename));

  // 自动聚焦重命名输入框
  useEffect(() => {
    if (renaming) {
      // 延迟到 DOM 渲染完成
      setTimeout(() => renameInputRef.current?.focus(), 10);
    }
  }, [renaming]);

  const selectFile = (id: string) => {
    setSelectedId(id);
    const file = skills.find(s => s.id === id);
    if (file) setEditing({ ...file });
    // 不重置 dirtyMap — 未保存标记跨文件切换后仍保留
  };

  const handleNew = async () => {
    if (Object.values(dirtyMap).some(v => v)) { toast.warning("请先保存当前编辑"); return; }
    const name = "新技能";
    // 用名称作为文件名，不同名自动加序号
    const existingNames = new Set(skills.map(s => s.filename.replace(/\.md$/, '')));
    let finalName = name;
    let counter = 1;
    while (existingNames.has(finalName)) {
      counter++;
      finalName = `${name}${counter}`;
    }
    await writeWorkspaceFile("skills", finalName, name, "", "");
    const list = await load();
    const file = list.find(s => s.id === finalName);
    if (file) { setSelectedId(file.id); setEditing({ ...file }); }
    setDirtyMap(prev => ({ ...prev, [finalName]: false }));
  };

  const handleNewFolder = async () => {
    const name = prompt("请输入文件夹名称：", "新文件夹");
    if (!name) return;
    try {
      await createWorkspaceSubdir("skills", name.trim());
      toast.success(`文件夹「${name.trim()}」已创建`);
    } catch (e: any) {
      toast.error("创建文件夹失败: " + (e?.toString() || "未知错误"));
    }
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { toast.error("请输入技能名称"); return; }
    try {
      await writeWorkspaceFile("skills", editing.id, editing.name, editing.description, editing.content);
      toast.success("保存成功");
      setDirtyMap(prev => ({ ...prev, [editing.id]: false }));
      await load();
      setSelectedId(editing.id);
    } catch (e: any) {
      toast.error("保存失败: " + (e?.toString() || "未知错误"));
    }
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
      if (selectedId === id) { setSelectedId(null); setEditing(null); setDirtyMap(prev => ({ ...prev, [id]: false })); }
      await load();
    } catch (e: any) {
      toast.error("删除失败: " + (e?.toString() || "未知错误"));
    }
  };

  const handleRename = async (id: string, newName: string) => {
    if (!newName.trim()) return;
    const file = skills.find(s => s.id === id);
    if (!file) return;
    try {
      // 用户可输入完整文件名（含后缀），也可只输入名称
      let finalName = newName.trim();
      // 不含后缀则补 .md
      if (!finalName.includes('.')) finalName += '.md';
      await renameWorkspaceFile("skills", id, finalName);
      toast.success("重命名成功");
      const list = await load();
      const renamedFile = list.find(s => s.filename === finalName);
      if (renamedFile) {
        setSelectedId(renamedFile.id);
        setEditing({ ...renamedFile });
      }
    } catch (e: any) {
      toast.error("重命名失败: " + (e?.toString() || "未知错误"));
    }
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

  const showFontTip = () => {
    setFontTip(true);
    if (fontTipTimer.current) clearTimeout(fontTipTimer.current);
    fontTipTimer.current = setTimeout(() => setFontTip(false), 1200);
  };

  return (
    <section className="flex flex-col flex-1 min-h-0">
      <h2 className="text-base font-semibold mb-3 shrink-0 sr-only">技能</h2>

      <div className="flex-1 flex min-h-0 bg-card overflow-hidden">
        {/* ── 左侧：搜索 + 文件树 ── */}
        <div className="flex flex-col shrink-0 border-r border-border" style={{ width: leftWidth }}>
          {/* 搜索 + 操作按钮 */}
          <div className="flex items-center gap-1 px-1 py-1 border-b border-border shrink-0">
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
            <button onClick={handleNewFolder}
              className="flex items-center justify-center w-7 h-7 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors shrink-0"
              title="新建文件夹">
              <FolderPlus size={14} />
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
              filtered.map(s => {
                const ft = fileTypeInfo(s.filename);
                return (
                  <div key={s.id}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, fileId: s.id }); }}>
                    {renaming === s.id ? (
                      <div className="flex items-center gap-1.5 px-1.5 py-1">
                        <input ref={renameInputRef} type="text" value={renameValue}
                          onBlur={() => setRenaming(null)}
                          onKeyDown={async (e) => {
                            if (e.key === "Enter") { setRenaming(null); await handleRename(s.id, renameValue); }
                            if (e.key === "Escape") setRenaming(null);
                          }}
                          onChange={(e) => setRenameValue(e.target.value)}
                          className="flex-1 text-[11px] bg-background border border-ring rounded px-2 py-1 outline-none min-w-0"
                          onClick={(e) => e.stopPropagation()} />
                      </div>
                    ) : (
                      <button onClick={() => selectFile(s.id)}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors text-left group ${
                          selectedId === s.id
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                        }`}
                        title={s.filename}>
                        <span className={`text-[8px] font-mono font-semibold uppercase px-1 py-0.5 rounded border shrink-0 ${ft.color}`}>
                          {ft.label}
                        </span>
                        <span className="truncate flex-1 text-left">{s.filename}</span>
                        {dirtyMap[s.id] && (
                          <span className="text-[10px] text-amber-500 shrink-0 leading-none">●</span>
                        )}
                      </button>
                    )}
                  </div>
                );
              })
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
            <div className="flex items-center gap-2 px-2 py-1 border-b border-border bg-muted/20 shrink-0">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground/70 font-mono truncate">
                <span className="text-muted-foreground/40">workspace/skills/</span>
                <span className="text-foreground/80">{editing.filename}</span>
              </div>
              <div className="flex-1" />
              <span className="text-[9px] uppercase text-muted-foreground/30 font-mono border border-border/30 rounded px-1.5 py-0.5">
                {editing.filename.endsWith('.md') ? 'md' : editing.filename.split('.').pop() || 'txt'}
              </span>
            </div>

            {/* CodeMirror 编辑器 — 无内边距、无底部状态栏 */}
            <div className="flex-1 min-h-0 relative"
              onWheel={(e) => {
                if (e.ctrlKey) {
                  e.preventDefault();
                  e.stopPropagation();
                  setFontSize(f => Math.max(10, Math.min(24, f - Math.sign(e.deltaY))));
                  showFontTip();
                }
              }}>
              <CodeMirrorEditor
                value={editing.content}
                onChange={(val) => { setEditing({ ...editing, content: val }); setDirtyMap(prev => ({ ...prev, [editing.id]: true })); }}
                language={editing.filename.endsWith('.js') || editing.filename.endsWith('.ts') ? 'javascript' : editing.filename.endsWith('.yaml') || editing.filename.endsWith('.yml') ? 'yaml' : 'markdown'}
                placeholder="在此编写技能定义（Markdown/代码格式）..."
                fontSize={`${fontSize}px`}
              />
              {/* 字体大小浮动提示 */}
              <div className={`absolute bottom-3 right-3 z-20 px-2.5 py-1 rounded-md bg-popover border border-border shadow-lg text-xs font-mono transition-opacity duration-200 pointer-events-none ${fontTip ? 'opacity-100' : 'opacity-0'}`}>
                {fontSize}px
              </div>
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
                  { label: "重命名", icon: <FileText size={12} />, onClick: () => { const f = skills.find(s => s.id === ctxMenu.fileId); if (f) { setRenaming(f.id); setRenameValue(f.filename || f.id); } } },
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
