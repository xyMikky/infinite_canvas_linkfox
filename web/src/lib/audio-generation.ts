import i18n from "@/i18n";
import {
    MINIMAX_AUDIO_VOICES,
    OPENAI_AUDIO_FORMATS,
    OPENAI_AUDIO_VOICES,
    normalizeAudioEmotionValue,
    normalizeAudioFormatForSchema,
    normalizeAudioSpeedForSchema,
    normalizeAudioVoiceForSchema,
    resolveAudioSettingSchema,
} from "@/lib/canvas/audio-setting-schema";
import type { AiConfig } from "@/stores/use-config-store";

/** OpenAI 默认音色；偏好设置与兼容旧调用使用。 */
export const audioVoiceOptions = OPENAI_AUDIO_VOICES;
export const audioFormatOptions = OPENAI_AUDIO_FORMATS;

export function normalizeAudioVoiceValue(value: string) {
    return OPENAI_AUDIO_VOICES.some((item) => item.value === value) || MINIMAX_AUDIO_VOICES.some((item) => item.value === value) ? value : "alloy";
}

export function normalizeAudioFormatValue(value: string) {
    return OPENAI_AUDIO_FORMATS.some((item) => item.value === value) ? value : "mp3";
}

export function normalizeAudioSpeedValue(value: string) {
    const speed = Number(value);
    if (!Number.isFinite(speed)) return "1";
    return String(Math.max(0.25, Math.min(4, Number(speed.toFixed(2)))));
}

export function audioVoiceLabel(value: string) {
    const voice =
        OPENAI_AUDIO_VOICES.find((item) => item.value === value) ||
        MINIMAX_AUDIO_VOICES.find((item) => item.value === value);
    return voice?.label || value || "-";
}

export function audioFormatLabel(value: string) {
    const format = normalizeAudioFormatValue(value);
    return OPENAI_AUDIO_FORMATS.find((item) => item.value === format)?.label || format;
}

export function audioSpeedLabel(value: string) {
    return `${normalizeAudioSpeedValue(value)}x`;
}

export function audioEmotionLabel(value: string) {
    const emotion = normalizeAudioEmotionValue(value);
    return i18n.t(`settingsPanels.audio.emotions.${emotion}`);
}

export function audioSettingsSummary(config: AiConfig) {
    const schema = resolveAudioSettingSchema(config);
    if (schema.source === "unsupported") {
        return i18n.t(`settingsPanels.audio.${schema.messageKey || "unsupportedGeneric"}`);
    }
    if (schema.source === "runninghub-suno-single") {
        const title = (config.audioTitle || "").trim() || i18n.t("settingsPanels.audio.autoTitle");
        const instrumental = config.audioInstrumental === "true";
        return `${title} · ${i18n.t(instrumental ? "settingsPanels.audio.instrumentalOn" : "settingsPanels.audio.instrumentalOff")}`;
    }
    if (schema.source === "runninghub-suno-custom") {
        const title = (config.audioTitle || "").trim() || i18n.t("settingsPanels.audio.songTitle");
        const tags = (config.audioTags || "").trim() || i18n.t("settingsPanels.audio.tags");
        return `${title} · ${tags}`;
    }
    if (schema.source === "runninghub-suno-lyrics") {
        return i18n.t("settingsPanels.audio.sunoLyrics");
    }
    if (schema.source === "runninghub-music-cover") {
        const format = normalizeAudioFormatForSchema(schema, config.audioFormat);
        return `${i18n.t("settingsPanels.audio.musicCover")} · ${audioFormatLabel(format)}`;
    }
    if (schema.source === "runninghub-music-text") {
        const format = normalizeAudioFormatForSchema(schema, config.audioFormat);
        const style = (config.audioStyle || "").trim();
        return style ? `${style.slice(0, 18)} · ${audioFormatLabel(format)}` : `${i18n.t("settingsPanels.audio.musicText")} · ${audioFormatLabel(format)}`;
    }
    if (schema.source === "runninghub-voice-clone") {
        return `${i18n.t("settingsPanels.audio.voiceClone")} · ${config.audioCloneModel || "speech-02-hd"}`;
    }
    const voice = normalizeAudioVoiceForSchema(schema, config.audioVoice);
    const speed = normalizeAudioSpeedForSchema(schema, config.audioSpeed);
    if (schema.source === "runninghub-speech") {
        return `${audioVoiceLabel(voice)} · ${audioEmotionLabel(config.audioEmotion)} · ${speed}x`;
    }
    const format = normalizeAudioFormatForSchema(schema, config.audioFormat);
    return `${audioVoiceLabel(voice)} · ${audioFormatLabel(format)} · ${speed}x`;
}

export function audioMimeType(format: string) {
    if (format === "wav") return "audio/wav";
    if (format === "opus") return "audio/opus";
    if (format === "aac") return "audio/aac";
    if (format === "flac") return "audio/flac";
    if (format === "pcm") return "audio/pcm";
    return "audio/mpeg";
}
