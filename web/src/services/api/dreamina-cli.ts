import { nanoid } from "nanoid";

import type { AiConfig, ChannelModel } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { imageToDataUrl } from "@/services/image-storage";

export type DreaminaStatus = {
    available: boolean;
    loggedIn: boolean;
    loginRunning?: boolean;
    version?: Record<string, unknown> | null;
    account?: Record<string, unknown>;
};

export type DreaminaLoginFlow = {
    verificationUri: string;
    userCode: string;
    deviceCode: string;
};

export type DreaminaTaskState = { status: "pending" } | { status: "completed"; urls: string[] } | { status: "failed"; error: string };

type DreaminaTool = "text2image" | "image2image" | "text2video" | "image2video";

const IMAGE_MODELS: Array<{ name: string; label: string; tools: DreaminaTool[]; resolutions: string[] }> = [
    { name: "3.0", label: "即梦 3.0", tools: ["text2image"], resolutions: ["1k", "2k"] },
    { name: "3.1", label: "即梦 3.1", tools: ["text2image"], resolutions: ["1k", "2k"] },
    { name: "4.0", label: "即梦 4.0", tools: ["text2image", "image2image"], resolutions: ["2k", "4k"] },
    { name: "4.1", label: "即梦 4.1", tools: ["text2image", "image2image"], resolutions: ["2k", "4k"] },
    { name: "4.5", label: "即梦 4.5", tools: ["text2image", "image2image"], resolutions: ["2k", "4k"] },
    { name: "4.6", label: "即梦 4.6", tools: ["text2image", "image2image"], resolutions: ["2k", "4k"] },
    { name: "4.7", label: "即梦 4.7", tools: ["text2image", "image2image"], resolutions: ["2k", "4k"] },
    { name: "5.0", label: "即梦 5.0", tools: ["text2image", "image2image"], resolutions: ["2k", "4k"] },
    { name: "5.0Pro", label: "即梦 5.0 Pro", tools: ["text2image", "image2image"], resolutions: ["1.5k", "2k", "4k"] },
];

const VIDEO_MODELS: Array<{ name: string; label: string; tools: DreaminaTool[]; resolutions: string[]; durationMin: number; durationMax: number }> = [
    { name: "seedance2.0fast", label: "Seedance 2.0 Fast", tools: ["text2video", "image2video"], resolutions: ["720p"], durationMin: 4, durationMax: 15 },
    { name: "seedance2.0", label: "Seedance 2.0", tools: ["text2video", "image2video"], resolutions: ["720p"], durationMin: 4, durationMax: 15 },
    { name: "seedance2.0mini", label: "Seedance 2.0 Mini", tools: ["text2video", "image2video"], resolutions: ["720p"], durationMin: 4, durationMax: 15 },
    { name: "seedance2.0_vip", label: "Seedance 2.0 VIP", tools: ["text2video", "image2video"], resolutions: ["720p", "1080p", "4k"], durationMin: 4, durationMax: 15 },
    { name: "seedance2.0fast_vip", label: "Seedance 2.0 Fast VIP", tools: ["text2video", "image2video"], resolutions: ["720p"], durationMin: 4, durationMax: 15 },
    { name: "seedance2.5", label: "Seedance 2.5", tools: ["text2video", "image2video"], resolutions: ["480p", "720p", "1080p"], durationMin: 4, durationMax: 30 },
    { name: "seedance1.5pro", label: "Seedance 1.5 Pro", tools: ["image2video"], resolutions: ["720p"], durationMin: 5, durationMax: 12 },
    { name: "seedance1.0fast", label: "Seedance 1.0 Fast", tools: ["image2video"], resolutions: ["720p"], durationMin: 5, durationMax: 10 },
];

const IMAGE_RATIOS = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"];
const VIDEO_RATIOS = ["1:1", "3:4", "16:9", "4:3", "9:16", "21:9"];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`/api/dreamina-cli${path}`, init);
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string } & T;
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "即梦 CLI 请求失败");
    return payload;
}

export async function getDreaminaStatus(signal?: AbortSignal): Promise<DreaminaStatus> {
    try {
        const result = await request<DreaminaStatus>("/status", { signal });
        return { available: result.available !== false, loggedIn: result.loggedIn === true, loginRunning: result.loginRunning, version: result.version, account: result.account };
    } catch {
        return { available: false, loggedIn: false };
    }
}

export async function startDreaminaLogin(signal?: AbortSignal): Promise<DreaminaLoginFlow> {
    const result = await request<DreaminaLoginFlow>("/login", { method: "POST", signal });
    if (!result.deviceCode) throw new Error("即梦未返回 device_code");
    return {
        verificationUri: result.verificationUri || "",
        userCode: result.userCode || "",
        deviceCode: result.deviceCode,
    };
}

export async function checkDreaminaLogin(deviceCode: string, signal?: AbortSignal) {
    return request<{ loggedIn?: boolean }>("/login/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceCode, poll: 2 }),
        signal,
    });
}

export async function loginDreamina(signal?: AbortSignal) {
    const existing = await getDreaminaStatus(signal);
    if (existing.loggedIn) return { verificationUri: "", userCode: "", deviceCode: "", loggedIn: true as const };
    const flow = await startDreaminaLogin(signal);
    if (flow.verificationUri) window.open(flow.verificationUri, "_blank", "noopener,noreferrer");
    for (let attempt = 0; attempt < 180; attempt += 1) {
        await delay(2000, signal);
        try {
            const checked = await checkDreaminaLogin(flow.deviceCode, signal);
            if (checked.loggedIn) return { ...flow, loggedIn: true as const };
        } catch {
            const status = await getDreaminaStatus(signal);
            if (status.loggedIn) return { ...flow, loggedIn: true as const };
        }
    }
    throw new Error("即梦授权等待超时，请重新授权");
}

export function logoutDreamina(signal?: AbortSignal) {
    return request("/logout", { method: "POST", signal });
}

export function getDreaminaAccount(signal?: AbortSignal) {
    return request<{ body?: Record<string, unknown> }>("/account", { signal }).then((result) => result.body || {});
}

export async function syncDreaminaModels() {
    const models: ChannelModel[] = [
        ...IMAGE_MODELS.map((item) => ({
            name: item.name,
            label: item.label,
            capability: "image" as const,
            dreaminaTools: item.tools,
            dreaminaResolutions: item.resolutions,
            dreaminaRatios: IMAGE_RATIOS,
        })),
        ...VIDEO_MODELS.map((item) => ({
            name: item.name,
            label: item.label,
            capability: "video" as const,
            dreaminaTools: item.tools,
            dreaminaResolutions: item.resolutions,
            dreaminaDurationMin: item.durationMin,
            dreaminaDurationMax: item.durationMax,
            dreaminaRatios: item.tools.includes("text2video") ? VIDEO_RATIOS : undefined,
        })),
    ];
    return { models };
}

export async function requestDreaminaImages(config: AiConfig, model: ChannelModel, prompt: string, references: ReferenceImage[], signal?: AbortSignal) {
    const tool: DreaminaTool = references.length ? "image2image" : "text2image";
    assertTool(model, tool);
    const images = await Promise.all(references.map(imageToDataUrl));
    const resolution = normalizeImageResolution(config.quality, model.dreaminaResolutions || ["2k"]);
    const ratio = normalizeRatio(config.size, model.dreaminaRatios || IMAGE_RATIOS);
    const id = await createDreaminaTask({
        tool,
        model: model.name,
        prompt,
        images,
        arguments: {
            resolution_type: resolution,
            ...(ratio ? { ratio } : {}),
            generate_num: Math.max(1, Math.min(10, Number(config.count) || 1)),
        },
        signal,
    });
    for (let attempt = 0; attempt < 180; attempt += 1) {
        const state = await queryDreaminaTask(id, signal);
        if (state.status === "completed") return state.urls.map((dataUrl) => ({ id: nanoid(), dataUrl }));
        if (state.status === "failed") throw new Error(state.error);
        await delay(2500, signal);
    }
    throw new Error("即梦图片生成超时，可稍后通过 submit_id 查询");
}

export async function createDreaminaVideoTask(config: AiConfig, model: ChannelModel, prompt: string, references: ReferenceImage[], signal?: AbortSignal) {
    const tool: DreaminaTool = references.length ? "image2video" : "text2video";
    assertTool(model, tool);
    const resolution = normalizeVideoResolution(config.vquality, model.dreaminaResolutions || ["720p"]);
    const duration = clampDuration(config.videoSeconds, model.dreaminaDurationMin || 4, model.dreaminaDurationMax || 15);
    const args: Record<string, string | number | boolean> = {
        video_resolution: resolution,
        duration,
    };
    if (tool === "text2video") {
        const ratio = normalizeRatio(config.size, model.dreaminaRatios || VIDEO_RATIOS);
        if (ratio) args.ratio = ratio;
    }
    return createDreaminaTask({
        tool,
        model: model.name,
        prompt,
        images: await Promise.all(references.map(imageToDataUrl)),
        arguments: args,
        signal,
    });
}

export async function createDreaminaTask(input: {
    tool: DreaminaTool;
    model: string;
    prompt: string;
    images?: string[];
    arguments?: Record<string, string | number | boolean>;
    signal?: AbortSignal;
}) {
    const requestId = nanoid();
    const cancel = () => void cancelDreaminaRequest(requestId);
    input.signal?.addEventListener("abort", cancel, { once: true });
    try {
        const result = await request<{ body?: Record<string, unknown> }>("/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                requestId,
                command: input.tool,
                model: input.model,
                prompt: input.prompt,
                images: input.images || [],
                arguments: input.arguments || {},
            }),
            signal: input.signal,
        });
        const id = String(result.body?.submit_id || result.body?.submitId || "").trim();
        if (!id) throw new Error("即梦未返回 submit_id");
        return id;
    } finally {
        input.signal?.removeEventListener("abort", cancel);
    }
}

export async function queryDreaminaTask(submitId: string, signal?: AbortSignal): Promise<DreaminaTaskState> {
    const result = await request<{ body?: Record<string, unknown> }>(`/task/${encodeURIComponent(submitId)}`, { signal });
    return normalizeTaskState(result.body || {});
}

export function cancelDreaminaRequest(requestId: string) {
    return request("/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId }) });
}

function assertTool(model: ChannelModel, tool: DreaminaTool) {
    if (!model.dreaminaTools?.includes(tool)) throw new Error(`模型 ${model.name} 不支持 ${tool}`);
}

function normalizeTaskState(body: Record<string, unknown>): DreaminaTaskState {
    const status = String(body.gen_status || body.genStatus || body.status || "").toLowerCase();
    const urls = collectUrls(body);
    if (urls.length && (!status || status === "success" || status === "succeeded" || status === "completed")) return { status: "completed", urls };
    if (status === "fail" || status === "failed" || status === "error") return { status: "failed", error: String(body.fail_reason || body.failReason || body.error || "即梦生成失败") };
    if (status === "querying" || status === "pending" || status === "running" || status === "processing" || !status) return { status: "pending" };
    if (status === "success" || status === "succeeded" || status === "completed") return { status: "failed", error: "即梦任务已完成，但没有返回资源" };
    return { status: "pending" };
}

function collectUrls(value: unknown): string[] {
    if (!value) return [];
    if (typeof value === "string") return /^https?:\/\//i.test(value) || value.startsWith("/api/dreamina-cli/") ? [value] : [];
    if (Array.isArray(value)) return value.flatMap(collectUrls);
    if (typeof value === "object") {
        const record = value as Record<string, unknown>;
        const own = [record.urls, record.localUrls, record.local_urls].flatMap((item) => (Array.isArray(item) ? item : []));
        return Array.from(new Set([...own.flatMap(collectUrls), ...Object.values(record).flatMap(collectUrls)]));
    }
    return [];
}

function normalizeImageResolution(raw: string, allowed: string[]) {
    const value = (raw || "").trim().toLowerCase();
    if (allowed.includes(value)) return value;
    if (value === "high" || value === "medium" || value === "auto" || value === "2k") return allowed.includes("2k") ? "2k" : allowed[0];
    if (value === "low" || value === "1k") return allowed.includes("1k") ? "1k" : allowed[0];
    if (value === "4k" || value === "2160") return allowed.includes("4k") ? "4k" : allowed[allowed.length - 1];
    if (value.includes("1.5")) return allowed.includes("1.5k") ? "1.5k" : allowed[0];
    return allowed.includes("2k") ? "2k" : allowed[0];
}

function normalizeVideoResolution(raw: string, allowed: string[]) {
    const value = (raw || "").trim().toLowerCase();
    const withP = /^\d+$/.test(value) ? `${value}p` : value;
    if (allowed.includes(withP)) return withP;
    if (allowed.includes(value)) return value;
    return allowed.includes("720p") ? "720p" : allowed[0];
}

function normalizeRatio(raw: string, allowed: string[]) {
    const value = (raw || "").trim();
    // 自适应：不传 --ratio。文生默认 16:9；图生视频由 CLI 按输入图推断，本身也不接受 ratio。
    if (!value || value === "auto" || value === "adaptive") return "";
    if (allowed.includes(value)) return value;
    const dims = /^(\d+)x(\d+)$/i.exec(value);
    if (!dims) return allowed.includes("16:9") ? "16:9" : allowed[0] || "";
    const ratio = Number(dims[1]) / Number(dims[2]);
    const candidates = allowed.filter((item) => item.includes(":"));
    if (!candidates.length) return "";
    return candidates.reduce((best, item) => {
        const [w, h] = item.split(":").map(Number);
        const bestParts = best.split(":").map(Number);
        const bestRatio = (bestParts[0] || 1) / (bestParts[1] || 1);
        return Math.abs(w / h - ratio) < Math.abs(bestRatio - ratio) ? item : best;
    }, candidates[0]);
}

function clampDuration(raw: string, min: number, max: number) {
    const value = Math.floor(Number(raw) || 5);
    return Math.max(min, Math.min(max, value));
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                window.clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}
