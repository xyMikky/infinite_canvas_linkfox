import i18n from "@/i18n";
import type { ReasoningEffort } from "@/stores/use-config-store";
import { linkfoxTaskId, linkfoxTaskStatus, requestLinkfoxAi, resolveLinkfoxAiReferenceUrl } from "./linkfox-ai-client";
import {
    assertLinkfoxConfig,
    createLinkfoxTask,
    LINKFOX_MAX_POLL_TIME_MS,
    pollLinkfoxUntilDone,
    resolveMediaDataUrl,
    sleep,
    withSystemPrompt,
    type LinkfoxRequestConfig,
} from "./linkfox-client";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);
const textError = (key: string) => i18n.t(`linkfoxText.${key}`);

const CREATE_PATH = "/aigc/textGenAsync";
const QUERY_PATH = "/aigc/textTaskQuery";
const V3_TEXT_MODELS = new Set(["GEM_3_7_FLASH", "GEM_3_1_PRO", "GT_6_1_S", "GT_6_L", "GT_6_A"]);
const GPT_TEXT_MODELS = new Set(["GT_6_1_S", "GT_6_L", "GT_6_A"]);

export type LinkfoxTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type?: string; text?: string; image_url?: string | { url?: string }; imageUrl?: string }>;
};

function mapThinkingLevel(effort: ReasoningEffort | undefined, model: string) {
    const value = (effort || "auto").toLowerCase();
    if (value === "auto") return undefined;
    if (GPT_TEXT_MODELS.has(model)) {
        if (value === "xhigh" || value === "max") return value;
        if (value === "none" && model === "GT_6_L") return "none";
        if (value === "low" || value === "medium" || value === "high") return value;
        return "medium";
    }
    let level = "minimal";
    if (value === "low") level = "low";
    else if (value === "medium") level = "medium";
    else if (value === "high" || value === "xhigh") level = "high";
    if (model === "GEM_3_1_PRO" && level === "minimal") return "low";
    return level;
}

function extractPrompt(messages: LinkfoxTextMessage[], systemPrompt: string) {
    const parts: string[] = [];
    const instructions = new Set([systemPrompt.trim()].filter(Boolean));
    const conversation = messages.some((message) => message.role === "assistant");
    for (const message of messages) {
        const text = (typeof message.content === "string" ? message.content : message.content.map((part) => part.text || "").join("\n")).trim();
        if (!text) continue;
        if (message.role === "system") {
            instructions.add(text);
            continue;
        }
        parts.push(conversation ? `${message.role}:\n${text}` : text);
    }
    return { prompt: parts.join("\n\n"), system: [...instructions].join("\n\n") };
}

async function extractImageUrls(config: LinkfoxRequestConfig, messages: LinkfoxTextMessage[], legacy: boolean, signal?: AbortSignal) {
    const urls: string[] = [];
    for (const message of messages) {
        if (typeof message.content === "string" || !Array.isArray(message.content)) continue;
        for (const part of message.content) {
            const raw =
                (typeof part.image_url === "string" ? part.image_url : part.image_url?.url) ||
                part.imageUrl ||
                "";
            if (!raw.trim()) continue;
            urls.push(raw.trim());
        }
    }
    if (urls.length > 10) throw new Error(textError("tooManyImages"));
    return Promise.all(urls.map((url, index) => legacy ? resolveMediaDataUrl(config, url, signal) : resolveLinkfoxAiReferenceUrl(config, {
        id: `text-reference-${index}`, name: "", type: url.match(/^data:([^;,]+)/)?.[1] || "", dataUrl: url,
    }, signal)));
}

export async function requestLinkfoxText(
    config: LinkfoxRequestConfig,
    messages: LinkfoxTextMessage[],
    onDelta: (text: string) => void,
    options?: { signal?: AbortSignal },
) {
    assertLinkfoxConfig(config);
    const requestedModel = config.model.trim().toUpperCase();
    const model = requestedModel === "GEM_3_FLASH" || V3_TEXT_MODELS.has(requestedModel) ? requestedModel : "GEM_3_7_FLASH";
    const extracted = extractPrompt(messages, config.systemPrompt || "");
    const gpt = GPT_TEXT_MODELS.has(model);
    const prompt = gpt ? extracted.prompt : withSystemPrompt(extracted.system, extracted.prompt);
    if (!prompt.trim()) throw new Error(apiText("linkfoxTextPromptRequired"));
    if (prompt.length > 100_000 || extracted.system.length > 100_000) throw new Error(textError("promptTooLong"));
    const legacy = model === "GEM_3_FLASH";
    const imageUrls = await extractImageUrls(config, messages, legacy, options?.signal);
    const thinkingLevel = mapThinkingLevel(config.reasoningEffort, model);
    const body = {
        prompt,
        model,
        ...(thinkingLevel ? { thinkingLevel } : {}),
        ...(gpt && extracted.system ? { systemPrompt: extracted.system } : {}),
    };
    if (!legacy) {
        const created = await requestLinkfoxAi<{ id?: unknown; taskId?: unknown }>(config, "/v2/process/result/textGen/create", {
            ...body, ...(imageUrls.length ? { imageUrlList: imageUrls } : {}),
        }, options?.signal);
        const taskId = linkfoxTaskId(created);
        if (!taskId) throw new Error(textError("invalidTask"));
        const started = Date.now();
        while (Date.now() - started < LINKFOX_MAX_POLL_TIME_MS) {
            await sleep(3_000, options?.signal);
            const task = await requestLinkfoxAi<{ status?: unknown; error?: string; result?: { content?: string } }>(config, "/v2/process/result/textGen/info", { id: taskId }, options?.signal);
            const status = linkfoxTaskStatus(task.status);
            if (status === 4) throw new Error(task.error || textError("generationFailed"));
            if (status === 3) {
                const content = task.result?.content;
                if (typeof content !== "string" || !content.trim()) throw new Error(textError("noResult"));
                onDelta(content);
                return content;
            }
            if (status !== 1 && status !== 2) throw new Error(textError("invalidTask"));
        }
        throw new Error(textError("timeout"));
    }
    const created = await createLinkfoxTask(config, CREATE_PATH, { ...body, imageUrls }, options?.signal);
    const done = await pollLinkfoxUntilDone(config, created.taskId!, {
        signal: options?.signal,
        queryPath: QUERY_PATH,
    });
    const content = (done.content || "").trim() || apiText("noContent");
    onDelta(content);
    return content;
}
