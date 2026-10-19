import { type ReactNode, useMemo, useState } from "react";
import { ConfigProvider, Switch } from "antd";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { type CanvasTheme } from "@/lib/canvas-theme";
import {
    imageSettingsSummary,
    packQualityValue,
    pickImageSchemaOption,
    readModelParam,
    resolveImageSettingSchema,
    resolveLinkfoxImageParams,
    resolveImageSize,
    unpackQualityValue,
    type ImageSettingField,
} from "@/lib/canvas/image-setting-schema";
import {
    MJ_BASE_EXCLUDED_IDS_KEY,
    MJ_SREF_ENABLED_KEY,
    MJ_SREF_IMAGE_ID_KEY,
    isMjSrefEnabled,
    resolveMjBaseImageIds,
    resolveMjSrefImageId,
    toggleMjBaseImageExcluded,
} from "@/lib/canvas/midjourney-image-refs";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import type { AiConfig } from "@/stores/use-config-store";

export type ImageSettingsReferenceOption = {
    id: string;
    label?: string;
    thumbUrl?: string;
};

const DIMENSION_STEP = 16;

const aspectIcons: Record<string, { width: number; height: number; icon: string }> = {
    "1:1": { width: 1024, height: 1024, icon: "square" },
    "3:2": { width: 1536, height: 1024, icon: "landscape" },
    "2:3": { width: 1024, height: 1536, icon: "portrait" },
    "4:3": { width: 1360, height: 1024, icon: "landscape" },
    "3:4": { width: 1024, height: 1360, icon: "portrait" },
    "16:9": { width: 1824, height: 1024, icon: "landscape" },
    "9:16": { width: 1024, height: 1824, icon: "portrait" },
    auto: { width: 0, height: 0, icon: "auto" },
};

export const imageQualityOptions = [
    { value: "auto", get label() { return i18n.t("settingsPanels.common.auto"); } },
    { value: "high", get label() { return i18n.t("settingsPanels.common.high"); } },
    { value: "medium", get label() { return i18n.t("settingsPanels.common.medium"); } },
    { value: "low", get label() { return i18n.t("settingsPanels.common.low"); } },
];

export const imageAspectOptions = [
    { value: "1:1", label: "1:1" },
    { value: "3:2", label: "3:2" },
    { value: "2:3", label: "2:3" },
    { value: "4:3", label: "4:3" },
    { value: "3:4", label: "3:4" },
    { value: "16:9", label: "16:9" },
    { value: "9:16", label: "9:16" },
    { value: "2048x2048", label: "1:1(2k)" },
    { value: "2048x1152", label: "16:9(2k)" },
    { value: "1152x2048", label: "9:16(2k)" },
    { value: "3840x2160", label: "16:9(4k)" },
    { value: "2160x3840", label: "9:16(4k)" },
    { value: "auto", label: "auto" },
];

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "size" | "count" | "background", value: string) => void;
    onModelParamChange?: (key: string, value: string | number | boolean) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    /** 工作台等仍内嵌张数时开启；画布默认关闭（独立按钮）。 */
    showCount?: boolean;
    /** 参考位使用文件夹时，张数改为该文件夹图片数；null 表示多个文件夹张数不一致。 */
    folderImageCount?: number | null;
    concurrency?: number | null;
    onConcurrencyChange?: (value: number | null) => void;
    className?: string;
    maxCount?: number;
    quickCount?: number;
    /** Midjourney：工作台已连接的参考图，供底图 / sref 勾选。 */
    referenceImages?: ImageSettingsReferenceOption[];
};

export function ImageSettingsPanel({
    config,
    onConfigChange,
    onModelParamChange,
    theme,
    showTitle = true,
    showCount = false,
    folderImageCount,
    concurrency = null,
    onConcurrencyChange,
    className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5",
    maxCount = 15,
    quickCount = 10,
    referenceImages = [],
}: ImageSettingsPanelProps) {
    const { t } = useTranslation();
    const [snapDimensionToStep, setSnapDimensionToStep] = useState(true);
    const [customDraft, setCustomDraft] = useState<{ w: string; h: string }>({ w: "", h: "" });
    const schema = useMemo(() => resolveImageSettingSchema(config), [config]);
    const linkfox = schema.source === "linkfox" ? resolveLinkfoxImageParams(config) : null;
    const packed = linkfox ? { resolution: linkfox.resolution || "", quality: linkfox.quality || "" } : unpackQualityValue(config.quality || "");
    const count = Math.max(1, Math.min(maxCount, Math.floor(Math.abs(Number(config.count)) || 1)));
    const activeSize = linkfox?.aspectRatio || resolveImageSize(config) || "auto";
    const transparentBackground = config.background === "transparent";
    const defaultDimensions = String(schema.fields.find((field) => field.kind === "dimensions")?.defaultValue || "1024x1024");
    const dimensions = readSizeDimensions(activeSize, readSizeDimensions(defaultDimensions, { width: 1024, height: 1024 }));
    const dimensionsDisabled = activeSize === "auto" && schema.fields.some((field) => field.kind === "aspectRatio");
    const referenceIds = referenceImages.map((item) => item.id);
    const selectedBaseIds = new Set(resolveMjBaseImageIds(referenceIds, config.modelParams));
    const srefEnabled = isMjSrefEnabled(config.modelParams);
    const srefImageId = resolveMjSrefImageId(referenceIds, config.modelParams);

    const updatePacked = (patch: { resolution?: string; quality?: string }) => {
        onConfigChange("quality", packQualityValue({ ...packed, ...patch }, schema));
    };

    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 1024));
        const width = key === "width" ? next : dimensions.width;
        const height = key === "height" ? next : dimensions.height;
        onConfigChange("size", `${alignDimension(width, snapDimensionToStep)}x${alignDimension(height, snapDimensionToStep)}`);
    };

    const fieldTitle = (field: ImageSettingField) => {
        if (field.labelKey === "resolution") return t("settingsPanels.image.resolution");
        if (field.labelKey === "transparent") return t("settingsPanels.image.transparent");
        if (field.labelKey === "quality") return t("settingsPanels.image.quality");
        if (field.labelKey === "size") return t("settingsPanels.image.size");
        if (field.labelKey === "aspectRatio") return t("settingsPanels.image.aspectRatio");
        if (field.labelKey === "mjBaseImages") return t("settingsPanels.image.mjBaseImages");
        if (field.labelKey === "mjSrefImage") return t("settingsPanels.image.mjSrefImage");
        const paramKey = `settingsPanels.image.params.${field.labelKey}`;
        const localized = t(paramKey);
        return localized === paramKey ? field.labelKey : localized;
    };

    const optionLabel = (value: string, label?: string) => {
        if (label && label !== value) return label;
        if (["auto", "high", "medium", "low"].includes(value)) return t(`settingsPanels.common.${value}`);
        return value;
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div
                className={className}
                style={{ color: theme.node.text }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.target instanceof HTMLInputElement) return;
                    if (document.activeElement instanceof HTMLInputElement && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
                }}
            >
                {showTitle ? <div className="text-lg font-semibold">{t("settingsPanels.image.title")}</div> : null}
                {schema.fields.map((field) => {
                    if (field.visibleWhenParam && !config.modelParams?.[field.visibleWhenParam]) return null;
                    if (field.fieldKey === "iw" && !selectedBaseIds.size) return null;
                    if (field.kind === "mjBaseImages") {
                        return (
                            <div key="mjBaseImages" className="space-y-2.5">
                                <SettingTitle color={theme.node.muted}>{fieldTitle(field)}</SettingTitle>
                                {!referenceImages.length ? (
                                    <div className="text-xs" style={{ color: theme.node.muted, opacity: 0.75 }}>
                                        {t("settingsPanels.image.mjNoReferences")}
                                    </div>
                                ) : (
                                    <div className="space-y-1.5">
                                        {referenceImages.map((item, index) => {
                                            const checked = selectedBaseIds.has(item.id);
                                            const label = item.label || imageReferenceLabel(index);
                                            return (
                                                <label
                                                    key={item.id}
                                                    className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-black/5 dark:hover:bg-white/10"
                                                    onMouseDown={(event) => event.stopPropagation()}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        className="size-3.5 shrink-0"
                                                        checked={checked}
                                                        disabled={!onModelParamChange}
                                                        onChange={(event) => {
                                                            if (!onModelParamChange) return;
                                                            onModelParamChange(
                                                                MJ_BASE_EXCLUDED_IDS_KEY,
                                                                toggleMjBaseImageExcluded(config.modelParams, item.id, event.target.checked, referenceIds),
                                                            );
                                                        }}
                                                    />
                                                    {item.thumbUrl ? <img src={item.thumbUrl} alt="" className="size-8 shrink-0 rounded object-cover" /> : null}
                                                    <span className="min-w-0 truncate text-sm">{label}</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    }
                    if (field.kind === "mjSrefImage") {
                        return (
                            <div key="mjSrefImage" className="space-y-2.5">
                                <div className="flex items-center justify-between gap-3">
                                    <SettingTitle color={theme.node.muted}>{fieldTitle(field)}</SettingTitle>
                                    <span onMouseDown={(event) => event.stopPropagation()}>
                                        <Switch
                                            size="small"
                                            checked={srefEnabled}
                                            disabled={!onModelParamChange || !referenceImages.length}
                                            onChange={(checked) => {
                                                if (!onModelParamChange) return;
                                                onModelParamChange(MJ_SREF_ENABLED_KEY, checked);
                                                if (checked && !String(config.modelParams?.[MJ_SREF_IMAGE_ID_KEY] || "").trim() && referenceIds[0]) {
                                                    onModelParamChange(MJ_SREF_IMAGE_ID_KEY, referenceIds[0]);
                                                }
                                            }}
                                        />
                                    </span>
                                </div>
                                {!referenceImages.length ? (
                                    <div className="text-xs" style={{ color: theme.node.muted, opacity: 0.75 }}>
                                        {t("settingsPanels.image.mjNoReferences")}
                                    </div>
                                ) : srefEnabled ? (
                                    <div className="space-y-1.5">
                                        {referenceImages.map((item, index) => {
                                            const selected = srefImageId === item.id;
                                            const label = item.label || imageReferenceLabel(index);
                                            return (
                                                <label
                                                    key={item.id}
                                                    className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-black/5 dark:hover:bg-white/10"
                                                    onMouseDown={(event) => event.stopPropagation()}
                                                >
                                                    <input
                                                        type="radio"
                                                        name="mj-sref-image"
                                                        className="size-3.5 shrink-0"
                                                        checked={selected}
                                                        disabled={!onModelParamChange}
                                                        onChange={() => onModelParamChange?.(MJ_SREF_IMAGE_ID_KEY, item.id)}
                                                    />
                                                    {item.thumbUrl ? <img src={item.thumbUrl} alt="" className="size-8 shrink-0 rounded object-cover" /> : null}
                                                    <span className="min-w-0 truncate text-sm">{label}</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-xs" style={{ color: theme.node.muted, opacity: 0.75 }}>
                                        {t("settingsPanels.image.mjSrefHint")}
                                    </div>
                                )}
                            </div>
                        );
                    }
                    if (field.kind === "resolution" || field.kind === "quality") {
                        const selectedRaw = field.kind === "resolution" ? packed.resolution || (!schema.fields.some((item) => item.kind === "quality") ? config.quality : "") : packed.quality || (!schema.fields.some((item) => item.kind === "resolution") ? config.quality : "");
                        const selected = schema.source === "kling" || schema.source === "dreamina" ? pickImageSchemaOption(field, selectedRaw) : selectedRaw;
                        return (
                            <div key={`${field.kind}-${field.fieldKey || field.labelKey}`} className="space-y-2.5">
                                <SettingTitle color={theme.node.muted}>{fieldTitle(field)}</SettingTitle>
                                <div className="flex flex-wrap gap-2.5">
                                    {(field.options || []).map((item) => (
                                        <OptionPill
                                            key={item.value}
                                            selected={selected === item.value}
                                            theme={theme}
                                            onClick={() => (field.kind === "resolution" ? updatePacked({ resolution: item.value }) : updatePacked({ quality: item.value }))}
                                        >
                                            {optionLabel(item.value, item.label)}
                                        </OptionPill>
                                    ))}
                                </div>
                            </div>
                        );
                    }
                    if (field.kind === "dimensions") {
                        return (
                            <div key="dimensions" className="space-y-2.5">
                                <div className="flex items-center justify-between gap-3">
                                    <SettingTitle color={theme.node.muted}>{fieldTitle(field)}</SettingTitle>
                                    {field.showAlign16 ? (
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                                {t("settingsPanels.image.align16")}
                                            </span>
                                            <span title={t("settingsPanels.image.align16Hint")} onMouseDown={(event) => event.stopPropagation()}>
                                                <Switch size="small" checked={snapDimensionToStep} onChange={setSnapDimensionToStep} />
                                            </span>
                                        </div>
                                    ) : null}
                                </div>
                                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                                    <DimensionInput prefix="W" value={dimensions.width} disabled={dimensionsDisabled} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("width", value)} />
                                    <span className="text-lg opacity-45">↔</span>
                                    <DimensionInput prefix="H" value={dimensions.height} disabled={dimensionsDisabled} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("height", value)} />
                                </div>
                            </div>
                        );
                    }
                    if (field.kind === "aspectRatio") {
                        const options = field.options || [];
                        const presetValues = new Set(options.map((item) => item.value));
                        const hasAuto = presetValues.has("auto");
                        const allowCustom = Boolean(field.allowCustomAspect);
                        const ratioMode = Boolean(field.customAspectRatioMode);
                        const customRatio = parseCustomRatio(activeSize, presetValues);
                        // 上一模型留下的 auto，当前模型不支持时，高亮回退到首个预设
                        const fallbackPreset = options.find((item) => item.value !== "auto")?.value || options[0]?.value || "1:1";
                        const selectedSize = schema.source === "kling" || schema.source === "dreamina" ? pickImageSchemaOption(field, activeSize) : presetValues.has(activeSize) ? activeSize : customRatio ? activeSize : fallbackPreset;
                        const showCustom = allowCustom;
                        const autoSelected = selectedSize === "auto";
                        const draftW = customDraft.w || (customRatio ? String(customRatio.w) : "");
                        const draftH = customDraft.h || (customRatio ? String(customRatio.h) : "");
                        const clearCustomTarget = hasAuto ? "auto" : fallbackPreset;
                        const commitCustomSide = (side: "w" | "h", raw: string) => {
                            const digits = raw.replace(/[^\d]/g, "");
                            const other = side === "w" ? draftH : draftW;
                            const nextW = side === "w" ? digits : other;
                            const nextH = side === "h" ? digits : other;
                            if (!nextW.trim() && !nextH.trim()) {
                                setCustomDraft({ w: "", h: "" });
                                onConfigChange("size", clearCustomTarget);
                                return;
                            }
                            const w = Math.floor(Number(nextW));
                            const h = Math.floor(Number(nextH));
                            if (w > 0 && h > 0) {
                                const aligned = ratioMode
                                    ? { w: String(w), h: String(h) }
                                    : {
                                          w: String(alignDimension(w, snapDimensionToStep)),
                                          h: String(alignDimension(h, snapDimensionToStep)),
                                      };
                                setCustomDraft(aligned);
                                onConfigChange("size", `${aligned.w}:${aligned.h}`);
                                return;
                            }
                            setCustomDraft({ w: nextW, h: nextH });
                        };
                        return (
                            <div key="aspectRatio" className="space-y-2.5">
                                {showCustom ? (
                                    <div className="space-y-2.5">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex min-w-0 items-center gap-2">
                                                <SettingTitle color={theme.node.muted}>
                                                    {ratioMode ? t("settingsPanels.image.customAspectRatio") : t("settingsPanels.image.customAspect")}
                                                </SettingTitle>
                                                {customRatio ? (
                                                    <button
                                                        type="button"
                                                        className="shrink-0 text-[11px] opacity-70 hover:opacity-100"
                                                        style={{ color: theme.node.muted }}
                                                        onMouseDown={(event) => event.stopPropagation()}
                                                        onClick={() => {
                                                            setCustomDraft({ w: "", h: "" });
                                                            onConfigChange("size", clearCustomTarget);
                                                        }}
                                                    >
                                                        {hasAuto ? "auto" : t("settingsPanels.image.clearCustom")}
                                                    </button>
                                                ) : null}
                                            </div>
                                            {!ratioMode ? (
                                                <div className="flex shrink-0 items-center gap-2">
                                                    <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                                        {t("settingsPanels.image.align16")}
                                                    </span>
                                                    <span title={t("settingsPanels.image.align16Hint")} onMouseDown={(event) => event.stopPropagation()}>
                                                        <Switch
                                                            size="small"
                                                            checked={snapDimensionToStep}
                                                            onChange={(checked) => {
                                                                setSnapDimensionToStep(checked);
                                                                if (checked && customRatio) {
                                                                    const aligned = {
                                                                        w: String(alignDimension(customRatio.w, true)),
                                                                        h: String(alignDimension(customRatio.h, true)),
                                                                    };
                                                                    setCustomDraft(aligned);
                                                                    onConfigChange("size", `${aligned.w}:${aligned.h}`);
                                                                }
                                                            }}
                                                        />
                                                    </span>
                                                </div>
                                            ) : null}
                                        </div>
                                        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                                            <PrefixedInput prefix="W" value={draftW} theme={theme} onCommit={(value) => commitCustomSide("w", value)} />
                                            <span className="text-lg opacity-45">↔</span>
                                            <PrefixedInput prefix="H" value={draftH} theme={theme} onCommit={(value) => commitCustomSide("h", value)} />
                                        </div>
                                    </div>
                                ) : null}
                                <SettingTitle color={theme.node.muted}>{fieldTitle(field)}</SettingTitle>
                                <div className="grid grid-cols-4 gap-2.5">
                                    {options.map((item) => {
                                        const icon = aspectIcons[item.value] || guessAspectIcon(item.value);
                                        const selected = item.value === "auto" ? autoSelected : selectedSize === item.value && !customRatio;
                                        return (
                                            <button
                                                key={item.value}
                                                type="button"
                                                className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                                style={{ borderColor: selected || (item.value === "auto" && customRatio) ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}
                                                onMouseDown={(event) => event.stopPropagation()}
                                                onClick={() => {
                                                    setCustomDraft({ w: "", h: "" });
                                                    onConfigChange("size", item.value);
                                                }}
                                            >
                                                <AspectIcon type={icon.icon} width={icon.width} height={icon.height} color={theme.node.text} />
                                                <span className="truncate px-1 text-[11px]">{item.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    }
                    if (field.kind === "background") {
                        return (
                            <div key="background" className="flex items-center justify-between gap-3">
                                <div className="space-y-0.5">
                                    <SettingTitle color={theme.node.muted}>{fieldTitle(field)}</SettingTitle>
                                    <div className="text-xs" style={{ color: theme.node.muted, opacity: 0.75 }}>
                                        {t("settingsPanels.image.transparentHint")}
                                    </div>
                                </div>
                                <span onMouseDown={(event) => event.stopPropagation()}>
                                    <Switch size="small" checked={transparentBackground} onChange={(checked) => onConfigChange("background", checked ? "transparent" : "")} />
                                </span>
                            </div>
                        );
                    }
                    if (field.kind === "toggle" && field.fieldKey && onModelParamChange) {
                        const checked = Boolean(readModelParam(config, field));
                        return (
                            <div key={`toggle-${field.fieldKey}`} className="flex items-center justify-between gap-3">
                                <SettingTitle color={theme.node.muted}>{fieldTitle(field)}</SettingTitle>
                                <span onMouseDown={(event) => event.stopPropagation()}>
                                    <Switch size="small" checked={checked} onChange={(value) => onModelParamChange(field.fieldKey!, value)} />
                                </span>
                            </div>
                        );
                    }
                    if (field.kind === "number" && field.fieldKey && onModelParamChange) {
                        const value = Number(readModelParam(config, field));
                        return (
                            <div key={`number-${field.fieldKey}`} className="space-y-2.5">
                                <div className="flex items-center justify-between gap-2">
                                    <SettingTitle color={theme.node.muted}>{fieldTitle(field)}</SettingTitle>
                                    <span className="text-[11px]" style={{ color: theme.node.muted, opacity: 0.7 }}>
                                        {typeof field.min === "number" && typeof field.max === "number" ? `${field.min}–${field.max}` : ""}
                                    </span>
                                </div>
                                <NumberParamInput
                                    value={Number.isFinite(value) ? value : Number(field.defaultValue) || 0}
                                    min={field.min}
                                    max={field.max}
                                    theme={theme}
                                    onChange={(next) => onModelParamChange(field.fieldKey!, next)}
                                />
                            </div>
                        );
                    }
                    return null;
                })}
                {showCount ? (
                    <div className="space-y-2.5">
                        <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.count")}</SettingTitle>
                        {folderImageCount === null ? (
                            <div className="text-sm text-red-500">{t("imageWorkbench.batchCountUnavailable")}</div>
                        ) : typeof folderImageCount === "number" ? (
                            <div className="grid grid-cols-4 gap-2.5">
                                <OptionPill selected theme={theme} onClick={() => undefined}>
                                    {t("settingsPanels.image.images", { count: folderImageCount })}
                                </OptionPill>
                            </div>
                        ) : (
                            <div className="grid grid-cols-4 gap-2.5">
                                {Array.from({ length: quickCount }, (_, index) => index + 1).map((value) => (
                                    <OptionPill key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>
                                        {t("settingsPanels.image.images", { count: value })}
                                    </OptionPill>
                                ))}
                                <CountInput value={count} max={maxCount} theme={theme} onChange={(value) => onConfigChange("count", String(value || 1))} />
                            </div>
                        )}
                    </div>
                ) : null}
                {showCount && onConcurrencyChange ? (
                    <div className="space-y-2.5">
                        <SettingTitle color={theme.node.muted}>{t("settingsPanels.image.concurrency")}</SettingTitle>
                        <div className="flex items-center gap-2.5" onMouseDown={(event) => event.stopPropagation()}>
                            <div className="min-w-0 flex-1 px-1">
                                <input
                                    type="range"
                                    aria-label={t("settingsPanels.image.concurrency")}
                                    min={0}
                                    max={20}
                                    step={1}
                                    value={concurrency ?? 0}
                                    className="h-1.5 w-full cursor-pointer"
                                    style={{ accentColor: theme.node.text }}
                                    onChange={(event) => {
                                        const next = Number(event.target.value);
                                        onConcurrencyChange(next > 0 ? next : null);
                                    }}
                                />
                            </div>
                            <span className="w-14 shrink-0 text-right text-sm tabular-nums" style={{ color: theme.node.text }}>
                                {concurrency ? String(concurrency) : t("settingsPanels.image.unlimited")}
                            </span>
                        </div>
                    </div>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.toolbar.panel, colorBgElevated: theme.toolbar.panel, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel },
                components: { Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text } },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function imageQualityLabel(value: string) {
    const packed = unpackQualityValue(value);
    const raw = packed.quality || packed.resolution || value;
    return ["auto", "high", "medium", "low"].includes(raw) ? i18n.t(`settingsPanels.common.${raw}`) : raw;
}

export function imageSizeLabel(size: string) {
    return imageAspectOptions.find((item) => item.value === size)?.label || size;
}

export function imageSettingsTriggerLabel(config: AiConfig) {
    return imageSettingsSummary(config, (value) => imageQualityLabel(value));
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function DimensionInput({ prefix, value, disabled, theme, alignToStep, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; alignToStep: boolean; onChange: (value: number | null) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = alignDimension(Math.max(1, Math.floor(Number(input.value) || value || 1024)), alignToStep);
        input.value = String(next);
        onChange(next);
    };

    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input
                type="number"
                min={1}
                disabled={disabled}
                className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value || ""}
                key={`${prefix}-${value}`}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function CountInput({ value, max, theme, onChange }: { value: number; max: number; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="col-span-2 flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input
                type="number"
                min={1}
                max={max}
                className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                value={value || ""}
                onChange={(event) => onChange(Number(event.target.value) || null)}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function AspectIcon({ type, width, height, color }: { type: string; width: number; height: number; color: string }) {
    if (type === "auto") return null;
    const ratio = width / Math.max(1, height);
    const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
    const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
    return (
        <span className="grid h-7 w-9 place-items-center">
            <span className="border-2" style={{ width: boxWidth, height: boxHeight, borderColor: color }} />
        </span>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}

function readSizeDimensions(size: string, fallback: { width: number; height: number }) {
    const match = size?.match(/^(\d+)x(\d+)$/);
    return {
        width: match ? Number(match[1]) : fallback.width,
        height: match ? Number(match[2]) : fallback.height,
    };
}

function alignDimension(value: number, enabled: boolean) {
    return enabled ? Math.ceil(value / DIMENSION_STEP) * DIMENSION_STEP : value;
}

function guessAspectIcon(value: string) {
    if (value === "auto") return aspectIcons.auto;
    if (value.includes(":")) {
        const [w, h] = value.split(":").map(Number);
        if (w > 0 && h > 0) {
            if (w === h) return { width: w, height: h, icon: "square" };
            return { width: w, height: h, icon: w > h ? "landscape" : "portrait" };
        }
    }
    const dims = value.match(/^(\d+)x(\d+)$/i);
    if (dims) {
        const width = Number(dims[1]);
        const height = Number(dims[2]);
        return { width, height, icon: width === height ? "square" : width > height ? "landscape" : "portrait" };
    }
    return { width: 1024, height: 1024, icon: "square" };
}

function parseCustomRatio(size: string, presetValues: Set<string>) {
    const match = size?.trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (!match) return null;
    if (presetValues.has(size.trim())) return null;
    const w = Number(match[1]);
    const h = Number(match[2]);
    if (!(w > 0 && h > 0)) return null;
    return { w, h };
}

function PrefixedInput({ prefix, value, theme, onCommit }: { prefix: string; value: string; theme: CanvasTheme; onCommit: (value: string) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input
                type="number"
                min={1}
                step={1}
                className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={value}
                key={`${prefix}-${value}`}
                onMouseDown={(event) => event.stopPropagation()}
                onBlur={(event) => onCommit(event.currentTarget.value)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
            />
        </label>
    );
}

function NumberParamInput({ value, min, max, theme, onChange }: { value: number; min?: number; max?: number; theme: CanvasTheme; onChange: (value: number) => void }) {
    const commit = (input: HTMLInputElement) => {
        let next = Math.round(Number(input.value));
        if (!Number.isFinite(next)) next = value;
        if (typeof min === "number") next = Math.max(min, next);
        if (typeof max === "number") next = Math.min(max, next);
        input.value = String(next);
        onChange(next);
    };
    return (
        <input
            type="number"
            min={min}
            max={max}
            step={1}
            className="h-9 w-full rounded-xl bg-transparent px-3 text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            style={{ background: theme.node.fill, color: theme.node.text }}
            defaultValue={value}
            key={`n-${value}-${min}-${max}`}
            onMouseDown={(event) => event.stopPropagation()}
            onBlur={(event) => commit(event.currentTarget)}
            onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
            }}
        />
    );
}
