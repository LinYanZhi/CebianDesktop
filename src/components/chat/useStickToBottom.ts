import { useRef, useState, useCallback, useEffect } from "react";

export function useStickToBottom(containerRef: React.RefObject<HTMLDivElement | null>) {
  const stickRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const lastProgrammaticAtRef = useRef(0);
  const PROGRAMMATIC_GUARD_MS = 80;
  const BOTTOM_THRESHOLD_PX = 60;

  const isAtBottomNow = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD_PX;
  }, [containerRef]);

  const scrollToBottom = useCallback((opts?: { force?: boolean }) => {
    const el = containerRef.current;
    if (!el) return;
    if (opts?.force) {
      if (!stickRef.current) {
        stickRef.current = true;
        setIsAtBottom(true);
      }
    } else if (!stickRef.current) {
      return;
    }
    lastProgrammaticAtRef.current = Date.now();
    el.scrollTop = el.scrollHeight;
  }, [containerRef]);

  // 监听用户滚动事件
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (Date.now() - lastProgrammaticAtRef.current < PROGRAMMATIC_GUARD_MS) return;
      const atBottom = isAtBottomNow();
      if (stickRef.current !== atBottom) {
        stickRef.current = atBottom;
        setIsAtBottom(atBottom);
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [containerRef, isAtBottomNow]);

  // ResizeObserver：内容变化时自动跟随（仅当用户未向上滚动时）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { scrollToBottom(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, scrollToBottom]);

  return { isAtBottom, scrollToBottom };
}
