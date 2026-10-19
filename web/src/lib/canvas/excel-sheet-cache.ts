import type { ExcelSheetPreview } from "@/lib/canvas/document-drop";

/** 会话内缓存，展开子节点时优先用；父节点仍持久化完整 preview 作兜底 */
const sheetCache = new Map<string, ExcelSheetPreview[]>();

export function stashExcelSheets(ownerNodeId: string, sheets: ExcelSheetPreview[]) {
    sheetCache.set(ownerNodeId, sheets);
}

export function getExcelSheet(ownerNodeId: string, index: number): ExcelSheetPreview | null {
    return sheetCache.get(ownerNodeId)?.[index] || null;
}

export function getExcelSheets(ownerNodeId: string): ExcelSheetPreview[] {
    return sheetCache.get(ownerNodeId) || [];
}

export function clearExcelSheets(ownerNodeId: string) {
    sheetCache.delete(ownerNodeId);
}
