import type { CanvasGenerationMode } from "@/types/canvas";
import type { CanvasGenerationRequest } from "./canvas-generation-runtime";
import type { ModelInputSpec } from "./model-input-spec";

type InputCounts = { textCount: number; imageCount: number; videoCount: number; audioCount: number };
type InputIssue = { kind: "prompt" | "input" | "image" | "video" | "audio"; missing?: number };

/** 根据当前模型声明的输入显示就绪状态；媒体计数不替代文本/音频模型的提示词。 */
export function workbenchInputIssue(mode: CanvasGenerationMode, spec: ModelInputSpec, inputs: InputCounts, hasComposerContent: boolean): InputIssue | null {
    const media = [
        { kind: "image", spec: spec.images, count: inputs.imageCount },
        { kind: "video", spec: spec.videos, count: inputs.videoCount },
        { kind: "audio", spec: spec.audios, count: inputs.audioCount },
    ] as const;
    for (const item of media) {
        if (item.spec && item.count < item.spec.min) return { kind: item.kind, missing: item.spec.min - item.count };
    }
    const hasPrompt = hasComposerContent || inputs.textCount > 0;
    if (mode === "text" || mode === "audio" || (mode === "model" && !spec.images)) return hasPrompt ? null : { kind: "prompt" };
    if (hasPrompt || media.some(item => item.spec && item.count > 0)) return null;
    return { kind: "input" };
}

/** 一轮可登记多个结果节点，同一 controller 只计一次；不同工作台分别显示和停止。 */
export function countWorkbenchRuns(requests: Pick<CanvasGenerationRequest, "projectId" | "runningNodeId" | "controller">[], projectId: string, nodeId: string) {
    return new Set(requests.filter(request => request.projectId === projectId && request.runningNodeId === nodeId && !request.controller.signal.aborted).map(request => request.controller)).size;
}
