import axios from "axios";

import i18n from "@/i18n";
import { audioMimeType, normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@/lib/audio-generation";
import {
    isRunninghubLyricsEndpoint,
    isRunninghubSupportedAudioEndpoint,
    normalizeAudioEmotionValue,
    normalizeAudioFormatForSchema,
    normalizeAudioSpeedForSchema,
    normalizeAudioVoiceForSchema,
    resolveAudioSettingSchema,
    supportsOpenAiAudioInstructions,
} from "@/lib/canvas/audio-setting-schema";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { buildApiUrl, closedGenerationError, modelOptionName, resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceAudio } from "@/types/media";
import { runModelPlugin } from "./model-plugin";
import { requestRunninghubAudio, requestRunninghubLyrics } from "./runninghub-audio";

type RequestOptions = { signal?: AbortSignal };
const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
    };
}

export async function requestAudioGeneration(config: AiConfig, prompt: string, audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<Blob> {
    throw closedGenerationError(config.model, "audio") || new Error(apiText("audioGenerationUnavailable"));
    const selectedModel = (config.model || config.audioModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const model = requestConfig.model.trim();
    const schema = resolveAudioSettingSchema({ ...config, model: selectedModel, audioModel: selectedModel });
    const format = normalizeAudioFormatForSchema(schema, config.audioFormat);
    const script = resolveModelScript(config, selectedModel);
    if (script) {
        if (!model) throw new Error(apiText("audioModelRequired"));
        if (!requestConfig.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
        if (!requestConfig.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
        try {
            const result = await runModelPlugin({
                capability: "audio",
                script,
                config: requestConfig,
                prompt,
                params: {
                    voice: schema.voices.length ? normalizeAudioVoiceForSchema(schema, config.audioVoice) : normalizeAudioVoiceValue(config.audioVoice),
                    format: format || normalizeAudioFormatValue(config.audioFormat),
                    speed: schema.source === "unsupported" ? normalizeAudioSpeedValue(config.audioSpeed) : normalizeAudioSpeedForSchema(schema, config.audioSpeed),
                    instructions: config.audioInstructions.trim(),
                    emotion: normalizeAudioEmotionValue(config.audioEmotion || "happy"),
                },
                signal: options?.signal,
            });
            return await audioPluginBlob(result, format || "mp3");
        } catch (error) {
            throw new Error(readAxiosError(error, apiText("audioGenerationFailed")));
        }
    }

    assertAudioConfig(requestConfig, model);

    if (requestConfig.apiFormat === "runninghub") {
        const endpoint = modelOptionName(selectedModel) || model;
        if (isRunninghubLyricsEndpoint(endpoint) || !isRunninghubSupportedAudioEndpoint(endpoint)) throw new Error(apiText("runninghubAudioUnsupported"));
        try {
            return await requestRunninghubAudio(requestConfig, selectedModel, prompt, audioReferences, options?.signal);
        } catch (error) {
            throw new Error(readAxiosError(error, apiText("audioGenerationFailed")));
        }
    }

    if (requestConfig.apiFormat === "linkfox") throw new Error(apiText("linkfoxAudioUnsupported"));
    if (requestConfig.apiFormat === "ark") throw new Error(apiText("arkAudioUnsupported"));
    if (requestConfig.apiFormat === "gemini") throw new Error(apiText("geminiAudioUnsupported"));

    const voice = normalizeAudioVoiceForSchema(schema, config.audioVoice);
    const speed = Number(normalizeAudioSpeedForSchema(schema, config.audioSpeed));
    const instructions = config.audioInstructions.trim();
    const sendInstructions = Boolean(instructions && supportsOpenAiAudioInstructions(model));

    try {
        const response = await axios.post<Blob>(
            aiApiUrl(requestConfig, "/audio/speech"),
            {
                model,
                input: prompt,
                voice,
                response_format: format,
                speed,
                ...(sendInstructions ? { instructions } : {}),
            },
            { headers: aiHeaders(requestConfig), responseType: "blob", signal: options?.signal },
        );
        await assertAudioBlob(response.data);
        return response.data.type.startsWith("audio/") ? response.data : new Blob([response.data], { type: audioMimeType(format) });
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("audioGenerationFailed")));
    }
}

async function audioPluginBlob(result: unknown, format: string): Promise<Blob> {
    if (result instanceof Blob) return result.type.startsWith("audio/") ? result : new Blob([result], { type: audioMimeType(format) });
    let source = "";
    if (typeof result === "string") source = result;
    else if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        source = typeof record.b64_json === "string" ? record.b64_json : typeof record.data === "string" ? record.data : typeof record.url === "string" ? record.url : "";
    }
    if (!source) throw new Error(apiText("scriptNoAudio"));
    const url = source.startsWith("data:") || /^https?:/i.test(source) ? source : `data:${audioMimeType(format)};base64,${source}`;
    const blob = await (await fetch(url)).blob();
    return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
}

export async function requestLyricsGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<string> {
    throw closedGenerationError(config.model, "audio") || new Error(apiText("audioGenerationUnavailable"));
    const selectedModel = (config.model || config.audioModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const model = requestConfig.model.trim();
    assertAudioConfig(requestConfig, model);
    if (requestConfig.apiFormat !== "runninghub" || !isRunninghubLyricsEndpoint(modelOptionName(selectedModel) || model)) {
        throw new Error(apiText("runninghubAudioUnsupported"));
    }
    try {
        return await requestRunninghubLyrics(requestConfig, selectedModel, prompt, options?.signal);
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("audioGenerationFailed")));
    }
}

export async function storeGeneratedAudio(blob: Blob, format = "mp3"): Promise<UploadedFile> {
    const audio = blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
    return uploadMediaFile(audio, "audio");
}

function assertAudioConfig(config: AiConfig, model: string) {
    if (!model) throw new Error(apiText("audioModelRequired"));
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
}

async function assertAudioBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || apiText("audioGenerationFailed"));
    if (payload.error?.message) throw new Error(payload.error.message);
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            if (/<[a-z][\s\S]*>/i.test(value)) return apiText("htmlError", { preview: `${value.slice(0, 80)}...` });
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    const errorMsg = typeof payload.error === "string" ? payload.error : (payload.error as { message?: unknown })?.message;
    return readApiErrorMessage(payload.msg) || readApiErrorMessage(payload.message) || readApiErrorMessage(errorMsg) || readApiErrorMessage(payload.detail) || "";
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return apiText("requestCanceled");
    if (error instanceof Error && error.message && !axios.isAxiosError(error)) return error.message;
    if (axios.isAxiosError(error)) {
        const responseData = error.response?.data;
        const apiMsg = readApiErrorMessage(responseData);
        if (apiMsg) return apiMsg;
        const statusMsg = statusMessage(error.response?.status, fallback);
        if (statusMsg) return statusMsg;
        return error.message || fallback;
    }
    if (error instanceof DOMException && error.name === "AbortError") return apiText("requestCanceled");
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return apiText("authenticationFailed");
    if (status === 429) return apiText("rateLimited");
    if (status === 404) return apiText("notFound");
    if (status === 502) return apiText("badGateway");
    if (status === 503) return apiText("serviceBusy");
    return status ? apiText("httpFailed", { status }) : fallback;
}
