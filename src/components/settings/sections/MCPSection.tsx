import { useState, useEffect } from "react";
import { toast } from "sonner";
import { loadMcpConfig, connectMcpServer, disconnectMcpServer } from "../../../lib/mcp";
import type { McpServerConfig } from "../../../lib/mcp";

export function MCPSection({ port, running, onStart, onStop, onPortChange }: {
  port: number; running: boolean;
  onStart: () => void; onStop: () => void; onPortChange: (p: number) => void;
}) {
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [connectedServers, setConnectedServers] = useState<string[]>([]);
  const [editingServer, setEditingServer] = useState<McpServerConfig | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadMcpConfig().then(setMcpServers).catch(() => {});
    import("../../../lib/mcp").then(m => m.listMcpConnections().then(setConnectedServers).catch(() => {}));
  }, []);

  const handleAddServer = () => {
    setEditingServer({ name: "", command: "", args: [], auto_start: false });
  };

  const handleConnect = async (s: McpServerConfig) => {
    setLoading(true);
    try {
      await connectMcpServer(s.name, s.command, s.args);
      setConnectedServers(prev => [...prev.filter(n => n !== s.name), s.name]);
      toast.success(`已连接 ${s.name}`);
    } catch (e: any) {
      toast.error("连接失败: " + (e?.toString() || "未知错误"));
    } finally { setLoading(false); }
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

        {editingServer ? (
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <input type="text" value={editingServer.name}
              onChange={(e) => setEditingServer({ ...editingServer, name: e.target.value })}
              placeholder="服务器名称"
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm outline-none focus:border-ring" />
            <input type="text" value={editingServer.command}
              onChange={(e) => setEditingServer({ ...editingServer, command: e.target.value })}
              placeholder="启动命令"
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm outline-none focus:border-ring" />
            <input type="text" value={editingServer.args.join(" ")}
              onChange={(e) => setEditingServer({ ...editingServer, args: e.target.value.split(/\s+/).filter(Boolean) })}
              placeholder="参数（空格分隔）"
              className="w-full bg-background border border-input rounded-lg px-3 py-2 text-sm outline-none focus:border-ring" />
            <div className="flex gap-2">
              <button onClick={addServerToList}
                className="px-4 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium">添加</button>
              <button onClick={() => setEditingServer(null)}
                className="px-4 py-1.5 border border-input rounded-lg text-xs text-muted-foreground">取消</button>
            </div>
          </div>
        ) : (
          <button onClick={handleAddServer}
            className="w-full py-2 border border-dashed border-input rounded-lg text-xs text-muted-foreground hover:text-foreground hover:border-ring transition-colors">
            + 添加 MCP 服务器
          </button>
        )}
      </div>
    </section>
  );
}
