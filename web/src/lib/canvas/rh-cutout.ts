import { runRunninghubAiApp, uploadRunninghubAiAppFile } from "@/services/api/runninghub-ai-app";
import { urlToDataUrl } from "@/services/api/runninghub-client";
import { RUNNINGHUB_CN_BASE_URL, RUNNINGHUB_CN_CHANNEL_ID, useConfigStore } from "@/stores/use-config-store";

export const RH_CUTOUT_WEBAPP_ID = "2091061838162251777";
export const RH_CUTOUT_IMAGE_NODE_ID = "3";
export const RH_CUTOUT_IMAGE_FIELD = "image";

export type RunRhCutoutPipelineParams = {
    sourceDataUrl: string;
    signal?: AbortSignal;
    needApiKeyMessage?: string;
    noOutputMessage?: string;
};

/** RunningHub 中国站抠图工作流；默认 plus 实例。 */
export async function runRhCutoutPipeline(params: RunRhCutoutPipelineParams) {
    const channel = useConfigStore.getState().config.channels.find((item) => item.id === RUNNINGHUB_CN_CHANNEL_ID);
    const apiKey = (channel?.apiKey || "").trim();
    if (!apiKey) throw new Error(params.needApiKeyMessage || "RunningHub China API Key required");
    const config = { baseUrl: channel?.baseUrl || RUNNINGHUB_CN_BASE_URL, apiKey };

    const blob = await (await fetch(params.sourceDataUrl)).blob();
    const fileName = await uploadRunninghubAiAppFile(config, blob, "input.png", params.signal);
    const result = await runRunninghubAiApp(
        config,
        RH_CUTOUT_WEBAPP_ID,
        {
            nodeInfoList: [{ nodeId: RH_CUTOUT_IMAGE_NODE_ID, fieldName: RH_CUTOUT_IMAGE_FIELD, fieldValue: fileName }],
            instanceType: "plus",
        },
        params.signal,
    );
    const outputUrl = result.outputs.find((item) => /^https?:\/\//i.test(item) || item.startsWith("data:"));
    if (!outputUrl) throw new Error(params.noOutputMessage || "RunningHub returned no image");
    const dataUrl = await urlToDataUrl(outputUrl);
    return { dataUrl, taskId: result.taskId };
}
