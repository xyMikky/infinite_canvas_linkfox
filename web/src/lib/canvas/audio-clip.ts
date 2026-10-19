import i18n from "@/i18n";
import { getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import type { ReferenceAudio } from "@/types/media";

import { loadFfmpeg, resolveVideoClipRange } from "./video-clip";

const CLIP_EPS_MS = 80;
const WAVEFORM_BARS = 80;
const waveformCache = new Map<string, number[]>();
const remuxCache = new Map<string, ReferenceAudio>();
const remuxBlobCache = new Map<string, Blob>();

export const resolveAudioClipRange = resolveVideoClipRange;

export function audioClipNeedsRemux(audio: ReferenceAudio) {
    const duration = audio.durationMs || audio.clipEndMs || 0;
    const { startMs, endMs } = resolveAudioClipRange(duration, audio.clipStartMs, audio.clipEndMs);
    return duration > 0 && (startMs > CLIP_EPS_MS || endMs < duration - CLIP_EPS_MS);
}

export function audioClipCacheKey(audio: ReferenceAudio) {
    const { startMs, endMs } = resolveAudioClipRange(audio.durationMs || audio.clipEndMs || 0, audio.clipStartMs, audio.clipEndMs);
    return `${audio.storageKey || audio.url}:${startMs}:${endMs}`;
}

export async function getClippedAudioBlob(audio: ReferenceAudio): Promise<Blob> {
    if (!audioClipNeedsRemux(audio)) return readAudioBlob(audio);
    const cacheKey = audioClipCacheKey(audio);
    const cachedRef = remuxCache.get(cacheKey);
    if (cachedRef) return readAudioBlob(cachedRef);
    const cachedBlob = remuxBlobCache.get(cacheKey);
    if (cachedBlob) return cachedBlob;
    const source = await readAudioBlob(audio);
    const { startMs, endMs } = resolveAudioClipRange(audio.durationMs || audio.clipEndMs || 0, audio.clipStartMs, audio.clipEndMs);
    const blob = await remuxAudioClip(source, startMs, endMs, audio.type);
    remuxBlobCache.set(cacheKey, blob);
    return blob;
}

export async function getAudioDownloadBlob(audio: ReferenceAudio): Promise<{ blob: Blob; fellBack: boolean }> {
    if (!audioClipNeedsRemux(audio)) return { blob: await readAudioBlob(audio), fellBack: false };
    try {
        return { blob: await getClippedAudioBlob(audio), fellBack: false };
    } catch {
        return { blob: await readAudioBlob({ ...audio, clipStartMs: undefined, clipEndMs: undefined }), fellBack: true };
    }
}

export async function prepareReferenceAudio(audio: ReferenceAudio): Promise<ReferenceAudio> {
    if (!audioClipNeedsRemux(audio)) return audio;
    const cacheKey = audioClipCacheKey(audio);
    const cached = remuxCache.get(cacheKey);
    if (cached) return cached;
    const { startMs, endMs } = resolveAudioClipRange(audio.durationMs || audio.clipEndMs || 0, audio.clipStartMs, audio.clipEndMs);
    const blob = await getClippedAudioBlob(audio);
    const uploaded = await uploadMediaFile(blob, "audio-clip");
    const next: ReferenceAudio = {
        ...audio,
        name: audio.name.replace(/(\.[a-z0-9]+)?$/i, `-clip.${audioFileExt(blob.type || audio.type)}`),
        type: uploaded.mimeType || blob.type || audio.type,
        url: uploaded.url,
        storageKey: uploaded.storageKey,
        bytes: uploaded.bytes,
        durationMs: uploaded.durationMs || endMs - startMs,
        clipStartMs: undefined,
        clipEndMs: undefined,
    };
    remuxCache.set(cacheKey, next);
    return next;
}

export async function captureAudioWaveform(src: string, bars = WAVEFORM_BARS): Promise<number[]> {
    const cached = waveformCache.get(src);
    if (cached) return cached;
    const response = await fetch(src);
    if (!response.ok) return [];
    const data = await response.arrayBuffer();
    const ctx = new AudioContext();
    try {
        const buffer = await ctx.decodeAudioData(data.slice(0));
        const channel = buffer.getChannelData(0);
        const step = Math.max(1, Math.floor(channel.length / bars));
        const peaks: number[] = [];
        for (let i = 0; i < bars; i++) {
            let max = 0;
            const start = i * step;
            const end = Math.min(channel.length, start + step);
            for (let j = start; j < end; j += 8) max = Math.max(max, Math.abs(channel[j] || 0));
            peaks.push(max);
        }
        const peak = Math.max(...peaks, 0.001);
        const normalized = peaks.map((value) => value / peak);
        waveformCache.set(src, normalized);
        return normalized;
    } catch {
        return [];
    } finally {
        void ctx.close();
    }
}

async function readAudioBlob(audio: ReferenceAudio) {
    if (audio.storageKey) {
        const stored = await getMediaBlob(audio.storageKey);
        if (stored) return stored;
    }
    if (audio.url) {
        const response = await fetch(audio.url);
        if (response.ok) return response.blob();
    }
    throw new Error(i18n.t("canvas.audioPlayer.clipFailed"));
}

function audioFileExt(mimeType?: string) {
    if (mimeType?.includes("wav")) return "wav";
    if (mimeType?.includes("flac")) return "flac";
    if (mimeType?.includes("mp4") || mimeType?.includes("m4a") || mimeType?.includes("aac")) return "m4a";
    if (mimeType?.includes("ogg") || mimeType?.includes("opus")) return "ogg";
    return "mp3";
}

function audioMime(ext: string) {
    if (ext === "wav") return "audio/wav";
    if (ext === "flac") return "audio/flac";
    if (ext === "m4a") return "audio/mp4";
    if (ext === "ogg") return "audio/ogg";
    return "audio/mpeg";
}

async function remuxAudioClip(source: Blob, startMs: number, endMs: number, mimeType?: string) {
    const ffmpeg = await loadFfmpeg();
    const ext = audioFileExt(mimeType || source.type);
    const inputName = `input.${ext}`;
    const { fetchFile } = await import("@ffmpeg/util");
    const remove = async (name: string) => {
        try {
            await ffmpeg.deleteFile(name);
        } catch {
            /* ignore missing */
        }
    };
    await remove(inputName);
    await ffmpeg.writeFile(inputName, await fetchFile(source));
    const startSec = Math.max(0, startMs / 1000);
    const durationSec = Math.max(0.1, (endMs - startMs) / 1000);
    const attempts: Array<{ args: string[]; output: string; type: string }> = [
        { args: ["-ss", startSec.toFixed(3), "-i", inputName, "-t", durationSec.toFixed(3), "-c", "copy", `copy.${ext}`], output: `copy.${ext}`, type: audioMime(ext) },
        { args: ["-ss", startSec.toFixed(3), "-i", inputName, "-t", durationSec.toFixed(3), "-c:a", "aac", "-b:a", "192k", "output.m4a"], output: "output.m4a", type: "audio/mp4" },
    ];
    let lastError: unknown;
    for (const attempt of attempts) {
        await remove(attempt.output);
        try {
            await ffmpeg.exec(attempt.args);
            const blob = await readFfmpegAudio(ffmpeg, attempt.output, attempt.type);
            if (blob.size > 0) {
                await remove(inputName);
                await remove(attempt.output);
                return blob;
            }
        } catch (error) {
            lastError = error;
        }
        await remove(attempt.output);
    }
    await remove(inputName);
    throw lastError instanceof Error ? lastError : new Error(i18n.t("canvas.audioPlayer.clipFailed"));
}

async function readFfmpegAudio(ffmpeg: Awaited<ReturnType<typeof loadFfmpeg>>, outputName: string, type: string) {
    const data = await ffmpeg.readFile(outputName);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return new Blob([copy], { type });
}
