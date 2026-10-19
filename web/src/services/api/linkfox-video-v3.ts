import i18n from "@/i18n";
import { linkfoxVideoFirstLast, linkfoxVideoParams, type LinkfoxVideoModel } from "@/lib/linkfox-video";
import { boolConfig } from "@/lib/seedance-video";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { LINKFOX_VIDEO_MAX_POLL_TIME_MS, sleep, type LinkfoxRequestConfig } from "./linkfox-client";

import { linkfoxTaskId, linkfoxTaskStatus, requestLinkfoxAi, resolveLinkfoxAiReferenceUrl } from "./linkfox-ai-client";

const text = (key: string) => i18n.t(`linkfoxVideo.${key}`);
export async function requestLinkfoxVideoV3(config: LinkfoxRequestConfig, model: LinkfoxVideoModel, prompt: string, images: ReferenceImage[], videos: ReferenceVideo[], audios: ReferenceAudio[], signal?: AbortSignal) {
    const firstLast = linkfoxVideoFirstLast(model, config.videoReferenceMode);
    const textOnly = Boolean(model.text) && !images.length && !videos.length && !audios.length && !firstLast;
    if (!prompt.trim() || prompt.length > 10_000) throw new Error(text("promptInvalid"));
    if (images.length > (firstLast ? 2 : model.images)) throw new Error(text("tooManyImages"));
    if (videos.length && (firstLast || !model.videos)) throw new Error(text("videoUnsupported"));
    if (audios.length && (firstLast || audios.length > (model.audios || 0))) throw new Error(text("audioUnsupported"));
    if (!textOnly && !images.length && (firstLast || (!videos.length && !(model.audioOnly && audios.length)))) throw new Error(text("referenceRequired"));

    const [imageUrls, video, audio] = await Promise.all([
        Promise.all(images.map((ref) => resolveLinkfoxAiReferenceUrl(config, ref, signal))),
        Promise.all(videos.map((ref) => resolveLinkfoxAiReferenceUrl(config, ref, signal))),
        Promise.all(audios.map((ref) => resolveLinkfoxAiReferenceUrl(config, ref, signal))),
    ]);
    const singleImage = firstLast || model.images === 1;
    const created = await requestLinkfoxAi<unknown>(config, "/image/v3/make/aiVideoGen", {
        prompt, videoType: model.name, ...linkfoxVideoParams(model, config), promptOptimizer: false,
        ...(singleImage ? { imageUrl: imageUrls[0], ...(imageUrls[1] ? { lastFrameImageUrl: imageUrls[1] } : {}) } : imageUrls.length ? { imageList: imageUrls } : {}),
        ...(model.imageMode && imageUrls.length ? { imageInputMode: singleImage ? "first-frame" : "reference" } : {}),
        ...(video.length ? { video } : {}), ...(audio.length ? { audio } : {}),
        ...(model.voice ? { voice: boolConfig(config.videoGenerateAudio, true) } : {}),
    }, signal);
    // 官方返回字符串 ID，避免将 int64 转为 JS Number 后丢失精度。
    const taskId = linkfoxTaskId(created);
    if (!taskId) throw new Error(text("invalidTask"));
    const started = Date.now();
    while (Date.now() - started < LINKFOX_VIDEO_MAX_POLL_TIME_MS) {
        await sleep(10_000, signal);
        const task = await requestLinkfoxAi<{ status?: unknown; errorMsg?: string; failReason?: string; resultList?: { status: number; url?: string }[] }>(config, "/image/v2/make/info", { id: taskId }, signal);
        const status = linkfoxTaskStatus(task.status);
        if (status === 4) throw new Error(task.errorMsg || task.failReason || text("generationFailed"));
        if (status === 3) {
            const url = task.resultList?.find((item) => item.status === 1 && item.url)?.url;
            if (!url) throw new Error(text("noResult"));
            return url;
        }
        if (status !== 1 && status !== 2) throw new Error(text("invalidTask"));
    }
    throw new Error(text("timeout"));
}
