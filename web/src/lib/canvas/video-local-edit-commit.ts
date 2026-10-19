import type { CanvasNodeData } from "@/types/canvas";
import type { UploadedFile } from "@/services/file-storage";
import type { VideoLocalEditPlan } from "./video-local-edit";

export function applyVideoLocalEditRestore(nodes: CanvasNodeData[], snapshot: CanvasNodeData, originalFile: UploadedFile) {
    const plan=snapshot.metadata?.videoLocalEdit;
    const current=nodes.find(node=>node.id===snapshot.id);
    if (!plan || current?.metadata?.videoLocalEdit?.id!==plan.id || current.metadata.storageKey!==snapshot.metadata?.storageKey || current.metadata.content!==snapshot.metadata?.content) return nodes;
    const original=plan.restoreOriginal;
    return nodes.map(node=>node.id===snapshot.id ? {...node,metadata:{...node.metadata,content:originalFile.url,storageKey:plan.originalStorageKey,mimeType:originalFile.mimeType,bytes:originalFile.bytes,naturalWidth:original.width,naturalHeight:original.height,durationMs:Math.round(original.duration*1000),status:"success" as const,errorDetails:undefined,clipStartMs:undefined,clipEndMs:undefined,includeAudio:true,videoLocalEdit:undefined}} : node.metadata?.videoLocalEditTargetId===snapshot.id ? {...node,metadata:{...node.metadata,status:"idle" as const,videoLocalEditRunId:undefined,errorDetails:"原片已恢复，请重新框选并保存预处理"}} : node);
}

/** 在最新节点列表内比较后提交，防止换片、重做预处理、删除工作台后旧结果覆盖。 */
export function applyVideoLocalEditResult(nodes: CanvasNodeData[], workbenchId: string, targetId: string, plan: VideoLocalEditPlan, result: UploadedFile, runId: string, resultNodeId: string) {
    const target=nodes.find(node=>node.id===targetId);
    const workbench=nodes.find(node=>node.id===workbenchId);
    if (runId && workbench?.metadata?.videoLocalEditRunId!==runId) return nodes;
    const valid=target?.metadata?.videoLocalEdit?.id===plan.id && target.metadata.storageKey===plan.currentStorageKey && workbench?.metadata?.videoLocalEditTargetId===targetId && nodes.some(node=>node.id===resultNodeId && node.metadata?.videoLocalEditRunId===runId);
    return nodes.map(node=>{
        if (node.id===workbenchId) return {...node,metadata:{...node.metadata,status:valid?"success" as const:"error" as const,errorDetails:valid?undefined:"原视频或预处理已改变，结果未覆盖。请重新选择局部编辑"}};
        if (node.id!==resultNodeId || node.metadata?.videoLocalEditRunId!==runId) return node;
        if (!valid) return {...node,metadata:{...node.metadata,status:"error" as const,errorDetails:"原视频或预处理已改变，请重新生成"}};
        return {...node,metadata:{...node.metadata,content:result.url,storageKey:result.storageKey,mimeType:result.mimeType,bytes:result.bytes,naturalWidth:plan.original.width,naturalHeight:plan.original.height,durationMs:Math.round(plan.original.duration*1000),status:"success" as const,errorDetails:undefined,includeAudio:plan.original.hasAudio}};
    });
}
