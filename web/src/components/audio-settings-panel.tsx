import { type ReactNode } from "react";
import { Switch } from "antd";
import { useTranslation } from "react-i18next";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import {
    normalizeAudioEmotionValue,
    normalizeAudioFormatForSchema,
    normalizeAudioInstrumentalValue,
    normalizeAudioSpeedForSchema,
    normalizeAudioVoiceForSchema,
    normalizeVoiceCloneModel,
    resolveAudioSettingSchema,
} from "@/lib/canvas/audio-setting-schema";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { boolConfig } from "@/lib/seedance-video";
import type { AiConfig } from "@/stores/use-config-store";

export type AudioSettingKey =
    | "audioVoice"
    | "audioFormat"
    | "audioSpeed"
    | "audioInstructions"
    | "audioEmotion"
    | "audioTitle"
    | "audioInstrumental"
    | "audioTags"
    | "audioLyrics"
    | "audioStyle"
    | "audioCloneModel"
    | "audioNoiseReduction"
    | "audioVolumeNormalization";

type AudioSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: AudioSettingKey, value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function AudioSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: AudioSettingsPanelProps) {
    const { t } = useTranslation();
    const schema = resolveAudioSettingSchema(config);

    if (schema.source === "unsupported") {
        return (
            <ImageSettingsTheme theme={theme}>
                <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                    {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.audio.title")}</div> : null}
                    <p className="text-sm leading-6" style={{ color: theme.node.muted }}>
                        {t(`settingsPanels.audio.${schema.messageKey || "unsupportedGeneric"}`)}
                    </p>
                </div>
            </ImageSettingsTheme>
        );
    }

    if (schema.source === "runninghub-suno-lyrics") {
        return (
            <ImageSettingsTheme theme={theme}>
                <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                    {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.audio.title")}</div> : null}
                    <p className="text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t("settingsPanels.audio.sunoLyricsHint")}
                    </p>
                </div>
            </ImageSettingsTheme>
        );
    }

    if (schema.source === "runninghub-suno-single" || schema.source === "runninghub-suno-custom") {
        const instrumental = boolConfig(normalizeAudioInstrumentalValue(config.audioInstrumental), false);
        return (
            <ImageSettingsTheme theme={theme}>
                <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                    {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.audio.title")}</div> : null}
                    <p className="text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t(schema.source === "runninghub-suno-custom" ? "settingsPanels.audio.sunoCustomHint" : "settingsPanels.audio.sunoSingleHint")}
                    </p>
                    {schema.showTitle ? (
                        <SettingGroup title={t("settingsPanels.audio.songTitle")} color={theme.node.muted}>
                            <input
                                type="text"
                                maxLength={80}
                                className="h-9 w-full rounded-full border bg-transparent px-3 text-sm outline-none"
                                style={{ borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                                value={config.audioTitle || ""}
                                placeholder={t(schema.source === "runninghub-suno-custom" ? "settingsPanels.audio.songTitleRequiredPlaceholder" : "settingsPanels.audio.songTitlePlaceholder")}
                                onChange={(event) => onConfigChange("audioTitle", event.target.value)}
                                onMouseDown={(event) => event.stopPropagation()}
                            />
                        </SettingGroup>
                    ) : null}
                    {schema.showTags ? (
                        <SettingGroup title={t("settingsPanels.audio.tags")} color={theme.node.muted}>
                            <input
                                type="text"
                                maxLength={1000}
                                className="h-9 w-full rounded-full border bg-transparent px-3 text-sm outline-none"
                                style={{ borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                                value={config.audioTags || ""}
                                placeholder={t("settingsPanels.audio.tagsPlaceholder")}
                                onChange={(event) => onConfigChange("audioTags", event.target.value)}
                                onMouseDown={(event) => event.stopPropagation()}
                            />
                        </SettingGroup>
                    ) : null}
                    {schema.showInstrumental ? (
                        <SettingGroup title={t("settingsPanels.audio.output")} color={theme.node.muted}>
                            <div className="flex h-8 items-center justify-between gap-3">
                                <span className="text-sm" style={{ color: theme.node.text }}>
                                    {t("settingsPanels.audio.instrumental")}
                                </span>
                                <Switch size="small" checked={instrumental} onChange={(checked) => onConfigChange("audioInstrumental", String(checked))} />
                            </div>
                        </SettingGroup>
                    ) : null}
                </div>
            </ImageSettingsTheme>
        );
    }

    if (schema.source === "runninghub-music-cover" || schema.source === "runninghub-music-text") {
        const format = normalizeAudioFormatForSchema(schema, config.audioFormat);
        return (
            <ImageSettingsTheme theme={theme}>
                <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                    {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.audio.title")}</div> : null}
                    <p className="text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t(schema.source === "runninghub-music-cover" ? "settingsPanels.audio.musicCoverHint" : "settingsPanels.audio.musicTextHint")}
                    </p>
                    {schema.showStyle ? (
                        <SettingGroup title={t("settingsPanels.audio.style")} color={theme.node.muted}>
                            <textarea
                                value={config.audioStyle || ""}
                                placeholder={t(schema.styleRequired ? "settingsPanels.audio.styleRequiredPlaceholder" : "settingsPanels.audio.stylePlaceholder")}
                                className="thin-scrollbar h-20 w-full resize-none rounded-xl border bg-transparent px-3 py-2 text-sm leading-5 outline-none"
                                style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                                onChange={(event) => onConfigChange("audioStyle", event.target.value)}
                                onMouseDown={(event) => event.stopPropagation()}
                            />
                        </SettingGroup>
                    ) : null}
                    {schema.showLyrics ? (
                        <SettingGroup title={t("settingsPanels.audio.lyrics")} color={theme.node.muted}>
                            <textarea
                                value={config.audioLyrics || ""}
                                placeholder={t("settingsPanels.audio.lyricsPlaceholder")}
                                className="thin-scrollbar h-24 w-full resize-none rounded-xl border bg-transparent px-3 py-2 text-sm leading-5 outline-none"
                                style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                                onChange={(event) => onConfigChange("audioLyrics", event.target.value)}
                                onMouseDown={(event) => event.stopPropagation()}
                            />
                        </SettingGroup>
                    ) : null}
                    {schema.showFormat ? (
                        <SettingGroup title={t("settingsPanels.audio.format")} color={theme.node.muted}>
                            <div className="grid grid-cols-3 gap-2.5">
                                {schema.formats.map((item) => (
                                    <OptionPill key={item.value} selected={format === item.value} theme={theme} onClick={() => onConfigChange("audioFormat", item.value)}>
                                        {item.label}
                                    </OptionPill>
                                ))}
                            </div>
                        </SettingGroup>
                    ) : null}
                </div>
            </ImageSettingsTheme>
        );
    }

    if (schema.source === "runninghub-voice-clone") {
        const cloneModel = normalizeVoiceCloneModel(config.audioCloneModel || "speech-02-hd");
        const noise = boolConfig(config.audioNoiseReduction, false);
        const volume = boolConfig(config.audioVolumeNormalization, false);
        return (
            <ImageSettingsTheme theme={theme}>
                <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                    {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.audio.title")}</div> : null}
                    <p className="text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t("settingsPanels.audio.voiceCloneHint")}
                    </p>
                    {schema.showCloneModel ? (
                        <SettingGroup title={t("settingsPanels.audio.cloneModel")} color={theme.node.muted}>
                            <div className="grid grid-cols-2 gap-2.5">
                                {(schema.cloneModels || []).map((item) => (
                                    <OptionPill key={item.value} selected={cloneModel === item.value} theme={theme} onClick={() => onConfigChange("audioCloneModel", item.value)}>
                                        {item.label}
                                    </OptionPill>
                                ))}
                            </div>
                        </SettingGroup>
                    ) : null}
                    {schema.showNoiseReduction ? (
                        <SettingGroup title={t("settingsPanels.audio.output")} color={theme.node.muted}>
                            <div className="space-y-2">
                                <div className="flex h-8 items-center justify-between gap-3">
                                    <span className="text-sm" style={{ color: theme.node.text }}>
                                        {t("settingsPanels.audio.noiseReduction")}
                                    </span>
                                    <Switch size="small" checked={noise} onChange={(checked) => onConfigChange("audioNoiseReduction", String(checked))} />
                                </div>
                                <div className="flex h-8 items-center justify-between gap-3">
                                    <span className="text-sm" style={{ color: theme.node.text }}>
                                        {t("settingsPanels.audio.volumeNormalization")}
                                    </span>
                                    <Switch size="small" checked={volume} onChange={(checked) => onConfigChange("audioVolumeNormalization", String(checked))} />
                                </div>
                            </div>
                        </SettingGroup>
                    ) : null}
                </div>
            </ImageSettingsTheme>
        );
    }

    const voice = normalizeAudioVoiceForSchema(schema, config.audioVoice);
    const format = normalizeAudioFormatForSchema(schema, config.audioFormat);
    const speed = normalizeAudioSpeedForSchema(schema, config.audioSpeed);
    const emotion = normalizeAudioEmotionValue(config.audioEmotion || "happy");
    const voiceCols = schema.voices.length > 9 ? "grid-cols-2" : "grid-cols-3";

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.audio.title")}</div> : null}
                {schema.showVoice ? (
                    <SettingGroup title={t("settingsPanels.audio.voice")} color={theme.node.muted}>
                        <div className={`grid gap-2.5 ${voiceCols}`}>
                            {schema.voices.map((item) => (
                                <OptionPill key={item.value} selected={voice === item.value} theme={theme} onClick={() => onConfigChange("audioVoice", item.value)}>
                                    {item.label}
                                </OptionPill>
                            ))}
                        </div>
                    </SettingGroup>
                ) : null}
                {schema.showEmotion ? (
                    <SettingGroup title={t("settingsPanels.audio.emotion")} color={theme.node.muted}>
                        <div className="grid grid-cols-4 gap-2.5">
                            {schema.emotions.map((value) => (
                                <OptionPill key={value} selected={emotion === value} theme={theme} onClick={() => onConfigChange("audioEmotion", value)}>
                                    {t(`settingsPanels.audio.emotions.${value}`)}
                                </OptionPill>
                            ))}
                        </div>
                    </SettingGroup>
                ) : null}
                {schema.showFormat ? (
                    <SettingGroup title={t("settingsPanels.audio.format")} color={theme.node.muted}>
                        <div className="grid grid-cols-3 gap-2.5">
                            {schema.formats.map((item) => (
                                <OptionPill key={item.value} selected={format === item.value} theme={theme} onClick={() => onConfigChange("audioFormat", item.value)}>
                                    {item.label}
                                </OptionPill>
                            ))}
                        </div>
                    </SettingGroup>
                ) : null}
                {schema.showSpeed ? (
                    <SettingGroup title={t("settingsPanels.audio.speed")} color={theme.node.muted}>
                        <div className="grid grid-cols-4 gap-2.5">
                            {schema.speedPresets.map((value) => (
                                <OptionPill key={value} selected={speed === value} theme={theme} onClick={() => onConfigChange("audioSpeed", value)}>
                                    {`${value}x`}
                                </OptionPill>
                            ))}
                        </div>
                        <input
                            type="number"
                            min={schema.speedMin}
                            max={schema.speedMax}
                            step={0.05}
                            className="h-9 w-full rounded-full border bg-transparent px-3 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            style={{ borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                            value={config.audioSpeed || "1"}
                            onChange={(event) => onConfigChange("audioSpeed", event.target.value)}
                            onBlur={(event) => onConfigChange("audioSpeed", normalizeAudioSpeedForSchema(schema, event.target.value))}
                            onMouseDown={(event) => event.stopPropagation()}
                        />
                    </SettingGroup>
                ) : null}
                {schema.showInstructions ? (
                    <SettingGroup title={t("settingsPanels.audio.instructions")} color={theme.node.muted}>
                        <textarea
                            value={config.audioInstructions || ""}
                            placeholder={t("settingsPanels.audio.instructionsPlaceholder")}
                            className="thin-scrollbar h-20 w-full resize-none rounded-xl border bg-transparent px-3 py-2 text-sm leading-5 outline-none"
                            style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                            onChange={(event) => onConfigChange("audioInstructions", event.target.value)}
                            onMouseDown={(event) => event.stopPropagation()}
                        />
                    </SettingGroup>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80" style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}
