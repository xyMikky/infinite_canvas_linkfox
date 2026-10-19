import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Modal, Tooltip } from "antd";
import { ArrowUpRight, Brush, ChevronRight, Circle, CircleHelp, Eraser, Grid3x3, Minus, Redo2, RotateCcw, Save, Square, SquareDashed, Type, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useImageEditorViewport } from "@/components/canvas/use-image-editor-viewport";
import { canvasThemes } from "@/lib/canvas-theme";
import { composePaintedCanvas } from "@/lib/canvas/image-paint-export";
import { createLocalEditPayload, cropToPixelRect, defaultCropForRatio, DEFAULT_LOCAL_EDIT_RATIO, fitCropToRatio, formatRatio, LOCAL_EDIT_RATIO_PRESETS, moveCrop, resizeCrop, resolveRatio, type CanvasImageMaskEditPayload, type CropRect, type RatioPreset, type ResizeHandle } from "@/lib/canvas/local-edit-selection";
import { readImageMeta } from "@/lib/image-utils";
import { CANVAS_OVERLAY_MODAL_Z_INDEX } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";

type Point = { x: number; y: number };
type PaintTool = "brush" | "erase" | "mosaic" | "line" | "arrow" | "circle" | "rect" | "text" | "select";
type FreeStroke = { kind: "free"; mode: "paint" | "erase" | "mosaic"; size: number; color: string; opacity: number; points: Point[] };
type ShapeStroke = { kind: "arrow" | "circle" | "rect" | "line"; size: number; color: string; opacity: number; filled?: boolean; from: Point; to: Point };
type TextStroke = { kind: "text"; text: string; x: number; y: number; size: number; color: string; opacity: number };
type PaintStroke = FreeStroke | ShapeStroke | TextStroke;

const defaultBrushPercent = 3;
const defaultTextSize = 80;
const defaultBrushColor = "#ef4444";
const brushSpacingRatio = 0.28;
const paintColors = ["#ef4444", "#f97316", "#facc15", "#22c55e", "#3b82f6", "#a855f7", "#ffffff", "#000000"];

type PaintDialogProps = {
    dataUrl: string;
    open: boolean;
    onClose: () => void;
} & ({
    mode?: "paint";
    layerOnly?: boolean;
    onConfirm: (paintedDataUrl: string) => void | Promise<void>;
} | {
    mode: "local-edit";
    onConfirm: (payload: CanvasImageMaskEditPayload) => void | Promise<void>;
    canRestore?: boolean;
    onRestore?: () => void;
});

export function CanvasNodePaintDialog(props: PaintDialogProps) {
    const { dataUrl, open, onClose } = props;
    const localEdit = props.mode === "local-edit";
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const paintCanvasRef = useRef<HTMLCanvasElement>(null);
    const draftCanvasRef = useRef<HTMLCanvasElement>(null);
    const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const strokeBaseRef = useRef<HTMLCanvasElement | null>(null);
    const brushPreviewRef = useRef<HTMLDivElement>(null);
    const brushSizeLabelRef = useRef<HTMLSpanElement>(null);
    const brushResizeRef = useRef<{ pointerId: number; startX: number; startPercent: number; percentPerPixel: number; target: HTMLDivElement } | null>(null);
    const drawingRef = useRef<{ active: boolean; stroke: PaintStroke | null; startClient?: Point; mosaicCells?: Set<string> }>({ active: false, stroke: null });
    const historyRef = useRef<PaintStroke[]>([]);
    const redoRef = useRef<PaintStroke[]>([]);
    const [image, setImage] = useState<{ width: number; height: number } | null>(null);
    const [tool, setTool] = useState<PaintTool>("brush");
    const [circleFilled, setCircleFilled] = useState(false);
    const [rectFilled, setRectFilled] = useState(false);
    const [brushPercent, setBrushPercent] = useState(defaultBrushPercent);
    const [textSize, setTextSize] = useState(defaultTextSize);
    const [brushColor, setBrushColor] = useState(defaultBrushColor);
    const [brushOpacity, setBrushOpacity] = useState(1);
    const [historySize, setHistorySize] = useState(0);
    const [redoSize, setRedoSize] = useState(0);
    const [applying, setApplying] = useState(false);
    const [crop, setCrop] = useState<CropRect>(() => defaultCropForRatio(null));
    const [ratioPreset, setRatioPreset] = useState<RatioPreset>(DEFAULT_LOCAL_EDIT_RATIO);
    const [error, setError] = useState("");
    const cropDragRef = useRef<AbortController | null>(null);
    const [textDraft, setTextDraft] = useState<{ x: number; y: number; value: string } | null>(null);
    const textDraftRef = useRef(textDraft);
    const textInputRef = useRef<HTMLTextAreaElement>(null);
    const viewport = useImageEditorViewport(image, open);
    const boxRef = viewport.stageRef;
    const sessionKeyRef = useRef<string | null>(null);
    textDraftRef.current = textDraft;
    const shapeTools = tool === "arrow" || tool === "circle" || tool === "rect" || tool === "line";
    const brushActive = tool !== "text" && tool !== "select";
    const activeRatio = resolveRatio(ratioPreset, image);
    const cropSize = localEdit && image ? cropToPixelRect(crop, image, activeRatio) : null;
    const paintClip = localEdit ? `inset(${crop.y * 100}% ${(1 - crop.x - crop.width) * 100}% ${(1 - crop.y - crop.height) * 100}% ${crop.x * 100}%)` : undefined;
    const imageShortSide = image ? Math.min(image.width, image.height) : 0;
    const brushSize = Math.max(1, Math.round(imageShortSide * brushPercent / 100));
    const sizeLabel = t(tool === "text" ? "canvas.editors.fontSize" : tool === "mosaic" ? "canvas.editors.mosaicSize" : shapeTools ? "canvas.editors.strokeWidth" : "canvas.editors.brushSize");
    const sizeMax = tool === "text" ? 96 : 25;
    const sizeMin = tool === "text" ? 12 : 0.1;
    const sizeValue = tool === "text" ? textSize : brushPercent;
    const setSizeValue = tool === "text" ? setTextSize : setBrushPercent;

    const replayPaint = useCallback((strokes: PaintStroke[]) => {
        const canvas = paintCanvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        context.clearRect(0, 0, canvas.width, canvas.height);
        for (const stroke of strokes) drawStroke(context, stroke, sourceCanvasRef.current);
        const draft = draftCanvasRef.current?.getContext("2d");
        if (draft && draftCanvasRef.current) draft.clearRect(0, 0, draftCanvasRef.current.width, draftCanvasRef.current.height);
    }, []);

    useEffect(() => {
        if (!open) {
            sessionKeyRef.current = null;
            return;
        }
        if (sessionKeyRef.current === dataUrl) return;
        sessionKeyRef.current = dataUrl;
        setTool(localEdit ? "select" : "brush");
        setCircleFilled(false);
        setRectFilled(false);
        setBrushPercent(defaultBrushPercent);
        setTextSize(defaultTextSize);
        setBrushColor(defaultBrushColor);
        setBrushOpacity(1);
        setRatioPreset(DEFAULT_LOCAL_EDIT_RATIO);
        setError("");
        setHistorySize(0);
        setRedoSize(0);
        setTextDraft(null);
        historyRef.current = [];
        redoRef.current = [];
        drawingRef.current = { active: false, stroke: null };
        setImage(null);
        sourceCanvasRef.current = null;
        let cancelled = false;
        void (async () => {
            const meta = await readImageMeta(dataUrl);
            if (cancelled) return;
            const sourceImage = await loadImage(dataUrl);
            if (cancelled) return;
            const source = document.createElement("canvas");
            source.width = meta.width;
            source.height = meta.height;
            const srcCtx = source.getContext("2d", { willReadFrequently: true });
            srcCtx?.drawImage(sourceImage, 0, 0);
            sourceCanvasRef.current = source;
            setImage(meta);
            setCrop(defaultCropForRatio(meta));
            requestAnimationFrame(() => {
                if (cancelled) return;
                clearCanvas(paintCanvasRef.current);
                clearCanvas(draftCanvasRef.current);
            });
        })().catch(() => { if (!cancelled) setError(t("canvas.editors.paintLoadFailed")); });
        return () => { cancelled = true; sessionKeyRef.current = null; cropDragRef.current?.abort(); };
    }, [dataUrl, open, localEdit]);

    useEffect(() => {
        const canvas = paintCanvasRef.current;
        const draft = draftCanvasRef.current;
        if (!image || !canvas || !draft) return;
        if (canvas.width !== image.width) canvas.width = image.width;
        if (canvas.height !== image.height) canvas.height = image.height;
        if (draft.width !== image.width) draft.width = image.width;
        if (draft.height !== image.height) draft.height = image.height;
        replayPaint(historyRef.current);
    }, [image, replayPaint]);

    const hideBrushPreview = useCallback(() => {
        if (brushPreviewRef.current) brushPreviewRef.current.style.display = "none";
    }, []);

    const finishBrushResize = useCallback(() => {
        const resizing = brushResizeRef.current;
        brushResizeRef.current = null;
        if (resizing?.target.hasPointerCapture(resizing.pointerId)) resizing.target.releasePointerCapture(resizing.pointerId);
        if (brushSizeLabelRef.current) brushSizeLabelRef.current.style.display = "none";
        hideBrushPreview();
    }, [hideBrushPreview]);

    useEffect(() => {
        if (!open) return;
        window.addEventListener("blur", finishBrushResize);
        return () => {
            window.removeEventListener("blur", finishBrushResize);
            finishBrushResize();
        };
    }, [dataUrl, finishBrushResize, open]);

    useEffect(() => { finishBrushResize(); }, [finishBrushResize, tool, viewport.spacePressed]);

    // Hover only moves this overlay; it does not rerender the editor or touch stroke history.
    const updateBrushPreview = (point: Point, erasing = drawingRef.current.stroke?.kind === "free" && drawingRef.current.stroke.mode === "erase") => {
        const preview = brushPreviewRef.current;
        if (!preview || !image || viewport.spacePressed || viewport.isPanning) return;
        if (!brushActive && !erasing) { hideBrushPreview(); return; }
        if (point.x < 0 || point.y < 0 || point.x > image.width || point.y > image.height) {
            hideBrushPreview();
            return;
        }
        preview.style.left = `${point.x / image.width * 100}%`;
        preview.style.top = `${point.y / image.height * 100}%`;
        preview.style.display = "block";
        preview.style.background = tool === "brush" && !erasing ? withAlpha(brushColor, brushOpacity * 0.2) : "transparent";
    };

    const startViewportPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 1 || tool === "select") {
            viewport.panHandlers.onPointerDownCapture(event);
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const canvas = draftCanvasRef.current;
        if (!canvas || !image || !brushActive || viewport.spacePressed || drawingRef.current.active) return;
        const displayedShortSide = imageShortSide * canvas.getBoundingClientRect().width / image.width;
        if (!displayedShortSide) return;
        const point = readCanvasPoint(canvas, event.clientX, event.clientY);
        brushResizeRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startPercent: brushPercent,
            percentPerPixel: 100 / displayedShortSide,
            target: event.currentTarget,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        updateBrushPreview({ x: Math.min(image.width, Math.max(0, point.x)), y: Math.min(image.height, Math.max(0, point.y)) });
        if (brushSizeLabelRef.current) brushSizeLabelRef.current.style.display = "block";
    };

    const moveViewportPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
        const resizing = brushResizeRef.current;
        if (!resizing || resizing.pointerId !== event.pointerId) {
            viewport.panHandlers.onPointerMoveCapture(event);
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (!(event.buttons & 4)) {
            finishBrushResize();
            return;
        }
        const percent = resizing.startPercent + (event.clientX - resizing.startX) * resizing.percentPerPixel;
        setBrushPercent(Math.min(sizeMax, Math.max(sizeMin, Math.round(percent * 10) / 10)));
    };

    const stopViewportPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (brushResizeRef.current?.pointerId !== event.pointerId) {
            viewport.panHandlers.onPointerUpCapture(event);
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        finishBrushResize();
        if (event.type === "pointerup" && draftCanvasRef.current) updateBrushPreview(readCanvasPoint(draftCanvasRef.current, event.clientX, event.clientY));
    };

    const commitStroke = useCallback(
        (stroke: PaintStroke | null) => {
            drawingRef.current = { active: false, stroke: null };
            clearCanvas(draftCanvasRef.current);
            if (!stroke) return;
            if (stroke.kind === "free" && stroke.points.length < 1) return;
            if ((stroke.kind === "arrow" || stroke.kind === "circle" || stroke.kind === "rect" || stroke.kind === "line") && pointsEqual(stroke.from, stroke.to)) return;
            if (stroke.kind === "text" && !stroke.text.trim()) return;
            historyRef.current.push(stroke);
            if (historyRef.current.length > 60) historyRef.current.shift();
            setHistorySize(historyRef.current.length);
            redoRef.current = [];
            setRedoSize(0);
            replayPaint(historyRef.current);
        },
        [replayPaint],
    );

    const flushTextDraft = useCallback(() => {
        const current = textDraftRef.current;
        if (!current) return;
        const text = current.value.trim();
        setTextDraft(null);
        if (!text) return;
        commitStroke({
            kind: "text",
            text,
            x: current.x,
            y: current.y,
            size: textSize,
            color: brushColor,
            opacity: brushOpacity,
        });
    }, [brushColor, brushOpacity, commitStroke, textSize]);

    const startDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const rightErase = event.button === 2;
        if ((event.button !== 0 && !rightErase) || viewport.spacePressed || !image || brushResizeRef.current || tool === "select" || applying) return;
        const drawTool = rightErase ? "erase" : tool;
        event.preventDefault();
        event.stopPropagation();
        const point = readCanvasPoint(event.currentTarget, event.clientX, event.clientY);
        if (localEdit && (point.x < crop.x * image.width || point.x > (crop.x + crop.width) * image.width || point.y < crop.y * image.height || point.y > (crop.y + crop.height) * image.height)) return;
        updateBrushPreview(point, rightErase || tool === "erase");
        if (drawTool === "text") {
            flushTextDraft();
            setTextDraft({ x: point.x, y: point.y, value: "" });
            return;
        }
        if (textDraftRef.current) flushTextDraft();
        event.currentTarget.setPointerCapture(event.pointerId);
        if (rightErase) event.currentTarget.style.cursor = "none";
        if (drawTool === "brush" || drawTool === "erase" || drawTool === "mosaic") {
            const stroke: FreeStroke = {
                kind: "free",
                mode: drawTool === "erase" ? "erase" : drawTool === "mosaic" ? "mosaic" : "paint",
                size: brushSize,
                color: brushColor,
                opacity: brushOpacity,
                points: [point],
            };
            drawingRef.current = { active: true, stroke, startClient: { x: event.clientX, y: event.clientY }, mosaicCells: new Set() };
            const context = paintCanvasRef.current?.getContext("2d");
            if (context) {
                if (stroke.mode === "mosaic") drawMosaicDot(context, sourceCanvasRef.current, point, stroke.size, stroke.opacity, drawingRef.current.mosaicCells);
                else {
                    const base = strokeBaseRef.current ||= document.createElement("canvas");
                    base.width = context.canvas.width;
                    base.height = context.canvas.height;
                    base.getContext("2d")?.drawImage(context.canvas, 0, 0);
                    drawStroke(context, stroke, sourceCanvasRef.current);
                }
            }
            return;
        }
        drawingRef.current = {
            active: true,
            stroke: {
                kind: drawTool,
                size: brushSize,
                color: brushColor,
                opacity: brushOpacity,
                filled: drawTool === "circle" ? circleFilled : drawTool === "rect" ? rectFilled : undefined,
                from: point,
                to: point,
            },
            startClient: { x: event.clientX, y: event.clientY },
        };
    };

    const moveDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const point = readCanvasPoint(event.currentTarget, event.clientX, event.clientY);
        updateBrushPreview(point);
        if (!drawingRef.current.active || !drawingRef.current.stroke) return;
        event.preventDefault();
        const stroke = drawingRef.current.stroke;
        if (stroke.kind === "free") {
            const last = stroke.points.at(-1);
            if (last && pointsEqual(last, point)) return;
            stroke.points.push(point);
            const context = paintCanvasRef.current?.getContext("2d");
            if (context && last) {
                if (stroke.mode === "mosaic") drawMosaicSegment(context, sourceCanvasRef.current, last, point, stroke.size, stroke.opacity, drawingRef.current.mosaicCells);
                else {
                    const base = strokeBaseRef.current;
                    if (!base) return;
                    // 每帧从落笔前的图层重画整笔，不能把半透明采样点反复叠在上一帧上。
                    context.save();
                    context.globalCompositeOperation = "copy";
                    context.drawImage(base, 0, 0);
                    context.restore();
                    drawStroke(context, stroke, sourceCanvasRef.current);
                }
            }
            return;
        }
        if (stroke.kind === "text") return;
        stroke.to = point;
        const draft = draftCanvasRef.current;
        const context = draft?.getContext("2d");
        if (!draft || !context) return;
        context.clearRect(0, 0, draft.width, draft.height);
        drawStroke(context, stroke, sourceCanvasRef.current);
    };

    const stopDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
        event.currentTarget.style.cursor = "";
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        commitStroke(drawingRef.current.stroke);
        updateBrushPreview(readCanvasPoint(event.currentTarget, event.clientX, event.clientY));
    };

    const undoPaint = useCallback(() => {
        if (drawingRef.current.active) {
            drawingRef.current = { active: false, stroke: null };
            clearCanvas(draftCanvasRef.current);
            replayPaint(historyRef.current);
            return;
        }
        if (!historyRef.current.length) return;
        const stroke = historyRef.current.pop();
        if (stroke) redoRef.current.push(stroke);
        setHistorySize(historyRef.current.length);
        setRedoSize(redoRef.current.length);
        replayPaint(historyRef.current);
    }, [replayPaint]);

    const redoPaint = useCallback(() => {
        if (drawingRef.current.active) {
            drawingRef.current = { active: false, stroke: null };
            clearCanvas(draftCanvasRef.current);
            replayPaint(historyRef.current);
        }
        if (!redoRef.current.length) return;
        const stroke = redoRef.current.pop();
        if (stroke) historyRef.current.push(stroke);
        setHistorySize(historyRef.current.length);
        setRedoSize(redoRef.current.length);
        replayPaint(historyRef.current);
    }, [replayPaint]);

    const resetPaint = () => {
        cropDragRef.current?.abort();
        finishBrushResize();
        historyRef.current = [];
        redoRef.current = [];
        setHistorySize(0);
        setRedoSize(0);
        setTextDraft(null);
        drawingRef.current = { active: false, stroke: null };
        replayPaint([]);
        if (localEdit) {
            setRatioPreset(DEFAULT_LOCAL_EDIT_RATIO);
            setCrop(defaultCropForRatio(image));
        }
        setError("");
    };

    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            const input = target?.closest("input");
            const isRange = input instanceof HTMLInputElement && input.type === "range";
            if (!isRange && target?.closest("input,textarea,[contenteditable='true']")) return;
            const key = event.key.toLowerCase();
            const isUndo = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && key === "z";
            const isRedo = (event.metaKey || event.ctrlKey) && !event.altKey && ((event.shiftKey && key === "z") || key === "y");
            if (!isUndo && !isRedo) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (isRedo) redoPaint();
            else undoPaint();
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [open, redoPaint, undoPaint]);

    useEffect(() => {
        if (!open) return;
        const endStroke = () => {
            if (!drawingRef.current.active) return;
            commitStroke(drawingRef.current.stroke);
        };
        window.addEventListener("pointerup", endStroke);
        window.addEventListener("pointercancel", endStroke);
        return () => {
            window.removeEventListener("pointerup", endStroke);
            window.removeEventListener("pointercancel", endStroke);
        };
    }, [commitStroke, open]);

    useEffect(() => {
        if (!textDraft) return;
        const node = textInputRef.current;
        if (!node) return;
        node.focus();
        node.selectionStart = node.value.length;
        node.selectionEnd = node.value.length;
    }, [textDraft?.x, textDraft?.y]);

    useEffect(() => {
        if (tool === "text") return;
        if (textDraftRef.current) flushTextDraft();
    }, [flushTextDraft, tool]);

    const tools: { id: PaintTool; label: string; Icon: typeof Brush; filled?: boolean }[] = [
        { id: "brush", label: t("canvas.editors.brush"), Icon: Brush },
        { id: "erase", label: t("canvas.editors.erase"), Icon: Eraser },
        { id: "mosaic", label: t("canvas.editors.paintMosaic"), Icon: Grid3x3 },
        { id: "line", label: t("canvas.editors.paintLine"), Icon: Minus },
        { id: "arrow", label: t("canvas.editors.paintArrow"), Icon: ArrowUpRight },
        {
            id: "circle",
            label: t("canvas.editors.paintCircle"),
            Icon: Circle,
            filled: circleFilled,
        },
        {
            id: "rect",
            label: t("canvas.editors.paintRect"),
            Icon: Square,
            filled: rectFilled,
        },
        { id: "text", label: t("canvas.editors.paintText"), Icon: Type },
    ];

    const selectTool = (id: PaintTool) => {
        cropDragRef.current?.abort();
        if (id === "circle" && tool === "circle") {
            setCircleFilled((current) => !current);
            return;
        }
        if (id === "rect" && tool === "rect") {
            setRectFilled((current) => !current);
            return;
        }
        setTool(id);
    };

    const startCropDrag = (event: ReactPointerEvent, handle?: ResizeHandle) => {
        if (event.button !== 0 || tool !== "select" || viewport.spacePressed || applying) return;
        const stage = boxRef.current?.getBoundingClientRect();
        if (!stage) return;
        event.preventDefault();
        event.stopPropagation();
        cropDragRef.current?.abort();
        const controller = new AbortController();
        cropDragRef.current = controller;
        const start = { x: event.clientX, y: event.clientY, crop };
        const move = (next: PointerEvent) => {
            const dx = (next.clientX - start.x) / stage.width;
            const dy = (next.clientY - start.y) / stage.height;
            setCrop(handle ? resizeCrop(start.crop, dx, dy, handle, activeRatio, stage) : moveCrop(start.crop, dx, dy));
        };
        document.addEventListener("pointermove", move, { signal: controller.signal });
        document.addEventListener("pointerup", () => controller.abort(), { signal: controller.signal });
        document.addEventListener("pointercancel", () => controller.abort(), { signal: controller.signal });
        window.addEventListener("blur", () => controller.abort(), { signal: controller.signal });
    };

    const submit = async () => {
        const source = sourceCanvasRef.current;
        const paint = paintCanvasRef.current;
        if (!image || !source || !paint || applying) return;
        if (localEdit && (!cropSize || cropSize.width < 8 || cropSize.height < 8)) {
            setError(t("canvas.editors.maskSelectRequired"));
            return;
        }
        flushTextDraft();
        if (drawingRef.current.active) commitStroke(drawingRef.current.stroke);
        setApplying(true);
        setError("");
        try {
            // 合成与发起回调均发生在首个 await 前，项目保存 scope 可立即绑定原项目。
            if (props.mode === "local-edit") {
                const payload = createLocalEditPayload("", crop, image, ratioPreset);
                payload.paintedDataUrl = composePaintedCanvas(source, paint, payload.selectionNorm);
                await props.onConfirm(payload);
            } else {
                await props.onConfirm(props.layerOnly ? paint.toDataURL("image/png") : composePaintedCanvas(source, paint));
            }
        } catch {
            if (sessionKeyRef.current === dataUrl) setError(t("canvas.editors.paintSaveFailed"));
        } finally {
            if (sessionKeyRef.current === dataUrl) setApplying(false);
        }
    };

    return (
        <Modal
            title={
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pr-8">
                    <h2 className="m-0 text-base font-semibold">{t(localEdit ? "canvas.editors.maskTitle" : "canvas.editors.paintTitle")}</h2>
                    <span className="text-xs font-normal tabular-nums" style={{ color: theme.node.placeholder }}>
                        {image ? `${image.width} × ${image.height} px` : t("canvas.editors.loading")}
                    </span>
                </div>
            }
            open={open && Boolean(dataUrl)}
            onCancel={onClose}
            footer={
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <Button type="text" icon={<RotateCcw className="size-3.5" />} onClick={resetPaint} disabled={applying || (!localEdit && !historySize && !textDraft)}>
                            {t("canvas.editors.reset")}
                        </Button>
                        {props.mode === "local-edit" && props.canRestore ? <Button type="text" icon={<Undo2 className="size-3.5" />} disabled={applying} onClick={props.onRestore}>{t("canvas.editors.restorePreprocess")}</Button> : null}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button type="text" onClick={() => { setTextDraft(null); onClose(); }}>
                            {t("canvas.editors.cancel")}
                        </Button>
                        <Button
                            type="primary"
                            icon={<Save className="size-4" />}
                            loading={applying}
                            disabled={!image}
                            onClick={() => void submit()}
                        >
                            {t(localEdit ? "canvas.editors.savePreprocess" : "canvas.editors.confirmPaint")}
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
            modalRender={(node) => (
                <div
                    data-canvas-shortcuts-ignore
                    data-canvas-no-zoom
                    style={{ "--paint-accent": theme.node.activeStroke, "--paint-hover": theme.toolbar.itemHover, "--paint-border": theme.toolbar.border } as CSSProperties}
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                >
                    {node}
                </div>
            )}
        >
            <div className="grid h-full min-h-0 overflow-y-auto overscroll-contain md:grid-cols-[minmax(0,1fr)_280px] md:overflow-hidden">
                <div className="flex min-h-0 min-w-0 flex-col gap-3 p-4 md:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <div className="flex items-center gap-1">
                            <h3 className="m-0 text-xs font-medium">{t(localEdit ? "canvas.editors.maskPreview" : "canvas.editors.paintPreview")}</h3>
                            <Tooltip title={t(localEdit ? "canvas.editors.maskHint" : "canvas.editors.paintHint")}>
                                <Button type="text" size="small" aria-label={t("canvas.editors.paintHelp")} icon={<CircleHelp className="size-3.5" />} />
                            </Tooltip>
                        </div>
                        <div className="flex items-center gap-0.5">
                            <Tooltip title={t("canvas.editors.undoMaskTitle")}>
                                <Button type="text" size="small" aria-label={t("canvas.editors.undoMask")} icon={<Undo2 className="size-3.5" />} disabled={!historySize} onClick={undoPaint} />
                            </Tooltip>
                            <Tooltip title={t("canvas.editors.redoMaskTitle")}>
                                <Button type="text" size="small" aria-label={t("canvas.editors.redoMask")} icon={<Redo2 className="size-3.5" />} disabled={!redoSize} onClick={redoPaint} />
                            </Tooltip>
                            <span className="mx-2 h-3 border-l" style={{ borderColor: theme.toolbar.border }} />
                            <Button type="text" size="small" title={t("canvas.editors.zoomOut")} aria-label={t("canvas.editors.zoomOut")} icon={<ZoomOut className="size-3.5" />} disabled={!viewport.canZoomOut} onClick={viewport.zoomOut} />
                            <button
                                type="button"
                                title={t("canvas.editors.paintFit")}
                                aria-label={t("canvas.editors.paintFit")}
                                className="h-7 min-w-12 rounded-md px-1 text-center text-xs tabular-nums hover:bg-[var(--paint-hover)] focus-visible:outline-2 focus-visible:outline-offset-2"
                                onClick={viewport.resetZoom}
                            >
                                {Math.round(viewport.zoom * 100)}%
                            </button>
                            <Button type="text" size="small" title={t("canvas.editors.zoomIn")} aria-label={t("canvas.editors.zoomIn")} icon={<ZoomIn className="size-3.5" />} disabled={!viewport.canZoomIn} onClick={viewport.zoomIn} />
                        </div>
                    </div>
                    <div
                        ref={viewport.viewportRef}
                        {...viewport.panHandlers}
                        onPointerDownCapture={startViewportPointer}
                        onPointerMoveCapture={moveViewportPointer}
                        onPointerUpCapture={stopViewportPointer}
                        onPointerCancelCapture={stopViewportPointer}
                        onLostPointerCapture={(event) => {
                            if (brushResizeRef.current?.pointerId === event.pointerId) finishBrushResize();
                        }}
                        onMouseDown={(event) => { if (event.button === 1) event.preventDefault(); }}
                        className={`relative h-[44dvh] min-h-[240px] w-full shrink-0 rounded-xl md:h-auto md:min-h-0 md:flex-1 ${viewport.scrollClassName} ${viewport.isPanning ? "cursor-grabbing" : viewport.spacePressed ? "cursor-grab" : ""}`}
                        style={{ background: theme.canvas.background, scrollbarWidth: "thin", scrollbarColor: theme.toolbar.border + " transparent" }}
                    >
                        <div className="relative" style={viewport.contentStyle}>
                            <div ref={boxRef} className={`absolute isolate rounded-sm select-none ${localEdit ? "overflow-visible" : "overflow-hidden"}`} style={viewport.stageStyle}>
                                {image ? <img src={dataUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full select-none" draggable={false} /> : null}
                                <canvas ref={paintCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full" style={{ clipPath: paintClip }} />
                                <canvas
                                    ref={draftCanvasRef}
                                    className={`absolute inset-0 h-full w-full touch-none ${viewport.spacePressed || tool === "select" || applying ? "pointer-events-none" : tool === "text" ? "cursor-text" : image ? "cursor-none" : "cursor-crosshair"}`}
                                    style={{ clipPath: paintClip }}
                                    onPointerDown={startDraw}
                                    onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
                                    onPointerMove={moveDraw}
                                    onPointerUp={stopDraw}
                                    onPointerCancel={stopDraw}
                                    onPointerEnter={(event) => updateBrushPreview(readCanvasPoint(event.currentTarget, event.clientX, event.clientY))}
                                    onPointerLeave={() => { if (!brushResizeRef.current) hideBrushPreview(); }}
                                />
                                {localEdit && image ? <>
                                    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-sm">
                                        <div className="absolute" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%`, boxShadow: `0 0 0 9999px color-mix(in srgb, ${theme.canvas.background} 65%, transparent)` }} />
                                    </div>
                                    <div
                                        className={`absolute border ${tool === "select" && !viewport.spacePressed && !applying ? "cursor-move touch-none" : "pointer-events-none"}`}
                                        style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%`, borderColor: theme.node.activeStroke }}
                                        onPointerDown={(event) => startCropDrag(event)}
                                    >
                                        {tool === "select" ? <>
                                            {["top-1/3", "top-2/3"].map((position) => <div key={position} className={`pointer-events-none absolute inset-x-0 border-t opacity-30 ${position}`} style={{ borderColor: theme.node.activeStroke }} />)}
                                            {["left-1/3", "left-2/3"].map((position) => <div key={position} className={`pointer-events-none absolute inset-y-0 border-l opacity-30 ${position}`} style={{ borderColor: theme.node.activeStroke }} />)}
                                            {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map((handle) => (
                                                <button key={handle} type="button" aria-label={t("canvas.editors.adjustCrop")} className="absolute flex size-5 touch-none items-center justify-center"
                                                    style={{ top: handle.includes("n") ? "-10px" : handle.includes("s") ? "calc(100% - 10px)" : "calc(50% - 10px)", left: handle.includes("w") ? "-10px" : handle.includes("e") ? "calc(100% - 10px)" : "calc(50% - 10px)", cursor: `${handle}-resize` }}
                                                    onPointerDown={(event) => startCropDrag(event, handle)}>
                                                    <span className="size-2 rounded-[2px] border" style={{ background: theme.node.panel, borderColor: theme.node.activeStroke }} />
                                                </button>
                                            ))}
                                        </> : null}
                                    </div>
                                </> : null}
                                {textDraft && image ? (
                                    <div className="pointer-events-none absolute inset-0" style={{ clipPath: paintClip }}>
                                    <textarea
                                        ref={textInputRef}
                                        value={textDraft.value}
                                        placeholder={t("canvas.editors.paintTextPlaceholder")}
                                        rows={1}
                                        className="pointer-events-auto absolute z-10 max-w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none"
                                        style={{
                                            left: `${(textDraft.x / image.width) * 100}%`,
                                            top: `${(textDraft.y / image.height) * 100}%`,
                                            width: `${Math.max(0.12, 1 - textDraft.x / image.width) * 100}%`,
                                            fontSize: Math.max(12, textSize) * (viewport.imageScale || 1),
                                            lineHeight: 1.15,
                                            fontWeight: 600,
                                            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
                                            color: brushColor,
                                            opacity: brushOpacity,
                                            caretColor: brushColor,
                                            textShadow: "0 0 2px rgba(0,0,0,.35)",
                                        }}
                                        onChange={(event) => {
                                            const value = event.target.value;
                                            setTextDraft((current) => (current ? { ...current, value } : current));
                                            event.target.style.height = "auto";
                                            event.target.style.height = `${event.target.scrollHeight}px`;
                                        }}
                                        onKeyDown={(event) => {
                                            event.stopPropagation();
                                            if (event.key === "Enter" && !event.shiftKey) {
                                                event.preventDefault();
                                                flushTextDraft();
                                            } else if (event.key === "Escape") {
                                                event.preventDefault();
                                                setTextDraft(null);
                                            }
                                        }}
                                        onPointerDown={(event) => event.stopPropagation()}
                                    />
                                    </div>
                                ) : null}
                                <div
                                    ref={brushPreviewRef}
                                    aria-hidden="true"
                                    className="pointer-events-none absolute z-20 rounded-full"
                                    style={{
                                        display: "none",
                                        width: image ? `${brushSize / image.width * 100}%` : 0,
                                        height: image ? `${brushSize / image.height * 100}%` : 0,
                                        transform: "translate(-50%, -50%)",
                                        outline: "1px solid #fff",
                                        boxShadow: "0 0 0 2px rgba(0,0,0,.75)",
                                        background: tool === "brush" ? withAlpha(brushColor, brushOpacity * 0.2) : undefined,
                                    }}
                                >
                                    <span
                                        ref={brushSizeLabelRef}
                                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-1 text-[11px] tabular-nums"
                                        style={{ display: "none", background: theme.node.panel, color: theme.node.text }}
                                    >
                                        {brushPercent}% · {brushSize} px
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <p className="m-0 shrink-0 text-[11px] leading-relaxed" style={{ color: theme.node.placeholder }}>
                        {t(localEdit && tool === "select" ? "canvas.editors.maskSelectionHint" : "canvas.editors.paintQuickHint")}
                    </p>
                    {error ? <p className="m-0 text-xs" role="alert" style={{ color: theme.node.text }}>{error}</p> : null}
                </div>

                <aside
                    className="min-h-0 space-y-5 border-t border-[var(--paint-border)] p-4 md:overflow-y-auto md:overscroll-contain md:border-l md:border-t-0 md:p-5"
                    style={{ scrollbarWidth: "thin", scrollbarColor: theme.toolbar.border + " transparent" }}
                >
                    {localEdit ? <section className="space-y-2">
                        <button type="button" aria-pressed={tool === "select"} disabled={applying} onClick={() => selectTool("select")}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-xs hover:bg-[var(--paint-hover)] focus-visible:outline-2 focus-visible:outline-offset-2"
                            style={tool === "select" ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : undefined}>
                            <SquareDashed className="size-4" />{t("canvas.editors.boxSelect")}
                            <span className="ml-auto text-[11px] tabular-nums" style={{ color: theme.node.placeholder }}>{cropSize ? `${cropSize.width} × ${cropSize.height} px` : "—"}</span>
                        </button>
                    </section> : null}
                    <section className="space-y-3">
                        <h3 className="m-0 text-xs font-semibold">{t("canvas.editors.paintTools")}</h3>
                        <div className="grid grid-cols-4 gap-1">
                            {tools.map(({ id, label, Icon, filled }) => (
                                <button
                                    key={id}
                                    type="button"
                                    title={label}
                                    aria-label={label}
                                    aria-pressed={tool === id}
                                    disabled={applying}
                                    onClick={() => selectTool(id)}
                                    className="flex min-h-14 flex-col items-center justify-center gap-1.5 rounded-lg px-1 py-2 text-[11px] leading-tight hover:bg-[var(--paint-hover)] focus-visible:outline-2 focus-visible:outline-offset-2"
                                    style={tool === id ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : { color: theme.toolbar.item }}
                                >
                                    <Icon className="size-[18px]" strokeWidth={1.8} fill={filled ? "currentColor" : "none"} />
                                    <span>{label}</span>
                                </button>
                            ))}
                        </div>
                    </section>

                    {localEdit && tool === "select" ? <section className="space-y-3 border-t border-[var(--paint-border)] pt-4">
                        <h3 className="m-0 text-xs font-semibold">{t("canvas.editors.maskSelectionRatio")}</h3>
                        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={t("canvas.editors.maskSelectionRatio")}>
                            {LOCAL_EDIT_RATIO_PRESETS.map((preset) => {
                                const ratio = resolveRatio(preset, image);
                                const label = preset === "auto" ? t("canvas.editors.free") : preset === "original" ? t("canvas.editors.originalMode") : preset;
                                return <button key={preset} type="button" aria-pressed={ratioPreset === preset} disabled={applying || !image}
                                    className="flex h-16 flex-col items-center justify-center gap-2 rounded-lg border text-[11px] hover:bg-[var(--paint-hover)] focus-visible:outline-2 focus-visible:outline-offset-2"
                                    style={{ borderColor: ratioPreset === preset ? theme.node.activeStroke : "transparent", background: ratioPreset === preset ? theme.toolbar.activeBg : undefined }}
                                    onClick={() => { setRatioPreset(preset); if (ratio && image) setCrop((current) => fitCropToRatio(current, ratio, image)); }}>
                                    <span className="flex h-5 w-6 items-center justify-center" aria-hidden>{ratio ? <span className="rounded-[2px] border border-current" style={{ width: 20 * Math.min(1, ratio), height: 20 / Math.max(1, ratio) }} /> : <SquareDashed className="size-4" />}</span>
                                    {label}
                                </button>;
                            })}
                        </div>
                        <p className="m-0 text-[11px] tabular-nums" style={{ color: theme.node.placeholder }}>{t("canvas.editors.ratio", { ratio: cropSize ? formatRatio(cropSize.width, cropSize.height) : "—" })}</p>
                        <p className="m-0 text-[11px] leading-relaxed" style={{ color: theme.node.placeholder }}>{t("canvas.editors.maskPreprocessHint")}</p>
                    </section> : <>
                    <section className="space-y-4 border-t border-[var(--paint-border)] pt-4">
                        <h3 className="m-0 text-xs font-semibold">{t("canvas.editors.paintSettings")}</h3>
                        {tool === "circle" || tool === "rect" ? (
                            <div className="flex items-center justify-between gap-3 text-xs">
                                <span style={{ color: theme.node.placeholder }}>{t("canvas.editors.paintShapeStyle")}</span>
                                <div className="flex gap-1">
                                    {[false, true].map((filled) => (
                                        <button
                                            key={String(filled)}
                                            type="button"
                                            aria-pressed={(tool === "circle" ? circleFilled : rectFilled) === filled}
                                            className="rounded-md px-3 py-1.5 hover:bg-[var(--paint-hover)] focus-visible:outline-2 focus-visible:outline-offset-2"
                                            style={(tool === "circle" ? circleFilled : rectFilled) === filled ? { background: theme.toolbar.activeBg } : undefined}
                                            onClick={() => (tool === "circle" ? setCircleFilled : setRectFilled)(filled)}
                                        >
                                            {t(filled ? "canvas.editors.paintSolid" : "canvas.editors.paintOutline")}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                        <label className="block space-y-2">
                            <span className="flex items-center justify-between gap-3 text-xs">
                                <span style={{ color: theme.node.placeholder }}>{sizeLabel}</span>
                                <span className="tabular-nums">
                                    {sizeValue}{brushActive ? "%" : " px"}
                                    {brushActive ? <span className="ml-2 text-[11px]" style={{ color: theme.node.placeholder }}>{brushSize} px</span> : null}
                                </span>
                            </span>
                            <input
                                type="range"
                                aria-label={sizeLabel}
                                className="block h-4 w-full cursor-pointer accent-[var(--paint-accent)]"
                                min={sizeMin}
                                max={sizeMax}
                                step={brushActive ? 0.1 : 1}
                                value={Math.min(sizeMax, Math.max(sizeMin, sizeValue))}
                                onChange={(event) => setSizeValue(Number(event.target.value))}
                            />
                            {brushActive ? <span className="block text-[11px] leading-relaxed" style={{ color: theme.node.placeholder }}>{t("canvas.editors.paintSizeHint")}</span> : null}
                        </label>
                        <label className="block space-y-2">
                            <span className="flex items-center justify-between gap-3 text-xs">
                                <span style={{ color: theme.node.placeholder }}>{t("canvas.editors.brushOpacity")}</span>
                                <span className="tabular-nums">{Math.round(brushOpacity * 100)}%</span>
                            </span>
                            <input
                                type="range"
                                aria-label={t("canvas.editors.brushOpacity")}
                                className="block h-4 w-full cursor-pointer accent-[var(--paint-accent)]"
                                min={0.15}
                                max={1}
                                step={0.05}
                                value={brushOpacity}
                                onChange={(event) => setBrushOpacity(Number(event.target.value))}
                            />
                        </label>
                    </section>

                    {tool !== "erase" && tool !== "mosaic" ? (
                        <section className="space-y-3 border-t border-[var(--paint-border)] pt-4">
                            <div className="flex items-center justify-between gap-3">
                                <h3 className="m-0 text-xs font-semibold">{t("canvas.editors.brushColor")}</h3>
                                <label className="flex cursor-pointer items-center gap-2 rounded-md py-1 pl-2 hover:bg-[var(--paint-hover)]">
                                    <span className="font-mono text-[11px]" style={{ color: theme.node.placeholder }}>{brushColor.toUpperCase()}</span>
                                    <input
                                        type="color"
                                        aria-label={t("canvas.editors.brushColor")}
                                        value={brushColor}
                                        onChange={(event) => setBrushColor(event.target.value)}
                                        className="size-6 cursor-pointer rounded-full border border-[var(--paint-border)] bg-transparent p-0.5 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-0"
                                    />
                                </label>
                            </div>
                            <div className="flex items-center justify-between gap-1" role="group" aria-label={t("canvas.editors.paintPalette")}>
                                {paintColors.map((color) => (
                                    <button
                                        key={color}
                                        type="button"
                                        title={color.toUpperCase()}
                                        aria-label={color.toUpperCase()}
                                        aria-pressed={brushColor.toLowerCase() === color}
                                        className="flex size-7 items-center justify-center rounded-full border focus-visible:outline-2 focus-visible:outline-offset-2"
                                        style={{ borderColor: brushColor.toLowerCase() === color ? theme.node.activeStroke : "transparent" }}
                                        onClick={() => setBrushColor(color)}
                                    >
                                        <span className="size-5 rounded-full border border-[var(--paint-border)]" style={{ background: color }} />
                                    </button>
                                ))}
                            </div>
                            <details className="group">
                                <summary className="flex cursor-pointer list-none items-center justify-between rounded-md py-2 text-xs hover:bg-[var(--paint-hover)] [&::-webkit-details-marker]:hidden">
                                    {t("canvas.editors.paintCustomColor")}
                                    <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
                                </summary>
                                <div className="pt-3">
                                    <ColorWheel value={brushColor} onChange={setBrushColor} brightnessLabel={t("canvas.editors.brightness")} />
                                </div>
                            </details>
                        </section>
                    ) : null}
                    </>}
                </aside>
            </div>
        </Modal>
    );
}

function ColorWheel({ value, onChange, brightnessLabel }: { value: string; onChange: (hex: string) => void; brightnessLabel: string }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const draggingRef = useRef(false);
    const size = 144;
    const hsv = hexToHsv(value);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;
        const radius = size / 2;
        const image = ctx.createImageData(size, size);
        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                const dx = x - radius + 0.5;
                const dy = y - radius + 0.5;
                const dist = Math.hypot(dx, dy);
                const idx = (y * size + x) * 4;
                if (dist > radius) {
                    image.data[idx + 3] = 0;
                    continue;
                }
                const sat = dist / radius;
                const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
                const rgb = hsvToRgb(hue, sat, 1);
                image.data[idx] = rgb.r;
                image.data[idx + 1] = rgb.g;
                image.data[idx + 2] = rgb.b;
                image.data[idx + 3] = 255;
            }
        }
        ctx.putImageData(image, 0, 0);
        const markerX = radius + Math.cos((hsv.h * Math.PI) / 180) * hsv.s * (radius - 2);
        const markerY = radius + Math.sin((hsv.h * Math.PI) / 180) * hsv.s * (radius - 2);
        ctx.beginPath();
        ctx.arc(markerX, markerY, 6, 0, Math.PI * 2);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(markerX, markerY, 6, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(0,0,0,.55)";
        ctx.lineWidth = 1;
        ctx.stroke();
    }, [hsv.h, hsv.s, value]);

    const pick = (clientX: number, clientY: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const x = ((clientX - rect.left) / rect.width) * size;
        const y = ((clientY - rect.top) / rect.height) * size;
        const dx = x - size / 2;
        const dy = y - size / 2;
        const dist = Math.min(1, Math.hypot(dx, dy) / (size / 2));
        const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        onChange(rgbToHex(hsvToRgb(hue, dist, hsv.v || 1)));
    };

    return (
        <div className="flex flex-col items-center gap-3">
            <canvas
                ref={canvasRef}
                width={size}
                height={size}
                className="touch-none cursor-crosshair rounded-full"
                style={{ width: size, height: size }}
                onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    draggingRef.current = true;
                    pick(event.clientX, event.clientY);
                }}
                onPointerMove={(event) => {
                    if (!draggingRef.current) return;
                    pick(event.clientX, event.clientY);
                }}
                onPointerUp={(event) => {
                    draggingRef.current = false;
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={() => {
                    draggingRef.current = false;
                }}
                onLostPointerCapture={() => {
                    draggingRef.current = false;
                }}
            />
            <label className="w-full space-y-2">
                <div className="flex items-center justify-between text-xs opacity-70">
                    <span>{brightnessLabel}</span>
                    <span>{Math.round(hsv.v * 100)}%</span>
                </div>
                <input
                    type="range"
                    aria-label={brightnessLabel}
                    className="block h-4 w-full cursor-pointer accent-[var(--paint-accent)]"
                    min={0}
                    max={1}
                    step={0.01}
                    value={hsv.v}
                    onChange={(event) => onChange(rgbToHex(hsvToRgb(hsv.h, hsv.s, Number(event.target.value))))}
                />
            </label>
        </div>
    );
}

function drawStroke(context: CanvasRenderingContext2D, stroke: PaintStroke, source: HTMLCanvasElement | null) {
    if (stroke.kind === "free") {
        if (stroke.mode === "mosaic") {
            const painted = new Set<string>();
            stroke.points.forEach((point, index) => {
                const previous = stroke.points[index - 1] || point;
                drawMosaicSegment(context, source, previous, point, stroke.size, stroke.opacity, painted);
            });
            return;
        }
        const first = stroke.points[0];
        if (!first) return;
        context.save();
        configureFreeContext(context, stroke);
        context.lineWidth = stroke.size;
        context.lineCap = "round";
        context.lineJoin = "round";
        if (stroke.points.length === 1) drawPaintDot(context, first, stroke.size);
        else {
            context.beginPath();
            context.moveTo(first.x, first.y);
            for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
            context.stroke();
        }
        context.restore();
        return;
    }
    if (stroke.kind === "text") {
        context.save();
        context.globalCompositeOperation = "source-over";
        context.fillStyle = withAlpha(stroke.color, stroke.opacity);
        context.font = `600 ${Math.max(12, stroke.size)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        context.textBaseline = "top";
        context.shadowColor = "rgba(0,0,0,.35)";
        context.shadowBlur = 2;
        context.fillText(stroke.text, stroke.x, stroke.y);
        context.restore();
        return;
    }
    context.save();
    context.globalCompositeOperation = "source-over";
    context.strokeStyle = withAlpha(stroke.color, stroke.opacity);
    context.fillStyle = withAlpha(stroke.color, stroke.opacity);
    context.lineWidth = Math.max(1, stroke.size);
    context.lineCap = "round";
    context.lineJoin = "round";
    if (stroke.kind === "arrow") drawArrow(context, stroke.from, stroke.to, stroke.size);
    else if (stroke.kind === "circle") drawEllipse(context, stroke.from, stroke.to, Boolean(stroke.filled));
    else if (stroke.kind === "line") drawLine(context, stroke.from, stroke.to);
    else if (stroke.kind === "rect") drawRect(context, stroke.from, stroke.to, Boolean(stroke.filled));
    context.restore();
}

function drawLine(context: CanvasRenderingContext2D, from: Point, to: Point) {
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
}

function drawArrow(context: CanvasRenderingContext2D, from: Point, to: Point, size: number) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 2) return;

    const ux = dx / length;
    const uy = dy / length;
    const px = -uy;
    const py = ux;
    const shaftHalf = Math.max(1.2, size * 0.42);
    const headLen = Math.min(Math.max(size * 3.2, 18), length * 0.42);
    const headHalf = Math.max(shaftHalf * 2.35, size * 1.35);
    const neck = Math.max(0, length - headLen);
    const baseX = from.x + ux * neck;
    const baseY = from.y + uy * neck;

    context.beginPath();
    context.moveTo(from.x + px * shaftHalf, from.y + py * shaftHalf);
    context.lineTo(baseX + px * shaftHalf, baseY + py * shaftHalf);
    context.lineTo(baseX + px * headHalf, baseY + py * headHalf);
    context.lineTo(to.x, to.y);
    context.lineTo(baseX - px * headHalf, baseY - py * headHalf);
    context.lineTo(baseX - px * shaftHalf, baseY - py * shaftHalf);
    context.lineTo(from.x - px * shaftHalf, from.y - py * shaftHalf);
    context.closePath();
    context.fill();
}

function drawEllipse(context: CanvasRenderingContext2D, from: Point, to: Point, filled: boolean) {
    const cx = (from.x + to.x) / 2;
    const cy = (from.y + to.y) / 2;
    const rx = Math.abs(to.x - from.x) / 2;
    const ry = Math.abs(to.y - from.y) / 2;
    if (rx < 0.5 && ry < 0.5) return;
    context.beginPath();
    context.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
    if (filled) context.fill();
    else context.stroke();
}

function drawRect(context: CanvasRenderingContext2D, from: Point, to: Point, filled: boolean) {
    const x = Math.min(from.x, to.x);
    const y = Math.min(from.y, to.y);
    const w = Math.abs(to.x - from.x);
    const h = Math.abs(to.y - from.y);
    if (w < 0.5 && h < 0.5) return;
    if (filled) context.fillRect(x, y, Math.max(w, 1), Math.max(h, 1));
    else context.strokeRect(x, y, Math.max(w, 1), Math.max(h, 1));
}

function configureFreeContext(context: CanvasRenderingContext2D, stroke: FreeStroke) {
    context.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";
    context.fillStyle = stroke.mode === "erase" ? `rgba(0,0,0,${stroke.opacity})` : withAlpha(stroke.color, stroke.opacity);
    context.strokeStyle = context.fillStyle;
}

function drawPaintDot(context: CanvasRenderingContext2D, point: Point, size: number) {
    context.beginPath();
    context.arc(point.x, point.y, size / 2, 0, Math.PI * 2);
    context.fill();
}

function mosaicCellKey(x: number, y: number) {
    return `${x},${y}`;
}

function drawMosaicDot(context: CanvasRenderingContext2D, source: HTMLCanvasElement | null, point: Point, size: number, opacity: number, painted = new Set<string>()) {
    if (!source) return;
    context.globalCompositeOperation = "source-over";
    const block = Math.max(6, Math.round(size / 2.2));
    const half = size / 2;
    const radius = half * half;
    const left = Math.max(0, Math.floor((point.x - half) / block) * block);
    const top = Math.max(0, Math.floor((point.y - half) / block) * block);
    const right = Math.min(source.width, Math.ceil((point.x + half) / block) * block);
    const bottom = Math.min(source.height, Math.ceil((point.y + half) / block) * block);
    const srcCtx = source.getContext("2d", { willReadFrequently: true });
    if (!srcCtx) return;
    for (let y = top; y < bottom; y += block) {
        for (let x = left; x < right; x += block) {
            const w = Math.min(block, source.width - x);
            const h = Math.min(block, source.height - y);
            if (w <= 0 || h <= 0) continue;
            const midX = x + w / 2 - point.x;
            const midY = y + h / 2 - point.y;
            if (midX * midX + midY * midY > radius) continue;
            const key = mosaicCellKey(x, y);
            if (painted.has(key)) continue;
            painted.add(key);
            const cx = Math.min(source.width - 1, x + Math.floor(w / 2));
            const cy = Math.min(source.height - 1, y + Math.floor(h / 2));
            const pixel = srcCtx.getImageData(cx, cy, 1, 1).data;
            context.fillStyle = `rgba(${pixel[0]},${pixel[1]},${pixel[2]},${opacity})`;
            context.fillRect(x, y, w, h);
        }
    }
}

function drawMosaicSegment(context: CanvasRenderingContext2D, source: HTMLCanvasElement | null, from: Point, to: Point, size: number, opacity: number, painted = new Set<string>()) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    const step = Math.max(2, size * 0.35);
    if (distance < step) {
        drawMosaicDot(context, source, to, size, opacity, painted);
        return;
    }
    const count = Math.ceil(distance / step);
    for (let i = 1; i <= count; i += 1) {
        const t = i / count;
        drawMosaicDot(context, source, { x: from.x + dx * t, y: from.y + dy * t }, size, opacity, painted);
    }
}

function readCanvasPoint(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(rect.width, 1);
    const scaleY = canvas.height / Math.max(rect.height, 1);
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
}

function withAlpha(hex: string, alpha: number) {
    const rgb = hexToRgb(hex);
    return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
}

function pointsEqual(a: Point, b: Point) {
    return Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
}

function loadImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("paint image load failed"));
        image.src = src;
    });
}

function hexToRgb(hex: string) {
    const raw = hex.replace("#", "");
    const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw.padEnd(6, "0");
    const value = Number.parseInt(full.slice(0, 6), 16);
    if (!Number.isFinite(value)) return { r: 239, g: 68, b: 68 };
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }) {
    return `#${[r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("")}`;
}

function hexToHsv(hex: string) {
    const { r, g, b } = hexToRgb(hex);
    const rr = r / 255;
    const gg = g / 255;
    const bb = b / 255;
    const max = Math.max(rr, gg, bb);
    const min = Math.min(rr, gg, bb);
    const delta = max - min;
    let h = 0;
    if (delta !== 0) {
        if (max === rr) h = ((gg - bb) / delta) % 6;
        else if (max === gg) h = (bb - rr) / delta + 2;
        else h = (rr - gg) / delta + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : delta / max;
    return { h, s, v: max };
}

function hsvToRgb(h: number, s: number, v: number) {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
