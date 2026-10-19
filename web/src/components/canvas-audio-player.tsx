import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Pause, Play, Repeat } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { captureAudioWaveform, resolveAudioClipRange } from "@/lib/canvas/audio-clip";
import { formatVideoTime } from "@/lib/canvas/video-clip";
import { useThemeStore } from "@/stores/use-theme-store";

const MIN_CLIP_MS = 100;

type AudioPlayerHandle = {
    nodeId: string;
    selected: () => boolean;
    playing: () => boolean;
    playFromStart: () => void;
    pause: () => void;
};

const audioPlayers = new Map<string, AudioPlayerHandle>();
const audioPlayerListeners = new Set<() => void>();

function notifyAudioPlayers() {
    audioPlayerListeners.forEach((listener) => listener());
}

function registerAudioPlayer(handle: AudioPlayerHandle) {
    audioPlayers.set(handle.nodeId, handle);
    notifyAudioPlayers();
    return () => {
        if (audioPlayers.get(handle.nodeId) === handle) audioPlayers.delete(handle.nodeId);
        notifyAudioPlayers();
    };
}

function selectedAudioHandles() {
    return Array.from(audioPlayers.values()).filter((handle) => handle.selected());
}

function toggleLinkedAudioPlayback() {
    const group = selectedAudioHandles();
    if (group.length < 2) return false;
    if (group.every((handle) => handle.playing())) group.forEach((handle) => handle.pause());
    else group.forEach((handle) => handle.playFromStart());
    return true;
}

type ClipChange = { clipStartMs: number; clipEndMs: number };

type AudioPlayerContextValue = {
    src: string;
    playing: boolean;
    currentMs: number;
    durationMs: number;
    clipStartMs: number;
    clipEndMs: number;
    loop: boolean;
    peaks: number[];
    linkedCount: number;
    linkedPlaying: boolean;
    togglePlay: () => void;
    toggleLoop: () => void;
    seekMs: (ms: number) => void;
    previewMs: (ms: number) => void;
    commitClip: (startMs: number, endMs: number) => void;
};

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

function useAudioPlayer() {
    const value = useContext(AudioPlayerContext);
    if (!value) throw new Error("CanvasAudioPlayerProvider missing");
    return value;
}

export function CanvasAudioPlayerProvider({
    nodeId,
    selected = false,
    src,
    clipStartMs,
    clipEndMs,
    onClipChange,
    children,
}: {
    nodeId: string;
    selected?: boolean;
    src: string;
    clipStartMs?: number;
    clipEndMs?: number;
    onClipChange?: (next: ClipChange) => void;
    children: ReactNode;
}) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const seekingRef = useRef(false);
    const pendingMsRef = useRef<number | null>(null);
    const [playing, setPlaying] = useState(false);
    const [loop, setLoop] = useState(false);
    const [currentMs, setCurrentMs] = useState(clipStartMs || 0);
    const [durationMs, setDurationMs] = useState(0);
    const [peaks, setPeaks] = useState<number[]>([]);
    const range = resolveAudioClipRange(durationMs, clipStartMs, clipEndMs);

    const applyTime = useCallback((ms: number) => {
        const audio = audioRef.current;
        if (!audio) return;
        setCurrentMs(ms);
        const next = Math.max(0, ms / 1000);
        if (seekingRef.current) {
            pendingMsRef.current = ms;
            return;
        }
        if (Math.abs(audio.currentTime - next) < 0.001) return;
        seekingRef.current = true;
        audio.currentTime = next;
    }, []);

    const playFromStart = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) return;
        applyTime(range.startMs);
        void audio.play();
    }, [applyTime, range.startMs]);

    const pausePlayback = useCallback(() => {
        audioRef.current?.pause();
    }, []);

    const togglePlay = useCallback(() => {
        if (toggleLinkedAudioPlayback()) return;
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.paused) {
            const now = audio.currentTime * 1000;
            if (now < range.startMs - 20 || now >= range.endMs - 20) applyTime(range.startMs);
            void audio.play();
        } else {
            audio.pause();
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
        return registerAudioPlayer({
            nodeId,
            selected: () => selectedRef.current,
            playing: () => playingRef.current,
            playFromStart: () => playFromStartRef.current(),
            pause: () => pausePlaybackRef.current(),
        });
    }, [nodeId]);

    useEffect(() => {
        notifyAudioPlayers();
    }, [playing, selected]);

    const [linkedCount, setLinkedCount] = useState(1);
    const [linkedPlaying, setLinkedPlaying] = useState(false);
    useEffect(() => {
        const sync = () => {
            const group = selectedAudioHandles();
            const count = selected ? group.length : 1;
            setLinkedCount(count);
            setLinkedPlaying(count >= 2 && group.every((handle) => handle.playing()));
        };
        sync();
        audioPlayerListeners.add(sync);
        return () => {
            audioPlayerListeners.delete(sync);
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
            const audio = audioRef.current;
            if (!audio) return;
            if (!audio.paused) audio.pause();
            const maxMs = durationMs || ms;
            applyTime(Math.min(maxMs, Math.max(0, ms)));
        },
        [applyTime, durationMs],
    );

    const commitClip = useCallback(
        (startMs: number, endMs: number) => {
            const next = resolveAudioClipRange(durationMs || endMs, startMs, endMs);
            onClipChange?.({ clipStartMs: next.startMs, clipEndMs: next.endMs });
            const now = audioRef.current ? audioRef.current.currentTime * 1000 : next.startMs;
            if (now < next.startMs || now > next.endMs) applyTime(next.startMs);
        },
        [applyTime, durationMs, onClipChange],
    );

    const toggleLoop = useCallback(() => setLoop((value) => !value), []);

    useEffect(() => {
        if (!src) return;
        let cancelled = false;
        void captureAudioWaveform(src)
            .then((next) => {
                if (!cancelled) setPeaks(next);
            })
            .catch(() => {
                if (!cancelled) setPeaks([]);
            });
        return () => {
            cancelled = true;
        };
    }, [src]);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        const restartClip = () => {
            applyTime(range.startMs);
            if (audio.paused) void audio.play();
        };
        const onMeta = () => {
            const nextDuration = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0;
            setDurationMs(nextDuration);
            if (audio.currentTime * 1000 < range.startMs) applyTime(range.startMs);
        };
        const onTime = () => {
            const ms = audio.currentTime * 1000;
            setCurrentMs(ms);
            if (audio.paused || seekingRef.current) return;
            if (ms >= range.endMs - 16) {
                if (loop) restartClip();
                else {
                    audio.pause();
                    applyTime(range.endMs);
                }
            }
        };
        const onEnded = () => {
            if (loop) restartClip();
            else applyTime(range.endMs);
        };
        const onSeeked = () => {
            seekingRef.current = false;
            const pending = pendingMsRef.current;
            pendingMsRef.current = null;
            if (pending != null) applyTime(pending);
        };
        const onPlay = () => setPlaying(true);
        const onPause = () => setPlaying(false);
        audio.addEventListener("loadedmetadata", onMeta);
        audio.addEventListener("timeupdate", onTime);
        audio.addEventListener("ended", onEnded);
        audio.addEventListener("play", onPlay);
        audio.addEventListener("pause", onPause);
        audio.addEventListener("seeked", onSeeked);
        if (audio.readyState >= 1) onMeta();
        return () => {
            audio.removeEventListener("loadedmetadata", onMeta);
            audio.removeEventListener("timeupdate", onTime);
            audio.removeEventListener("ended", onEnded);
            audio.removeEventListener("play", onPlay);
            audio.removeEventListener("pause", onPause);
            audio.removeEventListener("seeked", onSeeked);
        };
    }, [applyTime, loop, range.endMs, range.startMs, src]);

    const value = useMemo<AudioPlayerContextValue>(
        () => ({
            src,
            playing,
            currentMs,
            durationMs,
            clipStartMs: range.startMs,
            clipEndMs: range.endMs,
            loop,
            peaks,
            linkedCount,
            linkedPlaying,
            togglePlay,
            toggleLoop,
            seekMs,
            previewMs,
            commitClip,
        }),
        [commitClip, currentMs, durationMs, linkedCount, linkedPlaying, loop, peaks, playing, previewMs, range.endMs, range.startMs, seekMs, src, toggleLoop, togglePlay],
    );

    return (
        <AudioPlayerContext.Provider value={value}>
            <audio ref={audioRef} src={src} preload="auto" className="hidden" />
            {children}
        </AudioPlayerContext.Provider>
    );
}

export function CanvasAudioSurface({ title }: { title?: string }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { playing, currentMs, durationMs, clipStartMs, clipEndMs, peaks, togglePlay } = useAudioPlayer();
    const span = Math.max(1, durationMs);
    return (
        <div
            className="flex h-full w-full flex-col justify-center gap-2 px-4"
            style={{ background: theme.node.fill, color: theme.node.text }}
            onDoubleClick={(event) => {
                event.stopPropagation();
                togglePlay();
            }}
        >
            <div className="flex min-w-0 items-center gap-2 text-sm opacity-70">
                <button
                    type="button"
                    className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10"
                    title={playing ? t("canvas.audioPlayer.pause") : t("canvas.audioPlayer.play")}
                    onClick={(event) => {
                        event.stopPropagation();
                        togglePlay();
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                </button>
                <span className="truncate">{title || t("canvas.node.audio")}</span>
                <span className="ml-auto shrink-0 text-[10px] tabular-nums">{formatVideoTime(currentMs)}</span>
            </div>
            <WaveformBars peaks={peaks} startMs={clipStartMs} endMs={clipEndMs} currentMs={currentMs} span={span} height={36} />
        </div>
    );
}

export function CanvasAudioDock() {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { playing, currentMs, durationMs, clipStartMs, clipEndMs, loop, peaks, linkedCount, linkedPlaying, togglePlay, toggleLoop, seekMs, previewMs, commitClip } = useAudioPlayer();
    const showPause = linkedCount >= 2 ? linkedPlaying : playing;
    const trackRef = useRef<HTMLDivElement>(null);
    const [draft, setDraft] = useState<{ startMs: number; endMs: number } | null>(null);
    const start = draft?.startMs ?? clipStartMs;
    const end = draft?.endMs ?? clipEndMs;
    const span = Math.max(1, durationMs);

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
                    title={linkedCount >= 2 ? (showPause ? t("canvas.audioPlayer.pauseTogether") : t("canvas.audioPlayer.playTogether")) : showPause ? t("canvas.audioPlayer.pause") : t("canvas.audioPlayer.play")}
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
                    title={loop ? t("canvas.audioPlayer.loopOn") : t("canvas.audioPlayer.loopOff")}
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
            </div>
            <div className="mt-2 px-1">
                <div ref={trackRef} className="relative h-11 cursor-pointer touch-none" onPointerDown={startSeek}>
                    <div className="absolute inset-0 overflow-hidden rounded-lg px-1" style={{ background: theme.node.stroke }}>
                        <WaveformBars peaks={peaks} startMs={start} endMs={end} currentMs={currentMs} span={span} height={44} />
                    </div>
                    <span className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 shadow" style={{ left: `${(currentMs / span) * 100}%`, background: theme.node.text }} />
                    <button
                        type="button"
                        className="absolute top-0 z-20 h-full w-4 -translate-x-1/2 touch-none"
                        style={{ left: `${(start / span) * 100}%` }}
                        title={t("canvas.audioPlayer.clipStart")}
                        onPointerDown={(event) => startHandle("start", event)}
                    >
                        <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full shadow" style={{ background: theme.node.text }} />
                        <span className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow" style={{ background: theme.node.text, border: `1px solid ${theme.node.stroke}` }} />
                    </button>
                    <button
                        type="button"
                        className="absolute top-0 z-20 h-full w-4 -translate-x-1/2 touch-none"
                        style={{ left: `${(end / span) * 100}%` }}
                        title={t("canvas.audioPlayer.clipEnd")}
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

function WaveformBars({ peaks, startMs, endMs, currentMs, span, height }: { peaks: number[]; startMs: number; endMs: number; currentMs: number; span: number; height: number }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const bars = peaks.length ? peaks : Array.from({ length: 48 }, () => 0.18);
    return (
        <div className="flex h-full w-full items-center gap-px">
            {bars.map((peak, index) => {
                const t = (index + 0.5) / bars.length;
                const ms = t * span;
                const inClip = ms >= startMs && ms <= endMs;
                const played = ms <= currentMs;
                return (
                    <span
                        key={index}
                        className="min-w-0 flex-1 rounded-full"
                        style={{
                            height: Math.max(3, peak * height * 0.86),
                            background: inClip ? theme.node.text : theme.node.placeholder,
                            opacity: inClip ? (played ? 0.95 : 0.42) : 0.18,
                        }}
                    />
                );
            })}
        </div>
    );
}
