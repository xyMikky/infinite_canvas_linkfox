import axios from "axios";

import i18n from "@/i18n";
import {
    extractRunninghubOutputs,
    isRunninghubOkCode,
    pollRunninghubTask,
    runninghubHeaders,
    type RunninghubConfig,
} from "./runninghub-client";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type RunninghubAiAppNodeInfo = {
    nodeId: string;
    fieldName: string;
    fieldValue: string;
};

export type RunRunninghubAiAppOptions = {
    nodeInfoList: RunninghubAiAppNodeInfo[];
    instanceType?: string;
    usePersonalQueue?: boolean;
    retainSeconds?: number;
};

const RH_CN_TASK_PROXY = "/api/rh-cn-task";

function cnTaskBase(baseUrl: string) {
    const trimmed = (baseUrl || "").trim().replace(/\/+$/, "");
    if (!trimmed || trimmed.includes("runninghub.cn") || trimmed === "/api/runninghub-cn") return RH_CN_TASK_PROXY;
    return trimmed.replace(/\/openapi\/v2$/i, "") || RH_CN_TASK_PROXY;
}

function readError(payload: Record<string, unknown> | undefined, fallback: string) {
    if (!payload) return fallback;
    const message =
        (typeof payload.errorMessage === "string" && payload.errorMessage) ||
        (typeof payload.msg === "string" && payload.msg) ||
        (typeof payload.message === "string" && payload.message) ||
        (typeof payload.error === "string" && payload.error) ||
        "";
    return message || fallback;
}

export async function uploadRunninghubAiAppFile(config: Pick<RunninghubConfig, "baseUrl" | "apiKey">, blob: Blob, filename: string, signal?: AbortSignal) {
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    const form = new FormData();
    form.append("apiKey", config.apiKey);
    form.append("fileType", "input");
    form.append("file", blob, filename || "input.png");
    try {
        const response = await axios.post<Record<string, unknown>>(`${cnTaskBase(config.baseUrl)}/task/openapi/upload`, form, {
            signal,
            timeout: 120_000,
        });
        if (!isRunninghubOkCode(response.data?.code)) throw new Error(readError(response.data, apiText("runninghubUploadFailed")));
        const data = (response.data?.data || {}) as Record<string, unknown>;
        const fileName = String(data.fileName || data.file_name || "").trim();
        if (!fileName) throw new Error(apiText("runninghubUploadFailed"));
        return fileName;
    } catch (error) {
        if (axios.isCancel(error) || signal?.aborted) throw new Error(apiText("requestCanceled"));
        if (axios.isAxiosError(error)) throw new Error(readError(error.response?.data as Record<string, unknown>, apiText("runninghubUploadFailed")));
        throw error;
    }
}

export async function runRunninghubAiApp(config: Pick<RunninghubConfig, "baseUrl" | "apiKey">, webappId: string, options: RunRunninghubAiAppOptions, signal?: AbortSignal) {
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    const appId = webappId.trim();
    if (!appId) throw new Error(apiText("requestFailed"));
    const base = cnTaskBase(config.baseUrl);
    try {
        const response = await axios.post<Record<string, unknown>>(
            `${base}/task/openapi/ai-app/run`,
            {
                apiKey: config.apiKey,
                webappId: appId,
                nodeInfoList: options.nodeInfoList,
                instanceType: options.instanceType || "plus",
                usePersonalQueue: Boolean(options.usePersonalQueue),
                ...(options.retainSeconds != null && options.retainSeconds >= 10 ? { retainSeconds: options.retainSeconds } : {}),
            },
            {
                headers: runninghubHeaders(config.apiKey, "application/json"),
                signal,
                timeout: 60_000,
            },
        );
        if (!isRunninghubOkCode(response.data?.code)) throw new Error(readError(response.data, apiText("runninghubGenerationFailed")));
        const nested = (response.data?.data && typeof response.data.data === "object" ? response.data.data : response.data) as Record<string, unknown>;
        const taskId = String(nested.taskId || nested.task_id || response.data?.taskId || "").trim();
        if (!taskId) throw new Error(apiText("runninghubNoTaskId"));
        const immediate = extractAiAppOutputs(nested);
        if (immediate.length) return { taskId, outputs: immediate };
        const polled = await pollRunninghubTask(config, taskId, signal);
        const outputs = extractRunninghubOutputs(polled);
        return { taskId, outputs: outputs.length ? outputs : extractAiAppOutputs(polled) };
    } catch (error) {
        if (axios.isCancel(error) || signal?.aborted) throw new Error(apiText("requestCanceled"));
        if (axios.isAxiosError(error)) throw new Error(readError(error.response?.data as Record<string, unknown>, apiText("runninghubGenerationFailed")));
        throw error;
    }
}

function extractAiAppOutputs(data: Record<string, unknown>) {
    const outputs: string[] = [];
    const push = (value: unknown) => {
        if (typeof value === "string" && value.trim()) outputs.push(value.trim());
    };
    const walk = (item: unknown) => {
        if (!item) return;
        if (typeof item === "string") {
            push(item);
            return;
        }
        if (Array.isArray(item)) {
            item.forEach(walk);
            return;
        }
        if (typeof item !== "object") return;
        const record = item as Record<string, unknown>;
        push(record.fileUrl || record.file_url || record.url || record.outputUrl || record.output_url);
        walk(record.results);
        walk(record.outputs);
        walk(record.files);
        walk(record.data);
    };
    walk(data);
    return [...new Set(outputs)];
}
