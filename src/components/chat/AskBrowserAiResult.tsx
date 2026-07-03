/**
 * 浏览器 AI 执行结果展示
 *
 * 设计原则：只展示最简洁的摘要，详细日志通过折叠查看。
 * 用户看到的是类似 "浏览器 AI 已完成：打开了百度首页" 的一句话。
 */

interface ParsedReport {
  summary: string;
}

/**
 * 解析浏览器 AI 执行报告文本，提取摘要。
 * 报告格式为 markdown：
 *   ✅ 总结段落...
 *   ## 任务\n...
 *   ## 执行记录\n```\n...\n```)
 */
function parseExecutionReport(text: string): ParsedReport {
  // 只提取第一个非 ## 段落作为摘要
  const firstLine = text.split("\n")[0]?.trim() || "";

  // 尝试从摘要中提取有效内容（去掉 ✅ 这样的 emoji 前缀）
  let summary = firstLine;
  if (summary.startsWith("✅")) {
    summary = summary.replace(/^✅\s*/, "");
  }

  // 如果第一行太短（比如只有 emoji），尝试从文本中找更多内容
  if (summary.length < 5) {
    // 取 ## 之前的所有文本
    const beforeHeader = text.split(/(?=^## )/m)[0]?.trim() || "";
    const cleaned = beforeHeader.replace(/^✅\s*/, "");
    if (cleaned.length > summary.length) {
      summary = cleaned;
    }
  }

  return { summary };
}

interface AskBrowserAiResultProps {
  result: string;
}

export default function AskBrowserAiResult({ result }: AskBrowserAiResultProps) {
  const { summary } = parseExecutionReport(result);

  return (
    <div className="text-xs text-muted-foreground/80 leading-relaxed">
      {summary || "浏览器 AI 任务已完成"}
    </div>
  );
}
