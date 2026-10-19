import { useEffect, useRef } from "react";

import { XingXiaochiAvatar } from "@/components/canvas/xing-xiaochi-avatar";
import { loadXingXiaochiEngine, type GrokCharacterInstance } from "@/lib/canvas/xing-xiaochi-engine";
import { registerXingLive, unregisterXingLive } from "@/lib/canvas/xing-xiaochi-live-registry";
import { xingMoodToCharacterState, type XingAgentMood } from "@/lib/canvas/xing-xiaochi-ports";

/** 画布节点内动态星小驰；注册活 body path 供连线接点跟手 */
export function XingXiaochiLive({
    nodeId,
    size = 120,
    mood = "idle",
    followPointer = false,
}: {
    nodeId?: string;
    size?: number;
    mood?: XingAgentMood;
    followPointer?: boolean;
}) {
    const hostRef = useRef<HTMLDivElement>(null);
    const botRef = useRef<GrokCharacterInstance | null>(null);
    const fallbackRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        let cancelled = false;
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", "星小驰");
        svg.style.width = "100%";
        svg.style.height = "100%";
        svg.style.overflow = "visible";
        svg.style.colorScheme = "light";
        svg.style.setProperty("--bg", "transparent");
        svg.style.setProperty("--eye", "#FFFFFF");
        svg.style.setProperty("--fg", "#E23B4C");
        host.appendChild(svg);

        loadXingXiaochiEngine()
            .then((GrokCharacter) => {
                if (cancelled) return;
                const bot = new GrokCharacter(svg, {
                    mode: "hold",
                    shape: "clay",
                    color: "clay",
                    scheme: "light",
                    loginWrap: false,
                    followPointer,
                    sizePx: size,
                    state: xingMoodToCharacterState(mood),
                });
                bot.setMode("hold");
                bot.setFollowPointer(followPointer);
                bot.setState(xingMoodToCharacterState(mood), { resetEyes: true });
                botRef.current = bot;
                if (fallbackRef.current) fallbackRef.current.style.display = "none";

                const body =
                    bot.body ||
                    (svg.querySelector('g:not([aria-hidden="true"]) > path') as SVGPathElement | null);
                if (nodeId && body) registerXingLive(nodeId, { svg, body, sizePx: size, bot });
            })
            .catch(() => undefined);

        return () => {
            cancelled = true;
            if (nodeId) unregisterXingLive(nodeId);
            botRef.current?.destroy();
            botRef.current = null;
            svg.remove();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [size, nodeId]);

    useEffect(() => {
        const bot = botRef.current;
        if (!bot) return;
        bot.setMode("hold");
        bot.setState(xingMoodToCharacterState(mood), { resetEyes: mood === "success" || mood === "error" });
    }, [mood]);

    useEffect(() => {
        botRef.current?.setFollowPointer(followPointer);
    }, [followPointer]);

    return (
        <div className="relative" style={{ width: size, height: size }}>
            <div ref={fallbackRef} className="absolute inset-0 grid place-items-center">
                <XingXiaochiAvatar size={size} />
            </div>
            <div ref={hostRef} className="pointer-events-none absolute inset-0" />
        </div>
    );
}
