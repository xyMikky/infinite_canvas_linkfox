/** Aligned with Cursor canvas-runtime palette / spacing (reimplemented, not copied as bundle). */
import { canvasThemes } from "@/lib/canvas-theme";

export const canvasPaletteDark = {
    foreground: "#E4E4E4EB",
    foregroundSecondary: "#E4E4E48D",
    foregroundTertiary: "#E4E4E45E",
    foregroundQuaternary: "#E4E4E442",
    editor: "#181818",
    chrome: "#141414",
    sidebar: "#141414",
    elevated: "#181818",
    fillPrimary: "#E4E4E430",
    fillSecondary: "#E4E4E41E",
    fillTertiary: "#E4E4E411",
    fillQuaternary: "#E4E4E40A",
    strokePrimary: "#E4E4E433",
    strokeSecondary: "#E4E4E41F",
    strokeTertiary: "#E4E4E414",
    strokeFocused: "#E4E4E4",
    accent: "#599CE7",
    buttonBackground: "#599CE7",
    buttonForeground: "#191c22",
    buttonHoverBackground: "#6AABE9",
    link: "#87c3ff",
    diffInsertedLine: "#3FA26633",
    diffRemovedLine: "#B8004933",
    diffStripAdded: "#3FA2668F",
    diffStripRemoved: "#FC6B838F",
} as const;

export type CanvasPalette = { [K in keyof typeof canvasPaletteDark]: string };

export const canvasPaletteLight: CanvasPalette = {
    ...canvasPaletteDark,
    foreground: canvasThemes.light.node.text,
    foregroundSecondary: canvasThemes.light.node.muted,
    foregroundTertiary: canvasThemes.light.node.placeholder,
    foregroundQuaternary: canvasThemes.light.node.faint,
    editor: canvasThemes.light.canvas.background,
    chrome: canvasThemes.light.node.panel,
    sidebar: canvasThemes.light.node.panel,
    elevated: canvasThemes.light.node.panel,
    fillPrimary: canvasThemes.light.node.fill,
    fillSecondary: "rgba(41,37,36,.08)",
    fillTertiary: "rgba(41,37,36,.05)",
    fillQuaternary: "rgba(41,37,36,.03)",
    strokePrimary: canvasThemes.light.node.stroke,
    strokeSecondary: "rgba(41,37,36,.12)",
    strokeTertiary: "rgba(41,37,36,.08)",
    strokeFocused: canvasThemes.light.node.activeStroke,
    accent: "#2563a6",
    buttonBackground: "#2563a6",
    buttonForeground: canvasThemes.light.node.panel,
    buttonHoverBackground: "#1d4f86",
    link: "#2563a6",
};

export const chartPalette = {
    green: "#1F8A65E8",
    darkGreen: "#0D855AE0",
    lightGreen: "#52B896E0",
    mintGreen: "#7DCAB0E0",
    blue: "#2E79B5E0",
    lightBlue: "#70B0D8E0",
    indigo: "#5A6CC0F0",
    lightIndigo: "#9AAADCE0",
    purple: "#7B64B8F0",
    lightPurple: "#AA98D8E0",
    warmPink: "#C85898E0",
    lightPink: "#E8A0C4E0",
    brightOrange: "#F0A040E0",
    deepOrange: "#C06028E0",
    goldenYellow: "#E8C030E0",
    darkAmber: "#C04848E0",
    warmPeach: "#F0A088E0",
    vibrantTeal: "#2A9A8AE0",
    muted: "#8888A8E0",
    neutralLine: "#888899D0",
} as const;

export const toneColor = {
    success: chartPalette.lightGreen,
    danger: chartPalette.darkAmber,
    warning: chartPalette.brightOrange,
    info: chartPalette.lightBlue,
    neutral: chartPalette.muted,
} as const;

export const categoryPaletteDark = {
    gray: "#E4E4E48A",
    purple: "#9386F2",
    green: "#3FA266",
    yellow: "#F1B467",
    cyan: "#81A1C1",
    pink: "#B48EAD",
    blue: "#7BAFE9",
    orange: "#DD7F76",
    red: "#FC6B83",
} as const;

export type Color = keyof typeof categoryPaletteDark;
export const categoryPaletteLight: Record<Color, string> = {
    gray: canvasThemes.light.node.muted,
    purple: "#7054b0",
    green: "#277750",
    yellow: "#97651d",
    cyan: "#3e6e85",
    pink: "#985080",
    blue: "#326caa",
    orange: "#a85439",
    red: "#b13e55",
};
export const colorPalette = categoryPaletteDark;
export const usageColorSequence: readonly Color[] = ["gray", "purple", "green", "yellow", "cyan", "pink", "blue", "orange", "red"];

export const canvasTypography = {
    h1: { fontSize: "24px", lineHeight: "30px", fontWeight: 590 },
    h2: { fontSize: "18px", lineHeight: "24px", fontWeight: 590 },
    h3: { fontSize: "16px", lineHeight: "22px", fontWeight: 590 },
    body: { fontSize: "14px", lineHeight: "20px", fontWeight: 400 },
    small: { fontSize: "12px", lineHeight: "16px", fontWeight: 400 },
} as const;

export const canvasSpacing = {
    0.5: 2,
    1: 4,
    1.5: 6,
    2: 8,
    2.5: 10,
    3: 12,
    3.5: 14,
    4: 16,
    4.5: 18,
    5: 20,
    6: 24,
    7: 28,
    8: 32,
    9: 36,
    10: 40,
} as const;

export const canvasRadius = {
    none: 0,
    xs: 2,
    sm: 4,
    md: 6,
    lg: 8,
    xl: 12,
    full: 9999,
} as const;

export const CANVAS_SANS_FONT_STACK =
    '-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", system-ui, "Ubuntu", "Droid Sans", sans-serif';

export function buildTokens(palette: CanvasPalette = canvasPaletteDark, category: Record<Color, string> = categoryPaletteDark) {
    return {
        text: {
            primary: palette.foreground,
            secondary: palette.foregroundSecondary,
            tertiary: palette.foregroundTertiary,
            quaternary: palette.foregroundQuaternary,
            link: palette.link,
            onAccent: palette.buttonForeground,
        },
        bg: { editor: palette.editor, chrome: palette.chrome, elevated: palette.elevated },
        fill: {
            primary: palette.fillPrimary,
            secondary: palette.fillSecondary,
            tertiary: palette.fillTertiary,
            quaternary: palette.fillQuaternary,
        },
        stroke: {
            primary: palette.strokePrimary,
            secondary: palette.strokeSecondary,
            tertiary: palette.strokeTertiary,
            focused: palette.strokeFocused,
        },
        accent: { primary: palette.accent, control: palette.buttonBackground },
        category,
        diff: {
            insertedLine: palette.diffInsertedLine,
            removedLine: palette.diffRemovedLine,
            stripAdded: palette.diffStripAdded,
            stripRemoved: palette.diffStripRemoved,
        },
    };
}

export type CanvasTokens = ReturnType<typeof buildTokens>;
