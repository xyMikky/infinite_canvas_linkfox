import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

export type AudioOption = { value: string; label: string };

export type AudioSettingSchema = {
    source: "openai" | "runninghub-speech" | "runninghub-suno-single" | "runninghub-suno-custom" | "runninghub-suno-lyrics" | "runninghub-music-cover" | "runninghub-music-text" | "runninghub-voice-clone" | "unsupported";
    voices: AudioOption[];
    formats: AudioOption[];
    emotions: string[];
    cloneModels?: AudioOption[];
    showFormat: boolean;
    showInstructions: boolean;
    showEmotion: boolean;
    showTitle: boolean;
    showInstrumental: boolean;
    showTags: boolean;
    showVoice: boolean;
    showSpeed: boolean;
    showLyrics: boolean;
    showStyle: boolean;
    showCloneModel?: boolean;
    showNoiseReduction?: boolean;
    styleRequired: boolean;
    /** 工作台需展示的参考音频槽 */
    audioSlots?: { min: number; max: number };
    speedMin: number;
    speedMax: number;
    speedPresets: string[];
    messageKey?: string;
};

export type RunninghubAudioFamily = "speech" | "suno-single" | "suno-custom" | "suno-lyrics" | "music-cover" | "music-text" | "voice-clone" | "unsupported";

export const MUSIC_AUDIO_FORMATS: AudioOption[] = [
    { value: "mp3", label: "MP3" },
    { value: "wav", label: "WAV" },
    { value: "pcm", label: "PCM" },
];

export const VOICE_CLONE_MODELS: AudioOption[] = [
    { value: "speech-02-hd", label: "speech-02-hd" },
    { value: "speech-02-turbo", label: "speech-02-turbo" },
    { value: "speech-2.6-hd", label: "speech-2.6-hd" },
    { value: "speech-2.6-turbo", label: "speech-2.6-turbo" },
    { value: "speech-2.8-hd", label: "speech-2.8-hd" },
    { value: "speech-2.8-turbo", label: "speech-2.8-turbo" },
];

export const OPENAI_AUDIO_VOICES: AudioOption[] = [
    { value: "alloy", label: "Alloy" },
    { value: "ash", label: "Ash" },
    { value: "ballad", label: "Ballad" },
    { value: "coral", label: "Coral" },
    { value: "echo", label: "Echo" },
    { value: "fable", label: "Fable" },
    { value: "nova", label: "Nova" },
    { value: "onyx", label: "Onyx" },
    { value: "sage", label: "Sage" },
    { value: "shimmer", label: "Shimmer" },
    { value: "verse", label: "Verse" },
    { value: "marin", label: "Marin" },
    { value: "cedar", label: "Cedar" },
];

export const OPENAI_AUDIO_FORMATS: AudioOption[] = [
    { value: "mp3", label: "MP3" },
    { value: "wav", label: "WAV" },
    { value: "opus", label: "Opus" },
    { value: "aac", label: "AAC" },
    { value: "flac", label: "FLAC" },
    { value: "pcm", label: "PCM" },
];

/** MiniMax 系统音色（RunningHub speech-*） */
export const MINIMAX_AUDIO_VOICES: AudioOption[] = [
    { value: "Wise_Woman", label: "Wise Woman" },
    { value: "Friendly_Person", label: "Friendly Person" },
    { value: "Inspirational_girl", label: "Inspirational Girl" },
    { value: "Deep_Voice_Man", label: "Deep Voice Man" },
    { value: "Calm_Woman", label: "Calm Woman" },
    { value: "Casual_Guy", label: "Casual Guy" },
    { value: "Lively_Girl", label: "Lively Girl" },
    { value: "Patient_Man", label: "Patient Man" },
    { value: "Young_Knight", label: "Young Knight" },
    { value: "Determined_Man", label: "Determined Man" },
    { value: "Lovely_Girl", label: "Lovely Girl" },
    { value: "Decent_Boy", label: "Decent Boy" },
    { value: "Imposing_Manner", label: "Imposing Manner" },
    { value: "Elegant_Man", label: "Elegant Man" },
    { value: "Abbess", label: "Abbess" },
    { value: "Sweet_Girl_2", label: "Sweet Girl" },
    { value: "Exuberant_Girl", label: "Exuberant Girl" },
];

export const MINIMAX_AUDIO_EMOTION_VALUES = ["happy", "sad", "angry", "fearful", "disgusted", "surprised", "neutral"] as const;

export function isRunninghubSpeechEndpoint(endpoint: string) {
    const value = endpoint.toLowerCase();
    return value.includes("/speech-") || value.includes("speech-0") || value.includes("speech-2");
}

export function resolveRunninghubAudioFamily(endpoint: string): RunninghubAudioFamily {
    const value = endpoint.toLowerCase();
    if (value.includes("voice-clone")) return "voice-clone";
    if (isRunninghubSpeechEndpoint(value)) return "speech";
    if (value.includes("suno") && value.includes("lyric")) return "suno-lyrics";
    if (value.includes("suno") && value.includes("/single")) return "suno-single";
    if (value.includes("suno") && value.includes("/custom")) return "suno-custom";
    if (value.includes("music-cover") && !value.includes("preprocess")) return "music-cover";
    if (value.includes("music-2.5") || value.includes("music-2.6") || /text-to-audio\/music/i.test(value)) return "music-text";
    return "unsupported";
}

/** 按音频模型族声明工作台可上传媒体槽（目前主要是参考音频）。 */
export function resolveAudioMediaSlots(config: AiConfig): { audios?: { min: number; max: number } } {
    const selected = (config.model || config.audioModel || "").trim();
    const request = resolveModelRequestConfig(config, selected);
    if (request.apiFormat !== "runninghub") return {};
    const family = resolveRunninghubAudioFamily(modelOptionName(selected) || request.model);
    if (family === "music-cover" || family === "voice-clone") return { audios: { min: 1, max: 1 } };
    return {};
}

export function isRunninghubSupportedAudioEndpoint(endpoint: string) {
    return resolveRunninghubAudioFamily(endpoint) !== "unsupported";
}

export function isRunninghubLyricsEndpoint(endpoint: string) {
    return resolveRunninghubAudioFamily(endpoint) === "suno-lyrics";
}

export function isRunninghubLyricsConfig(config: AiConfig) {
    const selected = (config.model || config.audioModel || "").trim();
    const request = resolveModelRequestConfig(config, selected);
    if (request.apiFormat !== "runninghub") return false;
    return isRunninghubLyricsEndpoint(modelOptionName(selected) || request.model);
}

export function supportsOpenAiAudioInstructions(model: string) {
    return /gpt-4o-mini-tts/i.test(model);
}

/** 按当前音频模型能力声明设置项；不支持的选项不暴露。 */
export function resolveAudioSettingSchema(config: AiConfig): AudioSettingSchema {
    const selected = (config.model || config.audioModel || "").trim();
    const request = resolveModelRequestConfig(config, selected);
    const model = modelOptionName(selected) || request.model;

    if (request.apiFormat === "runninghub") {
        const family = resolveRunninghubAudioFamily(model);
        if (family === "speech") {
            return {
                source: "runninghub-speech",
                voices: MINIMAX_AUDIO_VOICES,
                formats: [{ value: "mp3", label: "MP3" }],
                emotions: [...MINIMAX_AUDIO_EMOTION_VALUES],
                showFormat: false,
                showInstructions: false,
                showEmotion: true,
                showTitle: false,
                showInstrumental: false,
                showTags: false,
                showVoice: true,
                showSpeed: true,
                showLyrics: false,
                showStyle: false,
                styleRequired: false,
                speedMin: 0.5,
                speedMax: 2,
                speedPresets: ["0.75", "1", "1.25", "1.5"],
            };
        }
        if (family === "suno-single") {
            return {
                source: "runninghub-suno-single",
                voices: [],
                formats: [{ value: "mp3", label: "MP3" }],
                emotions: [],
                showFormat: false,
                showInstructions: false,
                showEmotion: false,
                showTitle: true,
                showInstrumental: true,
                showTags: false,
                showVoice: false,
                showSpeed: false,
                showLyrics: false,
                showStyle: false,
                styleRequired: false,
                speedMin: 1,
                speedMax: 1,
                speedPresets: [],
            };
        }
        if (family === "suno-custom") {
            return {
                source: "runninghub-suno-custom",
                voices: [],
                formats: [{ value: "mp3", label: "MP3" }],
                emotions: [],
                showFormat: false,
                showInstructions: false,
                showEmotion: false,
                showTitle: true,
                showInstrumental: false,
                showTags: true,
                showVoice: false,
                showSpeed: false,
                showLyrics: false,
                showStyle: false,
                styleRequired: false,
                speedMin: 1,
                speedMax: 1,
                speedPresets: [],
            };
        }
        if (family === "suno-lyrics") {
            return {
                source: "runninghub-suno-lyrics",
                voices: [],
                formats: [],
                emotions: [],
                showFormat: false,
                showInstructions: false,
                showEmotion: false,
                showTitle: false,
                showInstrumental: false,
                showTags: false,
                showVoice: false,
                showSpeed: false,
                showLyrics: false,
                showStyle: false,
                styleRequired: false,
                speedMin: 1,
                speedMax: 1,
                speedPresets: [],
            };
        }
        if (family === "music-cover") {
            return {
                source: "runninghub-music-cover",
                voices: [],
                formats: MUSIC_AUDIO_FORMATS,
                emotions: [],
                showFormat: true,
                showInstructions: false,
                showEmotion: false,
                showTitle: false,
                showInstrumental: false,
                showTags: false,
                showVoice: false,
                showSpeed: false,
                showLyrics: true,
                showStyle: false,
                styleRequired: false,
                audioSlots: { min: 1, max: 1 },
                speedMin: 1,
                speedMax: 1,
                speedPresets: [],
            };
        }
        if (family === "music-text") {
            return {
                source: "runninghub-music-text",
                voices: [],
                formats: MUSIC_AUDIO_FORMATS,
                emotions: [],
                showFormat: true,
                showInstructions: false,
                showEmotion: false,
                showTitle: false,
                showInstrumental: false,
                showTags: false,
                showVoice: false,
                showSpeed: false,
                showLyrics: false,
                showStyle: true,
                styleRequired: model.toLowerCase().includes("music-2.5"),
                speedMin: 1,
                speedMax: 1,
                speedPresets: [],
            };
        }
        if (family === "voice-clone") {
            return {
                source: "runninghub-voice-clone",
                voices: [],
                formats: [{ value: "mp3", label: "MP3" }],
                emotions: [],
                cloneModels: VOICE_CLONE_MODELS,
                showFormat: false,
                showInstructions: false,
                showEmotion: false,
                showTitle: false,
                showInstrumental: false,
                showTags: false,
                showVoice: false,
                showSpeed: false,
                showLyrics: false,
                showStyle: false,
                showCloneModel: true,
                showNoiseReduction: true,
                styleRequired: false,
                audioSlots: { min: 1, max: 1 },
                speedMin: 1,
                speedMax: 1,
                speedPresets: [],
            };
        }
        return unsupportedSchema("unsupportedRunninghub");
    }

    if (request.apiFormat === "openai") {
        return {
            source: "openai",
            voices: OPENAI_AUDIO_VOICES,
            formats: OPENAI_AUDIO_FORMATS,
            emotions: [],
            showFormat: true,
            showInstructions: supportsOpenAiAudioInstructions(model),
            showEmotion: false,
            showTitle: false,
            showInstrumental: false,
            showTags: false,
            showVoice: true,
            showSpeed: true,
            showLyrics: false,
            showStyle: false,
            styleRequired: false,
            speedMin: 0.25,
            speedMax: 4,
            speedPresets: ["0.75", "1", "1.25", "1.5"],
        };
    }

    if (request.apiFormat === "gemini") return unsupportedSchema("unsupportedGemini");
    if (request.apiFormat === "linkfox") return unsupportedSchema("unsupportedLinkfox");
    if (request.apiFormat === "ark") return unsupportedSchema("unsupportedArk");
    return unsupportedSchema("unsupportedGeneric");
}

function unsupportedSchema(messageKey: string): AudioSettingSchema {
    return {
        source: "unsupported",
        voices: [],
        formats: [],
        emotions: [],
        showFormat: false,
        showInstructions: false,
        showEmotion: false,
        showTitle: false,
        showInstrumental: false,
        showTags: false,
        showVoice: false,
        showSpeed: false,
        showLyrics: false,
        showStyle: false,
        styleRequired: false,
        speedMin: 1,
        speedMax: 1,
        speedPresets: [],
        messageKey,
    };
}

export function normalizeMusicAudioFormat(value: string) {
    return MUSIC_AUDIO_FORMATS.some((item) => item.value === value) ? value : "mp3";
}

export function normalizeVoiceCloneModel(value: string) {
    return VOICE_CLONE_MODELS.some((item) => item.value === value) ? value : VOICE_CLONE_MODELS[0].value;
}

/** RunningHub voice-clone 要求：≥8 位、字母开头、同时含字母与数字。 */
export function makeVoiceCloneCustomId() {
    return `IC${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeAudioVoiceForSchema(schema: AudioSettingSchema, value: string) {
    if (!schema.voices.length) return value || "";
    return schema.voices.some((item) => item.value === value) ? value : schema.voices[0].value;
}

export function normalizeAudioFormatForSchema(schema: AudioSettingSchema, value: string) {
    if (!schema.formats.length) return "mp3";
    return schema.formats.some((item) => item.value === value) ? value : schema.formats[0].value;
}

export function normalizeAudioSpeedForSchema(schema: AudioSettingSchema, value: string) {
    const speed = Number(value);
    if (!Number.isFinite(speed)) return "1";
    return String(Math.max(schema.speedMin, Math.min(schema.speedMax, Number(speed.toFixed(2)))));
}

export function normalizeAudioEmotionValue(value: string) {
    return (MINIMAX_AUDIO_EMOTION_VALUES as readonly string[]).includes(value) ? value : "happy";
}

export function normalizeAudioInstrumentalValue(value: string | undefined) {
    return value === "true" ? "true" : "false";
}
