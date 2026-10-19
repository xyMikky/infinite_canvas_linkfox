import { buildAddSmartPreviewNodeOp } from "@/components/canvas/nodes/smart-preview-node";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { excelSheetTextForAi } from "@/lib/canvas/document-drop";
import { fileLocalPath } from "@/lib/canvas/folder-disk-path";
import { isHtmlDesignBoard } from "@/lib/canvas/html-design-source";
import {
    isPreviewableFileName,
    parseFolderPreviewFile,
    type FolderPreviewFile,
} from "@/lib/canvas/folder-preview-cache";
import type { Position } from "@/types/canvas";

const DEFAULT_SIZE = { width: 420, height: 320 };

function previewNodeSize(kind: FolderPreviewFile["kind"]) {
    if (kind === "canvasTsx") return { width: 560, height: 780 };
    if (kind === "html") return { width: 480, height: 640 };
    if (kind === "pdf") return { width: 420, height: 560 };
    if (kind === "excel" || kind === "csv") return { width: 520, height: 400 };
    if (kind === "markdown" || kind === "text") return { width: 420, height: 480 };
    return DEFAULT_SIZE;
}

/** 画布原生可预览的单文件：拖入后直接建智能预览节点，不经文件夹中转 */
export function isStandalonePreviewDropFile(file: File) {
    return isPreviewableFileName(file.name);
}

export async function buildStandaloneSmartPreviewOp(input: {
    file: File;
    position: Position;
    id?: string;
}): Promise<CanvasAgentOp | null> {
    const parsed = await parseFolderPreviewFile(input.file, input.file.name);
    if (!parsed) return null;
    const size = parsed.kind === "html" && isHtmlDesignBoard({ content: parsed.content })
        ? { width: 960, height: 720 }
        : previewNodeSize(parsed.kind);
    const id = input.id || `smart-preview-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const title = (parsed.name || input.file.name).slice(0, 48);
    const diskPath = fileLocalPath(input.file).trim();
    const previewPath = diskPath || parsed.path;

    if (parsed.kind === "excel" || (parsed.kind === "csv" && (parsed.sheets || []).length)) {
        const sheets = parsed.sheets || [];
        if (!sheets.length) return null;
        const sheet = sheets[0];
        return buildAddSmartPreviewNodeOp({
            id,
            title: sheets.length === 1 ? title : `${title.slice(0, 32)} · ${sheet.name}`.slice(0, 48),
            position: input.position,
            width: size.width,
            height: size.height,
            metadata: {
                status: "success",
                smartPreviewPath: previewPath,
                smartPreviewKind: parsed.kind === "csv" ? "csv" : "excel",
                smartPreviewSheetIndex: 0,
                smartPreviewSheetName: sheet.name,
                smartPreviewSheetCount: sheets.length,
                content: excelSheetTextForAi(sheet),
                excelPreview: sheet.preview,
                excelRowCount: sheet.rowCount,
                excelColCount: sheet.colCount,
                excelColWidths: sheet.colWidths,
                excelRowHeights: sheet.rowHeights,
                excelMerges: sheet.merges,
                excelStyles: sheet.styles,
                ...(sheets.length > 1 ? { excelSheets: sheets } : {}),
                ...(parsed.truncated ? { errorDetails: "truncated" } : {}),
            },
        });
    }

    const content =
        parsed.kind === "model3d"
            ? parsed.name || input.file.name
            : String(parsed.content || "");
    return buildAddSmartPreviewNodeOp({
        id,
        title,
        position: input.position,
        width: size.width,
        height: size.height,
        metadata: {
            status: content || parsed.kind === "model3d" ? "success" : "error",
            smartPreviewPath: previewPath,
            smartPreviewKind: parsed.kind,
            content,
            ...(parsed.truncated ? { errorDetails: "truncated" } : {}),
        },
    });
}
