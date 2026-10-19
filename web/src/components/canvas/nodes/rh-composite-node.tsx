import { useRef, useState } from "react";
import { Button, Collapse, InputNumber, Switch } from "antd";
import { Layers, Loader2, Play, SlidersHorizontal, Square } from "lucide-react";
import { nanoid } from "nanoid";
import { useTranslation } from "react-i18next";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { imageMetadata } from "@/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import {
    applyLoraStrengthPromptChange,
    ensureActiveLoraTriggers,
    insertedTriggersToParams,
    readInsertedTriggers,
    readRhLoraStrengths,
    readRhScaleParams,
    RH_COMPOSITE_NODE_TYPE,
    RH_DEFAULT_PROMPT,
    RH_DEFAULT_SCALE_MAX_SIDE,
    RH_DEFAULT_SCALE_RATIO,
    RH_LORA_DEFAULTS,
    RH_LORA_KEYS,
    RH_MULTI_LORA_WEBAPP_ID,
    type RhInsertedTriggers,
    type RhLoraKey,
    type RhLoraStrengths,
    type RhScaleParams,
} from "@/lib/canvas/rh-composite";
import { runRhCompositePipeline } from "@/lib/canvas/rh-composite-run";
import { imageToDataUrl, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeMetadata } from "@/types/canvas";
import type { CanvasNodeContext, CanvasNodeDefinition } from "@/types/canvas-plugin";

/** 面板卸载后仍保留「高级选项」展开状态 */
const advancedOpenByNodeId = new Map<string, string[]>();

const LORA_LABEL_KEYS: Record<RhLoraKey, string> = {
    lora_upscale: "loraUpscale",
    lora_texture_detail: "loraTextureDetail",
    lora_lighting_stain_removal: "loraLightingStain",
    lora_texture_removal: "loraTextureRemoval",
    lora_light_removal: "loraLightRemoval",
    lora_lighting: "loraLighting",
    lora_image_retouch: "loraImageRetouch",
};

function metaString(metadata: CanvasNodeMetadata | undefined, key: keyof CanvasNodeMetadata, fallback = "") {
    const value = metadata?.[key];
    return typeof value === "string" ? value : fallback;
}

function RhCompositeContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { t } = useTranslation();
    const error = metaString(ctx.node.metadata, "errorDetails");
    // 运行态只看占位节点：本节点始终保持 idle，避免节点本体一直显示「生成中」
    const running = Boolean(metaString(ctx.node.metadata, "rhPlaceholderId"));

    return (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: ctx.theme.node.text }}>
            <Layers className="size-8 opacity-70" style={{ color: running ? "#34d399" : ctx.theme.node.muted }} />
            <div className="text-sm font-medium">{t("canvas.rhComposite.title")}</div>
            <div className="text-xs opacity-70" style={{ color: ctx.theme.node.muted }}>
                {running ? t("canvas.rhComposite.generating") : t("canvas.rhComposite.modeWorkflow")}
            </div>
            {error ? <div className="line-clamp-3 text-[11px] text-red-400">{error}</div> : null}
            {!running && !error ? (
                <div className="text-[11px] opacity-60" style={{ color: ctx.theme.node.muted }}>
                    {t("canvas.rhComposite.empty")}
                </div>
            ) : null}
        </div>
    );
}

function RhCompositePanel({ ctx }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const { t } = useTranslation();
    const abortRef = useRef<AbortController | null>(null);
    const [strengths, setStrengths] = useState<RhLoraStrengths>(() => readRhLoraStrengths(ctx.node.metadata?.modelParams));
    const draftStrengthsRef = useRef<RhLoraStrengths>(readRhLoraStrengths(ctx.node.metadata?.modelParams));
    const committedStrengthsRef = useRef<RhLoraStrengths>(readRhLoraStrengths(ctx.node.metadata?.modelParams));
    const [prompt, setPrompt] = useState(() => {
        const initialStrengths = readRhLoraStrengths(ctx.node.metadata?.modelParams);
        const initialInserted = readInsertedTriggers(ctx.node.metadata?.modelParams);
        const rawPrompt = metaString(ctx.node.metadata, "prompt") || RH_DEFAULT_PROMPT;
        return ensureActiveLoraTriggers(rawPrompt, initialStrengths, initialInserted).prompt;
    });
    const [inserted, setInserted] = useState<RhInsertedTriggers>(() => {
        const initialStrengths = readRhLoraStrengths(ctx.node.metadata?.modelParams);
        const initialInserted = readInsertedTriggers(ctx.node.metadata?.modelParams);
        const rawPrompt = metaString(ctx.node.metadata, "prompt") || RH_DEFAULT_PROMPT;
        return ensureActiveLoraTriggers(rawPrompt, initialStrengths, initialInserted).inserted;
    });
    const promptRef = useRef(prompt);
    const insertedRef = useRef(inserted);
    promptRef.current = prompt;
    insertedRef.current = inserted;
    const [scale, setScale] = useState<RhScaleParams>(() => readRhScaleParams(ctx.node.metadata?.modelParams));
    const scaleRef = useRef(scale);
    scaleRef.current = scale;
    const [seed, setSeed] = useState(() => Number(ctx.node.metadata?.modelParams?.rhSeed ?? 0) || 0);
    const [instanceType, setInstanceType] = useState(String(ctx.node.metadata?.modelParams?.rhInstanceType || "plus"));
    const [personalQueue, setPersonalQueue] = useState(Boolean(ctx.node.metadata?.modelParams?.rhPersonalQueue));
    const [retainSeconds, setRetainSeconds] = useState(() => Number(ctx.node.metadata?.modelParams?.rhRetainSeconds ?? 0) || 0);
    const [webappId, setWebappId] = useState(String(ctx.node.metadata?.modelParams?.rhWebappId || ""));
    const [advancedKeys, setAdvancedKeys] = useState<string[]>(() => advancedOpenByNodeId.get(ctx.node.id) || []);
    const running = Boolean(metaString(ctx.node.metadata, "rhPlaceholderId"));
    const error = metaString(ctx.node.metadata, "errorDetails");
    const upstreamImage = pickUpstreamImage(ctx);

    const persist = (patch?: {
        prompt?: string;
        strengths?: RhLoraStrengths;
        inserted?: RhInsertedTriggers;
        scale?: RhScaleParams;
        seed?: number;
        instanceType?: string;
        personalQueue?: boolean;
        retainSeconds?: number;
        webappId?: string;
    }) => {
        const nextPrompt = patch?.prompt ?? promptRef.current;
        const nextStrengths = patch?.strengths ?? committedStrengthsRef.current;
        const nextInserted = patch?.inserted ?? insertedRef.current;
        const nextScale = patch?.scale ?? scaleRef.current;
        ctx.updateMetadata({
            rhMode: "workflow",
            prompt: nextPrompt,
            modelParams: {
                ...(ctx.node.metadata?.modelParams || {}),
                ...nextStrengths,
                ...insertedTriggersToParams(nextInserted),
                scaleRatio: nextScale.ratio,
                scaleResample: "lanczos",
                scaleAlign: nextScale.alignMultiple,
                scaleMaxSide: nextScale.maxSide,
                rhSeed: patch?.seed ?? seed,
                rhInstanceType: patch?.instanceType ?? instanceType,
                rhPersonalQueue: patch?.personalQueue ?? personalQueue,
                rhRetainSeconds: patch?.retainSeconds ?? retainSeconds,
                rhWebappId: patch?.webappId ?? webappId,
            },
        });
    };

    /** 拖动中只更新界面，松手才写触发词与元数据 */
    const setDraftStrength = (key: RhLoraKey, value: number) => {
        const next = { ...draftStrengthsRef.current, [key]: value };
        draftStrengthsRef.current = next;
        setStrengths(next);
    };

    const commitStrength = (key: RhLoraKey, value: number) => {
        const prevStrength = committedStrengthsRef.current[key] ?? 0;
        const nextStrengths = { ...committedStrengthsRef.current, [key]: value };
        const result = applyLoraStrengthPromptChange({
            prompt: promptRef.current,
            key,
            prevStrength,
            nextStrength: value,
            inserted: insertedRef.current,
        });
        committedStrengthsRef.current = nextStrengths;
        draftStrengthsRef.current = nextStrengths;
        promptRef.current = result.prompt;
        insertedRef.current = result.inserted;
        setStrengths(nextStrengths);
        setPrompt(result.prompt);
        setInserted(result.inserted);
        persist({ strengths: nextStrengths, prompt: result.prompt, inserted: result.inserted });
    };

    const updateScale = (patch: Partial<RhScaleParams>, commit: boolean) => {
        const next = { ...scaleRef.current, ...patch };
        scaleRef.current = next;
        setScale(next);
        if (commit) persist({ scale: next });
    };

    const onCancel = () => {
        abortRef.current?.abort();
        abortRef.current = null;
        const placeholderId = metaString(ctx.node.metadata, "rhPlaceholderId");
        if (placeholderId) {
            ctx.applyOps([{ type: "update_node", id: placeholderId, metadata: { status: "error", errorDetails: t("canvas.rhComposite.canceled") } }]);
        }
        ctx.updateMetadata({ status: "idle", errorDetails: t("canvas.rhComposite.canceled"), rhPlaceholderId: "" });
    };

    const onGenerate = async () => {
        if (running) return;
        persist();
        if (!upstreamImage) {
            ctx.updateMetadata({ status: "error", errorDetails: t("canvas.rhComposite.needImage") });
            return;
        }

        const controller = new AbortController();
        abortRef.current = controller;
        const placeholderId = `image-${nanoid()}`;
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
        const reference = upstreamImage.content || upstreamImage.storageKey;
        ctx.applyOps([
            {
                type: "add_node",
                id: placeholderId,
                nodeType: "image",
                title: t("canvas.rhComposite.resultTitle"),
                position: {
                    x: ctx.node.position.x + ctx.node.width + 96,
                    y: ctx.node.position.y + ctx.node.height / 2 - spec.height / 2,
                },
                width: spec.width,
                height: spec.height,
                metadata: {
                    content: "",
                    prompt,
                    status: "loading",
                    references: [reference].filter(Boolean),
                },
            },
            { type: "connect_nodes", id: `conn-${nanoid()}`, fromNodeId: ctx.node.id, toNodeId: placeholderId },
        ]);
        // 运行中只标右侧占位节点；本节点保持 idle，避免节点本体显示「生成中」
        ctx.updateMetadata({ status: "idle", errorDetails: "", rhPlaceholderId: placeholderId });

        try {
            const sourceUrl = await resolveImageUrl(upstreamImage.storageKey, upstreamImage.content);
            const sourceDataUrl = await imageToDataUrl({
                url: sourceUrl || upstreamImage.content,
                storageKey: upstreamImage.storageKey,
                dataUrl: upstreamImage.content.startsWith("data:") ? upstreamImage.content : undefined,
            });
            if (!sourceDataUrl) throw new Error(t("canvas.rhComposite.needImage"));

            const { dataUrl: resultDataUrl } = await runRhCompositePipeline({
                sourceDataUrl,
                prompt,
                strengths,
                scale,
                seed,
                instanceType,
                personalQueue,
                retainSeconds,
                webappId,
                signal: controller.signal,
                needApiKeyMessage: t("canvas.rhComposite.needApiKey"),
                noOutputMessage: t("canvas.rhComposite.noOutput"),
            });

            const uploaded = await uploadImage(resultDataUrl);
            const size = fitNodeSize(uploaded.width, uploaded.height);
            ctx.applyOps([
                {
                    type: "update_node",
                    id: placeholderId,
                    patch: { ...size, title: t("canvas.rhComposite.resultTitle") },
                    metadata: {
                        ...imageMetadata(uploaded),
                        prompt,
                        status: "success",
                        errorDetails: "",
                        references: [reference].filter(Boolean),
                    },
                },
            ]);
            ctx.updateMetadata({ status: "idle", errorDetails: "", rhPlaceholderId: "" });
        } catch (err) {
            if (controller.signal.aborted) return;
            const message = err instanceof Error ? err.message : String(err);
            ctx.applyOps([{ type: "update_node", id: placeholderId, metadata: { status: "error", errorDetails: message } }]);
            ctx.updateMetadata({ status: "error", errorDetails: message, rhPlaceholderId: "" });
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
        }
    };

    const fieldStyle = {
        background: ctx.theme.node.fill,
        color: ctx.theme.node.text,
        borderColor: ctx.theme.node.stroke,
    } as const;

    return (
        <div
            data-canvas-no-zoom
            className="w-[560px] rounded-[18px] border p-4 shadow-2xl backdrop-blur"
            style={{ background: ctx.theme.node.panel, borderColor: ctx.theme.node.stroke, color: ctx.theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                    <SlidersHorizontal className="size-4 text-emerald-400" />
                    {t("canvas.rhComposite.panelTitle")}
                </div>
                <Button
                    type="primary"
                    className="!h-9 !cursor-pointer !rounded-lg"
                    danger={running}
                    disabled={!running && !upstreamImage}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={() => (running ? onCancel() : void onGenerate())}
                >
                    <span className="inline-flex items-center gap-1.5">
                        {running ? (
                            <>
                                <Loader2 className="size-4 animate-spin" />
                                <Square className="size-3.5 fill-current" />
                                <span>{t("canvas.rhComposite.cancel")}</span>
                            </>
                        ) : (
                            <>
                                <Play className="size-4" />
                                <span>{t("canvas.rhComposite.generate")}</span>
                            </>
                        )}
                    </span>
                </Button>
            </div>

            <label className="mb-3 grid gap-1 text-xs" style={{ color: ctx.theme.node.muted }}>
                {t("canvas.rhComposite.prompt")}
                <textarea
                    value={prompt}
                    onChange={(event) => {
                        promptRef.current = event.target.value;
                        setPrompt(event.target.value);
                    }}
                    onBlur={() => persist({ prompt: promptRef.current })}
                    rows={10}
                    className="min-h-[220px] rounded-lg border px-2 py-1.5 text-sm leading-5"
                    style={fieldStyle}
                    placeholder={t("canvas.rhComposite.promptPlaceholder")}
                />
            </label>
            <div className="mb-1 flex items-center justify-between text-xs font-medium" style={{ color: ctx.theme.node.muted }}>
                <span>{t("canvas.rhComposite.loraTitle")}</span>
                <span className="text-[11px] opacity-70">{t("canvas.rhComposite.loraHint")}</span>
            </div>
            <div className="mb-3 space-y-2">
                {RH_LORA_KEYS.map((key) => (
                    <div key={key} className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="mb-0.5 flex items-center gap-2 text-[11px]" style={{ color: ctx.theme.node.muted }}>
                                <span>{t(`canvas.rhComposite.${LORA_LABEL_KEYS[key]}`)}</span>
                                {inserted[key] ? <span className="text-[10px] text-emerald-400">{t("canvas.rhComposite.triggerOn")}</span> : null}
                            </div>
                            <input
                                type="range"
                                className="w-full cursor-pointer accent-neutral-700 dark:accent-neutral-200"
                                min={0}
                                max={1}
                                step={0.01}
                                value={strengths[key]}
                                onChange={(event) => setDraftStrength(key, Number(event.target.value))}
                                onPointerUp={() => commitStrength(key, draftStrengthsRef.current[key])}
                                onKeyUp={() => commitStrength(key, draftStrengthsRef.current[key])}
                                onPointerDown={(event) => event.stopPropagation()}
                            />
                        </div>
                        <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.01}
                            value={Number(strengths[key].toFixed(2))}
                            onChange={(event) => {
                                const raw = Number(event.target.value);
                                if (!Number.isFinite(raw)) return;
                                commitStrength(key, Math.min(1, Math.max(0, raw)));
                            }}
                            className="h-8 w-14 shrink-0 appearance-none rounded-md border px-1 text-center text-xs tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            style={fieldStyle}
                        />
                    </div>
                ))}
            </div>

            <Collapse
                ghost
                size="small"
                className="mb-3"
                activeKey={advancedKeys}
                onChange={(keys) => {
                    const next = (Array.isArray(keys) ? keys : [keys]).map(String);
                    advancedOpenByNodeId.set(ctx.node.id, next);
                    setAdvancedKeys(next);
                }}
                items={[
                    {
                        key: "advanced",
                        label: (
                            <span className="text-xs" style={{ color: ctx.theme.node.muted }}>
                                {t("canvas.rhComposite.advanced")}
                            </span>
                        ),
                        children: (
                            <div className="grid gap-3 pb-1">
                                <div className="text-[11px] font-medium opacity-80" style={{ color: ctx.theme.node.muted }}>
                                    {t("canvas.rhComposite.modeScale")}
                                </div>
                                <label className="grid gap-1 text-xs" style={{ color: ctx.theme.node.muted }}>
                                    {t("canvas.rhComposite.scaleRatio")}
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="range"
                                            className="min-w-0 flex-1 cursor-pointer accent-neutral-700 dark:accent-neutral-200"
                                            min={1}
                                            max={2}
                                            step={0.01}
                                            value={scale.ratio}
                                            onChange={(event) => updateScale({ ratio: Number(event.target.value) }, false)}
                                            onPointerUp={() => persist({ scale: scaleRef.current })}
                                            onKeyUp={() => persist({ scale: scaleRef.current })}
                                            onPointerDown={(event) => event.stopPropagation()}
                                        />
                                        <input
                                            type="number"
                                            min={1}
                                            max={2}
                                            step={0.01}
                                            value={Number(scale.ratio.toFixed(2))}
                                            onChange={(event) => {
                                                const raw = Number(event.target.value);
                                                updateScale({ ratio: Number.isFinite(raw) ? Math.min(2, Math.max(1, raw)) : 1 }, true);
                                            }}
                                            className="h-8 w-14 shrink-0 appearance-none rounded-md border px-1 text-center text-xs tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                            style={fieldStyle}
                                        />
                                    </div>
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                    <label className="grid gap-1 text-xs" style={{ color: ctx.theme.node.muted }}>
                                        {t("canvas.rhComposite.scaleAlign")}
                                        <InputNumber min={1} max={64} value={scale.alignMultiple} onChange={(value) => updateScale({ alignMultiple: Number(value) || 1 }, true)} className="w-full" />
                                    </label>
                                    <label className="grid gap-1 text-xs" style={{ color: ctx.theme.node.muted }}>
                                        {t("canvas.rhComposite.scaleMaxSide")}
                                        <InputNumber min={0} max={8192} value={scale.maxSide} onChange={(value) => updateScale({ maxSide: Number(value) || 0 }, true)} className="w-full" />
                                    </label>
                                </div>
                                <label className="grid gap-1 text-xs" style={{ color: ctx.theme.node.muted }}>
                                    {t("canvas.rhComposite.seed")}
                                    <InputNumber
                                        min={0}
                                        value={seed}
                                        onChange={(value) => {
                                            const next = Number(value) || 0;
                                            setSeed(next);
                                            persist({ seed: next });
                                        }}
                                        className="w-full"
                                    />
                                </label>
                                <label className="grid gap-1 text-xs" style={{ color: ctx.theme.node.muted }}>
                                    {t("canvas.rhComposite.instanceType")}
                                    <select
                                        value={instanceType}
                                        onChange={(event) => {
                                            setInstanceType(event.target.value);
                                            persist({ instanceType: event.target.value });
                                        }}
                                        className="h-9 rounded-lg border px-2 text-sm"
                                        style={fieldStyle}
                                    >
                                        <option value="default">{t("canvas.rhComposite.instanceDefault")}</option>
                                        <option value="plus">{t("canvas.rhComposite.instancePlus")}</option>
                                    </select>
                                </label>
                                <div className="flex items-center justify-between text-xs" style={{ color: ctx.theme.node.muted }}>
                                    <span>{t("canvas.rhComposite.personalQueue")}</span>
                                    <Switch
                                        size="small"
                                        checked={personalQueue}
                                        onChange={(checked) => {
                                            setPersonalQueue(checked);
                                            persist({ personalQueue: checked });
                                        }}
                                    />
                                </div>
                                <label className="grid gap-1 text-xs" style={{ color: ctx.theme.node.muted }}>
                                    {t("canvas.rhComposite.retainSeconds")}
                                    <InputNumber
                                        min={0}
                                        max={180}
                                        value={retainSeconds}
                                        onChange={(value) => {
                                            const next = Number(value) || 0;
                                            setRetainSeconds(next);
                                            persist({ retainSeconds: next });
                                        }}
                                        className="w-full"
                                    />
                                </label>
                                <label className="grid gap-1 text-xs" style={{ color: ctx.theme.node.muted }}>
                                    {t("canvas.rhComposite.webappId")}
                                    <input
                                        value={webappId}
                                        onChange={(event) => setWebappId(event.target.value)}
                                        onBlur={() => persist({ webappId })}
                                        placeholder={RH_MULTI_LORA_WEBAPP_ID}
                                        className="h-9 rounded-lg border px-2 text-sm"
                                        style={fieldStyle}
                                    />
                                </label>
                            </div>
                        ),
                    },
                ]}
            />

            {upstreamImage ? (
                <div className="truncate text-[11px]" style={{ color: ctx.theme.node.muted }}>
                    {t("canvas.rhComposite.upstreamReady", { title: upstreamImage.title })}
                </div>
            ) : (
                <div className="text-[11px] text-amber-500">{t("canvas.rhComposite.needImage")}</div>
            )}
            {error ? <div className="mt-1 truncate text-xs text-red-400">{error}</div> : null}
        </div>
    );
}

function pickUpstreamImage(ctx: CanvasNodeContext) {
    for (const node of ctx.getUpstream()) {
        if (node.type !== CanvasNodeType.Image) continue;
        const content = node.metadata?.content || "";
        const storageKey = node.metadata?.storageKey || "";
        if (!content && !storageKey) continue;
        return { title: node.title || node.id.slice(0, 8), content, storageKey };
    }
    return null;
}

export function getRhCompositeNodeDefinition(): CanvasNodeDefinition {
    return {
        type: RH_COMPOSITE_NODE_TYPE,
        title: "综合节点",
        description: "RunningHub 综合工作流 V3 + 本地缩放",
        icon: <Layers className="size-5" />,
        defaultSize: { width: 320, height: 240 },
        defaultMetadata: {
            content: "",
            prompt: RH_DEFAULT_PROMPT,
            status: "idle",
            rhMode: "workflow",
            modelParams: {
                ...RH_LORA_DEFAULTS,
                scaleRatio: RH_DEFAULT_SCALE_RATIO,
                scaleResample: "lanczos",
                scaleAlign: 1,
                scaleMaxSide: RH_DEFAULT_SCALE_MAX_SIDE,
                rhSeed: 0,
                rhInstanceType: "plus",
                rhPersonalQueue: false,
                rhRetainSeconds: 0,
                rhWebappId: "",
            },
        },
        autoOpenPanel: true,
        resource: () => null,
        Content: RhCompositeContent,
        Panel: RhCompositePanel,
    };
}
