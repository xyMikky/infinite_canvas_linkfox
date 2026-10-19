import {
    buildV3NodeInfoList,
    ensureActiveLoraTriggers,
    RH_DEFAULT_PROMPT,
    RH_LORA_DEFAULTS,
    RH_MULTI_LORA_WEBAPP_ID,
    readRhScaleParams,
    scaleDataUrlByRatio,
    type RhLoraStrengths,
    type RhScaleParams,
} from "@/lib/canvas/rh-composite";
import { runRunninghubAiApp, uploadRunninghubAiAppFile } from "@/services/api/runninghub-ai-app";
import { urlToDataUrl } from "@/services/api/runninghub-client";
import { RUNNINGHUB_CN_BASE_URL, RUNNINGHUB_CN_CHANNEL_ID, useConfigStore } from "@/stores/use-config-store";

export type RunRhCompositePipelineParams = {
    sourceDataUrl: string;
    prompt?: string;
    strengths?: RhLoraStrengths;
    scale?: RhScaleParams;
    seed?: number;
    instanceType?: string;
    personalQueue?: boolean;
    retainSeconds?: number;
    webappId?: string;
    signal?: AbortSignal;
    /** 缺 Key 时的错误文案 */
    needApiKeyMessage?: string;
    noOutputMessage?: string;
};

/** 先本地缩放，再跑 RH 综合工作流；工具栏放大与综合节点共用。 */
export async function runRhCompositePipeline(params: RunRhCompositePipelineParams) {
    const strengths = params.strengths ?? { ...RH_LORA_DEFAULTS };
    const scale = params.scale ?? readRhScaleParams(null);
    const prompt =
        params.prompt ??
        ensureActiveLoraTriggers(RH_DEFAULT_PROMPT, strengths, {}).prompt;
    const scaled = await scaleDataUrlByRatio(params.sourceDataUrl, { ...scale, resample: "lanczos" });

    const channel = useConfigStore.getState().config.channels.find((item) => item.id === RUNNINGHUB_CN_CHANNEL_ID);
    const apiKey = (channel?.apiKey || "").trim();
    if (!apiKey) throw new Error(params.needApiKeyMessage || "RunningHub China API Key required");
    const config = { baseUrl: channel?.baseUrl || RUNNINGHUB_CN_BASE_URL, apiKey };

    const blob = await (await fetch(scaled.dataUrl)).blob();
    const fileName = await uploadRunninghubAiAppFile(config, blob, "input.png", params.signal);
    const appId = (params.webappId || "").trim() || RH_MULTI_LORA_WEBAPP_ID;
    const nodeInfoList = buildV3NodeInfoList({
        fileName,
        prompt,
        strengths,
        seed: params.seed ?? 0,
        webappId: appId,
    });
    const result = await runRunninghubAiApp(
        config,
        appId,
        {
            nodeInfoList,
            instanceType: params.instanceType === "default" ? "default" : "plus",
            usePersonalQueue: Boolean(params.personalQueue),
            retainSeconds: params.retainSeconds != null && params.retainSeconds >= 10 ? params.retainSeconds : undefined,
        },
        params.signal,
    );
    const outputUrl = result.outputs.find((item) => /^https?:\/\//i.test(item) || item.startsWith("data:"));
    if (!outputUrl) throw new Error(params.noOutputMessage || "RunningHub returned no image");
    const dataUrl = await urlToDataUrl(outputUrl);
    return { dataUrl, prompt, strengths, scale, taskId: result.taskId };
}
