import { BarChart, Callout, Grid, H1, H2, PieChart, Pill, Row, Stack, Stat, Text } from "infinite-canvas";

export default function ReportSample() {
    return (
        <Stack gap={20}>
            <Stack gap={8}>
                <H1>REEVAA 卡车地板罩 · 转化与广告深析</H1>
                <Text tone="secondary" size="small">
                    样本数据 · 近 7 日 · ASIN 示例
                </Text>
                <Row gap={8} wrap>
                    <Pill>CVR 2.82%</Pill>
                    <Pill>ACoS 18.4%</Pill>
                    <Pill>Sessions 12.6k</Pill>
                </Row>
            </Stack>

            <Callout tone="warning" title="结论">
                流量结构健康，但加购到下单掉点偏大；优先压广告浪费点击并补详情页信任证据。
            </Callout>

            <Grid columns={4} gap={16}>
                <Stat value="2.82%" label="转化率" />
                <Stat value="18.4%" label="ACoS" tone="warning" />
                <Stat value="1.42" label="ROAS" tone="success" />
                <Stat value="¥86" label="客单价" />
            </Grid>

            <Stack gap={12}>
                <H2>1. 整链漏斗</H2>
                <BarChart
                    horizontal
                    categories={["曝光", "点击", "加购", "下单"]}
                    series={[{ name: "人数", data: [100000, 8200, 2100, 590] }]}
                />
            </Stack>

            <Stack gap={12}>
                <H2>2. 广告效率</H2>
                <PieChart
                    donut
                    data={[
                        { label: "品牌词", value: 42, tone: "success" },
                        { label: "品类词", value: 33, tone: "info" },
                        { label: "防守词", value: 15, tone: "warning" },
                        { label: "浪费", value: 10, tone: "danger" },
                    ]}
                />
            </Stack>
        </Stack>
    );
}
