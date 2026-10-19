import { useState, type CSSProperties, type ReactNode } from "react";

import { useHostTheme } from "./theme";
import { canvasSpacing, canvasTypography, categoryPaletteDark, usageColorSequence, type Color } from "./tokens";
import { HoverTip, useHoverTip } from "./tooltip";
import { mergeStyle } from "./ui";

export type UsageBarSegment = {
    readonly id: string;
    readonly value: number;
    readonly color?: Color;
};

function safeValue(value: number) {
    return Number.isFinite(value) && value > 0 ? value : 0;
}

export function UsageBar({
    segments,
    total,
    topLeftLabel,
    topRightLabel,
    style,
}: {
    segments: readonly UsageBarSegment[];
    total: number;
    topLeftLabel?: ReactNode;
    topRightLabel?: ReactNode;
    style?: CSSProperties;
}) {
    const { tokens } = useHostTheme();
    const { ref, tip, show, hide } = useHoverTip();
    const safeTotal = Math.max(safeValue(total), 1);
    const used = segments.reduce((sum, segment) => sum + safeValue(segment.value), 0);
    const remainder = Math.max(0, safeTotal - used);
    const showLabels = topLeftLabel != null || topRightLabel != null;
    const segmentStyle: CSSProperties = {
        height: 5,
        flexBasis: 0,
        flexShrink: 0,
        minWidth: canvasSpacing[1],
        borderRadius: 1,
    };

    return (
        <div ref={ref} style={mergeStyle({ position: "relative", display: "flex", flexDirection: "column", gap: canvasSpacing[2], width: "100%", minWidth: 0 }, style)}>
            {showLabels ? (
                <div
                    style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        gap: canvasSpacing[3],
                        minWidth: 0,
                        fontSize: canvasTypography.small.fontSize,
                        lineHeight: canvasTypography.small.lineHeight,
                        fontWeight: canvasTypography.small.fontWeight,
                        color: tokens.text.secondary,
                        fontVariantNumeric: "tabular-nums",
                    }}
                >
                    <span style={{ minWidth: 0 }}>{topLeftLabel}</span>
                    <span style={{ minWidth: 0, textAlign: "right" }}>{topRightLabel}</span>
                </div>
            ) : null}
            <div style={{ width: "100%", minWidth: 0, overflow: "hidden", borderRadius: 1, background: "transparent" }}>
                <div style={{ display: "flex", minWidth: 0, gap: 1 }}>
                    {segments.map((segment, index) => {
                        const colorKey = segment.color || usageColorSequence[index % usageColorSequence.length];
                        const value = safeValue(segment.value);
                        return (
                            <span
                                key={segment.id}
                                aria-hidden
                                style={{
                                    ...segmentStyle,
                                    flexGrow: value,
                                    background: tokens.category[colorKey] || categoryPaletteDark[colorKey],
                                }}
                                onMouseMove={(event) =>
                                    show(
                                        event,
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <span style={{ width: 7, height: 7, borderRadius: 2, background: tokens.category[colorKey] || categoryPaletteDark[colorKey], flexShrink: 0 }} />
                                            <span>{segment.id}</span>
                                            <span>
                                                {value}（{((value / safeTotal) * 100).toFixed(1)}%）
                                            </span>
                                        </div>,
                                    )
                                }
                                onMouseLeave={hide}
                            />
                        );
                    })}
                    <span
                        aria-hidden
                        style={{ ...segmentStyle, flexGrow: remainder, background: tokens.fill.tertiary }}
                        onMouseMove={(event) => show(event, `剩余 ${remainder}（${((remainder / safeTotal) * 100).toFixed(1)}%）`)}
                        onMouseLeave={hide}
                    />
                </div>
            </div>
            <HoverTip tip={tip} />
        </div>
    );
}

export function Swatch({ color, style }: { color: Color; style?: CSSProperties }) {
    const theme = useHostTheme();
    return (
        <span
            style={mergeStyle(
                {
                    display: "inline-block",
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    background: theme.category[color] || theme.category.gray,
                    flexShrink: 0,
                },
                style,
            )}
        />
    );
}

export function CollapsibleSection({
    title,
    leading,
    count,
    trailing,
    children,
    defaultOpen = false,
    style,
}: {
    title: string;
    leading?: ReactNode;
    count?: number;
    trailing?: ReactNode;
    children?: ReactNode;
    defaultOpen?: boolean;
    style?: CSSProperties;
}) {
    const theme = useHostTheme();
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div style={mergeStyle({ display: "flex", flexDirection: "column", gap: 6 }, style)}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    padding: "4px 0",
                    border: "none",
                    background: "transparent",
                    color: theme.text.primary,
                    cursor: "pointer",
                    fontSize: 13,
                    textAlign: "left",
                }}
            >
                <span style={{ width: 12, color: theme.text.tertiary, transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms ease" }}>▸</span>
                {leading}
                <span style={{ fontWeight: 500 }}>{title}</span>
                {typeof count === "number" ? <span style={{ color: theme.text.tertiary }}>{count}</span> : null}
                <span style={{ flex: 1 }} />
                {trailing ? <span style={{ color: theme.text.tertiary }}>{trailing}</span> : null}
            </button>
            {open ? <div style={{ paddingLeft: 20 }}>{children}</div> : null}
        </div>
    );
}
