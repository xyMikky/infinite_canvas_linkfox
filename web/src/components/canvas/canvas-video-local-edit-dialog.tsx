import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Button, Modal } from "antd";
import { CanvasNodePaintDialog } from "@/components/canvas-node-paint-dialog";
import { saveAs } from "file-saver";
import { Check, ChevronLeft, ChevronRight, DiamondPlus, Loader2, LockKeyhole, LockKeyholeOpen, Pause, Play, RotateCcw, Trash2 } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { expandVideoEditRange, interpolateVideoEditRect, normalizeVideoEditKeyframes, type VideoEditKeyframe, type VideoLocalEditPlan, type VideoLocalEditSelection } from "@/lib/canvas/video-local-edit";
import { fitCropToRatio, resizeCrop, LOCAL_EDIT_RATIO_PRESETS, type RatioPreset } from "@/lib/canvas/local-edit-selection";
import { renderVideoLocalEdit } from "@/lib/canvas/video-local-edit-media";
import { resolveMediaUrl } from "@/services/file-storage";
import { CANVAS_OVERLAY_MODAL_Z_INDEX } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData } from "@/types/canvas";

type Rect = Omit<VideoEditKeyframe, "time">;
type Handle = "nw" | "ne" | "se" | "sw";
type VideoMeta = { duration: number; width: number; height: number; fps?: number };
type Drag = { id: number; mode: "draw" | "move" | Handle; x: number; y: number; rect: Rect; box: DOMRect; time: number; keyframes: VideoEditKeyframe[] };

const defaultRect: Rect = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
const handles: Handle[] = ["nw", "ne", "se", "sw"];
const minSize = 0.01;
const normalizedBox = { width: 1, height: 1 };
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const seconds = (value: number) => `${value.toFixed(3)} 秒`;
const chineseError = (error: unknown, fallback: string) => error instanceof Error && /[\u3400-\u9fff]/.test(error.message) ? error.message : fallback;

function fitLockedRect(rect: Rect, ratio: number): Rect {
    if (Math.abs(rect.width / rect.height - ratio) < 1e-10 && rect.width >= minSize && rect.height >= minSize && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 1 && rect.y + rect.height <= 1) return rect;
    const fitted = fitCropToRatio(rect, ratio, normalizedBox);
    const width = Math.max(fitted.width, minSize, minSize * ratio);
    const height = width / ratio;
    return { x: clamp(rect.x + (rect.width - width) / 2, 0, 1 - width), y: clamp(rect.y + (rect.height - height) / 2, 0, 1 - height), width, height };
}

function changeRange(selection: VideoLocalEditSelection, start: number, end: number): VideoLocalEditSelection {
    return {
        ...selection, start, end,
        keyframes: [
            { time: start, ...interpolateVideoEditRect(selection.keyframes, start) },
            ...selection.keyframes.filter(frame => frame.time > start && frame.time < end),
            { time: end, ...interpolateVideoEditRect(selection.keyframes, end) },
        ],
    };
}

export function CanvasVideoLocalEditDialog({ node, open, onClose, onConfirm, onRestore }: {
    node: CanvasNodeData;
    open: boolean;
    onClose: () => void;
    onConfirm: (selection: VideoLocalEditSelection, signal: AbortSignal, onProgress: (text: string) => void) => Promise<void>;
    onRestore?: () => void;
}) {
    const theme = canvasThemes[useThemeStore(state => state.theme)];
    const stored = (node.metadata as (CanvasNodeData["metadata"] & { videoLocalEdit?: VideoLocalEditPlan }))?.videoLocalEdit;
    const sourceKey = node.metadata?.storageKey;
    const storageKey = typeof sourceKey === "string" ? sourceKey : undefined;
    const sourceFallback = node.metadata?.content;
    const fallback = typeof sourceFallback === "string" ? sourceFallback : "";
    const videoRef = useRef<HTMLVideoElement>(null);
    const initialSelectionRef = useRef<VideoLocalEditSelection | undefined>(stored?.selection);
    const controllerRef = useRef<AbortController | null>(null);
    const dragRef = useRef<Drag | null>(null);
    const aliveRef = useRef(false);
    const mediaFailedRef = useRef(false);
    const loadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const seekTargetRef = useRef<number | null>(null);
    const seekErrorRef = useRef(false);
    const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
    const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
    const [src, setSrc] = useState("");
    const [meta, setMeta] = useState<VideoMeta | null>(null);
    const [selection, setSelection] = useState<VideoLocalEditSelection | null>(null);
    const [time, setTime] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [frameReady, setFrameReady] = useState(false);
    const [seeking, setSeeking] = useState(false);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState("");
    const [error, setError] = useState("");
    const [retry, setRetry] = useState(0);
    const [paintFrame, setPaintFrame] = useState<string | null>(null);
    const [ratioPreset, setRatioPreset] = useState<RatioPreset>((stored?.selection.aspectPreset || "auto") as RatioPreset);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        let sourceResolved = false;
        aliveRef.current = true;
        mediaFailedRef.current = false;
        seekTargetRef.current = null;
        seekErrorRef.current = false;
        initialSelectionRef.current = stored?.selection;
        setSrc("");
        setMeta(null);
        setSelection(null);
        setTime(0);
        setPlaying(false);
        setFrameReady(false);
        setSeeking(false);
        setBusy(false);
        setProgress("");
        setError("");
        loadTimerRef.current = setTimeout(() => {
            if (cancelled || !aliveRef.current) return;
            const video = videoRef.current;
            failMedia(!sourceResolved ? "原视频文件读取超时，请重试。" : !video ? "视频预览未完成初始化，请重试。" : video.readyState < 1 ? "视频信息加载超时，请重新加载视频。" : "视频首帧解码超时，请重试。");
        }, 15000);
        void resolveMediaUrl(storageKey, fallback.startsWith("blob:") ? "" : fallback).then(url => {
            if (cancelled || mediaFailedRef.current || !aliveRef.current) return;
            if (!url) throw new Error("找不到原视频，请重新导入后再试。");
            // URL 由媒体存储共享管理，弹窗不拥有它，也不撤销它。
            sourceResolved = true;
            setSrc(url);
        }).catch(reason => {
            if (!cancelled && !mediaFailedRef.current && aliveRef.current) failMedia(chineseError(reason, "原视频读取失败，请重试。"));
        });
        return () => {
            cancelled = true;
            aliveRef.current = false;
            controllerRef.current?.abort();
            controllerRef.current = null;
            dragRef.current = null;
            seekTargetRef.current = null;
            if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
            if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
            videoRef.current?.pause();
        };
    }, [open, node.id, storageKey, fallback, retry]);

    useEffect(() => {
        if (!open || !viewport) return;
        const resize = () => setViewportSize(previous => {
            const width = viewport.clientWidth;
            const height = viewport.clientHeight;
            return previous.width === width && previous.height === height ? previous : { width, height };
        });
        resize();
        const observer = new ResizeObserver(resize);
        observer.observe(viewport);
        return () => observer.disconnect();
    }, [open, viewport]);

    useEffect(() => {
        if (!open || !playing) return;
        let frame = 0;
        const update = () => {
            if (videoRef.current && !videoRef.current.paused && !videoRef.current.seeking && seekTargetRef.current === null) setTime(videoRef.current.currentTime);
            frame = requestAnimationFrame(update);
        };
        frame = requestAnimationFrame(update);
        return () => cancelAnimationFrame(frame);
    }, [open, playing]);

    const rect = selection?.keyframes.length ? interpolateVideoEditRect(selection.keyframes, time) : defaultRect;
    const firstRect = selection?.keyframes[0] || defaultRect;
    const lockedRatio = firstRect.width / firstRect.height;
    let expanded: ReturnType<typeof expandVideoEditRange> | null = null;
    let selectionError = "";
    if (selection && meta) {
        try {
            expanded = expandVideoEditRange(selection.start, selection.end, meta.duration);
            const keys = normalizeVideoEditKeyframes(selection.keyframes, meta.duration);
            const width = Math.max(...keys.map(frame => frame.width)) * meta.width;
            const height = Math.max(...keys.map(frame => frame.height)) * meta.height;
            if (expanded.generationSeconds > 15) selectionError = "实际处理时段不能超过 15 秒，请缩短所选时段。";
            else if (Math.max(width / height, height / width) > 3) selectionError = "选区过于狭长：生成输入宽高比须在 1:3 至 3:1 之间，请扩大较短的一边。";
        } catch (reason) {
            selectionError = chineseError(reason, "选区数据无效，请重新选择编辑时段和区域。");
        }
    }
    const selectedFrame = selection?.keyframes.findIndex(frame => Math.abs(frame.time - time) < 0.001) ?? -1;
    const editingFirstFrame = Boolean(selection && time <= selection.keyframes[0].time + 0.001);
    const inRange = Boolean(selection && time >= selection.start - 0.001 && time <= selection.end + 0.001);
    const editable = Boolean(meta && selection && inRange && frameReady && !seeking && !busy);
    const aspect = meta ? meta.width / meta.height : 16 / 9;
    const stageWidth = Math.max(0, Math.min(viewportSize.width - 24, (viewportSize.height - 24) * aspect));
    const inputStyle: CSSProperties = { color: theme.node.text, background: "transparent", borderColor: theme.toolbar.border };
    const mutedStyle = { color: theme.node.placeholder };

    const close = () => {
        aliveRef.current = false;
        controllerRef.current?.abort();
        controllerRef.current = null;
        dragRef.current = null;
        seekTargetRef.current = null;
        if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
        if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
        videoRef.current?.pause();
        onClose();
    };

    const failMedia = (message: string) => {
        if (!aliveRef.current) return;
        mediaFailedRef.current = true;
        seekTargetRef.current = null;
        dragRef.current = null;
        if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
        if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
        videoRef.current?.pause();
        setSrc("");
        setMeta(null);
        setSelection(null);
        setFrameReady(false);
        setSeeking(false);
        setError(message);
    };

    const finishSeek = (video: HTMLVideoElement) => {
        if (!aliveRef.current || mediaFailedRef.current || videoRef.current !== video || video.seeking || video.readyState < 2) return false;
        // 浏览器可将 0 秒钳到非零首帧；画面就绪后仍编辑用户选中的时间。
        if (seekTargetRef.current !== null) setTime(seekTargetRef.current);
        seekTargetRef.current = null;
        if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
        if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
        if (seekErrorRef.current) { seekErrorRef.current = false; setError(""); }
        setFrameReady(true);
        setSeeking(false);
        return true;
    };

    const failSeek = (message: string) => {
        if (!aliveRef.current || mediaFailedRef.current) return;
        if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
        seekTargetRef.current = null;
        seekErrorRef.current = true;
        dragRef.current = null;
        videoRef.current?.pause();
        setFrameReady(false);
        setSeeking(false);
        setError(message);
    };

    const waitForSeek = (video: HTMLVideoElement) => {
        if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
        seekTimerRef.current = setTimeout(() => {
            if (!aliveRef.current || mediaFailedRef.current || videoRef.current !== video || finishSeek(video)) return;
            failSeek("定位视频帧超时，已保留视频和选区，请重新定位。");
        }, 15000);
    };

    const seek = (next: number, duration = meta?.duration) => {
        const video = videoRef.current;
        if (!video || !duration || !Number.isFinite(next) || mediaFailedRef.current || !aliveRef.current) return;
        video.pause();
        dragRef.current = null;
        const bounded = clamp(next, 0, duration);
        if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
        if (seekErrorRef.current) { seekErrorRef.current = false; setError(""); }
        seekTargetRef.current = bounded;
        const sameTime = Math.abs(video.currentTime - bounded) < 0.0001;
        if (sameTime && finishSeek(video)) return;
        setFrameReady(false);
        setSeeking(video.seeking || !sameTime);
        setTime(bounded);
        waitForSeek(video);
        // 尚未解码时也不要向相同时间重复写 currentTime，以免打断首帧加载。
        if (!sameTime) {
            try { video.currentTime = bounded; }
            catch { failSeek("无法定位到指定视频帧，已保留视频和选区，请重新定位。"); }
        }
    };

    useEffect(() => {
        const video = videoRef.current;
        if (!open || !src || !video) return;
        let initialized = false;
        const onMeta = () => {
            if (initialized || !aliveRef.current || mediaFailedRef.current || videoRef.current !== video || video.readyState < 1) return;
            if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) { failMedia("无法读取视频时长或尺寸，请换一个可播放的视频。"); return; }
            if (video.duration < 0.001) { failMedia("视频时长过短，无法按毫秒设置编辑区间，请换一个视频。"); return; }
            initialized = true;
            if (loadTimerRef.current) clearTimeout(loadTimerRef.current);
            const fps = stored?.original?.fps;
            setMeta({ duration: video.duration, width: video.videoWidth, height: video.videoHeight, fps: fps && Number.isFinite(fps) && fps > 0 ? fps : undefined });
            const saved = initialSelectionRef.current;
            const clipStart = Number(node.metadata?.clipStartMs) / 1000;
            const clipEnd = Number(node.metadata?.clipEndMs) / 1000;
            const start = clamp(Number.isFinite(clipStart) ? clipStart : 0, 0, video.duration - 0.001);
            const end = clamp(Number.isFinite(clipEnd) && clipEnd > start ? clipEnd : video.duration, start + 0.001, video.duration);
            let initial: VideoLocalEditSelection = { start, end, keyframes: [start, end].map(at => ({ time: at, ...defaultRect })) };
            if (saved) {
                try {
                    expandVideoEditRange(saved.start, saved.end, video.duration);
                    if (saved.end > video.duration || !Array.isArray(saved.keyframes)) throw new Error("invalid selection");
                    const keys = normalizeVideoEditKeyframes(saved.keyframes, video.duration);
                    const ratio = keys[0].width / keys[0].height;
                    initial = { start: saved.start, end: saved.end, keyframes: keys.map(key => ({ ...key, ...fitLockedRect(key, ratio) })) };
                } catch { setError("原有选区数据无效，已重置为默认区域，请重新选择后确认。"); }
            }
            setSelection(initial);
            seek(initial.start, video.duration);
        };
        const onFrame = () => { onMeta(); finishSeek(video); };
        const onTimeUpdate = () => {
            if (aliveRef.current && !mediaFailedRef.current && videoRef.current === video && !video.paused && !video.seeking && seekTargetRef.current === null) setTime(video.currentTime);
        };
        const onSeeking = () => {
            if (!aliveRef.current || mediaFailedRef.current || videoRef.current !== video) return;
            if (!video.seeking) { finishSeek(video); return; }
            dragRef.current = null;
            setFrameReady(false);
            setSeeking(true);
            waitForSeek(video);
        };
        const onError = () => { if (videoRef.current === video) failMedia("原视频无法解码，请检查文件或重新导入。"); };
        // 和画布播放器一致：先监听，再补读已就绪状态，不能只等一次加载事件。
        video.addEventListener("loadedmetadata", onMeta);
        video.addEventListener("loadeddata", onFrame);
        video.addEventListener("canplay", onFrame);
        video.addEventListener("seeking", onSeeking);
        video.addEventListener("seeked", onFrame);
        video.addEventListener("timeupdate", onTimeUpdate);
        video.addEventListener("error", onError);
        if (video.readyState >= 1) onFrame();
        else {
            try { video.load(); } catch { onError(); }
        }
        return () => {
            video.removeEventListener("loadedmetadata", onMeta);
            video.removeEventListener("loadeddata", onFrame);
            video.removeEventListener("canplay", onFrame);
            video.removeEventListener("seeking", onSeeking);
            video.removeEventListener("seeked", onFrame);
            video.removeEventListener("timeupdate", onTimeUpdate);
            video.removeEventListener("error", onError);
        };
    }, [open, node.id, storageKey, fallback, src, viewport, retry]);

    const setFrame = (next: Rect, at = time) => {
        if (seekTargetRef.current !== null || !frameReady || videoRef.current?.seeking || mediaFailedRef.current) return;
        if (selection && selection.keyframes.length >= 32 && !selection.keyframes.some(frame => Math.abs(frame.time - at) < 0.001)) {
            setError("最多支持 32 个关键帧，请先删除一个再调整新时刻。");
            return;
        }
        setError("");
        const drag = dragRef.current;
        setSelection(previous => {
            if (!previous) return previous;
            const frameTime = clamp(at, previous.start, previous.end);
            const first = previous.keyframes[0];
            const editsFirst = frameTime <= first.time + 0.001;
            const ratio = editsFirst ? next.width / next.height : first.width / first.height;
            // 同一次首框拖拽始终基于开始时的其它框，避免每次比例变化都累积收缩。
            const base = editsFirst && drag?.time === at ? drag.keyframes : previous.keyframes;
            const keyframes = base.filter(frame => Math.abs(frame.time - frameTime) >= 0.001).map(frame => {
                if (!editsFirst || Math.abs(frame.width / frame.height - ratio) < 1e-10) return frame;
                const width = Math.sqrt(frame.width * frame.height * ratio);
                const height = width / ratio;
                return { ...frame, ...fitLockedRect({ x: frame.x + (frame.width - width) / 2, y: frame.y + (frame.height - height) / 2, width, height }, ratio) };
            });
            keyframes.push({ time: frameTime, ...(editsFirst ? next : fitLockedRect(next, ratio)) });
            keyframes.sort((a, b) => a.time - b.time);
            return { ...previous, keyframes };
        });
    };

    const changeRectValue = (field: keyof Rect, value: number) => {
        if (!editable || !Number.isFinite(value)) return;
        videoRef.current?.pause();
        if (field === "x" || field === "y") setFrame({ ...rect, [field]: clamp(value, 0, 1 - (field === "x" ? rect.width : rect.height)) });
        else setFrame(resizeCrop(rect, field === "width" ? value - rect.width : 0, field === "height" ? value - rect.height : 0, field === "width" ? "e" : "s", editingFirstFrame && ratioPreset === "auto" ? null : lockedRatio, normalizedBox, minSize));
    };

    const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
        if (!editable || !selection || seekTargetRef.current !== null || videoRef.current?.seeking || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const video = videoRef.current;
        const frameTime = video && !video.paused ? video.currentTime : time;
        video?.pause();
        const frameRect = selection ? interpolateVideoEditRect(selection.keyframes, frameTime) : rect;
        setTime(frameTime);
        const box = event.currentTarget.getBoundingClientRect();
        const target = event.target as HTMLElement;
        const mode = target.closest<HTMLElement>("[data-video-edit-handle]")?.dataset.videoEditHandle as Handle | undefined;
        const x = clamp((event.clientX - box.left) / box.width);
        const y = clamp((event.clientY - box.top) / box.height);
        dragRef.current = { id: event.pointerId, mode: mode || (target.closest("[data-video-edit-rect]") ? "move" : "draw"), x, y, rect: frameRect, box, time: frameTime, keyframes: selection.keyframes };
        event.currentTarget.setPointerCapture(event.pointerId);
        if (dragRef.current.mode === "draw") setFrame(fitLockedRect({ x: Math.min(x, 1 - minSize), y: Math.min(y, 1 - minSize), width: minSize, height: minSize }, ratioPreset === "auto" && editingFirstFrame ? 1 : lockedRatio), frameTime);
        else setFrame(frameRect, frameTime);
    };

    const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.id !== event.pointerId) return;
        const x = clamp((event.clientX - drag.box.left) / drag.box.width);
        const y = clamp((event.clientY - drag.box.top) / drag.box.height);
        const dx = x - drag.x;
        const dy = y - drag.y;
        const original = drag.rect;
        const ratio = drag.time <= drag.keyframes[0].time + 0.001 && ratioPreset === "auto" ? null : original.width / original.height;
        let next: Rect;
        if (drag.mode === "draw") {
            const handle = `${dy < 0 ? "n" : "s"}${dx < 0 ? "w" : "e"}` as Handle;
            next = resizeCrop({ x: drag.x, y: drag.y, width: 0, height: 0 }, dx, dy, handle, ratio, normalizedBox, minSize);
        } else if (drag.mode === "move") {
            next = { ...original, x: clamp(original.x + dx, 0, 1 - original.width), y: clamp(original.y + dy, 0, 1 - original.height) };
        } else {
            next = resizeCrop(original, dx, dy, drag.mode, ratio, normalizedBox, minSize);
        }
        setFrame(next, drag.time);
    };

    const openPaint = () => {
        const video = videoRef.current;
        if (!video || !meta || !editable) return;
        video.pause();
        try {
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(rect.width * meta.width));
            canvas.height = Math.max(1, Math.round(rect.height * meta.height));
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error();
            ctx.drawImage(video, rect.x * meta.width, rect.y * meta.height, rect.width * meta.width, rect.height * meta.height, 0, 0, canvas.width, canvas.height);
            setPaintFrame(canvas.toDataURL("image/png"));
        } catch { setError("无法读取当前帧进行绘制，请导入本地视频后重试"); }
    };

    const chooseRatio = (preset: RatioPreset) => {
        if (!selection || !meta || !editable) return;
        setRatioPreset(preset);
        if (preset === "auto") { setSelection(previous => previous ? { ...previous, aspectPreset: preset } : previous); return; }
        const [w, h] = preset === "original" ? [meta.width, meta.height] : preset.split(":").map(Number);
        const ratio = w / h / aspect;
        setSelection(previous => previous ? { ...previous, aspectPreset: preset, keyframes: previous.keyframes.map(frame => ({ ...frame, ...fitLockedRect(frame, ratio) })) } : previous);
    };

    const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
        if (dragRef.current?.id !== event.pointerId) return;
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const confirm = async (exportOnly = false) => {
        if (!selection || !meta || !frameReady || seeking || seekTargetRef.current !== null || selectionError || busy || controllerRef.current) return;
        videoRef.current?.pause();
        const controller = new AbortController();
        controllerRef.current = controller;
        const active = () => aliveRef.current && !controller.signal.aborted && controllerRef.current === controller;
        setBusy(true);
        setError("");
        setProgress("正在准备局部视频…");
        try {
            const snapshot = { ...selection, keyframes: selection.keyframes.map(frame => ({ ...frame })) };
            const onProgress = (text: string) => {
                if (active()) setProgress(text);
            };
            if (exportOnly) {
                const { inputBlob, prepared } = await renderVideoLocalEdit(node, snapshot, controller.signal, onProgress);
                if (active()) saveAs(inputBlob, `${(node.title || "视频").replace(/[\\/:*?"<>|]/g, "_").replace(/\.[^.]+$/, "")}-局部区域-${prepared.range.start.toFixed(3)}-${prepared.range.end.toFixed(3)}秒-24fps.mp4`);
            } else {
                await onConfirm(snapshot, controller.signal, onProgress);
                if (active()) close();
            }
        } catch (reason) {
            if (active()) setError(chineseError(reason, "视频处理失败，请重试。"));
        } finally {
            if (active()) {
                controllerRef.current = null;
                setBusy(false);
                setProgress("");
            }
        }
    };

    return (
        <><Modal
            title={<div className="flex flex-wrap items-center gap-x-3 gap-y-1 pr-8"><h2 className="m-0 text-base font-semibold">视频局部编辑</h2><span className="text-xs font-normal tabular-nums" style={mutedStyle}>{meta ? `原片 ${meta.width} × ${meta.height} · ${seconds(meta.duration)}` : "读取原视频"}</span></div>}
            open={open}
            onCancel={close}
            width="min(1200px, 96vw)"
            centered
            destroyOnHidden
            transitionName=""
            maskTransitionName=""
            zIndex={CANVAS_OVERLAY_MODAL_Z_INDEX}
            getContainer={() => document.body}
            styles={{
                container: { display: "flex", flexDirection: "column", height: "min(900px, calc(100dvh - 24px))", padding: 0, overflow: "hidden", background: theme.node.panel, color: theme.node.text },
                header: { flexShrink: 0, margin: 0, padding: "18px 24px", background: theme.node.panel, borderBottom: `1px solid ${theme.toolbar.border}` },
                body: { flex: 1, minHeight: 0, overflow: "hidden" },
                footer: { flexShrink: 0, margin: 0, padding: "12px 20px", borderTop: `1px solid ${theme.toolbar.border}` },
            }}
            modalRender={content => <div data-canvas-shortcuts-ignore data-canvas-no-zoom onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>{content}</div>}
            footer={<div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2 text-xs" aria-live="polite">
                    {busy ? <><Loader2 className="size-3.5 shrink-0 animate-spin" /><span>{progress}</span></> : stored && onRestore ? <Button type="text" icon={<RotateCcw className="size-3.5" />} onClick={() => { close(); onRestore(); }}>恢复原片</Button> : <span style={mutedStyle}>先选时段，再逐帧调整区域</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2"><Button type="text" disabled={busy || !meta || !selection || !src || !frameReady || seeking || Boolean(selectionError)} title="导出与模型输入相同的 24fps 无声区域视频；不足整数时长的末尾会冻结补齐" onClick={() => void confirm(true)}>导出选区视频</Button><Button type="text" onClick={close}>{busy ? "取消处理" : "取消"}</Button><Button type="primary" icon={<Check className="size-4" />} loading={busy} disabled={!meta || !selection || !src || !frameReady || seeking || Boolean(selectionError)} onClick={() => void confirm()}>创建编辑工作台</Button></div>
            </div>}
        >
            <div className="grid h-full min-h-0 overflow-y-auto overscroll-contain md:grid-cols-[minmax(0,1fr)_300px] md:overflow-hidden">
                <div className="flex min-h-0 min-w-0 flex-col gap-3 p-4 md:p-5">
                    <div className="flex items-center justify-between gap-2 text-xs"><span>区域预览</span><span style={mutedStyle}>{selectedFrame >= 0 ? `关键帧 ${selectedFrame + 1}` : "帧间插值预览"}</span></div>
                    <div ref={setViewport} className="relative h-[42dvh] min-h-[220px] shrink-0 overflow-hidden rounded-xl md:h-auto md:min-h-[140px] md:flex-1" style={{ background: theme.canvas.background }}>
                        {src ? <div
                            className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 touch-none select-none ${editable ? "cursor-crosshair" : ""}`}
                            style={{ width: stageWidth, height: stageWidth / aspect }}
                            onPointerDown={beginDrag}
                            onPointerMove={moveDrag}
                            onPointerUp={finishDrag}
                            onPointerCancel={finishDrag}
                            onLostPointerCapture={() => { dragRef.current = null; }}
                        >
                            <video
                                key={src}
                                ref={videoRef}
                                src={src}
                                playsInline
                                preload="auto"
                                draggable={false}
                                className="pointer-events-none block size-full object-contain"
                                onPlay={() => { if (aliveRef.current) setPlaying(true); }}
                                onPause={() => { if (aliveRef.current) setPlaying(false); }}
                            />
                            {meta && selection ? <div data-video-edit-rect className={`absolute border-2 ${editable ? "cursor-move" : "pointer-events-none"}`} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, borderColor: theme.canvas.selectionStroke, outline: `1px solid ${theme.canvas.background}`, background: theme.canvas.selectionFill }}>
                                {selection.paintLayer ? <img src={selection.paintLayer} alt="画笔参考" className="pointer-events-none absolute inset-0 size-full" /> : null}
                                {handles.map(handle => <button key={handle} type="button" data-video-edit-handle={handle} aria-label={`调整区域${handle.includes("n") ? "上" : "下"}${handle.includes("w") ? "左" : "右"}角`} disabled={!editable} className="absolute grid size-5 touch-none place-items-center" style={{ left: handle.includes("w") ? 0 : "100%", top: handle.includes("n") ? 0 : "100%", transform: "translate(-50%, -50%)", cursor: `${handle}-resize` }}><span className="size-2.5 rounded-sm border" style={{ background: theme.node.panel, borderColor: theme.node.activeStroke }} /></button>)}
                            </div> : null}
                        </div> : null}
                        {(!frameReady && !error) || seeking ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-xs" role="status" style={{ color: theme.node.text, background: theme.canvas.selectionFill }}><Loader2 className="size-4 animate-spin" />{seeking ? "正在定位视频帧…" : "正在读取视频…"}</div> : null}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-0.5">
                            <Button type="text" size="small" aria-label={playing ? "暂停" : "播放"} disabled={!meta || !frameReady || seeking || busy} icon={playing ? <Pause className="size-4" /> : <Play className="size-4" />} onClick={() => {
                                const video = videoRef.current;
                                if (!video) return;
                                if (playing) { setTime(video.currentTime); video.pause(); }
                                else { if (meta && video.currentTime >= meta.duration) seek(selection?.start || 0); void video.play().catch(() => { if (aliveRef.current && videoRef.current === video) setError("视频暂时无法播放，请重试。"); }); }
                            }} />
                            <Button type="text" size="small" aria-label={meta?.fps ? "向前一帧" : "向前 1/24 秒"} title={meta?.fps ? "向前一帧" : "向前 1/24 秒"} disabled={!meta || busy} icon={<ChevronLeft className="size-4" />} onClick={() => seek(time - 1 / (meta?.fps || 24))} />
                            <Button type="text" size="small" aria-label={meta?.fps ? "向后一帧" : "向后 1/24 秒"} title={meta?.fps ? "向后一帧" : "向后 1/24 秒"} disabled={!meta || busy} icon={<ChevronRight className="size-4" />} onClick={() => seek(time + 1 / (meta?.fps || 24))} />
                            <input aria-label="当前播放时间（秒）" type="number" min={0} max={meta?.duration || 0} step="0.001" value={Number(time.toFixed(3))} disabled={!meta || busy} className="ml-2 h-7 w-24 rounded border px-2 text-xs tabular-nums" style={inputStyle} onChange={event => seek(event.currentTarget.valueAsNumber)} /><span className="ml-1 text-xs" style={mutedStyle}>秒</span>
                        </div>
                        <Button type="text" size="small" icon={<DiamondPlus className="size-3.5" />} disabled={!editable || selectedFrame >= 0 || (selection?.keyframes.length || 0) >= 32} onClick={() => { videoRef.current?.pause(); setFrame(rect); }}>添加关键帧</Button>
                    </div>
                    <div className="relative pt-1">
                        <div className="pointer-events-none absolute inset-x-0 top-2.5 h-1 overflow-hidden rounded" style={{ background: theme.toolbar.border }}>
                            {selection && meta ? <div className="absolute h-full" style={{ left: `${selection.start / meta.duration * 100}%`, width: `${(selection.end - selection.start) / meta.duration * 100}%`, background: theme.node.activeStroke }} /> : null}
                        </div>
                        <input aria-label="视频时间轴" type="range" min={0} max={meta?.duration || 1} step="0.001" value={time} disabled={!meta || busy} onChange={event => seek(event.currentTarget.valueAsNumber)} className="relative m-0 h-4 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-current [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-current" style={{ color: theme.node.activeStroke }} />
                        <div className="mt-1 flex justify-between text-[11px] tabular-nums" style={mutedStyle}><span>0.000</span><span>{meta?.duration.toFixed(3) || "—"} 秒</span></div>
                    </div>
                    <p className="m-0 text-[11px] leading-relaxed" style={mutedStyle}>{seeking ? "正在等待指定画面显示，定位完成后可调整区域。" : inRange ? editingFirstFrame ? "首个关键帧可自由调整比例，拖角、重新画框或修改宽高后，其它关键帧同步采用新比例。" : "当前框跟随首框比例；拖动框体移动，拖动四角等比缩放，修改当前时刻会保存为关键帧。" : "将播放位置移到所选时段内，再调整局部区域。"}</p>
                    {error || selectionError ? <div className="flex items-start justify-between gap-2 text-xs" role="alert"><span>{selectionError || error}</span>{!frameReady ? <Button type="text" size="small" onClick={() => meta ? seek(time) : setRetry(value => value + 1)}>{meta ? "重新定位" : "重试"}</Button> : null}</div> : null}
                </div>
                <aside className="flex min-h-0 flex-col gap-3 border-t p-3 md:overflow-y-auto md:border-l md:border-t-0" style={{ borderColor: theme.toolbar.border }}>
                    <section>
                        <h3 className="mb-3 mt-0 text-xs font-medium">编辑时段</h3>
                        <div className="grid grid-cols-2 gap-3">{(["start", "end"] as const).map(bound => <label key={bound} className="flex flex-col gap-1.5 text-[11px]" style={mutedStyle}>{bound === "start" ? "开始（秒）" : "结束（秒）"}<input type="number" min={bound === "end" ? (selection?.start || 0) + 0.001 : 0} max={bound === "start" ? (selection?.end || 0) - 0.001 : meta?.duration || 0} step="0.001" value={selection ? Number(selection[bound].toFixed(3)) : ""} disabled={!selection || busy} className="h-8 w-full rounded border px-2 text-xs tabular-nums" style={inputStyle} onChange={event => {
                            const value = event.currentTarget.valueAsNumber;
                            if (!selection || !meta || !Number.isFinite(value)) return;
                            const start = bound === "start" ? clamp(value, 0, selection.end - 0.001) : selection.start;
                            const end = bound === "end" ? clamp(value, start + 0.001, meta.duration) : selection.end;
                            videoRef.current?.pause();
                            setSelection(changeRange(selection, start, end));
                            if (time < start || time > end) seek(bound === "start" ? start : end);
                        }} /></label>)}</div>
                        <div className="mt-2 flex justify-between gap-1"><Button type="text" size="small" disabled={!selection || !frameReady || seeking || busy || time >= selection.end} onClick={() => { videoRef.current?.pause(); if (selection) setSelection(changeRange(selection, time, selection.end)); }}>当前帧设为开始</Button><Button type="text" size="small" disabled={!selection || !frameReady || seeking || busy || time <= selection.start} onClick={() => { videoRef.current?.pause(); if (selection) setSelection(changeRange(selection, selection.start, time)); }}>设为结束</Button></div>
                        <div className="mt-2 space-y-1 text-[11px] leading-relaxed" style={mutedStyle}>
                            <p className="m-0">实际处理：<span className="tabular-nums" style={{ color: theme.node.text }}>{expanded ? `${seconds(expanded.start)} — ${seconds(expanded.end)}` : "—"}</span></p>
                            <p className="m-0">整数时长保留原区间，否则向外取整。</p>
                            <p className="m-0">24 fps · {expanded ? `${expanded.generationSeconds} 秒 / ${expanded.frameCount} 帧` : "—"}</p>
                            <p className="m-0">AI 多出的首帧仅用于切入对齐，不增加原片时长。</p>
                            {expanded && expanded.generationSeconds - expanded.duration > 0.001 ? <p className="m-0">生成输入冻结末帧补齐至 {expanded.generationSeconds} 秒，额外帧不贴回原片。</p> : null}
                        </div>
                    </section>
                    <section className="flex min-h-[110px] flex-1 flex-col gap-2">
                        <div className="flex items-center justify-between"><h3 className="m-0 text-xs font-medium">区域关键帧</h3><span className="text-[11px] tabular-nums" style={mutedStyle}>{selection?.keyframes.length || 0} 个</span></div>
                        <div className="max-h-[200px] min-h-[60px] overflow-y-auto md:max-h-none md:flex-1" style={{ scrollbarWidth: "thin" }}>
                            {selection?.keyframes.map((frame, index) => <div key={frame.time} className="flex items-center gap-1 rounded" style={{ background: index === selectedFrame ? theme.toolbar.activeBg : "transparent" }}>
                                <button type="button" className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded px-2 py-2 text-xs hover:bg-black/5 dark:hover:bg-white/10" disabled={busy} onClick={() => seek(frame.time)} aria-pressed={index === selectedFrame}><span className="flex items-center gap-2"><span className="text-[10px]" style={mutedStyle}>{String(index + 1).padStart(2, "0")}</span><span className="tabular-nums">{seconds(frame.time)}</span></span><span className="text-[10px] tabular-nums" style={mutedStyle}>{Math.round(frame.width * 100)} × {Math.round(frame.height * 100)}%</span></button>
                                <Button type="text" size="small" aria-label={`删除第 ${index + 1} 个关键帧`} title="删除关键帧" icon={<Trash2 className="size-3" />} disabled={busy || selection.keyframes.length <= 1} onClick={() => setSelection(previous => previous ? { ...previous, keyframes: previous.keyframes.filter(item => item.time !== frame.time) } : previous)} />
                            </div>)}
                        </div>
                    </section>
                    <section>
                        <div className="mb-2 flex items-center gap-2"><Button type="text" size="small" disabled={!editable} onClick={openPaint}>画笔工具</Button>{selection?.paintLayer ? <Button type="text" size="small" disabled={busy} onClick={() => setSelection(previous => previous ? { ...previous, paintLayer: undefined } : previous)}>清除笔迹</Button> : null}</div>
                        <p className="mb-2 mt-0 text-[11px]" style={mutedStyle}>笔迹随选区进入整段参考视频；重新绘制会替换已有笔迹。</p>
                        <div className="mb-2 grid grid-cols-4 gap-1">{LOCAL_EDIT_RATIO_PRESETS.map(preset => <button key={preset} type="button" disabled={!editable} className="rounded px-1 py-1.5 text-[11px] hover:bg-black/5 dark:hover:bg-white/10" style={{ background: ratioPreset === preset ? theme.toolbar.activeBg : undefined }} onClick={() => chooseRatio(preset)}>{preset === "auto" ? "自由" : preset === "original" ? "原图" : preset}</button>)}</div>
                        <h3 className="mb-2 mt-0 text-xs font-medium">当前区域 <span className="font-normal" style={mutedStyle}>/ 画面百分比</span></h3>
                        <p className="mb-2 mt-0 flex items-center gap-1.5 text-[11px]" style={mutedStyle}>{editingFirstFrame ? <LockKeyholeOpen className="size-3 shrink-0" /> : <LockKeyhole className="size-3 shrink-0" />}{editingFirstFrame && ratioPreset === "auto" ? "首框 · 自由比例" : "固定比例 · 全部关键帧一致"}{meta ? ` · ${(lockedRatio * aspect).toFixed(2)}:1` : ""}</p>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-2">{([ ["x", "左"], ["y", "上"], ["width", "宽"], ["height", "高"] ] as const).map(([field, label]) => <label key={field} className="flex items-center gap-2 text-[11px]" style={mutedStyle}>{label}<input type="number" min={field === "width" || field === "height" ? minSize * 100 : 0} max={100} step="0.1" value={Number((rect[field] * 100).toFixed(1))} disabled={!editable} className="h-7 min-w-0 flex-1 rounded border px-2 text-xs tabular-nums" style={inputStyle} onChange={event => {
                            changeRectValue(field, event.currentTarget.valueAsNumber / 100);
                        }} /></label>)}</div>
                    </section>
                    <p className="m-0 text-[11px] leading-relaxed" style={mutedStyle}>在首个关键帧自由设置比例，其它关键帧同步比例，并尽量保留各自中心和面积。后续框修改宽高时联动等比调整。生成输入各边为 720–2160 px，宽高比需在 1:3 至 3:1 之间，不会自动跟踪对象。</p>
                </aside>
            </div>
        </Modal>
        {paintFrame ? <CanvasNodePaintDialog dataUrl={paintFrame} layerOnly open onClose={() => setPaintFrame(null)} onConfirm={layer => { setSelection(previous => previous ? { ...previous, paintLayer: layer } : previous); setPaintFrame(null); }} /> : null}
        </>
    );
}
