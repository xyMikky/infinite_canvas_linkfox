import React, { useEffect, useMemo, useRef, useState } from "react";

import { handleNodeContentWheel } from "@/lib/canvas/canvas-wheel";
import type { ExcelMerge } from "@/lib/canvas/document-drop";
import type { ExcelCellStyle } from "@/lib/canvas/excel-styles";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export type ExcelVirtualCell = {
    text: string;
    imageUrl?: string;
    /** 样式下标，引用 styles 数组 */
    s?: number;
};

type ExcelVirtualSheetProps = {
    rows: ExcelVirtualCell[][];
    detailOpen: boolean;
    collapseRows?: number;
    collapseCols?: number;
    /** 文件内定义的列宽（px，0 = 未定义按内容估宽） */
    colWidths?: number[];
    /** 文件内定义的行高（px，0 = 未定义按内容自适应） */
    rowHeights?: number[];
    merges?: ExcelMerge[];
    styles?: ExcelCellStyle[];
};

const ROW_H = 28;
const LINE_H = 17;
const MAX_ROW_H = 240;
const HEAD_H = 22;
const ROW_HEAD_W = 36;
const OVERSCAN_PX = 240;
const MIN_COL_W = 40;
const MAX_COL_W = 640;

type CellDetail = { row: number; col: number; left: number; top: number };

/**
 * 行列窗口虚拟化 Excel 网格：文件列宽/行高、按内容自适应行高换行显示、
 * 拖拽调宽、合并单元格、背景与字体样式、点击单元格查看完整内容；配色跟随画布主题。
 */
export const ExcelVirtualSheet = React.memo(function ExcelVirtualSheet({
    rows,
    detailOpen,
    collapseRows = 8,
    collapseCols = 6,
    colWidths,
    rowHeights: fileRowHeights,
    merges,
    styles,
}: ExcelVirtualSheetProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const dark = useThemeStore((state) => state.theme) === "dark";
    const scrollerRef = useRef<HTMLDivElement>(null);
    const [view, setView] = useState({ top: 0, left: 0, width: 360, height: 200 });
    const [widthOverrides, setWidthOverrides] = useState<Record<number, number>>({});
    const [detail, setDetail] = useState<CellDetail | null>(null);

    const displayRows = useMemo(() => {
        if (detailOpen) return rows;
        return rows.slice(0, collapseRows).map((row) => row.slice(0, collapseCols));
    }, [rows, detailOpen, collapseRows, collapseCols]);

    const displayCols = displayRows[0]?.length || 0;
    const colLetters = useMemo(() => Array.from({ length: displayCols }, (_, index) => excelColLetter(index)), [displayCols]);

    /** 每列基础宽度：文件定义优先，否则按内容采样估宽 */
    const baseWidths = useMemo(() => {
        const sample = displayRows.slice(0, 80);
        return Array.from({ length: displayCols }, (_, colIndex) => {
            const defined = colWidths?.[colIndex] || 0;
            if (defined > 0) return Math.max(MIN_COL_W, Math.min(320, defined));
            let width = 64;
            let hasImage = false;
            for (const row of sample) {
                const cell = row[colIndex];
                if (!cell) continue;
                if (cell.imageUrl) hasImage = true;
                width = Math.max(width, estimateTextWidth(cell.text, 40));
            }
            if (hasImage) width = Math.max(width, 76);
            return Math.min(280, width);
        });
    }, [displayRows, displayCols, colWidths]);

    const widths = useMemo(
        () => baseWidths.map((width, index) => widthOverrides[index] || width),
        [baseWidths, widthOverrides],
    );

    /** 列偏移前缀和：offsets[i] = 第 i 列左缘（不含行号列） */
    const colOffsets = useMemo(() => prefixSum(widths), [widths]);

    /** 行高：文件行高优先；否则按单元格文本量与当前列宽估算换行行数 */
    const heights = useMemo(() => {
        return displayRows.map((row, rowIndex) => {
            const defined = fileRowHeights?.[rowIndex] || 0;
            if (defined > 0) return Math.max(20, Math.min(400, defined));
            let height = ROW_H;
            for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
                const cell = row[colIndex];
                if (!cell) continue;
                if (cell.imageUrl) height = Math.max(height, 34);
                const text = cell.text || "";
                if (text.length < 10) continue;
                const usable = Math.max(30, (widths[colIndex] || 96) - 14);
                const lines = Math.min(10, Math.ceil(estimateTextWidth(text, 400) / usable));
                if (lines > 1) height = Math.max(height, lines * LINE_H + 10);
            }
            return Math.min(MAX_ROW_H, height);
        });
    }, [displayRows, widths, fileRowHeights]);

    const rowOffsets = useMemo(() => prefixSum(heights), [heights]);
    const mergeInfo = useMemo(() => buildMergeInfo(merges, displayRows.length, displayCols), [merges, displayRows.length, displayCols]);

    useEffect(() => {
        const el = scrollerRef.current;
        if (!el) return;
        let frame = 0;
        const sync = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                setView({ top: el.scrollTop, left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight });
            });
        };
        sync();
        el.addEventListener("scroll", sync, { passive: true });
        const observer = new ResizeObserver(sync);
        observer.observe(el);
        return () => {
            cancelAnimationFrame(frame);
            el.removeEventListener("scroll", sync);
            observer.disconnect();
        };
    }, [detailOpen, displayRows.length, displayCols]);

    useEffect(() => {
        setDetail(null);
    }, [rows, detailOpen]);

    /** 画布主题注入：浅色接近原生表格，深色融入画布 */
    const themeVars = {
        "--excel-grid": dark ? "#3f3b36" : "#d0d0d0",
        "--excel-head": dark ? "#26231f" : "#e7e6e6",
        "--excel-head-text": dark ? "#a8a29e" : "#595959",
        "--excel-bg": dark ? "#1c1917" : "#ffffff",
        "--excel-text": dark ? "#e7e5e4" : "#222222",
        borderColor: theme.node.stroke,
        background: dark ? "#1c1917" : "#ffffff",
    } as React.CSSProperties;

    const beginResize = (colIndex: number) => (event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startWidth = widths[colIndex];
        const onMove = (move: PointerEvent) => {
            const next = Math.max(MIN_COL_W, Math.min(MAX_COL_W, startWidth + (move.clientX - startX)));
            setWidthOverrides((current) => ({ ...current, [colIndex]: next }));
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    const openDetail = (rowIndex: number, colIndex: number) => {
        const anchor = mergeInfo.anchorOf.get(`${rowIndex}:${colIndex}`);
        const targetRow = anchor ? anchor.r : rowIndex;
        const targetCol = anchor ? anchor.c : colIndex;
        const cell = displayRows[targetRow]?.[targetCol];
        if (!cell || (!cell.text.trim() && !cell.imageUrl)) {
            setDetail(null);
            return;
        }
        const merge = mergeInfo.byAnchor.get(`${targetRow}:${targetCol}`);
        const bottom = HEAD_H + rowOffsets[Math.min(rowOffsets.length - 1, targetRow + (merge?.rs || 1))];
        setDetail({ row: targetRow, col: targetCol, left: ROW_HEAD_W + colOffsets[targetCol], top: bottom + 2 });
    };

    if (!detailOpen) {
        return (
            <div ref={scrollerRef} className="canvas-excel-sheet thin-scrollbar h-full overflow-auto rounded-md border" style={themeVars} onWheel={handleNodeContentWheel}>
                <StaticExcelTable rows={displayRows} colLetters={colLetters} merges={mergeInfo} styles={styles} />
            </div>
        );
    }

    const totalWidth = ROW_HEAD_W + (colOffsets[displayCols] || 0);
    const totalHeight = HEAD_H + (rowOffsets[displayRows.length] || 0);
    const startCol = findOffsetIndex(colOffsets, Math.max(0, view.left - OVERSCAN_PX));
    const endCol = Math.min(displayCols, findOffsetIndex(colOffsets, view.left + view.width + OVERSCAN_PX) + 1);
    const startRow = findOffsetIndex(rowOffsets, Math.max(0, view.top - OVERSCAN_PX));
    const endRow = Math.min(displayRows.length, findOffsetIndex(rowOffsets, view.top + view.height + OVERSCAN_PX) + 1);
    const visibleMerges = mergeInfo.list.filter((merge) => merge.r < endRow && merge.r + merge.rs > startRow && merge.c < endCol && merge.c + merge.cs > startCol);
    const detailCell = detail ? displayRows[detail.row]?.[detail.col] : null;

    const renderCell = (rowIndex: number, colIndex: number, cell: ExcelVirtualCell, merge?: ExcelMerge) => {
        const text = String(cell.text ?? "");
        const showText = Boolean(text && !(cell.imageUrl && (text === "图片" || !text)));
        const style = cell.s !== undefined ? styles?.[cell.s] : undefined;
        const width = merge ? colOffsets[Math.min(displayCols, colIndex + merge.cs)] - colOffsets[colIndex] : widths[colIndex];
        const height = merge
            ? rowOffsets[Math.min(displayRows.length, rowIndex + merge.rs)] - rowOffsets[rowIndex]
            : heights[rowIndex];
        const numeric = isNumericExcelCell(text);
        return (
            <div
                key={`c-${rowIndex}-${colIndex}`}
                className={`canvas-excel-virtual-cell ${numeric ? "canvas-excel-num" : ""}`}
                style={{
                    top: HEAD_H + rowOffsets[rowIndex],
                    left: ROW_HEAD_W + colOffsets[colIndex],
                    width,
                    height,
                    ...(merge ? { zIndex: 2 } : {}),
                    ...(style?.bg ? { background: style.bg } : {}),
                    ...(style?.color ? { color: style.color } : {}),
                    ...(style?.bold ? { fontWeight: 600 } : {}),
                }}
                onClick={() => openDetail(rowIndex, colIndex)}
            >
                <div className="canvas-excel-cell-inner" style={{ alignItems: height > ROW_H + 4 ? "flex-start" : "center" }}>
                    {cell.imageUrl ? <img src={cell.imageUrl} alt="" className="canvas-excel-thumb" loading="lazy" decoding="async" draggable={false} style={{ maxHeight: Math.max(22, height - 8), width: "auto", height: Math.max(22, Math.min(height - 8, 64)) }} /> : null}
                    {showText ? (
                        <span
                            className="canvas-excel-text"
                            style={numeric ? undefined : { whiteSpace: "normal", wordBreak: "break-word", lineHeight: `${LINE_H}px`, maxHeight: height - 8, overflow: "hidden" }}
                        >
                            {text}
                        </span>
                    ) : null}
                </div>
            </div>
        );
    };

    return (
        <div
            ref={scrollerRef}
            className="canvas-excel-sheet canvas-excel-sheet-full thin-scrollbar h-full overflow-auto rounded-md border"
            style={themeVars}
            onWheel={handleNodeContentWheel}
        >
            <div style={{ width: totalWidth, height: totalHeight, position: "relative" }}>
                <div className="canvas-excel-virtual-corner" style={{ width: ROW_HEAD_W, height: HEAD_H }} />
                {colLetters.slice(startCol, endCol).map((letter, offset) => {
                    const colIndex = startCol + offset;
                    return (
                        <div key={`c-${colIndex}`} className="canvas-excel-virtual-col-head" style={{ left: ROW_HEAD_W + colOffsets[colIndex], width: widths[colIndex], height: HEAD_H }}>
                            {letter}
                            <div
                                onPointerDown={beginResize(colIndex)}
                                style={{ position: "absolute", right: -3, top: 0, width: 7, height: "100%", cursor: "col-resize", zIndex: 5 }}
                            />
                        </div>
                    );
                })}
                {Array.from({ length: Math.max(0, endRow - startRow) }, (_, offset) => {
                    const rowIndex = startRow + offset;
                    const row = displayRows[rowIndex];
                    if (!row) return null;
                    return (
                        <React.Fragment key={`r-${rowIndex}`}>
                            <div className="canvas-excel-virtual-row-head" style={{ top: HEAD_H + rowOffsets[rowIndex], width: ROW_HEAD_W, height: heights[rowIndex] }}>
                                {rowIndex + 1}
                            </div>
                            {row.slice(startCol, endCol).map((cell, offsetCol) => {
                                const colIndex = startCol + offsetCol;
                                const key = `${rowIndex}:${colIndex}`;
                                if (mergeInfo.covered.has(key) || mergeInfo.byAnchor.has(key)) return null;
                                return renderCell(rowIndex, colIndex, cell, undefined);
                            })}
                        </React.Fragment>
                    );
                })}
                {visibleMerges.map((merge) => {
                    const cell = displayRows[merge.r]?.[merge.c];
                    if (!cell) return null;
                    return renderCell(merge.r, merge.c, cell, merge);
                })}
                {detail && detailCell ? (
                    <div
                        style={{
                            position: "absolute",
                            left: Math.max(4, Math.min(detail.left, totalWidth - 332)),
                            top: detail.top,
                            width: 328,
                            maxHeight: 280,
                            overflow: "auto",
                            zIndex: 30,
                            background: theme.toolbar.panel,
                            border: `1px solid ${theme.node.stroke}`,
                            borderRadius: 10,
                            boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
                            padding: "8px 10px",
                            cursor: "auto",
                            color: theme.node.text,
                        }}
                        onClick={(event) => event.stopPropagation()}
                        onWheel={(event) => event.stopPropagation()}
                    >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                            <span style={{ fontSize: 11, color: theme.node.muted }}>{excelColLetter(detail.col)}{detail.row + 1}</span>
                            <button
                                type="button"
                                onClick={() => setDetail(null)}
                                style={{ border: "none", background: "transparent", cursor: "pointer", color: theme.node.muted, fontSize: 12, lineHeight: 1, padding: 2 }}
                                aria-label="close"
                            >
                                ✕
                            </button>
                        </div>
                        {detailCell.imageUrl ? <img src={detailCell.imageUrl} alt="" style={{ maxWidth: "100%", maxHeight: 160, objectFit: "contain", marginBottom: 6, borderRadius: 6 }} draggable={false} /> : null}
                        {detailCell.text && detailCell.text !== "图片" ? (
                            <div style={{ fontSize: 12, lineHeight: "18px", whiteSpace: "pre-wrap", wordBreak: "break-word", userSelect: "text" }}>{detailCell.text}</div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </div>
    );
});

function StaticExcelTable({
    rows,
    colLetters,
    merges,
    styles,
}: {
    rows: ExcelVirtualCell[][];
    colLetters: string[];
    merges: MergeInfo;
    styles?: ExcelCellStyle[];
}) {
    return (
        <table className="canvas-excel-table border-collapse">
            <thead>
                <tr>
                    <th className="canvas-excel-corner sticky left-0 top-0 z-20" />
                    {colLetters.map((letter) => (
                        <th key={letter} className="canvas-excel-col-head sticky top-0 z-10">
                            {letter}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                        <th className="canvas-excel-row-head sticky left-0 z-10">{rowIndex + 1}</th>
                        {row.map((cell, colIndex) => {
                            if (merges.covered.has(`${rowIndex}:${colIndex}`)) return null;
                            const merge = merges.byAnchor.get(`${rowIndex}:${colIndex}`);
                            const text = clipExcelCell(cell.text, 20);
                            const showText = Boolean(text && text !== "-" && !(cell.imageUrl && (cell.text === "图片" || !cell.text)));
                            const style = cell.s !== undefined ? styles?.[cell.s] : undefined;
                            return (
                                <td
                                    key={colIndex}
                                    rowSpan={merge && merge.rs > 1 ? Math.min(merge.rs, rows.length - rowIndex) : undefined}
                                    colSpan={merge && merge.cs > 1 ? Math.min(merge.cs, row.length - colIndex) : undefined}
                                    className={`canvas-excel-cell ${isNumericExcelCell(cell.text) ? "canvas-excel-num" : ""}`}
                                    style={{
                                        ...(style?.bg ? { background: style.bg } : {}),
                                        ...(style?.color ? { color: style.color } : {}),
                                        ...(style?.bold ? { fontWeight: 600 } : {}),
                                    }}
                                    title={cell.text || undefined}
                                >
                                    <div className="canvas-excel-cell-inner">
                                        {cell.imageUrl ? <img src={cell.imageUrl} alt="" className="canvas-excel-thumb" loading="lazy" decoding="async" draggable={false} /> : null}
                                        {showText ? <span className="canvas-excel-text">{text}</span> : null}
                                    </div>
                                </td>
                            );
                        })}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

type MergeInfo = {
    list: ExcelMerge[];
    covered: Set<string>;
    byAnchor: Map<string, ExcelMerge>;
    /** 覆盖格 -> 主格坐标 */
    anchorOf: Map<string, { r: number; c: number }>;
};

function buildMergeInfo(merges: ExcelMerge[] | undefined, rowCount: number, colCount: number): MergeInfo {
    const info: MergeInfo = { list: [], covered: new Set(), byAnchor: new Map(), anchorOf: new Map() };
    for (const merge of merges || []) {
        if (merge.r < 0 || merge.c < 0 || merge.r >= rowCount || merge.c >= colCount) continue;
        const rs = Math.min(merge.rs, rowCount - merge.r);
        const cs = Math.min(merge.cs, colCount - merge.c);
        if (rs <= 0 || cs <= 0 || (rs <= 1 && cs <= 1)) continue;
        const clamped = { r: merge.r, c: merge.c, rs, cs };
        info.list.push(clamped);
        info.byAnchor.set(`${merge.r}:${merge.c}`, clamped);
        for (let row = merge.r; row < merge.r + rs; row += 1) {
            for (let col = merge.c; col < merge.c + cs; col += 1) {
                if (row === merge.r && col === merge.c) continue;
                info.covered.add(`${row}:${col}`);
                info.anchorOf.set(`${row}:${col}`, { r: merge.r, c: merge.c });
            }
        }
    }
    return info;
}

function prefixSum(values: number[]) {
    const out = new Array<number>(values.length + 1);
    out[0] = 0;
    for (let index = 0; index < values.length; index += 1) out[index + 1] = out[index] + values[index];
    return out;
}

/** 在前缀和数组中找覆盖 x 的下标 */
function findOffsetIndex(offsets: number[], x: number) {
    let low = 0;
    let high = Math.max(0, offsets.length - 2);
    while (low < high) {
        const mid = (low + high + 1) >> 1;
        if (offsets[mid] <= x) low = mid;
        else high = mid - 1;
    }
    return Math.max(0, low);
}

/** 估算文本渲染宽度：CJK ~13px/字，ASCII ~7px/字 */
function estimateTextWidth(value: string, sampleLimit: number) {
    const text = String(value ?? "").trim();
    if (!text) return 0;
    let width = 18;
    const sample = text.length > sampleLimit ? text.slice(0, sampleLimit) : text;
    for (const ch of sample) {
        width += ch.charCodeAt(0) > 0xff ? 13 : 7;
    }
    return width;
}

function excelColLetter(index: number) {
    let n = index;
    let out = "";
    do {
        out = String.fromCharCode(65 + (n % 26)) + out;
        n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return out;
}

function isNumericExcelCell(value: string) {
    const text = String(value ?? "").replace(/,/g, "").trim();
    if (!text) return false;
    return /^-?\d+(\.\d+)?$/.test(text);
}

function clipExcelCell(value: unknown, max = 18) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text || "-";
}
