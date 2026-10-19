import * as XLSX from "xlsx";

import { cellKey, extractExcelCellImages } from "@/lib/canvas/excel-media";
import { extractExcelSheetStyles, type ExcelCellStyle, type ExcelSheetStyleMap } from "@/lib/canvas/excel-styles";

export type ExcelPreviewCell = {
    text: string;
    imageUrl?: string;
    /** 样式下标，引用 ExcelSheetPreview.styles */
    s?: number;
};

export type ExcelMerge = { r: number; c: number; rs: number; cs: number };

export type ExcelSheetPreview = {
    name: string;
    rowCount: number;
    colCount: number;
    /** 供 @ / AI 使用的截断文本（TSV，不含图片二进制） */
    content: string;
    /** 画布轻量预览网格 */
    preview: ExcelPreviewCell[][];
    contentTruncated?: boolean;
    /** 文件内定义的列宽（px），未定义的列为 0 */
    colWidths?: number[];
    /** 文件内定义的行高（px），未定义的行为 0 */
    rowHeights?: number[];
    /** 合并单元格（预览网格坐标） */
    merges?: ExcelMerge[];
    /** 去重样式表；单元格用 s 下标引用 */
    styles?: ExcelCellStyle[];
};

export type DroppedDocument = {
    name: string;
    title: string;
    content: string;
    truncated: boolean;
    kind: "markdown" | "excel" | "csv";
    sheets?: ExcelSheetPreview[];
};

type FileSystemEntryLike = {
    isFile: boolean;
    isDirectory: boolean;
    name: string;
    file?: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
};

const MAX_TEXT_CHARS = 120_000;
/** 收起时节点内可见行列 */
export const EXCEL_COLLAPSE_ROWS = 8;
export const EXCEL_COLLAPSE_COLS = 6;
/** 展开后写入节点的完整表格上限（覆盖常见大表；超限再截断） */
export const EXCEL_FULL_ROWS = 2000;
export const EXCEL_FULL_COLS = 200;
/** 写入 content 供 @ / AI 引用的上限（与预览网格一致，避免只传可视区一小块） */
const EXCEL_CONTENT_ROWS = EXCEL_FULL_ROWS;
const EXCEL_CONTENT_COLS = EXCEL_FULL_COLS;
const DOCUMENT_EXT = /\.(md|markdown|csv|xlsx|xls)$/i;

export function isDocumentFile(file: File) {
    return DOCUMENT_EXT.test(file.name);
}

export async function collectDroppedDocuments(input: {
    files?: File[];
    entries?: Array<{ isFile: boolean; isDirectory: boolean; name: string; file?: FileSystemEntryLike["file"] }>;
}): Promise<{ documents: DroppedDocument[]; errors: string[] }> {
    const files = await resolveDocumentFiles(input);
    const documents: DroppedDocument[] = [];
    const errors: string[] = [];
    for (const file of files) {
        try {
            const document = await parseDocumentFile(file);
            if (document) documents.push(document);
        } catch (error) {
            errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return { documents, errors };
}

async function resolveDocumentFiles(input: { files?: File[]; entries?: FileSystemEntryLike[] }) {
    const byKey = new Map<string, File>();
    for (const file of input.files || []) {
        if (isDocumentFile(file)) byKey.set(`${file.name}:${file.size}`, file);
    }
    for (const entry of input.entries || []) {
        if (!entry.isFile || !DOCUMENT_EXT.test(entry.name)) continue;
        const file = await readEntryFile(entry);
        if (file && isDocumentFile(file)) byKey.set(`${file.name}:${file.size}`, file);
    }
    return [...byKey.values()];
}

function readEntryFile(entry: FileSystemEntryLike) {
    if (!entry.isFile || !entry.file) return Promise.resolve<File | null>(null);
    return new Promise<File | null>((resolve) => {
        entry.file?.(
            (file) => resolve(file),
            () => resolve(null),
        );
    });
}

export async function parseDocumentFile(file: File): Promise<DroppedDocument | null> {
    const ext = fileExt(file.name);
    const title = stripExt(file.name) || file.name;
    if (ext === "md" || ext === "markdown") {
        const { content, truncated } = truncateText(await file.text());
        return { name: file.name, title, content, truncated, kind: "markdown" };
    }
    if (ext === "csv") {
        // CSV 按表格解析并带上 sheets，智能预览走 Excel 网格而不是纯文本
        const text = (await file.text()).replace(/^\uFEFF/, "");
        const workbook = XLSX.read(text, { type: "string" });
        const parsed = workbookToSheets(workbook, new Map());
        return { name: file.name, title, ...parsed, kind: "csv" };
    }
    if (ext === "xlsx" || ext === "xls") {
        const parsed = await parseExcelFile(file, ext === "xlsx");
        return { name: file.name, title, ...parsed, kind: "excel" };
    }
    return null;
}

async function parseExcelFile(file: File, canExtractImages: boolean): Promise<{ content: string; sheets: ExcelSheetPreview[]; truncated: boolean }> {
    const buffer = await file.arrayBuffer();
    // cellStyles 用于读取 !cols 列宽（社区版不含单元格颜色，颜色走 excel-styles 自解析）
    const workbook = XLSX.read(buffer, { type: "array", cellFormula: true, cellStyles: true });
    const sheetNames = workbook.SheetNames || [];
    const imageMap = canExtractImages && sheetNames.length ? extractExcelCellImages(buffer, sheetNames) : new Map<string, string>();
    const styleMaps = canExtractImages && sheetNames.length
        ? extractExcelSheetStyles(buffer, sheetNames, EXCEL_FULL_ROWS, EXCEL_FULL_COLS)
        : new Map<string, ExcelSheetStyleMap>();
    return workbookToSheets(workbook, imageMap, styleMaps);
}

function workbookToSheets(
    workbook: XLSX.WorkBook,
    imageMap: Map<string, string>,
    styleMaps: Map<string, ExcelSheetStyleMap> = new Map(),
): { content: string; sheets: ExcelSheetPreview[]; truncated: boolean } {
    const sheetNames = workbook.SheetNames || [];
    if (!sheetNames.length) return { content: "", sheets: [], truncated: false };

    const sheets: ExcelSheetPreview[] = [];
    const blocks: string[] = [];
    let used = 0;
    let truncated = false;

    for (const sheetName of sheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const { rows: normalized, startRow, startCol } = readSheetCells(sheet, sheetName, imageMap, styleMaps.get(sheetName));
        fillMissingImageColumn(normalized, sheetName, imageMap);
        const rowCount = normalized.length;
        const colCount = rowCount ? Math.max(...normalized.map((row) => row.length)) : 0;
        const preview = sliceGrid(normalized, EXCEL_FULL_ROWS, EXCEL_FULL_COLS, colCount);
        const previewRows = preview.length;
        const previewCols = preview[0]?.length || 0;
        const contentGrid = sliceGrid(normalized, EXCEL_CONTENT_ROWS, EXCEL_CONTENT_COLS, colCount);
        const gridTruncated = rowCount > EXCEL_FULL_ROWS || colCount > EXCEL_FULL_COLS;
        const contentTruncated = rowCount > EXCEL_CONTENT_ROWS || colCount > EXCEL_CONTENT_COLS || gridTruncated;
        if (contentTruncated || gridTruncated) truncated = true;

        // AI 引用文本去掉空行，预览网格保留空行以对齐真实行号
        let body = rowsToTsv(contentGrid.filter((row) => row.some((cell) => cell.text.trim() || cell.imageUrl)));
        if (contentTruncated) {
            body += `\n… (${rowCount} 行 × ${colCount} 列，引用已截断)`;
        }

        const colWidths = readColWidths(sheet, startCol, previewCols);
        const rowHeights = readRowHeights(sheet, startRow, previewRows);
        const merges = readMerges(sheet, startRow, startCol, previewRows, previewCols);
        const styles = styleMaps.get(sheetName)?.styles;

        // 工作表节点必须齐全；MAX_TEXT_CHARS 只限制父节点 @ 引用文本，不能丢掉后续表
        sheets.push({
            name: sheetName,
            rowCount,
            colCount,
            content: body,
            preview,
            contentTruncated,
            ...(colWidths ? { colWidths } : {}),
            ...(rowHeights ? { rowHeights } : {}),
            ...(merges.length ? { merges } : {}),
            ...(styles?.length ? { styles } : {}),
        });

        const heading = sheetNames.length > 1 ? `[${sheetName}]\n` : "";
        const overhead = (blocks.length ? 2 : 0) + heading.length;
        const remaining = MAX_TEXT_CHARS - used - overhead;
        if (remaining <= 0) {
            truncated = true;
            continue;
        }
        let blockBody = body;
        if (blockBody.length > remaining) {
            blockBody = `${blockBody.slice(0, remaining)}\n…`;
            truncated = true;
        }
        blocks.push(`${heading}${blockBody}`);
        used += overhead + blockBody.length;
    }

    return { content: blocks.join("\n\n"), sheets, truncated };
}

function readSheetCells(
    sheet: XLSX.WorkSheet,
    sheetName: string,
    imageMap: Map<string, string>,
    styleMap?: ExcelSheetStyleMap,
): { rows: ExcelPreviewCell[][]; startRow: number; startCol: number } {
    const ref = sheet["!ref"];
    if (!ref) return { rows: [], startRow: 0, startCol: 0 };
    const range = XLSX.utils.decode_range(ref);
    const rows: ExcelPreviewCell[][] = [];
    let lastValueRow = -1;
    for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
        const row: ExcelPreviewCell[] = [];
        let hasValue = false;
        for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
            const cell = buildPreviewCell(sheet, sheetName, rowIndex, colIndex, imageMap);
            const styleIndex = styleMap?.cells.get(`${rowIndex}:${colIndex}`);
            if (styleIndex !== undefined) cell.s = styleIndex;
            if (cell.text.trim() || cell.imageUrl) hasValue = true;
            row.push(cell);
        }
        // 保留中间空行以对齐真实行号与合并区，只裁掉尾部空行
        if (hasValue) lastValueRow = rows.length;
        rows.push(row);
    }
    return { rows: rows.slice(0, lastValueRow + 1), startRow: range.s.r, startCol: range.s.c };
}

/** 读取文件内定义的列宽（px）；整表都没有定义时返回 undefined */
function readColWidths(sheet: XLSX.WorkSheet, startCol: number, colCount: number): number[] | undefined {
    const cols = sheet["!cols"];
    if (!Array.isArray(cols) || !cols.length || !colCount) return undefined;
    let hasAny = false;
    const widths = Array.from({ length: colCount }, (_, index) => {
        const info = cols[startCol + index];
        const px = info?.wpx || (typeof info?.wch === "number" ? Math.round(info.wch * 7 + 5) : typeof info?.width === "number" ? Math.round(info.width * 7 + 5) : 0);
        if (px > 0) hasAny = true;
        return px > 0 ? Math.max(36, Math.min(480, px)) : 0;
    });
    return hasAny ? widths : undefined;
}

/** 读取文件内定义的行高（px）；整表都没有定义时返回 undefined */
function readRowHeights(sheet: XLSX.WorkSheet, startRow: number, rowCount: number): number[] | undefined {
    const rows = sheet["!rows"];
    if (!Array.isArray(rows) || !rows.length || !rowCount) return undefined;
    let hasAny = false;
    const heights = Array.from({ length: rowCount }, (_, index) => {
        const info = rows[startRow + index];
        const px = info?.hpx || (typeof info?.hpt === "number" ? (info.hpt * 96) / 72 : 0);
        if (px > 0) hasAny = true;
        return px > 0 ? Math.max(20, Math.min(400, Math.round(px))) : 0;
    });
    return hasAny ? heights : undefined;
}

/** 合并单元格换算到预览网格坐标并裁剪越界部分 */
function readMerges(sheet: XLSX.WorkSheet, startRow: number, startCol: number, rowCount: number, colCount: number): ExcelMerge[] {
    const merges = sheet["!merges"];
    if (!Array.isArray(merges) || !merges.length) return [];
    const out: ExcelMerge[] = [];
    for (const range of merges) {
        const r = range.s.r - startRow;
        const c = range.s.c - startCol;
        if (r < 0 || c < 0 || r >= rowCount || c >= colCount) continue;
        const rs = Math.min(range.e.r - range.s.r + 1, rowCount - r);
        const cs = Math.min(range.e.c - range.s.c + 1, colCount - c);
        if (rs <= 1 && cs <= 1) continue;
        out.push({ r, c, rs, cs });
    }
    return out;
}

function buildPreviewCell(
    sheet: XLSX.WorkSheet,
    sheetName: string,
    rowIndex: number,
    colIndex: number,
    imageMap: Map<string, string>,
): ExcelPreviewCell {
    const addr = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
    const raw = sheet[addr] as XLSX.CellObject | undefined;
    const text = stringifyCell(raw?.w) || stringifyCell(raw?.v);
    const link = typeof raw?.l?.Target === "string" ? raw.l.Target.trim() : "";
    const formula = typeof raw?.f === "string" ? raw.f : "";
    const fromMap = imageMap.get(cellKey(sheetName, rowIndex, colIndex));
    const imageUrl =
        fromMap ||
        (isImageUrl(link) ? link : "") ||
        (isImageUrl(text) ? text : "") ||
        "";

    let display = text;
    if (!display && (fromMap || /DISPIMG/i.test(formula))) display = "图片";
    if (isImageUrl(display)) display = "图片";

    return imageUrl ? { text: display || "图片", imageUrl } : { text: display };
}

/** 锚点列与「图片」列不一致时，按行序把该表图片补进图片列 */
function fillMissingImageColumn(rows: ExcelPreviewCell[][], sheetName: string, imageMap: Map<string, string>) {
    if (!rows.length) return;
    const header = rows[0];
    const imgCol = header.findIndex((cell) => /^(图片|image|img|主图|缩略图)$/i.test(cell.text.trim()) || /图片|主图|缩略图/i.test(cell.text));
    if (imgCol < 0) return;

    const pool = [...imageMap.entries()]
        .filter(([key]) => key.startsWith(`${sheetName}!`))
        .map(([key, url]) => {
            const rest = key.slice(sheetName.length + 1);
            const [rowText, colText] = rest.split(":");
            return { row: Number(rowText), col: Number(colText), url };
        })
        .filter((item) => Number.isFinite(item.row) && Number.isFinite(item.col))
        .sort((a, b) => a.row - b.row || a.col - b.col);

    if (!pool.length) return;

    const preferred = pool.filter((item) => item.col === imgCol || item.col === 0);
    const urls = (preferred.length ? preferred : pool).map((item) => item.url);
    let cursor = 0;
    for (let r = 1; r < rows.length && cursor < urls.length; r += 1) {
        const cell = rows[r][imgCol] || { text: "" };
        if (cell.imageUrl) continue;
        const looksLikeImageCell = !cell.text.trim() || cell.text === "图片" || /DISPIMG/i.test(cell.text);
        if (!looksLikeImageCell && cell.text.trim()) continue;
        rows[r][imgCol] = { text: cell.text || "图片", imageUrl: urls[cursor] };
        cursor += 1;
    }
}

function sliceGrid(rows: ExcelPreviewCell[][], maxRows: number, maxCols: number, width: number) {
    const cols = Math.min(maxCols, Math.max(width, 0));
    return rows.slice(0, maxRows).map((row) => {
        const next = row.slice(0, cols);
        while (next.length < cols) next.push({ text: "" });
        return next;
    });
}

export function rowsToTsv(rows: ExcelPreviewCell[][]) {
    return rows.map((row) => row.map((cell) => (cell.imageUrl ? cell.text || "[图片]" : cell.text)).join("\t")).join("\n");
}

/** 从预览网格生成给 AI / Codex 的工作表文本（优先完整行列，再按字数截断） */
export function excelSheetTextForAi(
    sheet: Pick<ExcelSheetPreview, "preview" | "content" | "rowCount" | "colCount" | "contentTruncated">,
    maxChars = MAX_TEXT_CHARS,
): string {
    const fromPreview = sheet.preview?.length ? rowsToTsv(sheet.preview) : "";
    let body = (fromPreview || sheet.content || "").trim();
    if (!body) return "";
    const previewRows = sheet.preview?.length || 0;
    const previewCols = sheet.preview?.[0]?.length || 0;
    const gridTruncated = sheet.rowCount > previewRows || sheet.colCount > previewCols;
    if (body.length > maxChars) {
        return `${body.slice(0, maxChars)}\n… (${sheet.rowCount} 行 × ${sheet.colCount} 列，引用已截断)`;
    }
    if (gridTruncated && !body.includes("引用已截断")) {
        return `${body}\n… (${sheet.rowCount} 行 × ${sheet.colCount} 列，引用已截断)`;
    }
    return body;
}

function stringifyCell(value: unknown) {
    if (value == null) return "";
    return String(value).replace(/\r?\n/g, " ").replace(/\t/g, " ").trim();
}

function isImageUrl(value: string) {
    if (!value) return false;
    if (/^data:image\//i.test(value)) return true;
    if (!/^https?:\/\//i.test(value)) return false;
    return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(value) || /[?&](format|fm)=(jpg|jpeg|png|webp)/i.test(value) || /\/images?\//i.test(value);
}

function truncateText(value: string) {
    const content = value.replace(/^\uFEFF/, "");
    if (content.length <= MAX_TEXT_CHARS) return { content, truncated: false };
    return { content: `${content.slice(0, MAX_TEXT_CHARS)}\n\n…`, truncated: true };
}

function fileExt(name: string) {
    const match = /\.([^.]+)$/.exec(name);
    return match?.[1]?.toLowerCase() || "";
}

function stripExt(name: string) {
    return name.replace(/\.[^.]+$/, "").trim();
}
