import axios from "axios";

import i18n from "@/i18n";
import { imageToDataUrl } from "@/services/image-storage";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export const LINKFOX_QUERY_PATH = "/aigc/taskQuery";
export const LINKFOX_POLL_INTERVAL_START_MS = 10_000;
export const LINKFOX_POLL_INTERVAL_MIN_MS = 5_000;
export const LINKFOX_POLL_INTERVAL_STEP_MS = 1_000;
export const LINKFOX_MAX_POLL_TIME_MS = 600_000;
export const LINKFOX_VIDEO_MAX_POLL_TIME_MS = 1_200_000;

export type LinkfoxRequestConfig = Pick<AiConfig, "baseUrl" | "apiKey" | "model" | "quality" | "size" | "count" | "systemPrompt" | "reasoningEffort" | "videoSeconds" | "vquality" | "videoGenerateAudio" | "videoReferenceMode">;

export type LinkfoxCreateResponse = {
    taskId?: string;
    costToken?: number;
    error?: string;
    errcode?: number;
    errorCode?: number;
    errmsg?: string;
    msg?: string;
    message?: string;
};

export type LinkfoxResultItem = {
    id?: string;
    url?: string;
    type?: string;
};

export type LinkfoxQueryResponse = {
    taskId?: string;
    status?: string;
    resultList?: LinkfoxResultItem[] | null;
    content?: string | null;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    errorMsg?: string | null;
    error?: string;
    errcode?: number;
    errorCode?: number;
    errmsg?: string;
    msg?: string;
    message?: string;
};

export function normalizeGatewayBase(baseUrl: string) {
    const trimmed = baseUrl.trim().replace(/\/+$/, "");
    if (!trimmed || trimmed === "https://tool-gateway.linkfox.com") return "/api/linkfox";
    return trimmed;
}

export function linkfoxHeaders(apiKey: string) {
    return {
        Authorization: apiKey,
        "Content-Type": "application/json",
        "User-Agent": "InfiniteCanvas-LinkFox/1.0",
    };
}

export function readLinkfoxError(payload: Record<string, unknown> | undefined, fallback: string) {
    if (!payload) return fallback;
    const code = payload.errcode ?? payload.errorCode ?? payload.code;
    if (typeof code === "number" && code !== 200 && code !== 0) {
        const message =
            (typeof payload.errmsg === "string" && payload.errmsg) ||
            (typeof payload.msg === "string" && payload.msg) ||
            (typeof payload.message === "string" && payload.message) ||
            (typeof payload.error === "string" && payload.error) ||
            fallback;
        if (code === 401 || code === 403) return apiText("authenticationFailed");
        if (code === 402) return apiText("linkfoxQuotaExceeded");
        return message;
    }
    if (typeof payload.error === "string" && payload.error) return payload.error;
    return "";
}

export function sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error(apiText("requestCanceled")));
            return;
        }
        const timer = window.setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            window.clearTimeout(timer);
            reject(new Error(apiText("requestCanceled")));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

export function isShortPublicHttpUrl(value: string) {
    return (value.startsWith("http://") || value.startsWith("https://")) && value.length <= 255 && !value.startsWith("data:");
}

export async function uploadDataUrlToLinkfoxOss(apiKey: string, dataUrl: string, signal?: AbortSignal) {
    try {
        const response = await axios.post<{ url?: string; error?: string }>(
            "/api/linkfox-oss-upload",
            { dataUrl },
            {
                headers: {
                    Authorization: apiKey,
                    "Content-Type": "application/json",
                },
                signal,
                timeout: 120_000,
            },
        );
        const url = response.data?.url?.trim() || "";
        if (!url) throw new Error(response.data?.error || apiText("linkfoxUploadFailed"));
        if (!isShortPublicHttpUrl(url)) throw new Error(apiText("linkfoxUploadUrlTooLong"));
        return url;
    } catch (error) {
        if (axios.isCancel(error)) throw new Error(apiText("requestCanceled"));
        if (axios.isAxiosError(error)) {
            const payload = error.response?.data as { error?: string } | undefined;
            throw new Error(payload?.error || apiText("linkfoxUploadFailed"));
        }
        throw error;
    }
}

/** LinkFox only accepts public http(s) URLs ≤255 chars — never data:/blob: payloads. */
export async function resolveImageUrls(config: Pick<LinkfoxRequestConfig, "apiKey">, references: ReferenceImage[], signal?: AbortSignal) {
    const urls: string[] = [];
    for (const reference of references) {
        const candidates = [reference.url, reference.dataUrl].filter((value): value is string => Boolean(value?.trim()));
        const publicCandidate = candidates.find((value) => isShortPublicHttpUrl(value.trim()));
        if (publicCandidate) {
            urls.push(publicCandidate.trim());
            continue;
        }
        const dataUrl = await imageToDataUrl(reference);
        if (!dataUrl) continue;
        if (isShortPublicHttpUrl(dataUrl)) {
            urls.push(dataUrl);
            continue;
        }
        urls.push(await uploadDataUrlToLinkfoxOss(config.apiKey, dataUrl, signal));
    }
    return urls;
}

export async function resolveMediaDataUrl(config: Pick<LinkfoxRequestConfig, "apiKey">, dataUrl: string, signal?: AbortSignal) {
    const trimmed = dataUrl.trim();
    if (!trimmed) return "";
    if (isShortPublicHttpUrl(trimmed)) return trimmed;
    if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) {
        return uploadDataUrlToLinkfoxOss(config.apiKey, trimmed.startsWith("blob:") ? await blobUrlToDataUrl(trimmed) : trimmed, signal);
    }
    return trimmed;
}

async function blobUrlToDataUrl(blobUrl: string) {
    const blob = await (await fetch(blobUrl)).blob();
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(apiText("linkfoxUploadFailed")));
        reader.readAsDataURL(blob);
    });
}

export async function createLinkfoxTask(config: Pick<LinkfoxRequestConfig, "baseUrl" | "apiKey">, path: string, body: Record<string, unknown>, signal?: AbortSignal) {
    const base = normalizeGatewayBase(config.baseUrl);
    try {
        const response = await axios.post<LinkfoxCreateResponse>(`${base}${path}`, body, {
            headers: linkfoxHeaders(config.apiKey),
            signal,
            timeout: 30_000,
        });
        const error = readLinkfoxError(response.data as Record<string, unknown>, apiText("requestFailed"));
        if (error) throw new Error(error);
        if (!response.data?.taskId) throw new Error(apiText("linkfoxNoTaskId"));
        return response.data;
    } catch (error) {
        if (axios.isCancel(error)) throw new Error(apiText("requestCanceled"));
        if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            if (status === 401 || status === 403) throw new Error(apiText("authenticationFailed"));
            if (status === 402) throw new Error(apiText("linkfoxQuotaExceeded"));
            if (!error.response && (error.code === "ERR_NETWORK" || /network error/i.test(error.message || ""))) {
                throw new Error(apiText("linkfoxNetworkError"));
            }
            const payload = error.response?.data as Record<string, unknown> | undefined;
            const message = readLinkfoxError(payload, error.message || apiText("requestFailed"));
            throw new Error(message || apiText("requestFailed"));
        }
        throw error;
    }
}

function isTransientAxiosError(error: unknown) {
    if (!axios.isAxiosError(error)) return false;
    if (axios.isCancel(error)) return false;
    const status = error.response?.status;
    if (status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
    if (!error.response && (error.code === "ERR_NETWORK" || error.code === "ECONNABORTED" || /network error|timeout/i.test(error.message || ""))) return true;
    return false;
}

export async function queryLinkfoxTask(config: Pick<LinkfoxRequestConfig, "baseUrl" | "apiKey">, taskId: string, path = LINKFOX_QUERY_PATH, signal?: AbortSignal) {
    const base = normalizeGatewayBase(config.baseUrl);
    const response = await axios.post<LinkfoxQueryResponse>(
        `${base}${path}`,
        { taskId },
        {
            headers: linkfoxHeaders(config.apiKey),
            signal,
            timeout: 30_000,
        },
    );
    const error = readLinkfoxError(response.data as Record<string, unknown>, "");
    if (error) throw new Error(error);
    return response.data;
}

export async function pollLinkfoxUntilDone(
    config: Pick<LinkfoxRequestConfig, "baseUrl" | "apiKey">,
    taskId: string,
    options?: { signal?: AbortSignal; queryPath?: string; maxPollTimeMs?: number },
) {
    const start = Date.now();
    let interval = LINKFOX_POLL_INTERVAL_START_MS;
    const maxPoll = options?.maxPollTimeMs ?? LINKFOX_MAX_POLL_TIME_MS;
    const queryPath = options?.queryPath || LINKFOX_QUERY_PATH;
    let transientStreak = 0;
    while (Date.now() - start < maxPoll) {
        await sleep(interval, options?.signal);
        try {
            const result = await queryLinkfoxTask(config, taskId, queryPath, options?.signal);
            transientStreak = 0;
            const status = (result.status || "").toUpperCase();
            if (status === "SUCCESS") return result;
            if (status === "FAILED") throw new Error(result.errorMsg || result.errmsg || result.msg || apiText("linkfoxGenerationFailed"));
            interval = Math.max(interval - LINKFOX_POLL_INTERVAL_STEP_MS, LINKFOX_POLL_INTERVAL_MIN_MS);
        } catch (error) {
            if (axios.isCancel(error) || options?.signal?.aborted) throw new Error(apiText("requestCanceled"));
            if (isTransientAxiosError(error) && transientStreak < 8) {
                transientStreak += 1;
                continue;
            }
            throw error instanceof Error ? error : new Error(apiText("linkfoxGenerationFailed"));
        }
    }
    throw new Error(apiText("linkfoxPollTimeout"));
}

function isRetryableDownloadError(error: unknown) {
    if (isTransientAxiosError(error)) return true;
    if (!axios.isAxiosError(error)) return /network|timeout|aborted|econnreset|socket/i.test(error instanceof Error ? error.message : "");
    if (!error.response) return true;
    const code = String(error.code || "");
    if (/ERR_NETWORK|ECONNABORTED|ECONNRESET|ETIMEDOUT|ERR_BAD_RESPONSE|ERR_INCOMPLETE_CHUNKED_ENCODING/i.test(code)) return true;
    return /network|timeout|aborted|econnreset|socket|incomplete/i.test(error.message || "");
}

export async function urlToDataUrl(url: string, signal?: AbortSignal) {
    if (url.startsWith("data:")) return url;
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            if (attempt > 0) await sleep(Math.min(4_000, 600 * 2 ** (attempt - 1)), signal);
            const response = await axios.get<ArrayBuffer>(url, {
                responseType: "arraybuffer",
                timeout: 180_000,
                signal,
                validateStatus: (status) => status >= 200 && status < 300,
            });
            const bytes = new Uint8Array(response.data);
            const expected = Number(response.headers["content-length"] || 0);
            if (!bytes.length) throw new Error("empty image body");
            if (expected > 0 && bytes.length < expected) throw Object.assign(new Error(`incomplete download ${bytes.length}/${expected}`), { code: "ERR_NETWORK" });
            const contentType = response.headers["content-type"] || "application/octet-stream";
            let binary = "";
            const chunk = 0x8000;
            for (let i = 0; i < bytes.length; i += chunk) {
                binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
            }
            return `data:${contentType};base64,${btoa(binary)}`;
        } catch (error) {
            lastError = error;
            if (axios.isCancel(error) || signal?.aborted) throw new Error(apiText("requestCanceled"));
            if (!isRetryableDownloadError(error)) break;
        }
    }
    const detail = axios.isAxiosError(lastError)
        ? lastError.response?.status
            ? `HTTP ${lastError.response.status}`
            : lastError.message || "network"
        : lastError instanceof Error
          ? lastError.message
          : "unknown";
    throw new Error(apiText("runninghubResultDownloadFailed", { detail }));
}

export function withSystemPrompt(systemPrompt: string, prompt: string) {
    const trimmed = systemPrompt.trim();
    return trimmed ? `${trimmed}\n\n${prompt}` : prompt;
}

export function assertLinkfoxConfig(config: Pick<LinkfoxRequestConfig, "baseUrl" | "apiKey">) {
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
}
