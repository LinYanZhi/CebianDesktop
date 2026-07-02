import { useState } from "react";
import { AlertTriangle, ShieldAlert, FileCode, ChevronDown, ChevronRight, Bot } from "lucide-react";

// ─── 内联确认表单（替代模态弹窗）─────────────────────────────
// 嵌入消息列表，类似 AskUserBlock 的渲染方式

export function ConfirmationBlock({
  details,
  aiExplanation,
  onConfirm,
  onCancel,
}: {
  details: {
    action: string;
    target: string;
    risk: string;
    description: string;
    args_detail: string;
  };
  aiExplanation?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const isHighRisk = details.risk === "high";

  const handleConfirm = () => {
    setConfirming(true);
    onConfirm();
  };

  const handleCancel = () => {
    setConfirming(true);
    onCancel();
  };

  return (
    <div className="my-3 rounded-xl border bg-card shadow-sm overflow-hidden animate-form-enter">
      {/* ── 头部：风险标签 + 操作名称 ── */}
      <div className="px-4 pt-4 pb-1 flex items-start gap-3">
        <div
          className={`shrink-0 size-9 rounded-full flex items-center justify-center ${
            isHighRisk ? "bg-red-500/10" : "bg-amber-500/10"
          }`}
        >
          {isHighRisk ? (
            <ShieldAlert size={16} className="text-red-500" />
          ) : (
            <AlertTriangle size={16} className="text-amber-500" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground">
              确认{details.action}
            </h3>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.6rem] font-medium border ${
                isHighRisk
                  ? "bg-red-500/10 text-red-500 border-red-500/20"
                  : "bg-amber-500/10 text-amber-500 border-amber-500/20"
              }`}
            >
              {isHighRisk ? "高风险" : "中风险"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            需要你确认后方可执行
          </p>
        </div>
      </div>

      {/* ── AI 说明（Agent 对话气泡风格） ── */}
      {aiExplanation && (
        <div className="mx-4 mt-4">
          <div className="flex items-start gap-2.5">
            <div className="shrink-0 size-7 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
              <Bot size={14} className="text-primary" />
            </div>
            <div
              className={`flex-1 text-sm rounded-xl px-4 py-3 leading-relaxed ${
                isHighRisk
                  ? "bg-red-500/5 border border-red-500/15"
                  : "bg-amber-500/5 border border-amber-500/15"
              }`}
            >
              <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">
                Cebian Agent
              </p>
              <p className="whitespace-pre-wrap text-foreground/90">
                {aiExplanation}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── 操作描述 ── */}
      <div className="px-4 mt-4">
        <p className="text-xs text-muted-foreground mb-1.5">将要执行的操作</p>
        <div className="text-sm bg-muted/40 border border-border/50 rounded-xl px-4 py-3">
          <p className="whitespace-pre-wrap leading-relaxed text-foreground/85">
            {details.description}
          </p>
        </div>
      </div>

      {/* ── 目标对象 ── */}
      <div className="px-4 mt-3">
        <p className="text-xs text-muted-foreground mb-1.5">操作目标</p>
        <pre className="text-sm font-mono bg-muted rounded-xl px-4 py-3 break-all whitespace-pre-wrap border border-border/50 leading-relaxed">
          {details.target}
        </pre>
      </div>

      {/* ── 详细参数（可折叠） ── */}
      {details.args_detail && (
        <div className="px-4 mt-3">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showDetails ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span className="text-[0.65rem]">{showDetails ? "收起" : "展开"}技术细节</span>
            <FileCode size={10} className="ml-0.5 opacity-60" />
          </button>
          {showDetails && (
            <pre className="text-[0.7rem] font-mono bg-muted rounded-xl px-4 py-3 mt-2 max-h-52 overflow-auto border border-border/50 leading-relaxed">
              {details.args_detail}
            </pre>
          )}
        </div>
      )}

      {/* ── 操作按钮 ── */}
      <div className="px-4 pb-4 mt-4 flex items-center gap-2">
        <button
          onClick={handleConfirm}
          disabled={confirming}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            isHighRisk
              ? "bg-red-500 hover:bg-red-600"
              : "bg-amber-500 hover:bg-amber-600"
          }`}
        >
          {confirming ? "处理中..." : "确认运行"}
        </button>
        <button
          onClick={handleCancel}
          disabled={confirming}
          className="px-4 py-1.5 rounded-lg text-sm border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          取消
        </button>
      </div>
    </div>
  );
}
