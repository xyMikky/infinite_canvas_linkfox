import { App, message as antdMessage } from "antd";
import { saveAs } from "file-saver";
import { Download, Eye, FileImage, FileSpreadsheet, FileText, Globe, ImageDown, Box, ImageIcon, Maximize2, Monitor, Moon, Network, Sheet, Sun, X } from "lucide-react";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Streamdown } from "streamdown";

import { BrowserPdfPreview } from "@/components/canvas/browser-preview";
import { HtmlDesignBoard } from "@/components/canvas/html-design-board";
import { CursorCanvasPreview } from "@/components/canvas/cursor-canvas-preview";
import { ExcelVirtualSheet } from "@/components/canvas/excel-virtual-sheet";
import { Model3dPreview } from "@/components/canvas/model-3d-preview";
import { FOLDER_NODE_TYPE } from "@/components/canvas/nodes/folder-node";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { buildCanvasDomExplodeOps, captureLiveCanvasFragment, findLiveCanvasFragment, measureCanvasBlocks } from "@/lib/canvas/canvas-tsx-explode-dom";
import { handleNodeContentWheel } from "@/lib/canvas/canvas-wheel";
import { excelSheetTextForAi, type ExcelSheetPreview } from "@/lib/canvas/document-drop";
import { exportSmartPreviewImage } from "@/lib/canvas/export-preview-image";
import { isHtmlDesignBoard } from "@/lib/canvas/html-design-source";
import {
    isPreviewableFileName,
    loadFolderPreviewFiles,
    parseFolderPreviewFile,
    resolveFolderPreviewFile,
    upsertFolderPreviewFile,
    upsertFolderPreviewSource,
    type FolderPreviewFile,
    type FolderPreviewKind,
} from "@/lib/canvas/folder-preview-cache";
import { isModel3dFileName } from "@/lib/canvas/model-3d-preview";
import { getSmartPreviewComposerText, getSmartPreviewSelectedSheetText } from "@/lib/canvas/folder-input-resolve";
import i18n from "@/i18n";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type Position } from "@/types/canvas";
import type { CanvasNodeContext, CanvasNodeDefinition } from "@/types/canvas-plugin";

export const SMART_PREVIEW_NODE_TYPE = "smart-preview";

const NODE_WIDTH = 420;
const NODE_HEIGHT = 320;

const EXPORTABLE_TEXT_KINDS = new Set<FolderPreviewKind>(["canvasTsx", "html", "markdown", "text", "csv"]);

function smartPreviewExportFileName(path: string, kind: string) {
    const base = (path.split(/[\\/]/).pop() || "").trim() || "preview";
    if (base.includes(".")) return base;
    const ext =
        kind === "canvasTsx"
            ? "canvas.tsx"
            : kind === "html"
              ? "html"
              : kind === "markdown"
                ? "md"
                : kind === "csv"
                  ? "csv"
                  : kind === "pdf"
                    ? "pdf"
                    : kind === "image"
                      ? "png"
                      : "txt";
    return `${base}.${ext}`;
}

function canExportSmartPreviewSource(meta: { smartPreviewKind?: string; content?: string }) {
    const kind = (meta.smartPreviewKind || "") as FolderPreviewKind | "";
    const content = String(meta.content || "");
    if (!content.trim()) return false;
    if (kind === "excel" || kind === "model3d") return false;
    if (EXPORTABLE_TEXT_KINDS.has(kind as FolderPreviewKind)) return true;
    return content.startsWith("data:");
}

function canExportSmartPreviewImage(meta: { smartPreviewKind?: string; content?: string; smartPreviewPath?: string }) {
    const kind = meta.smartPreviewKind || "";
    if (kind !== "canvasTsx" && kind !== "html") return false;
    return Boolean(String(meta.content || "").trim() || String(meta.smartPreviewPath || "").trim());
}

async function exportSmartPreviewSource(ctx: CanvasNodeContext) {
    const meta = ctx.node.metadata || {};
    if (!canExportSmartPreviewSource(meta)) return;
    const kind = meta.smartPreviewKind || "";
    const content = String(meta.content || "");
    const fileName = smartPreviewExportFileName(meta.smartPreviewPath || "", kind);
    if (content.startsWith("data:")) {
        const blob = await (await fetch(content)).blob();
        saveAs(blob, fileName);
        return;
    }
    const mime =
        kind === "html"
            ? "text/html;charset=utf-8"
            : kind === "csv"
              ? "text/csv;charset=utf-8"
              : kind === "markdown"
                ? "text/markdown;charset=utf-8"
                : "text/plain;charset=utf-8";
    saveAs(new Blob([content], { type: mime }), fileName);
}

function explodeCanvasPreviewToGroup(ctx: CanvasNodeContext, notify: { success: (text: string) => void; warning: (text: string) => void }) {
    const hide = antdMessage.loading(i18n.t("canvas.smartPreview.explodeLoading"), 0);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            void (async () => {
                try {
                    const blocks = await measureCanvasBlocks(ctx.node.id, ctx.node);
                    if (!blocks?.length) {
                        notify.warning(i18n.t("canvas.smartPreview.explodeNoBlocks"));
                        return;
                    }
                    const result = buildCanvasDomExplodeOps(ctx.node, blocks);
                    ctx.applyOps(result.ops);
                    notify.success(i18n.t("canvas.smartPreview.explodeDone", { count: result.nodeCount }));
                } catch (error) {
                    console.warn("[smart-preview] explode failed", error);
                    notify.warning(i18n.t("canvas.smartPreview.explodeNoBlocks"));
                } finally {
                    hide();
                }
            })();
        });
    });
}

async function runExportSmartPreviewImage(ctx: CanvasNodeContext, notify: { loading: (text: string, duration?: number) => () => void; success: (text: string) => void; error: (text: string) => void }) {
    const hide = notify.loading(i18n.t("canvas.smartPreview.exportImageLoading"), 0);
    try {
        await exportSmartPreviewImage({
            nodeId: ctx.node.id,
            path: ctx.node.metadata?.smartPreviewPath || "",
        });
        notify.success(i18n.t("canvas.smartPreview.exportImageDone"));
    } catch (error) {
        console.warn("[smart-preview] export image failed", error);
        notify.error(i18n.t("canvas.smartPreview.exportImageFailed"));
    } finally {
        hide();
    }
}

export function buildAddSmartPreviewNodeOp(input: {
    position: Position;
    id?: string;
    title?: string;
    width?: number;
    height?: number;
    metadata?: Record<string, unknown>;
}): CanvasAgentOp {
    return {
        type: "add_node",
        id: input.id,
        nodeType: SMART_PREVIEW_NODE_TYPE,
        title: input.title,
        position: input.position,
        width: input.width,
        height: input.height,
        metadata: {
            status: "idle",
            smartPreviewPath: "",
            smartPreviewKind: "",
            smartPreviewSheetIndex: -1,
            smartPreviewSheetName: "",
            content: "",
            ...input.metadata,
        },
    };
}

function kindLabel(kind: FolderPreviewKind, t: (key: string) => string, planPreview?: boolean) {
    if (planPreview) return t("canvas.smartPreview.kindPlan");
    if (kind === "html") return t("canvas.smartPreview.kindHtml");
    if (kind === "canvasTsx") return t("canvas.smartPreview.kindCanvasTsx");
    if (kind === "excel") return t("canvas.smartPreview.kindExcel");
    if (kind === "csv") return t("canvas.smartPreview.kindCsv");
    if (kind === "text") return t("canvas.smartPreview.kindText");
    if (kind === "pdf") return t("canvas.smartPreview.kindPdf");
    if (kind === "image") return t("canvas.smartPreview.kindImage");
    if (kind === "model3d") return t("canvas.smartPreview.kindModel3d");
    return t("canvas.smartPreview.kindMarkdown");
}

function clearSelection(ctx: CanvasNodeContext) {
    ctx.updateMetadata({
        smartPreviewPath: "",
        smartPreviewKind: "",
        smartPreviewSheetIndex: -1,
        smartPreviewSheetName: "",
        smartPreviewSheetCount: 0,
        smartPreviewFullscreen: false,
        content: "",
        excelPreview: undefined,
        excelRowCount: undefined,
        excelColCount: undefined,
        excelColWidths: undefined,
        excelRowHeights: undefined,
        excelMerges: undefined,
        excelStyles: undefined,
        status: "idle",
        errorDetails: undefined,
    });
    ctx.updateNode({ title: i18n.t("canvas.smartPreview.title") });
}

/** 多工作表预览中返回选表，不退出当前 Excel 文件 */
function backToSheets(ctx: CanvasNodeContext) {
    const meta = ctx.node.metadata || {};
    const path = (meta.smartPreviewPath || "").trim();
    if (!path) {
        clearSelection(ctx);
        return;
    }
    const fileName =
        (ctx.node.title || "").split("·")[0]?.trim() ||
        path.split(/[\\/]/).pop() ||
        i18n.t("canvas.smartPreview.kindExcel");
    ctx.updateMetadata({
        smartPreviewSheetIndex: -1,
        smartPreviewSheetName: "",
        smartPreviewFullscreen: false,
        content: "",
        excelPreview: undefined,
        excelRowCount: undefined,
        excelColCount: undefined,
        excelColWidths: undefined,
        excelRowHeights: undefined,
        excelMerges: undefined,
        excelStyles: undefined,
        status: "idle",
        errorDetails: undefined,
    });
    ctx.updateNode({ title: fileName.slice(0, 48) });
}

function canBackToSheets(meta: { smartPreviewKind?: string; smartPreviewSheetIndex?: number; smartPreviewSheetCount?: number }) {
    return (
        (meta.smartPreviewKind === "excel" || meta.smartPreviewKind === "csv") &&
        typeof meta.smartPreviewSheetIndex === "number" &&
        meta.smartPreviewSheetIndex >= 0 &&
        (meta.smartPreviewSheetCount || 0) > 1
    );
}

function openFullscreen(ctx: CanvasNodeContext) {
    ctx.updateMetadata({ smartPreviewFullscreen: true });
}

function closeFullscreen(ctx: CanvasNodeContext) {
    ctx.updateMetadata({ smartPreviewFullscreen: false });
}

function closePreview(ctx: CanvasNodeContext) {
    if (ctx.node.metadata?.smartPreviewFullscreen) {
        closeFullscreen(ctx);
        return;
    }
    if (canBackToSheets(ctx.node.metadata || {})) {
        backToSheets(ctx);
        return;
    }
    clearSelection(ctx);
}

function applyTextPreview(
    ctx: CanvasNodeContext,
    input: { path: string; name: string; kind: FolderPreviewKind; content: string; truncated?: boolean },
) {
    ctx.updateMetadata({
        smartPreviewPath: input.path,
        smartPreviewKind: input.kind,
        smartPreviewSheetIndex: -1,
        smartPreviewSheetName: "",
        smartPreviewSheetCount: 0,
        content: input.content,
        excelPreview: undefined,
        excelRowCount: undefined,
        excelColCount: undefined,
        excelColWidths: undefined,
        excelRowHeights: undefined,
        excelMerges: undefined,
        excelStyles: undefined,
        status: "success",
        errorDetails: input.truncated ? "truncated" : undefined,
    });
    ctx.updateNode({
        title: input.name.slice(0, 48) || input.path,
        ...(input.kind === "html" && isHtmlDesignBoard({ content: input.content }) ? { width: 960, height: 720 } : {}),
    });
}

function applyExcelSheet(
    ctx: CanvasNodeContext,
    input: {
        path: string;
        name: string;
        sheetIndex: number;
        sheet: ExcelSheetPreview;
        sheetCount?: number;
    },
) {
    const sheetCount = input.sheetCount ?? ctx.node.metadata?.smartPreviewSheetCount ?? 1;
    ctx.updateMetadata({
        smartPreviewPath: input.path,
        smartPreviewKind: /\.csv$/i.test(input.path) ? "csv" : "excel",
        smartPreviewSheetIndex: input.sheetIndex,
        smartPreviewSheetName: input.sheet.name,
        smartPreviewSheetCount: sheetCount,
        content: excelSheetTextForAi(input.sheet),
        excelPreview: input.sheet.preview,
        excelRowCount: input.sheet.rowCount,
        excelColCount: input.sheet.colCount,
        excelColWidths: input.sheet.colWidths,
        excelRowHeights: input.sheet.rowHeights,
        excelMerges: input.sheet.merges,
        excelStyles: input.sheet.styles,
        status: "success",
        errorDetails: undefined,
    });
    ctx.updateNode({ title: `${input.name.slice(0, 32)} · ${input.sheet.name}`.slice(0, 48) });
}

// 运行时已固定 React 19.2，当前 @types/react 19.1 尚未声明这个正式 API。
const Activity = (React as typeof React & { Activity: React.ExoticComponent<{ mode: "visible" | "hidden"; children: ReactNode }> }).Activity;
// 快照缺失或主题/状态变化时逐个刷新，避免所有片段同时唤醒整份报告。
let fragmentPreviewQueue = Promise.resolve();

/** 闲置显示局部快照；交互时唤醒 React 树，休眠时保留组件和表单状态。 */
function LiveCanvasFragmentBody({ ctx }: { ctx: CanvasNodeContext }) {
    const meta = ctx.node.metadata || {};
    const source = String(meta.content || "");
    const clip = meta.canvasFragmentClip;
    const sourceSize = meta.canvasFragmentSourceSize;
    const interactive = Boolean(meta.interactive);
    const theme = useThemeStore((state) => state.theme);
    const liveRef = useRef<HTMLDivElement>(null);
    const fragmentRef = useRef<HTMLElement | undefined>(undefined);
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const [started, setStarted] = useState(false);
    const [live, setLive] = useState(false);
    const [html, setHtml] = useState(meta.canvasFragmentPreview?.html || "");
    const [previewFailed, setPreviewFailed] = useState(false);
    const active = interactive && (hovered || focused);
    const revision = useMemo(() => ({ source, theme, state: meta.canvasTsxState }), [source, theme, meta.canvasTsxState, clip?.x, clip?.y, clip?.width, clip?.height, sourceSize?.width, sourceSize?.height]);
    const captured = useRef(meta.canvasFragmentPreview?.html && meta.canvasFragmentPreview.theme === theme ? revision : null);
    const finishPreview = useRef<(() => void) | null>(null);

    useLayoutEffect(() => {
        if (!live || !clip) return;
        const root = liveRef.current?.querySelector<HTMLElement>("[data-smart-preview-capture]");
        if (root && (!fragmentRef.current || !root.contains(fragmentRef.current))) {
            // 在点击折叠/切换内容之前定位，避免尺寸变化后命中邻近的另一块。
            fragmentRef.current = findLiveCanvasFragment(root, clip);
        }
    }, [live, source, clip?.x, clip?.y]);

    useEffect(() => {
        const wake = () => { setStarted(true); setLive(true); };
        if (active) { wake(); return; }
        if (captured.current === revision || live || !source || !clip || !sourceSize) return;
        let cancelled = false;
        let done: (() => void) | undefined;
        const prepare = () => new Promise<void>((resolve) => {
            done = resolve;
            if (cancelled) { resolve(); return; }
            window.requestIdleCallback(() => {
                if (cancelled) { resolve(); return; }
                finishPreview.current = resolve;
                wake();
            }, { timeout: 500 });
        });
        fragmentPreviewQueue = fragmentPreviewQueue.then(prepare, prepare);
        return () => { cancelled = true; done?.(); };
    }, [active, revision]);

    useEffect(() => {
        if (!live || active || !clip) return;
        let cancelled = false;
        let frame = 0;
        const capture = async () => {
            try {
                const root = liveRef.current?.querySelector<HTMLElement>("[data-smart-preview-capture]");
                const next = root ? await captureLiveCanvasFragment(root, clip, fragmentRef.current) : "";
                if (cancelled) return;
                setPreviewFailed(!next);
                if (next) {
                    setHtml(next);
                }
            } catch (error) {
                if (!cancelled) setPreviewFailed(true);
                console.warn("[canvas-fragment-preview]", error);
            } finally {
                if (!cancelled) {
                    captured.current = revision;
                    setLive(false);
                    finishPreview.current?.();
                    finishPreview.current = null;
                }
            }
        };
        // 等 React 提交交互结果和图表布局，再冻结局部画面。
        frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => { void capture(); }); });
        return () => { cancelled = true; cancelAnimationFrame(frame); };
    }, [live, active, revision]);

    if (!source || !clip || !sourceSize?.width || !sourceSize?.height) {
        return (
            <div className="flex h-full items-center justify-center px-3 text-center text-xs opacity-60">
                图表预览不可用
            </div>
        );
    }

    return (
        <div
            className="relative h-full w-full min-h-0 overflow-hidden"
            data-canvas-fragment={ctx.node.id}
            data-canvas-fragment-live
            tabIndex={interactive ? 0 : undefined}
            // 交互模式下接住指针以悬停图表；移动模式穿透给外壳拖拽
            style={{ pointerEvents: interactive ? "auto" : "none", contain: "layout paint" }}
            onPointerEnter={(event) => { if (!event.buttons) setHovered(true); }}
            onPointerMove={(event) => { if (!event.buttons) setHovered(true); }}
            onPointerLeave={() => setHovered(false)}
            onFocusCapture={() => setFocused(true)}
            onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
            onMouseDown={interactive ? (event) => event.stopPropagation() : undefined}
            onPointerDown={interactive ? (event) => { event.stopPropagation(); setHovered(true); } : undefined}
            onWheel={interactive ? (event) => {
                handleNodeContentWheel(event);
                if (!event.shiftKey) setHovered(false);
            } : undefined}
        >
            {!live && (html ? <div inert className="h-full w-full" dangerouslySetInnerHTML={{ __html: html }} /> : (
                <div className="flex h-full items-center justify-center text-xs opacity-60">{previewFailed ? "图表预览不可用，悬停查看详情" : "正在准备图表预览…"}</div>
            ))}
            {started && (
                <Activity mode={live ? "visible" : "hidden"}>
                    <div
                        ref={liveRef}
                        className="absolute left-0 top-0 [&_[data-smart-preview-capture]]:!mx-0 [&>div]:!h-auto [&>div]:!overflow-hidden"
                        style={{
                            width: sourceSize.width,
                            height: sourceSize.height,
                            transform: `translate(${-clip.x}px, ${-clip.y}px)`,
                        }}
                    >
                        <div style={{ width: sourceSize.width, minHeight: sourceSize.height }}>
                            <CursorCanvasPreview source={source} contentWidth={sourceSize.width} ctx={ctx} />
                        </div>
                    </div>
                </Activity>
            )}
        </div>
    );
}

/** canvas.tsx 拆分出的矢量片段：同文档直渲（CSS 缩放不糊），双击 contentEditable 编辑文字 */
function CanvasFragmentBody({ ctx }: { ctx: CanvasNodeContext }) {
    const [editing, setEditing] = useState(false);
    const hostRef = useRef<HTMLDivElement | null>(null);
    const html = String(ctx.node.metadata?.content || "");
    const focusEdit = ctx.node.metadata?.fragmentFocusEdit;

    useEffect(() => {
        if (!focusEdit || editing) return;
        setEditing(true);
        requestAnimationFrame(() => hostRef.current?.focus());
        ctx.updateMetadata({ fragmentFocusEdit: undefined });
    }, [focusEdit, editing, ctx]);

    const commit = () => {
        const host = hostRef.current;
        setEditing(false);
        if (!host) return;
        const next = host.innerHTML;
        if (next !== html) ctx.updateMetadata({ content: next });
    };

    // 宽度按拆分时测量值锁定，不再 auto-fit，避免换上下文后重排改布局
    return (
        <div
            className="h-full w-full min-h-0 overflow-hidden"
            data-canvas-fragment={ctx.node.id}
            style={{ pointerEvents: editing ? "auto" : "none" }}
        >
            <div
                ref={hostRef}
                className={
                    editing
                        ? "h-full w-full cursor-text select-text outline-none"
                        : "pointer-events-none h-full w-full select-none"
                }
                contentEditable={editing}
                suppressContentEditableWarning
                spellCheck={false}
                onMouseDown={editing ? (event) => event.stopPropagation() : undefined}
                onPointerDown={editing ? (event) => event.stopPropagation() : undefined}
                onKeyDown={
                    editing
                        ? (event) => {
                              event.stopPropagation();
                              if (event.key === "Escape") event.currentTarget.blur();
                          }
                        : undefined
                }
                onWheel={editing ? handleNodeContentWheel : undefined}
                onBlur={editing ? commit : undefined}
                dangerouslySetInnerHTML={{ __html: html }}
            />
        </div>
    );
}

function SmartPreviewContent({ ctx }: { ctx: CanvasNodeContext }) {
    if (ctx.node.metadata?.canvasFragmentLive) return <LiveCanvasFragmentBody ctx={ctx} />;
    if (ctx.node.metadata?.canvasFragment && ctx.node.metadata.smartPreviewKind === "html") return <CanvasFragmentBody ctx={ctx} />;
    return <SmartPreviewDocumentContent ctx={ctx} />;
}

function SmartPreviewDocumentContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const theme = ctx.theme;
    const upstream = ctx.getUpstream()[0];
    const upstreamId = upstream?.id || "";
    const upstreamType = upstream?.type || "";
    const upstreamTitle = upstream?.title || "";
    const upstreamDocumentKind = upstream?.metadata?.documentKind;
    const meta = ctx.node.metadata || {};
    const selectedPath = (meta.smartPreviewPath || "").trim();
    const selectedKind = (meta.smartPreviewKind || "") as FolderPreviewKind | "";
    const previewContent = String(meta.content || "");
    // #region agent log
    useEffect(() => {
        fetch('http://127.0.0.1:7475/ingest/5542b978-a3f6-40e8-8231-ec6ddb075fc3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'deafa8'},body:JSON.stringify({sessionId:'deafa8',runId:'pre-fix-2',hypothesisId:'E',location:'smart-preview-node.tsx:doc',message:'smart preview state',data:{nodeId:ctx.node.id,selectedKind,selectedPath,upstreamId,upstreamType,showTextures:meta.modelShowTextures,previewBg:meta.modelPreviewBg},timestamp:Date.now()})}).catch(()=>{});
    }, [ctx.node.id, selectedKind, selectedPath, upstreamId, upstreamType, meta.modelShowTextures, meta.modelPreviewBg]);
    // #endregion
    // 尺寸和视口变化时复用正文，屏幕外的块由浏览器跳过排版与绘制。
    const markdownPreview = useMemo(() => (
        <Streamdown
            mode="static"
            className="agent-streamdown canvas-text-md select-text [&>*]:[content-visibility:auto] [&>*]:[contain-intrinsic-size:auto_80px]"
            controls={false}
            linkSafety={{ enabled: false }}
            lineNumbers={false}
        >
            {previewContent}
        </Streamdown>
    ), [previewContent]);
    const sheetIndex = typeof meta.smartPreviewSheetIndex === "number" ? meta.smartPreviewSheetIndex : -1;
    const [folderFiles, setFolderFiles] = useState<FolderPreviewFile[]>([]);
    const [loadingFile, setLoadingFile] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [pendingPick, setPendingPick] = useState<{ path: string; name: string } | null>(null);
    /** 多工作表选表时用，避免 folderFiles 尚未刷新导致空白 */
    const [pendingExcelSheets, setPendingExcelSheets] = useState<ExcelSheetPreview[]>([]);
    const [exportingImage, setExportingImage] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const isFolder = upstreamType === FOLDER_NODE_TYPE;
    const folderEntries = upstream?.metadata?.folderEntries || [];
    const entryCandidates = useMemo(
        () => folderEntries.filter((entry) => entry.kind === "file" && isPreviewableFileName(entry.name)),
        [folderEntries],
    );

    const autoPickedUpstreamRef = useRef("");
    const autoPickingRef = useRef(false);

    useEffect(() => {
        autoPickedUpstreamRef.current = "";
        autoPickingRef.current = false;
        setPendingExcelSheets([]);
    }, [upstreamId]);

    useEffect(() => {
        if (!isFolder || !upstreamId) {
            setFolderFiles([]);
            return;
        }
        let cancelled = false;
        void loadFolderPreviewFiles(upstreamId).then((files) => {
            if (!cancelled) setFolderFiles(files);
        });
        return () => {
            cancelled = true;
        };
    }, [isFolder, upstreamId]);

    // 作为下游输入时透传上游项目文件夹（不是预览文件正文）
    useEffect(() => {
        if (!isFolder || !upstream) {
            if (meta.proxyFolderNodeId || meta.proxyFolderName) {
                ctx.updateMetadata({
                    proxyFolderNodeId: "",
                    proxyFolderName: "",
                    proxyFolderEntryCount: 0,
                });
            }
            return;
        }
        const folderName = String(upstream.metadata?.folderName || upstream.title || "").trim();
        const entryCount = upstream.metadata?.folderEntryCount ?? upstream.metadata?.folderEntries?.length ?? 0;
        if (
            meta.proxyFolderNodeId === upstreamId &&
            meta.proxyFolderName === folderName &&
            meta.proxyFolderEntryCount === entryCount
        ) {
            return;
        }
        ctx.updateMetadata({
            proxyFolderNodeId: upstreamId,
            proxyFolderName: folderName,
            proxyFolderEntryCount: entryCount,
        });
    }, [
        isFolder,
        upstream,
        upstreamId,
        ctx,
        meta.proxyFolderNodeId,
        meta.proxyFolderName,
        meta.proxyFolderEntryCount,
    ]);

    const excelUpstreamSheets = upstreamType === CanvasNodeType.Text ? upstream?.metadata?.excelSheets || [] : [];
    const isExcelUpstream = Boolean(upstreamDocumentKind === "excel" && excelUpstreamSheets.length);
    const textUpstreamContent = upstreamType === CanvasNodeType.Text ? String(upstream?.metadata?.content || "") : "";

    useEffect(() => {
        if (!upstreamId || isFolder || selectedPath || isExcelUpstream) return;
        if (!textUpstreamContent.trim()) return;
        const name = upstreamTitle || t("canvas.smartPreview.upstreamText");
        const kind: FolderPreviewKind =
            upstreamDocumentKind === "csv" ? "csv" : upstreamDocumentKind === "markdown" ? "markdown" : "text";
        applyTextPreview(ctx, { path: `__upstream__/${upstreamId}`, name, kind, content: textUpstreamContent });
    }, [ctx, upstreamId, upstreamTitle, upstreamDocumentKind, isFolder, selectedPath, isExcelUpstream, textUpstreamContent, t]);

    const pendingExcelFile = useMemo(() => {
        if (!selectedPath || (selectedKind !== "excel" && selectedKind !== "csv") || sheetIndex >= 0) return null;
        return folderFiles.find((file) => file.path === selectedPath) || null;
    }, [folderFiles, selectedPath, selectedKind, sheetIndex]);

    const applyResolvedFile = (file: FolderPreviewFile, fallbackName: string): boolean => {
        // CSV 与 Excel 一样走表格网格；旧缓存无 sheets 时仍会落到下方纯文本分支
        if (file.kind === "excel" || (file.kind === "csv" && (file.sheets || []).length)) {
            const sheets = file.sheets || [];
            if (!sheets.length) {
                setPendingExcelSheets([]);
                setLoadError(t("canvas.smartPreview.emptyExcel"));
                return false;
            }
            if (sheets.length === 1) {
                setPendingExcelSheets(sheets);
                applyExcelSheet(ctx, {
                    path: file.path,
                    name: file.name,
                    sheetIndex: 0,
                    sheet: sheets[0],
                    sheetCount: 1,
                });
                return true;
            }
            setPendingExcelSheets(sheets);
            ctx.updateMetadata({
                smartPreviewPath: file.path,
                smartPreviewKind: file.kind === "csv" ? "csv" : "excel",
                smartPreviewSheetIndex: -1,
                smartPreviewSheetName: "",
                smartPreviewSheetCount: sheets.length,
                content: "",
                excelPreview: undefined,
                excelColWidths: undefined,
                excelRowHeights: undefined,
                excelMerges: undefined,
                excelStyles: undefined,
                status: "idle",
            });
            ctx.updateNode({ title: file.name.slice(0, 48) });
            return true;
        }
        setPendingExcelSheets([]);
        applyTextPreview(ctx, {
            path: file.path,
            name: file.name || fallbackName,
            kind: file.kind,
            content:
                file.kind === "model3d"
                    ? t("canvas.smartPreview.model3dLabel", { name: file.name || fallbackName })
                    : file.content || "",
            truncated: file.truncated,
        });
        return true;
    };

    const selectFolderFile = async (path: string, name: string): Promise<"ok" | "retry" | "fail"> => {
        if (!upstream) return "fail";
        setLoadingFile(true);
        setLoadError("");
        setPendingPick(null);
        try {
            const file = await resolveFolderPreviewFile(upstream.id, path);
            if (!file) {
                setPendingPick({ path, name });
                setLoadError(/\.(pdf|ai|eps)$/i.test(name) ? t("canvas.smartPreview.vectorUnsupported") : t("canvas.smartPreview.missingCache"));
                return "retry";
            }
            setFolderFiles((prev) => [...prev.filter((item) => item.path !== file.path), file]);
            return applyResolvedFile(file, name) ? "ok" : "fail";
        } catch {
            setPendingPick({ path, name });
            setLoadError(t("canvas.smartPreview.pickFailed"));
            return "fail";
        } finally {
            setLoadingFile(false);
        }
    };

    // 上游只有一个可预览文件时自动打开；源缓存未写入时短暂重试（勿依赖 loadingFile，否则会被自身取消）
    useEffect(() => {
        if (!isFolder || !upstreamId || selectedPath) return;
        if (entryCandidates.length !== 1) return;
        if (autoPickedUpstreamRef.current === upstreamId || autoPickingRef.current) return;
        const only = entryCandidates[0];
        if (!only) return;
        let cancelled = false;
        autoPickingRef.current = true;
        void (async () => {
            try {
                for (let attempt = 0; attempt < 6 && !cancelled; attempt += 1) {
                    const result = await selectFolderFile(only.path, only.name);
                    if (cancelled) return;
                    if (result === "ok" || result === "fail") {
                        autoPickedUpstreamRef.current = upstreamId;
                        return;
                    }
                    await new Promise((resolve) => window.setTimeout(resolve, 280));
                }
                if (!cancelled) autoPickedUpstreamRef.current = upstreamId;
            } finally {
                autoPickingRef.current = false;
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isFolder, upstreamId, selectedPath, entryCandidates]);

    const pickLocalFile = async (event: ChangeEvent<HTMLInputElement>) => {
        const local = event.target.files?.[0];
        event.target.value = "";
        if (!local || !upstream || !pendingPick) return;
        setLoadingFile(true);
        setLoadError("");
        try {
            const parsed = await parseFolderPreviewFile(local, pendingPick.path);
            if (!parsed) {
                setLoadError(/\.(pdf|ai|eps)$/i.test(local.name) ? t("canvas.smartPreview.vectorUnsupported") : t("canvas.smartPreview.pickFailed"));
                return;
            }
            await upsertFolderPreviewFile(upstream.id, parsed);
            if (parsed.kind === "model3d") {
                await upsertFolderPreviewSource(upstream.id, {
                    path: parsed.path,
                    name: local.name,
                    data: await local.arrayBuffer(),
                });
            }
            setFolderFiles((prev) => [...prev.filter((item) => item.path !== parsed.path), parsed]);
            setPendingPick(null);
            applyResolvedFile(parsed, pendingPick.name);
        } finally {
            setLoadingFile(false);
        }
    };

    const selectSheet = (index: number, sheets: ExcelSheetPreview[], path: string, name: string) => {
        const sheet = sheets[index];
        if (!sheet) return;
        setPendingExcelSheets(sheets);
        applyExcelSheet(ctx, { path, name, sheetIndex: index, sheet, sheetCount: sheets.length });
    };

    const hasStandalonePreview = Boolean(
        selectedKind && (String(meta.content || "").trim() || selectedPath),
    );
    const standaloneExcelSheets = Array.isArray(meta.excelSheets) ? meta.excelSheets : [];
    const excelSheetCount = excelUpstreamSheets.length;
    useEffect(() => {
        if (!isExcelUpstream || selectedPath || !upstreamId) return;
        const path = `__upstream__/${upstreamId}`;
        const name = upstreamTitle || t("canvas.smartPreview.kindExcel");
        if (excelSheetCount === 1 && excelUpstreamSheets[0]) {
            selectSheet(0, excelUpstreamSheets, path, name);
            return;
        }
        setPendingExcelSheets(excelUpstreamSheets);
        ctx.updateMetadata({
            smartPreviewPath: path,
            smartPreviewKind: "excel",
            smartPreviewSheetIndex: -1,
            smartPreviewSheetName: "",
            smartPreviewSheetCount: excelSheetCount,
            content: "",
            status: "idle",
        });
    }, [isExcelUpstream, selectedPath, upstreamId, upstreamTitle, excelSheetCount, ctx, t]);

    if (!upstream && !hasStandalonePreview) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: theme.node.placeholder }}>
                <Eye className="size-7 opacity-70" />
                <div className="text-sm">{t("canvas.smartPreview.connectHint")}</div>
            </div>
        );
    }

    if ((selectedKind === "excel" || selectedKind === "csv") && sheetIndex < 0) {
        const sheets = pendingExcelSheets.length
            ? pendingExcelSheets
            : pendingExcelFile?.sheets?.length
              ? pendingExcelFile.sheets
              : excelUpstreamSheets.length
                ? excelUpstreamSheets
                : standaloneExcelSheets;
        const path = pendingExcelFile?.path || selectedPath;
        const name = pendingExcelFile?.name || upstream?.title || meta.smartPreviewPath?.split(/[\\/]/).pop() || t("canvas.smartPreview.kindExcel");
        return (
            <div className="flex h-full w-full flex-col gap-2 self-stretch overflow-hidden px-3 pb-3 pt-1" style={{ color: theme.node.text }}>
                <div className="flex items-center justify-between gap-2 text-xs" style={{ color: theme.node.muted }}>
                    <span className="truncate">{t("canvas.smartPreview.pickSheet")}</span>
                    <button
                        type="button"
                        className="shrink-0 rounded px-1.5 py-0.5 hover:bg-black/5 dark:hover:bg-white/10"
                        onClick={(event) => {
                            event.stopPropagation();
                            autoPickedUpstreamRef.current = "";
                            setPendingExcelSheets([]);
                            clearSelection(ctx);
                        }}
                    >
                        {t("canvas.smartPreview.reselect")}
                    </button>
                </div>
                <div className="thin-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto" onWheel={handleNodeContentWheel}>
                    {sheets.map((sheet, index) => (
                        <button
                            key={`${sheet.name}-${index}`}
                            type="button"
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
                            onClick={(event) => {
                                event.stopPropagation();
                                selectSheet(index, sheets, path, name);
                            }}
                        >
                            <Sheet className="size-4 shrink-0 opacity-70" />
                            <span className="min-w-0 flex-1 truncate">{sheet.name}</span>
                            <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>
                                {t("canvas.node.excelSheetSize", { rows: sheet.rowCount, cols: sheet.colCount })}
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    if (isFolder && !selectedPath) {
        const list = entryCandidates.length
            ? entryCandidates
            : folderFiles.map((file) => ({ path: file.path, name: file.name, kind: "file" as const }));
        const accept = pendingPick?.name
            ? `.${pendingPick.name.split(".").pop()?.toLowerCase() || "*"}`
            : ".md,.markdown,.html,.htm,.txt,.csv,.xlsx,.xls,.pdf,.ai,.eps,.glb,.gltf,.obj,.stl,.ply,.fbx,.dae,.3mf,.pcd";
        return (
            <div className="flex h-full w-full flex-col gap-2 self-stretch overflow-hidden px-3 pb-3 pt-1" style={{ color: theme.node.text }}>
                <div className="text-xs" style={{ color: theme.node.muted }}>
                    {t("canvas.smartPreview.pickFile")}
                </div>
                {loadError ? (
                    <div className="space-y-1.5">
                        <div className="text-xs text-amber-500">{loadError}</div>
                        {pendingPick ? (
                            <button
                                type="button"
                                className="rounded px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/10"
                                style={{ color: theme.node.text }}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    fileInputRef.current?.click();
                                }}
                            >
                                {t("canvas.smartPreview.pickLocal", { name: pendingPick.name })}
                            </button>
                        ) : null}
                    </div>
                ) : null}
                <input ref={fileInputRef} type="file" accept={accept} className="hidden" onChange={(event) => void pickLocalFile(event)} />
                <div className="thin-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto" onWheel={handleNodeContentWheel}>
                    {list.length ? (
                        list.map((entry) => (
                            <button
                                key={entry.path}
                                type="button"
                                disabled={loadingFile}
                                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    void selectFolderFile(entry.path, entry.name);
                                }}
                            >
                                {isModel3dFileName(entry.name) ? (
                                    <Box className="size-4 shrink-0 opacity-70" />
                                ) : /\.html?$/i.test(entry.name) || /\.canvas\.tsx$/i.test(entry.name) ? (
                                    <Globe className="size-4 shrink-0 opacity-70" />
                                ) : /\.(xlsx|xls|csv)$/i.test(entry.name) ? (
                                    <FileSpreadsheet className="size-4 shrink-0 opacity-70" />
                                ) : /\.(ai|eps)$/i.test(entry.name) ? (
                                    <FileImage className="size-4 shrink-0 opacity-70" />
                                ) : (
                                    <FileText className="size-4 shrink-0 opacity-70" />
                                )}
                                <span className="min-w-0 flex-1 truncate">{entry.path}</span>
                            </button>
                        ))
                    ) : (
                        <div className="py-6 text-center text-xs" style={{ color: theme.node.placeholder }}>
                            {t("canvas.smartPreview.noPreviewable")}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    const content = String(meta.content || "");
    const excelPreview = meta.excelPreview || [];
    const rowCount = meta.excelRowCount || 0;
    const colCount = meta.excelColCount || 0;
    const fullscreen = Boolean(meta.smartPreviewFullscreen);

    const previewBody: ReactNode =
        selectedKind === "canvasTsx" ? (
            content ? (
                <CursorCanvasPreview key={`${fullscreen ? "fs" : "node"}-${selectedPath || "canvas"}`} source={content} ctx={ctx} />
            ) : (
                <div className="flex h-full items-center justify-center text-xs" style={{ color: theme.node.placeholder }}>
                    {t("canvas.smartPreview.emptyContent")}
                </div>
            )
        ) : selectedKind === "html" ? (
            <HtmlDesignBoard key={`${ctx.node.id}-${selectedPath}`} ctx={ctx} folderNodeId={isFolder ? upstreamId : ""} />
        ) : selectedKind === "pdf" ? (
            content ? (
                <div className="h-full min-h-0 w-full" data-canvas-no-zoom>
                    <BrowserPdfPreview
                        key={`${fullscreen ? "fs" : "node"}-${selectedPath || "pdf"}`}
                        src={content}
                        className="h-full w-full border-0 bg-white"
                        style={{
                            display: "block",
                            borderRadius: fullscreen ? 0 : 12,
                            pointerEvents: fullscreen || Boolean(meta.interactive) ? "auto" : "none",
                        }}
                        empty={
                            <div className="flex h-full items-center justify-center px-4 text-center text-xs" style={{ color: theme.node.placeholder }}>
                                {t("canvas.smartPreview.vectorUnsupported")}
                            </div>
                        }
                    />
                </div>
            ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-xs" style={{ color: theme.node.placeholder }}>
                    {t("canvas.smartPreview.vectorUnsupported")}
                </div>
            )
        ) : selectedKind === "image" ? (
            content ? (
                <div className="flex h-full min-h-0 items-center justify-center p-2" data-canvas-no-zoom>
                    <img src={content} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
                </div>
            ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-xs" style={{ color: theme.node.placeholder }}>
                    {t("canvas.smartPreview.vectorUnsupported")}
                </div>
            )
        ) : selectedKind === "model3d" ? (
            upstreamId && selectedPath ? (
                <Model3dPreview
                    folderNodeId={upstreamId}
                    path={selectedPath}
                    fileName={(selectedPath.split(/[\\/]/).pop() || ctx.node.title || "model").trim()}
                    interactive={fullscreen || Boolean(meta.interactive)}
                    theme={theme}
                    showTextures={Boolean(meta.modelShowTextures)}
                    previewBg={meta.modelPreviewBg === "light" ? "light" : "dark"}
                />
            ) : (
                <div className="flex h-full items-center justify-center px-4 text-center text-xs" style={{ color: theme.node.placeholder }}>
                    {t("canvas.smartPreview.model3dMissing")}
                </div>
            )
        ) : selectedKind === "excel" || selectedKind === "csv" ? (
            <div className="flex h-full min-h-0 flex-col" onWheel={handleNodeContentWheel}>
                <div className="min-h-0 flex-1">
                    {excelPreview.length ? (
                        <ExcelVirtualSheet
                            rows={excelPreview.map((row) => row.map((cell) => ({ text: cell?.text || "", imageUrl: cell?.imageUrl, s: cell?.s })))}
                            detailOpen
                            colWidths={meta.excelColWidths}
                            rowHeights={meta.excelRowHeights}
                            merges={meta.excelMerges}
                            styles={meta.excelStyles}
                        />
                    ) : content ? (
                        <pre
                            className="thin-scrollbar m-0 h-full cursor-text select-text overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[11px] leading-4"
                            onMouseDown={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                            onDoubleClick={(event) => event.stopPropagation()}
                        >
                            {content}
                        </pre>
                    ) : (
                        <div className="flex h-full items-center justify-center text-xs" style={{ color: theme.node.placeholder }}>
                            {t("canvas.node.excelEmptySheet")}
                        </div>
                    )}
                </div>
                {rowCount || colCount ? (
                    <div className="shrink-0 truncate px-1 pt-1 text-[10px]" style={{ color: theme.node.muted }}>
                        {t("canvas.node.excelSheetSize", { rows: rowCount, cols: colCount })}
                    </div>
                ) : null}
            </div>
        ) : content ? (
            <div
                className="thin-scrollbar h-full min-h-0 cursor-text select-text overflow-y-auto break-words px-3 pb-3"
                onWheel={handleNodeContentWheel}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
            >
                {selectedKind === "text" && !meta.planPreview ? (
                    <pre className="m-0 select-text whitespace-pre-wrap break-words font-mono text-[12px] leading-5">
                        {content}
                    </pre>
                ) : (
                    markdownPreview
                )}
            </div>
        ) : (
            <div className="flex h-full items-center justify-center text-xs" style={{ color: theme.node.placeholder }}>
                {t("canvas.smartPreview.emptyContent")}
            </div>
        );
    const headerTitle = meta.planPreview
        ? (ctx.node.title || t("canvas.smartPreview.kindPlan"))
        : `${selectedKind ? kindLabel(selectedKind as FolderPreviewKind, t, Boolean(meta.planPreview)) : t("canvas.smartPreview.title")}${
            meta.smartPreviewSheetName ? ` · ${meta.smartPreviewSheetName}` : ""
        }`;
    const showBackToSheets = canBackToSheets(meta);
    const showExportImage = canExportSmartPreviewImage(meta);
    const showExportSource = canExportSmartPreviewSource(meta);

    const onExportImage = async () => {
        if (exportingImage) return;
        setExportingImage(true);
        try {
            await runExportSmartPreviewImage(ctx, message);
        } finally {
            setExportingImage(false);
        }
    };

    return (
        <div
            className="flex h-full w-full min-h-0 flex-col self-stretch overflow-hidden"
            style={{ color: theme.node.text }}
            data-smart-preview-node={ctx.node.id}
        >
            <div
                className="flex shrink-0 cursor-grab items-center justify-between gap-2 px-3 pb-1 pt-0 text-[11px] active:cursor-grabbing"
                style={{ color: theme.node.muted }}
                data-smart-preview-drag-handle
                title={t("canvas.smartPreview.dragHandleHint")}
            >
                <span className="block min-w-0 truncate">{headerTitle}</span>
                {showBackToSheets ? (
                    <button
                        type="button"
                        className="shrink-0 rounded px-1.5 py-0.5 hover:bg-black/5 dark:hover:bg-white/10"
                        style={{ color: theme.node.text }}
                        onClick={(event) => {
                            event.stopPropagation();
                            backToSheets(ctx);
                        }}
                    >
                        {t("canvas.smartPreview.switchSheet")}
                    </button>
                ) : null}
            </div>
            <div className="min-h-0 flex-1">{fullscreen ? null : previewBody}</div>
            {fullscreen && typeof document !== "undefined"
                ? createPortal(
                      <div
                          className="fixed inset-0 z-[2000] flex flex-col"
                          style={{ background: theme.canvas.background, color: theme.node.text }}
                          data-canvas-no-zoom
                          data-smart-preview-fullscreen={ctx.node.id}
                          onMouseDown={(event) => event.stopPropagation()}
                          onPointerDown={(event) => event.stopPropagation()}
                      >
                          <div
                              className="flex h-12 shrink-0 items-center justify-between gap-3 px-4"
                              style={{ background: theme.node.panel, borderBottom: `1px solid ${theme.node.stroke}` }}
                          >
                              <span className="min-w-0 truncate text-sm font-medium">{headerTitle}</span>
                              <div className="flex items-center gap-1">
                                  {showExportImage ? (
                                      <button
                                          type="button"
                                          disabled={exportingImage}
                                          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
                                          onClick={() => void onExportImage()}
                                      >
                                          <ImageDown className="size-4" />
                                          {t("canvas.smartPreview.exportImage")}
                                      </button>
                                  ) : null}
                                  {showExportSource ? (
                                      <button
                                          type="button"
                                          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10"
                                          onClick={() => void exportSmartPreviewSource(ctx)}
                                      >
                                          <Download className="size-4" />
                                          {t("canvas.smartPreview.exportSource")}
                                      </button>
                                  ) : null}
                                  <button
                                      type="button"
                                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10"
                                      onClick={() => closeFullscreen(ctx)}
                                  >
                                      <X className="size-4" />
                                      {t("canvas.smartPreview.closePreview")}
                                  </button>
                              </div>
                          </div>
                          <div className="min-h-0 flex-1">{previewBody}</div>
                      </div>,
                      document.body,
                  )
                : null}
        </div>
    );
}

export function getSmartPreviewNodeDefinition(): CanvasNodeDefinition {
    return {
        type: SMART_PREVIEW_NODE_TYPE,
        title: "Smart Preview",
        description: "Preview Markdown / Excel / HTML / 3D from an upstream folder or document",
        icon: <Eye className="size-5" />,
        defaultSize: { width: NODE_WIDTH, height: NODE_HEIGHT },
        defaultMetadata: {
            status: "idle",
            smartPreviewPath: "",
            smartPreviewKind: "",
            smartPreviewSheetIndex: -1,
            smartPreviewSheetName: "",
            smartPreviewSheetCount: 0,
            content: "",
            proxyFolderNodeId: "",
            proxyFolderName: "",
            proxyFolderEntryCount: 0,
        },
        minimapColor: "#22d3ee",
        hidePanel: true,
        // .canvas.tsx / 规划书 / 拆分片段透出画布底，其它预览类型仍用节点填充底
        transparentBackground: (node) => {
            const kind = node.metadata?.smartPreviewKind || "";
            return kind === "canvasTsx" || Boolean(node.metadata?.planPreview) || Boolean(node.metadata?.canvasFragment);
        },
        // HTML / PDF / 3D 才需要「交互/移动」切换；选文件与 Markdown/Excel 预览始终可操作
        interactionToggle: true,
        forceInteractive: (node) => {
            // 静态片段：穿透拖拽；活图表片段：允许工具栏切换「交互/移动」（默认交互以悬停图表）
            if (node.metadata?.canvasFragment) return false;
            const kind = node.metadata?.smartPreviewKind || "";
            if (kind === "html" && isHtmlDesignBoard(node.metadata || {})) return true;
            return kind !== "html" && kind !== "pdf" && kind !== "model3d";
        },
        onDoubleClick: (ctx) => {
            if (!ctx.node.metadata?.canvasFragment || ctx.node.metadata?.canvasFragmentLive) return false;
            ctx.updateMetadata({ fragmentFocusEdit: Date.now() });
            return true;
        },
        // 已选预览（尤其 HTML 工程）重载很慢，缩小或移出视口时只隐藏不卸载
        keepContentMounted: (node) => Boolean((node.metadata?.smartPreviewPath || "").trim() || (node.metadata?.content || "").trim()),
        // 已选 Excel 工作表时只输出该表；已打开文本预览时输出正文；否则透传上游文件夹摘要
        resource: (node) => {
            const sheetText = getSmartPreviewSelectedSheetText(node);
            if (sheetText) return { kind: "text", text: sheetText };
            const previewText = getSmartPreviewComposerText(node);
            if (previewText) return { kind: "text", text: previewText };
            const folderName = (node.metadata?.proxyFolderName || "").trim();
            if (folderName) {
                const count = node.metadata?.proxyFolderEntryCount || 0;
                return { kind: "text", text: `文件夹：${folderName}${count ? `（${count} 项）` : ""}` };
            }
            return null;
        },
        Content: SmartPreviewContent,
        toolbar: (ctx) => {
            if (!(ctx.node.metadata?.smartPreviewPath || "").trim() && !String(ctx.node.metadata?.content || "").trim()) return [];
            const fullscreen = Boolean(ctx.node.metadata?.smartPreviewFullscreen);
            const multiSheet = canBackToSheets(ctx.node.metadata || {});
            const meta = ctx.node.metadata || {};
            const exportImage = canExportSmartPreviewImage(meta);
            const exportSource = canExportSmartPreviewSource(meta);
            const explodeCanvas = meta.smartPreviewKind === "canvasTsx" && !meta.canvasExploded && !meta.canvasFragment;
            const isFragment = Boolean(meta.canvasFragment);
            const isModel3d = meta.smartPreviewKind === "model3d";
            const showTextures = Boolean(meta.modelShowTextures);
            const bg = meta.modelPreviewBg === "light" ? "light" : "dark";
            // 拆分片段：保留导出；去掉全屏/关闭/重选（会清掉片段）
            if (isFragment) {
                return [
                    ...(exportImage
                        ? [
                              {
                                  id: "smart-preview-export-image",
                                  title: i18n.t("canvas.smartPreview.exportImage"),
                                  label: i18n.t("canvas.smartPreview.exportImage"),
                                  icon: <ImageDown className="size-3.5" />,
                                  onClick: () => void runExportSmartPreviewImage(ctx, antdMessage),
                              },
                          ]
                        : []),
                    ...(exportSource
                        ? [
                              {
                                  id: "smart-preview-export-source",
                                  title: i18n.t("canvas.smartPreview.exportSource"),
                                  label: i18n.t("canvas.smartPreview.exportSource"),
                                  icon: <Download className="size-3.5" />,
                                  onClick: () => void exportSmartPreviewSource(ctx),
                              },
                          ]
                        : []),
                ];
            }
            return [
                ...(meta.smartPreviewKind === "html" ? [{
                    id: "smart-preview-ui-board",
                    title: "UI 画板：切换设备、编辑文案与体验动效",
                    label: "UI 画板",
                    icon: <Monitor className="size-3.5" />,
                    active: isHtmlDesignBoard(meta),
                    onClick: () => ctx.updateMetadata({ htmlDesignBoard: !isHtmlDesignBoard(meta), interactive: false }),
                }] : []),
                ...(isModel3d
                    ? [
                          {
                              id: "smart-preview-model-bg",
                              title: bg === "dark" ? i18n.t("canvas.modelNode.bgLight") : i18n.t("canvas.modelNode.bgDark"),
                              label: bg === "dark" ? i18n.t("canvas.modelNode.bgLightShort") : i18n.t("canvas.modelNode.bgDarkShort"),
                              icon: bg === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />,
                              onClick: () => ctx.updateMetadata({ modelPreviewBg: bg === "dark" ? "light" : "dark" }),
                          },
                          {
                              id: "smart-preview-model-textures",
                              title: showTextures ? i18n.t("canvas.modelNode.texturesOff") : i18n.t("canvas.modelNode.texturesOn"),
                              label: showTextures ? i18n.t("canvas.modelNode.textures") : i18n.t("canvas.modelNode.clay"),
                              icon: <ImageIcon className="size-3.5" />,
                              active: showTextures,
                              onClick: () => ctx.updateMetadata({ modelShowTextures: !showTextures }),
                          },
                      ]
                    : []),
                ...(explodeCanvas
                    ? [
                          {
                              id: "smart-preview-explode-canvas",
                              title: i18n.t("canvas.smartPreview.explodeToCanvas"),
                              label: i18n.t("canvas.smartPreview.explodeToCanvas"),
                              icon: <Network className="size-3.5" />,
                              onClick: () => explodeCanvasPreviewToGroup(ctx, antdMessage),
                          },
                      ]
                    : []),
                ...(exportImage
                    ? [
                          {
                              id: "smart-preview-export-image",
                              title: i18n.t("canvas.smartPreview.exportImage"),
                              label: i18n.t("canvas.smartPreview.exportImage"),
                              icon: <ImageDown className="size-3.5" />,
                              onClick: () => void runExportSmartPreviewImage(ctx, antdMessage),
                          },
                      ]
                    : []),
                ...(exportSource
                    ? [
                          {
                              id: "smart-preview-export-source",
                              title: i18n.t("canvas.smartPreview.exportSource"),
                              label: i18n.t("canvas.smartPreview.exportSource"),
                              icon: <Download className="size-3.5" />,
                              onClick: () => void exportSmartPreviewSource(ctx),
                          },
                      ]
                    : []),
                {
                    id: "smart-preview-fullscreen",
                    title: i18n.t("canvas.smartPreview.fullscreen"),
                    label: i18n.t("canvas.smartPreview.fullscreen"),
                    icon: <Maximize2 className="size-3.5" />,
                    active: fullscreen,
                    onClick: () => openFullscreen(ctx),
                },
                {
                    id: "smart-preview-close",
                    title: i18n.t("canvas.smartPreview.closePreview"),
                    label: i18n.t("canvas.smartPreview.closePreview"),
                    icon: <X className="size-3.5" />,
                    onClick: () => closePreview(ctx),
                },
                {
                    id: "smart-preview-reselect",
                    title: multiSheet ? i18n.t("canvas.smartPreview.switchSheet") : i18n.t("canvas.smartPreview.reselect"),
                    label: multiSheet ? i18n.t("canvas.smartPreview.switchSheet") : i18n.t("canvas.smartPreview.reselect"),
                    icon: multiSheet ? <Sheet className="size-3.5" /> : <Eye className="size-3.5" />,
                    onClick: () => (multiSheet ? backToSheets(ctx) : clearSelection(ctx)),
                },
            ];
        },
    };
}
