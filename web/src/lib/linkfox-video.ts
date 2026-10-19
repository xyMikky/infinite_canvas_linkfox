/** 来源：LinkFox AI 视频 V3 文档及 /image/video/model/config/list?bizType=94。 */
export type LinkfoxVideoModel = {
    name: string;
    label: string;
    seconds: number[];
    resolutions: string[];
    ratios: string[];
    images: number;
    videos?: boolean;
    audios?: number;
    audioOnly?: boolean;
    voice?: boolean;
    lastFrame?: boolean;
    firstLastOnly?: boolean;
    /** 可不传参考素材，直接文生视频。 */
    text?: boolean;
    /** 按图片用途传 imageInputMode。 */
    imageMode?: boolean;
};

const ratios = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"];
const seedSeconds = Array.from({ length: 12 }, (_, index) => index + 4);
const seed = { seconds: seedSeconds, ratios, images: 9, videos: true, audios: 3, voice: true, lastFrame: true };

export const LINKFOX_V3_VIDEO_MODELS: LinkfoxVideoModel[] = [
    { name: "doubao-seedance-2-0-fast", label: "Seedance 2.0 Fast · V3", ...seed, resolutions: ["720P", "480P"], text: true },
    { name: "doubao-seedance-2-0-mini", label: "Seedance 2.0 Mini · V3", ...seed, resolutions: ["720P", "480P"], text: true },
    { name: "doubao-seedance-2-0", label: "Seedance 2.0 · V3", ...seed, resolutions: ["720P", "480P", "1080P"], text: true },
    { name: "doubao-seedance-2-5", label: "Seedance 2.5 · V3", ...seed, seconds: Array.from({ length: 27 }, (_, index) => index + 4), resolutions: ["720P", "480P", "1080P"], ratios: [...ratios, "adaptive"], images: 30, audios: 10, audioOnly: true, text: true },
    { name: "kling-v3-omni", label: "可灵 V3 Omni · V3", seconds: [5, 10, 15], resolutions: ["720P", "1080P"], ratios: ["1:1", "9:16", "16:9"], images: 7, lastFrame: true },
    { name: "kling-v2-6", label: "可灵 2.6 · V3", seconds: [5, 10], resolutions: ["720P", "1080P"], ratios: [], images: 2, lastFrame: true, firstLastOnly: true, voice: true },
    { name: "minimax-h3-lite", label: "MiniMax H3 Lite · V3", seconds: Array.from({ length: 12 }, (_, index) => index + 4), resolutions: ["768P"], ratios: ["adaptive", ...ratios], images: 9, text: true },
    { name: "minimax-h3", label: "MiniMax H3 · 2K", seconds: [5, 10, 15], resolutions: ["768P", "2K"], ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"], images: 9, lastFrame: true },
    { name: "wan3", label: "万相 3.0 · V3", seconds: [5, 10, 15, 20, 25, 30], resolutions: ["480P", "720P", "1080P"], ratios: ratios.filter((ratio) => ratio !== "21:9"), images: 10, videos: true, audios: 3, lastFrame: true, text: true },
    { name: "happyhorse-v2", label: "HappyHorse 1.1 · V3", seconds: [5, 10, 15], resolutions: ["720P", "1080P"], ratios: ["9:16", "16:9"], images: 9 },
    // 这两个模型不接收 imageList，使用单张 imageUrl 首帧。
    { name: "wan-2-6", label: "万相 2.6 · V3", seconds: [5, 10, 15], resolutions: [], ratios: [], images: 1, voice: true },
    { name: "hailuo-2-3", label: "海螺 2.3 · V3", seconds: [6, 10], resolutions: ["768P", "1080P"], ratios: [], images: 1 },
    { name: "viduq4-preview", label: "Vidu Q4 Preview", seconds: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], resolutions: ["720P"], ratios: ["16:9", "9:16", "1:1", "4:3", "3:4"], images: 15, audios: 3, voice: true, imageMode: true },
];

export function linkfoxVideoModel(value: string) {
    const name = value.split("::").at(-1)?.toLowerCase();
    return LINKFOX_V3_VIDEO_MODELS.find((model) => model.name === name);
}

export function linkfoxVideoFirstLast(model: LinkfoxVideoModel, mode?: string) {
    return Boolean(model.firstLastOnly || (model.lastFrame && mode === "firstLastFrame"));
}

export function linkfoxVideoParams(model: LinkfoxVideoModel, config: { videoSeconds: string; vquality: string; size: string }) {
    const requested = Math.floor(Number(config.videoSeconds) || (model.name === "wan3" ? 10 : 5));
    const videoTime = model.seconds.reduce((best, value) => Math.abs(value - requested) < Math.abs(best - requested) ? value : best);
    const raw = config.vquality.trim().toUpperCase().replace(/^(\d+)$/, "$1P");
    const resolution = model.resolutions.includes(raw) ? raw : model.resolutions[0];
    const size = config.size === "auto" ? "adaptive" : config.size;
    const dimensions = size.match(/^(\d+)x(\d+)$/i);
    const fixedRatios = model.ratios.filter((ratio) => ratio !== "adaptive");
    let aspectRatio = model.ratios.includes(size) ? size : model.ratios[0];
    if (dimensions && Number(dimensions[2]) > 0 && fixedRatios.length) {
        const ratio = Number(dimensions[1]) / Number(dimensions[2]);
        const distance = (value: string) => { const [w, h] = value.split(":").map(Number); return Math.abs(w / h - ratio); };
        aspectRatio = fixedRatios.reduce((best, value) => distance(value) < distance(best) ? value : best);
    }
    return { videoTime, resolution, aspectRatio };
}
