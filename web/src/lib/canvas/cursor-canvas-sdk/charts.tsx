import type { CSSProperties } from "react";

import { useHostTheme } from "./theme";
import { chartPalette, toneColor } from "./tokens";
import { HoverTip, useHoverTip } from "./tooltip";
import { mergeStyle } from "./ui";

export type ChartTone = "success" | "danger" | "warning" | "info" | "neutral";
export type ChartDataPoint = { label: string; value: number };
export type ChartSeries = { name: string; data: number[]; tone?: ChartTone };

const AUTO_COLORS = [
    chartPalette.goldenYellow,
    chartPalette.green,
    chartPalette.blue,
    chartPalette.indigo,
    chartPalette.purple,
    chartPalette.brightOrange,
    chartPalette.warmPink,
    chartPalette.vibrantTeal,
];

function seriesColor(series: ChartSeries, index: number) {
    if (series.tone) return toneColor[series.tone];
    return AUTO_COLORS[index % AUTO_COLORS.length];
}

function categoryColor(index: number) {
    return AUTO_COLORS[index % AUTO_COLORS.length];
}

export function BarChart({
    categories,
    series,
    height = 220,
    stacked,
    horizontal,
    normalized,
    valueSuffix = "",
    valuePrefix = "",
    style,
}: {
    categories: string[];
    series: ChartSeries[];
    height?: number;
    stacked?: boolean;
    horizontal?: boolean;
    normalized?: boolean;
    valueSuffix?: string;
    valuePrefix?: string;
    showValues?: boolean;
    beginAtZero?: boolean;
    yMin?: number;
    yMax?: number;
    referenceLines?: Array<{ value: number; label?: string; tone?: ChartTone }>;
    style?: CSSProperties;
}) {
    const theme = useHostTheme();
    const { ref, tip, show, hide } = useHoverTip();
    const useHBar = horizontal || (!stacked && !normalized && series.length <= 1);
    if (useHBar) {
        const data = series[0]?.data || [];
        const max = Math.max(1, ...data);
        const base = data[0] || 0;
        return (
            <div ref={ref} style={mergeStyle({ position: "relative", display: "flex", flexDirection: "column", gap: 8 }, style)}>
                {categories.map((label, i) => {
                    const value = data[i] || 0;
                    const pct = (value / max) * 100;
                    return (
                        <div
                            key={`${label}-${i}`}
                            style={{ display: "grid", gridTemplateColumns: "minmax(72px,140px) 1fr auto", gap: 10, alignItems: "center" }}
                            onMouseMove={(event) =>
                                show(
                                    event,
                                    <div>
                                        <div style={{ fontWeight: 590 }}>{label}</div>
                                        <div>
                                            {valuePrefix}
                                            {value}
                                            {valueSuffix}
                                            {i > 0 && base > 0 ? ` · 为首项 ${((value / base) * 100).toFixed(1)}%` : ""}
                                        </div>
                                    </div>,
                                )
                            }
                            onMouseLeave={hide}
                        >
                            <div style={{ fontSize: 12, color: theme.text.secondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
                            <div style={{ height: 8, borderRadius: 4, background: theme.fill.secondary, overflow: "hidden" }}>
                                <div
                                    style={{
                                        width: `${pct}%`,
                                        height: "100%",
                                        borderRadius: 4,
                                        background: series[0]?.tone ? toneColor[series[0].tone] : categoryColor(i),
                                    }}
                                />
                            </div>
                            <div style={{ fontSize: 12, color: theme.text.primary, fontVariantNumeric: "tabular-nums" }}>
                                {valuePrefix}
                                {value}
                                {valueSuffix}
                            </div>
                        </div>
                    );
                })}
                <HoverTip tip={tip} />
            </div>
        );
    }

    const width = Math.max(280, categories.length * 56);
    const pad = { t: 16, r: 12, b: 36, l: 36 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    const totals = categories.map((_, i) => series.reduce((sum, s) => sum + (s.data[i] || 0), 0));
    const max = Math.max(1, ...(normalized ? [100] : stacked ? totals : series.flatMap((s) => s.data)));
    const groupW = plotW / Math.max(1, categories.length);
    const barW = stacked || normalized ? Math.min(28, groupW * 0.55) : Math.min(16, (groupW * 0.7) / Math.max(1, series.length));

    const seriesTip = (category: string, item: ChartSeries, index: number, raw: number, extra = "") => (
        <div>
            <div style={{ fontWeight: 590, marginBottom: 2 }}>{category}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: seriesColor(item, index), flexShrink: 0 }} />
                <span style={{ color: theme.text.secondary }}>{item.name}</span>
                <span>
                    {valuePrefix}
                    {raw}
                    {valueSuffix}
                    {extra}
                </span>
            </div>
        </div>
    );

    return (
        <div ref={ref} style={{ position: "relative" }}>
            <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={mergeStyle({ display: "block", maxWidth: width }, style)}>
                {categories.map((label, i) => {
                    const x0 = pad.l + i * groupW + groupW / 2;
                    let yCursor = pad.t + plotH;
                    const nodes = [];
                    if (stacked || normalized) {
                        const total = totals[i] || 1;
                        for (let si = 0; si < series.length; si++) {
                            const s = series[si];
                            const raw = s.data[i] || 0;
                            const value = normalized ? (raw / total) * 100 : raw;
                            const h = (value / max) * plotH;
                            yCursor -= h;
                            nodes.push(
                                <rect
                                    key={`${i}-${si}`}
                                    x={x0 - barW / 2}
                                    y={yCursor}
                                    width={barW}
                                    height={Math.max(0, h)}
                                    fill={seriesColor(s, si)}
                                    onMouseMove={(event) => show(event, seriesTip(label, s, si, raw, normalized ? `（${value.toFixed(1)}%）` : ""))}
                                    onMouseLeave={hide}
                                />,
                            );
                        }
                    } else {
                        series.forEach((s, si) => {
                            const value = s.data[i] || 0;
                            const h = (value / max) * plotH;
                            const x = x0 - (series.length * barW + (series.length - 1) * 2) / 2 + si * (barW + 2);
                            nodes.push(
                                <rect
                                    key={`${i}-${si}`}
                                    x={x}
                                    y={pad.t + plotH - h}
                                    width={barW}
                                    height={Math.max(0, h)}
                                    fill={seriesColor(s, si)}
                                    onMouseMove={(event) => show(event, seriesTip(label, s, si, value))}
                                    onMouseLeave={hide}
                                />,
                            );
                        });
                    }
                    nodes.push(
                        <text key={`l-${i}`} x={x0} y={height - 12} textAnchor="middle" fill={theme.text.tertiary} fontSize={11}>
                            {label}
                        </text>,
                    );
                    return <g key={i}>{nodes}</g>;
                })}
            </svg>
            <HoverTip tip={tip} />
        </div>
    );
}

export function PieChart({
    data,
    size = 200,
    donut,
    style,
}: {
    data: Array<ChartDataPoint & { tone?: ChartTone }>;
    size?: number;
    donut?: boolean;
    style?: CSSProperties;
}) {
    const theme = useHostTheme();
    const { ref, tip, show, hide } = useHoverTip();
    const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0) || 1;
    const r = size / 2;
    const inner = donut ? r * 0.58 : 0;
    let angle = -Math.PI / 2;
    const slices = data.map((d, i) => {
        const sweep = (Math.max(0, d.value) / total) * Math.PI * 2;
        const a0 = angle;
        const a1 = angle + sweep;
        angle = a1;
        const large = sweep > Math.PI ? 1 : 0;
        const x0 = r + Math.cos(a0) * r;
        const y0 = r + Math.sin(a0) * r;
        const x1 = r + Math.cos(a1) * r;
        const y1 = r + Math.sin(a1) * r;
        const xi0 = r + Math.cos(a1) * inner;
        const yi0 = r + Math.sin(a1) * inner;
        const xi1 = r + Math.cos(a0) * inner;
        const yi1 = r + Math.sin(a0) * inner;
        const color = d.tone ? toneColor[d.tone] : categoryColor(i);
        const path = donut
            ? `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${xi0} ${yi0} A ${inner} ${inner} 0 ${large} 0 ${xi1} ${yi1} Z`
            : `M ${r} ${r} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
        return { path, color, label: d.label, value: d.value };
    });

    return (
        <div ref={ref} style={mergeStyle({ position: "relative", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }, style)}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                {slices.map((s, i) => (
                    <path
                        key={i}
                        d={s.path}
                        fill={s.color}
                        onMouseMove={(event) =>
                            show(
                                event,
                                <div>
                                    <div style={{ fontWeight: 590 }}>{s.label}</div>
                                    <div>
                                        {s.value}（{((Math.max(0, s.value) / total) * 100).toFixed(1)}%）
                                    </div>
                                </div>,
                            )
                        }
                        onMouseLeave={hide}
                    />
                ))}
                {donut ? (
                    <text x={r} y={r} textAnchor="middle" dominantBaseline="middle" fill={theme.text.primary} fontSize={16} fontWeight={590}>
                        {Math.round(total)}
                    </text>
                ) : null}
            </svg>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {slices.map((s, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: theme.text.secondary }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                        <span>{s.label}</span>
                        <span style={{ color: theme.text.primary }}>{s.value}</span>
                    </div>
                ))}
            </div>
            <HoverTip tip={tip} />
        </div>
    );
}

export function LineChart({
    categories,
    series,
    height = 220,
    fill,
    valueSuffix = "",
    valuePrefix = "",
    style,
}: {
    categories: string[];
    series: ChartSeries[];
    height?: number;
    fill?: boolean;
    valueSuffix?: string;
    valuePrefix?: string;
    style?: CSSProperties;
}) {
    const theme = useHostTheme();
    const { ref, tip, show, hide } = useHoverTip();
    const width = Math.max(320, categories.length * 72);
    const pad = { t: 14, r: 14, b: 26, l: 44 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    const values = series.flatMap((item) => item.data);
    const max = Math.max(1, ...values);
    const min = Math.min(0, ...values);
    const span = max - min || 1;
    const px = (index: number) => pad.l + (index / Math.max(1, categories.length - 1)) * plotW;
    const py = (value: number) => pad.t + plotH - ((value - min) / span) * plotH;

    return (
        <div ref={ref} style={{ position: "relative" }}>
            <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={mergeStyle({ display: "block", maxWidth: width }, style)}>
            {[0, 0.5, 1].map((ratio) => {
                const value = min + span * ratio;
                return (
                    <g key={ratio}>
                        <line x1={pad.l} x2={width - pad.r} y1={py(value)} y2={py(value)} stroke={theme.stroke.tertiary} />
                        <text x={pad.l - 8} y={py(value) + 3} textAnchor="end" fontSize={10} fill={theme.text.quaternary}>
                            {valuePrefix}
                            {Math.round(value)}
                            {valueSuffix}
                        </text>
                    </g>
                );
            })}
            {series.map((item, index) => {
                const color = seriesColor(item, index);
                const line = item.data.map((value, i) => `${i === 0 ? "M" : "L"} ${px(i)} ${py(value)}`).join(" ");
                return (
                    <g key={item.name}>
                        {fill ? <path d={`${line} L ${px(item.data.length - 1)} ${py(min)} L ${px(0)} ${py(min)} Z`} fill={color} opacity={0.16} /> : null}
                        <path d={line} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
                        {item.data.map((value, i) => (
                            <circle key={i} cx={px(i)} cy={py(value)} r={2.4} fill={color} />
                        ))}
                    </g>
                );
            })}
            {categories.map((label, i) => (
                <text key={label} x={px(i)} y={height - 8} textAnchor="middle" fontSize={11} fill={theme.text.tertiary}>
                    {label}
                </text>
            ))}
            {categories.map((label, i) => {
                const bandW = plotW / Math.max(1, categories.length - 1);
                return (
                    <rect
                        key={`hit-${i}`}
                        x={px(i) - bandW / 2}
                        y={pad.t}
                        width={bandW}
                        height={plotH}
                        fill="transparent"
                        onMouseMove={(event) =>
                            show(
                                event,
                                <div>
                                    <div style={{ fontWeight: 590, marginBottom: 2 }}>{label}</div>
                                    {series.map((item, index) => (
                                        <div key={item.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <span style={{ width: 7, height: 7, borderRadius: 2, background: seriesColor(item, index), flexShrink: 0 }} />
                                            <span style={{ color: theme.text.secondary }}>{item.name}</span>
                                            <span>
                                                {valuePrefix}
                                                {item.data[i] ?? "—"}
                                                {valueSuffix}
                                            </span>
                                        </div>
                                    ))}
                                </div>,
                            )
                        }
                        onMouseLeave={hide}
                    />
                );
            })}
            </svg>
            <HoverTip tip={tip} />
        </div>
    );
}
