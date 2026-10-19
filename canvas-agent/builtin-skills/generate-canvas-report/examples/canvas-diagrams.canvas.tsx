/**
 * Canvas 业务图与技术图示例（示例数据，非真实业务）
 *
 * 与 canvas-gallery.canvas.tsx 配套：这份专门演示业务题材（财务报表、组织架构、
 * 用户旅程地图）和技术题材（系统架构、接口时序、部署拓扑、API 一览）怎么排版。
 * 组织架构直接用 SDK 的 FlowDiagram；时序图、瀑布图、情绪曲线用原生 SVG 自绘。
 */
import {
    Callout,
    Card,
    CardBody,
    CardHeader,
    Code,
    Divider,
    FlowDiagram,
    Grid,
    H1,
    H2,
    Pill,
    Row,
    Stack,
    Stat,
    Table,
    Text,
    chartPalette,
    colorPalette,
    toneColor,
    useHostTheme,
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

/* ── 财务：瀑布图 ───────────────────────────────────────── */

function Waterfall({ items, suffix = "" }: { items: { label: string; value: number; total?: boolean }[]; suffix?: string }) {
    const theme = useHostTheme();
    const width = 640;
    const height = 240;
    const pad = { t: 20, r: 12, b: 28, l: 12 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;

    let cursor = 0;
    const bars = items.map((item) => {
        if (item.total) return { label: item.label, from: 0, to: cursor, value: cursor, color: chartPalette.blue };
        const from = cursor;
        cursor += item.value;
        return { label: item.label, from, to: cursor, value: item.value, color: item.value >= 0 ? toneColor.success : toneColor.danger };
    });
    const max = Math.max(...bars.map((bar) => Math.max(bar.from, bar.to))) || 1;
    const y = (v: number) => pad.t + plotH - (v / max) * plotH;
    const slot = plotW / bars.length;
    const barW = Math.min(56, slot * 0.6);

    return (
        <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block", maxWidth: width }}>
            {bars.map((bar, i) => {
                const x = pad.l + i * slot + (slot - barW) / 2;
                const top = y(Math.max(bar.from, bar.to));
                const barH = Math.max(2, Math.abs(y(bar.from) - y(bar.to)));
                const next = bars[i + 1];
                return (
                    <g key={bar.label}>
                        <rect x={x} y={top} width={barW} height={barH} rx={3} fill={bar.color} opacity={0.9} />
                        {next && !next.total ? (
                            <line x1={x + barW} y1={y(bar.to)} x2={pad.l + (i + 1) * slot + (slot - barW) / 2} y2={y(bar.to)} stroke={theme.stroke.secondary} strokeDasharray="3 3" />
                        ) : null}
                        <text x={x + barW / 2} y={top - 6} textAnchor="middle" fontSize={11} fill={theme.text.secondary}>
                            {bar.value >= 0 && !bar.total ? "+" : ""}
                            {bar.value}
                            {suffix}
                        </text>
                        <text x={x + barW / 2} y={height - 10} textAnchor="middle" fontSize={11} fill={theme.text.tertiary}>
                            {bar.label}
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}

/* ── 旅程：情绪曲线 ─────────────────────────────────────── */

function MoodCurve({ stages }: { stages: { name: string; mood: number }[] }) {
    const theme = useHostTheme();
    const width = 640;
    const height = 130;
    const x = (i: number) => ((i + 0.5) * width) / stages.length;
    const y = (mood: number) => 108 - (mood / 100) * 84;
    const points = stages.map((stage, i) => `${x(i)},${y(stage.mood)}`).join(" ");
    return (
        <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
            <line x1={0} x2={width} y1={y(50)} y2={y(50)} stroke={theme.stroke.tertiary} strokeDasharray="4 4" />
            <text x={4} y={y(50) - 5} fontSize={10} fill={theme.text.quaternary}>
                情绪基线
            </text>
            <polyline points={points} fill="none" stroke={chartPalette.warmPink} strokeWidth={1.8} strokeLinejoin="round" />
            {stages.map((stage, i) => (
                <g key={stage.name}>
                    <circle cx={x(i)} cy={y(stage.mood)} r={3.6} fill={stage.mood >= 50 ? toneColor.success : toneColor.danger} />
                    <text x={x(i)} y={y(stage.mood) - 9} textAnchor="middle" fontSize={10} fill={theme.text.tertiary}>
                        {stage.mood}
                    </text>
                    <text x={x(i)} y={height - 6} textAnchor="middle" fontSize={11} fill={theme.text.secondary}>
                        {stage.name}
                    </text>
                </g>
            ))}
        </svg>
    );
}

/* ── 技术：时序图 ───────────────────────────────────────── */

function SequenceDiagram({ actors, messages }: { actors: string[]; messages: { from: string; to: string; label: string; reply?: boolean }[] }) {
    const theme = useHostTheme();
    const colWidth = 156;
    const headerH = 32;
    const step = 42;
    const width = actors.length * colWidth;
    const height = headerH + 14 + messages.length * step + 12;
    const x = (name: string) => actors.indexOf(name) * colWidth + colWidth / 2;

    return (
        <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: "block", maxWidth: width }}>
            <defs>
                <marker id="seq-arrow" markerWidth="7" markerHeight="7" refX="6.5" refY="3.5" orient="auto">
                    <path d="M0,0 L7,3.5 L0,7 Z" fill={theme.text.tertiary} />
                </marker>
            </defs>
            {actors.map((actor) => (
                <g key={actor}>
                    <line x1={x(actor)} x2={x(actor)} y1={headerH} y2={height - 6} stroke={theme.stroke.secondary} strokeDasharray="4 4" />
                    <rect x={x(actor) - 56} y={0} width={112} height={headerH} rx={6} fill={theme.fill.quaternary} stroke={theme.stroke.primary} />
                    <text x={x(actor)} y={headerH / 2} textAnchor="middle" dominantBaseline="middle" fontSize={12} fill={theme.text.primary}>
                        {actor}
                    </text>
                </g>
            ))}
            {messages.map((msg, i) => {
                const yPos = headerH + 26 + i * step;
                if (msg.from === msg.to) {
                    const cx = x(msg.from);
                    return (
                        <g key={i}>
                            <path
                                d={`M ${cx} ${yPos - 8} C ${cx + 44} ${yPos - 8}, ${cx + 44} ${yPos + 10}, ${cx + 3} ${yPos + 10}`}
                                fill="none"
                                stroke={theme.text.tertiary}
                                markerEnd="url(#seq-arrow)"
                            />
                            <text x={cx + 50} y={yPos + 2} fontSize={10} fill={theme.text.secondary}>
                                {msg.label}
                            </text>
                        </g>
                    );
                }
                const x1 = x(msg.from);
                const x2 = x(msg.to);
                const dir = x2 > x1 ? 1 : -1;
                return (
                    <g key={i}>
                        <line x1={x1} y1={yPos} x2={x2 - dir * 4} y2={yPos} stroke={theme.text.tertiary} strokeDasharray={msg.reply ? "4 3" : undefined} markerEnd="url(#seq-arrow)" />
                        <text x={(x1 + x2) / 2} y={yPos - 6} textAnchor="middle" fontSize={10} fill={theme.text.secondary}>
                            {msg.label}
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}

/* ── 技术：架构分层 / 部署节点 ──────────────────────────── */

function ArchBox({ name, note, color }: { name: string; note?: string; color: string }) {
    const theme = useHostTheme();
    return (
        <div style={{ flex: 1, minWidth: 108, border: `1px solid ${theme.stroke.primary}`, borderTop: `2px solid ${color}`, borderRadius: 6, padding: "8px 10px", textAlign: "center" }}>
            <Text size="small" weight="medium">
                {name}
            </Text>
            {note ? (
                <Text size="small" tone="quaternary">
                    {note}
                </Text>
            ) : null}
        </div>
    );
}

function ArchLayer({ title, color, children }: { title: string; color: string; children?: any }) {
    const theme = useHostTheme();
    return (
        <div style={{ border: `1px dashed ${theme.stroke.secondary}`, borderRadius: 8, padding: "10px 12px" }}>
            <Row gap={8} style={{ marginBottom: 8 }}>
                <span style={{ width: 3, height: 12, borderRadius: 2, background: color, flexShrink: 0 }} />
                <Text size="small" tone="secondary" weight="medium">
                    {title}
                </Text>
            </Row>
            <Row gap={8} wrap align="stretch">
                {children}
            </Row>
        </div>
    );
}

function LayerArrow({ label }: { label: string }) {
    const theme = useHostTheme();
    return (
        <Row gap={6} justify="center">
            <Text size="small" tone="quaternary">
                ↓ {label}
            </Text>
        </Row>
    );
}

function DeployNode({ name, role, color }: { name: string; role: string; color: string }) {
    const theme = useHostTheme();
    return (
        <div style={{ border: `1px solid ${theme.stroke.primary}`, borderLeft: `2px solid ${color}`, borderRadius: 6, padding: "6px 10px", minWidth: 96 }}>
            <Text size="small" weight="medium">
                {name}
            </Text>
            <Text size="small" tone="quaternary">
                {role}
            </Text>
        </div>
    );
}

function DeployZone({ title, tone, children }: { title: string; tone: string; children?: any }) {
    const theme = useHostTheme();
    return (
        <div style={{ flex: 1, minWidth: 220, border: `1px dashed ${tone}`, borderRadius: 8, padding: "10px 12px" }}>
            <Text size="small" tone="secondary" weight="medium" style={{ marginBottom: 8 }}>
                {title}
            </Text>
            <Row gap={8} wrap align="stretch">
                {children}
            </Row>
        </div>
    );
}

/* ── 小工具 ─────────────────────────────────────────────── */

function MethodTag({ method }: { method: "GET" | "POST" | "PUT" | "DELETE" }) {
    const color =
        method === "GET" ? toneColor.success : method === "POST" ? toneColor.info : method === "PUT" ? toneColor.warning : toneColor.danger;
    return (
        <span style={{ display: "inline-block", minWidth: 52, textAlign: "center", padding: "1px 8px", borderRadius: 4, border: `1px solid ${color}`, color, fontSize: 11, fontWeight: 590 }}>
            {method}
        </span>
    );
}

function MatrixMark({ state }: { state: "yes" | "partial" | "no" }) {
    const theme = useHostTheme();
    const color = state === "yes" ? toneColor.success : state === "partial" ? toneColor.warning : theme.text.quaternary;
    return <span style={{ color, fontSize: 13 }}>{state === "yes" ? "✓" : state === "partial" ? "△" : "—"}</span>;
}

/* ── 主组件 ─────────────────────────────────────────────── */

export default function CanvasDiagrams() {
    const theme = useHostTheme();
    const journeyStages = [
        { name: "认知", mood: 55, touch: "信息流广告 · 短视频", pain: "同类信息过载", chance: "首图突出差异卖点" },
        { name: "研究", mood: 40, touch: "详情页 · 第三方评测", pain: "参数看不懂", chance: "加对比表和场景图" },
        { name: "购买", mood: 35, touch: "购物车 · 结算页", pain: "运费与时效不透明", chance: "满额包邮 · 时效承诺" },
        { name: "使用", mood: 62, touch: "安装指南 · 在线客服", pain: "首次安装步骤多", chance: "扫码看安装视频" },
        { name: "复购", mood: 70, touch: "会员中心 · 邮件", pain: "缺少复购激励", chance: "积分抵扣 + 专属券" },
    ];

    return (
        <Stack gap={28}>
            <Stack gap={10}>
                <H1>业务图与技术图示例</H1>
                <Text tone="secondary" size="small">
                    示例数据 · 演示财务、组织、旅程、架构、时序、部署、接口七类题材的 Canvas 排版
                </Text>
                <Row gap={6} wrap>
                    <Pill size="sm">财务报表</Pill>
                    <Pill size="sm">组织架构</Pill>
                    <Pill size="sm">用户旅程</Pill>
                    <Pill size="sm">系统架构</Pill>
                    <Pill size="sm">接口时序</Pill>
                    <Pill size="sm">部署拓扑</Pill>
                    <Pill size="sm">API 一览</Pill>
                </Row>
                <Callout tone="info" title="怎么用这份文件">
                    组织架构直接用 <Code>FlowDiagram</Code>；瀑布图、情绪曲线、时序图用原生 SVG 自绘；架构分层与部署拓扑用普通
                    div 嵌套即可，不必强行上 SVG。
                </Callout>
            </Stack>

            <Divider />

            <Section index="01" title="财务报表" hint="利润表 · 瀑布图 · 关键比率">
                <Grid columns={4} gap={12}>
                    <Stat value="40.2%" label="毛利率" tone="success" />
                    <Stat value="19.2%" label="净利率" />
                    <Stat value="21.0%" label="费用率" tone="warning" />
                    <Stat value="+10.2%" label="净利同比" tone="success" />
                </Grid>
                <Demo title="利润表（万元，缩进表示科目层级）">
                    <Table
                        headers={["科目", "本期", "上期", "同比"]}
                        columnAlign={["left", "right", "right", "right"]}
                        rows={[
                            ["营业收入", "1,240", "1,082", <Text key="a" size="small" style={{ color: toneColor.success }}>+14.6%</Text>],
                            [<Text key="b" size="small" style={{ paddingLeft: 14 }}>减：营业成本</Text>, "742", "655", <Text key="b2" size="small" tone="secondary">+13.3%</Text>],
                            [<Text key="c" size="small" weight="semibold">毛利</Text>, <Text key="c2" size="small" weight="semibold">498</Text>, "427", <Text key="c3" size="small" style={{ color: toneColor.success }}>+16.6%</Text>],
                            [<Text key="d" size="small" style={{ paddingLeft: 14 }}>减：销售费用</Text>, "186", "142", <Text key="d2" size="small" style={{ color: toneColor.danger }}>+31.0%</Text>],
                            [<Text key="e" size="small" style={{ paddingLeft: 14 }}>减：管理费用</Text>, "74", "69", <Text key="e2" size="small" tone="secondary">+7.2%</Text>],
                            [<Text key="f" size="small" weight="semibold">净利润</Text>, <Text key="f2" size="small" weight="semibold">238</Text>, "216", <Text key="f3" size="small" style={{ color: toneColor.success }}>+10.2%</Text>],
                        ]}
                    />
                </Demo>
                <Demo title="利润构成瀑布图（从收入到净利）">
                    <Waterfall
                        items={[
                            { label: "营业收入", value: 1240 },
                            { label: "营业成本", value: -742 },
                            { label: "毛利", value: 0, total: true },
                            { label: "销售费用", value: -186 },
                            { label: "管理费用", value: -74 },
                            { label: "净利润", value: 0, total: true },
                        ]}
                    />
                </Demo>
            </Section>

            <Section index="02" title="组织架构" hint="FlowDiagram direction=column 即可，不用手画">
                <FlowDiagram
                    direction="column"
                    nodeWidth={120}
                    gapMain={44}
                    nodes={[
                        { id: "ceo", label: "总经理", shape: "terminal" },
                        { id: "prod", label: "产品部", note: "12 人", tone: "info" },
                        { id: "rd", label: "研发部", note: "36 人", tone: "info" },
                        { id: "mkt", label: "市场部", note: "9 人", tone: "info" },
                        { id: "fe", label: "前端组", note: "10 人" },
                        { id: "be", label: "后端组", note: "18 人" },
                        { id: "data", label: "数据组", note: "8 人" },
                    ]}
                    edges={[
                        { from: "ceo", to: "prod" },
                        { from: "ceo", to: "rd" },
                        { from: "ceo", to: "mkt" },
                        { from: "rd", to: "fe" },
                        { from: "rd", to: "be" },
                        { from: "rd", to: "data" },
                    ]}
                />
            </Section>

            <Section index="03" title="用户旅程地图" hint="阶段 × 情绪曲线 × 触点/痛点/机会">
                <Demo title="情绪曲线（50 为基线，低于基线是流失风险点）">
                    <MoodCurve stages={journeyStages} />
                </Demo>
                <div style={{ border: `1px solid ${theme.stroke.primary}`, borderRadius: 8, overflow: "hidden" }}>
                    {[
                        { label: "触点", key: "touch" as const, color: colorPalette.blue },
                        { label: "痛点", key: "pain" as const, color: colorPalette.red },
                        { label: "机会", key: "chance" as const, color: colorPalette.green },
                    ].map((row, rowIndex) => (
                        <div
                            key={row.label}
                            style={{
                                display: "grid",
                                gridTemplateColumns: `56px repeat(${journeyStages.length}, 1fr)`,
                                borderTop: rowIndex ? `1px solid ${theme.stroke.tertiary}` : "none",
                            }}
                        >
                            <div style={{ padding: "10px 8px", borderRight: `1px solid ${theme.stroke.tertiary}` }}>
                                <Row gap={5} style={{ width: "auto" }}>
                                    <span style={{ width: 3, height: 12, borderRadius: 2, background: row.color, flexShrink: 0 }} />
                                    <Text size="small" tone="secondary">
                                        {row.label}
                                    </Text>
                                </Row>
                            </div>
                            {journeyStages.map((stage) => (
                                <div key={stage.name} style={{ padding: "10px 10px", borderRight: `1px solid ${theme.stroke.tertiary}` }}>
                                    <Text size="small" tone={row.key === "pain" ? "secondary" : "primary"}>
                                        {stage[row.key]}
                                    </Text>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </Section>

            <Section index="04" title="系统架构" hint="分层 div 嵌套，层间标注调用关系">
                <Stack gap={8}>
                    <ArchLayer title="接入层" color={colorPalette.blue}>
                        <ArchBox name="Web 前端" note="React SPA" color={colorPalette.blue} />
                        <ArchBox name="桌面端" note="Electron" color={colorPalette.blue} />
                        <ArchBox name="开放 API" note="REST" color={colorPalette.blue} />
                    </ArchLayer>
                    <LayerArrow label="HTTPS / Token 鉴权" />
                    <ArchLayer title="应用层" color={colorPalette.purple}>
                        <ArchBox name="画布服务" note="项目 · 节点" color={colorPalette.purple} />
                        <ArchBox name="Agent 服务" note="Codex 调度" color={colorPalette.purple} />
                        <ArchBox name="素材服务" note="上传 · 索引" color={colorPalette.purple} />
                        <ArchBox name="账号服务" note="鉴权 · 配额" color={colorPalette.purple} />
                    </ArchLayer>
                    <LayerArrow label="内部 RPC / 队列" />
                    <ArchLayer title="数据层" color={colorPalette.green}>
                        <ArchBox name="PostgreSQL" note="业务主库" color={colorPalette.green} />
                        <ArchBox name="对象存储" note="图片 · 产物" color={colorPalette.green} />
                        <ArchBox name="Redis" note="缓存 · 会话" color={colorPalette.green} />
                    </ArchLayer>
                </Stack>
            </Section>

            <Section index="05" title="接口时序" hint="实线请求 · 虚线返回 · 自调用回环">
                <SequenceDiagram
                    actors={["用户", "网关", "订单服务", "支付服务"]}
                    messages={[
                        { from: "用户", to: "网关", label: "POST /orders" },
                        { from: "网关", to: "订单服务", label: "创建订单" },
                        { from: "订单服务", to: "订单服务", label: "校验库存" },
                        { from: "订单服务", to: "支付服务", label: "发起支付" },
                        { from: "支付服务", to: "订单服务", label: "支付成功", reply: true },
                        { from: "订单服务", to: "网关", label: "订单已创建", reply: true },
                        { from: "网关", to: "用户", label: "201 Created", reply: true },
                    ]}
                />
            </Section>

            <Section index="06" title="部署拓扑" hint="区域/可用区用虚线框分组">
                <Row gap={10} align="stretch" wrap>
                    <DeployZone title="可用区 A（主）" tone={toneColor.info}>
                        <DeployNode name="Web-1" role="Nginx" color={colorPalette.blue} />
                        <DeployNode name="API-1" role="Node 20" color={colorPalette.purple} />
                        <DeployNode name="DB 主" role="PostgreSQL" color={colorPalette.green} />
                    </DeployZone>
                    <DeployZone title="可用区 B（备）" tone={toneColor.warning}>
                        <DeployNode name="Web-2" role="Nginx" color={colorPalette.blue} />
                        <DeployNode name="API-2" role="Node 20" color={colorPalette.purple} />
                        <DeployNode name="DB 从" role="流复制" color={colorPalette.green} />
                    </DeployZone>
                </Row>
                <DeployZone title="公共服务（跨可用区）" tone={theme.stroke.primary}>
                    <DeployNode name="对象存储" role="产物 · 素材" color={colorPalette.cyan} />
                    <DeployNode name="消息队列" role="任务分发" color={colorPalette.yellow} />
                    <DeployNode name="监控告警" role="指标 · 日志" color={colorPalette.pink} />
                </DeployZone>
                <Callout tone="neutral" title="说明">
                    拓扑图重点是分组与主备关系；连线多时宁可拆成两张图，不要一张里画满交叉线。
                </Callout>
            </Section>

            <Section index="07" title="API 一览" hint="MethodTag 着色 · 兼容性矩阵">
                <Demo title="接口表">
                    <Table
                        headers={["方法", "路径", "说明", "鉴权", "状态"]}
                        columnAlign={["left", "left", "left", "center", "center"]}
                        rows={[
                            [<MethodTag key="a" method="GET" />, <Code key="a2">/api/projects</Code>, "项目列表", "Token", <Pill key="a3" size="sm">稳定</Pill>],
                            [<MethodTag key="b" method="POST" />, <Code key="b2">/api/projects</Code>, "新建项目", "Token", <Pill key="b3" size="sm">稳定</Pill>],
                            [<MethodTag key="c" method="PUT" />, <Code key="c2">/api/nodes/:id</Code>, "更新节点", "Token", <Pill key="c3" size="sm">Beta</Pill>],
                            [<MethodTag key="d" method="DELETE" />, <Code key="d2">/api/nodes/:id</Code>, "删除节点", "Token", <Pill key="d3" size="sm">Beta</Pill>],
                            [<MethodTag key="e" method="GET" />, <Code key="e2">/agent/codex/threads</Code>, "会话列表", "Connect Token", <Pill key="e3" size="sm">内部</Pill>],
                        ]}
                    />
                </Demo>
                <Demo title="功能兼容性矩阵">
                    <Table
                        headers={["功能", "Windows", "macOS", "Web"]}
                        columnAlign={["left", "center", "center", "center"]}
                        rows={[
                            ["画布编辑", <MatrixMark key="a" state="yes" />, <MatrixMark key="a2" state="yes" />, <MatrixMark key="a3" state="yes" />],
                            ["Codex 智能体", <MatrixMark key="b" state="yes" />, <MatrixMark key="b2" state="yes" />, <MatrixMark key="b3" state="partial" />],
                            ["本地文件夹节点", <MatrixMark key="c" state="yes" />, <MatrixMark key="c2" state="partial" />, <MatrixMark key="c3" state="no" />],
                            ["安装包自动更新", <MatrixMark key="d" state="yes" />, <MatrixMark key="d2" state="no" />, <MatrixMark key="d3" state="no" />],
                        ]}
                    />
                </Demo>
            </Section>

            <Divider />

            <Card>
                <CardHeader>选型提醒</CardHeader>
                <CardBody>
                    <Stack gap={6}>
                        <Text size="small" tone="secondary">
                            1. 组织架构、审批流、状态流转：先想 <Code>FlowDiagram</Code>，只有布局特殊时才自绘。
                        </Text>
                        <Text size="small" tone="secondary">
                            2. 架构图与拓扑图优先用 div 分层分组，比 SVG 更不容易画错，也方便放文字。
                        </Text>
                        <Text size="small" tone="secondary">
                            3. 财务表格保持「缩进 + 小计加粗 + 同比着色」三件套；大额数字用千分位。
                        </Text>
                    </Stack>
                </CardBody>
            </Card>
        </Stack>
    );
}
