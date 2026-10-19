import i18n from "@/i18n";
import {
    resolveRunninghubImageUrls,
    runRunninghubEndpoint,
    withSystemPrompt,
    type RunninghubConfig,
} from "./runninghub-client";
import type { ReferenceImage } from "@/types/image";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type RunninghubTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type?: string; text?: string; image_url?: string | { url?: string }; imageUrl?: string }>;
};

function resolveTextEndpoint(model: string, hasImage: boolean) {
    const endpoint = (model || "").trim().replace(/^\/+/, "") || "rhart-text-g-3-flash-preview/text-to-text";
    if (hasImage && endpoint.endsWith("/text-to-text")) return endpoint.replace(/\/text-to-text$/, "/image-to-text");
    if (!hasImage && endpoint.endsWith("/image-to-text")) return endpoint.replace(/\/image-to-text$/, "/text-to-text");
    return endpoint;
}

function extractPrompt(messages: RunninghubTextMessage[], systemPrompt: string) {
    const parts: string[] = [];
    for (const message of messages) {
        if (message.role === "system") continue;
        if (typeof message.content === "string") {
            const text = message.content.trim();
            if (text) parts.push(text);
            continue;
        }
        if (Array.isArray(message.content)) {
            for (const part of message.content) {
                const text = (part.text || "").trim();
                if (text) parts.push(text);
            }
        }
    }
    return withSystemPrompt(systemPrompt || "", parts.join("\n\n").trim());
}

async function extractImages(config: RunninghubConfig, messages: RunninghubTextMessage[], signal?: AbortSignal) {
    const refs: ReferenceImage[] = [];
    for (const message of messages) {
        if (typeof message.content === "string" || !Array.isArray(message.content)) continue;
        for (const part of message.content) {
            const raw = (typeof part.image_url === "string" ? part.image_url : part.image_url?.url) || part.imageUrl || "";
            if (!raw.trim()) continue;
            refs.push({ id: `rh-${refs.length}`, name: `image-${refs.length + 1}`, type: "image/png", dataUrl: raw, url: raw.startsWith("http") ? raw : "" });
        }
    }
    if (!refs.length) return [] as string[];
    return resolveRunninghubImageUrls(config, refs, signal);
}

export async function requestRunninghubText(config: RunninghubConfig, messages: RunninghubTextMessage[], onDelta: (text: string) => void, options?: { signal?: AbortSignal }) {
    const prompt = extractPrompt(messages, config.systemPrompt || "");
    if (!prompt.trim()) throw new Error(apiText("runninghubTextPromptRequired"));
    const imageUrls = await extractImages(config, messages, options?.signal);
    const endpoint = resolveTextEndpoint(config.model || "rhart-text-g-3-flash-preview/text-to-text", imageUrls.length > 0);
    const payload: Record<string, unknown> = { prompt };
    if (imageUrls.length) payload.imageUrl = imageUrls[0];
    const result = await runRunninghubEndpoint(config, endpoint, payload, options?.signal);
    const content = (result.outputs.find((item) => !/^https?:\/\//i.test(item)) || result.outputs[0] || "").trim() || apiText("noContent");
    onDelta(content);
    return content;
}
