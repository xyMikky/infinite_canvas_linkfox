import axios from "axios";

import i18n from "@/i18n";
import { getMediaBlob } from "@/services/file-storage";
import { getImageBlob, imageToDataUrl } from "@/services/image-storage";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export const RUNNINGHUB_UPSTREAM = "https://www.runninghub.ai/openapi/v2";
export const RUNNINGHUB_PROXY_BASE = "/api/runninghub";
export const RUNNINGHUB_CN_UPSTREAM = "https://www.runninghub.cn/openapi/v2";
export const RUNNINGHUB_CN_PROXY_BASE = "/api/runninghub-cn";
export const RUNNINGHUB_POLL_INTERVAL_MS = 5_000;
export const RUNNINGHUB_MAX_POLL_TIME_MS = 1_800_000;

const NON_TERMINAL = new Set(["CREATE", "QUEUED", "RUNNING"]);
const FAILURE = new Set(["FAILED", "CANCEL", "CANCELED", "CANCELLED"]);
const SUCCESS = new Set(["SUCCESS", "SUCCEED", "SUCCEEDED", "COMPLETED", "COMPLETE", "FINISH", "FINISHED", "成功"]);

export type RunninghubConfig = Pick<AiConfig, "baseUrl" | "apiKey" | "model" | "size" | "quality" | "count" | "systemPrompt" | "videoSeconds" | "vquality" | "videoGenerateAudio" | "videoRealPersonMode" | "reasoningEffort" | "modelParams" | "background">;

export function normalizeRunninghubBase(baseUrl: string) {
    const trimmed = baseUrl.trim().replace(/\/+$/, "");
    if (!trimmed || trimmed === RUNNINGHUB_UPSTREAM || trimmed === "https://www.runninghub.ai/openapi/v2/") return RUNNINGHUB_PROXY_BASE;
    if (trimmed === RUNNINGHUB_CN_UPSTREAM || trimmed === "https://www.runninghub.cn/openapi/v2/" || trimmed.includes("runninghub.cn")) return RUNNINGHUB_CN_PROXY_BASE;
    return trimmed;
}

export function runninghubHeaders(apiKey: string, contentType?: string) {
    return {
        Authorization: `Bearer ${apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

export function assertRunninghubConfig(config: Pick<RunninghubConfig, "baseUrl" | "apiKey">) {
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
}

function sleep(ms: number, signal?: AbortSignal) {
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

/** 轮询/下载阶段的瞬时故障：任务可能已在渠道侧成功，不应立刻标死。 */
function isTransientAxiosError(error: unknown) {
    if (!axios.isAxiosError(error)) return false;
    if (axios.isCancel(error)) return false;
    const status = error.response?.status;
    if (status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
    if (!error.response && (error.code === "ERR_NETWORK" || error.code === "ECONNABORTED" || /network error|timeout/i.test(error.message || ""))) return true;
    return false;
}

function mapRunninghubAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return new Error(apiText("requestCanceled"));
    if (!axios.isAxiosError(error)) return error instanceof Error ? error : new Error(fallback);
    const status = error.response?.status;
    if (status === 401 || status === 403) return new Error(apiText("authenticationFailed"));
    if (status === 402) return new Error(apiText("runninghubQuotaExceeded"));
    if (status === 500 || status === 502 || status === 503 || status === 504) {
        return new Error(apiText("runninghubTransientHttp", { status }));
    }
    if (!error.response && (error.code === "ERR_NETWORK" || /network error/i.test(error.message || ""))) {
        return new Error(apiText("runninghubNetworkError"));
    }
    const data = error.response?.data;
    const payload = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;
    const detail = readError(payload, "");
    if (detail) return new Error(detail);
    if (status) return new Error(apiText("httpFailed", { status }));
    return new Error(error.message || fallback);
}

function isGenericSuccessMessage(value: string) {
    return /^(success|ok|succeed|succeeded|成功)$/i.test(value.trim());
}

function formatFailedReason(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    const parts = [record.message, record.msg, record.reason, record.detail, record.errorMessage, record.error]
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0 && !isGenericSuccessMessage(item));
    if (parts.length) return parts.join("；");
    if (!Object.keys(record).length) return "";
    try {
        const text = JSON.stringify(record);
        return text === "{}" ? "" : text;
    } catch {
        return "";
    }
}

function readPromptTipsError(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
        const parsed = JSON.parse(value) as { error?: unknown; node_errors?: Record<string, unknown> };
        if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error.trim();
        const nodeErrors = parsed.node_errors;
        if (!nodeErrors || typeof nodeErrors !== "object") return "";
        return Object.values(nodeErrors)
            .flatMap((item) => {
                if (typeof item === "string" && item.trim()) return [item.trim()];
                if (!item || typeof item !== "object") return [];
                const record = item as Record<string, unknown>;
                if (typeof record.message === "string" && record.message.trim()) return [record.message.trim()];
                if (Array.isArray(record.errors)) return record.errors.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
                return [];
            })
            .join("；");
    } catch {
        return "";
    }
}

function readError(payload: Record<string, unknown> | string | undefined, fallback: string) {
    if (typeof payload === "string") {
        const text = payload.trim();
        return text ? text.slice(0, 500) : fallback;
    }
    if (!payload) return fallback;
    const nested = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data) ? (payload.data as Record<string, unknown>) : undefined;
    const source = nested ? { ...payload, ...nested } : payload;
    const rawMessages = [
        source.errorMessage,
        source.error_message,
        source.failedReason,
        source.msg,
        source.message,
        source.error,
        nested?.errorMessage,
        payload.errorMessage,
        payload.msg,
    ];
    let message = "";
    for (const item of rawMessages) {
        if (typeof item === "string") {
            const text = item.trim();
            if (text && !isGenericSuccessMessage(text)) {
                message = text;
                break;
            }
            continue;
        }
        const reason = formatFailedReason(item);
        if (reason) {
            message = reason;
            break;
        }
    }
    message = message || formatFailedReason(source.failedReason) || readPromptTipsError(source.promptTips);
    if (/signal timed out/i.test(message)) return apiText("runninghubTaskTimeout");
    const code = source.errorCode ?? source.error_code ?? source.code ?? payload.code;
    if (code === 401 || code === 403 || code === "401" || code === "403") return apiText("authenticationFailed");
    if (code === 402 || code === "402") return apiText("runninghubQuotaExceeded");
    return message || fallback;
}

/** RunningHub 业务成功码：合同示例为 0，正式上传文档为 200。 */
export function isRunninghubOkCode(code: unknown) {
    return code === undefined || code === null || code === "" || code === 0 || code === "0" || code === 200 || code === "200";
}

function readRunninghubUploadUrl(data: unknown) {
    if (!data || typeof data !== "object") return "";
    const record = data as Record<string, unknown>;
    const nested = record.data;
    const bucket = nested && typeof nested === "object" && !Array.isArray(nested) ? (nested as Record<string, unknown>) : record;
    const url = [bucket.download_url, bucket.downloadUrl, bucket.url, bucket.fileUrl, bucket.file_url].find(
        (value) => typeof value === "string" && value.trim(),
    ) as string | undefined;
    return url?.trim() || "";
}

function isRetriableUploadHttpStatus(status: number) {
    return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function isSignalTimeoutError(error: unknown) {
    if (!error || typeof error !== "object") return false;
    const name = "name" in error ? String(error.name || "") : "";
    const message = "message" in error ? String(error.message || "") : "";
    return name === "TimeoutError" || /signal timed out/i.test(message);
}

function isRetryableRunninghubTimeout(error: unknown) {
    if (isSignalTimeoutError(error)) return true;
    const message = error instanceof Error ? error.message : String(error || "");
    if (/轮询超时|polling timed out/i.test(message)) return false;
    return /signal timed out|execution timed out|model timed out|任务超时|生成超时/i.test(message);
}

function uploadTimeoutMs(bytes: number) {
    return Math.min(300_000, Math.max(180_000, 90_000 + Math.ceil(Math.max(0, bytes) / 1024) * 40));
}

function withUploadTimeout(signal?: AbortSignal, ms = 180_000) {
    const timeout = AbortSignal.timeout(ms);
    if (!signal) return timeout;
    return typeof AbortSignal.any === "function" ? AbortSignal.any([signal, timeout]) : signal;
}

export async function uploadRunninghubBinary(config: Pick<RunninghubConfig, "baseUrl" | "apiKey">, blob: Blob, filename: string, signal?: AbortSignal) {
    const base = normalizeRunninghubBase(config.baseUrl);
    if (!blob.size) throw new Error(apiText("runninghubUploadEmpty"));
    const url = `${base}/media/upload/binary`;
    const maxAttempts = 3;
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (signal?.aborted) throw new Error(apiText("requestCanceled"));
        const form = new FormData();
        form.append("file", blob, filename || "upload.bin");
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: { Authorization: `Bearer ${config.apiKey}` },
                body: form,
                signal: withUploadTimeout(signal, uploadTimeoutMs(blob.size)),
            });
            let data: Record<string, unknown> = {};
            try {
                data = (await response.json()) as Record<string, unknown>;
            } catch {
                data = {};
            }
            if (!response.ok) {
                const status = response.status;
                if (status === 401 || status === 403) throw new Error(apiText("authenticationFailed"));
                if (status === 402) throw new Error(apiText("runninghubQuotaExceeded"));
                if (status === 413) throw new Error(apiText("runninghubUploadTooLarge"));
                if (status === 429) throw new Error(apiText("rateLimited"));
                const detail = readError(data, "");
                const fallback = apiText("runninghubUploadTransientHttp", { status });
                if (isRetriableUploadHttpStatus(status) && attempt + 1 < maxAttempts) {
                    lastError = new Error(detail || fallback);
                    await sleep(1500 * (attempt + 1), signal);
                    continue;
                }
                throw new Error(detail || fallback || apiText("runninghubUploadFailed"));
            }
            if (!isRunninghubOkCode(data?.code)) {
                throw new Error(readError(data, apiText("runninghubUploadFailed")));
            }
            const uploadedUrl = readRunninghubUploadUrl(data);
            if (!uploadedUrl) throw new Error(readError(data, apiText("runninghubUploadNoUrl")));
            return uploadedUrl;
        } catch (error) {
            if (signal?.aborted) throw new Error(apiText("requestCanceled"));
            if (error instanceof Error && error.message === apiText("requestCanceled")) throw error;
            if (isSignalTimeoutError(error) || (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError"))) {
                lastError = new Error(isSignalTimeoutError(error) ? apiText("runninghubUploadTimeout") : apiText("runninghubNetworkError"));
                if (attempt + 1 < maxAttempts) {
                    await sleep(1500 * (attempt + 1), signal);
                    continue;
                }
                throw lastError;
            }
            if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
                if (attempt + 1 < maxAttempts) {
                    lastError = new Error(apiText("runninghubNetworkError"));
                    await sleep(1500 * (attempt + 1), signal);
                    continue;
                }
                throw new Error(apiText("runninghubNetworkError"));
            }
            throw error;
        }
    }
    throw lastError || new Error(apiText("runninghubUploadFailed"));
}

async function dataUrlToBlob(dataUrl: string) {
    const response = await fetch(dataUrl);
    return response.blob();
}

function isPublicHttpUrl(value: string) {
    if (!/^https?:\/\//i.test(value) || value.startsWith("blob:") || value.startsWith("data:")) return false;
    try {
        const host = new URL(value).hostname.toLowerCase();
        return host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]" && !host.endsWith(".local");
    } catch {
        return false;
    }
}

/** RunningHub 上传/结果 CDN 地址通常只有短期有效期，不能当作可长期复用的参考图 URL。 */
export function isRunninghubTemporaryMediaUrl(value: string) {
    if (!/^https?:\/\//i.test(value)) return false;
    try {
        const host = new URL(value).hostname.toLowerCase();
        return (
            host.endsWith("runninghub.cn") ||
            host.endsWith("runninghub.ai") ||
            host.endsWith("myqcloud.com") ||
            host.includes("rh-images") ||
            host.includes("rh-videos") ||
            host.includes("xiaoyaoyou.com")
        );
    } catch {
        return false;
    }
}

function isReusablePublicHttpUrl(value: string) {
    return isPublicHttpUrl(value) && !isRunninghubTemporaryMediaUrl(value);
}

const runninghubImageUploadCache = new Map<string, Promise<string>>();

/** 打开/切换画布项目时调用，避免复用上次会话上传到 RunningHub 的临时 URL。 */
export function clearRunninghubImageUploadCache() {
    runninghubImageUploadCache.clear();
}

function runninghubRefCacheKey(config: Pick<RunninghubConfig, "baseUrl" | "apiKey">, storageKey: string) {
    const channel = `${normalizeRunninghubBase(config.baseUrl)}:${config.apiKey}`;
    return `${channel}:${storageKey}`;
}

function waitForRunninghubImageUpload(upload: Promise<string>, signal?: AbortSignal) {
    if (!signal) return upload;
    if (signal.aborted) return Promise.reject(new Error(apiText("requestCanceled")));
    return new Promise<string>((resolve, reject) => {
        const onAbort = () => reject(new Error(apiText("requestCanceled")));
        signal.addEventListener("abort", onAbort, { once: true });
        upload.then(
            (url) => {
                signal.removeEventListener("abort", onAbort);
                resolve(url);
            },
            (error) => {
                signal.removeEventListener("abort", onAbort);
                reject(error);
            },
        );
    });
}

export async function resolveRunninghubImageUrls(config: Pick<RunninghubConfig, "baseUrl" | "apiKey">, references: ReferenceImage[], signal?: AbortSignal) {
    const urls: string[] = [];
    for (const [index, reference] of references.entries()) {
        if (signal?.aborted) throw new Error(apiText("requestCanceled"));
        const publicUrl = [reference.url, reference.dataUrl].find((value) => typeof value === "string" && isReusablePublicHttpUrl(value.trim()));
        if (publicUrl) {
            urls.push(publicUrl.trim());
            continue;
        }
        let blob: Blob | null = reference.storageKey ? await getImageBlob(reference.storageKey) : null;
        // rh-0 等临时编号每次反推都会复用，只有成功读取的存储原件才能作为缓存身份。
        const cacheKey = blob?.size && reference.storageKey ? runninghubRefCacheKey(config, reference.storageKey) : undefined;
        if (!blob?.size) {
            const dataUrl = await imageToDataUrl(reference);
            if (!dataUrl) throw new Error(`${reference.name || reference.id}：${i18n.t("common.imageReadFailed")}`);
            if (isReusablePublicHttpUrl(dataUrl)) {
                urls.push(dataUrl);
                continue;
            }
            blob = await dataUrlToBlob(dataUrl);
        }
        if (!blob?.size) throw new Error(`${reference.name || reference.id}：${i18n.t("common.imageReadFailed")}`);
        if (signal?.aborted) throw new Error(apiText("requestCanceled"));
        let upload = cacheKey ? runninghubImageUploadCache.get(cacheKey) : undefined;
        if (!upload) {
            upload = (async () => {
                const ext = blob!.type.includes("png") ? "png" : blob!.type.includes("jpeg") || blob!.type.includes("jpg") ? "jpg" : "png";
                return uploadRunninghubBinary(config, blob!, `ref-${index + 1}.${ext}`);
            })();
            if (cacheKey) runninghubImageUploadCache.set(cacheKey, upload);
            upload.catch(() => {
                if (cacheKey && runninghubImageUploadCache.get(cacheKey) === upload) runninghubImageUploadCache.delete(cacheKey);
            });
        }
        const uploadedUrl = await waitForRunninghubImageUpload(upload, signal);
        if (signal?.aborted) throw new Error(apiText("requestCanceled"));
        urls.push(uploadedUrl);
    }
    return urls;
}

export async function resolveRunninghubAudioUrls(config: Pick<RunninghubConfig, "baseUrl" | "apiKey">, references: ReferenceAudio[], signal?: AbortSignal) {
    const urls: string[] = [];
    for (const [index, reference] of references.entries()) {
        const direct = (reference.url || "").trim();
        if (/^https?:\/\//i.test(direct) && !direct.startsWith("blob:") && !isRunninghubTemporaryMediaUrl(direct)) {
            urls.push(direct);
            continue;
        }
        let blob: Blob | null = null;
        if (reference.storageKey) blob = await getMediaBlob(reference.storageKey);
        if (!blob && direct.startsWith("blob:")) blob = await (await fetch(direct)).blob();
        if (!blob && direct.startsWith("data:")) blob = await dataUrlToBlob(direct);
        if (!blob) throw new Error(apiText("invalidReferenceAudio"));
        const ext = blob.type.includes("wav") ? "wav" : blob.type.includes("flac") ? "flac" : "mp3";
        urls.push(await uploadRunninghubBinary(config, blob, `audio-ref-${index + 1}.${ext}`, signal));
    }
    return urls;
}

export async function resolveRunninghubVideoUrls(config: Pick<RunninghubConfig, "baseUrl" | "apiKey">, references: ReferenceVideo[], signal?: AbortSignal) {
    const urls: string[] = [];
    for (const [index, reference] of references.entries()) {
        const direct = (reference.url || "").trim();
        if (/^https?:\/\//i.test(direct) && !direct.startsWith("blob:") && !isRunninghubTemporaryMediaUrl(direct)) {
            urls.push(direct);
            continue;
        }
        let blob: Blob | null = null;
        if (reference.storageKey) blob = await getMediaBlob(reference.storageKey);
        if (!blob && direct.startsWith("blob:")) blob = await (await fetch(direct)).blob();
        if (!blob && direct.startsWith("data:")) blob = await dataUrlToBlob(direct);
        if (!blob) throw new Error(apiText("invalidReferenceVideo"));
        const ext = blob.type.includes("quicktime") || /\.mov$/i.test(reference.name || "") ? "mov" : "mp4";
        urls.push(await uploadRunninghubBinary(config, blob, `video-ref-${index + 1}.${ext}`, signal));
    }
    return urls;
}

export async function submitRunninghubTask(config: Pick<RunninghubConfig, "baseUrl" | "apiKey">, endpoint: string, payload: Record<string, unknown>, signal?: AbortSignal) {
    const normalized = endpoint.trim().replace(/^\/+/, "");
    if (!normalized) throw new Error(apiText("runninghubEndpointRequired"));
    const base = normalizeRunninghubBase(config.baseUrl);
    try {
        const response = await axios.post<Record<string, unknown>>(`${base}/${normalized}`, payload, {
            headers: runninghubHeaders(config.apiKey, "application/json"),
            signal,
            timeout: 60_000,
        });
        const data = unwrapRunninghubQuery(response.data || {});
        if (!isRunninghubOkCode(data.code ?? response.data?.code) && !(data.taskId || data.task_id)) {
            throw new Error(readError(data, apiText("requestFailed")));
        }
        const taskId = data.taskId || data.task_id;
        const status = readRunninghubStatus(data);
        if (FAILURE.has(status)) throw new Error(readError(data, apiText("runninghubGenerationFailed")));
        if (!taskId) throw new Error(readError(data, apiText("runninghubNoTaskId")));
        return String(taskId);
    } catch (error) {
        throw mapRunninghubAxiosError(error, apiText("requestFailed"));
    }
}

function unwrapRunninghubQuery(data: Record<string, unknown>) {
    const nested = data.data;
    if (typeof nested === "string" && nested.trim()) return { ...data, status: nested };
    if (nested && typeof nested === "object" && !Array.isArray(nested)) return { ...data, ...(nested as Record<string, unknown>) };
    return data;
}

function readRunninghubStatus(data: Record<string, unknown>) {
    return String(data.status ?? data.taskStatus ?? data.task_status ?? data.state ?? "").trim().toUpperCase();
}

function toRhFileProxyUrl(url: string) {
    try {
        const host = new URL(url).hostname.toLowerCase();
        if (host.endsWith("myqcloud.com") || host.endsWith("runninghub.cn") || host.endsWith("runninghub.ai") || host.includes("rh-images") || host.includes("rh-videos")) {
            return `/api/rh-file?url=${encodeURIComponent(url)}`;
        }
    } catch {
        // keep original
    }
    return url;
}

export async function pollRunninghubTask(config: Pick<RunninghubConfig, "baseUrl" | "apiKey">, taskId: string, signal?: AbortSignal) {
    const base = normalizeRunninghubBase(config.baseUrl);
    const start = Date.now();
    let transientStreak = 0;
    while (Date.now() - start < RUNNINGHUB_MAX_POLL_TIME_MS) {
        await sleep(RUNNINGHUB_POLL_INTERVAL_MS, signal);
        try {
            const response = await axios.post<Record<string, unknown>>(
                `${base}/query`,
                { taskId },
                {
                    headers: runninghubHeaders(config.apiKey, "application/json"),
                    signal,
                    timeout: 60_000,
                },
            );
            transientStreak = 0;
            const data = unwrapRunninghubQuery(response.data || {});
            const status = readRunninghubStatus(data);
            if (SUCCESS.has(status)) {
                if (extractRunninghubOutputs(data).length) return data;
                continue;
            }
            if (FAILURE.has(status)) throw new Error(readError(data, apiText("runninghubGenerationFailed")));
            if (status && !NON_TERMINAL.has(status)) {
                // Unknown but non-empty status: keep polling unless clearly failed.
                if (/fail|error|cancel/i.test(status)) throw new Error(readError(data, apiText("runninghubGenerationFailed")));
            }
        } catch (error) {
            if (axios.isCancel(error) || signal?.aborted) throw new Error(apiText("requestCanceled"));
            // submit 已成功后的 query 500/网络抖动：继续轮询，避免「后台已出图、画布标失败」
            if (isTransientAxiosError(error)) {
                transientStreak += 1;
                if (transientStreak < 8) continue;
            }
            throw mapRunninghubAxiosError(error, apiText("runninghubGenerationFailed"));
        }
    }
    throw new Error(apiText("runninghubPollTimeout", { taskId }));
}

export function extractRunninghubOutputs(response: Record<string, unknown>) {
    const outputs: string[] = [];
    const push = (value: unknown) => {
        if (typeof value === "string" && value.trim()) outputs.push(value.trim());
    };
    const readItem = (item: unknown) => {
        if (!item || typeof item !== "object") return;
        const record = item as Record<string, unknown>;
        const url = [record.url, record.outputUrl, record.output_url, record.fileUrl, record.file_url].find((value) => typeof value === "string" && value.trim()) as string | undefined;
        if (url) {
            outputs.push(url.trim());
            return;
        }
        const text = [record.text, record.content, record.output].find((value) => typeof value === "string" && value.trim()) as string | undefined;
        if (text) outputs.push(text.trim());
    };
    const results = Array.isArray(response.results) ? response.results : [];
    for (const item of results) readItem(item);
    for (const key of ["outputs", "files", "images"] as const) {
        const list = response[key];
        if (!Array.isArray(list)) continue;
        for (const item of list) {
            if (typeof item === "string") push(item);
            else readItem(item);
        }
    }
    if (!outputs.length) {
        const nested = response.data;
        if (nested && typeof nested === "object") return extractRunninghubOutputs(nested as Record<string, unknown>);
    }
    return [...new Set(outputs)];
}

export async function runRunninghubEndpoint(config: Pick<RunninghubConfig, "baseUrl" | "apiKey">, endpoint: string, payload: Record<string, unknown>, signal?: AbortSignal) {
    assertRunninghubConfig(config);
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const taskId = await submitRunninghubTask(config, endpoint, payload, signal);
            const finalResponse = await pollRunninghubTask(config, taskId, signal);
            return { taskId, outputs: extractRunninghubOutputs(finalResponse), raw: finalResponse };
        } catch (error) {
            if (signal?.aborted) throw new Error(apiText("requestCanceled"));
            lastError = error;
            if (attempt === 0 && isRetryableRunninghubTimeout(error)) {
                await sleep(2000, signal);
                continue;
            }
            throw error;
        }
    }
    throw lastError instanceof Error ? lastError : new Error(apiText("runninghubGenerationFailed"));
}

export function withSystemPrompt(systemPrompt: string, prompt: string) {
    const trimmed = systemPrompt.trim();
    return trimmed ? `${trimmed}\n\n${prompt}` : prompt;
}

function isRetryableDownloadError(error: unknown) {
    if (isTransientAxiosError(error)) return true;
    if (!axios.isAxiosError(error)) return /network|timeout|aborted|econnreset|socket/i.test(error instanceof Error ? error.message : "");
    // 下载中断常见：无响应体、连接重置、超时、不完整响应
    if (!error.response) return true;
    const code = String(error.code || "");
    if (/ERR_NETWORK|ECONNABORTED|ECONNRESET|ETIMEDOUT|ERR_BAD_RESPONSE|ERR_INCOMPLETE_CHUNKED_ENCODING/i.test(code)) return true;
    return /network|timeout|aborted|econnreset|socket|incomplete/i.test(error.message || "");
}

function sniffImageMime(bytes: Uint8Array) {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
    if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
    return "";
}

function imageDataUrlMime(contentType: string, bytes: Uint8Array) {
    const raw = (contentType || "").split(";")[0].trim().toLowerCase();
    if (raw.startsWith("image/") && raw !== "image/octet-stream") return raw;
    return sniffImageMime(bytes) || "image/png";
}

export async function urlToDataUrl(url: string, signal?: AbortSignal) {
    if (url.startsWith("data:")) return url;
    let lastError: unknown;
    // 结果图直连 CDN，安装版弱网下易中断；多试几次比立刻标「生成失败」更合理
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            if (attempt > 0) await sleep(Math.min(4_000, 600 * 2 ** (attempt - 1)), signal);
            const response = await axios.get<ArrayBuffer>(toRhFileProxyUrl(url), {
                responseType: "arraybuffer",
                timeout: 180_000,
                signal,
                // 避免中间代理/缓存返回残缺内容还当成功
                validateStatus: (status) => status >= 200 && status < 300,
            });
            const bytes = new Uint8Array(response.data);
            const expected = Number(response.headers["content-length"] || 0);
            if (!bytes.length) throw new Error("empty image body");
            if (expected > 0 && bytes.length < expected) throw Object.assign(new Error(`incomplete download ${bytes.length}/${expected}`), { code: "ERR_NETWORK" });
            const contentType = response.headers["content-type"] || "application/octet-stream";
            const mime = imageDataUrlMime(contentType, bytes);
            let binary = "";
            const chunk = 0x8000;
            for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
            return `data:${mime};base64,${btoa(binary)}`;
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
