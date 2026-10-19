import type { LanShareInfo } from "@/types/desktop-api";

export async function applyDesktopLanShare(enabled: boolean): Promise<LanShareInfo | null> {
    if (typeof window === "undefined" || !window.desktopAPI?.setLanShare) return null;
    return window.desktopAPI.setLanShare(enabled);
}

export async function fetchDesktopLanShare(): Promise<LanShareInfo | null> {
    if (typeof window === "undefined" || !window.desktopAPI?.getLanShare) return null;
    return window.desktopAPI.getLanShare();
}
