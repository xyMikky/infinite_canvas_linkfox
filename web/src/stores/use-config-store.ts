import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { persistAgentIoDirs } from "@/lib/canvas/agent-io-paths";
import { localizeRunninghubModelLabel } from "@/lib/runninghub-model-label";
import { LINKFOX_IMAGE_MODEL_SPECS } from "@/lib/linkfox-image";
import { LINKFOX_V3_VIDEO_MODELS } from "@/lib/linkfox-video";
import { RUNNINGHUB_MODELS as RUNNINGHUB_MODEL_DEFS, RUNNINGHUB_CN_MODELS } from "@/services/api/runninghub-models";

export type ApiCallFormat = "openai" | "gemini" | "ark" | "linkfox" | "runninghub";
export type ModelCapability = "image" | "video" | "text" | "audio" | "model";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";

export type ChannelModel = {
    name: string;
    capability: ModelCapability;
    /** 选择器展示名；缺省时回退为 name（RunningHub 等用 name_en）。 */
    label?: string;
    script?: string;
    klingTools?: string[];
    klingArguments?: Array<{ name: string; required?: boolean; default?: string; allowedValues?: string[]; description?: string }>;
    /** 按 CLI 工具拆分的参数规格；生成时优先用对应工具，避免文生/图生规格互相覆盖。 */
    klingArgsByTool?: Record<string, Array<{ name: string; required?: boolean; default?: string; allowedValues?: string[]; description?: string }>>;
    dreaminaTools?: string[];
    dreaminaResolutions?: string[];
    dreaminaRatios?: string[];
    dreaminaDurationMin?: number;
    dreaminaDurationMax?: number;
};

export const LINKFOX_IMAGE_MODELS: ChannelModel[] = LINKFOX_IMAGE_MODEL_SPECS.map(({ name, label }) => ({ name, label, capability: "image" as const }));

export const LINKFOX_VIDEO_MODELS: ChannelModel[] = [
    ...LINKFOX_V3_VIDEO_MODELS.map(({ name, label }) => ({ name, label, capability: "video" as const })),
    { name: "KLING", capability: "video" },
    { name: "WAN", capability: "video" },
    { name: "SEED", capability: "video" },
    { name: "SEED_FAST", capability: "video" },
    { name: "HAILUO", capability: "video" },
    { name: "HAPPY_HORSE", capability: "video" },
];

export const LINKFOX_TEXT_MODELS: ChannelModel[] = [
    { name: "GEM_3_7_FLASH", label: "Gemini 3.7 Flash", capability: "text" },
    { name: "GEM_3_1_PRO", label: "Gemini 3.1 Pro", capability: "text" },
    { name: "GT_6_1_S", label: "GPT · 复杂分析", capability: "text" },
    { name: "GT_6_L", label: "GPT · 轻量", capability: "text" },
    { name: "GT_6_A", label: "GPT · 深度分析", capability: "text" },
    { name: "GEM_3_FLASH", label: "Gemini 3 Flash · 原网关", capability: "text" },
];

/** LinkFox 渠道默认模型（图 / 视频 / 文）。 */
export const LINKFOX_MODELS: ChannelModel[] = [...LINKFOX_IMAGE_MODELS, ...LINKFOX_VIDEO_MODELS, ...LINKFOX_TEXT_MODELS];

export const RUNNINGHUB_CHANNEL_ID = "runninghub";
export const RUNNINGHUB_BASE_URL = "/api/runninghub";
/** RunningHub 中国站：供 RH 综合节点等国内 OpenAPI 使用，与国际站密钥/代理分离 */
export const RUNNINGHUB_CN_CHANNEL_ID = "runninghub-cn";
export const RUNNINGHUB_CN_BASE_URL = "/api/runninghub-cn";
/** 中国站共享 API Key，新安装默认写入，用户无需单独配置 */
export const RUNNINGHUB_CN_DEFAULT_API_KEY = "aa47c979d87f4498935d8eb0b02d0743";

/** RunningHub 国际版全量模型：name 为 endpoint，label 为插件 registry 的 name_en（params 不入库，按需从 registry 查）。 */
export const RUNNINGHUB_MODELS: ChannelModel[] = RUNNINGHUB_MODEL_DEFS.map(({ name, label, capability }) => ({ name, label, capability }));

export function createRunninghubChannel(apiKey = ""): ModelChannel {
    return {
        id: RUNNINGHUB_CHANNEL_ID,
        name: i18n.t("config.channels.runninghubName"),
        baseUrl: RUNNINGHUB_BASE_URL,
        apiKey,
        apiFormat: "runninghub",
        models: RUNNINGHUB_MODELS.map(({ name, label, capability }) => ({ name, label, capability })),
    };
}

export function createRunninghubCnChannel(apiKey = RUNNINGHUB_CN_DEFAULT_API_KEY): ModelChannel {
    return {
        id: RUNNINGHUB_CN_CHANNEL_ID,
        name: i18n.t("config.channels.runninghubCnName"),
        baseUrl: RUNNINGHUB_CN_BASE_URL,
        apiKey: apiKey || RUNNINGHUB_CN_DEFAULT_API_KEY,
        apiFormat: "runninghub",
        models: RUNNINGHUB_CN_MODELS.map(({ name, label, capability }) => ({ name, label, capability })),
    };
}

export const CODEX_CHANNEL_ID = "codex";
export const CODEX_CLI_MODEL_NAME = "Codex CLI";
export const CODEX_TEXT_MODEL_VALUE = `${CODEX_CHANNEL_ID}::${CODEX_CLI_MODEL_NAME}`;
export const CODEX_TEXT_MODELS: ChannelModel[] = [{ name: CODEX_CLI_MODEL_NAME, capability: "text" }];

export function createCodexChannel(): ModelChannel {
    return {
        id: CODEX_CHANNEL_ID,
        name: i18n.t("config.channels.codexName"),
        baseUrl: "codex://cli",
        apiKey: "local",
        apiFormat: "openai",
        models: CODEX_TEXT_MODELS.map((model) => ({ ...model })),
    };
}

export function isCodexCliTextModel(value: string | undefined) {
    const raw = (value || "").trim();
    if (!raw) return false;
    if (raw === CODEX_TEXT_MODEL_VALUE || raw === CODEX_CLI_MODEL_NAME) return true;
    const decoded = decodeChannelModel(raw);
    return decoded?.channelId === CODEX_CHANNEL_ID;
}

export const KLING_CHANNEL_ID = "kling-cn";
export const KLING_BASE_URL = "kling://cli";

export function createKlingChannel(models: ChannelModel[] = []): ModelChannel {
    return {
        id: KLING_CHANNEL_ID,
        name: i18n.t("config.channels.klingName"),
        baseUrl: KLING_BASE_URL,
        apiKey: "oauth",
        apiFormat: "openai",
        models,
    };
}

export function isKlingModel(value: string | undefined) {
    const decoded = decodeChannelModel((value || "").trim());
    return decoded?.channelId === KLING_CHANNEL_ID;
}

export const DREAMINA_CHANNEL_ID = "dreamina-cn";
export const DREAMINA_BASE_URL = "dreamina://cli";

export function createDreaminaChannel(models: ChannelModel[] = []): ModelChannel {
    return {
        id: DREAMINA_CHANNEL_ID,
        name: i18n.t("config.channels.dreaminaName"),
        baseUrl: DREAMINA_BASE_URL,
        apiKey: "oauth",
        apiFormat: "openai",
        models,
    };
}

export function isDreaminaModel(value: string | undefined) {
    const decoded = decodeChannelModel((value || "").trim());
    return decoded?.channelId === DREAMINA_CHANNEL_ID;
}

/** 音频、3D，以及已移除平台上的旧模型，不能再发起对应渠道请求。 */
export function closedGenerationNotice(model: string | undefined, capability?: ModelCapability): "audio" | "model" | "retired" | null {
    if (capability === "audio") return "audio";
    if (capability === "model") return "model";
    const raw = (model || "").trim();
    if (!raw) return null;
    const decoded = decodeChannelModel(raw);
    if (decoded) {
        if (decoded.channelId === "default" || decoded.channelId === "linkfox" || decoded.channelId === RUNNINGHUB_CN_CHANNEL_ID) return null;
        return "retired";
    }
    if (isCodexCliTextModel(raw) || isKlingModel(raw) || isDreaminaModel(raw)) return "retired";
    if (RUNNINGHUB_MODELS.some((item) => item.name === raw)) return "retired";
    return null;
}

export function closedGenerationError(model: string | undefined, capability?: ModelCapability) {
    const notice = closedGenerationNotice(model, capability);
    if (notice === "audio") return new Error(i18n.t("apiErrors.audioGenerationUnavailable"));
    if (notice === "model") return new Error(i18n.t("apiErrors.modelGenerationUnavailable"));
    if (notice === "retired") return new Error(i18n.t("apiErrors.retiredPlatformModel"));
    return null;
}

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    models: ChannelModel[];
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    modelModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    audioEmotion: string;
    audioTitle: string;
    audioInstrumental: string;
    audioTags: string;
    audioLyrics: string;
    audioStyle: string;
    audioCloneModel: string;
    audioNoiseReduction: string;
    audioVolumeNormalization: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoReferenceMode?: string;
    videoWatermark: string;
    /** Seedance / RunningHub：真人素材模式（参考图含真人时需开启） */
    videoRealPersonMode: string;
    systemPrompt: string;
    reasoningEffort: ReasoningEffort;
    models: string[];
    quality: string;
    size: string;
    background: string;
    /** RunningHub/Midjourney 等模型扩展参数（chaos、stylize、raw…）。 */
    modelParams: Record<string, string | number | boolean>;
    count: string;
    canvasImageCount: string;
    /** 画布数据目录：复制的文件夹等落地路径（桌面端绝对路径）；Agent 的 input/output 也在此目录下。 */
    canvasDataDir: string;
    /** 拖入文件夹时复制到数据目录的大小上限（MB）；超出则仅引用本机路径。 */
    folderCopyMaxMb: number;
    /** 桌面版是否把界面服务监听开放到局域网。 */
    lanShareEnabled: boolean;
};

export type WebdavSyncConfig = {
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};
export type ConfigTabKey = "channels" | "preferences" | "prompt-sources" | "webdav" | "local-storage";

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = "https://api.openai.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
const ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
export const LINKFOX_BASE_URL = "/api/linkfox";
const LINKFOX_UPSTREAM = "https://tool-gateway.linkfox.com";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: LINKFOX_BASE_URL,
    apiKey: "",
    apiFormat: "linkfox",
    channels: [
        {
            id: "default",
            name: i18n.t("config.channels.linkfoxName"),
            baseUrl: LINKFOX_BASE_URL,
            apiKey: "",
            apiFormat: "linkfox",
            models: LINKFOX_MODELS.map((model) => ({ ...model })),
        },
        createRunninghubCnChannel(),
    ],
    model: `default::${LINKFOX_IMAGE_MODELS[0].name}`,
    imageModel: `default::${LINKFOX_IMAGE_MODELS[0].name}`,
    videoModel: `default::${LINKFOX_VIDEO_MODELS[0].name}`,
    textModel: `default::${LINKFOX_TEXT_MODELS[0].name}`,
    audioModel: "",
    modelModel: "",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    audioEmotion: "happy",
    audioTitle: "",
    audioInstrumental: "false",
    audioTags: "",
    audioLyrics: "",
    audioStyle: "",
    audioCloneModel: "speech-02-hd",
    audioNoiseReduction: "false",
    audioVolumeNormalization: "false",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    videoRealPersonMode: "true",
    systemPrompt: "",
    reasoningEffort: "auto",
    models: [
        ...LINKFOX_MODELS.map((model) => `default::${model.name}`),
        ...RUNNINGHUB_CN_MODELS.map((model) => `${RUNNINGHUB_CN_CHANNEL_ID}::${model.name}`),
    ],
    quality: "medium",
    size: "1:1",
    background: "",
    modelParams: {},
    count: "1",
    canvasImageCount: "3",
    canvasDataDir: "",
    folderCopyMaxMb: 500,
    lanShareEnabled: false,
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    url: "",
    username: "",
    password: "",
    directory: "infinite-canvas",
    lastSyncedAt: "",
};

type ConfigStore = {
    config: AiConfig;
    webdav: WebdavSyncConfig;
    /** 已收藏的渠道模型，值为 `channelId::modelName`。 */
    favoriteModels: string[];
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    toggleFavoriteModel: (value: string) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

export function sanitizeFavoriteModels(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of value) {
        if (typeof item !== "string") continue;
        const trimmed = item.trim();
        if (!trimmed || seen.has(trimmed)) continue;
        seen.add(trimmed);
        result.push(trimmed);
    }
    return result;
}

const VIDEO_KEYWORDS = ["seedance", "video", "sora", "veo", "kling", "wan", "hailuo"];
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "music", "sound"];
const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney"];

/** Best-effort default capability for a freshly fetched model name; user can override in the channel editor. */
export function guessCapability(name: string): ModelCapability {
    const known =
        LINKFOX_MODELS.find((model) => model.name.toLowerCase() === name.trim().toLowerCase()) ||
        [...RUNNINGHUB_MODELS, ...RUNNINGHUB_CN_MODELS].find((model) => model.name.toLowerCase() === name.trim().toLowerCase());
    if (known) return known.capability;
    const value = name.toLowerCase();
    if (value.includes("video") || value.includes("to-video") || VIDEO_KEYWORDS.some((keyword) => value.includes(keyword)) || value.includes("happy_horse")) return "video";
    if (value.includes("to-3d") || value.includes("to-world") || value.includes("hitem3d") || value.includes("hunyuan3d") || value.includes("meshy")) return "model";
    if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
    if (value.includes("image") || value.includes("to-image") || value.includes("/edit") || IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    if (value.includes("text") || value.includes("chat")) return "text";
    return "text";
}

function findChannelModel(config: AiConfig, value: string): { channel: ModelChannel; model: ChannelModel } | null {
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || value;
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === name));
    const model = channel?.models.find((item) => item.name === name);
    return channel && model ? { channel, model } : null;
}

export function resolveChannelModel(config: AiConfig, value: string) {
    return findChannelModel(config, value)?.model || null;
}

export function modelCapabilityOf(config: AiConfig, value: string): ModelCapability | undefined {
    return findChannelModel(config, value)?.model.capability;
}

export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    if (!capability) return true;
    return modelCapabilityOf(config, value) === capability;
}

export function resolveModelForCapability(config: AiConfig, currentModel: string | undefined, capability: ModelCapability) {
    const defaultModel =
        capability === "image"
            ? config.imageModel
            : capability === "video"
              ? config.videoModel
              : capability === "audio"
                ? config.audioModel
                : capability === "model"
                  ? config.modelModel
                  : config.textModel;
    const fallbackModel =
        capability === "image"
            ? defaultConfig.imageModel
            : capability === "video"
              ? defaultConfig.videoModel
              : capability === "audio"
                ? defaultConfig.audioModel
                : capability === "model"
                  ? defaultConfig.modelModel
                  : defaultConfig.textModel;
    return readyModelForCapability(config, currentModel, capability)
        || readyModelForCapability(config, defaultModel, capability)
        || fallbackModel;
}

function readyModelForCapability(config: AiConfig, value: string | undefined, capability: ModelCapability) {
    const model = (value || "").trim();
    if (!model || !modelMatchesCapability(config, model, capability)) return "";
    return model;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config.channels.flatMap((channel) => channel.models.filter((model) => model.capability === capability).map((model) => encodeChannelModel(channel.id, model.name)));
}

/** The user script (if any) attached to a model; empty string means use the system default call. */
export function resolveModelScript(config: AiConfig, value: string) {
    return findChannelModel(config, value)?.model.script?.trim() || "";
}

function isAiConfigReady(config: AiConfig, model: string) {
    if (closedGenerationNotice(model)) return false;
    const channel = resolveModelChannel(config, model);
    return Boolean(model.trim() && channel.baseUrl.trim() && channel.apiKey.trim());
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            webdav: defaultWebdavSyncConfig,
            favoriteModels: [],
            isConfigOpen: false,
            configTab: "channels",
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            updateWebdavConfig: (key, value) =>
                set((state) => ({
                    webdav: {
                        ...state.webdav,
                        [key]: value,
                    },
                })),
            toggleFavoriteModel: (value) =>
                set((state) => {
                    const model = value.trim();
                    if (!model) return state;
                    const exists = state.favoriteModels.includes(model);
                    return { favoriteModels: exists ? state.favoriteModels.filter((item) => item !== model) : [...state.favoriteModels, model] };
                }),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false, configTab = "channels") => set({ isConfigOpen: true, shouldPromptContinue, configTab }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            partialize: (state) => ({
                config: { ...state.config, lanShareEnabled: false },
                webdav: state.webdav,
                favoriteModels: state.favoriteModels,
            }),
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = { ...(persistedState.config || {}) } as Partial<AiConfig> & { inputFilePath?: string; outputFilePath?: string };
                delete persistedConfig.inputFilePath;
                delete persistedConfig.outputFilePath;
                const persistedWebdav = (persistedState.webdav || {}) as Partial<WebdavSyncConfig>;
                const config = sanitizeAiConfig({ ...defaultConfig, ...persistedConfig, channels: Array.isArray(persistedConfig.channels) ? persistedConfig.channels : [] });
                return {
                    ...current,
                    webdav: { ...defaultWebdavSyncConfig, ...persistedWebdav },
                    favoriteModels: filterFavoriteModels(persistedState.favoriteModels, config.channels),
                    config: {
                        ...config,
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        audioInstructions: config.audioInstructions || "",
                        audioEmotion: config.audioEmotion || defaultConfig.audioEmotion,
                        audioTitle: config.audioTitle || "",
                        audioInstrumental: config.audioInstrumental === "true" ? "true" : "false",
                        audioTags: config.audioTags || "",
                        audioLyrics: config.audioLyrics || "",
                        audioStyle: config.audioStyle || "",
                        audioCloneModel: config.audioCloneModel || defaultConfig.audioCloneModel,
                        audioNoiseReduction: config.audioNoiseReduction === "true" ? "true" : "false",
                        audioVolumeNormalization: config.audioVolumeNormalization === "true" ? "true" : "false",
                        reasoningEffort: config.reasoningEffort || "auto",
                        videoSeconds: config.videoSeconds || "6",
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || "true",
                        videoWatermark: config.videoWatermark || "false",
                        videoRealPersonMode: config.videoRealPersonMode || "true",
                        canvasImageCount: config.canvasImageCount || "3",
                        lanShareEnabled: current.config.lanShareEnabled === true,
                        quality: !config.quality || config.quality === "auto" ? "medium" : config.quality,
                        size: config.size || defaultConfig.size,
                        count: config.count || defaultConfig.count,
                    },
                };
            },
        },
    ),
);

// 启动后写回已清理的渠道列表，去掉空 OpenAI 占位（如「渠道 2」）
if (typeof window !== "undefined") {
    const persistCleanedChannels = () => {
        const state = useConfigStore.getState();
        const config = sanitizeAiConfig(state.config);
        const favoriteModels = filterFavoriteModels(state.favoriteModels, config.channels);
        const memoryDirty =
            JSON.stringify(state.config.channels) !== JSON.stringify(config.channels) ||
            state.config.apiKey !== config.apiKey ||
            state.config.baseUrl !== config.baseUrl ||
            state.config.apiFormat !== config.apiFormat ||
            state.config.imageModel !== config.imageModel ||
            state.config.videoModel !== config.videoModel ||
            state.config.textModel !== config.textModel ||
            state.config.audioModel !== config.audioModel ||
            state.config.modelModel !== config.modelModel ||
            state.config.model !== config.model ||
            JSON.stringify(state.favoriteModels) !== JSON.stringify(favoriteModels);
        let storageDirty = true;
        try {
            const raw = window.localStorage.getItem(CONFIG_STORE_KEY);
            const storedChannels = raw ? (JSON.parse(raw) as { state?: { config?: AiConfig } }).state?.config?.channels : undefined;
            const linkfox = storedChannels?.find((channel) => channel.apiFormat === "linkfox" || channel.id === "default");
            const china = storedChannels?.find((channel) => channel.id === RUNNINGHUB_CN_CHANNEL_ID);
            storageDirty =
                !storedChannels ||
                storedChannels.length !== 2 ||
                storedChannels.some((channel) => channel.id !== "default" && channel.id !== RUNNINGHUB_CN_CHANNEL_ID) ||
                linkfox?.baseUrl !== LINKFOX_BASE_URL ||
                linkfox?.apiFormat !== "linkfox" ||
                china?.apiKey !== RUNNINGHUB_CN_DEFAULT_API_KEY;
        } catch {
            storageDirty = true;
        }
        if (!memoryDirty && !storageDirty) return;
        useConfigStore.setState({ config, favoriteModels });
    };
    const syncDesktopIoPaths = () => {
        void persistAgentIoDirs(useConfigStore.getState().config.canvasDataDir);
    };
    const afterHydrate = () => {
        persistCleanedChannels();
        syncDesktopIoPaths();
    };
    if (useConfigStore.persist.hasHydrated()) afterHydrate();
    else useConfigStore.persist.onFinishHydration(afterHydrate);
}

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}

/** Normalize a mixed list of raw model names or model objects into deduped ChannelModel entries. */
export function normalizeChannelModels(models: Array<string | ChannelModel> | undefined): ChannelModel[] {
    const seen = new Set<string>();
    const result: ChannelModel[] = [];
    for (const item of models || []) {
        const name = (typeof item === "string" ? item : item?.name || "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const capability = typeof item === "string" ? guessCapability(name) : item.capability || guessCapability(name);
        const script = typeof item === "string" ? undefined : item.script?.trim() || undefined;
        const label = typeof item === "string" ? undefined : item.label?.trim() || undefined;
        const klingTools = typeof item === "string" ? undefined : item.klingTools?.filter(Boolean);
        const klingArguments = typeof item === "string" ? undefined : item.klingArguments?.filter((argument) => argument?.name?.trim()).map((argument) => ({ ...argument, name: argument.name.trim() }));
        const klingArgsByTool =
            typeof item === "string" || !item.klingArgsByTool
                ? undefined
                : Object.fromEntries(
                      Object.entries(item.klingArgsByTool)
                          .map(([tool, args]) => [
                              tool,
                              (args || [])
                                  .filter((argument) => argument?.name?.trim())
                                  .map((argument) => ({ ...argument, name: argument.name.trim() })),
                          ])
                          .filter(([, args]) => args.length),
                  );
        const dreaminaTools = typeof item === "string" ? undefined : item.dreaminaTools?.filter(Boolean);
        const dreaminaResolutions = typeof item === "string" ? undefined : item.dreaminaResolutions?.filter(Boolean);
        const dreaminaRatios = typeof item === "string" ? undefined : item.dreaminaRatios?.filter(Boolean);
        const dreaminaDurationMin = typeof item === "string" ? undefined : item.dreaminaDurationMin;
        const dreaminaDurationMax = typeof item === "string" ? undefined : item.dreaminaDurationMax;
        result.push({
            name,
            capability,
            script,
            label,
            klingTools,
            klingArguments,
            klingArgsByTool,
            dreaminaTools,
            dreaminaResolutions,
            dreaminaRatios,
            dreaminaDurationMin,
            dreaminaDurationMax,
        });
    }
    return result;
}

/** 合并 LinkFox 默认模型：补齐新增项，保留用户已有 capability/script。 */
export function mergeLinkfoxModels(existing: Array<string | ChannelModel> | undefined): ChannelModel[] {
    const previous = normalizeChannelModels(existing);
    const byName = new Map(previous.map((model) => [model.name, model]));
    const merged: ChannelModel[] = [];
    for (const defaults of LINKFOX_MODELS) {
        const prev = byName.get(defaults.name);
        merged.push(prev ? { ...defaults, capability: prev.capability || defaults.capability, script: prev.script } : { ...defaults });
        byName.delete(defaults.name);
    }
    for (const custom of byName.values()) merged.push(custom);
    return merged;
}

/** 合并 RunningHub 默认模型：补齐新增项，保留用户已有 capability/script；label 始终跟默认 name_en；不在默认列表中的旧项直接丢弃。 */
export function mergeRunninghubModels(existing: Array<string | ChannelModel> | undefined): ChannelModel[] {
    const previous = normalizeChannelModels(existing);
    const byName = new Map(previous.map((model) => [model.name, model]));
    const merged: ChannelModel[] = [];
    for (const defaults of RUNNINGHUB_MODELS) {
        const prev = byName.get(defaults.name);
        merged.push(
            prev
                ? { name: defaults.name, capability: prev.capability || defaults.capability, script: prev.script, label: defaults.label }
                : { name: defaults.name, capability: defaults.capability, label: defaults.label },
        );
    }
    return merged;
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || i18n.t("config.channels.newName"),
        baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
        apiKey: channel?.apiKey || "",
        apiFormat,
        models: normalizeChannelModels(channel?.models),
    };
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

/** UI 展示名：优先 ChannelModel.label，否则回退为模型 name（endpoint）。 */
export function resolveModelDisplayName(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const modelName = decoded?.model || value;
    const channel = decoded
        ? config.channels.find((item) => item.id === decoded.channelId)
        : config.channels.find((item) => item.models.some((entry) => entry.name === modelName));
    const entry = channel?.models.find((item) => item.name === modelName);
    const raw = entry?.label || modelName;
    if (channel?.apiFormat === "runninghub" || channel?.id === RUNNINGHUB_CHANNEL_ID) {
        return localizeRunninghubModelLabel(raw);
    }
    return raw;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    const display = resolveModelDisplayName(config, value);
    return channel ? `${display}（${channel.name}）` : display;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        return channel && channel.models.some((item) => item.name === decoded.model) ? model : "";
    }
    const channel = channels.find((item) => item.models.some((entry) => entry.name === model)) || channels[0];
    return channel && channel.models.some((item) => item.name === model) ? encodeChannelModel(channel.id, model) : model;
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.some((item) => item.name === model));
    return matched || config.channels[0] || createModelChannel({ id: "default", name: i18n.t("config.channels.defaultName"), baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName).map((name) => ({ name, capability: guessCapability(name) })) });
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    return {
        ...config,
        model: modelOptionName(value || config.model),
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
    };
}

function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const linkfox = persistedChannels.find((channel) => channel?.apiFormat === "linkfox" || channel?.id === "linkfox");
    return [
        createModelChannel({
            id: "default",
            name: i18n.t("config.channels.linkfoxName"),
            baseUrl: LINKFOX_BASE_URL,
            apiKey: linkfox?.apiKey || "",
            apiFormat: "linkfox",
            models: LINKFOX_MODELS.map((model) => ({ ...model })),
        }),
        createRunninghubCnChannel(),
    ];
}

function preferStoredModel(config: AiConfig, channels: ModelChannel[], value: string | undefined, capability: ModelCapability, fallback: string) {
    let normalized = (value || "").trim();
    if (normalized.startsWith("linkfox::")) normalized = normalized.replace(/^linkfox::/, "default::");
    if (!normalized || closedGenerationNotice(normalized) === "retired") return fallback;
    if (capability === "image" && (normalized.includes("gpt-image") || normalized.includes("grok-imagine") || normalized.includes("gpt-5") || normalized.includes("tts"))) return fallback;
    const option = normalizeModelOptionValue(normalized, channels);
    if (!option) return fallback;
    if (modelMatchesCapability({ ...config, channels }, option, capability)) return option;
    return fallback;
}

export function sanitizeAiConfig(input: AiConfig): AiConfig {
    const channels = normalizeChannels(input);
    const models = modelOptionsFromChannels(channels);
    const linkfox = channels.find((channel) => channel.apiFormat === "linkfox");
    return {
        ...input,
        channelMode: "local",
        baseUrl: LINKFOX_BASE_URL,
        apiKey: linkfox?.apiKey || "",
        apiFormat: "linkfox",
        channels,
        models,
        model: preferStoredModel(input, channels, input.model, "image", defaultConfig.imageModel),
        imageModel: preferStoredModel(input, channels, input.imageModel || input.model, "image", defaultConfig.imageModel),
        videoModel: preferStoredModel(input, channels, input.videoModel, "video", defaultConfig.videoModel),
        textModel: preferStoredModel(input, channels, input.textModel || input.model, "text", defaultConfig.textModel),
        audioModel: "",
        modelModel: "",
    };
}

export function filterFavoriteModels(value: unknown, channels: ModelChannel[]) {
    const allowed = new Set(modelOptionsFromChannels(channels));
    return sanitizeFavoriteModels(value).filter((item) => allowed.has(item.startsWith("linkfox::") ? item.replace(/^linkfox::/, "default::") : item));
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return GEMINI_BASE_URL;
    if (apiFormat === "ark") return ARK_BASE_URL;
    if (apiFormat === "linkfox") return LINKFOX_BASE_URL;
    if (apiFormat === "runninghub") return RUNNINGHUB_BASE_URL;
    return OPENAI_BASE_URL;
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    if (apiFormat === "gemini" || apiFormat === "ark" || apiFormat === "linkfox" || apiFormat === "runninghub") return apiFormat;
    return "openai";
}

export function defaultModelsForApiFormat(apiFormat: ApiCallFormat): ChannelModel[] {
    if (apiFormat === "linkfox") return LINKFOX_MODELS.map((model) => ({ ...model }));
    if (apiFormat === "runninghub") return RUNNINGHUB_MODELS.map(({ name, label, capability }) => ({ name, label, capability }));
    return [];
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}
