/**
 * Canvas 表现形式图鉴（示例数据，非真实业务）
 *
 * 用途：给 generate-canvas-report Skill 当参考底稿，说明 .canvas.tsx 能做到的全部呈现形式。
 * 要点：除了 infinite-canvas 导出的组件，运行时还允许直接写原生 HTML / SVG 标签，
 *       所以流程图、时间线、甘特、热力图、雷达图这些没有现成组件的形态都可以自绘。
 */
import {
    BarChart,
    Button,
    Callout,
    Card,
    CardBody,
    CardHeader,
    Code,
    CollapsibleSection,
    Divider,
    FlowDiagram,
    Grid,
    H1,
    H2,
    H3,
    HoverTip,
    LineChart,
    Link,
    PieChart,
    Pill,
    Row,
    Spacer,
    Stack,
    Stat,
    Swatch,
    Table,
    Text,
    UsageBar,
    chartPalette,
    colorPalette,
    toneColor,
    useCanvasState,
    useHostTheme,
    useHoverTip,
} from "infinite-canvas";

/* ── 通用骨架 ───────────────────────────────────────────── */

function Section({ index, title, hint, children }: { index: string; title: string; hint?: string; children?: any }) {
    return (
        <Stack gap={14}>
            <Row gap={10} align="end">
                <H2>
                    {index} {title}
                </H2>
                {hint ? (
                    <Text size="small" tone="quaternary" style={{ paddingBottom: 3 }}>
                        {hint}
                    </Text>
                ) : null}
            </Row>
            {children}
        </Stack>
    );
}

function Demo({ title, children }: { title: string; children?: any }) {
    return (
        <Stack gap={8}>
            <Text size="small" tone="tertiary" weight="medium">
                {title}
            </Text>
            {children}
        </Stack>
    );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
    return (
        <Row gap={14} wrap>
            {items.map((item) => (
                <Row key={item.label} gap={6} style={{ width: "auto" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: item.color, flexShrink: 0 }} />
                    <Text size="small" tone="secondary">
                        {item.label}
                    </Text>
                </Row>
            ))}
        </Row>
    );
}

/* ── 自绘图形 ───────────────────────────────────────────── */

function TrendChart({
    categories,
    series,
    height = 200,
    suffix = "",
}: {
    categories: string[];
    series: { name: string; data: number[]; color: string; area?: boolean }[];
    height?: number;
    suffix?: string;
}) {
    const theme = useHostTheme();
    const width = 640;
    const pad = { t: 14, r: 16, b: 26, l: 42 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    const values = series.flatMap((item) => item.data);
    const max = Math.max(...values);
    const min = Math.min(0, ...values);
    const span = max - min || 1;
    const px = (i: number) => pad.l + (i / Math.max(1, categories.length - 1)) * plotW;
    const py = (v: number) => pad.t + plotH - ((v - min) / span) * plotH;
    const ticks = [0, 0.5, 1].map((ratio) => min + span * ratio);

    return (
        <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
            {ticks.map((value) => (
                <g key={value}>
                    <line x1={pad.l} x2={width - pad.r} y1={py(value)} y2={py(value)} stroke={theme.stroke.tertiary} />
                    <text x={pad.l - 8} y={py(value) + 3} textAnchor="end" fontSize={10} fill={theme.text.quaternary}>
                        {Math.round(value)}
                        {suffix}
                    </text>
                </g>
            ))}
            {series.map((item) => {
                const line = item.data.map((v, i) => `${i === 0 ? "M" : "L"} ${px(i)} ${py(v)}`).join(" ");
                const area = `${line} L ${px(item.data.length - 1)} ${py(min)} L ${px(0)} ${py(min)} Z`;
                return (
                    <g key={item.name}>
                        {item.area ? <path d={area} fill={item.color} opacity={0.16} /> : null}
                        <path d={line} fill="none" stroke={item.color} strokeWidth={1.75} strokeLinejoin="round" />
                        {item.data.map((v, i) => (
                            <circle key={i} cx={px(i)} cy={py(v)} r={2.4} fill={item.color} />
                        ))}
                    </g>
                );
            })}
            {categories.map((label, i) => (
                <text key={label} x={px(i)} y={height - 8} textAnchor="middle" fontSize={10} fill={theme.text.tertiary}>
                    {label}
                </text>
            ))}
        </svg>
    );
}

function Sparkline({ points, color, width = 76, height = 20 }: { points: number[]; color: string; width?: number; height?: number }) {
    const max = Math.max(...points);
    const min = Math.min(...points);
    const span = max - min || 1;
    const d = points
        .map((v, i) => `${(i / Math.max(1, points.length - 1)) * width},${height - ((v - min) / span) * height}`)
        .join(" ");
    return (
        <svg width={width} height={height} style={{ display: "block" }}>
            <polyline points={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
        </svg>
    );
}

function Gauge({ value, label, color }: { value: number; label: string; color: string }) {
    const theme = useHostTheme();
    const size = 104;
    const stroke = 8;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const clamped = Math.min(100, Math.max(0, value));
    return (
        <Stack gap={6} style={{ width: "auto", alignItems: "center" }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={theme.fill.secondary} strokeWidth={stroke} />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke={color}
                    strokeWidth={stroke}
                    strokeLinecap="round"
                    strokeDasharray={`${(circumference * clamped) / 100} ${circumference}`}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
                <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="middle" fontSize={19} fontWeight={590} fill={theme.text.primary}>
                    {clamped}%
                </text>
            </svg>
            <Text size="small" tone="secondary">
                {label}
            </Text>
        </Stack>
    );
}

function Bullet({ label, value, target, max, color }: { label: string; value: number; target: number; max: number; color: string }) {
    const theme = useHostTheme();
    return (
        <div style={{ display: "grid", gridTemplateColumns: "88px 1fr 64px", gap: 10, alignItems: "center" }}>
            <Text size="small" tone="secondary" truncate>
                {label}
            </Text>
            <div style={{ position: "relative", height: 12, borderRadius: 3, background: theme.fill.tertiary }}>
                <div style={{ width: `${(value / max) * 100}%`, height: "100%", borderRadius: 3, background: color }} />
                <div style={{ position: "absolute", left: `${(target / max) * 100}%`, top: -3, width: 2, height: 18, background: theme.text.secondary }} />
            </div>
            <Text size="small" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {value} / {target}
            </Text>
        </div>
    );
}

function Heatmap({ rows, cols, data, color }: { rows: string[]; cols: string[]; data: number[][]; color: string }) {
    const max = Math.max(...data.flat()) || 1;
    const template = `52px repeat(${cols.length}, 1fr)`;
    return (
        <Stack gap={3}>
            <div style={{ display: "grid", gridTemplateColumns: template, gap: 3 }}>
                <span />
                {cols.map((col) => (
                    <Text key={col} size="small" tone="quaternary" style={{ textAlign: "center" }}>
                        {col}
                    </Text>
                ))}
            </div>
            {rows.map((row, ri) => (
                <div key={row} style={{ display: "grid", gridTemplateColumns: template, gap: 3, alignItems: "center" }}>
                    <Text size="small" tone="quaternary">
                        {row}
                    </Text>
                    {data[ri].map((value, ci) => (
                        <div
                            key={cols[ci]}
                            title={`${row} · ${cols[ci]} · ${value}`}
                            style={{ height: 18, borderRadius: 3, background: color, opacity: 0.08 + (value / max) * 0.82 }}
                        />
                    ))}
                </div>
            ))}
        </Stack>
    );
}

function Scatter({ points, xLabel, yLabel }: { points: { x: number; y: number; size?: number; color: string; label: string }[]; xLabel: string; yLabel: string }) {
    const theme = useHostTheme();
    /** 自绘图形想要悬停明细：useHoverTip + HoverTip，容器 relative、目标挂 onMouseMove/onMouseLeave */
    const { ref, tip, show, hide } = useHoverTip();
    const width = 420;
    const height = 220;
    const pad = { t: 12, r: 12, b: 28, l: 38 };
    const maxX = Math.max(...points.map((p) => p.x)) * 1.15;
    const maxY = Math.max(...points.map((p) => p.y)) * 1.15;
    const px = (v: number) => pad.l + (v / maxX) * (width - pad.l - pad.r);
    const py = (v: number) => height - pad.b - (v / maxY) * (height - pad.t - pad.b);
    return (
        <div ref={ref} style={{ position: "relative" }}>
            <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block", maxWidth: width }}>
                <line x1={pad.l} y1={pad.t} x2={pad.l} y2={height - pad.b} stroke={theme.stroke.secondary} />
                <line x1={pad.l} y1={height - pad.b} x2={width - pad.r} y2={height - pad.b} stroke={theme.stroke.secondary} />
                {points.map((point) => (
                    <g key={point.label}>
                        <circle
                            cx={px(point.x)}
                            cy={py(point.y)}
                            r={point.size || 6}
                            fill={point.color}
                            opacity={0.85}
                            onMouseMove={(event) =>
                                show(
                                    event,
                                    <div>
                                        <div style={{ fontWeight: 590 }}>{point.label}</div>
                                        <div>
                                            {xLabel} {point.x} · {yLabel} {point.y}%
                                        </div>
                                    </div>,
                                )
                            }
                            onMouseLeave={hide}
                        />
                        <text x={px(point.x)} y={py(point.y) - (point.size || 6) - 4} textAnchor="middle" fontSize={10} fill={theme.text.tertiary}>
                            {point.label}
                        </text>
                    </g>
                ))}
                <text x={width - pad.r} y={height - 8} textAnchor="end" fontSize={10} fill={theme.text.quaternary}>
                    {xLabel}
                </text>
                <text x={pad.l} y={pad.t - 2} textAnchor="start" fontSize={10} fill={theme.text.quaternary}>
                    {yLabel}
                </text>
            </svg>
            <HoverTip tip={tip} />
        </div>
    );
}

function Radar({ axes, series }: { axes: string[]; series: { name: string; data: number[]; color: string }[] }) {
    const theme = useHostTheme();
    const size = 230;
    const center = size / 2;
    const radius = 78;
    const angle = (i: number) => (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    const point = (i: number, ratio: number) => `${center + Math.cos(angle(i)) * radius * ratio},${center + Math.sin(angle(i)) * radius * ratio}`;
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
            {[0.25, 0.5, 0.75, 1].map((ratio) => (
                <polygon key={ratio} points={axes.map((_, i) => point(i, ratio)).join(" ")} fill="none" stroke={theme.stroke.tertiary} />
            ))}
            {axes.map((axis, i) => (
                <g key={axis}>
                    <line x1={center} y1={center} x2={center + Math.cos(angle(i)) * radius} y2={center + Math.sin(angle(i)) * radius} stroke={theme.stroke.tertiary} />
                    <text
                        x={center + Math.cos(angle(i)) * (radius + 16)}
                        y={center + Math.sin(angle(i)) * (radius + 16)}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={10}
                        fill={theme.text.tertiary}
                    >
                        {axis}
                    </text>
                </g>
            ))}
            {series.map((item) => (
                <polygon
                    key={item.name}
                    points={item.data.map((value, i) => point(i, value / 100)).join(" ")}
                    fill={item.color}
                    fillOpacity={0.18}
                    stroke={item.color}
                    strokeWidth={1.6}
                />
            ))}
        </svg>
    );
}

/* ── 流程与关系 ─────────────────────────────────────────── */

function FlowStep({ order, title, meta, color }: { order: number; title: string; meta: string; color: string }) {
    const theme = useHostTheme();
    return (
        <div style={{ flex: 1, minWidth: 132, border: `1px solid ${theme.stroke.primary}`, borderRadius: 8, padding: "10px 12px" }}>
            <Row gap={6} style={{ marginBottom: 4 }}>
                <span
                    style={{
                        width: 16,
                        height: 16,
                        borderRadius: 999,
                        background: color,
                        color: theme.bg.editor,
                        fontSize: 10,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                    }}
                >
                    {order}
                </span>
                <Text weight="medium">{title}</Text>
            </Row>
            <Text size="small" tone="tertiary">
                {meta}
            </Text>
        </div>
    );
}

function FlowArrow() {
    const theme = useHostTheme();
    return <span style={{ color: theme.text.quaternary, flexShrink: 0, fontSize: 14 }}>→</span>;
}

function BranchFlow() {
    const theme = useHostTheme();
    const box = (x: number, y: number, w: number, h: number, label: string, stroke: string) => (
        <g key={label}>
            <rect x={x} y={y} width={w} height={h} rx={7} fill={theme.fill.quaternary} stroke={stroke} />
            <text x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="middle" fontSize={12} fill={theme.text.primary}>
                {label}
            </text>
        </g>
    );
    return (
        <svg width="100%" viewBox="0 0 760 220" style={{ display: "block" }}>
            <defs>
                <marker id="gallery-branch-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 Z" fill={theme.text.quaternary} />
                </marker>
            </defs>
            {box(16, 86, 118, 44, "接收数据", theme.stroke.primary)}
            <polygon points="200,108 268,72 336,108 268,144" fill={theme.fill.quaternary} stroke={toneColor.warning} />
            <text x={268} y={108} textAnchor="middle" dominantBaseline="middle" fontSize={12} fill={theme.text.primary}>
                字段完整？
            </text>
            {box(410, 28, 130, 44, "直接建模", toneColor.success)}
            {box(410, 148, 130, 44, "回补缺失值", toneColor.danger)}
            {box(612, 86, 118, 44, "产出报告", theme.stroke.primary)}
            <path d="M134 108 L196 108" stroke={theme.text.quaternary} fill="none" markerEnd="url(#gallery-branch-arrow)" />
            <path d="M336 108 L373 108 L373 50 L406 50" stroke={theme.text.quaternary} fill="none" markerEnd="url(#gallery-branch-arrow)" />
            <path d="M268 144 L268 170 L406 170" stroke={theme.text.quaternary} fill="none" markerEnd="url(#gallery-branch-arrow)" />
            <path d="M540 50 L576 50 L576 108 L608 108" stroke={theme.text.quaternary} fill="none" markerEnd="url(#gallery-branch-arrow)" />
            <path d="M540 170 L576 170 L576 112" stroke={theme.text.quaternary} fill="none" markerEnd="url(#gallery-branch-arrow)" />
            <text x={352} y={72} fontSize={10} fill={toneColor.success}>
                是
            </text>
            <text x={280} y={166} fontSize={10} fill={toneColor.danger}>
                否
            </text>
        </svg>
    );
}

function Swimlane({ lanes }: { lanes: { role: string; color: string; steps: string[] }[] }) {
    const theme = useHostTheme();
    return (
        <Stack gap={0}>
            {lanes.map((lane, index) => (
                <div
                    key={lane.role}
                    style={{
                        display: "grid",
                        gridTemplateColumns: "104px 1fr",
                        gap: 12,
                        alignItems: "center",
                        padding: "10px 0",
                        borderTop: index === 0 ? `1px solid ${theme.stroke.secondary}` : "none",
                        borderBottom: `1px solid ${theme.stroke.secondary}`,
                    }}
                >
                    <Row gap={6} style={{ width: "auto" }}>
                        <span style={{ width: 3, height: 14, borderRadius: 2, background: lane.color, flexShrink: 0 }} />
                        <Text size="small" tone="secondary">
                            {lane.role}
                        </Text>
                    </Row>
                    <Row gap={8} wrap>
                        {lane.steps.map((step, stepIndex) => (
                            <Row key={step} gap={8} style={{ width: "auto" }}>
                                <span
                                    style={{
                                        border: `1px solid ${theme.stroke.primary}`,
                                        borderRadius: 6,
                                        padding: "4px 10px",
                                        fontSize: 12,
                                        color: theme.text.primary,
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {step}
                                </span>
                                {stepIndex < lane.steps.length - 1 ? <FlowArrow /> : null}
                            </Row>
                        ))}
                    </Row>
                </div>
            ))}
        </Stack>
    );
}

function TreeChart() {
    const theme = useHostTheme();
    const node = (x: number, y: number, label: string, color: string) => (
        <g key={label}>
            <rect x={x} y={y} width={116} height={34} rx={6} fill={theme.fill.quaternary} stroke={color} />
            <text x={x + 58} y={y + 17} textAnchor="middle" dominantBaseline="middle" fontSize={11} fill={theme.text.primary}>
                {label}
            </text>
        </g>
    );
    return (
        <svg width="100%" viewBox="0 0 640 210" style={{ display: "block" }}>
            {node(262, 10, "总营收 1,240 万", theme.stroke.primary)}
            {node(60, 88, "自营渠道 720", colorPalette.blue)}
            {node(262, 88, "分销渠道 380", colorPalette.purple)}
            {node(464, 88, "其它 140", colorPalette.gray)}
            {node(10, 166, "官网 460", colorPalette.cyan)}
            {node(140, 166, "门店 260", colorPalette.cyan)}
            {node(262, 166, "代理商 380", colorPalette.pink)}
            <path d="M320 44 L320 66 M118 88 L118 66 L522 66 L522 88 M320 66 L320 88" stroke={theme.stroke.secondary} fill="none" />
            <path d="M118 122 L118 144 L68 144 L68 166 M118 144 L198 144 L198 166" stroke={theme.stroke.secondary} fill="none" />
            <path d="M320 122 L320 166" stroke={theme.stroke.secondary} fill="none" />
        </svg>
    );
}

function StateMachine() {
    const theme = useHostTheme();
    const states: { x: number; label: string; color: string }[] = [
        { x: 30, label: "草稿", color: colorPalette.gray },
        { x: 220, label: "评审中", color: colorPalette.yellow },
        { x: 410, label: "已发布", color: colorPalette.green },
    ];
    return (
        <svg width="100%" viewBox="0 0 600 140" style={{ display: "block" }}>
            <defs>
                <marker id="gallery-state-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 Z" fill={theme.text.quaternary} />
                </marker>
            </defs>
            {states.map((state) => (
                <g key={state.label}>
                    <rect x={state.x} y={52} width={140} height={40} rx={20} fill={theme.fill.quaternary} stroke={state.color} />
                    <text x={state.x + 70} y={72} textAnchor="middle" dominantBaseline="middle" fontSize={12} fill={theme.text.primary}>
                        {state.label}
                    </text>
                </g>
            ))}
            <path d="M170 72 L216 72" stroke={theme.text.quaternary} markerEnd="url(#gallery-state-arrow)" />
            <path d="M360 72 L406 72" stroke={theme.text.quaternary} markerEnd="url(#gallery-state-arrow)" />
            <path d="M290 52 C290 12, 100 12, 100 48" stroke={theme.text.quaternary} fill="none" markerEnd="url(#gallery-state-arrow)" />
            <text x={186} y={64} fontSize={10} fill={theme.text.tertiary}>
                提交
            </text>
            <text x={376} y={64} fontSize={10} fill={theme.text.tertiary}>
                通过
            </text>
            <text x={186} y={20} fontSize={10} fill={theme.text.tertiary}>
                打回
            </text>
        </svg>
    );
}

function NetworkGraph() {
    const theme = useHostTheme();
    const nodes = [
        { id: "订单", x: 300, y: 70, color: colorPalette.blue, r: 26 },
        { id: "用户", x: 110, y: 40, color: colorPalette.purple, r: 20 },
        { id: "库存", x: 110, y: 140, color: colorPalette.green, r: 20 },
        { id: "支付", x: 490, y: 40, color: colorPalette.yellow, r: 20 },
        { id: "物流", x: 490, y: 140, color: colorPalette.orange, r: 20 },
    ];
    const edges: [string, string][] = [
        ["用户", "订单"],
        ["库存", "订单"],
        ["订单", "支付"],
        ["订单", "物流"],
        ["支付", "物流"],
    ];
    const find = (id: string) => nodes.find((node) => node.id === id)!;
    return (
        <svg width="100%" viewBox="0 0 600 190" style={{ display: "block" }}>
            {edges.map(([from, to]) => (
                <line key={`${from}-${to}`} x1={find(from).x} y1={find(from).y} x2={find(to).x} y2={find(to).y} stroke={theme.stroke.secondary} />
            ))}
            {nodes.map((node) => (
                <g key={node.id}>
                    <circle cx={node.x} cy={node.y} r={node.r} fill={node.color} opacity={0.22} stroke={node.color} />
                    <text x={node.x} y={node.y} textAnchor="middle" dominantBaseline="middle" fontSize={11} fill={theme.text.primary}>
                        {node.id}
                    </text>
                </g>
            ))}
        </svg>
    );
}

/* ── 时间与计划 ─────────────────────────────────────────── */

function Timeline({ items }: { items: { time: string; title: string; desc: string; color: string }[] }) {
    const theme = useHostTheme();
    return (
        <Stack gap={0}>
            {items.map((item, index) => (
                <div key={item.title} style={{ display: "grid", gridTemplateColumns: "72px 14px 1fr", gap: 10 }}>
                    <Text size="small" tone="quaternary" style={{ paddingTop: 1 }}>
                        {item.time}
                    </Text>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <span style={{ width: 9, height: 9, borderRadius: 999, background: item.color, marginTop: 4, flexShrink: 0 }} />
                        {index < items.length - 1 ? <span style={{ flex: 1, width: 1, background: theme.stroke.secondary }} /> : null}
                    </div>
                    <Stack gap={2} style={{ paddingBottom: index < items.length - 1 ? 16 : 0 }}>
                        <Text weight="medium">{item.title}</Text>
                        <Text size="small" tone="tertiary">
                            {item.desc}
                        </Text>
                    </Stack>
                </div>
            ))}
        </Stack>
    );
}

function Gantt({ months, tasks, today }: { months: string[]; tasks: { name: string; start: number; span: number; color: string; progress: number }[]; today: number }) {
    const theme = useHostTheme();
    const total = months.length;
    return (
        <Stack gap={6}>
            <div style={{ display: "grid", gridTemplateColumns: `112px repeat(${total}, 1fr)`, gap: 0 }}>
                <span />
                {months.map((month) => (
                    <Text key={month} size="small" tone="quaternary" style={{ textAlign: "center" }}>
                        {month}
                    </Text>
                ))}
            </div>
            {tasks.map((task) => (
                <div key={task.name} style={{ display: "grid", gridTemplateColumns: "112px 1fr", gap: 8, alignItems: "center" }}>
                    <Text size="small" tone="secondary" truncate>
                        {task.name}
                    </Text>
                    <div style={{ position: "relative", height: 20, background: theme.fill.quaternary, borderRadius: 4 }}>
                        <div
                            style={{
                                position: "absolute",
                                left: `${(task.start / total) * 100}%`,
                                width: `${(task.span / total) * 100}%`,
                                top: 3,
                                height: 14,
                                borderRadius: 4,
                                background: task.color,
                                opacity: 0.35,
                            }}
                        />
                        <div
                            style={{
                                position: "absolute",
                                left: `${(task.start / total) * 100}%`,
                                width: `${((task.span * task.progress) / 100 / total) * 100}%`,
                                top: 3,
                                height: 14,
                                borderRadius: 4,
                                background: task.color,
                            }}
                        />
                        <div style={{ position: "absolute", left: `${(today / total) * 100}%`, top: -2, width: 1, height: 24, background: toneColor.danger }} />
                    </div>
                </div>
            ))}
        </Stack>
    );
}

function ContribCalendar({ weeks, color }: { weeks: number[][]; color: string }) {
    const max = Math.max(...weeks.flat()) || 1;
    return (
        <div style={{ display: "grid", gridTemplateRows: "repeat(7, 11px)", gridAutoFlow: "column", gap: 3, width: "fit-content" }}>
            {weeks.map((week, wi) =>
                week.map((value, di) => (
                    <span
                        key={`${wi}-${di}`}
                        title={`第 ${wi + 1} 周 · ${value} 次`}
                        style={{ width: 11, height: 11, borderRadius: 2, background: color, opacity: 0.08 + (value / max) * 0.85 }}
                    />
                )),
            )}
        </div>
    );
}

/* ── 看板 / 清单 / 排名 / 对比 ───────────────────────────── */

function MiniCard({ title, meta, color }: { title: string; meta: string; color: string }) {
    const theme = useHostTheme();
    return (
        <div style={{ border: `1px solid ${theme.stroke.secondary}`, borderLeft: `2px solid ${color}`, borderRadius: 6, padding: "8px 10px" }}>
            <Text size="small">{title}</Text>
            <Text size="small" tone="quaternary">
                {meta}
            </Text>
        </div>
    );
}

function CheckItem({ done, text, owner }: { done: boolean; text: string; owner: string }) {
    const theme = useHostTheme();
    return (
        <Row gap={8}>
            <span
                style={{
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    flexShrink: 0,
                    border: `1px solid ${done ? toneColor.success : theme.stroke.primary}`,
                    background: done ? toneColor.success : "transparent",
                    color: theme.bg.editor,
                    fontSize: 10,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            >
                {done ? "✓" : ""}
            </span>
            <Text size="small" tone={done ? "quaternary" : "primary"} style={{ textDecoration: done ? "line-through" : undefined }}>
                {text}
            </Text>
            <Spacer />
            <Text size="small" tone="tertiary">
                {owner}
            </Text>
        </Row>
    );
}

function RankRow({ rank, name, value, max, delta, color }: { rank: number; name: string; value: number; max: number; delta: number; color: string }) {
    const theme = useHostTheme();
    return (
        <div style={{ display: "grid", gridTemplateColumns: "20px 92px 1fr 62px 52px", gap: 10, alignItems: "center" }}>
            <Text size="small" tone="quaternary">
                {rank}
            </Text>
            <Text size="small" truncate>
                {name}
            </Text>
            <div style={{ height: 6, borderRadius: 3, background: theme.fill.tertiary }}>
                <div style={{ width: `${(value / max) * 100}%`, height: "100%", borderRadius: 3, background: color }} />
            </div>
            <Text size="small" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {value}
            </Text>
            <Text size="small" style={{ textAlign: "right", color: delta >= 0 ? toneColor.success : toneColor.danger }}>
                {delta >= 0 ? "↑" : "↓"} {Math.abs(delta)}%
            </Text>
        </div>
    );
}

function DiffBlock({ lines }: { lines: { type: "add" | "del" | "ctx"; text: string }[] }) {
    const theme = useHostTheme();
    return (
        <div style={{ border: `1px solid ${theme.stroke.primary}`, borderRadius: 8, overflow: "hidden", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>
            {lines.map((line, index) => (
                <div
                    key={index}
                    style={{
                        display: "flex",
                        gap: 8,
                        padding: "3px 10px",
                        background: line.type === "add" ? theme.diff.insertedLine : line.type === "del" ? theme.diff.removedLine : "transparent",
                        borderLeft: `3px solid ${line.type === "add" ? theme.diff.stripAdded : line.type === "del" ? theme.diff.stripRemoved : "transparent"}`,
                        color: theme.text.primary,
                    }}
                >
                    <span style={{ color: theme.text.quaternary, width: 10, flexShrink: 0 }}>{line.type === "add" ? "+" : line.type === "del" ? "-" : " "}</span>
                    <span style={{ whiteSpace: "pre-wrap" }}>{line.text}</span>
                </div>
            ))}
        </div>
    );
}

function Quadrant({ items }: { items: { x: "低" | "高"; y: "低" | "高"; title: string; note: string; color: string }[] }) {
    const theme = useHostTheme();
    const cells: { x: "低" | "高"; y: "低" | "高" }[] = [
        { x: "低", y: "高" },
        { x: "高", y: "高" },
        { x: "低", y: "低" },
        { x: "高", y: "低" },
    ];
    return (
        <Row gap={8} align="stretch">
            <Text size="small" tone="quaternary" style={{ writingMode: "vertical-rl", textAlign: "center" }}>
                影响面 高 → 低
            </Text>
            <Stack gap={6}>
                <Grid columns={2} gap={6}>
                    {cells.map((cell) => {
                        const hit = items.filter((item) => item.x === cell.x && item.y === cell.y);
                        return (
                            <div key={`${cell.x}-${cell.y}`} style={{ border: `1px dashed ${theme.stroke.secondary}`, borderRadius: 8, padding: 10, minHeight: 86 }}>
                                <Text size="small" tone="quaternary">
                                    成本{cell.x} · 影响{cell.y}
                                </Text>
                                <Stack gap={4} style={{ marginTop: 6 }}>
                                    {hit.length ? (
                                        hit.map((item) => (
                                            <Row key={item.title} gap={6}>
                                                <span style={{ width: 6, height: 6, borderRadius: 999, background: item.color, flexShrink: 0 }} />
                                                <Text size="small">{item.title}</Text>
                                                <Text size="small" tone="quaternary">
                                                    {item.note}
                                                </Text>
                                            </Row>
                                        ))
                                    ) : (
                                        <Text size="small" tone="quaternary">
                                            —
                                        </Text>
                                    )}
                                </Stack>
                            </div>
                        );
                    })}
                </Grid>
                <Text size="small" tone="quaternary" style={{ textAlign: "center" }}>
                    投入成本 低 → 高
                </Text>
            </Stack>
        </Row>
    );
}

/* ── 主组件 ─────────────────────────────────────────────── */

export default function CanvasGallery() {
    const theme = useHostTheme();
    const [tab, setTab] = useCanvasState("gallery-tab", "trend");
    const weeks = [3, 1, 0, 5, 2, 4, 6, 1, 0, 2, 3, 5].map((seed) => [seed, (seed + 2) % 7, (seed + 4) % 7, (seed + 1) % 7, (seed + 5) % 7, (seed + 3) % 7, seed % 3]);

    return (
        <Stack gap={28}>
            <Stack gap={10}>
                <H1>Canvas 表现形式图鉴</H1>
                <Text tone="secondary" size="small">
                    示例数据 · 用于展示 .canvas.tsx 可用的全部呈现形式，不代表真实业务结论
                </Text>
                <Row gap={6} wrap>
                    <Pill size="sm">排版</Pill>
                    <Pill size="sm">指标</Pill>
                    <Pill size="sm">表格</Pill>
                    <Pill size="sm">图表</Pill>
                    <Pill size="sm">自绘图形</Pill>
                    <Pill size="sm">流程关系</Pill>
                    <Pill size="sm">时间计划</Pill>
                    <Pill size="sm">看板清单</Pill>
                    <Pill size="sm">对比</Pill>
                    <Pill size="sm">交互</Pill>
                </Row>
                <Callout tone="info" title="怎么用这份文件">
                    上半部分是 <Code>infinite-canvas</Code> 直接提供的组件，下半部分是用原生 SVG / div 自绘的形态。做报告时按题材挑 3～6 个区块组合即可，不必全用。
                </Callout>
            </Stack>

            <Divider />

            <Section index="01" title="排版与文本" hint="H1/H2/H3 · Text · Code · Link · Divider">
                <Stack gap={6}>
                    <H3>三级标题用于区块内分层</H3>
                    <Text>正文默认 14px，用来写一句完整的结论或说明。</Text>
                    <Text tone="secondary">次级文本承载补充信息，比如口径、样本量、时间范围。</Text>
                    <Text tone="tertiary" size="small">
                        三级小字适合放脚注与来源。
                    </Text>
                    <Text tone="quaternary" size="small">
                        四级最弱，用于占位或极次要提示。
                    </Text>
                    <Row gap={8} wrap>
                        <Text size="small" weight="semibold">
                            半粗强调
                        </Text>
                        <Text size="small" italic>
                            斜体备注
                        </Text>
                        <Text size="small">
                            行内代码 <Code>npm run dev</Code>
                        </Text>
                        <Link href="https://canvas.best">外部链接</Link>
                    </Row>
                    <div style={{ border: `1px solid ${theme.stroke.secondary}`, borderRadius: 8, padding: 12, background: theme.fill.quaternary }}>
                        <pre style={{ margin: 0, fontSize: 12, lineHeight: "18px", color: theme.text.secondary, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", whiteSpace: "pre-wrap" }}>
{`# 代码块用原生 pre 即可
export default function Report() {
  return <Stack gap={20}>…</Stack>;
}`}
                        </pre>
                    </div>
                </Stack>
            </Section>

            <Section index="02" title="指标与状态" hint="Stat · Pill · Callout">
                <Grid columns={4} gap={12}>
                    <Stat value="12.6k" label="访问量" />
                    <Stat value="2.82%" label="转化率" tone="success" />
                    <Stat value="18.4%" label="ACoS" tone="warning" />
                    <Stat value="-6.1%" label="环比" tone="danger" />
                </Grid>
                <Row gap={8} wrap>
                    <Pill>默认标签</Pill>
                    <Pill active>选中标签</Pill>
                    <Pill size="sm">小号标签</Pill>
                    <Pill leadingContent={<Swatch color="green" />}>带色块</Pill>
                    <Pill keyboardHint="⌘K">带快捷键</Pill>
                    <Pill title="悬停显示说明">带 title 提示</Pill>
                </Row>
                <Grid columns={2} gap={12}>
                    <Callout tone="success" title="进展">
                        自然流量连续 3 周上升，占比回到 62%。
                    </Callout>
                    <Callout tone="warning" title="风险">
                        加购到下单掉点 72%，高于同类目均值。
                    </Callout>
                    <Callout tone="danger" title="止损">
                        3 个广告词组 ACoS 超过 60%，建议立即暂停。
                    </Callout>
                    <Callout tone="neutral" title="口径">
                        全部数值来自示例数据集，缺失项写「—」。
                    </Callout>
                </Grid>
            </Section>

            <Section index="03" title="容器与分组" hint="Card · CardHeader · CollapsibleSection">
                <Grid columns={2} gap={12}>
                    <Card>
                        <CardHeader trailing={<Pill size="sm">近 7 日</Pill>}>渠道概览</CardHeader>
                        <CardBody>
                            <Stack gap={8}>
                                <Row justify="space-between">
                                    <Text size="small" tone="secondary">
                                        自然流量
                                    </Text>
                                    <Text size="small">7,820</Text>
                                </Row>
                                <Row justify="space-between">
                                    <Text size="small" tone="secondary">
                                        付费流量
                                    </Text>
                                    <Text size="small">4,780</Text>
                                </Row>
                            </Stack>
                        </CardBody>
                    </Card>
                    <Card variant="borderless" style={{ background: theme.fill.quaternary, borderRadius: 8 }}>
                        <CardBody>
                            <Stack gap={6}>
                                <Text weight="medium">无边框卡片</Text>
                                <Text size="small" tone="tertiary">
                                    适合放在网格里做弱分组，不抢主图表的视觉权重。
                                </Text>
                            </Stack>
                        </CardBody>
                    </Card>
                </Grid>
                <CollapsibleSection title="展开查看计算口径" count={3}>
                    <Stack gap={4}>
                        <Text size="small" tone="secondary">
                            转化率 = 下单数 / 访问量
                        </Text>
                        <Text size="small" tone="secondary">
                            ACoS = 广告花费 / 广告销售额
                        </Text>
                        <Text size="small" tone="secondary">
                            环比 = (本期 - 上期) / 上期
                        </Text>
                    </Stack>
                </CollapsibleSection>
            </Section>

            <Section index="04" title="表格" hint="Table · 行内嵌 Pill 与迷你趋势">
                <Table
                    striped
                    headers={["渠道", "访问", "转化率", "趋势", "状态"]}
                    columnAlign={["left", "right", "right", "center", "center"]}
                    rows={[
                        ["自然搜索", "7,820", "3.11%", <Sparkline key="a" points={[4, 6, 5, 8, 9, 11]} color={toneColor.success} />, <Pill key="a2" size="sm">健康</Pill>],
                        ["付费广告", "4,780", "2.24%", <Sparkline key="b" points={[9, 8, 7, 7, 5, 4]} color={toneColor.danger} />, <Pill key="b2" size="sm">需优化</Pill>],
                        ["社交引荐", "1,240", "1.86%", <Sparkline key="c" points={[3, 4, 4, 5, 6, 6]} color={toneColor.info} />, <Pill key="c2" size="sm">观察</Pill>],
                        ["邮件唤醒", "—", "—", <Text key="d" size="small" tone="quaternary">无数据</Text>, <Pill key="d2" size="sm">未开启</Pill>],
                    ]}
                />
                <Demo title="无边框紧凑表（放进卡片时更干净）">
                    <Table framed={false} headers={["指标", "本期", "上期"]} columnAlign={["left", "right", "right"]} rows={[["客单价", "¥86", "¥92"], ["退款率", "1.8%", "2.4%"]]} />
                </Demo>
                <Demo title="空态">
                    <Table headers={["时间", "事件"]} rows={[]} emptyMessage="本期没有异常事件" />
                </Demo>
            </Section>

            <Section index="05" title="标准图表" hint="BarChart 四种形态 · PieChart · UsageBar · 均支持悬停看明细">
                <Grid columns={2} gap={20}>
                    <Demo title="横向排行 / 漏斗（单序列默认就是横条）">
                        <BarChart horizontal categories={["曝光", "点击", "加购", "下单"]} series={[{ name: "人数", data: [100000, 8200, 2100, 590] }]} />
                    </Demo>
                    <Demo title="竖向分组柱（两个及以上序列自动切换）">
                        <BarChart
                            categories={["1月", "2月", "3月", "4月", "5月"]}
                            series={[
                                { name: "自营", data: [120, 148, 132, 176, 190] },
                                { name: "分销", data: [86, 92, 104, 98, 121] },
                            ]}
                        />
                        <Legend items={[{ label: "自营", color: chartPalette.goldenYellow }, { label: "分销", color: chartPalette.green }]} />
                    </Demo>
                    <Demo title="堆叠柱（单序列想要竖条时也用 stacked）">
                        <BarChart
                            stacked
                            categories={["华东", "华南", "华北", "西部"]}
                            series={[
                                { name: "新客", data: [42, 38, 30, 18] },
                                { name: "老客", data: [58, 44, 36, 22] },
                            ]}
                        />
                    </Demo>
                    <Demo title="百分比堆叠（看结构占比）">
                        <BarChart
                            normalized
                            categories={["Q1", "Q2", "Q3", "Q4"]}
                            series={[
                                { name: "自然", data: [62, 58, 66, 70] },
                                { name: "付费", data: [38, 42, 34, 30] },
                            ]}
                        />
                    </Demo>
                </Grid>
                <Demo title="折线 / 面积（多序列趋势）">
                    <LineChart
                        fill
                        categories={["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"]}
                        series={[
                            { name: "访问", data: [42, 55, 48, 66, 72, 69, 84, 91] },
                            { name: "下单", data: [12, 18, 16, 22, 25, 21, 30, 34] },
                        ]}
                    />
                    <Legend items={[{ label: "访问", color: chartPalette.goldenYellow }, { label: "下单", color: chartPalette.green }]} />
                </Demo>
                <Grid columns={2} gap={20}>
                    <Demo title="环图（中间自动显示合计）">
                        <PieChart
                            donut
                            data={[
                                { label: "品牌词", value: 42, tone: "success" },
                                { label: "品类词", value: 33, tone: "info" },
                                { label: "防守词", value: 15, tone: "warning" },
                                { label: "浪费词", value: 10, tone: "danger" },
                            ]}
                        />
                    </Demo>
                    <Demo title="用量条（一条内表达构成 + 余量）">
                        <Stack gap={10}>
                            <UsageBar
                                total={100}
                                topLeftLabel="存储用量"
                                topRightLabel="76 GB / 100 GB"
                                segments={[
                                    { id: "img", value: 42, color: "purple" },
                                    { id: "video", value: 22, color: "blue" },
                                    { id: "doc", value: 12, color: "green" },
                                ]}
                            />
                            <Legend
                                items={[
                                    { label: "图片 42", color: colorPalette.purple },
                                    { label: "视频 22", color: colorPalette.blue },
                                    { label: "文档 12", color: colorPalette.green },
                                ]}
                            />
                        </Stack>
                    </Demo>
                </Grid>
            </Section>

            <Section index="06" title="自绘图形" hint="SDK 没有的图表，用原生 SVG 画即可">
                <Demo title="自绘趋势（需要自定义网格、坐标或标注时才这么做）">
                    <TrendChart
                        categories={["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"]}
                        series={[
                            { name: "访问", data: [42, 55, 48, 66, 72, 69, 84, 91], color: chartPalette.blue, area: true },
                            { name: "下单", data: [12, 18, 16, 22, 25, 21, 30, 34], color: chartPalette.brightOrange },
                        ]}
                    />
                    <Legend items={[{ label: "访问", color: chartPalette.blue }, { label: "下单", color: chartPalette.brightOrange }]} />
                </Demo>
                <Grid columns="1fr 1fr" gap={20}>
                    <Demo title="进度环">
                        <Row gap={16} wrap>
                            <Gauge value={76} label="目标完成度" color={toneColor.success} />
                            <Gauge value={38} label="库存周转" color={toneColor.warning} />
                        </Row>
                    </Demo>
                    <Demo title="子弹图（实际 vs 目标）">
                        <Stack gap={10}>
                            <Bullet label="华东" value={182} target={200} max={260} color={chartPalette.blue} />
                            <Bullet label="华南" value={143} target={160} max={260} color={chartPalette.green} />
                            <Bullet label="华北" value={96} target={150} max={260} color={chartPalette.brightOrange} />
                        </Stack>
                    </Demo>
                </Grid>
                <Grid columns="1fr 1fr" gap={20}>
                    <Demo title="热力矩阵（时段 × 星期）">
                        <Heatmap
                            color={chartPalette.indigo}
                            cols={["一", "二", "三", "四", "五", "六", "日"]}
                            rows={["09:00", "13:00", "17:00", "21:00"]}
                            data={[
                                [12, 18, 15, 20, 22, 8, 6],
                                [30, 34, 28, 36, 40, 18, 14],
                                [22, 26, 24, 30, 44, 30, 26],
                                [16, 20, 18, 24, 38, 46, 42],
                            ]}
                        />
                    </Demo>
                    <Demo title="散点 / 气泡（找异常象限）">
                        <Scatter
                            xLabel="点击量"
                            yLabel="转化率"
                            points={[
                                { x: 820, y: 3.1, color: chartPalette.green, label: "A", size: 8 },
                                { x: 1240, y: 2.2, color: chartPalette.blue, label: "B", size: 10 },
                                { x: 460, y: 1.2, color: chartPalette.brightOrange, label: "C", size: 6 },
                                { x: 1580, y: 0.8, color: chartPalette.darkAmber, label: "D", size: 12 },
                            ]}
                        />
                    </Demo>
                </Grid>
                <Grid columns="auto 1fr" gap={20}>
                    <Demo title="雷达图（多维打分对比）">
                        <Radar
                            axes={["价格", "质量", "物流", "服务", "复购"]}
                            series={[
                                { name: "本店", data: [82, 74, 66, 88, 58], color: chartPalette.blue },
                                { name: "竞品", data: [64, 86, 78, 60, 72], color: chartPalette.warmPink },
                            ]}
                        />
                        <Legend items={[{ label: "本店", color: chartPalette.blue }, { label: "竞品", color: chartPalette.warmPink }]} />
                    </Demo>
                    <Demo title="贡献日历（12 周 × 7 天）">
                        <ContribCalendar weeks={weeks} color={colorPalette.green} />
                    </Demo>
                </Grid>
            </Section>

            <Section index="07" title="流程与关系" hint="FlowDiagram 只填数据 · 其余自绘">
                <Demo title="FlowDiagram：给节点和边就自动分层布线，不用算坐标（首选）">
                    <FlowDiagram
                        nodes={[
                            { id: "in", label: "接收数据", shape: "terminal" },
                            { id: "check", label: "字段完整？", shape: "decision", tone: "warning" },
                            { id: "model", label: "直接建模", note: "走标准管线", tone: "success" },
                            { id: "fix", label: "回补缺失值", note: "人工确认", tone: "danger" },
                            { id: "out", label: "产出报告", shape: "terminal" },
                        ]}
                        edges={[
                            { from: "in", to: "check" },
                            { from: "check", to: "model", label: "是" },
                            { from: "check", to: "fix", label: "否" },
                            { from: "model", to: "out" },
                            { from: "fix", to: "out" },
                        ]}
                    />
                </Demo>
                <Demo title="FlowDiagram 纵向（direction=column，适合审批链、回退）">
                    <FlowDiagram
                        direction="column"
                        nodes={[
                            { id: "draft", label: "提交草稿", shape: "terminal" },
                            { id: "review", label: "主管评审", shape: "decision", tone: "warning" },
                            { id: "publish", label: "发布上线", tone: "success" },
                            { id: "reject", label: "打回修改", tone: "danger" },
                        ]}
                        edges={[
                            { from: "draft", to: "review" },
                            { from: "review", to: "publish", label: "通过" },
                            { from: "review", to: "reject", label: "驳回" },
                            { from: "reject", to: "draft", label: "重提" },
                        ]}
                    />
                </Demo>
                <Demo title="线性流程（步骤卡 + 箭头，想在节点里放富文本时用）">
                    <Row gap={8} wrap align="stretch">
                        <FlowStep order={1} title="采集" meta="接入订单与广告日志" color={colorPalette.blue} />
                        <FlowArrow />
                        <FlowStep order={2} title="清洗" meta="去重 · 补缺 · 对齐口径" color={colorPalette.purple} />
                        <FlowArrow />
                        <FlowStep order={3} title="建模" meta="漏斗与归因拆解" color={colorPalette.yellow} />
                        <FlowArrow />
                        <FlowStep order={4} title="产出" meta="报告 + 明细 csv" color={colorPalette.green} />
                    </Row>
                </Demo>
                <Demo title="手绘分支流程（需要完全掌控位置时才这么写）">
                    <BranchFlow />
                </Demo>
                <Demo title="泳道流程（谁在什么阶段做什么）">
                    <Swimlane
                        lanes={[
                            { role: "运营", color: colorPalette.blue, steps: ["提出需求", "确认口径", "验收"] },
                            { role: "分析", color: colorPalette.purple, steps: ["取数", "建模", "出报告"] },
                            { role: "研发", color: colorPalette.green, steps: ["埋点补齐", "任务调度"] },
                        ]}
                    />
                </Demo>
                <Grid columns={2} gap={20}>
                    <Demo title="层级树（拆解构成）">
                        <TreeChart />
                    </Demo>
                    <Demo title="状态机（流转与回退）">
                        <StateMachine />
                    </Demo>
                </Grid>
                <Demo title="关系网络（模块依赖）">
                    <NetworkGraph />
                </Demo>
            </Section>

            <Section index="08" title="时间与计划" hint="时间线 · 甘特 · 里程碑">
                <Grid columns="1fr 1fr" gap={20}>
                    <Demo title="事件时间线">
                        <Timeline
                            items={[
                                { time: "第 1 周", title: "口径对齐", desc: "确认漏斗四段定义与去重规则", color: colorPalette.green },
                                { time: "第 2 周", title: "数据回补", desc: "补齐加购埋点缺失的 3 天", color: colorPalette.yellow },
                                { time: "第 3 周", title: "首版报告", desc: "输出渠道结构与广告效率结论", color: colorPalette.blue },
                                { time: "第 5 周", title: "复盘", desc: "对比调整前后转化差异", color: colorPalette.gray },
                            ]}
                        />
                    </Demo>
                    <Demo title="甘特（红线为今天）">
                        <Gantt
                            months={["1月", "2月", "3月", "4月", "5月", "6月"]}
                            today={2.6}
                            tasks={[
                                { name: "数据治理", start: 0, span: 2, color: chartPalette.blue, progress: 100 },
                                { name: "指标建模", start: 1.5, span: 2, color: chartPalette.purple, progress: 70 },
                                { name: "报告自动化", start: 3, span: 2, color: chartPalette.green, progress: 20 },
                                { name: "推广复盘", start: 4.5, span: 1.5, color: chartPalette.brightOrange, progress: 0 },
                            ]}
                        />
                    </Demo>
                </Grid>
            </Section>

            <Section index="09" title="看板 · 清单 · 排名" hint="任务与优先级类内容">
                <Grid columns={3} gap={12}>
                    <Card>
                        <CardHeader trailing={<Text size="small" tone="quaternary">3</Text>}>待处理</CardHeader>
                        <CardBody>
                            <Stack gap={8}>
                                <MiniCard title="暂停高 ACoS 词组" meta="广告 · 高优先" color={toneColor.danger} />
                                <MiniCard title="补齐加购埋点" meta="研发 · 本周" color={toneColor.warning} />
                                <MiniCard title="详情页加信任模块" meta="设计 · 待排期" color={colorPalette.gray} />
                            </Stack>
                        </CardBody>
                    </Card>
                    <Card>
                        <CardHeader trailing={<Text size="small" tone="quaternary">2</Text>}>进行中</CardHeader>
                        <CardBody>
                            <Stack gap={8}>
                                <MiniCard title="渠道归因重算" meta="分析 · 60%" color={colorPalette.blue} />
                                <MiniCard title="库存预警规则" meta="运营 · 30%" color={colorPalette.purple} />
                            </Stack>
                        </CardBody>
                    </Card>
                    <Card>
                        <CardHeader trailing={<Text size="small" tone="quaternary">2</Text>}>已完成</CardHeader>
                        <CardBody>
                            <Stack gap={8}>
                                <MiniCard title="口径文档定稿" meta="全员确认" color={toneColor.success} />
                                <MiniCard title="首版漏斗报告" meta="已交付" color={toneColor.success} />
                            </Stack>
                        </CardBody>
                    </Card>
                </Grid>
                <Grid columns={2} gap={20}>
                    <Demo title="行动清单">
                        <Stack gap={8}>
                            <CheckItem done text="确认漏斗四段口径" owner="运营" />
                            <CheckItem done text="补齐 3 天缺失埋点" owner="研发" />
                            <CheckItem done={false} text="暂停 3 个高 ACoS 词组" owner="广告" />
                            <CheckItem done={false} text="详情页补充评测素材" owner="设计" />
                        </Stack>
                    </Demo>
                    <Demo title="排行榜（带环比）">
                        <Stack gap={10}>
                            <RankRow rank={1} name="A 系列" value={186} max={186} delta={12} color={chartPalette.green} />
                            <RankRow rank={2} name="B 系列" value={142} max={186} delta={4} color={chartPalette.blue} />
                            <RankRow rank={3} name="C 系列" value={96} max={186} delta={-8} color={chartPalette.brightOrange} />
                            <RankRow rank={4} name="D 系列" value={54} max={186} delta={-21} color={chartPalette.darkAmber} />
                        </Stack>
                    </Demo>
                </Grid>
            </Section>

            <Section index="10" title="对比与决策" hint="差异 · 双栏 · 四象限">
                <Grid columns={2} gap={20}>
                    <Demo title="变更差异（沿用宿主 diff 配色）">
                        <DiffBlock
                            lines={[
                                { type: "ctx", text: "广告预算分配" },
                                { type: "del", text: "品类词 45% / 品牌词 30%" },
                                { type: "add", text: "品类词 32% / 品牌词 43%" },
                                { type: "ctx", text: "防守词维持 15%" },
                            ]}
                        />
                    </Demo>
                    <Demo title="方案双栏对比">
                        <Grid columns={2} gap={10}>
                            <Card>
                                <CardHeader>方案 A · 压广告</CardHeader>
                                <CardBody>
                                    <Stack gap={4}>
                                        <Text size="small" tone="secondary">见效快，2 周内 ACoS 可降 6pt</Text>
                                        <Text size="small" tone="secondary">但曝光下滑，新客减少</Text>
                                    </Stack>
                                </CardBody>
                            </Card>
                            <Card>
                                <CardHeader>方案 B · 改详情</CardHeader>
                                <CardBody>
                                    <Stack gap={4}>
                                        <Text size="small" tone="secondary">提升转化，不牺牲流量</Text>
                                        <Text size="small" tone="secondary">但需要设计排期，周期 3～4 周</Text>
                                    </Stack>
                                </CardBody>
                            </Card>
                        </Grid>
                    </Demo>
                </Grid>
                <Demo title="投入产出四象限">
                    <Quadrant
                        items={[
                            { x: "低", y: "高", title: "暂停浪费词", note: "当天可做", color: toneColor.success },
                            { x: "高", y: "高", title: "详情页改版", note: "排期 3 周", color: toneColor.warning },
                            { x: "低", y: "低", title: "调整主图顺序", note: "顺手做", color: colorPalette.gray },
                            { x: "高", y: "低", title: "自建归因系统", note: "暂不启动", color: toneColor.danger },
                        ]}
                    />
                </Demo>
            </Section>

            <Section index="11" title="交互" hint="useCanvasState · Button · 可切换视图">
                <Stack gap={12}>
                    <Row gap={8} wrap>
                        <Pill active={tab === "trend"} onClick={() => setTab("trend")}>
                            趋势
                        </Pill>
                        <Pill active={tab === "structure"} onClick={() => setTab("structure")}>
                            结构
                        </Pill>
                        <Pill active={tab === "detail"} onClick={() => setTab("detail")}>
                            明细
                        </Pill>
                    </Row>
                    <div style={{ border: `1px solid ${theme.stroke.secondary}`, borderRadius: 8, padding: 14 }}>
                        {tab === "trend" ? (
                            <TrendChart
                                height={170}
                                categories={["W1", "W2", "W3", "W4", "W5", "W6"]}
                                series={[{ name: "GMV", data: [120, 138, 129, 164, 172, 196], color: chartPalette.vibrantTeal, area: true }]}
                            />
                        ) : null}
                        {tab === "structure" ? (
                            <PieChart
                                data={[
                                    { label: "自营", value: 58 },
                                    { label: "分销", value: 30 },
                                    { label: "其它", value: 12 },
                                ]}
                            />
                        ) : null}
                        {tab === "detail" ? (
                            <Table headers={["周次", "GMV", "订单"]} columnAlign={["left", "right", "right"]} rows={[["W5", "172", "1,204"], ["W6", "196", "1,388"]]} />
                        ) : null}
                    </div>
                    <Row gap={8}>
                        <Button variant="primary">主按钮</Button>
                        <Button>次按钮</Button>
                        <Button variant="ghost">弱按钮</Button>
                        <Button disabled>禁用</Button>
                    </Row>
                    <Text size="small" tone="quaternary">
                        交互仅在预览内生效，导出图片时会定格为当前视图。
                    </Text>
                </Stack>
            </Section>

            <Divider />

            <CollapsibleSection title="写作备忘：容易踩的几个点" count={6} defaultOpen>
                <Stack gap={6}>
                    <Text size="small" tone="secondary">
                        1. 单序列 BarChart 会被强制渲染成横向条；想要竖直柱状请传两个序列或加 <Code>stacked</Code>。
                    </Text>
                    <Text size="small" tone="secondary">
                        2. 流程图优先用 <Code>FlowDiagram</Code>，只给 nodes / edges，布局和连线自动算；需要特殊排版再自绘 SVG。
                    </Text>
                    <Text size="small" tone="secondary">
                        3. 颜色一律取 <Code>useHostTheme()</Code> 或 <Code>chartPalette</Code> / <Code>colorPalette</Code>，不要写死十六进制。
                    </Text>
                    <Text size="small" tone="secondary">
                        4. 原生标签可用，但只允许从 <Code>infinite-canvas</Code> import；不能引第三方库、不能 fetch。
                    </Text>
                    <Text size="small" tone="secondary">
                        5. 明细超过 15 行就别塞进 Canvas，另给一个 .csv。
                    </Text>
                    <Text size="small" tone="secondary">
                        6. BarChart / LineChart / PieChart / UsageBar / FlowDiagram 自带悬停明细；自绘 SVG 想要悬停时用 <Code>useHoverTip</Code> + <Code>HoverTip</Code>（见 06 区散点图写法）。
                    </Text>
                </Stack>
            </CollapsibleSection>
        </Stack>
    );
}
