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
 * 4. **位置守卫替代时间守卫**（第 8 次修复）：
 *    原方案用 80ms 时间窗口阻止程序化滚动触发的 scroll 事件误判。但 AI 流式输出
 *    频率高时，用户在程序化滚动后 80ms 内的手动滚动被忽略 → 滚不上去。
 *    改为记录上次程序化滚动设置的 scrollTop 值，scroll 事件中对比当前 scrollTop，
 *    若相同则认为是程序化滚动触发的合成事件，跳过处理；若不同则一定是用户操作。
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
  // 记录上次程序化滚动设置的 scrollTop 值，用于合成事件检测（替代旧的时间守卫）
  const lastProgrammaticTopRef = useRef(-1);

  // callback ref：当 React 挂载/卸载容器元素时同步到 state
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    setContainerEl(el);
  }, []);

  // ⚠ 上次修改：60→4。别再改大了。4px 仅防浮点抖动，>4px 就认为用户离开了底部
  const BOTTOM_THRESHOLD_PX = 4;

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
    // 记录目标 scrollTop，scroll 事件处理程序通过对比来判断是否为合成事件
    const targetScrollTop = containerEl.scrollHeight - containerEl.clientHeight;
    lastProgrammaticTopRef.current = targetScrollTop;
    containerEl.scrollTop = targetScrollTop;
  }, [containerEl]);

  // ═══════════════════════════════════════════════════════════
  //  内容变化检测：MutationObserver
  //  当 AI 流式输出新内容到容器时，检测到 DOM 变化并跟随滚动。
  //  之前有 bug：流式输出时每帧调 scrollToBottom → 刷新 programmaticAtRef
  //  → 用户滚动被 80ms 守卫拦截。但 scrollToBottom 内有 !stickRef.current
  //  守卫，用户离开底部后不会滚动，也就不会刷新 programmaticAtRef。
  //  改用位置守卫后此问题不复存在。
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    if (!containerEl) return;
    let rafId: number | null = null;
    const mo = new MutationObserver(() => {
      if (stickRef.current) {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          rafId = null;
          scrollToBottom();
        });
      }
    });
    mo.observe(containerEl, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      mo.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [containerEl, scrollToBottom]);

  // ═══════════════════════════════════════════════════════════
  //  窗口/容器尺寸变化：ResizeObserver
  //  窗口 resize 或布局变化时跟随滚动。
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    if (!containerEl) return;
    let rafId: number | null = null;
    const ro = new ResizeObserver(() => {
      if (stickRef.current) {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          rafId = null;
          scrollToBottom();
        });
      }
    });
    ro.observe(containerEl);
    return () => {
      ro.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [containerEl, scrollToBottom]);

  // ═══════════════════════════════════════════════════════════
  //  用户滚动事件：检测用户是否在底部/离开底部
  //  采用「位置守卫」而非旧版的「时间守卫」：
  //  如果当前 scrollTop 与上次程序化滚动设置的值一致，则视为此事件由
  //  scrollToBottom 触发（合成事件），跳过处理；否则一定是用户手动滚动。
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    if (!containerEl) return;
    const onScroll = () => {
      // 位置守卫：scrollTop 与上次程序化滚动值相同 → 合成事件 → 忽略
      if (Math.abs(containerEl.scrollTop - lastProgrammaticTopRef.current) <= BOTTOM_THRESHOLD_PX) {
        return;
      }
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
