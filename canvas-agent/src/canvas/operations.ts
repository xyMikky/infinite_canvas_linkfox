import crypto from "node:crypto";

import type { ToolName } from "./schemas.js";
import { defaultNodePosition } from "./tools.js";
import type { CanvasNode, CanvasNodeType, CanvasSnapshot } from "./types.js";

export type CanvasToolRequest = { name: "canvas_apply_ops"; input: Record<string, unknown> };

/** 将上层画布工具调用转换为前端可执行的批量操作。 */
export function buildCanvasToolRequest(name: ToolName, input: Record<string, unknown>, state: CanvasSnapshot | null): CanvasToolRequest {
    if (name === "canvas_apply_ops") return { name, input };
    if (name === "canvas_create_node") {
        const data = input as { nodeType: CanvasNodeType; title?: string; x?: number; y?: number; width?: number; height?: number; metadata?: Record<string, unknown> };
        return applyOps([{
            type: "add_node",
            nodeType: data.nodeType,
            title: data.title,
            ...(data.x !== undefined ? { x: data.x } : {}),
            ...(data.y !== undefined ? { y: data.y } : {}),
            width: data.width,
            height: data.height,
            metadata: data.metadata,
        }]);
    }
    if (name === "canvas_create_text_node") {
        const data = input as { text?: string; x?: number; y?: number; title?: string; width?: number; height?: number };
        return applyOps([textNodeOp(data, data.x, data.y)]);
    }
    if (name === "canvas_create_text_nodes") {
        const data = input as { items: Array<{ text: string; title?: string; x?: number; y?: number; width?: number; height?: number }>; x?: number; y?: number; gap?: number; direction?: "row" | "column" };
        const gap = Number(data.gap ?? 40);
        const baseX = data.x;
        const baseY = data.y;
        return applyOps(data.items.map((item, index) => {
            const x = item.x ?? (baseX !== undefined ? (data.direction === "row" ? baseX + index * (340 + gap) : baseX) : undefined);
            const y = item.y ?? (baseY !== undefined ? (data.direction === "row" ? baseY : baseY + index * (240 + gap)) : undefined);
            return textNodeOp(item, x, y);
        }));
    }
    if (name === "canvas_create_image_prompt_flow") return applyOps(generationFlowOps({ ...input, mode: "image" }, state));
    if (name === "canvas_create_config_node") {
        const x = typeof input.x === "number" ? input.x : undefined;
        const y = typeof input.y === "number" ? input.y : undefined;
        const configId = `config-${crypto.randomUUID()}`;
        const mode = generationMode(input.mode);
        const prompt = String(input.prompt || "");
        return applyOps([configNodeOp(configId, input, x, y), ...(input.autoRun ? [runGenerationOp(configId, mode, prompt)] : [])]);
    }
    if (name === "canvas_create_generation_flow") return applyOps(generationFlowOps(input, state));
    if (name === "canvas_generate_text" || name === "canvas_generate_image" || name === "canvas_generate_video" || name === "canvas_generate_audio") {
        return applyOps(generationFlowOps({ ...input, mode: name.replace("canvas_generate_", ""), autoRun: true }, state));
    }
    if (name === "canvas_update_node") {
        const data = input as { id: string; patch?: Record<string, unknown>; metadata?: Record<string, unknown> };
        return applyOps([{ type: "update_node", id: data.id, patch: data.patch, metadata: data.metadata }]);
    }
    if (name === "canvas_update_node_text") {
        const data = input as { id: string; text: string; title?: string };
        return applyOps([{ type: "update_node", id: data.id, patch: { ...(data.title ? { title: data.title } : {}) }, metadata: { content: data.text, status: "success" } }]);
    }
    if (name === "canvas_move_nodes") {
        const data = input as { items: Array<{ id: string; x?: number; y?: number; dx?: number; dy?: number }> };
        return applyOps(data.items.map((item) => {
            const current = findNode(state, item.id);
            return { type: "update_node", id: item.id, patch: { position: { x: item.x ?? ((current?.position.x || 0) + (item.dx || 0)), y: item.y ?? ((current?.position.y || 0) + (item.dy || 0)) } } };
        }));
    }
    if (name === "canvas_resize_node") {
        const data = input as { id: string; width: number; height: number; freeResize?: boolean };
        return applyOps([{ type: "update_node", id: data.id, patch: { width: data.width, height: data.height }, metadata: data.freeResize === undefined ? undefined : { freeResize: data.freeResize } }]);
    }
    if (name === "canvas_delete_nodes") return applyOps([{ type: "delete_node", ids: (input as { ids: string[] }).ids }]);
    if (name === "canvas_connect_nodes") {
        const data = input as { connections: Array<Record<string, unknown>> };
        return applyOps(data.connections.map((connection) => ({ type: "connect_nodes", ...connection })));
    }
    if (name === "canvas_update_connection") {
        const data = input as { id?: string; fromNodeId?: string; toNodeId?: string; label?: string; kind?: "mind" | "annotation"; fromSide?: string; toSide?: string };
        return applyOps([{ type: "update_connection", ...data }]);
    }
    if (name === "canvas_select_nodes") return applyOps([{ type: "select_nodes", ids: (input as { ids: string[] }).ids }]);
    if (name === "canvas_set_viewport") return applyOps([{ type: "set_viewport", viewport: (input as { viewport: unknown }).viewport }]);
    if (name === "canvas_run_generation") {
        const data = input as { nodeId: string; mode?: string; prompt?: string };
        return applyOps([runGenerationOp(data.nodeId, generationMode(data.mode), data.prompt)]);
    }
    throw new Error(`未知工具：${name}`);
}

/** 按最大边限制计算附件图片节点尺寸，并保持原始比例。 */
export function fitAttachmentNodeSize(width: number, height: number) {
    const scale = Math.min(1, 640 / width, 640 / height);
    return { width: width * scale, height: height * scale };
}

/** 创建统一的批量画布操作请求。 */
function applyOps(ops: unknown[]): CanvasToolRequest {
    return { name: "canvas_apply_ops", input: { ops } };
}

/** 创建文本节点操作；未传坐标时由前端按当前视口中心落地。 */
function textNodeOp(input: { id?: string; text?: string; title?: string; width?: number; height?: number }, x?: number, y?: number) {
    return {
        type: "add_node",
        id: input.id,
        nodeType: "text",
        title: input.title,
        ...(x !== undefined ? { x } : {}),
        ...(y !== undefined ? { y } : {}),
        width: input.width,
        height: input.height,
        metadata: { content: input.text || "", status: "success", fontSize: 14 },
    };
}

/** 创建生成配置节点操作。 */
function configNodeOp(id: string, input: Record<string, unknown>, x?: number, y?: number) {
    const mode = generationMode(input.mode);
    const prompt = String(input.prompt || "");
    return {
        type: "add_node",
        id,
        nodeType: "config",
        title: String(input.title || generationTitle(mode)),
        ...(x !== undefined ? { x } : {}),
        ...(y !== undefined ? { y } : {}),
        width: typeof input.width === "number" ? input.width : undefined,
        height: typeof input.height === "number" ? input.height : undefined,
        metadata: cleanRecord({
            generationMode: mode,
            composerContent: prompt,
            prompt,
            status: "idle",
            model: input.model,
            size: input.size,
            quality: input.quality,
            count: input.count,
            seconds: input.seconds,
            vquality: input.vquality,
            generateAudio: input.generateAudio,
            watermark: input.watermark,
            audioVoice: input.audioVoice,
            audioFormat: input.audioFormat,
            audioSpeed: input.audioSpeed,
            audioInstructions: input.audioInstructions,
        }),
    };
}

/** 创建包含提示词、配置节点和引用连线的生成流程。 */
function generationFlowOps(input: Record<string, unknown>, state: CanvasSnapshot | null) {
    const mode = generationMode(input.mode);
    const prompt = String(input.prompt || "");
    const referenceNodeIds = Array.isArray(input.referenceNodeIds) ? input.referenceNodeIds.filter((id): id is string => typeof id === "string") : [];
    // 优先贴着「正在跑的 Codex 智能节点」，避免参考附件建在画布远端时占位跟着跑出视野
    const runningCodex = (state?.nodes || []).find((node) => node.metadata?.codexPhase === "running");
    const anchor = (typeof input.anchorNodeId === "string" ? findNode(state, input.anchorNodeId) : undefined)
        || runningCodex
        || referenceNodeIds.map((id) => findNode(state, id)).find(Boolean)
        || (state?.selectedNodeIds?.[0] ? findNode(state, state.selectedNodeIds[0]) : undefined);
    const useCodexAnchor = Boolean(anchor && (anchor === runningCodex || anchor.metadata?.codexPhase === "running" || String(anchor.type || "").toLowerCase().includes("codex")));
    const textId = `text-${crypto.randomUUID()}`;
    const configId = `config-${crypto.randomUUID()}`;
    // Codex 锚点：占位贴 Codex 右侧；提示词/配置放 Codex 下方，避免挡住占位
    // 普通锚点：提示词 → 配置 → 占位 横向排开
    const textX = Number(input.x ?? (useCodexAnchor && anchor ? anchor.position.x : anchor ? anchor.position.x + (anchor.width || 320) + 80 : defaultNodePosition(state, 340, 240).x));
    const textY = Number(input.y ?? (useCodexAnchor && anchor ? anchor.position.y + (anchor.height || 280) + 48 : anchor ? anchor.position.y : defaultNodePosition(state, 340, 240).y));
    const configX = textX + 420;
    const configY = textY;
    const tokens = [`@[node:${textId}]`, ...referenceNodeIds.map((id) => `@[node:${id}]`)];
    const ops: unknown[] = [
        textNodeOp({ id: textId, text: prompt, title: String(input.title || "提示词") }, textX, textY),
        configNodeOp(configId, { ...input, prompt: tokens.join("\n") }, configX, configY),
        { type: "connect_nodes", fromNodeId: textId, toNodeId: configId },
        ...referenceNodeIds.map((fromNodeId) => ({ type: "connect_nodes", fromNodeId, toNodeId: configId })),
    ];
    // 自动开跑时立刻挂「生成中」占位节点，不等前端 hydrate 才出框
    let resultId: string | undefined;
    if (input.autoRun && (mode === "image" || mode === "video" || mode === "audio")) {
        resultId = `${mode}-${crypto.randomUUID()}`;
        const spec = mode === "video" ? { width: 420, height: 236 } : mode === "audio" ? { width: 340, height: 120 } : { width: 340, height: 240 };
        const configWidth = 340;
        const configHeight = 336;
        const slotId = `slot-${crypto.randomUUID()}`;
        const resultX = useCodexAnchor && anchor ? anchor.position.x + (anchor.width || 360) + 96 : configX + configWidth + 96;
        const resultY = useCodexAnchor && anchor ? anchor.position.y + (anchor.height || 280) / 2 - spec.height / 2 : configY + configHeight / 2 - spec.height / 2;
        ops.push({
            type: "add_node",
            id: resultId,
            nodeType: mode,
            title: prompt.slice(0, 32) || generationTitle(mode),
            position: { x: resultX, y: resultY },
            width: spec.width,
            height: spec.height,
            metadata: cleanRecord({
                prompt,
                status: "loading",
                ...(mode === "image"
                    ? {
                        images: [{ id: slotId, status: "loading", content: "", storageKey: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" }],
                    }
                    : {}),
            }),
        });
        ops.push({ type: "connect_nodes", fromNodeId: configId, toNodeId: resultId });
        // 让占位框从 Codex 智能节点右侧连出去，视觉上等同「生图模式」占位
        if (useCodexAnchor && anchor) ops.push({ type: "connect_nodes", fromNodeId: anchor.id, toNodeId: resultId });
    }
    ops.push({ type: "select_nodes", ids: [resultId || configId] });
    if (input.autoRun) ops.push(runGenerationOp(configId, mode, tokens.join("\n")));
    return ops;
}

/** 创建触发节点生成的画布操作。 */
function runGenerationOp(nodeId: string, mode: "text" | "image" | "video" | "audio", prompt?: string) {
    return { type: "run_generation", nodeId, mode, prompt };
}

/** 将未知生成模式归一为画布支持的模式。 */
function generationMode(value: unknown): "text" | "image" | "video" | "audio" {
    return value === "text" || value === "video" || value === "audio" ? value : "image";
}

/** 获取生成模式对应的默认节点标题。 */
function generationTitle(mode: "text" | "image" | "video" | "audio") {
    if (mode === "text") return "文本生成";
    if (mode === "video") return "视频生成";
    if (mode === "audio") return "音频生成";
    return "图片生成";
}

/** 按节点 ID 查找当前画布节点。 */
function findNode(state: CanvasSnapshot | null, id: string): CanvasNode | undefined {
    return (state?.nodes || []).find((node) => node.id === id);
}

/** 移除对象中未设置的生成参数。 */
function cleanRecord(value: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}
