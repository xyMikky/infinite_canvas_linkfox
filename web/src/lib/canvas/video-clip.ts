import i18n from "@/i18n";
import { getMediaBlob, readVideoFileMeta, uploadMediaFile } from "@/services/file-storage";
import type { ReferenceVideo } from "@/types/media";

const MIN_CLIP_MS = 100;
const CLIP_EPS_MS = 80;
export const CANVAS_VIDEO_MAX_DURATION_MS = 30_000;

export async function assertCanvasVideoDuration(file: Blob) {
    const meta = await readVideoFileMeta(file);
    if ((meta.durationMs || 0) > CANVAS_VIDEO_MAX_DURATION_MS) {
        throw new Error(i18n.t("canvas.videoPlayer.tooLong"));
    }
}

export function formatVideoTime(ms: number) {
    const safe = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function resolveVideoClipRange(durationMs: number, startMs?: number, endMs?: number) {
    const duration = Math.max(0, durationMs);
    const start = Math.min(Math.max(0, startMs ?? 0), Math.max(0, duration - MIN_CLIP_MS));
    const end = Math.min(duration, Math.max(start + MIN_CLIP_MS, endMs ?? duration));
    return { startMs: start, endMs: end };
}

export function videoClipNeedsRemux(video: ReferenceVideo) {
    const duration = video.durationMs || video.clipEndMs || 0;
    const { startMs, endMs } = resolveVideoClipRange(duration, video.clipStartMs, video.clipEndMs);
    const clipped = duration > 0 && (startMs > CLIP_EPS_MS || endMs < duration - CLIP_EPS_MS);
    return clipped || video.includeAudio === false;
}

export function videoClipCacheKey(video: ReferenceVideo) {
    const { startMs, endMs } = resolveVideoClipRange(video.durationMs || video.clipEndMs || 0, video.clipStartMs, video.clipEndMs);
    return `${video.storageKey || video.url}:${startMs}:${endMs}:${video.includeAudio === false ? 0 : 1}`;
}

const remuxCache = new Map<string, ReferenceVideo>();
const remuxBlobCache = new Map<string, Blob>();

export async function getClippedVideoBlob(video: ReferenceVideo): Promise<Blob> {
    if (!videoClipNeedsRemux(video)) return readVideoBlob(video);
    const cacheKey = videoClipCacheKey(video);
    const cachedRef = remuxCache.get(cacheKey);
    if (cachedRef) return readVideoBlob(cachedRef);
    const cachedBlob = remuxBlobCache.get(cacheKey);
    if (cachedBlob) return cachedBlob;
    const source = await readVideoBlob(video);
    const { startMs, endMs } = resolveVideoClipRange(video.durationMs || video.clipEndMs || 0, video.clipStartMs, video.clipEndMs);
    const blob = await remuxVideoClip(source, startMs, endMs, video.includeAudio !== false);
    remuxBlobCache.set(cacheKey, blob);
    return blob;
}

/** 下载用：优先按入出点裁剪；裁剪失败时回退完整原片 */
export async function getVideoDownloadBlob(video: ReferenceVideo): Promise<{ blob: Blob; fellBack: boolean }> {
    if (!videoClipNeedsRemux(video)) {
        return { blob: await readVideoBlob(video), fellBack: false };
    }
    try {
        return { blob: await getClippedVideoBlob(video), fellBack: false };
    } catch {
        return {
            blob: await readVideoBlob({ ...video, clipStartMs: undefined, clipEndMs: undefined, includeAudio: true }),
            fellBack: true,
        };
    }
}

export async function prepareReferenceVideo(video: ReferenceVideo): Promise<ReferenceVideo> {
    if (!videoClipNeedsRemux(video)) return video;
    const cacheKey = videoClipCacheKey(video);
    const cached = remuxCache.get(cacheKey);
    if (cached) return cached;
    const { startMs, endMs } = resolveVideoClipRange(video.durationMs || video.clipEndMs || 0, video.clipStartMs, video.clipEndMs);
    const blob = await getClippedVideoBlob(video);
    const uploaded = await uploadMediaFile(blob, "video-clip");
    const next: ReferenceVideo = {
        ...video,
        name: video.name.replace(/(\.[a-z0-9]+)?$/i, "-clip.mp4"),
        type: uploaded.mimeType || "video/mp4",
        url: uploaded.url,
        storageKey: uploaded.storageKey,
        bytes: uploaded.bytes,
        durationMs: uploaded.durationMs || endMs - startMs,
        width: uploaded.width || video.width,
        height: uploaded.height || video.height,
        clipStartMs: undefined,
        clipEndMs: undefined,
        includeAudio: true,
    };
    remuxCache.set(cacheKey, next);
    return next;
}

export async function captureVideoFrame(video: HTMLVideoElement): Promise<Blob> {
    if (!video.videoWidth || !video.videoHeight) throw new Error(i18n.t("canvas.videoPlayer.frameFailed"));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(i18n.t("canvas.videoPlayer.frameFailed"));
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error(i18n.t("canvas.videoPlayer.frameFailed"));
    return blob;
}

const FILMSTRIP_COUNT = 12;
const filmstripCache = new Map<string, string[]>();

export async function captureVideoFilmstrip(src: string, count = FILMSTRIP_COUNT): Promise<string[]> {
    const cached = filmstripCache.get(src);
    if (cached) return cached;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = src;
    await new Promise<void>((resolve, reject) => {
        const done = () => resolve();
        video.onloadeddata = done;
        video.onerror = () => reject(new Error(i18n.t("canvas.videoPlayer.frameFailed")));
        if (video.readyState >= 2) done();
    });
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0 || !video.videoWidth) return [];
    const canvas = document.createElement("canvas");
    const width = 72;
    canvas.width = width;
    canvas.height = Math.max(1, Math.round((width * video.videoHeight) / video.videoWidth));
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];
    const frames: string[] = [];
    for (let i = 0; i < count; i++) {
        await seekVideoElement(video, ((i + 0.5) / count) * duration * 0.999);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
            frames.push(canvas.toDataURL("image/jpeg", 0.62));
        } catch {
            break;
        }
    }
    video.src = "";
    if (frames.length) filmstripCache.set(src, frames);
    return frames;
}

function seekVideoElement(video: HTMLVideoElement, time: number) {
    return new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            video.removeEventListener("seeked", done);
            resolve();
        };
        video.addEventListener("seeked", done);
        video.currentTime = time;
        window.setTimeout(done, 700);
    });
}

async function readVideoBlob(video: ReferenceVideo) {
    if (video.storageKey) {
        const stored = await getMediaBlob(video.storageKey);
        if (stored) return stored;
    }
    if (video.url) {
        const response = await fetch(video.url);
        if (response.ok) return response.blob();
    }
    throw new Error(i18n.t("canvas.videoPlayer.clipFailed"));
}

async function remuxVideoClip(source: Blob, startMs: number, endMs: number, includeAudio: boolean) {
    const ffmpeg = await loadFfmpeg();
    const inputName = "input.mp4";
    const outputName = "output.mp4";
    const { fetchFile } = await import("@ffmpeg/util");
    const remove = async (name: string) => {
        try {
            await ffmpeg.deleteFile(name);
        } catch {
            /* ignore missing */
        }
    };
    await remove(inputName);
    await remove(outputName);
    await ffmpeg.writeFile(inputName, await fetchFile(source));
    const startSec = Math.max(0, startMs / 1000);
    const durationSec = Math.max(0.1, (endMs - startMs) / 1000);
    const attempts = [
        ["-ss", startSec.toFixed(3), "-i", inputName, "-t", durationSec.toFixed(3), "-c", "copy", ...(includeAudio ? [] : ["-an"]), "-avoid_negative_ts", "make_zero", outputName],
        ["-ss", startSec.toFixed(3), "-i", inputName, "-t", durationSec.toFixed(3), "-c:v", "mpeg4", "-q:v", "5", ...(includeAudio ? ["-c:a", "aac"] : ["-an"]), outputName],
    ];
    let lastError: unknown;
    for (const args of attempts) {
        await remove(outputName);
        try {
            await ffmpeg.exec(args);
            const blob = await readFfmpegOutput(ffmpeg, outputName);
            if (blob.size > 0) {
                await remove(inputName);
                await remove(outputName);
                return blob;
            }
        } catch (error) {
            lastError = error;
        }
    }
    await remove(inputName);
    await remove(outputName);
    throw lastError instanceof Error ? lastError : new Error(i18n.t("canvas.videoPlayer.clipFailed"));
}

async function readFfmpegOutput(ffmpeg: Awaited<ReturnType<typeof loadFfmpeg>>, outputName: string) {
    const data = await ffmpeg.readFile(outputName);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return new Blob([copy], { type: "video/mp4" });
}

let ffmpegLoader: Promise<import("@ffmpeg/ffmpeg").FFmpeg> | null = null;

export async function loadFfmpeg() {
    if (!ffmpegLoader) {
        ffmpegLoader = (async () => {
            const { FFmpeg } = await import("@ffmpeg/ffmpeg");
            const { toBlobURL } = await import("@ffmpeg/util");
            const ffmpeg = new FFmpeg();
            const base = new URL(`${import.meta.env.BASE_URL}ffmpeg/`, window.location.href).href.replace(/\/+$/, "");
            await ffmpeg.load({
                coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
                wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
            });
            return ffmpeg;
        })().catch((error) => {
            ffmpegLoader = null;
            throw error instanceof Error ? error : new Error(i18n.t("canvas.videoPlayer.clipFailed"));
        });
    }
    return ffmpegLoader;
}
