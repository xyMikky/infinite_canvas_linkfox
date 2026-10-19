export { BarChart, LineChart, PieChart } from "./charts";
export type { ChartDataPoint, ChartSeries, ChartTone } from "./charts";
export { FlowDiagram } from "./diagram";
export type { FlowDiagramEdge, FlowDiagramNode, FlowShape } from "./diagram";
export {
    Button,
    Callout,
    Card,
    CardBody,
    CardHeader,
    Code,
    Divider,
    Grid,
    H1,
    H2,
    H3,
    Link,
    mergeStyle,
    Pill,
    Row,
    Spacer,
    Stack,
    Stat,
    Table,
    Text,
} from "./ui";
export {
    buildTokens,
    canvasPaletteDark,
    canvasPaletteLight,
    useCanvasAction,
    useCanvasState,
    useHostTheme,
} from "./theme";
export type { CanvasHostTheme, CanvasPalette, CanvasTokens } from "./theme";
export { HoverTip, useHoverTip } from "./tooltip";
export type { HoverTipState } from "./tooltip";
export { categoryPaletteDark, chartPalette, colorPalette, toneColor, usageColorSequence } from "./tokens";
export type { Color } from "./tokens";
export { CollapsibleSection, Swatch, UsageBar } from "./usage-bar";
export type { UsageBarSegment } from "./usage-bar";

import { BarChart, LineChart, PieChart } from "./charts";
import { FlowDiagram } from "./diagram";
import {
    Button,
    Callout,
    Card,
    CardBody,
    CardHeader,
    Code,
    Divider,
    Grid,
    H1,
    H2,
    H3,
    Link,
    mergeStyle,
    Pill,
    Row,
    Spacer,
    Stack,
    Stat,
    Table,
    Text,
} from "./ui";
import { canvasPaletteDark, canvasPaletteLight, useCanvasAction, useCanvasState, useHostTheme } from "./theme";
import { HoverTip, useHoverTip } from "./tooltip";
import { categoryPaletteDark, chartPalette, colorPalette, toneColor, usageColorSequence } from "./tokens";
import { CollapsibleSection, Swatch, UsageBar } from "./usage-bar";

const cursorCanvasExports = {
    BarChart,
    LineChart,
    PieChart,
    FlowDiagram,
    Button,
    Callout,
    Card,
    CardBody,
    CardHeader,
    Code,
    Divider,
    Grid,
    H1,
    H2,
    H3,
    Link,
    mergeStyle,
    Pill,
    Row,
    Spacer,
    Stack,
    Stat,
    Table,
    Text,
    UsageBar,
    Swatch,
    CollapsibleSection,
    canvasPaletteDark,
    canvasPaletteLight,
    categoryPaletteDark,
    colorPalette,
    chartPalette,
    toneColor,
    usageColorSequence,
    useCanvasAction,
    useCanvasState,
    useHostTheme,
    useHoverTip,
    HoverTip,
};

/** Runtime namespace passed into compiled canvases as `infinite-canvas`（兼容旧模块名 cursor/canvas） */
export const cursorCanvasApi = new Proxy(cursorCanvasExports, {
    get(target, prop, receiver) {
        if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
        if (prop in target) return Reflect.get(target, prop, receiver);
        throw new Error(`未实现的 infinite-canvas 导出: ${String(prop)}`);
    },
});
