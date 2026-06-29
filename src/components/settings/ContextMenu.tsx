import { useEffect } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  onClick: () => void;
  danger?: boolean;
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: ContextMenuItem[]; onClose: () => void }) {
  useEffect(() => {
    const handler = () => onClose();
    window.addEventListener("scroll", handler, true);
    return () => window.removeEventListener("scroll", handler, true);
  }, [onClose]);

  // 键盘快捷键：菜单打开时按对应键触发
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const item = items.find(i => i.shortcut?.toLowerCase() === key);
      if (item) { e.preventDefault(); item.onClick(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[9999]" onClick={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div className="absolute bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[140px] z-50"
        style={{ left: x, top: y }}>
        {items.map((item, i) => (
          <button key={i} onClick={() => { item.onClick(); onClose(); }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${item.danger ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-accent"}`}>
            {item.icon && <span className="shrink-0">{item.icon}</span>}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && <span className="text-[10px] text-muted-foreground/50 ml-4 px-1.5 py-0.5 rounded bg-muted leading-none">{item.shortcut}</span>}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
