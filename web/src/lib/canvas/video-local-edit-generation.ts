import { buildNodeGenerationContext, hydrateNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { requestVideoGeneration } from "@/services/api/video";
import { resolveMediaUrl } from "@/services/file-storage";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { createCanvasNode } from "./canvas-node-factory";
import { listCanvasGenerationRequests, type createCanvasGenerationScope } from "./canvas-generation-runtime";
import { resolveVideoLocalEditConfig } from "./video-local-edit-model";
import { composeVideoLocalEdit } from "./video-local-edit-media";
import { applyVideoLocalEditResult } from "./video-local-edit-commit";
import { nanoid } from "nanoid";

export async function generateVideoLocalEdit(scope: ReturnType<typeof createCanvasGenerationScope>, projectId: string, workbench: CanvasNodeData, config: AiConfig, prompt: string) {
    const targetId=workbench.metadata?.videoLocalEditTargetId;
    const target=scope.nodesRef.current.find(node=>node.id===targetId);
    const plan=target?.metadata?.videoLocalEdit;
    if (!target || !targetId || !plan) throw new Error("局部编辑原片或预处理已移除，请重新框选并保存预处理");
    if (listCanvasGenerationRequests().some(request=>request.projectId===projectId && (request.targetNodeId===targetId || request.runningNodeId===workbench.id))) throw new Error("这个视频正在局部编辑，请完成或停止后再生成");
    const requestConfig=resolveVideoLocalEditConfig(config,plan.range.generationSeconds);
    const context=buildNodeGenerationContext(workbench.id,scope.nodesRef.current,scope.connectionsRef.current,prompt);
    if (!context.prompt.trim()) throw new Error("请先在下方填写局部视频的修改提示词");
    if (context.referenceVideos.length!==1 || context.referenceVideos[0].id!==targetId) throw new Error("局部编辑工作台须只连接指定的原视频；可额外连接图片和文字");
    if (context.referenceAudios.length) throw new Error("局部编辑保留原片音轨，请移除工作台连接的参考音频");
    const controller=scope.startGenerationRequest(targetId,workbench.id,workbench.id);
    const runId=nanoid();
    const width=target.width || 360, height=target.height || width*plan.original.height/plan.original.width;
    const x=workbench.position.x+workbench.width+80;
    let y=workbench.position.y;
    for (const node of [...scope.nodesRef.current].sort((a,b)=>a.position.y-b.position.y)) {
        if (node.position.x<x+width+24 && node.position.x+node.width>x-24 && node.position.y<y+height+24 && node.position.y+node.height>y-24) y=node.position.y+node.height+24;
    }
    const output={...createCanvasNode(CanvasNodeType.Video,{x,y}),width,height,title:"局部编辑结果",metadata:{status:"loading" as const,videoLocalEditRunId:runId,errorDetails:"正在准备局部视频…"}};
    scope.startGenerationRequest(workbench.id,workbench.id,workbench.id,controller);
    scope.startGenerationRequest(output.id,workbench.id,workbench.id,controller);
    scope.setRunningNodeId(workbench.id);
    scope.setNodes(nodes=>[...nodes.map(node=>node.id===workbench.id?{...node,metadata:{...node.metadata,videoLocalEditRunId:runId,status:"loading" as const,errorDetails:undefined}}:node),output]);
    scope.setConnections(edges=>[...edges,{id:nanoid(),fromNodeId:workbench.id,toNodeId:output.id}]);
    const owns=(node:CanvasNodeData)=>(node.id===workbench.id || node.id===output.id) && node.metadata?.videoLocalEditRunId===runId;
    const progress=(text:string)=>scope.setNodes(nodes=>nodes.map(node=>owns(node) && !controller.signal.aborted?{...node,metadata:{...node.metadata,status:"loading",errorDetails:text}}:node));
    try {
        progress("正在读取 24fps 局部视频…");
        // 只 hydrate 图片：不能把原片又按播放器入出点裁切后送给模型。
        const hydrated=await hydrateNodeGenerationContext({...context,referenceVideos:[],referenceAudios:[]});
        controller.signal.throwIfAborted();
        const url=await resolveMediaUrl(plan.inputStorageKey,plan.inputUrl || "");
        if (!url) throw new Error("预处理视频已不可读取，请重新保存预处理");
        const video={...context.referenceVideos[0],url};
        const instruction=`这是按手动关键帧移动裁切得到的局部视频。请按以下要求编辑，保持参考视频逐时刻的构图、相机运动与时序，不添加镜头切换，不改变时长。输出 24fps，画面比例与输入相同；声音将由原片保留。\n\n${hydrated.prompt}`;
        progress("正在生成局部视频，原片保留中…");
        const result=await requestVideoGeneration(requestConfig,instruction,hydrated.referenceImages,[video],[],{signal:controller.signal});
        controller.signal.throwIfAborted();
        const composed=await composeVideoLocalEdit(plan,result,controller.signal,progress);
        controller.signal.throwIfAborted();
        scope.setNodes(nodes=>controller.signal.aborted?nodes:applyVideoLocalEditResult(nodes,workbench.id,targetId,plan,composed,runId,output.id));
    } catch(error) {
        const canceled=controller.signal.aborted;
        const details=canceled?"已停止局部编辑，原片未更改":error instanceof Error?error.message:"视频局部编辑失败，原片未更改";
        scope.setNodes(nodes=>nodes.map(node=>owns(node)?{...node,metadata:{...node.metadata,status:canceled && node.id===workbench.id?"idle":"error",errorDetails:details}}:node));
        if (!canceled) throw new Error(details);
    } finally {
        scope.finishGenerationRequest(targetId,controller);
        scope.finishGenerationRequest(workbench.id,controller);
        scope.finishGenerationRequest(output.id,controller);
        if (!listCanvasGenerationRequests().some(request=>request.projectId===projectId && request.runningNodeId===workbench.id)) scope.setRunningNodeId(current=>current===workbench.id?null:current);
    }
}
