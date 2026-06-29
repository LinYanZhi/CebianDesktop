import { listen } from "@tauri-apps/api/event";
import { useState, useRef, useEffect } from "react";
import {
  FileCode, FileText, FileJson, File, Search, FilePlus, FolderPlus, MoreHorizontal, Download, Upload,
  FolderOpen, Trash2, Plus, Folder, FileImage, FileArchive, ChevronRight, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import {
  listWorkspaceFiles, writeWorkspaceFile, deleteWorkspaceFile, renameWorkspaceFile,
  exportWorkspaceFileContent, importWorkspaceFileContent, openWorkspaceDir,
  createWorkspaceSubdir, deleteWorkspaceSubdir, moveWorkspaceFile,
} from "../../../lib/workspace";
import type { WorkspaceFile } from "../../../lib/workspace";
import { CodeMirrorEditor } from "../../editor/CodeMirrorEditor";
import { ContextMenu } from "../ContextMenu";

/** 文件扩展名 → lucide 图标 + 颜色 */
const FILE_ICON_MAP: Record<string, { icon: any; color: string }> = {
  '.md':     { icon: FileText, color: 'text-blue-400' },
  '.js':     { icon: FileCode, color: 'text-yellow-400' },
  '.jsx':    { icon: FileCode, color: 'text-yellow-400' },
  '.mjs':    { icon: FileCode, color: 'text-yellow-400' },
  '.ts':     { icon: FileCode, color: 'text-blue-500' },
  '.tsx':    { icon: FileCode, color: 'text-blue-500' },
  '.d.ts':   { icon: FileCode, color: 'text-blue-400' },
  '.json':   { icon: FileJson, color: 'text-green-400' },
  '.jsonc':  { icon: FileJson, color: 'text-green-400' },
  '.yaml':   { icon: File, color: 'text-purple-400' },
  '.yml':    { icon: File, color: 'text-purple-400' },
  '.css':    { icon: FileCode, color: 'text-pink-400' },
  '.scss':   { icon: FileCode, color: 'text-pink-400' },
  '.less':   { icon: FileCode, color: 'text-pink-300' },
  '.html':   { icon: FileCode, color: 'text-orange-400' },
  '.htm':    { icon: FileCode, color: 'text-orange-400' },
  '.py':     { icon: FileCode, color: 'text-cyan-400' },
  '.rs':     { icon: FileCode, color: 'text-orange-400' },
  '.go':     { icon: FileCode, color: 'text-cyan-500' },
  '.rb':     { icon: FileCode, color: 'text-red-400' },
  '.php':    { icon: FileCode, color: 'text-indigo-400' },
  '.java':   { icon: FileCode, color: 'text-orange-500' },
  '.sh':     { icon: FileCode, color: 'text-green-500' },
  '.bash':   { icon: FileCode, color: 'text-green-500' },
  '.zsh':    { icon: FileCode, color: 'text-green-500' },
  '.ps1':    { icon: FileCode, color: 'text-blue-400' },
  '.bat':    { icon: FileCode, color: 'text-gray-400' },
  '.cmd':    { icon: FileCode, color: 'text-gray-400' },
  '.exe':    { icon: FileCode, color: 'text-slate-400' },
  '.toml':   { icon: File, color: 'text-red-400' },
  '.ini':    { icon: File, color: 'text-amber-400' },
  '.cfg':    { icon: File, color: 'text-amber-400' },
  '.conf':   { icon: File, color: 'text-amber-400' },
  '.env':    { icon: File, color: 'text-yellow-500' },
  '.gitignore': { icon: File, color: 'text-orange-400' },
  '.svg':    { icon: FileImage, color: 'text-green-400' },
  '.png':    { icon: FileImage, color: 'text-green-400' },
  '.jpg':    { icon: FileImage, color: 'text-green-400' },
  '.jpeg':   { icon: FileImage, color: 'text-green-400' },
  '.gif':    { icon: FileImage, color: 'text-green-400' },
  '.webp':   { icon: FileImage, color: 'text-green-400' },
  '.bmp':    { icon: FileImage, color: 'text-green-400' },
  '.ico':    { icon: FileImage, color: 'text-green-400' },
  '.zip':    { icon: FileArchive, color: 'text-amber-500' },
  '.tar.gz': { icon: FileArchive, color: 'text-amber-500' },
  '.tar':    { icon: FileArchive, color: 'text-amber-500' },
  '.gz':     { icon: FileArchive, color: 'text-amber-500' },
  '.7z':     { icon: FileArchive, color: 'text-amber-500' },
  '.rar':    { icon: FileArchive, color: 'text-amber-500' },
  '.pdf':    { icon: FileText, color: 'text-red-500' },
  '.txt':    { icon: FileText, color: 'text-muted-foreground' },
  '.log':    { icon: FileText, color: 'text-muted-foreground' },
  '.sql':    { icon: FileCode, color: 'text-orange-300' },
  '.vue':    { icon: FileCode, color: 'text-emerald-400' },
  '.svelte': { icon: FileCode, color: 'text-orange-400' },
  '.astro':  { icon: FileCode, color: 'text-purple-400' },
  '.wasm':   { icon: FileCode, color: 'text-purple-500' },
  '.lock':   { icon: File, color: 'text-muted-foreground' },
  '.mdx':    { icon: FileText, color: 'text-blue-400' },
};

function fileIcon(filename: string): { icon: any; color: string } {
  const lower = filename.toLowerCase();
  // 找最长匹配
  let best: { icon: any; color: string } | null = null;
  let bestLen = 0;
  for (const [ext, info] of Object.entries(FILE_ICON_MAP)) {
    if (lower.endsWith(ext) && ext.length > bestLen) {
      best = info;
      bestLen = ext.length;
    }
  }
  return best ?? { icon: File, color: 'text-muted-foreground' };
}

export function SkillsSection() {
  const [skills, setSkills] = useState<WorkspaceFile[]>([]);
  const [selectedFilenames, setSelectedFilenames] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<WorkspaceFile | null>(null);
  const [dirtyMap, setDirtyMap] = useState<Record<string, boolean>>({});
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [creatingFile, setCreatingFile] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [createValue, setCreateValue] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createDirContext, setCreateDirContext] = useState<string>("");
  const [currentDir, setCurrentDir] = useState<string>(""); // 当前工作目录（点击空白=根，点击目录=目录，点击文件=父目录）
  const [renameError, setRenameError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; fileId?: string; isDir?: boolean } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(240);
  const [fontSize, setFontSize] = useState(13);
  const [fontTip, setFontTip] = useState(false);
  const [dragOverDir, setDragOverDir] = useState<string | null>(null);
  const [draggingFile, setDraggingFile] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const fontTipTimer = useRef<ReturnType<typeof setTimeout>>();
  const draggingRef = useRef(false);
  const dragFileRef = useRef<string | null>(null);
  const dragDirRef = useRef<string | null>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const dragActiveRef = useRef(false); // 是否超过阈值进入拖拽模式
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const loadVersionRef = useRef(0); // 防过期加载

  const load = async () => {
    loadVersionRef.current += 1;
    const version = loadVersionRef.current;
    const list = await listWorkspaceFiles("skills");
    if (version === loadVersionRef.current) {
      setSkills(list);
    }
    return list;
  };
  useEffect(() => { load(); }, []);

  // 监听外部文件变更（从文件管理器删除/新增）
  useEffect(() => {
    const unlisten = listen('workspace:changed:skills', () => { load(); });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // ─── 拖拽：用 Pointer Events 模拟拖拽，避免 WebView2 DnD 兼容问题 ────
  const handlePointerDown = (e: React.PointerEvent, filename: string) => {
    if (e.button !== 0) return; // 只响应左键
    dragFileRef.current = filename;
    dragDirRef.current = null;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    // 注意：不设置 draggingFile state，等 pointermove 超过阈值再触发
  };

  // 用原生事件监听全局 pointermove/pointerup
  useEffect(() => {
    const container = treeContainerRef.current;
    if (!container) return;

    const DRAG_THRESHOLD = 5; // 像素

    const onMove = (e: PointerEvent) => {
      if (!dragFileRef.current) return;
      // 检查是否超过拖拽阈值
      if (dragStartPos.current) {
        const dx = e.clientX - dragStartPos.current.x;
        const dy = e.clientY - dragStartPos.current.y;
        if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
        // 超过阈值，正式进入拖拽模式
        dragStartPos.current = null;
        dragActiveRef.current = true;
        setDraggingFile(dragFileRef.current);
        setDragPos({ x: e.clientX, y: e.clientY });
      }
      if (!dragActiveRef.current) return;
      // 禁止文本/元素框选
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
      // 更新浮动指示器位置
      setDragPos({ x: e.clientX, y: e.clientY });
      // 检测鼠标下的目标元素
      let el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      while (el && el !== container && !el.hasAttribute('data-dir-id')) {
        el = el.parentElement;
      }
      const dirId = el?.getAttribute('data-dir-id') || '';
      if (dirId !== dragDirRef.current) {
        dragDirRef.current = dirId;
        setDragOverDir(dirId);
      }
    };

    const onUp = async (e: PointerEvent) => {
      const isDragging = dragActiveRef.current;
      const fileId = dragFileRef.current;
      // 清理所有状态
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
      dragFileRef.current = null;
      dragDirRef.current = null;
      dragStartPos.current = null;
      dragActiveRef.current = false;
      setDragOverDir(null);
      setDraggingFile(null);
      setDragPos(null);
      // 没超过阈值 → 纯点击，不执行移动
      if (!isDragging || !fileId) return;
      // 鼠标释放位置检测目标目录
      let el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      while (el && el !== container && !el.hasAttribute('data-dir-id')) {
        el = el.parentElement;
      }
      const targetDir = el?.getAttribute('data-dir-id') || '';
      try {
        await moveWorkspaceFile("skills", fileId, targetDir);
        await load();
        toast.success(targetDir ? "已移动到目录" : "已移回根目录");
      } catch (err: any) {
        toast.error("移动失败: " + (err?.toString() || "未知错误"));
      }
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, [skills]);

  // ─── Tree building ──────────────────────────────────────
  // 获取 path 的父目录（空字符串表示根）
  const dirOf = (f: WorkspaceFile): string => {
    const p = f.filename.endsWith('/') ? f.id : f.filename;
    const idx = p.lastIndexOf('/');
    return idx > 0 ? p.slice(0, idx) : '';
  };
  const isDir = (f: WorkspaceFile) => f.filename.endsWith('/');
  const baseName = (f: WorkspaceFile) => isDir(f) ? f.id.replace(/.*\//, '') : f.filename.replace(/.*\//, '');

  // 根据搜索过滤 + 展开状态构建可见项列表
  const visibleItems = (() => {
    // 按父目录分组
    const byParent = new Map<string, WorkspaceFile[]>();
    for (const item of skills) {
      const parent = dirOf(item);
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent)!.push(item);
    }
    // 排序
    for (const [, items] of byParent) {
      items.sort((a, b) => {
        const aD = isDir(a), bD = isDir(b);
        if (aD !== bD) return aD ? -1 : 1;
        return baseName(a).localeCompare(baseName(b));
      });
    }

    const result: { item: WorkspaceFile; depth: number }[] = [];
    const walk = (parent: string, depth: number) => {
      const children = byParent.get(parent);
      if (!children) return;
      for (const child of children) {
        // 搜索过滤
        if (search && !child.filename.toLowerCase().includes(search.toLowerCase()) && !child.name.toLowerCase().includes(search.toLowerCase())) {
          // 目录即使不匹配也显示（可能匹配了子项）
          if (isDir(child)) {
            // 检查子项是否有匹配
            const hasMatchingChild = skills.some(s =>
              s.filename.startsWith(child.id + '/') &&
              (s.filename.toLowerCase().includes(search.toLowerCase()) || s.name.toLowerCase().includes(search.toLowerCase()))
            );
            if (!hasMatchingChild) continue;
          } else {
            continue;
          }
        }
        result.push({ item: child, depth });
        if (isDir(child) && expandedDirs.has(child.id)) {
          walk(child.id, depth + 1);
        }
      }
    };
    walk('', 0);
    return result;
  })();

  // ─── 选择 / 多选 ────────────────────────────────────────
  const toggleSelect = (filename: string, ctrl: boolean, shift: boolean) => {
     if (ctrl) {
       setSelectedFilenames(prev => {
         const next = new Set(prev);
         if (next.has(filename)) next.delete(filename); else next.add(filename);
         return next;
       });
     } else if (shift) {
       setSelectedFilenames(prev => {
         const next = new Set(prev);
         const idx = visibleItems.findIndex(v => v.item.filename === filename);
         let lastIdx = -1;
         for (let i = 0; i < visibleItems.length; i++) {
           if (prev.has(visibleItems[i].item.filename)) lastIdx = i;
         }
         if (lastIdx >= 0 && idx >= 0) {
           const from = Math.min(lastIdx, idx);
           const to = Math.max(lastIdx, idx);
           for (let i = from; i <= to; i++) next.add(visibleItems[i].item.filename);
         }
         return next;
       });
     } else {
       setSelectedFilenames(new Set([filename]));
     }
   };

  const selectFile = (id: string) => {
    const file = skills.find(s => s.id === id);
    if (file) setEditing({ ...file });
  };

  // ─── 目录展开/折叠 ──────────────────────────────────────
  const toggleDir = (dirId: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dirId)) next.delete(dirId); else next.add(dirId);
      return next;
    });
  };

  const sectionRef = useRef<HTMLDivElement>(null);

  // ─── 快捷键 ────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // F2：只在技能面板内有焦点时生效（防止聊天页面误触）
      if (e.key === "F2" && sectionRef.current?.contains(document.activeElement)) {
        e.preventDefault();
        const selected = Array.from(selectedFilenames);
        if (selected.length === 1) {
          const f = skills.find(s => s.filename === selected[0]);
          if (f) {
            setRenaming(f.id);
            setRenameValue(baseName(f));
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedFilenames, skills]);

  // 自动聚焦输入框
  useEffect(() => {
    if (renaming) {
      setRenameError(null);
      setTimeout(() => renameInputRef.current?.focus(), 10);
    }
    if (creatingFile || creatingFolder) {
      setCreateValue("");
      setCreateError(null);
      setTimeout(() => createInputRef.current?.focus(), 10);
    }
  }, [renaming, creatingFile, creatingFolder]);

  const handleNew = async () => {
    if (Object.values(dirtyMap).some(v => v)) { toast.warning("请先保存当前编辑"); return; }
    setCreatingFile(true);
    setCreatingFolder(false);
    setRenaming(null);
    setCreateDirContext(currentDir);
  };

  const handleNewFolder = () => {
    setCreatingFolder(true);
    setCreatingFile(false);
    setRenaming(null);
    setCreateDirContext(currentDir);
  };

  const confirmCreateFile = async (name: string) => {
    setCreatingFile(false);
    setCreateDirContext("");
    const trimmed = name.trim();
    if (!trimmed) return;
    // 拼接目录上下文
    const fullName = createDirContext ? createDirContext + '/' + trimmed : trimmed;
    // 检查重名
    const existingNames = new Set(skills.map(s => s.filename));
    if (existingNames.has(fullName)) {
      setCreateError(trimmed);
      setCreatingFile(true);
      return;
    }
    await writeWorkspaceFile("skills", fullName, trimmed.replace(/\.\w+$/, ''), "", "");
    const list = await load();
    const file = list.find(s => s.id === fullName);
    if (file) { setSelectedFilenames(new Set([file.filename])); setEditing({ ...file }); }
    setDirtyMap(prev => ({ ...prev, [file?.id || '']: false }));
  };

  const confirmCreateFolder = async (name: string) => {
    setCreatingFolder(false);
    setCreateDirContext("");
    const trimmed = name.trim();
    if (!trimmed) return;
    const fullName = createDirContext ? createDirContext + '/' + trimmed : trimmed;
    // 检查重名（用 filename 避免 id 去后缀导致的冲突）
    const existingNames = new Set(skills.map(s => s.filename));
    // 目录的 fullName 如 "123"，但目录 filename 是 "123/"
    if (existingNames.has(fullName + '/')) {
      setCreateError(trimmed);
      setCreatingFolder(true);
      return;
    }
    try {
      await createWorkspaceSubdir("skills", fullName);
      await load();
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
      setSelectedFilenames(new Set([editing.filename]));
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
    const file = skills.find(s => s.id === id);
    try {
      await deleteWorkspaceFile("skills", id);
      toast.success("已删除");
      if (file && selectedFilenames.has(file.filename)) { setEditing(null); setDirtyMap(prev => ({ ...prev, [id]: false })); }
      await load();
    } catch (e: any) {
      toast.error("删除失败: " + (e?.toString() || "未知错误"));
    }
  };

  const handleRename = async (id: string, newName: string) => {
    if (!newName.trim()) return;
    const file = skills.find(s => s.id === id);
    if (!file) return;
    const trimmed = newName.trim();
    // 保留父目录前缀，完全尊重用户输入
    const parentDir = dirOf(file);
    const finalName = parentDir ? parentDir + '/' + trimmed : trimmed;
    // 检查重名（排除当前文件）
    if (finalName !== file.filename && skills.some(s => s.filename === finalName)) {
      setRenameError(trimmed);
      setRenaming(id);
      setRenameValue(trimmed);
      return;
    }
    try {
      await renameWorkspaceFile("skills", id, finalName);
      toast.success("重命名成功");
      const list = await load();
      const renamedFile = list.find(s => s.filename === finalName);
      if (renamedFile) {
        setSelectedFilenames(new Set([renamedFile.filename]));
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


  const handleDeleteDir = async (dirId: string) => {
    try {
      await deleteWorkspaceSubdir("skills", dirId);
      toast.success("目录已删除");
      await load();
    } catch (e: any) {
      toast.error("删除目录失败: " + (e?.toString() || "未知错误"));
    }
  };
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
    <section ref={sectionRef} className="flex flex-col flex-1 min-h-0">
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
          <div ref={treeContainerRef} className="flex-1 overflow-y-auto p-1 space-y-0.5"
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
            onPointerDown={() => { setCurrentDir(""); }}>
            {creatingFolder && (
              <div className="flex items-center gap-1.5 px-1.5 py-1">
                <Folder size={12} className="shrink-0 text-muted-foreground/50" />
                <input ref={createInputRef} type="text" value={createValue}
                  placeholder="文件夹名称"
                  onBlur={(e) => confirmCreateFolder(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !createError) { confirmCreateFolder(createValue); }
                    if (e.key === "Escape") { setCreatingFolder(false); setCreateError(null); }
                  }}
                  onChange={(e) => { setCreateValue(e.target.value); setCreateError(null); }}
                  className={`flex-1 text-[11px] bg-background border rounded px-2 py-1 outline-none min-w-0 ${createError ? 'border-red-500 ring-1 ring-red-500' : 'border-ring'}`} />
              </div>
            )}
            {creatingFile && (
              <div className="flex items-center gap-1.5 px-1.5 py-1">
                <FilePlus size={12} className="shrink-0 text-muted-foreground/50" />
                <input ref={createInputRef} type="text" value={createValue}
                  placeholder="文件名（如 技能.md, script.js）"
                  onBlur={(e) => confirmCreateFile(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !createError) { confirmCreateFile(createValue); }
                    if (e.key === "Escape") { setCreatingFile(false); setCreateError(null); }
                  }}
                  onChange={(e) => { setCreateValue(e.target.value); setCreateError(null); }}
                  className={`flex-1 text-[11px] bg-background border rounded px-2 py-1 outline-none min-w-0 ${createError ? 'border-red-500 ring-1 ring-red-500' : 'border-ring'}`} />
              </div>
            )}
            {visibleItems.length === 0 && !creatingFile && !creatingFolder ? (
              <p className="text-[11px] text-muted-foreground text-center py-8">{search ? "无匹配" : "空目录"}</p>
            ) : (
              visibleItems.map(({ item: s, depth }) => {
                const selected = selectedFilenames.has(s.filename);
                return (
                  <div key={s.id}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, fileId: s.id, isDir: isDir(s) }); }}>
                    {renaming === s.id ? (
                      <div className="flex items-center gap-1.5 px-1.5 py-1" style={{ paddingLeft: 8 + depth * 16 }}>
                        <input ref={renameInputRef} type="text" value={renameValue}
                          onBlur={() => { setRenaming(null); setRenameError(null); }}
                          onKeyDown={async (e) => {
                            if (e.key === "Enter" && !renameError) { setRenaming(null); await handleRename(s.id, renameValue); }
                            if (e.key === "Escape") { setRenaming(null); setRenameError(null); }
                          }}
                          onChange={(e) => { setRenameValue(e.target.value); setRenameError(null); }}
                          className={`flex-1 text-[11px] bg-background border rounded px-2 py-1 outline-none min-w-0 ${renameError ? 'border-red-500 ring-1 ring-red-500' : 'border-ring'}`}
                          onClick={(e) => e.stopPropagation()} />
                      </div>
                    ) : isDir(s) ? (
                      // ── 目录项 ──
                      <div data-dir-id={s.id} tabIndex={-1}
                        onClick={(e) => { toggleDir(s.id); toggleSelect(s.filename, e.ctrlKey || e.metaKey, e.shiftKey); setCurrentDir(s.id); }}
                        onPointerDown={(e) => handlePointerDown(e, s.filename)}
                        className={`flex items-center px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition-colors group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                          dragOverDir === s.id ? 'bg-accent ring-1 ring-primary' : selected ? 'bg-accent/70' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                        }`}
                        style={{ paddingLeft: 8 + depth * 16 }}>
                        <span className="w-4 shrink-0 flex items-center justify-center">
                          {expandedDirs.has(s.id)
                            ? <ChevronDown size={12} className="shrink-0 text-muted-foreground/50" />
                            : <ChevronRight size={12} className="shrink-0 text-muted-foreground/50" />}
                        </span>
                        {expandedDirs.has(s.id)
                          ? <FolderOpen size={14} className="w-[18px] shrink-0 text-muted-foreground/60" />
                          : <Folder size={14} className="w-[18px] shrink-0 text-muted-foreground/60" />}
                        <span className="w-2 shrink-0" />
                        <span className="truncate flex-1 text-left">{baseName(s)}</span>
                      </div>
                    ) : (
                      // ── 文件项 ──
                      <div tabIndex={-1}
                        onClick={(e) => { toggleSelect(s.filename, e.ctrlKey || e.metaKey, e.shiftKey); selectFile(s.id); setCurrentDir(dirOf(s)); }}
                        onPointerDown={(e) => handlePointerDown(e, s.filename)}
                        className={`flex items-center px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                          selected ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                        }`}
                        style={{ paddingLeft: 8 + depth * 16 }}
                        title={s.filename}>
                        <span className="w-4 shrink-0" />
                        {(() => { const fi = fileIcon(s.filename); const Icon = fi.icon; return <Icon size={14} className="w-[18px] shrink-0" />; })()}
                        <span className="w-2 shrink-0" />
                        <span className="truncate flex-1 text-left">{baseName(s)}</span>
                        {dirtyMap[s.id] && (
                          <span className="text-[10px] text-amber-500 shrink-0 leading-none">●</span>
                        )}
                      </div>
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
              {(() => { const fi = fileIcon(editing.filename); const Icon = fi.icon; return <Icon size={11} className={`${fi.color}`} />; })()}
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
                fontSize={`${fontSize}px`} />
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
            ctxMenu.fileId && ctxMenu.isDir
               ? [
                   { label: "在此目录新建文件", icon: <Plus size={12} />, onClick: () => { setCreateDirContext(ctxMenu.fileId!); setCreatingFile(true); setCreatingFolder(false); setRenaming(null); } },
                   { label: "新建子目录", icon: <FolderPlus size={12} />, onClick: () => { setCreateDirContext(ctxMenu.fileId!); setCreatingFolder(true); setCreatingFile(false); setRenaming(null); } },
                  { label: "重命名目录", icon: <FileText size={12} />, shortcut: "R", onClick: () => { const f = skills.find(s => s.id === ctxMenu.fileId); if (f) { setRenaming(f.id); setRenameValue(baseName(f)); } } },
                  { label: "删除目录", icon: <Trash2 size={12} />, shortcut: "D", danger: true, onClick: () => handleDeleteDir(ctxMenu.fileId!) },
                ]
              : ctxMenu.fileId
              ? [
                  { label: "重命名", icon: <FileText size={12} />, shortcut: "R", onClick: () => { const f = skills.find(s => s.id === ctxMenu.fileId); if (f) { setRenaming(f.id); setRenameValue(baseName(f)); } } },
                  { label: "导出文件", icon: <Download size={12} />, onClick: () => handleExportFile(ctxMenu.fileId!) },
                  { label: "删除文件", icon: <Trash2 size={12} />, shortcut: "D", danger: true, onClick: () => handleDelete(ctxMenu.fileId!) },
                ]
              : [
                  { label: "新建技能文件", icon: <Plus size={12} />, onClick: handleNew },
                  { label: "新建文件夹", icon: <FolderPlus size={12} />, onClick: handleNewFolder },
                  { label: "导入文件", icon: <Upload size={12} />, onClick: () => fileInputRef.current?.click() },
                ]
          }
          onClose={() => setCtxMenu(null)} />
      )}

      <input ref={fileInputRef} type="file" accept=".md" onChange={handleImport} className="hidden" />

      {/* ── 拖拽浮动指示器 ── */}
      {draggingFile && dragPos && (
        <div style={{ position: 'fixed', left: dragPos.x + 12, top: dragPos.y - 8, pointerEvents: 'none', zIndex: 9999 }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-popover shadow-xl text-xs">
          <FileText size={13} className="shrink-0 text-muted-foreground/60" />
          <span className="font-medium text-foreground max-w-[180px] truncate">{draggingFile.replace(/^.*\//, '')}</span>
          <span className="text-[10px] text-muted-foreground/50 ml-1 px-1.5 py-0.5 rounded bg-muted leading-none">移动</span>
        </div>
      )}
    </section>
  );
}
