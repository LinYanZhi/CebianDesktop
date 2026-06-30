import {
  FileCode, FileText, FileJson, File, FolderOpen, Folder, ChevronRight, ChevronDown,
  FilePlus, FileImage, FileArchive,
} from "lucide-react";
import type { WorkspaceFile } from "../../../lib/workspace";
import React from "react";

/** 文件扩展名 → lucide 图标 + 颜色（复制自 SkillsSection） */
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

// ─── 文件树工具函数 ──────────────────────────────────
function isDir(f: WorkspaceFile) { return f.filename.endsWith('/'); }
function baseName(f: WorkspaceFile) { return isDir(f) ? f.id.replace(/.*\//, '') : f.filename.replace(/.*\//, ''); }
function dirOf(f: WorkspaceFile): string {
  const p = f.filename.endsWith('/') ? f.id : f.filename;
  const idx = p.lastIndexOf('/');
  return idx > 0 ? p.slice(0, idx) : '';
}

export interface SkillFileTreeProps {
  visibleItems: { item: WorkspaceFile; depth: number }[];
  expanded: Set<string>;
  selected: Set<string>;
  searchQuery: string;
  dirtyMap: Record<string, boolean>;
  renaming: string | null;
  renameValue: string;
  renameError: string | null;
  creatingFile: boolean;
  creatingFolder: boolean;
  createValue: string;
  createError: string | null;
  dragOverDir: string | null;
  treeContainerRef: React.RefObject<HTMLDivElement>;
  renameInputRef: React.RefObject<HTMLInputElement>;
  createInputRef: React.RefObject<HTMLInputElement>;

  onToggleDir: (dirId: string) => void;
  onToggleSelect: (filename: string, ctrl: boolean, shift: boolean) => void;
  onSelectFile: (filename: string) => void;
  onPointerDown: (e: React.PointerEvent, filename: string) => void;
  onSetRenaming: (id: string | null) => void;
  onSetRenameValue: (v: string) => void;
  onSetRenameError: (err: string | null) => void;
  onRename: (id: string, newName: string) => Promise<void>;
  onSetCreatingFile: (v: boolean) => void;
  onSetCreatingFolder: (v: boolean) => void;
  onSetCreateValue: (v: string) => void;
  onSetCreateError: (err: string | null) => void;
  onConfirmCreateFile: (name: string) => Promise<void>;
  onConfirmCreateFolder: (name: string) => Promise<void>;
  onSetCurrentDir: (v: string) => void;
  onSetCtxMenu: (menu: { x: number; y: number; fileId?: string; isDir?: boolean } | null) => void;
  onSetSelected: (selected: Set<string>) => void;
}

export function SkillFileTree(props: SkillFileTreeProps) {
  const {
    visibleItems,
    expanded: expandedDirs,
    selected: selectedFilenames,
    searchQuery: search,
    dirtyMap,
    renaming,
    renameValue,
    renameError,
    creatingFile,
    creatingFolder,
    createValue,
    createError,
    dragOverDir,
    treeContainerRef,
    renameInputRef,
    createInputRef,

    onToggleDir: toggleDir,
    onToggleSelect: toggleSelect,
    onSelectFile: selectFile,
    onPointerDown: handlePointerDown,
    onSetRenaming: setRenaming,
    onSetRenameValue: setRenameValue,
    onSetRenameError: setRenameError,
    onRename: handleRename,
    onSetCreatingFile: setCreatingFile,
    onSetCreatingFolder: setCreatingFolder,
    onSetCreateValue: setCreateValue,
    onSetCreateError: setCreateError,
    onConfirmCreateFile: confirmCreateFile,
    onConfirmCreateFolder: confirmCreateFolder,
    onSetCurrentDir: setCurrentDir,
    onSetCtxMenu: setCtxMenu,
    onSetSelected: setSelectedFilenames,
  } = props;

  return (
    <>
      {/* 文件树 */}
      <div ref={treeContainerRef} className="flex-1 overflow-y-auto p-1 space-y-0.5"
        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
        onPointerDown={(e) => { if (e.target === e.currentTarget) { setCurrentDir(""); setSelectedFilenames(new Set()); } }}>
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
            {createError && <span className="text-[10px] text-red-500 whitespace-nowrap shrink-0">{createError}</span>}
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
            {createError && <span className="text-[10px] text-red-500 whitespace-nowrap shrink-0">{createError}</span>}
          </div>
        )}
        {visibleItems.length === 0 && !creatingFile && !creatingFolder ? (
          <p className="text-[11px] text-muted-foreground text-center py-8">{search ? "无匹配" : "空目录"}</p>
        ) : (
          visibleItems.map(({ item: s, depth }) => {
            const selected = selectedFilenames.has(s.filename);
            return (
              <div key={s.id}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, fileId: s.filename, isDir: isDir(s) }); }}>
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
                    {renameError && <span className="text-[10px] text-red-500 whitespace-nowrap shrink-0">{renameError}</span>}
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
                    onClick={(e) => { toggleSelect(s.filename, e.ctrlKey || e.metaKey, e.shiftKey); selectFile(s.filename); setCurrentDir(dirOf(s)); }}
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
    </>
  );
}
