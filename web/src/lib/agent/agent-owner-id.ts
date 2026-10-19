import { randomId } from "@/lib/utils";

let memoryOwnerId = "";

/** 每台浏览器一个稳定的 Agent 身份：桌面端固定 host，浏览器存 localStorage；用于隔离各自的 Codex 会话与历史 */
export function agentOwnerId() {
    if (typeof window !== "undefined" && window.desktopAPI?.isDesktop) return "host";
    if (memoryOwnerId) return memoryOwnerId;
    try {
        const stored = localStorage.getItem("canvas-agent-owner-id");
        if (stored) {
            memoryOwnerId = stored;
            return stored;
        }
        memoryOwnerId = `guest-${randomId()}`;
        localStorage.setItem("canvas-agent-owner-id", memoryOwnerId);
    } catch {
        memoryOwnerId ||= `guest-${randomId()}`;
    }
    return memoryOwnerId;
}
