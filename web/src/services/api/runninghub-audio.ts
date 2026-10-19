import axios from "axios";

import i18n from "@/i18n";
import {
    isRunninghubSupportedAudioEndpoint,
    makeVoiceCloneCustomId,
    normalizeAudioEmotionValue,
    normalizeAudioInstrumentalValue,
    normalizeAudioSpeedForSchema,
    normalizeAudioVoiceForSchema,
    normalizeMusicAudioFormat,
    normalizeVoiceCloneModel,
    resolveAudioSettingSchema,
    resolveRunninghubAudioFamily,
} from "@/lib/canvas/audio-setting-schema";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceAudio } from "@/types/media";
import { resolveRunninghubAudioUrls, runRunninghubEndpoint, urlToDataUrl, type RunninghubConfig } from "./runninghub-client";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export async function requestRunninghubAudio(
    config: AiConfig & RunninghubConfig,
    model: string,
    prompt: string,
    audioReferences: ReferenceAudio[] = [],
    signal?: AbortSignal,
): Promise<Blob> {
    const endpoint = modelOptionName(model).replace(/^\/+/, "");
    if (!endpoint) throw new Error(apiText("audioModelRequired"));
    if (!isRunninghubSupportedAudioEndpoint(endpoint)) throw new Error(apiText("runninghubAudioUnsupported"));

    const text = prompt.trim();
    const family = resolveRunninghubAudioFamily(endpoint);
    if (family === "suno-lyrics") throw new Error(apiText("runninghubAudioUnsupported"));
    if (family !== "music-cover" && !text) throw new Error(apiText("audioPromptRequired"));

    const payload = await buildRunninghubAudioPayload(family, config, model, text, audioReferences, signal);
    const result = await runRunninghubEndpoint(config, endpoint, payload, signal);
    const output = result.outputs.find((item) => typeof item === "string" && item.trim());
    if (!output) throw new Error(apiText("runninghubAudioNoOutput"));
    return downloadAudioBlob(output, signal);
}

async function buildRunninghubAudioPayload(
    family: ReturnType<typeof resolveRunninghubAudioFamily>,
    config: AiConfig,
    model: string,
    text: string,
    audioReferences: ReferenceAudio[],
    signal?: AbortSignal,
): Promise<Record<string, unknown>> {
    if (family === "speech") {
        const schema = resolveAudioSettingSchema({ ...config, model, audioModel: model });
        return {
            text,
            voice_id: normalizeAudioVoiceForSchema(schema, config.audioVoice),
            speed: Number(normalizeAudioSpeedForSchema(schema, config.audioSpeed)),
            volume: 1,
            pitch: 0,
            emotion: normalizeAudioEmotionValue(config.audioEmotion || "happy"),
            enable_base64_output: false,
            english_normalization: false,
        };
    }

    if (family === "suno-single") {
        const title = (config.audioTitle || "").trim().slice(0, 80);
        return {
            ...(title ? { title } : {}),
            description: text.slice(0, 400),
            make_instrumental: normalizeAudioInstrumentalValue(config.audioInstrumental),
        };
    }

    if (family === "suno-custom") {
        const title = (config.audioTitle || "").trim().slice(0, 80);
        const tags = (config.audioTags || "").trim().slice(0, 1000);
        if (!title) throw new Error(apiText("sunoTitleRequired"));
        if (!tags) throw new Error(apiText("sunoTagsRequired"));
        return {
            title,
            prompt: text.slice(0, 5000),
            tags,
        };
    }

    if (family === "music-cover") {
        if (!text) throw new Error(apiText("audioPromptRequired"));
        if (!audioReferences.length) throw new Error(apiText("musicCoverAudioRequired"));
        const [audioUrl] = await resolveRunninghubAudioUrls(config, audioReferences.slice(0, 1), signal);
        if (!audioUrl) throw new Error(apiText("musicCoverAudioRequired"));
        const lyrics = (config.audioLyrics || "").trim().slice(0, 1000);
        return {
            prompt: text.slice(0, 2000),
            audioUrl,
            ...(lyrics.length >= 10 ? { lyrics } : {}),
            sampleRate: "44100",
            format: normalizeMusicAudioFormat(config.audioFormat),
            bitrate: "256000",
        };
    }

    if (family === "music-text") {
        const style = (config.audioStyle || "").trim().slice(0, 2000);
        const lyrics = text.slice(0, 3500);
        if (!lyrics) throw new Error(apiText("musicLyricsRequired"));
        const isMusic25 = modelOptionName(model).toLowerCase().includes("music-2.5");
        if (isMusic25 && !style) throw new Error(apiText("musicStyleRequired"));
        return {
            ...(style ? { prompt: style } : {}),
            lyrics,
            sampleRate: "44100",
            format: normalizeMusicAudioFormat(config.audioFormat),
            bitrate: "256000",
            ...(modelOptionName(model).toLowerCase().includes("music-2.6") ? { lyricsOptimizer: false } : {}),
        };
    }

    if (family === "voice-clone") {
        if (!text) throw new Error(apiText("audioPromptRequired"));
        if (!audioReferences.length) throw new Error(apiText("voiceCloneAudioRequired"));
        const [audio] = await resolveRunninghubAudioUrls(config, audioReferences.slice(0, 1), signal);
        if (!audio) throw new Error(apiText("voiceCloneAudioRequired"));
        return {
            audio,
            custom_voice_id: makeVoiceCloneCustomId(),
            text: text.slice(0, 2000),
            accuracy: 0.7,
            need_noise_reduction: config.audioNoiseReduction === "true",
            need_volume_normalization: config.audioVolumeNormalization === "true",
            model: normalizeVoiceCloneModel(config.audioCloneModel || "speech-02-hd"),
        };
    }

    throw new Error(apiText("runninghubAudioUnsupported"));
}

export async function requestRunninghubLyrics(config: AiConfig & RunninghubConfig, model: string, prompt: string, signal?: AbortSignal): Promise<string> {
    const endpoint = modelOptionName(model).replace(/^\/+/, "");
    if (!endpoint) throw new Error(apiText("audioModelRequired"));
    const family = resolveRunninghubAudioFamily(endpoint);
    if (family !== "suno-lyrics") throw new Error(apiText("runninghubAudioUnsupported"));

    const text = prompt.trim();
    if (!text) throw new Error(apiText("audioPromptRequired"));

    const result = await runRunninghubEndpoint(config, endpoint, { prompt: text.slice(0, 500) }, signal);
    const output =
        result.outputs.find((item) => typeof item === "string" && item.trim() && !/^https?:\/\//i.test(item) && !item.startsWith("data:")) ||
        result.outputs.find((item) => typeof item === "string" && item.trim());
    if (!output) throw new Error(apiText("runninghubLyricsNoOutput"));
    if (!/^https?:\/\//i.test(output) && !output.startsWith("data:")) return output;

    const response = await axios.get<string>(output, { responseType: "text", signal, timeout: 60_000 });
    const lyrics = typeof response.data === "string" ? response.data.trim() : "";
    if (!lyrics) throw new Error(apiText("runninghubLyricsNoOutput"));
    return lyrics;
}

async function downloadAudioBlob(output: string, signal?: AbortSignal): Promise<Blob> {
    if (output.startsWith("data:")) {
        const blob = await (await fetch(output, { signal })).blob();
        return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: "audio/mpeg" });
    }

    const url = /^https?:\/\//i.test(output) ? output : await urlToDataUrl(output);
    if (url.startsWith("data:")) {
        const blob = await (await fetch(url, { signal })).blob();
        return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: "audio/mpeg" });
    }

    const response = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer", signal, timeout: 180_000 });
    const contentType = String(response.headers["content-type"] || "audio/mpeg");
    return new Blob([response.data], { type: contentType.startsWith("audio/") ? contentType : "audio/mpeg" });
}
