import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Modal, Tooltip } from "antd";
import { CircleHelp, Image as ImageIcon, LockKeyhole, Maximize2, RotateCcw, Save, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useImageEditorViewport } from "@/components/canvas/use-image-editor-viewport";
import { canvasThemes } from "@/lib/canvas-theme";
import { readImageMeta } from "@/lib/image-utils";
import { useThemeStore } from "@/stores/use-theme-store";
import { CANVAS_OVERLAY_MODAL_Z_INDEX } from "@/stores/use-canvas-side-panel-store";
import {
    containOutpaintBox,
    defaultOutpaintBox,
    formatOutpaintRatio,
    outpaintCanvasLayout,
    outpaintImageRect,
    placeOutpaintBox,
    type OutpaintBox,
} from "@/lib/canvas/outpaint";

type DragMode = "move" | "resize";
type ResizeHandle = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

const handles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const imageRect = outpaintImageRect();

export function CanvasNodeOutpaintDialog({
    dataUrl,
    open,
    onClose,
    onConfirm,
}: {
    dataUrl: string;
    open: boolean;
    onClose: () => void;
    onConfirm: (box: OutpaintBox) => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [box, setBox] = useState<OutpaintBox>(() => defaultOutpaintBox(imageRect));
    const [ratioPreset, setRatioPreset] = useState("free");
    const [fixedRatio, setFixedRatio] = useState<number | null>(null);
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const dragAbortRef = useRef<AbortController | null>(null);
    const canvasSize = image ? outpaintCanvasLayout(image.width, image.height, box, imageRect) : null;
    const viewport = useImageEditorViewport(canvasSize ? { width: canvasSize.canvasW, height: canvasSize.canvasH } : image, open);
    const boxRef = viewport.stageRef;
    const checkerStyle = {
        backgroundColor: theme.canvas.background,
        backgroundImage: `repeating-conic-gradient(${theme.node.stroke} 0% 25%, ${theme.canvas.background} 0% 50%)`,
        backgroundSize: "16px 16px",
    };
    const margins = canvasSize ? {
        top: canvasSize.imageY,
        bottom: canvasSize.canvasH - canvasSize.imageY - canvasSize.imageH,
        left: canvasSize.imageX,
        right: canvasSize.canvasW - canvasSize.imageX - canvasSize.imageW,
    } : null;

    useEffect(() => {
        if (open) {
            setBox(defaultOutpaintBox(imageRect));
            setRatioPreset("free");
            setFixedRatio(null);
        }
    }, [dataUrl, open]);

    useEffect(() => {
        if (!open) return;
        void readImageMeta(dataUrl).then(setImage);
    }, [dataUrl, open]);

    useEffect(() => {
        if (!open) dragAbortRef.current?.abort();
        return () => dragAbortRef.current?.abort();
    }, [open]);

    const startDrag = (mode: DragMode, event: ReactPointerEvent, handle?: ResizeHandle) => {
        const stage = boxRef.current?.getBoundingClientRect();
        if (!stage) return;
        event.preventDefault();
        event.stopPropagation();
        dragAbortRef.current?.abort();
        const controller = new AbortController();
        dragAbortRef.current = controller;
        const start = { x: event.clientX, y: event.clientY, box, stageW: stage.width, stageH: stage.height };
        const move = (event: PointerEvent) => {
            const dx = ((event.clientX - start.x) / start.stageW) * start.box.width;
            const dy = ((event.clientY - start.y) / start.stageH) * start.box.height;
            setBox(mode === "move" ? containOutpaintBox({ ...start.box, x: start.box.x - dx, y: start.box.y - dy }, imageRect) : resizeBox(start.box, dx, dy, handle || "se", resolveRatio(ratioPreset, image, fixedRatio), image));
        };
        const stop = () => controller.abort();
        document.addEventListener("pointermove", move, { signal: controller.signal });
        document.addEventListener("pointerup", stop, { signal: controller.signal });
        document.addEventListener("pointercancel", stop, { signal: controller.signal });
    };

    return (
        <Modal
            title={
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pr-8">
                    <h2 className="m-0 text-base font-semibold">{t("canvas.editors.outpaintTitle")}</h2>
                    <span className="text-xs font-normal tabular-nums" style={{ color: theme.node.placeholder }}>
                        {image ? `${t("canvas.editors.originalMode")} ${image.width} × ${image.height} px` : t("canvas.editors.loading")}
                    </span>
                </div>
            }
            open={open && Boolean(dataUrl)}
            onCancel={onClose}
            footer={
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <Button
                        type="text"
                        icon={<RotateCcw className="size-3.5" />}
                        onClick={() => {
                            dragAbortRef.current?.abort();
                            const next = defaultOutpaintBox(imageRect);
                            const ratio = resolveRatio(ratioPreset, image, fixedRatio);
                            setBox(ratio && image ? fitBoxToRatio(next, ratio, image) : next);
                        }}
                    >
                        {t("canvas.editors.reset")}
                    </Button>
                    <div className="flex items-center gap-2">
                        <Button type="text" onClick={onClose}>{t("canvas.editors.cancel")}</Button>
                        <Button type="primary" icon={<Save className="size-4" />} disabled={!image} onClick={() => onConfirm(box)}>
                            {t("canvas.editors.confirmOutpaint")}
                        </Button>
                    </div>
                </div>
            }
            width="min(1180px, 96vw)"
            centered
            destroyOnHidden
            transitionName=""
            maskTransitionName=""
            zIndex={CANVAS_OVERLAY_MODAL_Z_INDEX}
            getContainer={() => document.body}
            styles={{
                container: { display: "flex", flexDirection: "column", height: "min(820px, calc(100dvh - 40px))", padding: 0, overflow: "hidden", background: theme.node.panel, color: theme.node.text },
                header: { flexShrink: 0, margin: 0, padding: "18px 24px", background: theme.node.panel, borderBottom: "1px solid " + theme.toolbar.border },
                body: { flex: 1, minHeight: 0, overflow: "hidden" },
                footer: { flexShrink: 0, margin: 0, padding: "12px 20px", borderTop: "1px solid " + theme.toolbar.border },
            }}
            modalRender={(content) => (
                <div
                    data-canvas-shortcuts-ignore
                    data-canvas-no-zoom
                    style={{ "--outpaint-hover": theme.toolbar.itemHover } as CSSProperties}
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                >{content}</div>
            )}
        >
            <div className="grid h-full min-h-0 overflow-y-auto overscroll-contain md:grid-cols-[minmax(0,1fr)_280px] md:overflow-hidden">
                <div className="flex min-h-0 min-w-0 flex-col gap-3 p-4 md:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                            <h3 className="m-0 text-xs font-medium">{t("canvas.editors.outpaintPreview")}</h3>
                            <Tooltip title={t("canvas.editors.outpaintHint")}>
                                <Button type="text" size="small" aria-label={t("canvas.editors.outpaintHint")} icon={<CircleHelp className="size-3.5" />} />
                            </Tooltip>
                        </div>
                        <div className="flex items-center gap-0.5">
                            <Button type="text" size="small" title={t("canvas.editors.zoomOut")} aria-label={t("canvas.editors.zoomOut")} icon={<ZoomOut className="size-3.5" />} disabled={!viewport.canZoomOut} onClick={viewport.zoomOut} />
                            <button type="button" title={t("canvas.editors.paintFit")} aria-label={t("canvas.editors.paintFit")} className="h-7 min-w-12 rounded-md px-1 text-center text-xs tabular-nums hover:bg-[var(--outpaint-hover)] focus-visible:outline-2 focus-visible:outline-offset-2" onClick={viewport.resetZoom}>
                                {Math.round(viewport.zoom * 100)}%
                            </button>
                            <Button type="text" size="small" title={t("canvas.editors.zoomIn")} aria-label={t("canvas.editors.zoomIn")} icon={<ZoomIn className="size-3.5" />} disabled={!viewport.canZoomIn} onClick={viewport.zoomIn} />
                        </div>
                    </div>
                    <div
                        ref={viewport.viewportRef}
                        {...viewport.panHandlers}
                        className={`relative h-[44dvh] min-h-[240px] w-full shrink-0 rounded-xl md:h-auto md:min-h-0 md:flex-1 ${viewport.scrollClassName} ${viewport.isPanning ? "cursor-grabbing" : viewport.spacePressed ? "cursor-grab" : ""}`}
                        style={{ background: theme.canvas.background, scrollbarWidth: "thin", scrollbarColor: theme.toolbar.border + " transparent" }}
                    >
                        <div className="relative" style={viewport.contentStyle}>
                            <div ref={boxRef} className="absolute isolate select-none" style={viewport.stageStyle}>
                                <div className="absolute inset-0 overflow-hidden rounded-sm" style={checkerStyle}>
                                    <div className="absolute cursor-move" style={imageInCanvasStyle(box)} onPointerDown={(event) => startDrag("move", event)}>
                                        <img src={dataUrl} alt="" className="block h-full w-full object-contain" draggable={false} />
                                    </div>
                                    {["top-1/3", "top-2/3"].map((position) => <div key={position} className={`pointer-events-none absolute inset-x-0 border-t opacity-30 ${position}`} style={{ borderColor: theme.canvas.selectionStroke }} />)}
                                    {["left-1/3", "left-2/3"].map((position) => <div key={position} className={`pointer-events-none absolute inset-y-0 border-l opacity-30 ${position}`} style={{ borderColor: theme.canvas.selectionStroke }} />)}
                                </div>
                                <div className="pointer-events-none absolute inset-0 rounded-sm border" style={{ borderColor: theme.node.activeStroke }} />
                                {handles.map((handle) => (
                                    <button key={handle} type="button" className="absolute flex size-5 touch-none items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2" style={handleStyle(handle)} onPointerDown={(event) => startDrag("resize", event, handle)} aria-label={t("canvas.editors.adjustOutpaint")}>
                                        <span className="size-2 rounded-[2px] border" style={{ background: theme.node.panel, borderColor: theme.node.activeStroke }} />
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]" style={{ color: theme.node.placeholder }}>
                        <span>{t("canvas.editors.cropHint")}</span>
                        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-3 rounded-sm border" style={{ ...checkerStyle, backgroundSize: "8px 8px", borderColor: theme.toolbar.border }} />{t("canvas.editors.outpaintEmptyArea")}</span>
                    </div>
                </div>
                <aside className="flex min-h-0 flex-col gap-6 border-t p-5 md:overflow-y-auto md:border-t-0 md:border-l" style={{ borderColor: theme.toolbar.border }}>
                    <section aria-labelledby="outpaint-ratio-label">
                        <h3 id="outpaint-ratio-label" className="mb-3 text-xs font-semibold">{t("canvas.editors.outpaintRatio")}</h3>
                        <div className="grid grid-cols-6 gap-1.5" role="group" aria-labelledby="outpaint-ratio-label">
                            {[
                                { value: "free", icon: Maximize2, label: t("canvas.editors.free") },
                                { value: "fixed", icon: LockKeyhole, label: t("canvas.editors.fixed") },
                                { value: "original", icon: ImageIcon, label: t("canvas.editors.originalMode") },
                                ...["1:1", "4:3", "16:9", "9:16"].map((value) => ({ value, icon: null, label: value })),
                            ].map(({ value, icon: Icon, label }) => {
                                const active = ratioPreset === value;
                                const ratio = resolveRatio(value, image, fixedRatio) || 1;
                                return (
                                    <button
                                        key={value}
                                        type="button"
                                        aria-pressed={active}
                                        disabled={!image}
                                        className={`flex flex-col items-center justify-center gap-2 rounded-lg border py-3 text-xs transition-colors hover:bg-[var(--outpaint-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40 ${Icon ? "col-span-2" : "col-span-3"}`}
                                        style={{ borderColor: active ? theme.node.activeStroke : "transparent", background: active ? theme.toolbar.activeBg : undefined, color: active ? theme.node.text : theme.node.muted }}
                                        onClick={() => {
                                            setRatioPreset(value);
                                            const nextFixedRatio = value === "fixed" && canvasSize ? canvasSize.canvasW / canvasSize.canvasH : null;
                                            setFixedRatio(nextFixedRatio);
                                            const nextRatio = resolveRatio(value, image, nextFixedRatio);
                                            if (nextRatio && image) setBox((current) => fitBoxToRatio(current, nextRatio, image));
                                        }}
                                    >
                                        {Icon ? <Icon className="size-4" /> : <span className="flex h-5 w-8 items-center justify-center" aria-hidden><span className="rounded-[2px] border" style={{ width: 22 * Math.min(1, ratio), height: 22 / Math.max(1, ratio), borderColor: "currentColor" }} /></span>}
                                        <span className="tabular-nums">{label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                    <section className="border-t pt-5" style={{ borderColor: theme.toolbar.border }}>
                        <h3 className="mb-2 text-xs font-semibold">{t("canvas.editors.outpaintCanvasSize")}</h3>
                        <div className="flex flex-wrap items-baseline gap-1.5">
                            <span className="text-xl font-semibold tracking-tight tabular-nums">{canvasSize ? `${canvasSize.canvasW} × ${canvasSize.canvasH}` : "—"}</span>
                            <span className="text-xs" style={{ color: theme.node.placeholder }}>px</span>
                        </div>
                        <p className="mb-0 mt-1 text-xs tabular-nums" style={{ color: theme.node.placeholder }}>{t("canvas.editors.ratio", { ratio: canvasSize ? formatOutpaintRatio(canvasSize.canvasW, canvasSize.canvasH) : "—" })}</p>
                    </section>
                    <section className="border-t pt-5" style={{ borderColor: theme.toolbar.border }}>
                        <h3 className="mb-3 text-xs font-semibold">{t("canvas.editors.outpaintMargins")}</h3>
                        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
                            {(["top", "bottom", "left", "right"] as const).map((side) => <div key={side} className="flex items-baseline justify-between gap-2">
                                <dt style={{ color: theme.node.placeholder }}>{t(`canvas.editors.outpaintSides.${side}`)}</dt>
                                <dd className="m-0 tabular-nums">{margins ? Math.max(0, margins[side]) : "—"}<span className="ml-1 text-[10px]" style={{ color: theme.node.placeholder }}>px</span></dd>
                            </div>)}
                        </dl>
                    </section>
                    <p className="mb-0 mt-auto text-xs leading-relaxed" style={{ color: theme.node.placeholder }}>{t("canvas.editors.outpaintSaveHint")}</p>
                </aside>
            </div>
        </Modal>
    );
}

function resizeBox(box: OutpaintBox, dx: number, dy: number, handle: ResizeHandle, aspectRatio: number | null, image: { width: number; height: number } | null): OutpaintBox {
    let width = box.width;
    let height = box.height;
    if (handle.includes("e")) width = box.width + dx;
    if (handle.includes("s")) height = box.height + dy;
    if (handle.includes("w")) width = box.width - dx;
    if (handle.includes("n")) height = box.height - dy;
    if (aspectRatio && image) {
        const normalizedRatio = boxRatioFromPixels(aspectRatio, image);
        const horizontalOnly = (handle.includes("e") || handle.includes("w")) && !handle.includes("n") && !handle.includes("s");
        const verticalOnly = (handle.includes("n") || handle.includes("s")) && !handle.includes("e") && !handle.includes("w");
        if (horizontalOnly) height = width / normalizedRatio;
        else if (verticalOnly) width = height * normalizedRatio;
        else if (width / Math.max(height, 1e-6) >= normalizedRatio) height = width / normalizedRatio;
        else width = height * normalizedRatio;
        const next = clampBoxToRatio({ ...box, width, height }, normalizedRatio);
        return placeOutpaintBox(
            {
                ...next,
                x: handle.includes("w") ? box.x + box.width - next.width : handle.includes("e") ? box.x : box.x + (box.width - next.width) / 2,
                y: handle.includes("n") ? box.y + box.height - next.height : handle.includes("s") ? box.y : box.y + (box.height - next.height) / 2,
            },
            imageRect,
        );
    }
    return containOutpaintBox(
        {
            x: handle.includes("w") ? box.x + dx : box.x,
            y: handle.includes("n") ? box.y + dy : box.y,
            width,
            height,
        },
        imageRect,
    );
}

function resolveRatio(preset: string, image: { width: number; height: number } | null, fixedRatio: number | null) {
    if (preset === "free" || !image) return null;
    if (preset === "fixed") return fixedRatio;
    if (preset === "original") return image.width / image.height;
    const [width, height] = preset.split(":").map(Number);
    return width > 0 && height > 0 ? width / height : null;
}

function boxRatioFromPixels(ratio: number, image: { width: number; height: number }) {
    return ratio * (image.height / image.width);
}

function clampBoxToRatio(box: OutpaintBox, normalizedRatio: number): OutpaintBox {
    let width = Math.min(1, Math.max(imageRect.width, box.width));
    let height = width / normalizedRatio;
    if (height < imageRect.height) {
        height = imageRect.height;
        width = height * normalizedRatio;
    }
    if (width > 1) {
        width = 1;
        height = width / normalizedRatio;
    }
    if (height > 1) {
        height = 1;
        width = height * normalizedRatio;
    }
    return { ...box, width, height };
}

function fitBoxToRatio(box: OutpaintBox, ratio: number, image: { width: number; height: number }): OutpaintBox {
    const next = clampBoxToRatio(box, boxRatioFromPixels(ratio, image));
    return containOutpaintBox(
        {
            ...next,
            x: box.x + (box.width - next.width) / 2,
            y: box.y + (box.height - next.height) / 2,
        },
        imageRect,
    );
}

function imageInCanvasStyle(box: OutpaintBox) {
    return {
        left: `${((imageRect.x - box.x) / box.width) * 100}%`,
        top: `${((imageRect.y - box.y) / box.height) * 100}%`,
        width: `${(imageRect.width / box.width) * 100}%`,
        height: `${(imageRect.height / box.height) * 100}%`,
    };
}

function handleStyle(handle: ResizeHandle) {
    const top = handle.includes("n") ? "-10px" : handle.includes("s") ? "calc(100% - 10px)" : "calc(50% - 10px)";
    const left = handle.includes("w") ? "-10px" : handle.includes("e") ? "calc(100% - 10px)" : "calc(50% - 10px)";
    return { top, left, cursor: `${handle}-resize` };
}
