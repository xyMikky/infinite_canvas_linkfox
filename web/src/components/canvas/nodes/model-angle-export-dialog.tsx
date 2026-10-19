import { Button, Modal, Switch, Tooltip } from "antd";
import { ChevronRight, CircleHelp, Crosshair, ImageDown, ImagePlus, Moon, RotateCcw, Sun, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { canvasThemes } from "@/lib/canvas-theme";
import type { Model3dCameraPose, Model3dViewOffsets, Model3dViewerHandle } from "@/lib/canvas/model-3d-viewer";
import { readSidePanelInsertFromDataTransfer, resolveSidePanelInsertPayload } from "@/lib/canvas/side-panel-insert-drag";
import { getMediaBlob } from "@/services/file-storage";
import { resolveImageUrl } from "@/services/image-storage";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";

type RatioOption = { value: string; labelKey?: "free" | "fixed"; label?: string; width?: number; height?: number };

export type ModelAngleExportParams = Model3dViewOffsets;

export type ModelAngleBgPick = { url: string; width?: number; height?: number; storageKey?: string };

type BgPickHandler = (pick: ModelAngleBgPick) => void | Promise<void>;
let bgPickHandler: BgPickHandler | null = null;

export function registerModelAngleBgPickHandler(handler: BgPickHandler) {
    bgPickHandler = handler;
    return () => {
        if (bgPickHandler === handler) bgPickHandler = null;
    };
}

/** 导出角度弹窗打开时，点击侧栏图片可直接设为参考背景；返回 true 表示已消费 */
export function tryPickModelAngleBackground(pick: ModelAngleBgPick) {
    if (!bgPickHandler || !pick.url) return false;
    void bgPickHandler(pick);
    return true;
}

type CropRect = { x: number; y: number; width: number; height: number };
type ResizeHandle = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";
type DragMode = "move" | "resize";
type RefBackground = { url: string; width: number; height: number };

const defaultOffsets: ModelAngleExportParams = {
    horizontalAngle: 0,
    pitchAngle: 0,
    distanceScale: 1,
    fov: 45,
    panX: 0,
    panY: 0,
};

const defaultCrop: CropRect = { x: 0.08, y: 0.08, width: 0.84, height: 0.84 };
const handles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const minCrop = 0.08;
const EXPORT_LONG_SIDE = 2048;
const PREVIEW_BG = { dark: "#1c1917", light: "#f5f5f4" } as const;
const round2 = (value: number) => Math.round(value * 100) / 100;

const RATIO_OPTIONS: RatioOption[] = [
    { value: "free", labelKey: "free" },
    { value: "fixed", labelKey: "fixed" },
    { value: "1:1", label: "1:1", width: 1, height: 1 },
    { value: "3:2", label: "3:2", width: 3, height: 2 },
    { value: "2:3", label: "2:3", width: 2, height: 3 },
    { value: "3:4", label: "3:4", width: 3, height: 4 },
    { value: "4:3", label: "4:3", width: 4, height: 3 },
    { value: "4:5", label: "4:5", width: 4, height: 5 },
    { value: "5:4", label: "5:4", width: 5, height: 4 },
    { value: "9:16", label: "9:16", width: 9, height: 16 },
    { value: "16:9", label: "16:9", width: 16, height: 9 },
    { value: "21:9", label: "21:9", width: 21, height: 9 },
];

function stopCanvasBubble(event: { stopPropagation: () => void }) {
    event.stopPropagation();
}

export function buildModelAngleChangePrompt(params: Pick<ModelAngleExportParams, "horizontalAngle" | "pitchAngle" | "distanceScale" | "fov">) {
    const parts: string[] = [];
    if (params.horizontalAngle !== 0) {
        parts.push(
            params.horizontalAngle > 0
                ? i18n.t("canvas.generation.rotateRight", { angle: Math.abs(params.horizontalAngle).toFixed(2) })
                : i18n.t("canvas.generation.rotateLeft", { angle: Math.abs(params.horizontalAngle).toFixed(2) }),
        );
    }
    if (params.pitchAngle !== 0) {
        parts.push(
            params.pitchAngle > 0
                ? i18n.t("canvas.generation.topDown", { angle: Math.abs(params.pitchAngle).toFixed(2) })
                : i18n.t("canvas.generation.lowAngle", { angle: Math.abs(params.pitchAngle).toFixed(2) }),
        );
    }
    if (Math.abs(params.distanceScale - 1) >= 0.05) {
        parts.push(i18n.t("canvas.modelNode.distanceChange", { value: params.distanceScale.toFixed(2) }));
    }
    if (params.fov !== defaultOffsets.fov) {
        parts.push(i18n.t("canvas.modelNode.perspectiveChange", { value: params.fov.toFixed(2) }));
    }
    return parts.length ? parts.join("，") : i18n.t("canvas.generation.front");
}

export function ModelAngleExportDialog({
    open,
    storageKey,
    fileName,
    background: _background,
    showTextures,
    initialPose,
    onClose,
    onExport,
}: {
    open: boolean;
    storageKey: string;
    fileName: string;
    /** 兼容调用方；导出弹窗预览底默认浅色，不再跟随节点背景 */
    background: string;
    showTextures: boolean;
    initialPose: Model3dCameraPose | null;
    onClose: () => void;
    onExport: (blob: Blob, prompt: string) => void | Promise<void>;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const sidePanelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const sidePanelWidth = useCanvasSidePanelStore((state) => state.width);
    const maskLeft = sidePanelOpen ? sidePanelWidth : 0;
    const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<Model3dViewerHandle | null>(null);
    const basePoseRef = useRef<Model3dCameraPose | null>(null);
    const initialPoseRef = useRef(initialPose);
    const dragAbortRef = useRef<AbortController | null>(null);
    const backgroundRequestRef = useRef(0);
    const [modalOpen, setModalOpen] = useState(false);
    const [ready, setReady] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [dropHover, setDropHover] = useState(false);
    const [params, setParams] = useState(defaultOffsets);
    const [crop, setCrop] = useState<CropRect>(defaultCrop);
    const [ratioPreset, setRatioPreset] = useState<string>("free");
    const [fixedRatio, setFixedRatio] = useState<number | null>(null);
    const [stageSize, setStageSize] = useState({ width: 1, height: 1 });
    const [refBackground, setRefBackground] = useState<RefBackground | null>(null);
    const [includeBackground, setIncludeBackground] = useState(false);
    // 导出角度弹窗默认浅色底；节点上的深/浅仅影响画布预览，不带到本弹窗
    const [previewBg, setPreviewBg] = useState<"dark" | "light">("light");
    const previewBgColor = PREVIEW_BG[previewBg];
    const changePrompt = useMemo(() => buildModelAngleChangePrompt(params), [params]);
    const paramsRef = useRef(params);
    paramsRef.current = params;
    const cropRef = useRef(crop);
    cropRef.current = crop;
    initialPoseRef.current = initialPose;
    const applyRefBackgroundRef = useRef<BgPickHandler>(() => undefined);

    useEffect(() => {
        if (!open || !modalOpen || !canvasEl || !storageKey) {
            if (!open) {
                setParams(defaultOffsets);
                setCrop(defaultCrop);
                setRatioPreset("free");
                setFixedRatio(null);
                setRefBackground(null);
                setIncludeBackground(false);
                setPreviewBg("light");
                setReady(false);
                setLoadError(false);
                setDropHover(false);
            }
            return;
        }
        let cancelled = false;
        setReady(false);
        setLoadError(false);
        setParams(defaultOffsets);
        setCrop(defaultCrop);
        setRatioPreset("free");
        setFixedRatio(null);
        setRefBackground(null);
        setIncludeBackground(false);
        setPreviewBg("light");
        void (async () => {
            try {
                const blob = await getMediaBlob(storageKey);
                if (cancelled) return;
                if (!blob?.size) {
                    setLoadError(true);
                    return;
                }
                const buffer = await blob.arrayBuffer();
                if (cancelled) return;
                const { mountModel3dViewer } = await import("@/lib/canvas/model-3d-viewer");
                const pose = initialPoseRef.current;
                const handle = await mountModel3dViewer({
                    canvas: canvasEl,
                    buffer,
                    fileName,
                    interactive: false,
                    background: PREVIEW_BG.light,
                    showTextures,
                    initialPose: pose,
                });
                if (cancelled) {
                    handle.dispose();
                    return;
                }
                viewerRef.current = handle;
                basePoseRef.current = handle.getPose();
                setParams({ ...defaultOffsets, fov: basePoseRef.current.fov });
                setReady(true);
            } catch {
                if (!cancelled) {
                    setReady(false);
                    setLoadError(true);
                }
            }
        })();
        return () => {
            cancelled = true;
            viewerRef.current?.dispose();
            viewerRef.current = null;
            basePoseRef.current = null;
        };
    }, [canvasEl, fileName, modalOpen, open, showTextures, storageKey]);

    useEffect(() => {
        const base = basePoseRef.current;
        const viewer = viewerRef.current;
        if (!ready || !base || !viewer) return;
        viewer.applyOffsets(base, params);
    }, [params, ready]);

    useEffect(() => {
        if (!ready) return;
        viewerRef.current?.setBackground(refBackground ? null : previewBgColor);
    }, [previewBgColor, ready, refBackground]);

    useEffect(() => {
        const stage = stageRef.current;
        if (!open || !modalOpen || !stage) return;
        const sync = () => {
            const width = Math.max(1, stage.clientWidth);
            const height = Math.max(1, stage.clientHeight);
            setStageSize({ width, height });
        };
        sync();
        const observer = new ResizeObserver(sync);
        observer.observe(stage);
        return () => observer.disconnect();
    }, [modalOpen, open]);

    useEffect(() => {
        const ratio = resolveRatio(ratioPreset, fixedRatio);
        if (ready && ratio) setCrop((current) => fitCropToRatio(current, ratio, stageSize));
    }, [fixedRatio, ratioPreset, ready, stageSize]);

    useEffect(() => {
        if (!open) dragAbortRef.current?.abort();
        return () => dragAbortRef.current?.abort();
    }, [open]);

    useEffect(() => {
        const stage = stageRef.current;
        if (!open || !modalOpen || !ready || !stage) return;
        const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const delta = event.deltaY > 0 ? 0.02 : -0.02;
            setParams((current) => ({
                ...current,
                distanceScale: round2(clamp(current.distanceScale + delta, 0.4, 2.5)),
            }));
        };
        stage.addEventListener("wheel", onWheel, { passive: false });
        return () => stage.removeEventListener("wheel", onWheel);
    }, [modalOpen, open, ready]);

    const update = <Key extends keyof ModelAngleExportParams>(key: Key, value: ModelAngleExportParams[Key]) => {
        setParams((current) => ({ ...current, [key]: round2(Number(value)) as ModelAngleExportParams[Key] }));
    };

    const applyImageRatio = (ratio: number, requestId: number) => {
        const preset = matchRatioPreset(ratio);
        setRatioPreset(preset);
        setFixedRatio(preset === "fixed" ? ratio : null);
        const tryFit = () => {
            if (requestId !== backgroundRequestRef.current) return false;
            const stage = stageRef.current;
            if (!stage) return false;
            const size = { width: Math.max(1, stage.clientWidth), height: Math.max(1, stage.clientHeight) };
            if (size.width < 8 || size.height < 8) return false;
            setStageSize(size);
            setCrop((current) => fitCropToRatio(current, ratio, size));
            return true;
        };
        if (!tryFit()) requestAnimationFrame(() => tryFit());
    };

    const applyRefBackground = async (pick: ModelAngleBgPick) => {
        const requestId = ++backgroundRequestRef.current;
        const url = (pick.storageKey ? await resolveImageUrl(pick.storageKey, pick.url) : "") || pick.url;
        if (!url || requestId !== backgroundRequestRef.current) return;
        let nextWidth = 0;
        let nextHeight = 0;
        try {
            const size = await loadImageSize(url);
            nextWidth = size.width;
            nextHeight = size.height;
        } catch {
            nextWidth = pick.width || 0;
            nextHeight = pick.height || 0;
        }
        if (!nextWidth || !nextHeight || requestId !== backgroundRequestRef.current) return;
        setRefBackground({ url, width: nextWidth, height: nextHeight });
        applyImageRatio(nextWidth / nextHeight, requestId);
    };
    applyRefBackgroundRef.current = applyRefBackground;

    useEffect(() => {
        if (!open) return;
        const unregister = registerModelAngleBgPickHandler((pick) => applyRefBackgroundRef.current(pick));
        return () => {
            backgroundRequestRef.current += 1;
            unregister();
        };
    }, [open, storageKey]);

    const clearRefBackground = () => {
        backgroundRequestRef.current += 1;
        setRefBackground(null);
        setIncludeBackground(false);
        setDropHover(false);
    };

    const onStageDragOver = (event: ReactDragEvent) => {
        if (![...event.dataTransfer.types].some((type) => type.includes("infinite-canvas") || type === "Files" || type === "text/plain" || type === "application/json")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropHover(true);
    };

    const onStageDrop = async (event: ReactDragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setDropHover(false);
        const sideDrag = readSidePanelInsertFromDataTransfer(event.dataTransfer);
        if (sideDrag) {
            const payload = resolveSidePanelInsertPayload(sideDrag);
            if (payload?.kind === "image") {
                await applyRefBackground({ storageKey: payload.storageKey, url: payload.dataUrl });
                return;
            }
        }
        const file = [...event.dataTransfer.files].find((item) => item.type.startsWith("image/"));
        if (!file) return;
        const url = URL.createObjectURL(file);
        try {
            await applyRefBackground({ url });
        } catch {
            URL.revokeObjectURL(url);
        }
    };

    const startCropDrag = (mode: DragMode, event: ReactPointerEvent, handle?: ResizeHandle) => {
        const box = stageRef.current?.getBoundingClientRect();
        if (!box) return;
        if (mode === "move" && event.button !== 0) return;
        if (mode === "resize" && event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        dragAbortRef.current?.abort();
        const controller = new AbortController();
        dragAbortRef.current = controller;
        const start = { x: event.clientX, y: event.clientY, crop: cropRef.current };
        const aspect = resolveRatio(ratioPreset, fixedRatio);
        const move = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== event.pointerId) return;
            const dx = (moveEvent.clientX - start.x) / box.width;
            const dy = (moveEvent.clientY - start.y) / box.height;
            setCrop(mode === "move" ? moveCrop(start.crop, dx, dy) : resizeCrop(start.crop, dx, dy, handle || "se", aspect, box));
        };
        const stop = (stopEvent: PointerEvent) => {
            if (stopEvent.pointerId !== event.pointerId) return;
            controller.abort();
        };
        document.addEventListener("pointermove", move, { capture: true, signal: controller.signal });
        document.addEventListener("pointerup", stop, { capture: true, signal: controller.signal });
        document.addEventListener("pointercancel", stop, { capture: true, signal: controller.signal });
    };

    const startViewDrag = (event: ReactPointerEvent) => {
        if (!ready) return;
        if ((event.target as HTMLElement | null)?.closest?.("[data-crop-handle]")) return;
        if ((event.target as HTMLElement | null)?.closest?.("[data-crop-move]")) {
            startCropDrag("move", event);
            return;
        }
        if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
        event.preventDefault();
        event.stopPropagation();
        dragAbortRef.current?.abort();
        const controller = new AbortController();
        dragAbortRef.current = controller;
        const box = stageRef.current?.getBoundingClientRect();
        if (!box) return;
        const mode = event.button === 0 ? "orbit" : "pan";
        const start = { x: event.clientX, y: event.clientY, params: { ...paramsRef.current } };
        const move = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== event.pointerId) return;
            const dx = moveEvent.clientX - start.x;
            const dy = moveEvent.clientY - start.y;
            if (mode === "orbit") {
                setParams({
                    ...start.params,
                    horizontalAngle: round2(clamp(start.params.horizontalAngle + dx * 0.25, -180, 180)),
                    pitchAngle: round2(clamp(start.params.pitchAngle + dy * 0.25, -90, 90)),
                });
                return;
            }
            setParams({
                ...start.params,
                panX: round2(clamp(start.params.panX - (dx / box.width) * 2, -1, 1)),
                panY: round2(clamp(start.params.panY + (dy / box.height) * 2, -1, 1)),
            });
        };
        const stop = (stopEvent: PointerEvent) => {
            if (stopEvent.pointerId !== event.pointerId) return;
            controller.abort();
        };
        document.addEventListener("pointermove", move, { capture: true, signal: controller.signal });
        document.addEventListener("pointerup", stop, { capture: true, signal: controller.signal });
        document.addEventListener("pointercancel", stop, { capture: true, signal: controller.signal });
    };

    const applyRatioPreset = (preset: string) => {
        setRatioPreset(preset);
        const currentRatio = (crop.width * stageSize.width) / Math.max(1, crop.height * stageSize.height);
        const nextFixed = preset === "fixed" ? fixedRatio || currentRatio : null;
        setFixedRatio(nextFixed);
        const ratio = resolveRatio(preset, nextFixed);
        if (ratio) setCrop((current) => fitCropToRatio(current, ratio, stageSize));
    };

    const onConfirm = async () => {
        const viewer = viewerRef.current;
        if (!viewer || exporting) return;
        setExporting(true);
        try {
            if (basePoseRef.current) viewer.applyOffsets(basePoseRef.current, paramsRef.current);
            const useBg = Boolean(refBackground && includeBackground);
            viewer.setBackground(useBg ? null : previewBgColor);
            const stageAspect = stageSize.width / Math.max(1, stageSize.height);
            const fullW = stageAspect >= 1 ? EXPORT_LONG_SIDE : Math.round(EXPORT_LONG_SIDE * stageAspect);
            const fullH = stageAspect >= 1 ? Math.round(EXPORT_LONG_SIDE / stageAspect) : EXPORT_LONG_SIDE;
            const fullBlob = await viewer.captureImage({ width: fullW, height: fullH });
            const blob = useBg && refBackground
                ? await composeWithBackground(fullBlob, crop, EXPORT_LONG_SIDE, refBackground.url)
                : await cropBlobToRect(fullBlob, crop, EXPORT_LONG_SIDE);
            viewer.setBackground(refBackground ? null : previewBgColor);
            await onExport(blob, changePrompt);
            onClose();
        } finally {
            setExporting(false);
        }
    };

    const cropAspect = (crop.width * stageSize.width) / Math.max(1, crop.height * stageSize.height);
    const outW = cropAspect >= 1 ? EXPORT_LONG_SIDE : Math.max(1, Math.round(EXPORT_LONG_SIDE * cropAspect));
    const outH = cropAspect >= 1 ? Math.max(1, Math.round(EXPORT_LONG_SIDE / cropAspect)) : EXPORT_LONG_SIDE;

    return (
        <Modal
            title={
                <div className="min-w-0 pr-8">
                    <h2 className="m-0 text-base font-semibold">{t("canvas.modelNode.exportAngleTitle")}</h2>
                    <p className="mb-0 mt-1 truncate text-xs font-normal" style={{ color: theme.node.placeholder }} title={fileName}>{fileName}</p>
                </div>
            }
            open={open}
            onCancel={onClose}
            footer={
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <Button
                        type="text"
                        disabled={exporting}
                        icon={<RotateCcw className="size-3.5" />}
                        onClick={() => {
                            dragAbortRef.current?.abort();
                            setParams({ ...defaultOffsets, fov: basePoseRef.current?.fov ?? defaultOffsets.fov });
                            setCrop(defaultCrop);
                            setRatioPreset("free");
                            setFixedRatio(null);
                            clearRefBackground();
                            setPreviewBg("light");
                            viewerRef.current?.setBackground(PREVIEW_BG.light);
                        }}
                    >
                        {t("canvas.editors.reset")}
                    </Button>
                    <div className="flex items-center gap-2">
                        <Button type="text" onClick={onClose}>{t("canvas.editors.cancel")}</Button>
                        <Button type="primary" loading={exporting} disabled={!ready} icon={<ImageDown className="size-4" />} onClick={() => void onConfirm()}>
                            {t("canvas.modelNode.exportAngleConfirm")}
                        </Button>
                    </div>
                </div>
            }
            width="min(1180px, 96vw)"
            centered
            destroyOnHidden
            maskClosable={false}
            getContainer={() => document.body}
            // 侧栏保持在弹窗之上，供点选参考背景。
            afterOpenChange={setModalOpen}
            styles={{
                container: { display: "flex", flexDirection: "column", height: "min(820px, calc(100dvh - 40px))", padding: 0, overflow: "hidden", background: theme.node.panel, color: theme.node.text },
                header: { flexShrink: 0, margin: 0, padding: "18px 24px 14px", background: theme.node.panel, borderBottom: "1px solid " + theme.toolbar.border },
                body: { flex: 1, minHeight: 0, overflow: "hidden" },
                footer: { flexShrink: 0, margin: 0, padding: "12px 20px", borderTop: "1px solid " + theme.toolbar.border },
                mask: { left: maskLeft, width: "calc(100% - " + maskLeft + "px)" },
                wrapper: { pointerEvents: "none" },
            }}
            modalRender={(node) => (
                <div
                    className="pointer-events-auto"
                    style={{ "--model-angle-accent": theme.node.activeStroke, "--model-angle-hover": theme.toolbar.itemHover } as CSSProperties}
                    onMouseDown={stopCanvasBubble}
                    onPointerDown={stopCanvasBubble}
                    onDoubleClick={stopCanvasBubble}
                    onClick={stopCanvasBubble}
                    onWheel={stopCanvasBubble}
                    onContextMenu={stopCanvasBubble}
                >
                    {node}
                </div>
            )}
        >
            <div className="grid h-full min-h-0 overflow-y-auto overscroll-contain md:grid-cols-[minmax(0,1fr)_304px] md:overflow-hidden">
                <div className="flex min-h-0 min-w-0 flex-col gap-3 p-4 md:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                            <h3 className="m-0 text-xs font-medium">{t("canvas.modelNode.viewPreview")}</h3>
                            <Tooltip title={t("canvas.modelNode.exportAngleHint")}>
                                <Button type="text" size="small" aria-label={t("canvas.modelNode.viewHelp")} icon={<CircleHelp className="size-3.5" />} />
                            </Tooltip>
                        </div>
                        <div className="flex items-center gap-1">
                            <Button
                                type="text"
                                size="small"
                                disabled={!ready}
                                icon={previewBg === "dark" ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
                                title={t(previewBg === "dark" ? "canvas.modelNode.bgLight" : "canvas.modelNode.bgDark")}
                                onClick={() => setPreviewBg((current) => (current === "dark" ? "light" : "dark"))}
                            >
                                {t(previewBg === "dark" ? "canvas.modelNode.bgDarkShort" : "canvas.modelNode.bgLightShort")}
                            </Button>
                            <Button
                                type="text"
                                size="small"
                                disabled={!ready}
                                icon={<Crosshair className="size-3.5" />}
                                onClick={() => {
                                    const viewer = viewerRef.current;
                                    if (!viewer) return;
                                    if (basePoseRef.current) viewer.applyOffsets(basePoseRef.current, paramsRef.current);
                                    basePoseRef.current = viewer.getPose();
                                    setParams({ ...defaultOffsets, fov: basePoseRef.current.fov });
                                }}
                            >
                                {t("canvas.modelNode.setAsInitialAngle")}
                            </Button>
                        </div>
                    </div>
                    <div
                        ref={stageRef}
                        className={"relative h-[42dvh] min-h-[220px] w-full shrink-0 overflow-hidden rounded-xl md:h-auto md:min-h-0 md:flex-1 " + (ready ? "cursor-grab active:cursor-grabbing " : "") + (dropHover ? "ring-2 ring-sky-400" : "")}
                        style={{ background: refBackground ? theme.canvas.background : previewBgColor }}
                        onPointerDown={startViewDrag}
                        onContextMenu={(event) => event.preventDefault()}
                        onDragEnter={onStageDragOver}
                        onDragOver={onStageDragOver}
                        onDragLeave={() => setDropHover(false)}
                        onDrop={(event) => void onStageDrop(event)}
                    >
                        {refBackground ? (
                            <div className="pointer-events-none absolute overflow-hidden" style={cropStyle(crop)}>
                                <img src={refBackground.url} alt="" draggable={false} className="size-full object-cover" />
                            </div>
                        ) : null}
                        <canvas ref={setCanvasEl} className="pointer-events-none absolute inset-0 h-full w-full" />
                        {ready ? (
                            <>
                                <CropMask crop={crop} />
                                <div className="pointer-events-none absolute border border-sky-400" style={cropStyle(crop)}>
                                    <div data-crop-move className="pointer-events-auto absolute inset-x-0 top-0 h-2.5 cursor-move" onPointerDown={(event) => startCropDrag("move", event)} />
                                    <div data-crop-move className="pointer-events-auto absolute inset-x-0 bottom-0 h-2.5 cursor-move" onPointerDown={(event) => startCropDrag("move", event)} />
                                    <div data-crop-move className="pointer-events-auto absolute inset-y-0 left-0 w-2.5 cursor-move" onPointerDown={(event) => startCropDrag("move", event)} />
                                    <div data-crop-move className="pointer-events-auto absolute inset-y-0 right-0 w-2.5 cursor-move" onPointerDown={(event) => startCropDrag("move", event)} />
                                    <div className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/40" />
                                    <div className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-white/40" />
                                    <div className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-white/40" />
                                    <div className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-white/40" />
                                    {handles.map((handle) => (
                                        <button
                                            key={handle}
                                            type="button"
                                            data-crop-handle={handle}
                                            className="pointer-events-auto absolute size-3 rounded-full border border-black/40 bg-white"
                                            style={handleStyle(handle)}
                                            onPointerDown={(event) => startCropDrag("resize", event, handle)}
                                            aria-label={t("canvas.editors.adjustCrop")}
                                        />
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div className="absolute inset-0 grid place-items-center text-sm" style={{ color: canvasThemes[previewBg].node.muted }} role="status">
                                {loadError ? t("canvas.smartPreview.model3dFailed") : t("canvas.editors.loading")}
                            </div>
                        )}
                        {dropHover ? (
                            <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-sky-500/15 text-sm font-medium">
                                <span className="rounded-md px-3 py-2" style={{ background: theme.node.panel, color: theme.node.text }}>{t("canvas.modelNode.dropBgHint")}</span>
                            </div>
                        ) : null}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px]" style={{ color: theme.node.placeholder }}>
                        <span>{t("canvas.modelNode.cropQuickHint")}</span>
                        <span className="shrink-0 tabular-nums" style={{ color: theme.node.text }}>PNG · {outW} × {outH}</span>
                    </div>
                </div>
                <aside
                    className="min-h-0 min-w-0 space-y-4 border-t p-4 md:overflow-y-auto md:overscroll-contain md:border-l md:border-t-0"
                    style={{ borderColor: theme.toolbar.border, scrollbarWidth: "thin", scrollbarColor: theme.node.stroke + " transparent" }}
                >
                    <section className="space-y-3">
                        <h3 className="m-0 text-xs font-semibold">{t("canvas.modelNode.cameraSettings")}</h3>
                        <fieldset className="m-0 min-w-0 space-y-3 border-0 p-0" disabled={!ready || exporting} aria-label={t("canvas.modelNode.cameraSettings")}>
                            <AngleSlider label={t("canvas.editors.horizontal")} value={params.horizontalAngle} min={-180} max={180} step={0.01} suffix="°" onChange={(value) => update("horizontalAngle", value)} />
                            <AngleSlider label={t("canvas.editors.pitch")} value={params.pitchAngle} min={-90} max={90} step={0.01} suffix="°" onChange={(value) => update("pitchAngle", value)} />
                            <AngleSlider label={t("canvas.editors.distance")} value={params.distanceScale} min={0.4} max={2.5} step={0.01} suffix="×" onChange={(value) => update("distanceScale", value)} />
                            <div className="space-y-1" title={t("canvas.modelNode.perspectiveHint")}>
                                <AngleSlider label={t("canvas.modelNode.perspective")} value={params.fov} min={10} max={150} step={1} suffix="°" onChange={(value) => update("fov", value)} />
                                <p className="m-0 text-[11px]" style={{ color: theme.node.placeholder }}>{t("canvas.modelNode.perspectiveShortHint")}</p>
                            </div>
                        </fieldset>
                        <details className="group">
                            <summary className="flex cursor-pointer list-none items-center justify-between py-1 text-xs [&::-webkit-details-marker]:hidden">
                                {t("canvas.modelNode.framing")}
                                <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
                            </summary>
                            <fieldset className="m-0 min-w-0 space-y-3 border-0 px-0 pb-0 pt-3" disabled={!ready || exporting}>
                                <AngleSlider label={t("canvas.modelNode.panX")} value={params.panX} min={-1} max={1} step={0.01} onChange={(value) => update("panX", value)} />
                                <AngleSlider label={t("canvas.modelNode.panY")} value={params.panY} min={-1} max={1} step={0.01} onChange={(value) => update("panY", value)} />
                                <p className="m-0 text-[11px]" style={{ color: theme.node.placeholder }}>{t("canvas.modelNode.panHint")}</p>
                            </fieldset>
                        </details>
                    </section>
                    <section className="space-y-2.5 border-t pt-4" style={{ borderColor: theme.toolbar.border }}>
                        <div className="flex items-center justify-between gap-2">
                            <h3 className="m-0 text-xs font-semibold">{t("canvas.modelNode.exportRatio")}</h3>
                            <span className="text-[11px] tabular-nums" style={{ color: theme.node.placeholder }}>{formatRatio(outW, outH)}</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1" role="group" aria-label={t("canvas.modelNode.exportRatio")}>
                            {RATIO_OPTIONS.map((option) => {
                                const active = ratioPreset === option.value;
                                const label = option.labelKey === "free" ? t("canvas.editors.free") : option.labelKey === "fixed" ? t("canvas.editors.fixed") : option.label || option.value;
                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        aria-pressed={active}
                                        onClick={() => applyRatioPreset(option.value)}
                                        className="h-8 rounded-md text-xs font-medium tabular-nums transition-colors hover:bg-[var(--model-angle-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1"
                                        style={{ background: active ? theme.toolbar.activeBg : undefined, color: active ? theme.toolbar.activeText : theme.toolbar.item }}
                                    >
                                        {label}
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                    <section className="space-y-2.5 border-t pt-4" style={{ borderColor: theme.toolbar.border }}>
                        <h3 className="m-0 text-xs font-semibold">{t("canvas.modelNode.refBackground")}</h3>
                        <div
                            className={"rounded-lg border p-2.5 " + (refBackground ? "" : "border-dashed")}
                            style={{ borderColor: theme.toolbar.border }}
                            onDragOver={onStageDragOver}
                            onDragLeave={() => setDropHover(false)}
                            onDrop={(event) => void onStageDrop(event)}
                        >
                            {refBackground ? (
                                <div className="flex items-center gap-2.5">
                                    <img src={refBackground.url} alt="" className="size-10 rounded object-cover" draggable={false} />
                                    <div className="min-w-0 flex-1 text-xs tabular-nums" style={{ color: theme.node.placeholder }}>
                                        {refBackground.width} × {refBackground.height}
                                    </div>
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<X className="size-3.5" />}
                                        aria-label={t("canvas.modelNode.removeBackground")}
                                        title={t("canvas.modelNode.removeBackground")}
                                        onClick={() => {
                                            clearRefBackground();
                                            viewerRef.current?.setBackground(previewBgColor);
                                        }}
                                    />
                                </div>
                            ) : (
                                <div className="flex items-center gap-2.5 text-[11px] leading-relaxed" style={{ color: theme.node.placeholder }}>
                                    <ImagePlus className="size-5 shrink-0" strokeWidth={1.5} />
                                    <span>{t("canvas.modelNode.refBackgroundHint")}</span>
                                </div>
                            )}
                        </div>
                        {refBackground ? (
                            <label className="flex items-center justify-between gap-3 text-xs">
                                <span>{t("canvas.modelNode.includeBackground")}</span>
                                <Switch size="small" checked={includeBackground} onChange={setIncludeBackground} aria-label={t("canvas.modelNode.includeBackground")} />
                            </label>
                        ) : null}
                    </section>
                    <details className="group border-t pt-3" style={{ borderColor: theme.toolbar.border }}>
                        <summary className="flex cursor-pointer list-none items-center justify-between py-1 text-xs [&::-webkit-details-marker]:hidden">
                            {t("canvas.modelNode.exportPrompt")}
                            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
                        </summary>
                        <p className="mb-0 mt-2 break-words text-xs leading-relaxed" style={{ color: theme.node.muted }}>{changePrompt}</p>
                    </details>
                </aside>
            </div>
        </Modal>
    );
}

function AngleSlider({
    label,
    value,
    min,
    max,
    step,
    suffix = "",
    onChange,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    suffix?: string;
    onChange: (value: number) => void;
}) {
    const display = value.toFixed(2);
    return (
        <label className="block min-w-0 space-y-1.5 text-xs">
            <span className="flex items-center justify-between gap-3">
                <span>{label}</span>
                <span className="shrink-0 font-medium tabular-nums">{display}{suffix}</span>
            </span>
            <input
                type="range"
                aria-label={label}
                className="block h-3 w-full min-w-0 cursor-pointer disabled:cursor-default"
                style={{ accentColor: "var(--model-angle-accent)" }}
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(event) => onChange(Number(event.target.value))}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function CropMask({ crop }: { crop: CropRect }) {
    return (
        <>
            <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/25" style={{ height: `${crop.y * 100}%` }} />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/25" style={{ height: `${(1 - crop.y - crop.height) * 100}%` }} />
            <div className="pointer-events-none absolute bg-black/25" style={{ left: 0, top: `${crop.y * 100}%`, width: `${crop.x * 100}%`, height: `${crop.height * 100}%` }} />
            <div className="pointer-events-none absolute bg-black/25" style={{ right: 0, top: `${crop.y * 100}%`, width: `${(1 - crop.x - crop.width) * 100}%`, height: `${crop.height * 100}%` }} />
        </>
    );
}

function moveCrop(crop: CropRect, dx: number, dy: number): CropRect {
    return { ...crop, x: clamp(crop.x + dx, 0, 1 - crop.width), y: clamp(crop.y + dy, 0, 1 - crop.height) };
}

function resizeCrop(crop: CropRect, dx: number, dy: number, handle: ResizeHandle, aspectRatio: number | null, box: DOMRect): CropRect {
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
        const scaleDown = Math.min(1, 1 / Math.max(next.width, 0.001), 1 / Math.max(next.height, 0.001));
        next.width *= scaleDown;
        next.height *= scaleDown;
        if (next.width < minCrop || next.height < minCrop) {
            const minimumScale = Math.max(minCrop / Math.max(next.width, 0.001), minCrop / Math.max(next.height, 0.001));
            next.width *= minimumScale;
            next.height *= minimumScale;
        }
        next.width = Math.min(next.width, next.height * normalizedRatio);
        next.height = next.width / normalizedRatio;
    } else {
        next.width = clamp(next.width, minCrop, 1);
        next.height = clamp(next.height, minCrop, 1);
    }
    next.x = clamp(next.x, 0, 1 - next.width);
    next.y = clamp(next.y, 0, 1 - next.height);
    return next;
}

function resolveRatio(preset: string, fixedRatio: number | null) {
    if (preset === "free") return null;
    if (preset === "fixed") return fixedRatio;
    const [width, height] = preset.split(":").map(Number);
    return width > 0 && height > 0 ? width / height : null;
}

function matchRatioPreset(ratio: number) {
    let best: string | null = null;
    let bestErr = Infinity;
    for (const option of RATIO_OPTIONS) {
        if (!option.width || !option.height) continue;
        const err = Math.abs(option.width / option.height - ratio);
        if (err < bestErr) {
            bestErr = err;
            best = option.value;
        }
    }
    return best && bestErr <= 0.02 ? best : "fixed";
}

function fitCropToRatio(crop: CropRect, ratio: number, stage: { width: number; height: number }): CropRect {
    const normalizedRatio = ratio * (stage.height / stage.width);
    let width = crop.width;
    let height = width / normalizedRatio;
    if (height > 1) {
        height = 1;
        width = height * normalizedRatio;
    }
    if (width > 1) {
        width = 1;
        height = width / normalizedRatio;
    }
    return {
        x: clamp(crop.x + (crop.width - width) / 2, 0, 1 - width),
        y: clamp(crop.y + (crop.height - height) / 2, 0, 1 - height),
        width,
        height,
    };
}

function cropStyle(crop: CropRect) {
    return { left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` };
}

function handleStyle(handle: ResizeHandle) {
    const top = handle.includes("n") ? "-6px" : handle.includes("s") ? "calc(100% - 6px)" : "calc(50% - 6px)";
    const left = handle.includes("w") ? "-6px" : handle.includes("e") ? "calc(100% - 6px)" : "calc(50% - 6px)";
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

function loadImageSize(url: string) {
    return new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
        image.onerror = () => reject(new Error("image load failed"));
        image.src = url;
    });
}

function drawCover(context: CanvasRenderingContext2D, image: CanvasImageSource, width: number, height: number, sourceWidth: number, sourceHeight: number) {
    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const drawW = sourceWidth * scale;
    const drawH = sourceHeight * scale;
    context.drawImage(image, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
}

async function cropBlobToRect(blob: Blob, crop: CropRect, longSide: number) {
    const bitmap = await createImageBitmap(blob);
    try {
        const sx = Math.round(crop.x * bitmap.width);
        const sy = Math.round(crop.y * bitmap.height);
        const sw = Math.max(1, Math.round(crop.width * bitmap.width));
        const sh = Math.max(1, Math.round(crop.height * bitmap.height));
        const aspect = sw / sh;
        const outW = aspect >= 1 ? longSide : Math.max(1, Math.round(longSide * aspect));
        const outH = aspect >= 1 ? Math.max(1, Math.round(longSide / aspect)) : longSide;
        const canvas = document.createElement("canvas");
        canvas.width = outW;
        canvas.height = outH;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("canvas");
        context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);
        return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("crop failed"))), "image/png");
        });
    } finally {
        bitmap.close();
    }
}

async function composeWithBackground(modelBlob: Blob, crop: CropRect, longSide: number, backgroundUrl: string) {
    const cropped = await cropBlobToRect(modelBlob, crop, longSide);
    const [modelBmp, bgBmp] = await Promise.all([createImageBitmap(cropped), createImageBitmap(await (await fetch(backgroundUrl)).blob())]);
    try {
        const out = document.createElement("canvas");
        out.width = modelBmp.width;
        out.height = modelBmp.height;
        const outCtx = out.getContext("2d");
        if (!outCtx) throw new Error("canvas");
        drawCover(outCtx, bgBmp, out.width, out.height, bgBmp.width, bgBmp.height);
        outCtx.drawImage(modelBmp, 0, 0);
        return await new Promise<Blob>((resolve, reject) => {
            out.toBlob((result) => (result ? resolve(result) : reject(new Error("compose failed"))), "image/png");
        });
    } finally {
        modelBmp.close();
        bgBmp.close();
    }
}
