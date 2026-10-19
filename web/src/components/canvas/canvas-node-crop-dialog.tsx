import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Modal, Tooltip } from "antd";
import { Check, CircleHelp, Image as ImageIcon, LockKeyhole, Maximize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useImageEditorViewport } from "@/components/canvas/use-image-editor-viewport";
import { canvasThemes } from "@/lib/canvas-theme";
import { readImageMeta } from "@/lib/image-utils";
import { CANVAS_OVERLAY_MODAL_Z_INDEX } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";

export type CanvasImageCropRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type DragMode = "move" | "resize";
type ResizeHandle = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";

const handles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const minSize = 0.06;
const defaultCrop = { x: 0.12, y: 0.12, width: 0.76, height: 0.76 };
export function CanvasNodeCropDialog({ dataUrl, open, onClose, onConfirm }: { dataUrl: string; open: boolean; onClose: () => void; onConfirm: (crop: CanvasImageCropRect) => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [crop, setCrop] = useState<CanvasImageCropRect>(defaultCrop);
    const [ratioPreset, setRatioPreset] = useState("free");
    const [fixedRatio, setFixedRatio] = useState<number | null>(null);
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const dragAbortRef = useRef<AbortController | null>(null);
    const viewport = useImageEditorViewport(image, open);
    const boxRef = viewport.stageRef;
    const cropSize = image ? { width: Math.max(1, Math.round(crop.width * image.width)), height: Math.max(1, Math.round(crop.height * image.height)) } : null;

    useEffect(() => {
        if (open) {
            setCrop(defaultCrop);
            setRatioPreset("free");
            setFixedRatio(null);
        }
    }, [dataUrl, open]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setImage(null);
        void readImageMeta(dataUrl).then((meta) => { if (!cancelled) setImage(meta); });
        return () => { cancelled = true; };
    }, [dataUrl, open]);

    useEffect(() => {
        if (!open) dragAbortRef.current?.abort();
        return () => dragAbortRef.current?.abort();
    }, [open]);

    const startDrag = (mode: DragMode, event: ReactPointerEvent, handle?: ResizeHandle) => {
        const box = boxRef.current?.getBoundingClientRect();
        if (!box) return;
        event.preventDefault();
        event.stopPropagation();
        dragAbortRef.current?.abort();
        const controller = new AbortController();
        dragAbortRef.current = controller;
        const start = { x: event.clientX, y: event.clientY, crop };
        const move = (event: PointerEvent) => {
            const dx = (event.clientX - start.x) / box.width;
            const dy = (event.clientY - start.y) / box.height;
            setCrop(mode === "move" ? moveCrop(start.crop, dx, dy) : resizeCrop(start.crop, dx, dy, handle || "se", resolveRatio(ratioPreset, image, fixedRatio), box));
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
                    <h2 className="m-0 text-base font-semibold">{t("canvas.editors.cropTitle")}</h2>
                    <span className="text-xs font-normal tabular-nums" style={{ color: theme.node.placeholder }}>
                        {image ? `${t("canvas.editors.originalMode")} ${image.width} × ${image.height} px` : t("canvas.editors.loading")}
                    </span>
                </div>
            }
            open={open && Boolean(dataUrl)}
            onCancel={onClose}
            footer={
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <Button type="text" icon={<RotateCcw className="size-3.5" />} disabled={!image} onClick={() => {
                        dragAbortRef.current?.abort();
                        setCrop(defaultCrop);
                        setRatioPreset("free");
                        setFixedRatio(null);
                        viewport.resetZoom();
                    }}>{t("canvas.editors.reset")}</Button>
                    <div className="flex items-center gap-2">
                        <Button type="text" onClick={onClose}>{t("canvas.editors.cancel")}</Button>
                        <Button type="primary" icon={<Check className="size-4" />} disabled={!image} onClick={() => onConfirm(crop)}>{t("canvas.editors.confirmCrop")}</Button>
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
                container: { display: "flex", flexDirection: "column", height: "min(880px, calc(100dvh - 24px))", padding: 0, overflow: "hidden", background: theme.node.panel, color: theme.node.text },
                header: { flexShrink: 0, margin: 0, padding: "18px 24px", background: theme.node.panel, borderBottom: "1px solid " + theme.toolbar.border },
                body: { flex: 1, minHeight: 0, overflow: "hidden" },
                footer: { flexShrink: 0, margin: 0, padding: "12px 20px", borderTop: "1px solid " + theme.toolbar.border },
            }}
            modalRender={(content) => (
                <div
                    data-canvas-shortcuts-ignore
                    data-canvas-no-zoom
                    style={{ "--crop-hover": theme.toolbar.itemHover } as CSSProperties}
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
                            <h3 className="m-0 text-xs font-medium">{t("canvas.editors.cropPreview")}</h3>
                            <Tooltip title={t("canvas.editors.cropHelp")}>
                                <Button type="text" size="small" aria-label={t("canvas.editors.cropHelp")} icon={<CircleHelp className="size-3.5" />} />
                            </Tooltip>
                        </div>
                        <div className="flex items-center gap-0.5">
                            <Button type="text" size="small" title={t("canvas.editors.zoomOut")} aria-label={t("canvas.editors.zoomOut")} icon={<ZoomOut className="size-3.5" />} disabled={!image || !viewport.canZoomOut} onClick={viewport.zoomOut} />
                            <button type="button" title={t("canvas.editors.paintFit")} aria-label={t("canvas.editors.paintFit")} className="h-7 min-w-12 rounded-md px-1 text-center text-xs tabular-nums hover:bg-[var(--crop-hover)] focus-visible:outline-2 focus-visible:outline-offset-2" onClick={viewport.resetZoom}>
                                {Math.round(viewport.zoom * 100)}%
                            </button>
                            <Button type="text" size="small" title={t("canvas.editors.zoomIn")} aria-label={t("canvas.editors.zoomIn")} icon={<ZoomIn className="size-3.5" />} disabled={!image || !viewport.canZoomIn} onClick={viewport.zoomIn} />
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
                                <div className="absolute inset-0 overflow-hidden rounded-sm">
                                    <div className="absolute left-0 top-0 [backface-visibility:hidden]" style={viewport.mediaStyle}>
                                        <img src={dataUrl} alt="" className="block h-full w-full object-contain" draggable={false} />
                                    </div>
                                    <CropMask crop={crop} />
                                </div>
                                {image ? <div className="absolute cursor-move touch-none border" style={{ ...cropStyle(crop), borderColor: theme.node.activeStroke }} onPointerDown={(event) => startDrag("move", event)}>
                                    {["top-1/3", "top-2/3"].map((position) => <div key={position} className={`pointer-events-none absolute inset-x-0 border-t opacity-40 ${position}`} style={{ borderColor: theme.canvas.selectionStroke }} />)}
                                    {["left-1/3", "left-2/3"].map((position) => <div key={position} className={`pointer-events-none absolute inset-y-0 border-l opacity-40 ${position}`} style={{ borderColor: theme.canvas.selectionStroke }} />)}
                                    {handles.map((handle) => (
                                        <button key={handle} type="button" className="absolute flex size-5 touch-none items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2" style={handleStyle(handle)} onPointerDown={(event) => startDrag("resize", event, handle)} aria-label={t("canvas.editors.adjustCrop")}>
                                            <span className="size-2 rounded-[2px] border" style={{ background: theme.node.panel, borderColor: theme.node.activeStroke }} />
                                        </button>
                                    ))}
                                </div> : null}
                            </div>
                        </div>
                        {!image ? <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs" role="status" style={{ color: theme.node.placeholder }}>{t("canvas.editors.loading")}</div> : null}
                    </div>
                    <p className="m-0 text-[11px]" style={{ color: theme.node.placeholder }}>{t("canvas.editors.cropHint")}</p>
                </div>
                <aside className="flex min-h-0 flex-col gap-4 border-t p-4 md:overflow-y-auto md:border-t-0 md:border-l" style={{ borderColor: theme.toolbar.border }}>
                    <section className="shrink-0" aria-labelledby="crop-ratio-label">
                        <h3 id="crop-ratio-label" className="m-0 mb-2 text-xs font-semibold">{t("canvas.editors.cropRatio")}</h3>
                        <div className="grid grid-cols-3 gap-1.5" role="group" aria-labelledby="crop-ratio-label">
                            {[
                                { value: "free", icon: Maximize2, label: t("canvas.editors.free") },
                                { value: "fixed", icon: LockKeyhole, label: t("canvas.editors.fixed") },
                                { value: "original", icon: ImageIcon, label: t("canvas.editors.originalMode") },
                                ...["1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "21:9"].map((value) => ({ value, icon: null, label: value })),
                            ].map(({ value, icon: Icon, label }) => {
                                const active = ratioPreset === value;
                                const ratio = resolveRatio(value, image, fixedRatio) || 1;
                                return (
                                    <button
                                        key={value}
                                        type="button"
                                        aria-pressed={active}
                                        disabled={!image}
                                        className="flex flex-col items-center justify-center gap-1 rounded-lg border py-2 text-xs transition-colors hover:bg-[var(--crop-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40"
                                        style={{ borderColor: active ? theme.node.activeStroke : "transparent", background: active ? theme.toolbar.activeBg : undefined, color: active ? theme.node.text : theme.node.muted }}
                                        onClick={() => {
                                            setRatioPreset(value);
                                            const currentRatio = image ? (crop.width * image.width) / Math.max(1, crop.height * image.height) : null;
                                            const nextFixedRatio = value === "fixed" ? currentRatio : null;
                                            setFixedRatio(nextFixedRatio);
                                            const nextRatio = resolveRatio(value, image, nextFixedRatio);
                                            if (nextRatio && image) setCrop((current) => fitCropToRatio(current, nextRatio, image));
                                        }}
                                    >
                                        {Icon ? <Icon className="size-4" /> : <span className="flex h-5 w-8 items-center justify-center" aria-hidden><span className="rounded-[2px] border" style={{ width: 22 * Math.min(1, ratio), height: 22 / Math.max(1, ratio), borderColor: "currentColor" }} /></span>}
                                        <span className="tabular-nums">{label}</span>
                                    </button>
                                );
                            })}
                        </div>
                        <p className="mb-0 mt-2 text-[11px] leading-relaxed" style={{ color: theme.node.placeholder }}>
                            {t(ratioPreset === "free" ? "canvas.editors.cropFreeHint" : ratioPreset === "fixed" ? "canvas.editors.cropFixedHint" : ratioPreset === "original" ? "canvas.editors.cropOriginalHint" : "canvas.editors.cropPresetHint", { ratio: ratioPreset })}
                        </p>
                    </section>
                    <section className="shrink-0 border-t pt-4" style={{ borderColor: theme.toolbar.border }}>
                        <h3 className="m-0 mb-2 text-xs font-semibold">{t("canvas.editors.cropOutputSize")}</h3>
                        <dl className="m-0 grid grid-cols-2 gap-4">
                            {(["width", "height"] as const).map((side) => (
                                <div key={side}>
                                    <dt className="mb-1 text-[11px]" style={{ color: theme.node.placeholder }}>{t(side === "width" ? "canvas.editors.cropWidth" : "canvas.editors.cropHeight")}</dt>
                                    <dd className="m-0 flex items-baseline gap-1.5"><span className="text-xl font-semibold tracking-tight tabular-nums">{cropSize?.[side] ?? "—"}</span><span className="text-[11px]" style={{ color: theme.node.placeholder }}>px</span></dd>
                                </div>
                            ))}
                        </dl>
                        <p className="mb-0 mt-2 text-xs tabular-nums" style={{ color: theme.node.placeholder }}>{t("canvas.editors.ratio", { ratio: cropSize ? formatRatio(cropSize.width, cropSize.height) : "—" })}</p>
                    </section>
                    <p className="mb-0 mt-auto shrink-0 border-t pt-3 text-[11px] leading-relaxed" style={{ borderColor: theme.toolbar.border, color: theme.node.placeholder }}>{t("canvas.editors.cropSaveHint")}</p>
                </aside>
            </div>
        </Modal>
    );
}

function CropMask({ crop }: { crop: CanvasImageCropRect }) {
    return (
        <>
            <div className="absolute inset-x-0 top-0 bg-black/55" style={{ height: `${crop.y * 100}%` }} />
            <div className="absolute inset-x-0 bottom-0 bg-black/55" style={{ height: `${(1 - crop.y - crop.height) * 100}%` }} />
            <div className="absolute bg-black/55" style={{ left: 0, top: `${crop.y * 100}%`, width: `${crop.x * 100}%`, height: `${crop.height * 100}%` }} />
            <div className="absolute bg-black/55" style={{ right: 0, top: `${crop.y * 100}%`, width: `${(1 - crop.x - crop.width) * 100}%`, height: `${crop.height * 100}%` }} />
        </>
    );
}

function moveCrop(crop: CanvasImageCropRect, dx: number, dy: number): CanvasImageCropRect {
    return { ...crop, x: clamp(crop.x + dx, 0, 1 - crop.width), y: clamp(crop.y + dy, 0, 1 - crop.height) };
}

function resizeCrop(crop: CanvasImageCropRect, dx: number, dy: number, handle: ResizeHandle, aspectRatio: number | null, box: DOMRect): CanvasImageCropRect {
    let next = { ...crop };
    if (handle.includes("e")) next.width = crop.width + dx;
    if (handle.includes("s")) next.height = crop.height + dy;
    if (handle.includes("w")) {
        next.x = crop.x + dx;
        next.width = crop.width - dx;
    }
    if (handle.includes("n")) {
        next.y = crop.y + dy;
        next.height = crop.height - dy;
    }
    if (aspectRatio) {
        const normalizedRatio = aspectRatio * (box.height / box.width);
        const horizontalOnly = (handle.includes("e") || handle.includes("w")) && !handle.includes("n") && !handle.includes("s");
        const useWidth = horizontalOnly || (handle.length > 1 && Math.abs(dx * box.width) >= Math.abs(dy * box.height));
        if (useWidth) next.height = next.width / normalizedRatio;
        else next.width = next.height * normalizedRatio;
        if (handle.includes("w")) next.x = crop.x + crop.width - next.width;
        if (handle.includes("n")) next.y = crop.y + crop.height - next.height;
    }
    if (aspectRatio) {
        const normalizedRatio = aspectRatio * (box.height / box.width);
        const scaleDown = Math.min(1, 1 / Math.max(next.width, 0.001), 1 / Math.max(next.height, 0.001));
        next.width *= scaleDown;
        next.height *= scaleDown;
        if (next.width < minSize || next.height < minSize) {
            const minimumScale = Math.max(minSize / Math.max(next.width, 0.001), minSize / Math.max(next.height, 0.001));
            next.width *= minimumScale;
            next.height *= minimumScale;
        }
        next.width = Math.min(next.width, next.height * normalizedRatio);
        next.height = next.width / normalizedRatio;
    } else {
        next.width = clamp(next.width, minSize, 1);
        next.height = clamp(next.height, minSize, 1);
    }
    next.x = clamp(next.x, 0, 1 - next.width);
    next.y = clamp(next.y, 0, 1 - next.height);
    return next;
}

function resolveRatio(preset: string, image: { width: number; height: number } | null, fixedRatio: number | null) {
    if (preset === "free" || !image) return null;
    if (preset === "fixed") return fixedRatio;
    if (preset === "original") return image.width / image.height;
    const [width, height] = preset.split(":").map(Number);
    return width > 0 && height > 0 ? width / height : null;
}

function fitCropToRatio(crop: CanvasImageCropRect, ratio: number, image: { width: number; height: number }): CanvasImageCropRect {
    const normalizedRatio = ratio * (image.height / image.width);
    let width = crop.width;
    let height = width / normalizedRatio;
    if (height > crop.height) {
        height = crop.height;
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
    return {
        x: clamp(crop.x + (crop.width - width) / 2, 0, 1 - width),
        y: clamp(crop.y + (crop.height - height) / 2, 0, 1 - height),
        width,
        height,
    };
}

function cropStyle(crop: CanvasImageCropRect) {
    return { left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` };
}

function handleStyle(handle: ResizeHandle) {
    const top = handle.includes("n") ? "-10px" : handle.includes("s") ? "calc(100% - 10px)" : "calc(50% - 10px)";
    const left = handle.includes("w") ? "-10px" : handle.includes("e") ? "calc(100% - 10px)" : "calc(50% - 10px)";
    return { top, left, cursor: `${handle}-resize` };
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function formatRatio(width: number, height: number) {
    const divisor = gcd(width, height);
    return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function gcd(a: number, b: number): number {
    return b ? gcd(b, a % b) : Math.max(1, a);
}
