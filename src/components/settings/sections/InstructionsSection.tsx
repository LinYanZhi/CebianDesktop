import type { AIConfig } from "../../../lib/types";

export function InstructionsSection({ config, onChange }: { config: AIConfig; onChange: (c: AIConfig) => void }) {
  return (
    <section>
      <h2 className="text-base font-semibold mb-4">系统提示词</h2>
      <p className="text-sm text-muted-foreground mb-4">自定义 AI 助手的行为和角色定位。此内容会作为系统消息发送给 AI。</p>
      <textarea value={config.system_prompt || ''}
        onChange={(e) => onChange({ ...config, system_prompt: e.target.value })}
        className="w-full h-48 bg-background border border-input rounded-lg p-3 text-sm outline-none focus:border-ring transition-colors resize-none font-mono"
        placeholder="输入系统提示词，决定 AI 助手的角色和行为..." />
    </section>
  );
}
