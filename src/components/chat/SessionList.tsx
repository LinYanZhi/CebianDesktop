import { Plus, MessageSquare, Trash2 } from "lucide-react";
import type { Conversation } from "../../lib/types";

interface SessionListProps {
  conversations: Conversation[];
  currentSessionId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export default function SessionList({
  conversations,
  currentSessionId,
  onSelect,
  onNew,
  onDelete,
}: SessionListProps) {
  return (
    <div className="flex flex-col h-full bg-gray-900/40">
      {/* 新建对话按钮 */}
      <div className="p-3">
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-gray-600/50 text-gray-400 hover:text-gray-200 hover:border-gray-500/50 hover:bg-gray-800/50 transition-all text-sm"
        >
          <Plus size={16} />
          <span>新建对话</span>
        </button>
      </div>

      {/* 对话列表 */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {conversations.length === 0 && (
          <p className="text-center text-gray-600 text-xs py-8 select-none">暂无对话</p>
        )}

        {conversations.map((conv) => {
          const isActive = conv.id === currentSessionId;
          return (
            <div
              key={conv.id}
              className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                isActive
                  ? "bg-blue-600/20 border border-blue-500/30"
                  : "hover:bg-gray-800/50 border border-transparent"
              }`}
              onClick={() => onSelect(conv.id)}
            >
              <MessageSquare
                size={16}
                className={`flex-shrink-0 ${isActive ? "text-blue-400" : "text-gray-500"}`}
              />
              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm truncate ${
                    isActive ? "text-blue-200" : "text-gray-300"
                  }`}
                >
                  {conv.title || "新对话"}
                </p>
                <p className="text-xs text-gray-600 mt-0.5">
                  {formatDate(conv.updatedAt)}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(conv.id);
                }}
                className="flex-shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-400 text-gray-600 transition-all"
                title="删除对话"
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
