import axios from "axios";

import i18n from "@/i18n";
import { modelOptionName } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { RUNNINGHUB_MODELS } from "./runninghub-models";
import { resolveRunninghubImageUrls, runRunninghubEndpoint, type RunninghubConfig } from "./runninghub-client";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export function isRunninghubModel3dEndpoint(endpoint: string) {
    const name = (endpoint || "").trim().replace(/^\/+/, "");
    return RUNNINGHUB_MODELS.some((item) => item.capability === "model" && item.name === name);
}

export async function requestRunninghubModel(config: RunninghubConfig, prompt: string, references: ReferenceImage[] = [], options?: { signal?: AbortSignal }) {
    const endpoint = modelOptionName(config.model || "").replace(/^\/+/, "");
    if (!endpoint) throw new Error(apiText("runninghubEndpointRequired"));
    if (!isRunninghubModel3dEndpoint(endpoint)) throw new Error(apiText("runninghubModelUnsupported"));
    const def = RUNNINGHUB_MODELS.find((item) => item.name === endpoint);
    const needsImage = /image-to-3d/i.test(endpoint);
    if (needsImage && !references.length) throw new Error(apiText("runninghubReferenceRequired"));
    const imageUrls = needsImage ? await resolveRunninghubImageUrls(config, references, options?.signal) : [];
    if (needsImage && !imageUrls.length) throw new Error(apiText("runninghubReferenceRequired"));

    const payload: Record<string, unknown> = {};
    if (prompt.trim() && /text-to-3d/i.test(endpoint)) payload.prompt = prompt.trim();
    if (imageUrls.length) payload.imageUrl = imageUrls[0];

    const modelParams = config.modelParams || {};
    for (const param of def?.params || []) {
        const raw = modelParams[param.fieldKey] !== undefined ? modelParams[param.fieldKey] : param.defaultValue;
        if (raw === undefined) continue;
        if (param.type === "BOOLEAN") {
            payload[param.fieldKey] = Boolean(raw);
            continue;
        }
        if (param.type === "INT") {
            let n = Math.round(Number(raw));
            if (!Number.isFinite(n)) n = Math.round(Number(param.defaultValue) || 0);
            if (typeof param.min === "number") n = Math.max(param.min, n);
            if (typeof param.max === "number") n = Math.min(param.max, n);
            payload[param.fieldKey] = n;
            continue;
        }
        payload[param.fieldKey] = raw;
    }

    const result = await runRunninghubEndpoint(config, endpoint, payload, options?.signal);
    const output =
        result.outputs.find((item) => /\.(glb|gltf|obj|fbx|usdz)(\?|$)/i.test(item)) ||
        result.outputs.find((item) => /^https?:\/\//i.test(item) || item.startsWith("data:"));
    if (!output) throw new Error(apiText("runninghubGenerationFailed"));
    const blob = await downloadModelBlob(output, options?.signal);
    const fileName = fileNameFromUrl(output, blob.type);
    const showTextures = payload.requestType !== "mesh" && payload.enablePbr !== false;
    return { blob, fileName, mimeType: blob.type || "model/gltf-binary", showTextures };
}

function fileNameFromUrl(url: string, mimeType: string) {
    try {
        const path = new URL(url).pathname;
        const name = path.split("/").filter(Boolean).pop() || "";
        if (name.includes(".")) return decodeURIComponent(name);
    } catch {
        // keep fallback
    }
    if (mimeType.includes("gltf+json")) return "model.gltf";
    if (mimeType.includes("obj")) return "model.obj";
    return "model.glb";
}

async function downloadModelBlob(output: string, signal?: AbortSignal) {
    if (output.startsWith("data:")) return (await fetch(output, { signal })).blob();
    const response = await axios.get<ArrayBuffer>(output, { responseType: "arraybuffer", signal, timeout: 180_000 });
    const contentType = String(response.headers["content-type"] || "model/gltf-binary");
    return new Blob([response.data], { type: contentType.includes("json") ? contentType : contentType || "model/gltf-binary" });
}
