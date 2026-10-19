import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, Cpu, Star } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { cn } from "@/lib/utils";
import { CANVAS_OVERLAY_MODAL_Z_INDEX } from "@/stores/use-canvas-side-panel-store";
import { CODEX_CHANNEL_ID, decodeChannelModel, DREAMINA_CHANNEL_ID, encodeChannelModel, KLING_CHANNEL_ID, modelOptionName, resolveModelDisplayName, RUNNINGHUB_CHANNEL_ID, RUNNINGHUB_CN_CHANNEL_ID, useConfigStore, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

const PICKER_Z_INDEX = CANVAS_OVERLAY_MODAL_Z_INDEX + 50;

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    /** 默认按视口剩余空间在打开前一次算好，避免先下后上跳一下 */
    placement?: "bottomLeft" | "topLeft";
    onMissingConfig?: () => void;
};

type PickerPlacement = "bottomLeft" | "topLeft";

function resolvePickerPlacement(el: HTMLElement | null, preferred?: PickerPlacement): PickerPlacement {
    if (preferred) return preferred;
    if (!el) return "bottomLeft";
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const need = Math.min(window.innerHeight * 0.5, 360);
    return spaceBelow < need && spaceAbove >= spaceBelow ? "topLeft" : "bottomLeft";
}

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, placeholder, placement: preferredPlacement, onMissingConfig }: ModelPickerProps) {
    const { t } = useTranslation();
    const pickerId = useId();
    const rootRef = useRef<HTMLSpanElement>(null);
    const [menu, setMenu] = useState<{ open: boolean; placement: PickerPlacement }>({
        open: false,
        placement: preferredPlacement || "bottomLeft",
    });
    const { open, placement } = menu;
    const current = value || "";
    const pickerPlaceholder = placeholder || t("settingsPanels.model.select");

    const favoriteModels = useConfigStore((state) => state.favoriteModels);
    const toggleFavoriteModel = useConfigStore((state) => state.toggleFavoriteModel);
    const favoriteSet = useMemo(() => new Set(favoriteModels), [favoriteModels]);
    const channels = useMemo(() => channelsWithCapability(config, capability), [capability, config]);
    const listedModels = useMemo(() => {
        const models = channels.flatMap((channel) =>
            channel.models.filter((model) => !capability || model.capability === capability).map((model) => encodeChannelModel(channel.id, model.name)),
        );
        return {
            favorites: models.filter((model) => favoriteSet.has(model)),
            rest: models.filter((model) => !favoriteSet.has(model)),
        };
    }, [capability, channels, favoriteSet]);

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setMenu((current) => ({ ...current, open: false }));
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    // 画布空白处常会 stopPropagation，点外关闭用捕获阶段补上
    useEffect(() => {
        if (!open) return;
        const onPointerDownCapture = (event: PointerEvent) => {
            const target = event.target as HTMLElement | null;
            if (!target) return;
            if (rootRef.current?.contains(target)) return;
            if (target.closest("[data-model-picker-panel]")) return;
            setMenu((current) => ({ ...current, open: false }));
        };
        document.addEventListener("pointerdown", onPointerDownCapture, true);
        return () => document.removeEventListener("pointerdown", onPointerDownCapture, true);
    }, [open]);

    const triggerLabel = current ? triggerModelLabel(config, current) : pickerPlaceholder;
    const triggerTitle = current ? triggerModelTitle(config, current) : pickerPlaceholder;
    const [buttonRect, setButtonRect] = useState<DOMRect | null>(null);

    useEffect(() => {
        if (!open) return;
        const syncPosition = () => {
            const next = rootRef.current?.getBoundingClientRect() || null;
            setButtonRect((currentRect) => {
                if (!next && !currentRect) return currentRect;
                if (!next || !currentRect) return next;
                if (currentRect.left === next.left && currentRect.top === next.top && currentRect.width === next.width && currentRect.height === next.height) return currentRect;
                return next;
            });
        };
        syncPosition();
        window.addEventListener("resize", syncPosition);
        window.addEventListener("scroll", syncPosition, true);
        return () => {
            window.removeEventListener("resize", syncPosition);
            window.removeEventListener("scroll", syncPosition, true);
        };
    }, [open]);

    const openPicker = () => {
        if (!channels.length && config.channelMode === "local") onMissingConfig?.();
        window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
        setButtonRect(rootRef.current?.getBoundingClientRect() || null);
        setMenu({
            open: true,
            placement: resolvePickerPlacement(rootRef.current, preferredPlacement),
        });
    };

    const closePicker = () => setMenu((currentMenu) => ({ ...currentMenu, open: false }));

    const panel = open && buttonRect ? (
        <div
            data-model-picker-panel=""
            data-canvas-no-zoom
            className="max-h-[min(70vh,28rem)] overflow-y-auto rounded-xl border border-border/70 bg-popover p-1 shadow-xl"
            style={pickerPanelStyle(buttonRect, placement)}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="px-2.5 py-1.5 text-[11px] font-medium text-stone-500 dark:text-stone-400">{t("settingsPanels.model.select")}</div>
            {listedModels.favorites.length || listedModels.rest.length ? (
                <>
                    {listedModels.favorites.map((model) => (
                        <ModelPickerRow
                            key={model}
                            config={config}
                            model={model}
                            selected={model === current}
                            favorited
                            onSelect={() => {
                                onChange(model);
                                closePicker();
                            }}
                            onToggleFavorite={() => toggleFavoriteModel(model)}
                        />
                    ))}
                    {listedModels.rest.map((model) => (
                        <ModelPickerRow
                            key={model}
                            config={config}
                            model={model}
                            selected={model === current}
                            favorited={false}
                            onSelect={() => {
                                onChange(model);
                                closePicker();
                            }}
                            onToggleFavorite={() => toggleFavoriteModel(model)}
                        />
                    ))}
                </>
            ) : (
                <div className="px-2.5 py-3 text-sm text-stone-500">{emptyModelLabel(config, capability)}</div>
            )}
        </div>
    ) : null;

    return (
        <span ref={rootRef} className={cn("inline-flex min-w-0", fullWidth && "w-full")}>
            <button
                type="button"
                className={cn(
                    "canvas-composer-model-picker inline-flex h-8 w-fit max-w-full items-center gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm transition-colors",
                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                    open ? "border-ring ring-2 ring-ring/20" : "",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                    event.stopPropagation();
                    if (open) closePicker();
                    else openPicker();
                }}
                title={triggerTitle}
            >
                <ModelIcon model={current} />
                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
            </button>
            {panel ? createPortal(panel, document.body) : null}
        </span>
    );
}

function pickerPanelStyle(rect: DOMRect, placement: PickerPlacement): CSSProperties {
    const width = Math.min(36 * 16, window.innerWidth - 24);
    const gap = 8;
    const margin = 12;
    const left = Math.max(margin, Math.min(window.innerWidth - width - margin, rect.left));
    const topPlacement = placement === "topLeft";
    const maxHeight = Math.min(window.innerHeight * 0.7, 28 * 16, Math.max(160, topPlacement ? rect.top - margin * 2 : window.innerHeight - rect.bottom - margin * 2));
    return {
        position: "fixed",
        zIndex: PICKER_Z_INDEX,
        width,
        left,
        maxHeight,
        ...(topPlacement ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }),
    };
}

function channelsWithCapability(config: AiConfig, capability?: ModelCapability) {
    return config.channels.filter((channel) => {
        if (channel.id === KLING_CHANNEL_ID || channel.id === DREAMINA_CHANNEL_ID || channel.id === CODEX_CHANNEL_ID || channel.id === RUNNINGHUB_CHANNEL_ID) return false;
        if (channel.apiFormat !== "linkfox" && channel.id !== RUNNINGHUB_CN_CHANNEL_ID) return false;
        return channel.models.some((model) => !capability || model.capability === capability);
    });
}

function triggerModelLabel(config: AiConfig, value: string) {
    // 按钮空间有限，只显示模型名；渠道名放 title
    return resolveModelDisplayName(config, value) || value;
}

function triggerModelTitle(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    const display = resolveModelDisplayName(config, value);
    return channel ? `${channel.name} · ${display}` : display;
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability ? i18n.t(`settingsPanels.model.capabilities.${capability}`) : "";
    if (capability && config.models.length) return i18n.t("settingsPanels.model.assign", { capability: label });
    return config.models.length ? i18n.t("settingsPanels.model.noMatch", { capability: label }) : i18n.t("settingsPanels.model.addFirst");
}

function ModelPickerRow({
    config,
    model,
    selected,
    favorited,
    onSelect,
    onToggleFavorite,
}: {
    config: AiConfig;
    model: string;
    selected: boolean;
    favorited: boolean;
    onSelect: () => void;
    onToggleFavorite: () => void;
}) {
    const { t } = useTranslation();
    const label = resolveModelDisplayName(config, model);
    return (
        <div
            className={cn(
                "flex w-full items-center rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/10",
                selected ? "bg-black/5 text-stone-950 dark:bg-white/10 dark:text-white" : "text-stone-700 dark:text-stone-200",
            )}
        >
            <button
                type="button"
                title={label}
                className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left text-sm"
                onClick={onSelect}
            >
                <ModelIcon model={model} />
                <span className="min-w-0 flex-1 whitespace-normal break-all leading-snug">{label}</span>
                {selected ? <Check className="size-3.5 shrink-0 opacity-80" /> : null}
            </button>
            <button
                type="button"
                title={favorited ? t("settingsPanels.model.unfavorite") : t("settingsPanels.model.favorite")}
                className={cn(
                    "mr-1.5 flex size-7 shrink-0 items-center justify-center rounded transition-colors hover:bg-black/5 dark:hover:bg-white/10",
                    favorited ? "text-amber-500" : "text-stone-400 opacity-60 hover:opacity-100",
                )}
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onToggleFavorite();
                }}
            >
                <Star className={cn("size-3.5", favorited && "fill-current")} />
            </button>
        </div>
    );
}

function ModelIcon({ model }: { model: string }) {
    const icon = resolveModelIcon(modelOptionName(model));
    return icon ? <img src={icon} alt="" className="size-4 shrink-0 dark:invert" /> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("codex")) return "/icons/openai.svg";
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm")) return "/icons/glm.svg";
    return "";
}
