import avatarUrl from "@/assets/xing-xiaochi.png";

/** 星小驰形象：官方素材抠出的软海星（无白圆底、无方卡），节点本体用图，小尺寸用 SVG。 */
export function XingXiaochiAvatar({ className, size = 24 }: { className?: string; size?: number }) {
    if (size >= 40) {
        return (
            <img
                className={className}
                src={avatarUrl}
                width={size}
                height={size}
                alt=""
                draggable={false}
                style={{ display: "block", objectFit: "contain", background: "transparent", pointerEvents: "none", userSelect: "none" }}
            />
        );
    }
    return (
        <svg className={className} width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden>
            <circle cx="22" cy="34" r="7.5" fill="#E23B4C" />
            <circle cx="34" cy="22" r="4.5" fill="#E23B4C" />
            <circle cx="98" cy="96" r="7" fill="#E23B4C" />
            <path
                fill="#E23B4C"
                d="M60 8
                   C68 8 72 30 78 40
                   C90 44 108 48 110 60
                   C112 72 98 82 92 92
                   C88 106 92 116 78 118
                   C68 120 64 108 60 106
                   C56 108 52 120 42 118
                   C28 116 32 106 28 92
                   C22 82 8 72 10 60
                   C12 48 30 44 42 40
                   C48 30 52 8 60 8Z"
            />
            <ellipse cx="50" cy="58" rx="5.5" ry="10" fill="#fff" />
            <ellipse cx="70" cy="58" rx="5.5" ry="10" fill="#fff" />
        </svg>
    );
}

/** 旧版落盘标题 → 展示用星小驰名 */
export function isLegacyCodexNodeTitle(title: string | undefined | null) {
    const value = (title || "").trim();
    if (!value) return false;
    return /^(Codex(\s*智能节点|\s*Smart\s*Node)?|Codex\s*CLI)$/i.test(value) || value === "Codex 智能节点";
}
