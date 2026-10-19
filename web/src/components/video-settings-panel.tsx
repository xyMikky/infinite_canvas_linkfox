import { type ReactNode } from "react";
import { Switch } from "antd";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { linkfoxVideoFirstLast, linkfoxVideoModel, linkfoxVideoParams } from "@/lib/linkfox-video";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { analyzeSecondsControl, resolveVideoSettingSchema, type VideoSettingSchema, type VideoSizeOption } from "@/lib/canvas/video-setting-schema";
import { boolConfig, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceDurationOptions, seedancePixelLabel, seedanceRatioOptions, seedanceResolutionOptions } from "@/lib/seedance-video";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { type AiConfig } from "@/stores/use-config-store";

function sizeLabel(labelKey: string) {
    return i18n.t(`settingsPanels.video.${labelKey}`);
}

const seedanceRatioLabelKeys: Record<string, string> = {
    "16:9": "landscape",
    "9:16": "portrait",
    "1:1": "square",
    "4:3": "standardLandscape",
    "3:4": "standardPortrait",
    "21:9": "cinematic",
    adaptive: "adaptive",
};

const FALLBACK_SIZES: VideoSizeOption[] = [
    { value: "1280x720", labelKey: "sizes.landscape", width: 1280, height: 720 },
    { value: "720x1280", labelKey: "sizes.portrait", width: 720, height: 1280 },
    { value: "1024x1024", labelKey: "sizes.square", width: 1024, height: 1024 },
    { value: "1792x1024", labelKey: "sizes.widescreen", width: 1792, height: 1024 },
    { value: "1024x1792", labelKey: "sizes.tall", width: 1024, height: 1792 },
    { value: "auto", labelKey: "sizes.auto", width: 0, height: 0 },
];

export const videoResolutionOptions = [
    { value: "720", label: "720p" },
    { value: "480", label: "480p" },
];
export const videoSizeOptions = FALLBACK_SIZES.map((item) => ({
    value: item.value,
    get label() {
        return sizeLabel(item.labelKey);
    },
}));
export const videoSecondOptions = ["6", "10", "12", "16", "20"];

type VideoSettingsPanelProps = {
    localEdit?: boolean;
    config: AiConfig;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark" | "videoRealPersonMode" | "videoReferenceMode", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, localEdit = false, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    const schema = resolveVideoSettingSchema(config);
    if (localEdit) return <div className={className} style={{ color: theme.node.text }}>
        <div className="text-sm font-semibold">局部视频生成参数</div>
        <SettingGroup title="输出分辨率" color={theme.node.muted}>
            {schema.resolutions.length ? <div className="grid grid-cols-3 gap-2">
                {schema.resolutions.map(item => <OptionPill key={item.value} selected={pickResolution(schema, config.vquality) === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>{item.label}</OptionPill>)}
            </div> : <div className="text-xs" style={{ color: theme.node.muted }}>当前模型的输出分辨率由模型决定</div>}
        </SettingGroup>
        <div className="space-y-2 text-xs leading-5" style={{ color: theme.node.muted }}>
            <p className="m-0">24fps · {config.videoSeconds} 秒 · 比例跟随选区 · 使用原片音轨</p>
            <p className="m-0">分辨率用于 AI 生成。贴回时逐帧缩放至对应选区，最终视频保持原片分辨率；时长由预处理选段决定。</p>
        </div>
    </div>;
    if (schema.source === "seedance" || isSeedanceVideoConfig(config)) {
        return <SeedanceVideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
    }

    const linkfox = schema.source === "linkfox" ? linkfoxVideoModel(config.model || config.videoModel) : undefined;
    const params = linkfox ? linkfoxVideoParams(linkfox, config) : undefined;
    const seconds = params ? String(params.videoTime) : pickSeconds(schema, config.videoSeconds);
    const size = params ? params.aspectRatio || "adaptive" : pickSize(schema, config.size);
    const dimensions = readSizeDimensions(size);
    const resolution = pickResolution(schema, config.vquality);
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
        onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
    };

    const resolutionCount = schema.resolutions.length + (schema.allowCustomResolution ? 1 : 0);
    const resolutionCols = resolutionCount <= 1 ? "grid-cols-1" : resolutionCount === 2 ? "grid-cols-2" : resolutionCount === 4 ? "grid-cols-4" : "grid-cols-3";

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}

                {linkfox?.lastFrame ? <SettingGroup title={t("linkfoxVideo.referenceMode")} color={theme.node.muted}>
                    {!linkfox.firstLastOnly ? <div className="grid grid-cols-2 gap-2">
                        <OptionPill selected={!linkfoxVideoFirstLast(linkfox, config.videoReferenceMode)} theme={theme} onClick={() => onConfigChange("videoReferenceMode", "reference")}>{t("linkfoxVideo.multiReference")}</OptionPill>
                        <OptionPill selected={linkfoxVideoFirstLast(linkfox, config.videoReferenceMode)} theme={theme} onClick={() => onConfigChange("videoReferenceMode", "firstLastFrame")}>{t("linkfoxVideo.firstLastFrame")}</OptionPill>
                    </div> : null}
                    {linkfoxVideoFirstLast(linkfox, config.videoReferenceMode) ? <p className="m-0 text-xs" style={{ color: theme.node.muted }}>{t("linkfoxVideo.frameHint")}</p> : null}
                </SettingGroup> : null}

                {schema.resolutions.length || schema.allowCustomResolution ? (
                    <SettingGroup title={t("settingsPanels.video.quality")} color={theme.node.muted}>
                        <div className={`grid gap-2.5 ${resolutionCols}`}>
                            {schema.resolutions.map((item) => (
                                <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                    {item.label}
                                </OptionPill>
                            ))}
                            {schema.allowCustomResolution ? <ResolutionInput value={resolution} theme={theme} onChange={(value) => onConfigChange("vquality", value)} /> : null}
                        </div>
                    </SettingGroup>
                ) : null}

                {schema.sizes.length || schema.allowCustomDimensions ? (
                    <SettingGroup title={t("settingsPanels.video.size")} color={theme.node.muted}>
                        {schema.allowCustomDimensions ? (
                            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                                <DimensionInput prefix="W" value={dimensions.width} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("width", value)} />
                                <span className="text-lg opacity-45">↔</span>
                                <DimensionInput prefix="H" value={dimensions.height} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("height", value)} />
                            </div>
                        ) : null}
                        {schema.sizes.length ? (
                            <div className={`grid gap-2.5 ${schema.sizes.length <= 2 ? "grid-cols-2" : "grid-cols-3"}`}>
                                {schema.sizes.map((item) => (
                                    <button
                                        key={item.value}
                                        type="button"
                                        className="flex h-[78px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                        style={{ borderColor: size === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                        onMouseDown={(event) => event.stopPropagation()}
                                        onClick={() => onConfigChange("size", item.value)}
                                    >
                                        <SizePreview width={item.width} height={item.height} color={theme.node.text} />
                                        <span>{sizeLabel(item.labelKey)}</span>
                                        {item.value === "auto" || item.value === "adaptive" ? null : <span className="text-[11px] leading-none opacity-55">{item.value}</span>}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </SettingGroup>
                ) : null}

                {schema.seconds.length || schema.allowCustomSeconds ? (
                    <SettingGroup title={t("settingsPanels.video.seconds")} color={theme.node.muted}>
                        <SecondsControl
                            options={schema.seconds}
                            value={seconds}
                            theme={theme}
                            allowCustom={schema.allowCustomSeconds}
                            customMin={schema.secondsMin ?? 1}
                            customMax={schema.secondsMax ?? 20}
                            onChange={(value) => onConfigChange("videoSeconds", value)}
                        />
                    </SettingGroup>
                ) : null}

                {schema.showGenerateAudio || schema.showWatermark || schema.showRealPersonMode ? (
                    <SettingGroup title={t("settingsPanels.video.output")} color={theme.node.muted}>
                        <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                            {schema.showGenerateAudio ? (
                                <SwitchRow
                                    label={t("settingsPanels.video.generateAudio")}
                                    checked={boolConfig(config.videoGenerateAudio, true)}
                                    theme={theme}
                                    onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))}
                                />
                            ) : null}
                            {schema.showRealPersonMode ? (
                                <SwitchRow
                                    label={t("settingsPanels.video.realPersonMode")}
                                    checked={boolConfig(config.videoRealPersonMode, true)}
                                    theme={theme}
                                    onChange={(checked) => onConfigChange("videoRealPersonMode", String(checked))}
                                />
                            ) : null}
                            {schema.showWatermark ? (
                                <SwitchRow
                                    label={t("settingsPanels.video.watermark")}
                                    checked={boolConfig(config.videoWatermark, false)}
                                    theme={theme}
                                    onChange={(checked) => onConfigChange("videoWatermark", String(checked))}
                                />
                            ) : null}
                        </div>
                    </SettingGroup>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

function SeedanceVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    const resolution = normalizeSeedanceResolution(config.vquality);
    const ratio = normalizeSeedanceRatio(config.size);
    const duration = normalizeSeedanceDuration(config.videoSeconds);
    const generateAudio = boolConfig(config.videoGenerateAudio, true);
    const watermark = boolConfig(config.videoWatermark, false);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.video.title")}</div> : null}
                <SettingGroup title={t("settingsPanels.video.resolution")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {seedanceResolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.ratio")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {seedanceRatioOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 text-sm transition hover:opacity-80"
                                style={{ borderColor: ratio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", item.value)}
                            >
                                <SizePreview width={ratioPreview(item.value).width} height={ratioPreview(item.value).height} color={theme.node.text} />
                                <span>{i18n.t(`settingsPanels.video.ratios.${seedanceRatioLabelKeys[item.value]}`)}</span>
                                <span className="text-[10px] leading-none opacity-55">{item.value === "adaptive" ? "adaptive" : seedancePixelLabel(resolution, item.value)}</span>
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.duration")} color={theme.node.muted}>
                    <SecondsControl options={[...seedanceDurationOptions]} value={String(duration)} theme={theme} onChange={(value) => onConfigChange("videoSeconds", value)} />
                </SettingGroup>
                <SettingGroup title={t("settingsPanels.video.output")} color={theme.node.muted}>
                    <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                        <SwitchRow label={t("settingsPanels.video.generateAudio")} checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                        <SwitchRow label={t("settingsPanels.video.watermark")} checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} />
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string, config?: AiConfig) {
    if (config && isSeedanceVideoConfig(config)) return normalizeSeedanceResolution(value);
    if (config) {
        const schema = resolveVideoSettingSchema(config);
        if (schema.source === "linkfox" && !schema.resolutions.length) return i18n.t("settingsPanels.video.adaptive");
        if (schema.source === "kling" || schema.source === "dreamina" || schema.source === "linkfox") {
            return pickResolution(schema, value);
        }
        const normalized = normalizeVideoResolutionValue(value);
        const hit = schema.resolutions.find((item) => item.value === normalized);
        if (hit) return hit.label;
    }
    const normalized = normalizeVideoResolutionValue(value);
    if (normalized === "native1080p" || normalized === "native4k") return normalized;
    if (normalized === "2160" || normalized === "4k") return "4k";
    if (normalized === "2k") return "2k";
    return `${normalized}p`;
}

export function videoSizeLabel(value: string, config?: AiConfig) {
    const schema = config ? resolveVideoSettingSchema(config) : undefined;
    const linkfox = schema?.source === "linkfox" && config ? linkfoxVideoModel(config.model || config.videoModel) : undefined;
    if (linkfox && config) value = linkfoxVideoParams(linkfox, { ...config, size: value }).aspectRatio || "adaptive";
    if (config && isSeedanceVideoConfig(config)) {
        const ratio = normalizeSeedanceRatio(value);
        return i18n.t(`settingsPanels.video.ratios.${seedanceRatioLabelKeys[ratio]}`);
    }
    if (value === "adaptive" || value === "auto") return i18n.t("settingsPanels.video.adaptive");
    const size = normalizeVideoSizeValue(value, schema);
    const option = (schema?.sizes.length ? schema.sizes : FALLBACK_SIZES).find((item) => item.value === size);
    return option ? sizeLabel(option.labelKey) : size;
}

export function videoSecondsLabel(value: string, config?: AiConfig) {
    if (config && resolveVideoSettingSchema(config).source === "linkfox") {
        const model = linkfoxVideoModel(config.model || config.videoModel);
        if (model) return `${linkfoxVideoParams(model, { ...config, videoSeconds: value }).videoTime}s`;
    }
    if (String(value).trim() === "-1") return i18n.t("settingsPanels.video.smart");
    if (config && isSeedanceVideoConfig(config)) return `${normalizeSeedanceDuration(value)}s`;
    if (config) {
        const picked = pickSeconds(resolveVideoSettingSchema(config), value);
        return picked === "-1" ? i18n.t("settingsPanels.video.smart") : `${picked}s`;
    }
    return `${value || "6"}s`;
}

export function normalizeVideoSizeValue(value: string, schema?: VideoSettingSchema) {
    if (value === "auto") return schema?.sizes.some((item) => item.value === "auto") ? "auto" : schema?.sizes[0]?.value || "1280x720";
    if (value === "adaptive") return schema?.sizes.some((item) => item.value === "adaptive") ? "adaptive" : schema?.sizes[0]?.value || "adaptive";
    if (schema?.sizes.length) {
        if (schema.sizes.some((item) => item.value === value)) return value;
        if (value.includes(":")) {
            const hit = schema.sizes.find((item) => item.value === value);
            if (hit) return hit.value;
        }
        const dims = value.match(/^(\d+)x(\d+)$/);
        if (dims) {
            const width = Number(dims[1]);
            const height = Number(dims[2]);
            const ratio = width / height;
            const candidates = schema.sizes.filter((item) => item.width && item.height);
            if (!candidates.length) return schema.sizes[0].value;
            return candidates.reduce((best, item) => {
                const itemRatio = item.width / item.height;
                const bestRatio = best.width / best.height;
                return Math.abs(itemRatio - ratio) < Math.abs(bestRatio - ratio) ? item : best;
            }).value;
        }
        return schema.sizes[0].value;
    }
    if (/^\d+x\d+$/.test(value || "")) return value;
    return ["9:16", "2:3", "3:4"].includes(value) ? "720x1280" : "1280x720";
}

export function normalizeVideoResolutionValue(value: string) {
    const raw = (value || "").trim().toLowerCase();
    if (raw === "native1080p" || raw === "native1080") return "native1080p";
    if (raw === "native4k" || raw === "native2160") return "native4k";
    if (raw === "480p" || raw === "low" || raw === "480") return "480";
    if (raw === "720p" || raw === "auto" || raw === "high" || raw === "medium" || raw === "720") return "720";
    if (raw === "1080p" || raw === "1080") return "1080";
    if (raw === "2k") return "2k";
    if (raw === "4k" || raw === "2160p" || raw === "2160") return "4k";
    return raw.replace(/p$/i, "") || "720";
}

function pickResolution(schema: VideoSettingSchema, value: string) {
    if (schema.source === "kling" || schema.source === "dreamina" || schema.source === "linkfox") {
        const raw = (value || "").trim().toLowerCase();
        const withP = /^\d+$/.test(raw) ? `${raw}p` : raw;
        const hit = schema.resolutions.find((item) => {
            const option = item.value.toLowerCase();
            return option === raw || option === withP || option.replace(/p$/i, "") === raw.replace(/p$/i, "");
        });
        return hit?.value || schema.resolutions[0]?.value || "720p";
    }
    const normalized = normalizeVideoResolutionValue(value);
    if (schema.allowCustomResolution) return normalized;
    if (schema.resolutions.some((item) => item.value === normalized)) return normalized;
    return schema.resolutions[0]?.value || "720";
}

function pickSize(schema: VideoSettingSchema, value: string) {
    return normalizeVideoSizeValue(value || "1280x720", schema);
}

function pickSeconds(schema: VideoSettingSchema, value: string) {
    if (String(value).trim() === "-1" && schema.seconds.includes(-1)) return "-1";
    if (schema.allowCustomSeconds) {
        const seconds = Math.floor(Number(value) || schema.seconds.find((item) => item > 0) || 6);
        const min = schema.secondsMin ?? 1;
        const max = schema.secondsMax ?? 20;
        return String(Math.max(min, Math.min(max, seconds)));
    }
    if (!schema.seconds.length) return String(value || "6");
    const positive = schema.seconds.filter((item) => item > 0);
    const requested = Math.floor(Number(value) || positive[0] || 5);
    const nearest = positive.reduce((best, item) => (Math.abs(item - requested) < Math.abs(best - requested) ? item : best), positive[0]);
    return String(nearest);
}

function SecondsControl({
    options,
    value,
    theme,
    allowCustom = false,
    customMin = 1,
    customMax = 20,
    onChange,
}: {
    options: number[];
    value: string;
    theme: CanvasTheme;
    allowCustom?: boolean;
    customMin?: number;
    customMax?: number;
    onChange: (value: string) => void;
}) {
    const { t } = useTranslation();
    const control = analyzeSecondsControl(options);
    const smartSelected = value === "-1";

    if (control.mode === "slider") {
        const sliderValue = smartSelected ? control.min : Math.max(control.min, Math.min(control.max, Math.floor(Number(value) || control.min)));
        return (
            <div className="flex items-center gap-2.5" onMouseDown={(event) => event.stopPropagation()}>
                {control.smart ? (
                    <OptionPill selected={smartSelected} theme={theme} onClick={() => onChange(smartSelected ? String(control.min) : "-1")}>
                        {t("settingsPanels.video.smart")}
                    </OptionPill>
                ) : null}
                <div className="min-w-0 flex-1 px-1">
                    <input
                        type="range"
                        aria-label={t("settingsPanels.video.seconds")}
                        className="w-full cursor-pointer"
                        min={control.min}
                        max={control.max}
                        step={1}
                        disabled={smartSelected}
                        value={sliderValue}
                        onChange={(event) => onChange(event.target.value)}
                        style={{ accentColor: theme.node.text }}
                    />
                </div>
                <span className="w-10 shrink-0 text-right text-sm tabular-nums" style={{ color: smartSelected ? theme.node.muted : theme.node.text }}>
                    {smartSelected ? "—" : `${sliderValue}s`}
                </span>
            </div>
        );
    }

    const cols = control.options.length <= 1 ? "grid-cols-1" : control.options.length === 2 ? "grid-cols-2" : control.options.length >= 4 ? "grid-cols-4" : "grid-cols-3";
    return (
        <div className={`grid gap-2.5 ${cols}`}>
            {control.options.map((item) => (
                <OptionPill key={item} selected={value === String(item)} theme={theme} onClick={() => onChange(String(item))}>
                    {item === -1 ? t("settingsPanels.video.smart") : `${item}s`}
                </OptionPill>
            ))}
            {allowCustom ? <NumberInput value={value === "-1" ? String(customMin) : value} min={customMin} max={customMax} suffix="s" theme={theme} onChange={onChange} /> : null}
        </div>
    );
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" disabled={disabled} className="h-9 shrink-0 cursor-pointer rounded-full border px-2.5 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35" style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
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

function ResolutionInput({ value, theme, onChange }: { value: string; theme: CanvasTheme; onChange: (value: string) => void }) {
    return (
        <label className="flex h-9 items-center justify-center gap-0.5 overflow-hidden rounded-full border px-2 text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input
                type="number"
                min={1}
                className="w-12 bg-transparent text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onMouseDown={(event) => event.stopPropagation()}
            />
            <span className="shrink-0" style={{ color: theme.node.muted }}>
                p
            </span>
        </label>
    );
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input type="number" min={1} disabled={disabled} className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value || ""} onChange={(event) => onChange(Number(event.target.value) || null)} onMouseDown={(event) => event.stopPropagation()} />
        </label>
    );
}

function NumberInput({ value, min, max, suffix, theme, onChange }: { value: string; min: number; max: number; suffix?: string; theme: CanvasTheme; onChange: (value: string) => void }) {
    if (!suffix) {
        return (
            <input
                type="number"
                min={min}
                max={max}
                className="h-9 rounded-full border bg-transparent px-3 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                style={{ borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onMouseDown={(event) => event.stopPropagation()}
            />
        );
    }

    return (
        <label className="flex h-9 items-center justify-center gap-0.5 overflow-hidden rounded-full border px-2 text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input
                type="number"
                min={min}
                max={max}
                className="w-10 bg-transparent text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onMouseDown={(event) => event.stopPropagation()}
            />
            <span className="shrink-0" style={{ color: theme.node.muted }}>
                {suffix}
            </span>
        </label>
    );
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}

function ratioPreview(ratio: string) {
    if (ratio === "9:16") return { width: 9, height: 16 };
    if (ratio === "1:1") return { width: 1, height: 1 };
    if (ratio === "4:3") return { width: 4, height: 3 };
    if (ratio === "3:4") return { width: 3, height: 4 };
    if (ratio === "21:9") return { width: 21, height: 9 };
    if (ratio === "adaptive") return { width: 0, height: 0 };
    return { width: 16, height: 9 };
}

function SwitchRow({ label, checked, theme, onChange }: { label: string; checked: boolean; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex h-8 items-center justify-between gap-3">
            <span className="text-sm" style={{ color: theme.node.text }}>
                {label}
            </span>
            <span onMouseDown={(event) => event.stopPropagation()}>
                <Switch size="small" checked={checked} onChange={onChange} />
            </span>
        </div>
    );
}

function readSizeDimensions(size: string) {
    if (size === "auto") return { width: 0, height: 0 };
    const match = size.match(/^(\d+)x(\d+)$/);
    return { width: Number(match?.[1]) || 1280, height: Number(match?.[2]) || 720 };
}
