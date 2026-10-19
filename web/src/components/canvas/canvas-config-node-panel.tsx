import { useEffect, useRef } from "react";
import { Image as ImageIcon, LoaderCircle, MessageSquare, Music2, Box, ArrowUpRight, Check, ChevronDown, ChevronUp, FileText, Plus, Square, Video } from "lucide-react";
import { theme as antdTheme } from "antd";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { CanvasModelSettingsPopover } from "@/components/canvas-model-settings-popover";
import { LOCAL_EDIT_BANANA_MODEL, LOCAL_EDIT_DEFAULT_RESOLUTION } from "@/lib/canvas/banana-local-edit";
import { resolveModelInputSpec, type MediaSlotSpec } from "@/lib/canvas/model-input-spec";
import { workbenchInputIssue } from "@/lib/canvas/workbench-state";
import { isVideoLocalEditModel } from "@/lib/canvas/video-local-edit-model";
import { defaultConfig, resolveModelForCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasImageCountButton } from "./canvas-image-count-button";
import { runninghubImagesPerTask } from "@/services/api/runninghub-models";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasTextSettingsPopover } from "./canvas-text-settings-popover";
import type { ImageSettingsReferenceOption } from "@/components/image-settings-panel";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

const settingsButtonClass = "canvas-compact-control !h-8 !min-w-0 !w-full !justify-start !rounded-md !border-0 !bg-transparent !px-1 !text-[11px] !shadow-none hover:!bg-black/5 dark:hover:!bg-white/10";

const MODE_OPTIONS: Array<{ value: CanvasGenerationMode; icon: typeof ImageIcon; labelKey: "image" | "text" | "video" | "audio" | "model" }> = [
    { value: "image", icon: ImageIcon, labelKey: "image" },
    { value: "video", icon: Video, labelKey: "video" },
    { value: "text", icon: MessageSquare, labelKey: "text" },
    { value: "audio", icon: Music2, labelKey: "audio" },
    { value: "model", icon: Box, labelKey: "model" },
];


type CanvasConfigNodePanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    activeRunCount?: number;
    composerOpen?: boolean;
    /** 已有连出的结果节点时，主按钮显示「继续生成」 */
    hasGeneratedResults?: boolean;
    inputSummary: { textCount: number; imageCount: number; videoCount: number; audioCount: number };
    /** Midjourney 底图 / sref：上游已连接图片 */
    referenceImages?: ImageSettingsReferenceOption[];
    /** 上游连有局部编辑预处理图片时，自动切 banana 并显示标识 */
    hasLocalEditReference?: boolean;
    /** 局部编辑框选所选比例（原图/auto → auto） */
    localEditAspectRatio?: string;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (nodeId: string) => void;
    onStop: (nodeId: string) => void;
    onComposerToggle: () => void;
};

export function CanvasConfigNodePanel({
    node,
    isRunning,
    activeRunCount = 0,
    composerOpen = false,
    hasGeneratedResults = false,
    inputSummary,
    referenceImages = [],
    hasLocalEditReference = false,
    localEditAspectRatio = "1:1",
    onConfigChange,
    onGenerate,
    onStop,
    onComposerToggle,
}: CanvasConfigNodePanelProps) {
    const { t } = useTranslation();
    const { token } = antdTheme.useToken();
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = node.metadata?.generationMode || "image";
    const localVideoEdit = Boolean(node.metadata?.videoLocalEditTargetId);
    const config = buildNodeConfig(globalConfig, node, mode);

    // 仅在首次连上局部预处理图时默认切到 banana、数量 1、比例跟预处理所选
    const autoLocalEditModelRef = useRef(false);
    useEffect(() => {
        if (!hasLocalEditReference || mode !== "image") {
            autoLocalEditModelRef.current = false;
            return;
        }
        if (autoLocalEditModelRef.current) return;
        autoLocalEditModelRef.current = true;
        const ratio = localEditAspectRatio || "auto";
        onConfigChange(node.id, {
            model: LOCAL_EDIT_BANANA_MODEL,
            count: 1,
            size: ratio,
            quality: LOCAL_EDIT_DEFAULT_RESOLUTION,
            modelParams: { ...(node.metadata?.modelParams || {}), aspectRatio: ratio },
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasLocalEditReference, localEditAspectRatio, mode, node.id, onConfigChange]);
    const inputSpec = resolveModelInputSpec(config, mode);
    const hasComposerContent = Boolean((node.metadata?.composerContent ?? node.metadata?.prompt ?? "").trim());
    const inputIssue = workbenchInputIssue(mode, inputSpec, inputSummary, hasComposerContent);
    const running = isRunning || activeRunCount > 0;
    const canGenerate = Boolean(config.model) && !inputIssue && (!localVideoEdit || (!running && isVideoLocalEditModel(config.model)));
    const nextCount = mode === "image" ? Math.max(1, Math.min(15, Math.floor(Number(config.count) || 1))) : 1;
    const imagesPerTask = runninghubImagesPerTask(config.model || "");
    const outputCount = nextCount * imagesPerTask;
    const inputHint = localVideoEdit ? node.metadata?.errorDetails || (isVideoLocalEditModel(config.model) ? "生成完整结果视频 · 保留左侧原片与音轨" : "请选择 Seedance 2.0 Global Fast 多模态或 Kling O3 视频编辑模型") : !config.model ? "请选择生成模型"
        : inputIssue?.kind === "prompt" ? "填写提示词，或连接上游文本"
        : inputIssue?.kind === "input" ? "填写提示词，或连接参考素材"
        : inputIssue ? `还需连接 ${inputIssue.missing} 个${{ image: "图片", video: "视频", audio: "音频" }[inputIssue.kind]}`
        : running ? "可按当前参数追加一轮，独立生成结果"
        : hasGeneratedResults ? "按当前参数新增结果，保留已有内容"
        : mode === "image" ? `本次生成 ${outputCount} 张图片` : "输入已就绪";
    useEffect(() => {
        if (inputSpec.prompt === false && composerOpen) onComposerToggle();
    }, [inputSpec.prompt, composerOpen, onComposerToggle]);

    return (
        <div className="relative flex h-full min-h-0 w-full cursor-move flex-col px-4 py-3 text-sm" style={{ color: theme.node.text, background: theme.node.panel }}>
            <div className="mb-1 flex h-6 shrink-0 items-center justify-between gap-2">
                <span className="text-[13px] font-medium">{t("canvas.configNode.title")}</span>
                <span className="inline-flex min-w-0 items-center gap-1 text-[10px]" style={{ color: running ? token.colorSuccess : theme.node.muted }}>
                    {running ? <LoaderCircle className="size-3 animate-spin" /> : hasGeneratedResults ? <Check className="size-3" /> : null}
                    {running ? (activeRunCount > 1 ? `${activeRunCount} 轮进行中` : "生成中")
                        : localVideoEdit ? node.metadata?.status === "error" ? "编辑失败" : node.metadata?.status === "success" ? "已生成结果" : "局部视频编辑"
                        : hasLocalEditReference && mode === "image" ? t("canvas.projectPage.maskPreprocessBadge")
                        : hasGeneratedResults ? "已有结果" : "待生成"}
                </span>
            </div>
            {localVideoEdit ? <div className="flex h-9 shrink-0 items-center gap-2 border-b text-xs" style={{ borderColor: theme.node.stroke }}><Video className="size-3.5" />视频局部编辑</div> : <ModeSwipeTabs value={mode} theme={theme} onChange={(value) => {
                if (value !== mode) onConfigChange(node.id, { generationMode: value, model: resolveModelForCapability(globalConfig, undefined, value), modelParams: {} });
            }} />}

            <div data-canvas-no-zoom className="mt-2 flex flex-1 cursor-default flex-col gap-2"
                onMouseDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
                <ModelPicker className="canvas-compact-control !h-9 !rounded-md !border-0 !bg-transparent !px-1 !text-[12px] !shadow-none hover:!bg-black/5 dark:hover:!bg-white/10"
                    config={config} value={config.model} onChange={model => {
                        if (model !== config.model) onConfigChange(node.id, { model, modelParams: {}, ...(mode === "image" && runninghubImagesPerTask(model) > 1 ? { count: 1 } : {}) });
                    }} capability={mode} onMissingConfig={() => openConfigDialog(true)} placement="topLeft" fullWidth />

                {inputSpec.images || inputSpec.videos || inputSpec.audios ? <div className="space-y-1 px-1">
                    {inputSpec.images ? <MediaInputRow kind="image" label={t("canvas.configNode.references")} spec={inputSpec.images} connected={inputSummary.imageCount} /> : null}
                    {inputSpec.videos ? <MediaInputRow kind="video" label={t("canvas.configNode.videoReferences")} spec={inputSpec.videos} connected={inputSummary.videoCount} /> : null}
                    {inputSpec.audios ? <MediaInputRow kind="audio" label={t("canvas.configNode.audioReferences")} spec={inputSpec.audios} connected={inputSummary.audioCount} /> : null}
                </div> : null}

                <div key={`${mode}:${config.model}`} className="flex min-w-0 items-center gap-2 border-t pt-1.5" style={{ borderColor: theme.node.stroke }}>
                    <span className="shrink-0 text-[10px]" style={{ color: theme.node.muted }}>参数</span>
                    <div className="min-w-0 flex-1 [&>span]:w-full">
                        {mode === "video" ? (
                            <CanvasVideoSettingsPopover localEdit={localVideoEdit} config={config} placement="topRight" buttonClassName={settingsButtonClass} onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                        ) : mode === "image" ? (
                            <CanvasImageSettingsPopover config={config} placement="topRight" buttonClassName={settingsButtonClass} referenceImages={referenceImages}
                                onConfigChange={(key, value) => onConfigChange(node.id, { [key]: value })}
                                onModelParamChange={(key, value) => onConfigChange(node.id, { modelParams: { ...(config.modelParams || {}), [key]: value } })} />
                        ) : mode === "audio" ? (
                            <CanvasAudioSettingsPopover config={config} placement="topRight" buttonClassName={settingsButtonClass} onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                        ) : mode === "model" ? (
                            <CanvasModelSettingsPopover config={config} placement="topRight" buttonClassName={settingsButtonClass} onParamChange={(key, value) => onConfigChange(node.id, { modelParams: { ...(config.modelParams || {}), [key]: value } })} />
                        ) : (
                            <CanvasTextSettingsPopover config={config} placement="topRight" buttonClassName={settingsButtonClass} onConfigChange={(_, value) => onConfigChange(node.id, { reasoningEffort: value })} />
                        )}
                    </div>
                    {mode === "image" ? <CanvasImageCountButton count={nextCount} imagesPerTask={imagesPerTask} placement="topRight" buttonClassName="canvas-compact-control !h-8 !rounded-md !border-0 !bg-transparent !px-1.5 !text-[11px] !shadow-none hover:!bg-black/5 dark:hover:!bg-white/10" onChange={count => onConfigChange(node.id, { count })} /> : null}
                </div>

            </div>

            <button type="button" className="mt-2 flex h-[54px] w-full shrink-0 cursor-pointer items-center gap-2.5 rounded-lg border border-l-[3px] bg-transparent px-3 text-left hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-50 dark:hover:bg-white/10"
                style={{ borderColor: composerOpen ? theme.node.activeStroke : theme.node.stroke, borderLeftColor: inputSpec.prompt === false ? theme.node.stroke : theme.node.text, background: composerOpen ? theme.toolbar.activeBg : undefined, outlineColor: theme.node.activeStroke }}
                aria-expanded={composerOpen} disabled={inputSpec.prompt === false} onClick={onComposerToggle}
                onMouseDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
                <FileText className="size-4 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-[12px] font-semibold leading-4">{t("canvas.configNode.compose")}</span>
                    <span className="truncate text-[10px] leading-3" style={{ color: theme.node.muted }}>
                        {inputSpec.prompt === false ? "当前模型无需提示词" : "在下方独立编辑 · 支持 @ 引用"}
                    </span>
                </span>
                {inputSpec.prompt !== false ? <>
                    <span className="shrink-0 text-[10px]" style={{ color: composerOpen ? theme.node.text : theme.node.muted }}>
                        {composerOpen ? "编辑中" : hasComposerContent ? "已填写" : inputSummary.textCount ? "已连文本" : "未填写"}
                    </span>
                    {composerOpen ? <ChevronUp className="size-3.5 shrink-0" /> : <ChevronDown className="size-3.5 shrink-0" />}
                </> : null}
            </button>

            <div className="mt-2 shrink-0 border-t pt-2" style={{ borderColor: theme.node.stroke }} onMouseDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
                <div className="flex min-h-8 items-center justify-between gap-2">
                    <span className="text-[10px]" style={{ color: theme.node.muted }}>{mode === "image" ? `本轮 · ${outputCount} 张` : t(`canvas.configNode.${mode}`)}</span>
                    <div className="flex min-w-0 items-center gap-1">
                        {running ? <button type="button" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] hover:bg-black/5 dark:hover:bg-white/10"
                            style={{ color: token.colorError }} title="停止此工作台正在进行的生成" onClick={() => onStop(node.id)}>
                            <Square className="size-3" />{t("canvas.configNode.stop")}
                        </button> : null}
                        <button type="button" className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
                            style={{ color: canGenerate ? token.colorSuccess : theme.node.muted }} disabled={!canGenerate} title={inputHint} onClick={() => onGenerate(node.id)}>
                            {localVideoEdit ? <ArrowUpRight className="size-3.5" /> : running || hasGeneratedResults ? <Plus className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}
                            {localVideoEdit ? running ? "正在编辑" : "生成结果" : running ? "追加生成" : t(hasGeneratedResults ? "canvas.configNode.generateMore" : "canvas.configNode.generate")}
                        </button>
                    </div>
                </div>
                <div className="mt-1 truncate text-[10px] leading-4" title={inputHint} style={{ color: node.metadata?.status === "error" ? token.colorError : inputIssue ? token.colorWarning : theme.node.muted }}>{inputHint}</div>
            </div>
        </div>
    );
}

function ModeSwipeTabs({ value, theme, onChange }: { value: CanvasGenerationMode; theme: CanvasTheme; onChange: (value: CanvasGenerationMode) => void }) {
    const { t } = useTranslation();
    const swipeRef = useRef<{ x: number; y: number } | null>(null);
    const swipedRef = useRef(false);

    return (
        <div
            className="grid w-full shrink-0 grid-cols-5 gap-0.5 border-b"
            style={{ borderColor: theme.node.stroke }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => {
                if (event.button !== 0) return;
                swipedRef.current = false;
                swipeRef.current = { x: event.clientX, y: event.clientY };
            }}
            onPointerUp={(event) => {
                const swipe = swipeRef.current;
                swipeRef.current = null;
                if (!swipe) return;
                const dx = event.clientX - swipe.x;
                const dy = event.clientY - swipe.y;
                if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
                swipedRef.current = true;
                const index = MODE_OPTIONS.findIndex((item) => item.value === value);
                const next = MODE_OPTIONS[Math.min(MODE_OPTIONS.length - 1, Math.max(0, index + (dx < 0 ? 1 : -1)))];
                if (next && next.value !== value) onChange(next.value);
            }}
            onPointerCancel={() => {
                swipeRef.current = null;
            }}
        >
            {MODE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const active = value === option.value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        data-mode={option.value}
                        aria-pressed={active}
                        className="flex h-9 min-w-0 items-center justify-center gap-1 border-b-2 px-0.5 text-[10px] font-medium transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                        style={
                            active
                                ? { borderColor: theme.node.text, color: theme.node.text }
                                : { borderColor: "transparent", color: theme.node.muted }
                        }
                        onClick={(event) => {
                            event.stopPropagation();
                            if (swipedRef.current) {
                                swipedRef.current = false;
                                return;
                            }
                            onChange(option.value);
                        }}
                    >
                        <Icon className="size-3.5 shrink-0" stroke="currentColor" />
                        <span className="whitespace-nowrap text-center" style={{ color: "inherit" }}>
                            {t(`canvas.configNode.${option.labelKey}`)}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

function MediaInputRow({ kind, label, spec, connected }: { kind: "image" | "video" | "audio"; label: string; spec: MediaSlotSpec; connected: number }) {
    const { token } = antdTheme.useToken();
    const theme = canvasThemes[useThemeStore(state => state.theme)];
    const Icon = kind === "image" ? ImageIcon : kind === "video" ? Video : Music2;
    const missing = connected < spec.min;
    const overflow = connected > spec.max;
    const hint = missing ? `至少 ${spec.min} 个` : overflow ? `上限 ${spec.max} 个` : spec.min ? "已满足" : "可选";
    return (
        <div className="flex h-6 min-w-0 items-center gap-1.5 text-[11px]" style={{ color: missing || overflow ? token.colorWarning : theme.node.muted }}>
            <Icon className="size-3.5 shrink-0" /><span>{label}</span>
            <span className="ml-auto text-[10px]">{hint}</span>
            <span className="min-w-9 text-right tabular-nums" title={`已连接 ${connected} 个，上限 ${spec.max} 个`}>{connected} / {spec.max}</span>
        </div>
    );
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasGenerationMode): AiConfig {
    return {
        ...globalConfig,
        model: resolveModelForCapability(globalConfig, node.metadata?.model, mode),
        reasoningEffort: node.metadata?.reasoningEffort || globalConfig.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        background: node.metadata?.background ?? globalConfig.background ?? defaultConfig.background,
        modelParams: node.metadata?.modelParams || globalConfig.modelParams || defaultConfig.modelParams,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        videoRealPersonMode: node.metadata?.realPersonMode || globalConfig.videoRealPersonMode || defaultConfig.videoRealPersonMode,
        videoReferenceMode: node.metadata?.videoReferenceMode || globalConfig.videoReferenceMode,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        audioEmotion: node.metadata?.audioEmotion || globalConfig.audioEmotion || defaultConfig.audioEmotion,
        audioTitle: node.metadata?.audioTitle || globalConfig.audioTitle || defaultConfig.audioTitle,
        audioInstrumental: node.metadata?.audioInstrumental || globalConfig.audioInstrumental || defaultConfig.audioInstrumental,
        audioTags: node.metadata?.audioTags || globalConfig.audioTags || defaultConfig.audioTags,
        audioLyrics: node.metadata?.audioLyrics || globalConfig.audioLyrics || defaultConfig.audioLyrics,
        audioStyle: node.metadata?.audioStyle || globalConfig.audioStyle || defaultConfig.audioStyle,
        audioCloneModel: node.metadata?.audioCloneModel || globalConfig.audioCloneModel || defaultConfig.audioCloneModel,
        audioNoiseReduction: node.metadata?.audioNoiseReduction || globalConfig.audioNoiseReduction || defaultConfig.audioNoiseReduction,
        audioVolumeNormalization: node.metadata?.audioVolumeNormalization || globalConfig.audioVolumeNormalization || defaultConfig.audioVolumeNormalization,
        count: String(mode === "image" ? node.metadata?.count || globalConfig.canvasImageCount || globalConfig.count || defaultConfig.count : "1"),
    };
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    if (key === "videoRealPersonMode") return { realPersonMode: value };
    return { [key]: value };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    if (key === "audioEmotion") return { audioEmotion: value };
    if (key === "audioTitle") return { audioTitle: value };
    if (key === "audioInstrumental") return { audioInstrumental: value };
    if (key === "audioTags") return { audioTags: value };
    if (key === "audioLyrics") return { audioLyrics: value };
    if (key === "audioStyle") return { audioStyle: value };
    if (key === "audioCloneModel") return { audioCloneModel: value };
    if (key === "audioNoiseReduction") return { audioNoiseReduction: value };
    if (key === "audioVolumeNormalization") return { audioVolumeNormalization: value };
    return { audioInstructions: value };
}
