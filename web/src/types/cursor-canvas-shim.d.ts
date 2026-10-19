declare module "infinite-canvas" {
    export {
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
        canvasPaletteDark,
        canvasPaletteLight,
        categoryPaletteDark,
        chartPalette,
        colorPalette,
        mergeStyle,
        toneColor,
        usageColorSequence,
        useCanvasAction,
        useCanvasState,
        useHostTheme,
        useHoverTip,
    } from "@/lib/canvas/cursor-canvas-sdk";
}

/** 旧产物的历史模块名，仅保证类型可解析 */
declare module "cursor/canvas" {
    export * from "infinite-canvas";
}
