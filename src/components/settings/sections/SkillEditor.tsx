import { FileCode } from "lucide-react";
import { useState, useRef } from "react";
import type { WorkspaceFile } from "../../../lib/workspace";
import { CodeMirrorEditor } from "../../editor/CodeMirrorEditor";

interface SkillEditorProps {
  editing: WorkspaceFile | null;
  fileIcon: (filename: string) => { icon: any; color: string };
  onContentChange: (val: string) => void;
}

export function SkillEditor({ editing, fileIcon, onContentChange }: SkillEditorProps) {
  const [fontSize, setFontSize] = useState(13);
  const [fontTip, setFontTip] = useState(false);
  const fontTipTimer = useRef<ReturnType<typeof setTimeout>>();

  const showFontTip = () => {
    setFontTip(true);
    if (fontTipTimer.current) clearTimeout(fontTipTimer.current);
    fontTipTimer.current = setTimeout(() => setFontTip(false), 1200);
  };

  if (!editing) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground bg-background min-w-0">
        <div className="text-center">
          <FileCode size={36} className="mx-auto mb-2 opacity-20" />
          <p>选择一个技能文件开始编辑</p>
        </div>
      </div>
    );
  }

  return (
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
          onChange={onContentChange}
          language={editing.filename.endsWith('.js') || editing.filename.endsWith('.ts') ? 'javascript' : editing.filename.endsWith('.yaml') || editing.filename.endsWith('.yml') ? 'yaml' : 'markdown'}
          placeholder="在此编写技能定义（Markdown/代码格式）..."
          fontSize={`${fontSize}px`} />
        {/* 字体大小浮动提示 */}
        <div className={`absolute bottom-3 right-3 z-20 px-2.5 py-1 rounded-md bg-popover border border-border shadow-lg text-xs font-mono transition-opacity duration-200 pointer-events-none ${fontTip ? 'opacity-100' : 'opacity-0'}`}>
          {fontSize}px
        </div>
      </div>
    </div>
  );
}
