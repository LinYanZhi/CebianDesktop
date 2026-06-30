import { listen } from "@tauri-apps/api/event";
import { useState, useRef, useEffect } from "react";
import {
  FileCode, FileText, FileJson, File, Search, FilePlus, FolderPlus, MoreHorizontal, Download,
  FolderOpen, Trash2, Plus, FileImage, FileArchive,
} from "lucide-react";
import { toast } from "sonner";
import { listWorkspaceFiles, writeWorkspaceFile, deleteWorkspaceFile, renameWorkspaceFile,
  exportWorkspaceFileContent, openWorkspaceDir, openFileLocation, getWorkspaceFilePath,
  createWorkspaceSubdir, deleteWorkspaceSubdir, moveWorkspaceFile,
  exportWorkspaceZipToPath, importWorkspaceZipPath,
} from "../../../lib/workspace";
import { save, open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceFile } from "../../../lib/workspace";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { SkillFileTree } from "./SkillFileTree";
import { SkillEditor } from "./SkillEditor";

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
  // ─── 重命名/新建错误提示 ──────────────────────────
  const [renameError, setRenameError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createDirContext, setCreateDirContext] = useState<string>("");
  const [currentDir, setCurrentDir] = useState<string>(""); // 当前工作目录（点击空白=根，点击目录=目录，点击文件=父目录）
  const [search, setSearch] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; fileId?: string; isDir?: boolean } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(240);
  const [dragOverDir, setDragOverDir] = useState<string | null>(null);
  const [draggingFile, setDraggingFile] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const dragFileRef = useRef<string | null>(null);
  const dragFilesRef = useRef<string[]>([]);
  const dragDirRef = useRef<string | null>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const dragActiveRef = useRef(false); // 是否超过阈值进入拖拽模式
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const loadVersionRef = useRef(0); // 防过期加载
  const draftCacheRef = useRef<Record<string, string>>({}); // 未保存的编辑内容（filename → content）

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
    dragFilesRef.current = selectedFilenames.has(filename)
      ? Array.from(selectedFilenames)
      : [filename];
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
      const fileIds = dragFilesRef.current.slice();
      // 清理所有状态
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
      dragFileRef.current = null;
      dragFilesRef.current = [];
      dragDirRef.current = null;
      dragStartPos.current = null;
      dragActiveRef.current = false;
      setDragOverDir(null);
      setDraggingFile(null);
      setDragPos(null);
      // 没超过阈值 → 纯点击，不执行移动
      if (!isDragging || fileIds.length === 0) return;
      // 鼠标释放位置检测目标目录
      let el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      while (el && el !== container && !el.hasAttribute('data-dir-id')) {
        el = el.parentElement;
      }
      const targetDir = el?.getAttribute('data-dir-id') || '';
      // 批量移动
      for (const fid of fileIds) {
        try {
          await moveWorkspaceFile("skills", fid, targetDir);
        } catch (err: any) {
          toast.error(`移动 ${fid} 失败: ${err?.toString()}`);
        }
      }
      if (fileIds.length > 1) toast.success(`已移动 ${fileIds.length} 个文件`);
      await load();
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

  const selectFile = (filename: string) => {
    // 保存当前正在编辑的未保存内容到草稿缓存
    if (editing && dirtyMap[editing.id]) {
      draftCacheRef.current[editing.filename] = editing.content;
    }
    // 加载新文件，优先取草稿缓存中的内容
    const file = skills.find(s => s.filename === filename);
    if (file) {
      const content = filename in draftCacheRef.current ? draftCacheRef.current[filename] : file.content;
      setEditing({ ...file, content });
    }
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
      setCreateError("文件已存在");
      setCreatingFile(true);
      return;
    }
    await writeWorkspaceFile("skills", fullName, trimmed.replace(/\.\w+$/, ''), "", "");
    const list = await load();
    const file = list.find(s => s.filename === fullName);
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
      setCreateError("目录已存在");
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
    // 只有 .md 文件需要校验技能名称（其他文件没有 frontmatter）
    if (editing.id.endsWith('.md') && !editing.name.trim()) { toast.error("请输入技能名称"); return; }
    try {
      await writeWorkspaceFile("skills", editing.id, editing.name, editing.description, editing.content);
      toast.success("保存成功");
      setDirtyMap(prev => ({ ...prev, [editing.id]: false }));
      delete draftCacheRef.current[editing.filename];
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
      if (file) {
        delete draftCacheRef.current[file.filename];
        if (selectedFilenames.has(file.filename)) { setEditing(null); setDirtyMap(prev => ({ ...prev, [id]: false })); }
      }
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
      setRenameError("文件名已存在");
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

  // ─── 导出 ──────────────────────────────────────────────
  /** 导出选中文件为 ZIP —— 让用户选择保存路径 */
  const handleExportSelectedZip = async (ids: string[]) => {
    const filePath = await save({
      defaultPath: `skills-${Date.now()}.zip`,
      filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }],
    });
    if (!filePath) return;
    try {
      await exportWorkspaceZipToPath("skills", ids, filePath);
      toast.success("ZIP 导出成功");
    } catch (e: any) {
      toast.error("ZIP 导出失败: " + (e?.toString() || "未知错误"));
    }
  };

  /** 全部导出为 ZIP */
  const handleExportAllZip = async () => {
    await handleExportSelectedZip([]);
  };

  // ─── 导入 ──────────────────────────────────────────────
  /** 导入 ZIP 文件 —— 让用户选择路径 */
  const handleImportZip = async () => {
    const filePath = await open({
      multiple: false,
      title: "选择要导入的 ZIP 文件",
      filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }],
    });
    if (!filePath) return;
    try {
      const count = await importWorkspaceZipPath("skills", filePath);
      toast.success(`ZIP 导入成功，共 ${count} 个文件`);
      await load();
    } catch (e: any) {
      toast.error("ZIP 导入失败: " + (e?.toString() || "未知错误"));
    }
  };


  /** 另存为：将文件拷贝到选择的目录（散装复制） */
  const handleSaveAs = async (ids: string[]) => {
    const dir = await open({ directory: true, multiple: false, title: "选择目标目录" });
    if (!dir) return;
    let count = 0;
    for (const id of ids) {
      try {
        const file = skills.find(s => s.id === id);
        if (!file) continue;
        const raw = await exportWorkspaceFileContent("skills", id);
        const filename = file.filename.replace(/\//g, '_');
        await invoke("write_file_to_path", { path: `${dir}\\${filename}`, content: raw });
        count++;
      } catch (e: any) {
        toast.error(`另存为 ${id} 失败: ${e?.toString()}`);
      }
    }
    if (count > 0) toast.success(`已将 ${count} 个文件另存到目标目录`);
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
                  <div className="absolute right-0 top-full mt-1 z-50 w-32 bg-popover border border-border rounded-lg shadow-lg py-1 text-xs">
                    <button onClick={() => { setMoreOpen(false); handleExportAllZip(); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-left">
                      <Download size={12} /> 导出
                    </button>
                    <button onClick={() => { setMoreOpen(false); handleImportZip(); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-left">
                      <FileArchive size={12} /> 导入
                    </button>
                    <button onClick={() => { setMoreOpen(false); openWorkspaceDir("skills"); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors text-left">
                      <FolderOpen size={12} /> 打开目录
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <SkillFileTree
            visibleItems={visibleItems}
            expanded={expandedDirs}
            selected={selectedFilenames}
            searchQuery={search}
            dirtyMap={dirtyMap}
            renaming={renaming}
            renameValue={renameValue}
            renameError={renameError}
            creatingFile={creatingFile}
            creatingFolder={creatingFolder}
            createValue={createValue}
            createError={createError}
            dragOverDir={dragOverDir}
            treeContainerRef={treeContainerRef}
            renameInputRef={renameInputRef}
            createInputRef={createInputRef}
            onToggleDir={toggleDir}
            onToggleSelect={toggleSelect}
            onSelectFile={selectFile}
            onPointerDown={handlePointerDown}
            onSetRenaming={setRenaming}
            onSetRenameValue={setRenameValue}
            onSetRenameError={setRenameError}
            onRename={handleRename}
            onSetCreatingFile={setCreatingFile}
            onSetCreatingFolder={setCreatingFolder}
            onSetCreateValue={setCreateValue}
            onSetCreateError={setCreateError}
             onConfirmCreateFile={confirmCreateFile}
            onConfirmCreateFolder={confirmCreateFolder}
            onSetCurrentDir={setCurrentDir}
            onSetCtxMenu={setCtxMenu}
            onSetSelected={setSelectedFilenames}
          />
        </div>

        {/* 拖拽手柄 */}
        <div onMouseDown={handleMouseDown}
          className="w-[3px] shrink-0 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors relative z-10">
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>

        <SkillEditor
          editing={editing}
          fileIcon={fileIcon}
          onContentChange={(val) => { if (editing) { setEditing({ ...editing, content: val }); draftCacheRef.current[editing.filename] = val; setDirtyMap(prev => ({ ...prev, [editing.id]: true })); } }}
        />
      </div>

      {/* ── 右键菜单 ── */}
      {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y}
          items={
            ctxMenu.isDir
            ? (() => {
                const dirName = ctxMenu.fileId!.replace(/\/$/, '');
                return [
                  { label: "在此目录新建文件", icon: <Plus size={12} />, onClick: () => { setCtxMenu(null); setCreateDirContext(dirName); setCreatingFile(true); setCreatingFolder(false); setRenaming(null); } },
                  { label: "新建子目录", icon: <FolderPlus size={12} />, onClick: () => { setCtxMenu(null); setCreateDirContext(dirName); setCreatingFolder(true); setCreatingFile(false); setRenaming(null); } },
                  { label: "重命名目录", icon: <FileText size={12} />, shortcut: "R", onClick: () => { setCtxMenu(null); const f = skills.find(s => s.filename === ctxMenu.fileId); if (f) { setRenaming(f.id); setRenameValue(baseName(f)); } } },
                  { label: "删除目录", icon: <Trash2 size={12} />, shortcut: "D", danger: true, onClick: () => { setCtxMenu(null); handleDeleteDir(dirName); } },
                ];
              })()
            : ctxMenu.fileId && selectedFilenames.has(ctxMenu.fileId) && selectedFilenames.size > 1
            ? (() => {
                const names = Array.from(selectedFilenames);
                const files = names.map(n => skills.find(s => s.filename === n)).filter(Boolean) as WorkspaceFile[];
                const ids = files.map(f => f.id);
                const copyPaths = async () => {
                  const paths = await Promise.all(ids.map(id => getWorkspaceFilePath("skills", id)));
                  await navigator.clipboard.writeText(paths.join('\n'));
                  toast.success("路径已复制");
                };
                return [
                  { label: `导出选中的 ${files.length} 个文件`, icon: <Download size={12} />, onClick: () => { setCtxMenu(null); handleExportSelectedZip(ids); } },
                  { label: "另存为...", icon: <FolderOpen size={12} />, onClick: () => { setCtxMenu(null); handleSaveAs(ids); } },
                  { label: "复制路径", icon: <FileText size={12} />, shortcut: "C", onClick: () => { setCtxMenu(null); copyPaths(); } },
                ] as ContextMenuItem[];
              })()
            : ctxMenu.fileId
            ? (() => {
                const f = skills.find(s => s.filename === ctxMenu.fileId);
                const fid = f?.id;
                return [
                  { label: "重命名", icon: <FileText size={12} />, shortcut: "R", onClick: () => { setCtxMenu(null); if (f) { setRenaming(f.id); setRenameValue(baseName(f)); } } },
                  { label: "另存为", icon: <FolderOpen size={12} />, onClick: () => { setCtxMenu(null); if (fid) handleSaveAs([fid]); } },
                  { label: "打开位置", icon: <FolderOpen size={12} />, shortcut: "O", onClick: () => { setCtxMenu(null); if (fid) openFileLocation("skills", fid); } },
                  { label: "复制路径", icon: <FileText size={12} />, shortcut: "C", onClick: async () => { setCtxMenu(null); if (fid) { const p = await getWorkspaceFilePath("skills", fid); await navigator.clipboard.writeText(p); toast.success("路径已复制"); } } },
                  { label: "删除文件", icon: <Trash2 size={12} />, shortcut: "D", danger: true, onClick: () => { setCtxMenu(null); if (fid) handleDelete(fid); } },
                ];
              })()
            : [
                { label: "新建文件", icon: <Plus size={12} />, onClick: () => { setCtxMenu(null); handleNew(); } },
                { label: "新建文件夹", icon: <FolderPlus size={12} />, onClick: () => { setCtxMenu(null); handleNewFolder(); } },
                { label: "打开目录", icon: <FolderOpen size={12} />, onClick: () => { setCtxMenu(null); openWorkspaceDir("skills"); } },
              ]
          }
          onClose={() => setCtxMenu(null)} />}

      {/* ── 拖拽浮动指示器 ── */}
      {draggingFile && dragPos && (
        <div style={{ position: 'fixed', left: dragPos.x + 12, top: dragPos.y - 8, pointerEvents: 'none', zIndex: 9999 }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-popover shadow-xl text-xs">
          <FileText size={13} className="shrink-0 text-muted-foreground/60" />
          <span className="font-medium text-foreground max-w-[180px] truncate">
            {draggingFile.replace(/^.*\//, '')}
            {dragFilesRef.current.length > 1 && <span className="ml-1 text-muted-foreground/60">+{dragFilesRef.current.length - 1}</span>}
          </span>
          <span className="text-[10px] text-muted-foreground/50 ml-1 px-1.5 py-0.5 rounded bg-muted leading-none">移动</span>
        </div>
      )}
    </section>
  );
}
