import { strFromU8, unzipSync } from "fflate";

import { colLettersToIndex, normalizeZipPaths, resolveSheetPaths } from "@/lib/canvas/excel-media";

export type ExcelCellStyle = {
    /** 背景色 #RRGGBB */
    bg?: string;
    /** 文字色 #RRGGBB */
    color?: string;
    bold?: boolean;
};

export type ExcelSheetStyleMap = {
    /** 去重后的样式表；单元格通过下标引用 */
    styles: ExcelCellStyle[];
    /** `${row}:${col}`（0-based）-> styles 下标 */
    cells: Map<string, number>;
};

const MAX_STYLED_CELLS_PER_SHEET = 120_000;

/** Excel 标准 indexed 调色板（0-63，含常用色；未覆盖的返回空） */
const INDEXED_COLORS: Record<number, string> = {
    0: "#000000", 1: "#FFFFFF", 2: "#FF0000", 3: "#00FF00", 4: "#0000FF", 5: "#FFFF00", 6: "#FF00FF", 7: "#00FFFF",
    8: "#000000", 9: "#FFFFFF", 10: "#FF0000", 11: "#00FF00", 12: "#0000FF", 13: "#FFFF00", 14: "#FF00FF", 15: "#00FFFF",
    16: "#800000", 17: "#008000", 18: "#000080", 19: "#808000", 20: "#800080", 21: "#008080", 22: "#C0C0C0", 23: "#808080",
    24: "#9999FF", 25: "#993366", 26: "#FFFFCC", 27: "#CCFFFF", 28: "#660066", 29: "#FF8080", 30: "#0066CC", 31: "#CCCCFF",
    32: "#000080", 33: "#FF00FF", 34: "#FFFF00", 35: "#00FFFF", 36: "#800080", 37: "#800000", 38: "#008080", 39: "#0000FF",
    40: "#00CCFF", 41: "#CCFFFF", 42: "#CCFFCC", 43: "#FFFF99", 44: "#99CCFF", 45: "#FF99CC", 46: "#CC99FF", 47: "#FFCC99",
    48: "#3366FF", 49: "#33CCCC", 50: "#99CC00", 51: "#FFCC00", 52: "#FF9900", 53: "#FF6600", 54: "#666699", 55: "#969696",
    56: "#003366", 57: "#339966", 58: "#003300", 59: "#333300", 60: "#993300", 61: "#993366", 62: "#333399", 63: "#333333",
};

/**
 * 从 xlsx 原始 zip 解析单元格样式（背景色 / 文字色 / 加粗）。
 * SheetJS 社区版不解析样式，这里直接读 styles.xml + theme1.xml + 各 sheet xml 的 s 索引。
 */
export function extractExcelSheetStyles(buffer: ArrayBuffer, sheetNames: string[], maxRows: number, maxCols: number): Map<string, ExcelSheetStyleMap> {
    const out = new Map<string, ExcelSheetStyleMap>();
    let files: Map<string, Uint8Array>;
    try {
        files = normalizeZipPaths(unzipSync(new Uint8Array(buffer)));
    } catch {
        return out;
    }
    const stylesXml = files.get("xl/styles.xml");
    if (!stylesXml) return out;

    const themeColors = parseThemeColors(files.get("xl/theme/theme1.xml"));
    const xfStyles = parseStyleTable(strFromU8(stylesXml), themeColors);
    if (!xfStyles.some(Boolean)) return out;

    const sheetPathByName = resolveSheetPaths(files, sheetNames);
    for (const sheetName of sheetNames) {
        const path = sheetPathByName.get(sheetName);
        const data = path ? files.get(path) : undefined;
        if (!data) continue;
        const sheetMap = collectSheetCellStyles(strFromU8(data), xfStyles, maxRows, maxCols);
        if (sheetMap.cells.size) out.set(sheetName, sheetMap);
    }
    return out;
}

/** theme 索引顺序（Excel 语义）：0=lt1 1=dk1 2=lt2 3=dk2 4-9=accent1-6 */
function parseThemeColors(data: Uint8Array | undefined): string[] {
    if (!data) return [];
    const xml = strFromU8(data);
    const scheme = xml.match(/<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/i)?.[0] || "";
    const read = (tag: string) => {
        const block = scheme.match(new RegExp(`<a:${tag}>[\\s\\S]*?</a:${tag}>`, "i"))?.[0] || "";
        const value = block.match(/<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/i)?.[1] || block.match(/<a:sysClr\b[^>]*lastClr="([0-9A-Fa-f]{6})"/i)?.[1] || "";
        return value ? `#${value.toUpperCase()}` : "";
    };
    return [read("lt1"), read("dk1"), read("lt2"), read("dk2"), read("accent1"), read("accent2"), read("accent3"), read("accent4"), read("accent5"), read("accent6")];
}

function parseStyleTable(xml: string, themeColors: string[]): Array<ExcelCellStyle | null> {
    const fillColors = [...(xml.match(/<fills\b[\s\S]*?<\/fills>/i)?.[0] || "").matchAll(/<fill>([\s\S]*?)<\/fill>/gi)].map(([, body]) => {
        if (!/patternType="solid"/i.test(body)) return "";
        const fg = body.match(/<fgColor\b([^>]*)\/?\s*>/i)?.[1] || "";
        return resolveColor(fg, themeColors);
    });
    const fonts = [...(xml.match(/<fonts\b[\s\S]*?<\/fonts>/i)?.[0] || "").matchAll(/<font>([\s\S]*?)<\/font>/gi)].map(([, body]) => {
        const bold = /<b\s*\/>/i.test(body) || /<b\s+val="(?:1|true)"/i.test(body);
        const colorAttrs = body.match(/<color\b([^>]*)\/?\s*>/i)?.[1] || "";
        return { bold, color: resolveColor(colorAttrs, themeColors) };
    });
    const cellXfs = xml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/i)?.[0] || "";
    return [...cellXfs.matchAll(/<xf\b([^>]*)>/gi)].map(([, attrs]) => {
        const fillId = Number(attrValue(attrs, "fillId") || "0");
        const fontId = Number(attrValue(attrs, "fontId") || "0");
        const bg = fillColors[fillId] || "";
        const font = fonts[fontId];
        const style: ExcelCellStyle = {};
        if (bg && bg !== "#FFFFFF") style.bg = bg;
        if (font?.bold) style.bold = true;
        if (font?.color && font.color !== "#000000") style.color = font.color;
        return style.bg || style.bold || style.color ? style : null;
    });
}

function collectSheetCellStyles(xml: string, xfStyles: Array<ExcelCellStyle | null>, maxRows: number, maxCols: number): ExcelSheetStyleMap {
    const styles: ExcelCellStyle[] = [];
    const styleIndexByKey = new Map<string, number>();
    const cells = new Map<string, number>();
    for (const match of xml.matchAll(/<c\b([^>]*)>/g)) {
        if (cells.size >= MAX_STYLED_CELLS_PER_SHEET) break;
        const attrs = match[1];
        const s = attrs.match(/(?:^|\s)s="(\d+)"/)?.[1];
        if (s === undefined) continue;
        const style = xfStyles[Number(s)];
        if (!style) continue;
        const ref = attrs.match(/(?:^|\s)r="([A-Z]+)(\d+)"/i);
        if (!ref) continue;
        const row = Number(ref[2]) - 1;
        const col = colLettersToIndex(ref[1]);
        if (row < 0 || row >= maxRows || col < 0 || col >= maxCols) continue;
        const key = `${style.bg || ""}|${style.color || ""}|${style.bold ? 1 : 0}`;
        let index = styleIndexByKey.get(key);
        if (index === undefined) {
            index = styles.length;
            styles.push(style);
            styleIndexByKey.set(key, index);
        }
        cells.set(`${row}:${col}`, index);
    }
    return { styles, cells };
}

function attrValue(attrs: string, name: string) {
    return attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1] || "";
}

/** 解析 fgColor / color 元素属性：rgb= / theme=(+tint=) / indexed= */
function resolveColor(attrs: string, themeColors: string[]): string {
    if (!attrs) return "";
    const rgb = attrs.match(/rgb="(?:[0-9A-Fa-f]{2})?([0-9A-Fa-f]{6})"/)?.[1];
    if (rgb) return `#${rgb.toUpperCase()}`;
    const theme = attrs.match(/theme="(\d+)"/)?.[1];
    if (theme !== undefined) {
        const base = themeColors[Number(theme)] || "";
        if (!base) return "";
        const tint = Number(attrs.match(/tint="(-?[\d.]+)"/)?.[1] || "0");
        return tint ? applyTint(base, tint) : base;
    }
    const indexed = attrs.match(/indexed="(\d+)"/)?.[1];
    if (indexed !== undefined) return INDEXED_COLORS[Number(indexed)] || "";
    return "";
}

function applyTint(hex: string, tint: number): string {
    const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((part) => parseInt(part, 16));
    const adjusted = channels.map((value) => {
        const next = tint > 0 ? value * (1 - tint) + 255 * tint : value * (1 + tint);
        return Math.max(0, Math.min(255, Math.round(next)));
    });
    return `#${adjusted.map((value) => value.toString(16).padStart(2, "0").toUpperCase()).join("")}`;
}
