import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { resolveLinkfoxImageParams } from "@/lib/canvas/image-setting-schema";
import { linkfoxImageModel } from "@/lib/linkfox-image";
import { LINKFOX_MODELS } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { linkfoxTaskId, linkfoxTaskStatus, requestLinkfoxAi, resolveLinkfoxAiReferenceUrl } from "./linkfox-ai-client";
import {
    assertLinkfoxConfig,
    LINKFOX_MAX_POLL_TIME_MS,
    sleep,
    urlToDataUrl,
    withSystemPrompt,
    type LinkfoxRequestConfig,
} from "./linkfox-client";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

type GeneratedImage = { id: string; dataUrl: string };

async function resultsToImages(urls: string[], signal?: AbortSignal): Promise<GeneratedImage[]> {
    const images = await Promise.all(urls.map(async (url) => ({ id: nanoid(), dataUrl: await urlToDataUrl(url, signal) })));
    if (!images.length) throw new Error(apiText("noImageReturned"));
    return images;
}

export async function requestLinkfoxImages(
    config: LinkfoxRequestConfig,
    prompt: string,
    references: ReferenceImage[],
    options?: { signal?: AbortSignal },
): Promise<GeneratedImage[]> {
    assertLinkfoxConfig(config);

    const provider = (config.model || "BANANA_PRO").trim().toUpperCase() || "BANANA_PRO";
    const referenceLimit = linkfoxImageModel(provider)?.references ?? 10;
    if (references.length > referenceLimit) throw new Error(apiText("linkfoxTooManyReferences", { count: referenceLimit }));
    const imageUrls = references.length ? await Promise.all(references.map((image) => resolveLinkfoxAiReferenceUrl(config, image, options?.signal))) : [];
    if (references.length && !imageUrls.length) throw new Error(apiText("linkfoxReferenceRequired"));

    const { aspectRatio, ...params } = resolveLinkfoxImageParams({ ...config, model: provider });
    const created = await requestLinkfoxAi<unknown>(config, "/image/v3/make/imageGen", {
        ...(imageUrls.length ? { imageUrls } : {}),
        prompt: withSystemPrompt(config.systemPrompt || "", prompt),
        provider,
        outputNum: Math.max(1, Math.min(10, Math.floor(Math.abs(Number(config.count)) || 1))),
        ...params,
        ...(aspectRatio && aspectRatio !== "auto" ? { aspectRatio } : {}),
    }, options?.signal);
    const taskId = linkfoxTaskId(created);
    if (!taskId) throw new Error(apiText("linkfoxNoTaskId"));
    const started = Date.now();
    while (Date.now() - started < LINKFOX_MAX_POLL_TIME_MS) {
        await sleep(10_000, options?.signal);
        const task = await requestLinkfoxAi<{ status?: unknown; errorMsg?: string; failReason?: string; resultList?: { status: number; url?: string }[] }>(config, "/image/v2/make/info", { id: taskId }, options?.signal);
        const status = linkfoxTaskStatus(task.status);
        if (status === 4) throw new Error(task.errorMsg || task.failReason || apiText("linkfoxGenerationFailed"));
        if (status === 3) {
            const urls = (task.resultList || []).map((item) => item.url).filter((url): url is string => Boolean(url));
            return resultsToImages(urls, options?.signal);
        }
        if (status !== 1 && status !== 2) throw new Error(apiText("linkfoxGenerationFailed"));
    }
    throw new Error(apiText("linkfoxPollTimeout"));
}

export function linkfoxModelList() {
    return LINKFOX_MODELS.map((model) => model.name);
}

export type { LinkfoxRequestConfig };
