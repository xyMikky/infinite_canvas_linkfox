import type { WheelEvent as ReactWheelEvent } from "react";

/**
 * 画布节点内滚轮：
 * - 默认不拦截 → 画布放大/缩小
 * - 按住 Shift → 纵向滚动当前内容区（并阻止画布缩放）
 */
export function handleNodeContentWheel(event: ReactWheelEvent<HTMLElement>) {
    if (!event.shiftKey) return;
    const el = event.currentTarget;
    const maxScrollTop = el.scrollHeight - el.clientHeight;
    if (maxScrollTop <= 1) return;
    // Shift 时浏览器常把纵向滚轮映射为 deltaX，这里统一用来滚内容
    const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    el.scrollTop = Math.min(maxScrollTop, Math.max(0, el.scrollTop + delta));
}
