import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from "react";

import { useHostTheme } from "./theme";
import { canvasRadius, canvasSpacing, canvasTypography, toneColor } from "./tokens";

export function mergeStyle(base: CSSProperties, override?: CSSProperties): CSSProperties {
    return override ? { ...base, ...override } : base;
}

export function Stack({ children, gap = 12, style }: { children?: ReactNode; gap?: number; style?: CSSProperties }) {
    return <div style={mergeStyle({ display: "flex", flexDirection: "column", gap, width: "100%" }, style)}>{children}</div>;
}

export function Row({
    children,
    gap = 8,
    align = "center",
    justify = "start",
    wrap = false,
    style,
}: {
    children?: ReactNode;
    gap?: number;
    align?: "start" | "center" | "end" | "stretch";
    justify?: "start" | "center" | "end" | "space-between";
    wrap?: boolean;
    style?: CSSProperties;
}) {
    return (
        <div
            style={mergeStyle(
                {
                    display: "flex",
                    flexDirection: "row",
                    alignItems: align === "start" ? "flex-start" : align === "end" ? "flex-end" : align,
                    justifyContent:
                        justify === "start"
                            ? "flex-start"
                            : justify === "end"
                              ? "flex-end"
                              : justify === "space-between"
                                ? "space-between"
                                : "center",
                    flexWrap: wrap ? "wrap" : "nowrap",
                    gap,
                    width: "100%",
                },
                style,
            )}
        >
            {children}
        </div>
    );
}

export function Grid({
    children,
    columns,
    gap = 12,
    align = "stretch",
    style,
}: {
    children?: ReactNode;
    columns: number | string;
    gap?: number;
    align?: "start" | "center" | "end" | "stretch";
    style?: CSSProperties;
}) {
    const template = typeof columns === "number" ? `repeat(${columns}, minmax(0, 1fr))` : columns;
    return (
        <div
            style={mergeStyle(
                {
                    display: "grid",
                    gridTemplateColumns: template,
                    gap,
                    alignItems: align === "start" ? "flex-start" : align === "end" ? "flex-end" : align,
                    width: "100%",
                },
                style,
            )}
        >
            {children}
        </div>
    );
}

export function Divider({ style }: { style?: CSSProperties }) {
    const theme = useHostTheme();
    return <div style={mergeStyle({ height: 1, background: theme.stroke.tertiary, width: "100%" }, style)} />;
}

export function Spacer() {
    return <div style={{ flex: 1, minWidth: 0 }} />;
}

export function H1({ children, style }: { children?: ReactNode; style?: CSSProperties }) {
    const theme = useHostTheme();
    return (
        <h1
            style={mergeStyle(
                {
                    margin: 0,
                    color: theme.text.primary,
                    fontSize: canvasTypography.h1.fontSize,
                    lineHeight: canvasTypography.h1.lineHeight,
                    fontWeight: canvasTypography.h1.fontWeight,
                },
                style,
            )}
        >
            {children}
        </h1>
    );
}

export function H2({ children, style }: { children?: ReactNode; style?: CSSProperties }) {
    const theme = useHostTheme();
    return (
        <h2
            style={mergeStyle(
                {
                    margin: 0,
                    color: theme.text.primary,
                    fontSize: canvasTypography.h2.fontSize,
                    lineHeight: canvasTypography.h2.lineHeight,
                    fontWeight: canvasTypography.h2.fontWeight,
                },
                style,
            )}
        >
            {children}
        </h2>
    );
}

export function H3({ children, style }: { children?: ReactNode; style?: CSSProperties }) {
    const theme = useHostTheme();
    return (
        <h3
            style={mergeStyle(
                {
                    margin: 0,
                    color: theme.text.primary,
                    fontSize: canvasTypography.h3.fontSize,
                    lineHeight: canvasTypography.h3.lineHeight,
                    fontWeight: canvasTypography.h3.fontWeight,
                },
                style,
            )}
        >
            {children}
        </h3>
    );
}

const weights = { normal: 400, medium: 500, semibold: 590, bold: 700 } as const;

export function Text({
    children,
    tone = "primary",
    size = "body",
    as,
    weight = "normal",
    italic,
    truncate,
    style,
}: {
    children?: ReactNode;
    tone?: "primary" | "secondary" | "tertiary" | "quaternary";
    size?: "body" | "small";
    as?: "p" | "span";
    weight?: keyof typeof weights;
    italic?: boolean;
    truncate?: boolean | "start" | "end";
    style?: CSSProperties;
}) {
    const theme = useHostTheme();
    const Tag = as || "p";
    const color =
        tone === "secondary"
            ? theme.text.secondary
            : tone === "tertiary"
              ? theme.text.tertiary
              : tone === "quaternary"
                ? theme.text.quaternary
                : theme.text.primary;
    return (
        <Tag
            style={mergeStyle(
                {
                    margin: Tag === "p" ? 0 : undefined,
                    color,
                    fontSize: size === "small" ? 12 : 14,
                    lineHeight: size === "small" ? "16px" : "20px",
                    fontWeight: weights[weight],
                    fontStyle: italic ? "italic" : undefined,
                    overflow: truncate ? "hidden" : undefined,
                    textOverflow: truncate ? "ellipsis" : undefined,
                    whiteSpace: truncate ? "nowrap" : undefined,
                    direction: truncate === "start" ? "rtl" : undefined,
                    textAlign: truncate === "start" ? "left" : undefined,
                },
                style,
            )}
        >
            {children}
        </Tag>
    );
}

export function Code({ children, style }: { children?: ReactNode; style?: CSSProperties }) {
    const theme = useHostTheme();
    return (
        <code
            style={mergeStyle(
                {
                    fontSize: "0.92em",
                    padding: "1px 5px",
                    borderRadius: 4,
                    background: theme.fill.tertiary,
                    border: `1px solid ${theme.stroke.tertiary}`,
                },
                style,
            )}
        >
            {children}
        </code>
    );
}

export function Link({ children, href, style }: { children?: ReactNode; href: string; style?: CSSProperties }) {
    const theme = useHostTheme();
    return (
        <a href={href} target="_blank" rel="noreferrer" style={mergeStyle({ color: theme.text.link, textDecoration: "none" }, style)}>
            {children}
        </a>
    );
}

const CardCtx = createContext<{ size: "base" | "lg"; open: boolean }>({ size: "base", open: true });

export function Card({
    children,
    variant = "default",
    size = "base",
    style,
}: {
    children?: ReactNode;
    variant?: "default" | "borderless";
    size?: "base" | "lg";
    stickyHeader?: boolean;
    collapsible?: boolean;
    defaultOpen?: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    style?: CSSProperties;
}) {
    const theme = useHostTheme();
    const value = useMemo(() => ({ size, open: true }), [size]);
    return (
        <CardCtx.Provider value={value}>
            <div
                style={mergeStyle(
                    {
                        border: variant === "borderless" ? "none" : `1px solid ${theme.stroke.primary}`,
                        borderRadius: variant === "borderless" ? 0 : 8,
                        background: "transparent",
                        overflow: "hidden",
                    },
                    style,
                )}
            >
                {children}
            </div>
        </CardCtx.Provider>
    );
}

export function CardHeader({
    children,
    trailing,
    style,
}: {
    children?: ReactNode;
    trailing?: ReactNode;
    style?: CSSProperties;
}) {
    const theme = useHostTheme();
    const { size } = useContext(CardCtx);
    return (
        <div
            style={mergeStyle(
                {
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    minHeight: size === "lg" ? 32 : 28,
                    padding: "6px 12px",
                    fontSize: 12,
                    color: theme.text.secondary,
                    borderBottom: `1px solid ${theme.stroke.secondary}`,
                },
                style,
            )}
        >
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</span>
            {trailing ? <span style={{ flexShrink: 0 }}>{trailing}</span> : null}
        </div>
    );
}

export function CardBody({ children, style }: { children?: ReactNode; style?: CSSProperties }) {
    const { open } = useContext(CardCtx);
    if (!open) return null;
    return <div style={mergeStyle({ padding: 12 }, style)}>{children}</div>;
}

export function Button({
    children,
    variant = "secondary",
    disabled,
    type = "button",
    style,
    onClick,
}: {
    children?: ReactNode;
    variant?: "primary" | "secondary" | "ghost";
    disabled?: boolean;
    type?: "button" | "submit" | "reset";
    style?: CSSProperties;
    onClick?: () => void;
}) {
    const theme = useHostTheme();
    const bg =
        variant === "primary" ? theme.accent.control : variant === "ghost" ? "transparent" : theme.fill.secondary;
    const color = variant === "primary" ? theme.text.onAccent : theme.text.primary;
    return (
        <button
            type={type}
            disabled={disabled}
            onClick={onClick}
            style={mergeStyle(
                {
                    height: 24,
                    padding: "0 10px",
                    borderRadius: 6,
                    border: variant === "ghost" ? "none" : `1px solid ${theme.stroke.secondary}`,
                    background: bg,
                    color,
                    fontSize: 12,
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.5 : 1,
                },
                style,
            )}
        >
            {children}
        </button>
    );
}

export function Pill({
    children,
    active,
    size = "md",
    leadingContent,
    keyboardHint,
    disabled,
    title,
    style,
    onClick,
}: {
    children?: ReactNode;
    active?: boolean;
    tone?: string;
    size?: "sm" | "md";
    leadingContent?: ReactNode;
    keyboardHint?: string;
    disabled?: boolean;
    title?: string;
    style?: CSSProperties;
    onClick?: () => void;
}) {
    const theme = useHostTheme();
    const sm = size === "sm";
    const Comp = onClick ? "button" : "span";
    return (
        <Comp
            type={onClick ? "button" : undefined}
            title={title}
            disabled={disabled}
            onClick={disabled ? undefined : onClick}
            style={mergeStyle(
                {
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxSizing: "border-box",
                    borderRadius: canvasRadius.full,
                    whiteSpace: "nowrap",
                    userSelect: "none",
                    fontFamily: "inherit",
                    fontWeight: active ? 500 : 400,
                    fontSize: sm ? "10px" : "12px",
                    lineHeight: sm ? "12px" : "14px",
                    background: sm ? theme.fill.quaternary : active ? theme.fill.secondary : "transparent",
                    color: active ? theme.text.primary : theme.text.secondary,
                    border: sm ? "none" : `1px solid ${active ? "transparent" : theme.stroke.secondary}`,
                    padding: sm
                        ? `${canvasSpacing[0.5]}px ${canvasSpacing[1.5]}px`
                        : `${canvasSpacing[1.5]}px ${canvasSpacing[2.5]}px`,
                    gap: sm ? canvasSpacing[1] : canvasSpacing[1.5],
                    cursor: onClick ? (disabled ? "not-allowed" : "pointer") : "default",
                    opacity: disabled ? 0.3 : 1,
                    margin: onClick ? 0 : undefined,
                },
                style,
            )}
        >
            {leadingContent}
            <span style={{ flexShrink: 0 }}>{children}</span>
            {keyboardHint ? <span style={{ flexShrink: 0, color: theme.text.primary, opacity: 0.3 }}>{keyboardHint}</span> : null}
        </Comp>
    );
}

export function Stat({
    value,
    label,
    tone,
    style,
}: {
    value: ReactNode;
    label: string;
    tone?: "success" | "danger" | "warning" | "info";
    style?: CSSProperties;
}) {
    const theme = useHostTheme();
    return (
        <div
            style={mergeStyle(
                {
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: canvasSpacing[0.5],
                    padding: `${canvasSpacing[3]}px ${canvasSpacing[2]}px`,
                    minWidth: 0,
                },
                style,
            )}
        >
            <div
                style={{
                    fontSize: "24px",
                    lineHeight: "28px",
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                    color: tone ? toneColor[tone] : theme.text.primary,
                }}
            >
                {value}
            </div>
            <div
                style={{
                    fontSize: canvasTypography.small.fontSize,
                    lineHeight: canvasTypography.small.lineHeight,
                    color: theme.text.secondary,
                }}
            >
                {label}
            </div>
        </div>
    );
}

export function Callout({
    children,
    tone = "info",
    title,
    icon,
    style,
}: {
    children?: ReactNode;
    tone?: "info" | "success" | "warning" | "danger" | "neutral";
    title?: ReactNode;
    icon?: ReactNode;
    style?: CSSProperties;
}) {
    const theme = useHostTheme();
    const mark = icon ?? (tone === "warning" ? "!" : tone === "danger" ? "×" : "i");
    return (
        <div
            style={mergeStyle(
                {
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    padding: "12px 14px",
                    borderRadius: 8,
                    border: `1px solid ${theme.stroke.primary}`,
                    background: theme.fill.tertiary,
                },
                style,
            )}
        >
            <span style={{ color: tone === "neutral" ? theme.text.secondary : toneColor[tone], fontWeight: 700, width: 14, textAlign: "center" }}>
                {mark}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
                {title ? <div style={{ fontWeight: 590, marginBottom: 4, color: theme.text.primary }}>{title}</div> : null}
                <div style={{ color: theme.text.secondary, fontSize: 13, lineHeight: "18px" }}>{children}</div>
            </div>
        </div>
    );
}

export function Table({
    headers,
    rows,
    columnAlign,
    framed = true,
    striped,
    style,
    emptyMessage = "No data",
}: {
    headers: ReactNode[];
    rows: ReactNode[][];
    columnAlign?: Array<"left" | "center" | "right" | undefined>;
    rowTone?: Array<string | undefined>;
    framed?: boolean;
    striped?: boolean;
    stickyHeader?: boolean;
    style?: CSSProperties;
    emptyMessage?: ReactNode;
}) {
    const theme = useHostTheme();
    return (
        <div
            style={mergeStyle(
                {
                    border: framed ? `1px solid ${theme.stroke.primary}` : "none",
                    borderRadius: framed ? 8 : 0,
                    overflow: "auto",
                },
                style,
            )}
        >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                    <tr>
                        {headers.map((header, i) => (
                            <th
                                key={i}
                                style={{
                                    textAlign: columnAlign?.[i] || "left",
                                    padding: "8px 10px",
                                    color: theme.text.secondary,
                                    borderBottom: `1px solid ${theme.stroke.secondary}`,
                                    fontWeight: 500,
                                }}
                            >
                                {header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.length ? (
                        rows.map((row, ri) => (
                            <tr key={ri} style={{ background: striped && ri % 2 === 1 ? theme.fill.quaternary : undefined }}>
                                {headers.map((_, ci) => (
                                    <td
                                        key={ci}
                                        style={{
                                            textAlign: columnAlign?.[ci] || "left",
                                            padding: "8px 10px",
                                            color: theme.text.primary,
                                            borderBottom: `1px solid ${theme.stroke.tertiary}`,
                                        }}
                                    >
                                        {row[ci] ?? ""}
                                    </td>
                                ))}
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan={headers.length} style={{ padding: 12, color: theme.text.tertiary }}>
                                {emptyMessage}
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}
