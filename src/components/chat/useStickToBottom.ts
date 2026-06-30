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
 * 2. **千万不要加 MutationObserver**：某次修复加了它，流式输出时每帧调 scrollToBottom，
 *    刷新 programmaticAtRef，用户滚动事件被 80ms 守卫拦截 → 按钮永远不出现。
 *
 * 3. **程序化滚动后设置 programmaticAtRef**：防止 scrollToBottom 触发的 scroll 事件
 *    把「在底部」状态误覆盖掉。
 *
 * 4. **按钮必须放在 relative 容器内，不能移出去**（见 ChatView.tsx 注释）。
 *
 * 5. **改用 callback ref + useState 管理容器元素**（第 7 次修复才找到的根因）：
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

  // ⚠ 每次渲染后都检查实际滚动状态，确保 atBottom 与 DOM 同步。
  //   之所以不用 [] deps（只在挂载时跑一次），是因为消息可能异步加载，
  //   挂载时 DOM 还没渲染完，状态不准确。无 deps 每次渲染都修一次，保证最终一致。
  //   曾修了 5 次「置底按钮又没了」，根因都是挂载时状态误判后无法同步。
  useEffect(() => {
    if (!containerEl) return;
    const elAtBottom = isAtBottomNow();
    if (stickRef.current !== elAtBottom) {
      stickRef.current = elAtBottom;
      setAtBottom(elAtBottom);
    }
  });

  // 用户滚动事件
  // ⚠ 依赖 containerEl（DOM 元素本身），不是 ref 对象。
  //   容器元素变化时（如欢迎页→聊天视图），effect 重新执行，正确绑定事件。
  //   之前用 containerRef（RefObject）导致元素变了但 effect 不重跑，修了第 7 次才找到。
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

  // ResizeObserver：窗口 resize / 布局变化时先检查状态，再决定是否滚动
  // ⚠ 之前只调 scrollToBottom() 不检查状态，如果 stickRef 状态不同步，即使内容变化
  //   也无法修正。先同步状态，再滚动。
  useEffect(() => {
    if (!containerEl) return;
    const ro = new ResizeObserver(() => {
      // 第一步：重新检查「在底部」状态，同步 stickRef 和 atBottom
      const now = isAtBottomNow();
      if (stickRef.current !== now) {
        stickRef.current = now;
        setAtBottom(now);
      }
      // 第二步：如果用户在底部，跟随滚动到最新内容
      if (stickRef.current) {
        scrollToBottom();
      }
    });
    ro.observe(containerEl);
    return () => ro.disconnect();
  }, [containerEl, isAtBottomNow, scrollToBottom]);

  return { containerRef, isAtBottom: atBottom, scrollToBottom, setAtBottom };
}
