type GrokCharacterInstance = {
    body?: SVGPathElement;
    clipPath?: SVGPathElement;
    setState: (name: string, opts?: { resetEyes?: boolean }) => void;
    setMode: (mode: string) => void;
    setFollowPointer: (v: boolean) => void;
    setTethered: (v: boolean) => void;
    destroy: () => void;
};

type GrokCharacterCtor = new (svg: SVGSVGElement, opts?: Record<string, unknown>) => GrokCharacterInstance;

declare global {
    interface Window {
        GrokCharacter?: GrokCharacterCtor;
    }
}

const SCRIPT_SRCS = [
    "/xing-xiaochi/geometry-data.js",
    "/xing-xiaochi/clay-override.js",
    "/xing-xiaochi/src/math.js",
    "/xing-xiaochi/src/tables.js",
    "/xing-xiaochi/src/pose.js",
    "/xing-xiaochi/src/tricks.js",
    "/xing-xiaochi/src/fx.js",
    "/xing-xiaochi/src/eyes.js",
    "/xing-xiaochi/src/character.js",
];

let loadPromise: Promise<GrokCharacterCtor> | null = null;

function loadScript(src: string) {
    return new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[data-xing-src="${src}"]`);
        if (existing) {
            if (existing.dataset.loaded === "1") resolve();
            else existing.addEventListener("load", () => resolve(), { once: true });
            return;
        }
        const el = document.createElement("script");
        el.src = src;
        el.async = false;
        el.dataset.xingSrc = src;
        el.onload = () => {
            el.dataset.loaded = "1";
            resolve();
        };
        el.onerror = () => reject(new Error(`加载星小驰脚本失败: ${src}`));
        document.head.appendChild(el);
    });
}

export function loadXingXiaochiEngine() {
    if (typeof window === "undefined") return Promise.reject(new Error("星小驰引擎仅在浏览器可用"));
    if (window.GrokCharacter) return Promise.resolve(window.GrokCharacter);
    if (!loadPromise) {
        loadPromise = (async () => {
            for (const src of SCRIPT_SRCS) await loadScript(src);
            if (!window.GrokCharacter) throw new Error("GrokCharacter 未注册");
            return window.GrokCharacter;
        })().catch((error) => {
            loadPromise = null;
            throw error;
        });
    }
    return loadPromise;
}

export type { GrokCharacterInstance };
