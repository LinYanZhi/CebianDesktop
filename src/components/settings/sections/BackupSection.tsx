import { useState, useRef } from "react";
import { Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { exportBackup, importBackup } from "../../../lib/workspace";

export function BackupSection() {
  const [backingUp, setBackingUp] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setBackingUp(true);
    try {
      const base64 = await exportBackup();
      const byteChars = atob(base64);
      const bytes = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `cebian-backup-${Date.now()}.zip`; a.click();
      URL.revokeObjectURL(url);
      toast.success("备份导出成功");
    } catch (e: any) {
      toast.error("导出失败: " + (e?.toString() || "未知错误"));
    } finally { setBackingUp(false); }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const arrayBuf = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
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
      <p className="text-sm text-muted-foreground mb-4">导出备份包含：工作区文件（提示词、技能）、对话记录、AI 配置、MCP 配置。</p>
      <div className="flex gap-3">
        <button onClick={handleExport} disabled={backingUp}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50">
          <Download size={14} />{backingUp ? "导出中..." : "导出备份"}
        </button>
        <button onClick={() => fileInputRef.current?.click()} disabled={importing}
          className="flex items-center gap-1.5 px-4 py-2 bg-background border border-input rounded-lg text-xs font-medium text-muted-foreground hover:border-ring disabled:opacity-50">
          <Upload size={14} />{importing ? "导入中..." : "导入恢复"}
        </button>
        <input ref={fileInputRef} type="file" accept=".zip" onChange={handleImport} className="hidden" />
      </div>
    </section>
  );
}
