import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { Image as ImageIcon, Pause, Play, Repeat, Volume2, VolumeX } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { captureVideoFilmstrip, captureVideoFrame, formatVideoTime, resolveVideoClipRange } from "@/lib/canvas/video-clip";
import { useThemeStore } from "@/stores/use-theme-store";

const MIN_CLIP_MS = 100;

type VideoPlayerHandle = {
    nodeId: string;
    selected: () => boolean;
    playing: () => boolean;
    playFromStart: () => void;
    pause: () => void;
};

const videoPlayers = new Map<string, VideoPlayerHandle>();
const videoPlayerListeners = new Set<() => void>();

function notifyVideoPlayers() {
    videoPlayerListeners.forEach((listener) => listener());
}

function registerVideoPlayer(handle: VideoPlayerHandle) {
    videoPlayers.set(handle.nodeId, handle);
    notifyVideoPlayers();
    return () => {
        if (videoPlayers.get(handle.nodeId) === handle) videoPlayers.delete(handle.nodeId);
        notifyVideoPlayers();
    };
}

function selectedVideoHandles() {
    return Array.from(videoPlayers.values()).filter((handle) => handle.selected());
}

function toggleLinkedVideoPlayback() {
    const group = selectedVideoHandles();
    if (group.length < 2) return false;
    if (group.every((handle) => handle.playing())) group.forEach((handle) => handle.pause());
    else group.forEach((handle) => handle.playFromStart());
    return true;
}

type ClipChange = {
    clipStartMs: number;
    clipEndMs: number;
    includeAudio: boolean;
};

type VideoPlayerContextValue = {
    src: string;
    videoRef: RefObject<HTMLVideoElement | null>;
    playing: boolean;
    currentMs: number;
    durationMs: number;
    clipStartMs: number;
    clipEndMs: number;
    includeAudio: boolean;
    loop: boolean;
    linkedCount: number;
    linkedPlaying: boolean;
    togglePlay: () => void;
    toggleLoop: () => void;
    seekMs: (ms: number) => void;
    previewMs: (ms: number) => void;
    commitClip: (startMs: number, endMs: number) => void;
    setIncludeAudio: (value: boolean) => void;
    captureFrame: () => Promise<Blob>;
};

const VideoPlayerContext = createContext<VideoPlayerContextValue | null>(null);

function useVideoPlayer() {
    const value = useContext(VideoPlayerContext);
    if (!value) throw new Error("CanvasVideoPlayerProvider missing");
    return value;
}

export function CanvasVideoPlayerProvider({
    nodeId,
    selected = false,
    src,
    clipStartMs,
    clipEndMs,
    includeAudio = true,
    onClipChange,
    children,
}: {
    nodeId: string;
    selected?: boolean;
    src: string;
    clipStartMs?: number;
    clipEndMs?: number;
    includeAudio?: boolean;
    onClipChange?: (next: ClipChange) => void;
    children: ReactNode;
}) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const seekingRef = useRef(false);
    const pendingMsRef = useRef<number | null>(null);
    const [playing, setPlaying] = useState(false);
    const [loop, setLoop] = useState(false);
    const [currentMs, setCurrentMs] = useState(clipStartMs || 0);
    const [durationMs, setDurationMs] = useState(0);
    const range = resolveVideoClipRange(durationMs, clipStartMs, clipEndMs);

    const applyTime = useCallback((ms: number) => {
        const video = videoRef.current;
        if (!video) return;
        setCurrentMs(ms);
        const next = Math.max(0, ms / 1000);
        if (seekingRef.current) {
            pendingMsRef.current = ms;
            return;
        }
        if (Math.abs(video.currentTime - next) < 0.001) return;
        seekingRef.current = true;
        video.currentTime = next;
    }, []);

    const playFromStart = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        applyTime(range.startMs);
        void video.play();
    }, [applyTime, range.startMs]);

    const pausePlayback = useCallback(() => {
        videoRef.current?.pause();
    }, []);

    const togglePlay = useCallback(() => {
        if (toggleLinkedVideoPlayback()) return;
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            const now = video.currentTime * 1000;
            if (now < range.startMs - 20 || now >= range.endMs - 20) applyTime(range.startMs);
            void video.play();
        } else {
            video.pause();
        }
    }, [applyTime, range.endMs, range.startMs]);

    const selectedRef = useRef(selected);
    const playingRef = useRef(playing);
    const playFromStartRef = useRef(playFromStart);
    const pausePlaybackRef = useRef(pausePlayback);
    selectedRef.current = selected;
    playingRef.current = playing;
    playFromStartRef.current = playFromStart;
    pausePlaybackRef.current = pausePlayback;

    useEffect(() => {
        return registerVideoPlayer({
            nodeId,
            selected: () => selectedRef.current,
            playing: () => playingRef.current,
            playFromStart: () => playFromStartRef.current(),
            pause: () => pausePlaybackRef.current(),
        });
    }, [nodeId]);

    useEffect(() => {
        notifyVideoPlayers();
    }, [playing, selected]);

    const [linkedCount, setLinkedCount] = useState(1);
    const [linkedPlaying, setLinkedPlaying] = useState(false);
    useEffect(() => {
        const sync = () => {
            const group = selectedVideoHandles();
            const count = selected ? group.length : 1;
            setLinkedCount(count);
            setLinkedPlaying(count >= 2 && group.every((handle) => handle.playing()));
        };
        sync();
        videoPlayerListeners.add(sync);
        return () => {
            videoPlayerListeners.delete(sync);
        };
    }, [nodeId, selected, playing]);

    const seekMs = useCallback(
        (ms: number) => {
            applyTime(Math.min(range.endMs, Math.max(range.startMs, ms)));
        },
        [applyTime, range.endMs, range.startMs],
    );

    const previewMs = useCallback(
        (ms: number) => {
            const video = videoRef.current;
            if (!video) return;
            if (!video.paused) video.pause();
            const maxMs = durationMs || ms;
            applyTime(Math.min(maxMs, Math.max(0, ms)));
        },
        [applyTime, durationMs],
    );

    const commitClip = useCallback(
        (startMs: number, endMs: number) => {
            const next = resolveVideoClipRange(durationMs || endMs, startMs, endMs);
            onClipChange?.({ clipStartMs: next.startMs, clipEndMs: next.endMs, includeAudio });
            const now = videoRef.current ? videoRef.current.currentTime * 1000 : next.startMs;
            if (now < next.startMs || now > next.endMs) applyTime(next.startMs);
        },
        [applyTime, durationMs, includeAudio, onClipChange],
    );

    const setIncludeAudio = useCallback(
        (value: boolean) => {
            onClipChange?.({ clipStartMs: range.startMs, clipEndMs: range.endMs, includeAudio: value });
        },
        [onClipChange, range.endMs, range.startMs],
    );

    const toggleLoop = useCallback(() => setLoop((value) => !value), []);

    const captureFrame = useCallback(async () => {
        const video = videoRef.current;
        if (!video) throw new Error("no video");
        return captureVideoFrame(video);
    }, []);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        video.muted = !includeAudio;
    }, [includeAudio]);

    const value = useMemo<VideoPlayerContextValue>(
        () => ({
            src,
            videoRef,
            playing,
            currentMs,
            durationMs,
            clipStartMs: range.startMs,
            clipEndMs: range.endMs,
            includeAudio,
            loop,
            linkedCount,
            linkedPlaying,
            togglePlay,
            toggleLoop,
            seekMs,
            previewMs,
            commitClip,
            setIncludeAudio,
            captureFrame,
        }),
        [captureFrame, commitClip, currentMs, durationMs, includeAudio, linkedCount, linkedPlaying, loop, playing, previewMs, range.endMs, range.startMs, seekMs, setIncludeAudio, src, toggleLoop, togglePlay],
    );

    return (
        <VideoPlayerContext.Provider value={value}>
            <VideoRuntime src={src} clipStartMs={range.startMs} clipEndMs={range.endMs} loop={loop} seekingRef={seekingRef} pendingMsRef={pendingMsRef} setPlaying={setPlaying} setCurrentMs={setCurrentMs} setDurationMs={setDurationMs} applyTime={applyTime} />
            {children}
        </VideoPlayerContext.Provider>
    );
}

function VideoRuntime({
    src,
    clipStartMs,
    clipEndMs,
    loop,
    seekingRef,
    pendingMsRef,
    setPlaying,
    setCurrentMs,
    setDurationMs,
    applyTime,
}: {
    src: string;
    clipStartMs: number;
    clipEndMs: number;
    loop: boolean;
    seekingRef: { current: boolean };
    pendingMsRef: { current: number | null };
    setPlaying: (value: boolean) => void;
    setCurrentMs: (value: number) => void;
    setDurationMs: (value: number) => void;
    applyTime: (ms: number) => void;
}) {
    const { videoRef } = useVideoPlayer();

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const restartClip = () => {
            applyTime(clipStartMs);
            if (video.paused) void video.play();
        };
        const onMeta = () => {
            const nextDuration = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0;
            setDurationMs(nextDuration);
            if (video.currentTime * 1000 < clipStartMs) applyTime(clipStartMs);
        };
        const onTime = () => {
            const ms = video.currentTime * 1000;
            setCurrentMs(ms);
            if (video.paused || seekingRef.current) return;
            if (ms >= clipEndMs - 16) {
                if (loop) restartClip();
                else {
                    video.pause();
                    applyTime(clipEndMs);
                }
            }
        };
        const onEnded = () => {
            if (loop) restartClip();
            else applyTime(clipEndMs);
        };
        const onSeeked = () => {
            seekingRef.current = false;
            const pending = pendingMsRef.current;
            pendingMsRef.current = null;
            if (pending != null) applyTime(pending);
        };
        const onPlay = () => setPlaying(true);
        const onPause = () => setPlaying(false);
        video.addEventListener("loadedmetadata", onMeta);
        video.addEventListener("timeupdate", onTime);
        video.addEventListener("ended", onEnded);
        video.addEventListener("play", onPlay);
        video.addEventListener("pause", onPause);
        video.addEventListener("seeked", onSeeked);
        if (video.readyState >= 1) onMeta();
        return () => {
            video.removeEventListener("loadedmetadata", onMeta);
            video.removeEventListener("timeupdate", onTime);
            video.removeEventListener("ended", onEnded);
            video.removeEventListener("play", onPlay);
            video.removeEventListener("pause", onPause);
            video.removeEventListener("seeked", onSeeked);
        };
    }, [applyTime, clipEndMs, clipStartMs, loop, pendingMsRef, seekingRef, setCurrentMs, setDurationMs, setPlaying, src, videoRef]);

    return null;
}

export function CanvasVideoSurface({ className }: { className?: string }) {
    const { src, videoRef } = useVideoPlayer();
    return <video ref={videoRef} src={src} className={className} playsInline preload="auto" draggable={false} />;
}

export function CanvasVideoDock({ onCaptureFrame }: { onCaptureFrame?: (blob: Blob) => void | Promise<void> }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { src, playing, currentMs, durationMs, clipStartMs, clipEndMs, includeAudio, loop, linkedCount, linkedPlaying, togglePlay, toggleLoop, seekMs, previewMs, commitClip, setIncludeAudio, captureFrame } = useVideoPlayer();
    const showPause = linkedCount >= 2 ? linkedPlaying : playing;
    const trackRef = useRef<HTMLDivElement>(null);
    const [draft, setDraft] = useState<{ startMs: number; endMs: number } | null>(null);
    const [capturing, setCapturing] = useState(false);
    const [frames, setFrames] = useState<string[]>([]);
    const start = draft?.startMs ?? clipStartMs;
    const end = draft?.endMs ?? clipEndMs;
    const span = Math.max(1, durationMs);

    useEffect(() => {
        if (!src) return;
        let cancelled = false;
        void captureVideoFilmstrip(src)
            .then((next) => {
                if (!cancelled) setFrames(next);
            })
            .catch(() => {
                if (!cancelled) setFrames([]);
            });
        return () => {
            cancelled = true;
        };
    }, [src]);

    const ratioFromClientX = (clientX: number) => {
        const box = trackRef.current?.getBoundingClientRect();
        if (!box?.width) return 0;
        return Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    };

    const stopPrimary = (event: { button: number; stopPropagation: () => void }) => {
        if (event.button !== 0) return;
        event.stopPropagation();
    };

    const startSeek = (event: ReactPointerEvent) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        seekMs(ratioFromClientX(event.clientX) * span);
        const move = (next: PointerEvent) => {
            if (next.pointerId !== event.pointerId) return;
            seekMs(ratioFromClientX(next.clientX) * span);
        };
        const stop = (next: PointerEvent) => {
            if (next.pointerId !== event.pointerId) return;
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
    };

    const startHandle = (edge: "start" | "end", event: ReactPointerEvent) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        let nextStart = start;
        let nextEnd = end;
        previewMs(edge === "start" ? nextStart : nextEnd);
        const move = (next: PointerEvent) => {
            if (next.pointerId !== event.pointerId) return;
            const ms = ratioFromClientX(next.clientX) * span;
            if (edge === "start") nextStart = Math.min(ms, nextEnd - MIN_CLIP_MS);
            else nextEnd = Math.max(ms, nextStart + MIN_CLIP_MS);
            setDraft({ startMs: nextStart, endMs: nextEnd });
            previewMs(edge === "start" ? nextStart : nextEnd);
        };
        const stop = (next: PointerEvent) => {
            if (next.pointerId !== event.pointerId) return;
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
            commitClip(nextStart, nextEnd);
            previewMs(edge === "start" ? nextStart : nextEnd);
            setDraft(null);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
    };

    return (
        <div
            className="pointer-events-auto w-full rounded-2xl border px-2.5 py-2 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={stopPrimary}
            onPointerDown={stopPrimary}
        >
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    className="grid size-8 place-items-center rounded-lg transition hover:bg-black/5 dark:hover:bg-white/10"
                    style={linkedCount >= 2 || showPause ? { background: theme.toolbar.activeBg } : undefined}
                    title={linkedCount >= 2 ? (showPause ? t("canvas.videoPlayer.pauseTogether") : t("canvas.videoPlayer.playTogether")) : showPause ? t("canvas.videoPlayer.pause") : t("canvas.videoPlayer.play")}
                    onClick={(event) => {
                        event.stopPropagation();
                        togglePlay();
                    }}
                >
                    {showPause ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                </button>
                <button
                    type="button"
                    className="grid size-8 place-items-center rounded-lg transition hover:bg-black/5 dark:hover:bg-white/10"
                    style={loop ? { background: theme.toolbar.activeBg } : undefined}
                    title={loop ? t("canvas.videoPlayer.loopOn") : t("canvas.videoPlayer.loopOff")}
                    onClick={(event) => {
                        event.stopPropagation();
                        toggleLoop();
                    }}
                >
                    <Repeat className="size-3.5" />
                </button>
                <span className="min-w-0 flex-1 text-[10px] tabular-nums opacity-70">
                    {formatVideoTime(currentMs)} / {formatVideoTime(end - start)}
                </span>
                <button
                    type="button"
                    className="grid size-8 place-items-center rounded-lg transition hover:bg-black/5 dark:hover:bg-white/10"
                    style={includeAudio ? { background: theme.toolbar.activeBg } : undefined}
                    title={includeAudio ? t("canvas.videoPlayer.includeAudio") : t("canvas.videoPlayer.muteAudio")}
                    onClick={(event) => {
                        event.stopPropagation();
                        setIncludeAudio(!includeAudio);
                    }}
                >
                    {includeAudio ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
                </button>
                <button
                    type="button"
                    className="grid size-8 place-items-center rounded-lg transition hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50"
                    title={t("canvas.videoPlayer.captureFrame")}
                    disabled={capturing}
                    onClick={(event) => {
                        event.stopPropagation();
                        setCapturing(true);
                        void captureFrame()
                            .then((blob) => onCaptureFrame?.(blob))
                            .finally(() => setCapturing(false));
                    }}
                >
                    <ImageIcon className="size-3.5" />
                </button>
            </div>
            <div className="mt-2 px-1">
                <div ref={trackRef} className="relative h-11 cursor-pointer touch-none" onPointerDown={startSeek}>
                    <div className="absolute inset-0 overflow-hidden rounded-lg" style={{ background: theme.node.stroke }}>
                        <div className="absolute inset-0 flex">
                            {(frames.length ? frames : Array.from({ length: 12 }, () => "")).map((frame, index) =>
                                frame ? <img key={index} src={frame} alt="" draggable={false} className="h-full min-w-0 flex-1 object-cover" /> : <span key={index} className="h-full min-w-0 flex-1" style={{ background: theme.node.fill }} />,
                            )}
                        </div>
                        <div className="pointer-events-none absolute inset-y-0 left-0" style={{ width: `${(start / span) * 100}%`, background: "color-mix(in srgb, var(--color-black, #000) 55%, transparent)" }} />
                        <div className="pointer-events-none absolute inset-y-0 right-0" style={{ width: `${Math.max(0, 100 - (end / span) * 100)}%`, background: "color-mix(in srgb, var(--color-black, #000) 55%, transparent)" }} />
                    </div>
                    <span className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 shadow" style={{ left: `${(currentMs / span) * 100}%`, background: theme.node.text }} />
                    <button
                        type="button"
                        className="absolute top-0 z-20 h-full w-4 -translate-x-1/2 touch-none"
                        style={{ left: `${(start / span) * 100}%` }}
                        title={t("canvas.videoPlayer.clipStart")}
                        onPointerDown={(event) => startHandle("start", event)}
                    >
                        <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full shadow" style={{ background: theme.node.text }} />
                        <span className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow" style={{ background: theme.node.text, border: `1px solid ${theme.node.stroke}` }} />
                    </button>
                    <button
                        type="button"
                        className="absolute top-0 z-20 h-full w-4 -translate-x-1/2 touch-none"
                        style={{ left: `${(end / span) * 100}%` }}
                        title={t("canvas.videoPlayer.clipEnd")}
                        onPointerDown={(event) => startHandle("end", event)}
                    >
                        <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full shadow" style={{ background: theme.node.text }} />
                        <span className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow" style={{ background: theme.node.text, border: `1px solid ${theme.node.stroke}` }} />
                    </button>
                </div>
            </div>
        </div>
    );
}
