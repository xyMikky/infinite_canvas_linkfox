import { decodeChannelModel, modelOptionName, resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";

export const LOCAL_VIDEO_EDIT_MODEL = "runninghub::bytedance/seedance-2.0-global-fast/multimodal-video";

export function isVideoLocalEditModel(model: string) {
    return modelOptionName(model).trim() === modelOptionName(LOCAL_VIDEO_EDIT_MODEL) || isRunninghubVideoEditModel(model);
}

/** RunningHub O3 编辑接口：一个 videoUrl、最多四个 imageUrls，时长跟随输入。 */
export function isRunninghubVideoEditModel(model: string) {
    return /^kling-video-o3-(std|pro)\/video-edit$/.test(modelOptionName(model).trim());
}

export function resolveVideoLocalEditConfig(config: AiConfig, seconds: number): AiConfig {
    throw new Error("视频局部编辑当前不可用");
    const model = config.model || config.videoModel;
    const decoded = decodeChannelModel(model);
    if (decoded && !config.channels.some((channel) => channel.id === decoded.channelId)) {
        throw new Error("视频编辑渠道已移除，请重新选择模型");
    }
    const request = resolveModelRequestConfig(config, model);
    if (request.apiFormat !== "runninghub" || !isVideoLocalEditModel(model)) {
        throw new Error("视频局部编辑请选择 RunningHub 的 Seedance 2.0 Global Fast 多模态模型或 Kling O3 视频编辑模型");
    }
    if (resolveModelScript(config, model)) throw new Error("局部视频编辑暂不支持自定义请求脚本，请选择未配置脚本的 RunningHub 视频编辑模型");
    if (!Number.isInteger(seconds) || seconds < 3 || seconds > 15) {
        throw new Error("局部视频编辑要求输入为 3–15 秒的整数时长，请调整选段");
    }
    return { ...config, model, ...(!isRunninghubVideoEditModel(model) ? { size: "adaptive" } : {}), videoSeconds: String(seconds), videoGenerateAudio: "false" };
}
