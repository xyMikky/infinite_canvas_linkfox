import i18n from "@/i18n";

/** 长词优先：只翻译能力/渠道等描述段，保留 midjourney、gpt-image-2 等基础名。 */
const ZH_PHRASES: [string, string][] = [
    ["stable-token", "稳定版·按 Token 计费"],
    ["economy", "经济版"],
    ["text-to-image-ultra-official-stable", "文生图·超清官方稳定版"],
    ["edit-ultra-official-stable", "图生图·超清官方稳定版"],
    ["text-to-image-channel-low-price", "文生图·渠道低价"],
    ["image-to-image-channel-low-price", "图生图·渠道低价"],
    ["image-to-video-asyn-channel-low-price", "图生视频·异步渠道低价"],
    ["image-to-video-pro-channel-low-price", "图生视频 Pro·渠道低价"],
    ["image-to-video-channel-low-price", "图生视频·渠道低价"],
    ["text-to-video-pro-channel-low-price", "文生视频 Pro·渠道低价"],
    ["text-to-video-channel-low-price", "文生视频·渠道低价"],
    ["start-end-to-video-channel-low-price", "首尾帧生视频·渠道低价"],
    ["image-to-video-pro-official-stable", "图生视频 Pro·官方稳定版"],
    ["image-to-video-realistic-official-stable", "图生视频·写实官方稳定版"],
    ["text-to-video-pro-official-stable", "文生视频 Pro·官方稳定版"],
    ["text-to-image-official-stable", "文生图·官方稳定版"],
    ["image-to-image-official-stable", "图生图·官方稳定版"],
    ["image-to-video-official-stable", "图生视频·官方稳定版"],
    ["text-to-video-official-stable", "文生视频·官方稳定版"],
    ["reference-to-video-official-stable", "参考生视频·官方稳定版"],
    ["start-end-to-video-official-stable", "首尾帧生视频·官方稳定版"],
    ["video-extend-official-stable", "视频延长·官方稳定版"],
    ["video-to-video-official-stable", "视频生视频·官方稳定版"],
    ["edit-video-official-stable", "视频编辑·官方稳定版"],
    ["edit-channel-low-price", "图生图·渠道低价"],
    ["edit-official-stable", "图生图·官方稳定版"],
    ["video-edit/channel-low-price", "视频编辑/渠道低价"],
    ["channel-low-price", "渠道低价"],
    ["official-stable", "官方稳定版"],
    ["text-to-image", "文生图"],
    ["image-to-image", "图生图"],
    ["image-to-video", "图生视频"],
    ["text-to-video", "文生视频"],
    ["video-to-video", "视频生视频"],
    ["reference-to-video", "参考生视频"],
    ["start-end-to-video", "首尾帧生视频"],
    ["video-extend", "视频延长"],
    ["video-edit", "视频编辑"],
    ["edit-video", "视频编辑"],
    ["image-to-text", "图生文"],
    ["video-to-text", "视频生文"],
    ["text-to-text", "文生文"],
    ["text-to-audio", "文生音频"],
    ["image-edit", "图生图"],
    ["image-upscale", "图像放大"],
    ["voice-clone", "声音克隆"],
    ["voice-design", "声音设计"],
    ["preview", "预览"],
];

export function localizeRunninghubModelLabel(label: string) {
    const raw = (label || "").trim();
    if (!raw) return raw;
    if (!String(i18n.language || "").toLowerCase().startsWith("zh")) return raw;

    let next = raw;
    for (const [from, to] of ZH_PHRASES) {
        if (!next.toLowerCase().includes(from)) continue;
        // 按原文大小写不敏感替换，输出用中文片段
        next = next.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), to);
    }
    return next;
}
