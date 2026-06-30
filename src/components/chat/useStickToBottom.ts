import { useRef, useState, useCallback, useEffect } from "react";

/**
 * ────────────────────────────────────────────────────────────
 *  回底按钮 Hook
 * ────────────────────────────────────────────────────────────
 *
 * ⚠ 历史踩坑记录（给 AI 维护者看）：
 *
 * 1. **BOTTOM_THRESHOLD_PX 不要改大**：曾从 4→60（被认为防抖），导致用户向上滚动
 *    3-4 行后按钮不出现 —— 「置底按钮又没了」问题修了 4 次。
 *
 * 2. **MutationObserver 现在可以加了**（之前有 bug，现已修复）：
 *    流式输出时 MutationObserver 每帧触发，但 scrollToBottom 内有 stickRef 守卫，
 *    用户离开底部后不会滚动，也不会刷新 programmaticAtRef 干扰滚动检测。
 *
 * 3. **ResizeObserver 不能检测内容增长**：
 *    定高容器（flex-1）的内容溢出时 scrollHeight 增加，但 clientHeight 不变，
 *    只有窗口/容器自身尺寸变化时 ResizeObserver 才触发。
 *    所以内容变化的触发必须靠 MutationObserver。
 *
 * 4. **程序化滚动后设置 programmaticAtRef**：防止 scrollToBottom 触发的 scroll 事件
 *    把「在底部」状态误覆盖掉。
 *
 * 5. **按钮必须放在 relative 容器内，不能移出去**（见 ChatView.tsx 注释）。
 *
 * 6. **改用 callback ref + useState 管理容器元素**（第 7 次修复才找到的根因）：
 *    ChatView 在欢迎页和聊天视图间切换时，容器元素从 null 变成新 div。
 *    之前用 useRef + useEffect([containerRef])，ref 对象引用不变，effect 不重新执行，
 *    scroll listener / ResizeObserver 都没绑定到新元素上 → 用户滚动无响应 → 按钮不出现。
 *    useState 让 DOM 元素本身作为 effect 依赖，元素变化时 effect 自动重跑。
 *──────────────────────────────────────────────────────────── */
export function useStickToBottom() {
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  // 用户是否「在底部」—— 不要在初始化时默认为 false，否则刚打开就会有置底按钮
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const programmaticAtRef = useRef(0);

  // callback ref：当 React 挂载/卸载容器元素时同步到 state
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    setContainerEl(el);
  }, []);

  // ⚠ 上次修改：60→4。别再改大了。4px 仅防浮点抖动，>4px 就认为用户离开了底部
  const BOTTOM_THRESHOLD_PX = 4;

  // ⚠ 上次修改：80ms 不动。太短会导致用户滚动时按钮闪烁；太长会吃掉用户第一下滚动
  const PROGRAMMATIC_GUARD_MS = 80;

  const isAtBottomNow = useCallback(() => {
    if (!containerEl) return true;
    return containerEl.scrollHeight - containerEl.scrollTop - containerEl.clientHeight <= BOTTOM_THRESHOLD_PX;
  }, [containerEl]);

  const scrollToBottom = useCallback((opts?: { force?: boolean }) => {
    if (!containerEl) return;
    if (opts?.force) {
      // 用户主动点按钮 → 强制标记为「在底部」
      stickRef.current = true;
      setAtBottom(true);
    } else if (!stickRef.current) {
      // 用户已向上滚动 → 不抢用户滚动位置
      return;
    }
    // ⚠ 必须在 el.scrollTop = ... 之前记录时间戳
    //    否则 scroll 事件触发时守卫判断不到
    programmaticAtRef.current = Date.now();
    containerEl.scrollTop = containerEl.scrollHeight;
  }, [containerEl]);

  // ═══════════════════════════════════════════════════════════
  //  内容变化检测：MutationObserver
  //  当 AI 流式输出新内容到容器时，检测到 DOM 变化并跟随滚动。
  //  之前有 bug：流式输出时每帧调 scrollToBottom → 刷新 programmaticAtRef
  //  → 用户滚动被 80ms 守卫拦截。但 scrollToBottom 内有 !stickRef.current
  //  守卫，用户离开底部后不会滚动，也就不会刷新 programmaticAtRef。
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    if (!containerEl) return;
    const mo = new MutationObserver(() => {
      if (stickRef.current) {
        scrollToBottom();
      }
    });
    mo.observe(containerEl, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => mo.disconnect();
  }, [containerEl, scrollToBottom]);

  // ═══════════════════════════════════════════════════════════
  //  窗口/容器尺寸变化：ResizeObserver
  //  窗口 resize 或布局变化时跟随滚动。
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    if (!containerEl) return;
    const ro = new ResizeObserver(() => {
      if (stickRef.current) {
        scrollToBottom();
      }
    });
    ro.observe(containerEl);
    return () => ro.disconnect();
  }, [containerEl, scrollToBottom]);

  // ═══════════════════════════════════════════════════════════
  //  用户滚动事件：检测用户是否在底部/离开底部
  //  程序化滚动后 80ms 静默期，避免 scrollToBottom 触发的 scroll 事件误判。
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    if (!containerEl) return;
    const onScroll = () => {
      // 程序化滚动后的静默期：忽略程序化滚动触发的 scroll 事件
      if (Date.now() - programmaticAtRef.current < PROGRAMMATIC_GUARD_MS) return;
      const now = isAtBottomNow();
      if (stickRef.current !== now) {
        stickRef.current = now;
        setAtBottom(now);
      }
    };
    containerEl.addEventListener('scroll', onScroll, { passive: true });
    return () => containerEl.removeEventListener('scroll', onScroll);
  }, [containerEl, isAtBottomNow]);

  return { containerRef, isAtBottom: atBottom, scrollToBottom, setAtBottom };
}
