import { useState, useEffect, useRef, useCallback } from "react";
import { Paperclip, Image, FileText, FileSpreadsheet, Mic, Square, ArrowUp, X } from "lucide-react";
import type { AIConfig, SendAttachment } from "../../lib/types";
import { getActiveConfig } from "../../lib/types";
import { listPrompts, replaceTemplateVars } from "../../lib/prompts";
import type { Prompt } from "../../lib/prompts";
import { useSpeechRecognition } from "../../lib/useSpeechRecognition";
import { toast } from "sonner";
import { generateId } from "./chat-types";
import { ModelSelector, ThinkingLevelSelector } from "./ModelSelector";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

// ═══════════════════════════════════════════════════════════
//  附件 Chips
// ═══════════════════════════════════════════════════════════

function AttachmentChips({
  attachments, onRemove
}: {
  attachments: SendAttachment[]; onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 px-4 pt-2">
      {attachments.map(att => (
        <div key={att.id}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-accent/50 border border-border text-xs text-muted-foreground max-w-48"
        >
          {att.type === "image" ? <Image size={12} /> : att.path ? <FileSpreadsheet size={12} /> : <FileText size={12} />}
          <span className="truncate flex-1">{att.name}</span>
          <button onClick={() => onRemove(att.id)}
            className="p-0.5 rounded hover:bg-accent hover:text-foreground transition-colors shrink-0"
          >
            <X size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
//  输入栏
// ═══════════════════════════════════════════════════════════

export function ChatInput({
  inputValue, setInputValue, onSend, onStop, loading, aiConfig, incomingAttachments, onConfigChange, onNavigateSettings,
}: {
  inputValue: string; setInputValue: (v: string) => void;
  onSend: (attachments: SendAttachment[]) => void; onStop: () => void; loading: boolean;
  aiConfig: AIConfig; incomingAttachments?: SendAttachment[] | null; onConfigChange: (c: AIConfig) => void; onNavigateSettings: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const [attachments, setAttachments] = useState<SendAttachment[]>([]);

  // 接收来自外部的附件（回滚恢复 chip），合并到内部状态
  const incomingKeyRef = useRef(0);
  useEffect(() => {
    if (incomingAttachments) {
      setAttachments(incomingAttachments);
      incomingKeyRef.current += 1;
    }
  }, [incomingAttachments]);

  // ── Slash Prompts ──
  const [showSlash, setShowSlash] = useState(false);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selectedPromptIdx, setSelectedPromptIdx] = useState(0);

  // ── Speech Recognition ──
  // 语音识别到的文本在 textarea 中的 range（start/end 字符索引）
  // 每次 interim 更新时，替换这个 range 内的文本，而非覆盖整个 textarea
  const voiceRangeRef = useRef<{start: number; end: number} | null>(null);
  const lastVoiceTextRef = useRef("");
  const speech = useSpeechRecognition(
    undefined,
    (speechText) => {
      const el = textareaRef.current;
      if (!el) return;

      const currentValue = el.value;
      const cursorPos = el.selectionStart;

      let newValue: string;
      let newCursorPos: number;

      if (voiceRangeRef.current === null) {
        // 首次语音结果：在光标位置插入
        newValue = currentValue.slice(0, cursorPos) + speechText + currentValue.slice(cursorPos);
        newCursorPos = cursorPos + speechText.length;
        voiceRangeRef.current = { start: cursorPos, end: newCursorPos };
      } else {
        const { start, end } = voiceRangeRef.current;
        // 检查语音 range 中的文本是否仍是上次的语音文本（用户可能手动编辑过）
        if (start <= currentValue.length && currentValue.slice(start, Math.min(end, currentValue.length)) === lastVoiceTextRef.current) {
          // range 有效：替换旧语音文本
          newValue = currentValue.slice(0, start) + speechText + currentValue.slice(end);
          newCursorPos = start + speechText.length;
          voiceRangeRef.current = { start, end: newCursorPos };
        } else {
          // range 失效（用户编辑过）：在当前光标位置重新插入
          newValue = currentValue.slice(0, cursorPos) + speechText + currentValue.slice(cursorPos);
          newCursorPos = cursorPos + speechText.length;
          voiceRangeRef.current = { start: cursorPos, end: newCursorPos };
        }
      }

      lastVoiceTextRef.current = speechText;
      setInputValue(newValue);

      // React 重渲染后恢复光标到语音文本末尾
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = newCursorPos;
      });
    },
    "zh-CN",
  );

  // 扫描提示词（输入 / 时触发）
  useEffect(() => {
    if (!showSlash) return;
    listPrompts().then(setPrompts).catch(() => setPrompts([]));
  }, [showSlash]);

  // 键盘导航
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlash && prompts.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedPromptIdx((i) => (i + 1) % prompts.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedPromptIdx((i) => (i - 1 + prompts.length) % prompts.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const target = prompts[selectedPromptIdx];
        if (target) handleSelectPrompt(target);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSlash(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 选择 prompt
  const handleSelectPrompt = async (prompt: Prompt) => {
    try {
      const filled = await replaceTemplateVars(prompt.content);
      setInputValue(filled);
      setShowSlash(false);
      textareaRef.current?.focus();
    } catch {
      toast.error("读取提示词失败");
    }
  };

  // 过滤
  const slashFilter = inputValue.startsWith("/") ? inputValue.slice(1).toLowerCase() : "";
  const filteredPrompts = slashFilter
    ? prompts.filter((p) => p.name.toLowerCase().includes(slashFilter) || p.description.toLowerCase().includes(slashFilter))
    : prompts;
  const isSlashVisible = showSlash && (slashFilter === "" || filteredPrompts.length > 0);

  // 高亮索引随列表变化重置
  useEffect(() => {
    setSelectedPromptIdx(0);
  }, [filteredPrompts.length]);

  // 自动增高
  const adjustHeight = useCallback(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + "px";
  }, []);

  // 文件上传 — 使用 Tauri 原生对话框选择本地文件
  const handleFilePick = async () => {
    try {
      const selected = await open({
        multiple: true,
        title: "选择文件",
        filters: [{
          name: "文档",
          extensions: ["txt", "xlsx", "xls"]
        }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const filePath of paths) {
        const name = filePath.replace(/^.*[\\/]/, '');
        setAttachments(prev => [...prev, {
          id: generateId(),
          type: 'file',
          name,
          mimeType: name.endsWith('.txt') ? 'text/plain' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          path: filePath,
        }]);
      }
    } catch (err) {
      toast.error("选择文件失败: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // keep for backward compatibility (images from clipboard may also land here)
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      const isImage = file.type.startsWith("image/");
      const data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      setAttachments(prev => [...prev, {
        id: generateId(),
        type: isImage ? "image" : "file",
        name: file.name,
        mimeType: file.type,
        data,
        size: file.size,
      }]);
    }
    e.target.value = "";
  };

  // 粘贴图片
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          const reader = new FileReader();
          reader.onload = () => {
            setAttachments(prev => [...prev, {
              id: generateId(),
              type: "image",
              name: `粘贴的图片 - ${file.name}`,
              mimeType: file.type,
              data: reader.result as string,
              size: file.size,
            }]);
          };
          reader.readAsDataURL(file);
        }
      }
      // 处理粘贴的文本文件（仅 .txt，读取文本内容插入输入框）
      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        for (const file of Array.from(files)) {
          if (file.type.startsWith("image/")) continue; // 已在上方处理
          const ext = file.name.split('.').pop()?.toLowerCase();
          if (ext === 'txt') {
            e.preventDefault();
            file.text().then(text => {
              const el = textareaRef.current;
              if (!el) return;
              const start = el.selectionStart;
              const end = el.selectionEnd;
              const newVal = inputValue.slice(0, start) + text + inputValue.slice(end);
              setInputValue(newVal);
              requestAnimationFrame(() => {
                el.focus();
                el.selectionStart = el.selectionEnd = start + text.length;
              });
            });
          }
          // .xlsx/.xls 不支持粘贴（浏览器剪贴板 API 不暴露文件路径），
          // 请使用拖拽文件到输入框或点击附件按钮选择
        }
      }
    };
    el.addEventListener("paste", handler);
    return () => el.removeEventListener("paste", handler);
  }, [inputValue, setInputValue]);

  // 拖拽文件 — Tauri 原生拖拽事件获取文件路径
  const [isDragOver, setIsDragOver] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const win = getCurrentWebviewWindow();
    const unlisten = win.onDragDropEvent((event) => {
      if (cancelled) return;
      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        setIsDragOver(true);
      } else if (event.payload.type === 'leave') {
        setIsDragOver(false);
      } else if (event.payload.type === 'drop') {
        setIsDragOver(false);
        for (const path of event.payload.paths) {
          const name = path.replace(/^.*[\\/]/, '');
          const ext = name.split('.').pop()?.toLowerCase();
          if (ext === 'txt' || ext === 'xlsx' || ext === 'xls') {
            setAttachments(prev => [...prev, {
              id: generateId(),
              type: 'file',
              name,
              mimeType: ext === 'txt' ? 'text/plain' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              path,
            }]);
          }
        }
      }
    });
    return () => { cancelled = true; unlisten.then(fn => fn()); };
  }, []);

  // 清除附件
  const removeAttachment = (id: string) => setAttachments(prev => prev.filter(a => a.id !== id));

  // 模型选择
  const handleModelSelect = (providerId: string, model: string) => {
    onConfigChange({
      ...aiConfig,
      providers: aiConfig.providers.map(p => p.id === providerId ? { ...p, selectedModel: model } : p),
    });
  };

  // 发送
  const handleSend = () => {
    if (!inputValue.trim() || loading) return;
    if (speech.listening) speech.stop();
    onSend(attachments);
    setAttachments([]);
  };

  const active = getActiveConfig(aiConfig);
  const isReasoningModel = active.model.toLowerCase().includes("reason") || active.model.toLowerCase().includes("deepseek");

  return (
    <footer className="border-t border-border bg-background shrink-0 relative">
      {/* 拖拽高亮提示 */}
      {isDragOver && (
        <div className="absolute inset-0 z-40 border-2 border-primary border-dashed rounded-lg pointer-events-none flex items-center justify-center bg-background/80">
          <p className="text-sm text-primary font-medium">拖放文件到此区域</p>
        </div>
      )}
      {/* 附件 chips */}
      <AttachmentChips attachments={attachments} onRemove={removeAttachment} />

      {/* Slash 提示词菜单 */}
      {isSlashVisible && (
        <div ref={slashMenuRef}
          className="absolute bottom-full left-4 right-4 mb-2 bg-popover border border-border rounded-lg shadow-xl z-50 max-h-52 overflow-y-auto animate-form-enter"
        >
          {filteredPrompts.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3 px-2.5">
              暂无提示词，请在设置中创建
            </p>
          ) : (
            <div className="py-1">
              {filteredPrompts.map((p, idx) => {
                const selected = idx === selectedPromptIdx;
                return (
                  <button key={p.id}
                    onClick={() => handleSelectPrompt(p)}
                    onMouseMove={() => setSelectedPromptIdx(idx)}
                    className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors ${selected ? "bg-accent" : "hover:bg-accent/50"}`}
                  >
                    <FileText className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{p.name}</div>
                      {p.description && (
                        <div className="text-xs text-muted-foreground truncate mt-0.5">{p.description}</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 输入卡片 */}
      <div className="px-4 py-3">
        <div className="border border-input rounded-xl bg-card transition-shadow focus-within:ring-2 focus-within:ring-ring/20">
          {/* Top row: tools */}
          <div className="flex items-center gap-0.5 px-3 pt-2 pb-1">
            <button onClick={handleFilePick}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="上传文件"
            >
              <Paperclip size={14} />
            </button>
            <input ref={fileInputRef} type="file" multiple accept="image/*"
              onChange={handleFileChange} className="hidden" />
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => {
              const val = e.target.value;
              setInputValue(val);
              setShowSlash(val.startsWith("/") && !loading);
              adjustHeight();
            }}
            onKeyDown={handleKeyDown}
            placeholder={inputValue.startsWith("/") ? '' : '输入消息，输入 "/" 可唤起提示词...'}
            rows={1}
            className="w-full bg-transparent resize-none px-4 py-2 text-sm outline-none placeholder:text-muted-foreground/50"
          />

          {/* Bottom row */}
          <div className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center gap-2">
              {/* 模型选择 */}
              <ModelSelector aiConfig={aiConfig} onNavigate={onNavigateSettings} onModelSelect={handleModelSelect} />

              {/* 思考级别 — 下拉选择（仿 CeBian Popover） */}
              {(isReasoningModel || aiConfig.thinking_level !== "off") && (
                <div className="border-l border-border pl-2">
                  <ThinkingLevelSelector
                    level={aiConfig.thinking_level}
                    onSelect={(level) => onConfigChange({ ...aiConfig, thinking_level: level })}
                  />
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {speech.supported && (
                <button
                  onClick={() => {
                    if (speech.listening) {
                      speech.stop();
                    } else {
                      voiceRangeRef.current = null; // 重置语音 range，新语音从光标处开始
                      lastVoiceTextRef.current = "";
                      speech.start();
                    }
                  }}
                  disabled={loading}
                  className={`p-1.5 rounded-md transition-colors disabled:opacity-30 ${
                    speech.listening
                      ? "text-primary bg-primary/10"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                  title={speech.listening ? "停止语音输入" : "语音输入"}
                >
                  {speech.listening ? (
                    <span className="relative flex">
                      <Mic size={15} />
                      <span className="animate-ping absolute inset-0 m-auto w-full h-full rounded-full bg-primary/40" />
                    </span>
                  ) : (
                    <Mic size={15} />
                  )}
                </button>
              )}
              {loading ? (
                <button onClick={onStop}
                  className="p-2 bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors flex items-center justify-center"
                  title="终止回答"
                >
                  <Square size={12} fill="currentColor" />
                </button>
              ) : (
                <button onClick={handleSend} disabled={!inputValue.trim()}
                  className="p-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                  title="发送"
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
