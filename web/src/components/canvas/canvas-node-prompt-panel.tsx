import { useEffect, useState } from "react";
import { ArrowUp, Maximize2, Square } from "lucide-react";
import { Button, Modal, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { LOCAL_EDIT_DEFAULT_RESOLUTION } from "@/lib/canvas/banana-local-edit";
import { defaultConfig, resolveModelForCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { runninghubImagesPerTask } from "@/services/api/runninghub-models";
import { CanvasImageCountButton } from "./canvas-image-count-button";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasPromptChipInput } from "./canvas-prompt-chip-input";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasTextSettingsPopover } from "./canvas-text-settings-popover";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    /** 已有结果时主按钮语义为继续生成 */
    hasGeneratedResults?: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    onStop: (nodeId: string) => void;
    mentionReferences?: CanvasResourceReference[];
    onImageSettingsOpenChange?: (open: boolean) => void;
    modeOverride?: CanvasNodeGenerationMode; // Plugin nodes set their generation type through useBuiltinPanel.mode.
};

export function CanvasNodePromptPanel({ node, isRunning, hasGeneratedResults = false, onPromptChange, onConfigChange, onGenerate, onStop, mentionReferences = [], onImageSettingsOpenChange, modeOverride }: CanvasNodePromptPanelProps) {
    const { t } = useTranslation();
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = modeOverride ?? defaultMode(node.type);
    const config = buildNodeConfig(globalConfig, node, mode);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const isEditingExistingContent = hasTextContent || hasImageContent;
    const [prompt, setPrompt] = useState(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
    const [expanded, setExpanded] = useState(false);

    // Restore prompts only when switching nodes; preserve the current input after generation on the same node.
    useEffect(() => {
        setPrompt(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node.id]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        if (isEditingExistingContent) onConfigChange(node.id, { composerContent: value });
        else onPromptChange(node.id, value);
    };

    const submit = () => {
        const text = prompt.trim();
        if (!text) return;
        onGenerate(node.id, mode, text);
    };

    const openExpandedEditor = () => {
        setExpanded(true);
    };

    return (
        <div
            data-canvas-no-zoom
            className="rounded-2xl border p-3 shadow-2xl backdrop-blur"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <CanvasPromptChipInput
                value={prompt}
                references={mentionReferences}
                onChange={updatePrompt}
                onSubmit={submit}
                className="thin-scrollbar h-40 w-full cursor-text resize-none rounded-xl px-3 py-2 text-sm leading-5 outline-none"
                style={{ background: "transparent", color: theme.node.text }}
                placeholder={t(`canvas.promptPanel.${mode === "image" && hasImageContent ? "editImage" : mode === "text" && hasTextContent ? "editText" : mode}`)}
            />

            <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
                <Tooltip title={t("canvas.promptPanel.expandEditor")}>
                    <Button type="text" className="!h-8 !w-8 !min-w-8 shrink-0 !rounded-full !bg-transparent !p-0" style={{ color: theme.node.text }} icon={<Maximize2 className="size-3.5" />} onClick={openExpandedEditor} aria-label={t("canvas.promptPanel.expandEditor")} />
                </Tooltip>
                <CanvasPromptLibrary onSelect={updatePrompt} />
                {mode === "image" ? (
                    <>
                        <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="image" onMissingConfig={() => openConfigDialog(true)} placement="topLeft" className="!min-w-0 max-w-[148px]" />
                        <CanvasImageSettingsPopover
                            config={config}
                            placement="topLeft"
                            buttonClassName="!h-8 !max-w-[132px] !justify-start !rounded-full !px-3"
                            onConfigChange={(key, value) => onConfigChange(node.id, { [key]: value })}
                            onModelParamChange={(key, value) => onConfigChange(node.id, { modelParams: { ...(config.modelParams || {}), [key]: value } })}
                            onMissingConfig={() => openConfigDialog(true)}
                            onOpenChange={onImageSettingsOpenChange}
                        />
                        <CanvasImageCountButton count={Number(config.count) || 1} imagesPerTask={runninghubImagesPerTask(config.model || "")} placement="topLeft" buttonClassName="!h-8 !rounded-full !px-3" onChange={(count) => onConfigChange(node.id, { count })} onOpenChange={onImageSettingsOpenChange} />
                    </>
                ) : mode === "video" ? (
                    <>
                        <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="video" onMissingConfig={() => openConfigDialog(true)} placement="topLeft" className="!min-w-0 max-w-[148px]" />
                        <CanvasVideoSettingsPopover config={config} buttonClassName="!h-8 !max-w-[132px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))} />
                    </>
                ) : mode === "audio" ? (
                    <>
                        <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="audio" onMissingConfig={() => openConfigDialog(true)} placement="topLeft" className="!min-w-0 max-w-[148px]" />
                        <CanvasAudioSettingsPopover config={config} buttonClassName="!h-8 !max-w-[132px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))} />
                    </>
                ) : (
                    <>
                        <ModelPicker config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability="text" onMissingConfig={() => openConfigDialog(true)} placement="topLeft" className="!min-w-0 max-w-[148px]" />
                        <CanvasTextSettingsPopover config={config} buttonClassName="!h-8 !max-w-[132px] !justify-start !rounded-full !px-3" onConfigChange={(_, value) => onConfigChange(node.id, { reasoningEffort: value })} />
                    </>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    {isRunning ? (
                        <Tooltip title={t("canvas.promptPanel.stopGeneration")}>
                            <Button
                                danger
                                type="primary"
                                className="!h-8 !w-8 !min-w-8 !rounded-full !p-0"
                                onClick={() => onStop(node.id)}
                                aria-label={t("canvas.promptPanel.stopGeneration")}
                            >
                                <Square className="size-3.5 fill-current" />
                            </Button>
                        </Tooltip>
                    ) : null}
                    <Button
                        type="primary"
                        className="!h-8 !w-8 !min-w-8 !rounded-full !p-0"
                        disabled={!prompt.trim()}
                        onClick={() => submit()}
                        aria-label={t(isRunning || hasGeneratedResults ? "canvas.promptPanel.generateMore" : "canvas.promptPanel.generate")}
                        title={t(isRunning || hasGeneratedResults ? "canvas.promptPanel.generateMore" : "canvas.promptPanel.generate")}
                    >
                        <ArrowUp className="size-4" />
                    </Button>
                </div>
            </div>
            <Modal title={t("canvas.promptPanel.editorTitle")} open={expanded} centered width={760} footer={null} onCancel={() => setExpanded(false)} destroyOnHidden>
                <div data-canvas-no-zoom className="pt-2" onWheelCapture={(event) => event.stopPropagation()}>
                    <CanvasPromptChipInput
                        value={prompt}
                        references={mentionReferences}
                        onChange={updatePrompt}
                        className="thin-scrollbar h-[52dvh] min-h-80 w-full cursor-text overflow-y-auto rounded-xl border p-4 text-[15px] leading-6 outline-none"
                        style={{ background: "transparent", borderColor: theme.toolbar.border, color: theme.node.text }}
                        placeholder={t(`canvas.promptPanel.${mode === "image" && hasImageContent ? "editImage" : mode === "text" && hasTextContent ? "editText" : mode}`)}
                    />
                </div>
            </Modal>
        </div>
    );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : type === "model" ? "model" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
    // 局部编辑以框选所选比例为准（localEditChosenRatio），避免旧 size 未同步时仍显示 1:1
    const localEditSize = node.metadata?.localEditPreprocess
        ? node.metadata?.localEditChosenRatio || (typeof node.metadata?.modelParams?.aspectRatio === "string" ? node.metadata.modelParams.aspectRatio : undefined) || node.metadata?.size
        : undefined;
    const localEditQuality = node.metadata?.localEditPreprocess ? node.metadata?.quality || LOCAL_EDIT_DEFAULT_RESOLUTION : undefined;
    return {
        ...globalConfig,
        model: resolveModelForCapability(globalConfig, node.metadata?.model, mode),
        reasoningEffort: node.metadata?.reasoningEffort || globalConfig.reasoningEffort || defaultConfig.reasoningEffort,
        quality: localEditQuality || node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: localEditSize || node.metadata?.size || globalConfig.size || defaultConfig.size,
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
