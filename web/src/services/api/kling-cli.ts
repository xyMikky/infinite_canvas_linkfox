import { nanoid } from "nanoid";

import type { AiConfig, ChannelModel, ModelCapability } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { imageToDataUrl } from "@/services/image-storage";

type KlingTool = "text_to_image" | "image_to_image" | "text_to_video" | "image_to_video";
export type KlingArgumentSpec = { name: string; required?: boolean; default?: string; allowedValues?: string[]; description?: string };
export type KlingModelSpec = { model: string; alias?: string; description?: string; arguments?: KlingArgumentSpec[]; inputs?: Array<{ name?: string; required?: boolean }> };
export type KlingStatus = { available: boolean; loggedIn: boolean; loginRunning?: boolean; version?: string; identity?: Record<string, unknown> };
export type KlingTaskState = { status: "pending" } | { status: "completed"; urls: string[] } | { status: "failed"; error: string };

const pendingStatuses = new Set(["submitted", "pending", "queuing", "queueing", "processing", "running"]);
const completedStatuses = new Set(["succeeded", "success", "completed", "complete", "finished"]);
const failedStatuses = new Set(["failed", "failure", "cancelled", "canceled", "expired"]);

const IMAGE_QUALITY_ALIASES: Record<string, string> = {
    auto: "2k",
    high: "2k",
    medium: "2k",
    low: "1k",
    "1k": "1k",
    "2k": "2k",
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`/api/kling-cli${path}`, init);
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T;
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "可灵 CLI 请求失败");
    return payload;
}

export async function getKlingStatus(signal?: AbortSignal): Promise<KlingStatus> {
    try {
        const result = await request<{ available?: boolean; loggedIn?: boolean; loginRunning?: boolean; version?: string; identity?: Record<string, unknown> }>("/status", { signal });
        return { available: result.available !== false, loggedIn: result.loggedIn === true, loginRunning: result.loginRunning, version: result.version, identity: result.identity };
    } catch {
        return { available: false, loggedIn: false };
    }
}

export async function loginKling(signal?: AbortSignal) {
    const cancel = () => void cancelKlingRequest("login");
    signal?.addEventListener("abort", cancel, { once: true });
    try {
        await request("/login", { method: "POST", signal });
        for (let attempt = 0; attempt < 200; attempt += 1) {
            await delay(1500, signal);
            const status = await getKlingStatus(signal);
            if (status.loggedIn) return status;
            if (attempt > 1 && status.available && status.loginRunning === false) throw new Error("可灵授权未完成，请重新授权");
        }
        throw new Error("可灵授权等待超时，请重新授权");
    } finally {
        signal?.removeEventListener("abort", cancel);
    }
}

export function logoutKling(signal?: AbortSignal) {
    return request("/logout", { method: "POST", signal });
}

export function getKlingAccount(signal?: AbortSignal) {
    return request<{ body?: Record<string, unknown> }>("/account", { signal }).then((result) => result.body || {});
}

export async function syncKlingModels(signal?: AbortSignal) {
    const result = await request<{ body?: Record<string, unknown> }>("/models", { signal });
    const body = result.body || {};
    const available = (body.availableModels || body.available_models || {}) as Record<string, unknown>;
    const grouped = new Map<string, ChannelModel>();
    for (const [tool, capability] of Object.entries({ text_to_image: "image", image_to_image: "image", text_to_video: "video", image_to_video: "video" } satisfies Record<KlingTool, ModelCapability>)) {
        for (const spec of modelsForTool(available[tool])) {
            const previous = grouped.get(spec.model);
            const toolArgs = spec.arguments || [];
            grouped.set(spec.model, {
                name: spec.model,
                label: previous?.label || spec.alias || spec.model,
                capability,
                klingTools: Array.from(new Set([...(previous?.klingTools || []), tool])),
                klingArguments: mergeArguments(previous?.klingArguments || [], toolArgs),
                klingArgsByTool: { ...(previous?.klingArgsByTool || {}), [tool]: toolArgs },
            });
        }
    }
    return { identity: body, models: Array.from(grouped.values()) };
}

export function klingArgumentsForTool(model: ChannelModel | null | undefined, tool?: string) {
    if (!model) return [];
    if (tool && model.klingArgsByTool?.[tool]?.length) return model.klingArgsByTool[tool];
    return model.klingArguments || [];
}

function modelsForTool(value: unknown): KlingModelSpec[] {
    const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const list = Array.isArray(value) ? value : Array.isArray(record.models) ? record.models : [];
    return list
        .map((item) => {
            const model = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
            const name = String(model.model || "").trim();
            const args = Array.isArray(model.arguments)
                ? model.arguments
                      .map((argument) => normalizeArgument(argument))
                      .filter((argument): argument is KlingArgumentSpec => Boolean(argument))
                : [];
            return { model: name, alias: stringValue(model.alias), description: stringValue(model.description), arguments: args };
        })
        .filter((model) => model.model);
}

function normalizeArgument(value: unknown): KlingArgumentSpec | null {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const name = String(record.name || "").trim();
    if (!name) return null;
    const allowed = record.allowedValues ?? record.allowed_values;
    return {
        name,
        required: record.required === true,
        default: stringValue(record.default),
        allowedValues: Array.isArray(allowed) ? allowed.map(String) : undefined,
        description: stringValue(record.description),
    };
}

/** 同名参数合并时并集 allowedValues，避免文生/图生规格互相覆盖丢失可选值。 */
function mergeArguments(previous: KlingArgumentSpec[], next: KlingArgumentSpec[]) {
    const map = new Map(previous.map((item) => [item.name, item]));
    for (const item of next) {
        const existing = map.get(item.name);
        if (!existing) {
            map.set(item.name, item);
            continue;
        }
        const allowed = Array.from(new Set([...(existing.allowedValues || []), ...(item.allowedValues || [])]));
        map.set(item.name, {
            ...existing,
            ...item,
            default: item.default ?? existing.default,
            description: item.description || existing.description,
            allowedValues: allowed.length ? allowed : undefined,
        });
    }
    return Array.from(map.values());
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : undefined;
}

export async function createKlingTask(input: { tool: KlingTool; model: string; prompt: string; images?: string[]; arguments?: Record<string, string | number | boolean>; signal?: AbortSignal }) {
    const requestId = nanoid();
    const cancel = () => void cancelKlingRequest(requestId);
    input.signal?.addEventListener("abort", cancel, { once: true });
    try {
        const result = await request<{ body?: Record<string, unknown> }>("/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requestId, command: input.tool, model: input.model, prompt: input.prompt, images: input.images || [], arguments: input.arguments || {} }),
            signal: input.signal,
        });
        const body = result.body || {};
        const id = String(body.generationId || body.generation_id || "").trim();
        if (!id) throw new Error("可灵未返回 generationId");
        return id;
    } finally {
        input.signal?.removeEventListener("abort", cancel);
    }
}

export async function queryKlingTask(generationId: string, signal?: AbortSignal): Promise<KlingTaskState> {
    const result = await request<{ body?: Record<string, unknown> }>(`/task/${encodeURIComponent(generationId)}`, { signal });
    return normalizeTaskState(result.body || {});
}

export function cancelKlingRequest(requestId: string) {
    return request("/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId }) });
}

export async function requestKlingImages(config: AiConfig, model: ChannelModel, prompt: string, references: ReferenceImage[], signal?: AbortSignal) {
    const images = await Promise.all(references.map(imageToDataUrl));
    const tool: KlingTool = references.length ? "image_to_image" : "text_to_image";
    assertTool(model, tool);
    const id = await createKlingTask({
        tool,
        model: model.name,
        prompt,
        images,
        arguments: declaredArguments(model, tool, {
            ...config.modelParams,
            aspectRatio: config.size,
            imgResolution: config.quality,
            imageCount: Math.max(1, Math.min(15, Number(config.count) || 1)),
        }),
        signal,
    });
    for (let attempt = 0; attempt < 120; attempt += 1) {
        const state = await queryKlingTask(id, signal);
        if (state.status === "completed") return state.urls.map((dataUrl) => ({ id: nanoid(), dataUrl }));
        if (state.status === "failed") throw new Error(state.error);
        await delay(2500, signal);
    }
    throw new Error("可灵图片生成超时，可稍后通过 generationId 查询");
}

export async function createKlingVideoTask(config: AiConfig, model: ChannelModel, prompt: string, references: ReferenceImage[], signal?: AbortSignal) {
    const tool: KlingTool = references.length ? "image_to_video" : "text_to_video";
    assertTool(model, tool);
    return createKlingTask({
        tool,
        model: model.name,
        prompt,
        images: await Promise.all(references.map(imageToDataUrl)),
        arguments: declaredArguments(model, tool, {
            ...config.modelParams,
            aspectRatio: config.size,
            resolution: config.vquality,
            duration: config.videoSeconds,
            generateAudio: config.videoGenerateAudio,
            watermark: config.videoWatermark,
        }),
        signal,
    });
}

function assertTool(model: ChannelModel, tool: KlingTool) {
    if (!model.klingTools?.includes(tool)) throw new Error(`模型 ${model.name} 不支持 ${tool}`);
}

function declaredArguments(model: ChannelModel, tool: KlingTool, values: Record<string, string | number | boolean>) {
    const specs = klingArgumentsForTool(model, tool);
    const aliases: Record<string, string[]> = {
        aspectRatio: ["aspectRatio", "aspect_ratio", "ratio"],
        imgResolution: ["imgResolution", "img_resolution"],
        resolution: ["resolution"],
        imageCount: ["imageCount", "image_count", "count"],
        duration: ["duration", "seconds"],
        generateAudio: ["enable_audio", "enableAudio", "generateAudio", "generate_audio"],
        watermark: ["watermark"],
    };
    const result: Record<string, string | number | boolean> = {};
    for (const spec of specs) {
        if (spec.name === "prompt") continue;
        const value = values[spec.name];
        if (value == null || value === "") continue;
        const normalized = coerceArgumentValue(spec, value);
        if (normalized == null) continue;
        result[spec.name] = normalized;
    }
    for (const [source, candidates] of Object.entries(aliases)) {
        const spec = specs.find((item) => candidates.includes(item.name));
        if (!spec || result[spec.name] != null) continue;
        const value = values[source];
        if (value == null || value === "") continue;
        const normalized = coerceArgumentValue(spec, value, source);
        if (normalized == null) continue;
        result[spec.name] = normalized;
    }
    return result;
}

function coerceArgumentValue(spec: KlingArgumentSpec, value: string | number | boolean, source?: string): string | number | boolean | null {
    let next: string | number | boolean = value;
    if (source === "imgResolution" || spec.name === "img_resolution" || spec.name === "imgResolution") {
        next = normalizeImageResolution(String(value));
    } else if (source === "resolution" || spec.name === "resolution") {
        next = normalizeVideoResolution(String(value));
    } else if (source === "aspectRatio" || spec.name === "aspect_ratio" || spec.name === "aspectRatio" || spec.name === "ratio") {
        next = normalizeAspectRatio(String(value));
        if (!next) return null;
    } else if (source === "generateAudio" || spec.name === "enable_audio" || spec.name === "enableAudio" || spec.name === "generateAudio" || spec.name === "generate_audio") {
        next = normalizeBooleanFlag(value);
    } else if (typeof value === "boolean" && spec.allowedValues?.every((item) => item === "true" || item === "false")) {
        next = value ? "true" : "false";
    } else if (typeof value === "number") {
        next = String(value);
    }

    const text = String(next);
    if (!spec.allowedValues?.length) return next;
    if (spec.allowedValues.includes(text)) return text;
    const lower = text.toLowerCase();
    const hit = spec.allowedValues.find((item) => item.toLowerCase() === lower);
    if (hit) return hit;
    if (spec.default != null && spec.allowedValues.includes(String(spec.default))) return String(spec.default);
    return null;
}

function normalizeImageResolution(raw: string) {
    const value = raw.trim().toLowerCase();
    if (!value) return "2k";
    if (value.includes("|")) {
        const [left, right] = value.split("|");
        return IMAGE_QUALITY_ALIASES[right?.trim().toLowerCase() || ""] || IMAGE_QUALITY_ALIASES[left?.trim().toLowerCase() || ""] || "2k";
    }
    return IMAGE_QUALITY_ALIASES[value] || (/^\d+k$/.test(value) ? value : "2k");
}

function normalizeVideoResolution(raw: string) {
    const value = raw.trim().toLowerCase();
    if (!value) return "720p";
    if (/^\d+p$/i.test(value)) return value;
    if (/^\d+$/.test(value)) return `${value}p`;
    if (value === "high" || value === "medium" || value === "auto") return "720p";
    if (value === "low") return "480p";
    return value.endsWith("p") ? value : `${value}p`;
}

function normalizeAspectRatio(raw: string) {
    const value = raw.trim();
    if (!value || value === "adaptive") return "";
    if (value.includes(":")) return value;
    if (value === "auto") return "auto";
    const dims = /^(\d+)x(\d+)$/i.exec(value);
    if (!dims) return value;
    const width = Number(dims[1]);
    const height = Number(dims[2]);
    if (!width || !height) return "";
    const ratio = width / height;
    const presets: Array<[string, number]> = [
        ["16:9", 16 / 9],
        ["9:16", 9 / 16],
        ["1:1", 1],
        ["4:3", 4 / 3],
        ["3:4", 3 / 4],
        ["3:2", 3 / 2],
        ["2:3", 2 / 3],
        ["21:9", 21 / 9],
    ];
    return presets.reduce((best, item) => (Math.abs(item[1] - ratio) < Math.abs(best[1] - ratio) ? item : best))[0];
}

function normalizeBooleanFlag(value: string | number | boolean) {
    if (typeof value === "boolean") return value ? "true" : "false";
    const text = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(text)) return "true";
    if (["0", "false", "no", "off"].includes(text)) return "false";
    return text;
}

function normalizeTaskState(body: Record<string, unknown>): KlingTaskState {
    const node = unwrapTask(body);
    const status = String(node.status || node.state || node.taskStatus || node.task_status || "").toLowerCase();
    const urls = collectWorkUrls(node);
    if (urls.length && (!status || completedStatuses.has(status))) return { status: "completed", urls };
    if (failedStatuses.has(status)) return { status: "failed", error: String(node.message || node.error || "可灵生成失败") };
    if (!status || pendingStatuses.has(status)) return { status: "pending" };
    if (completedStatuses.has(status)) return { status: "failed", error: "可灵任务已完成，但没有返回资源" };
    return { status: "pending" };
}

function unwrapTask(body: Record<string, unknown>): Record<string, unknown> {
    for (const key of ["data", "task", "result"]) {
        const value = body[key];
        if (value && typeof value === "object" && !Array.isArray(value)) return unwrapTask(value as Record<string, unknown>);
    }
    return body;
}

function collectWorkUrls(value: unknown): string[] {
    if (!value || typeof value !== "object") return [];
    if (Array.isArray(value)) return value.flatMap(collectWorkUrls);
    const record = value as Record<string, unknown>;
    const own = [record.localUrl, record.urlWithoutWatermark, record.url_without_watermark, record.url, record.videoUrl, record.video_url].filter((item): item is string => typeof item === "string" && item);
    return Array.from(new Set([...own, ...Object.values(record).flatMap(collectWorkUrls)]));
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
            window.clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
    });
}
