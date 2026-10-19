import { Popover } from "antd";
import { Box } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { RUNNINGHUB_MODELS } from "@/services/api/runninghub-models";
import { isKlingModel, modelOptionName, resolveChannelModel, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

type Props = {
    config: AiConfig;
    placement?: "topLeft" | "topRight";
    buttonClassName?: string;
    onParamChange: (key: string, value: string | number | boolean) => void;
};

export function CanvasModelSettingsPopover({ config, placement = "topRight", buttonClassName, onParamChange }: Props) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const endpoint = modelOptionName(config.model || "");
    const klingModel = isKlingModel(config.model) ? resolveChannelModel(config, config.model) : null;
    const klingCoreArgs = new Set([
        "prompt",
        "aspect_ratio",
        "aspectRatio",
        "ratio",
        "img_resolution",
        "imgResolution",
        "resolution",
        "duration",
        "seconds",
        "imageCount",
        "image_count",
        "count",
        "enable_audio",
        "enableAudio",
        "generateAudio",
        "generate_audio",
        "watermark",
    ]);
    const params =
        klingModel?.klingArguments
            ?.filter((argument) => !klingCoreArgs.has(argument.name))
            .map((argument) => ({
                fieldKey: argument.name,
                type: (argument.allowedValues?.every((item) => item === "true" || item === "false") ? "BOOLEAN" : "STRING") as "BOOLEAN" | "STRING",
                options: argument.allowedValues?.every((item) => item === "true" || item === "false") ? undefined : argument.allowedValues,
                defaultValue: argument.allowedValues?.every((item) => item === "true" || item === "false") ? argument.default === "true" : argument.default,
                description: argument.description,
            })) ||
        RUNNINGHUB_MODELS.find((item) => item.name === endpoint)?.params ||
        [];
    const summary = params
        .map((param) => {
            const value = config.modelParams?.[param.fieldKey] ?? param.defaultValue;
            return value === undefined ? "" : String(value);
        })
        .filter(Boolean)
        .slice(0, 3)
        .join(" · ");

    return (
        <Popover
            trigger="click"
            placement={placement}
            content={
                <div className="w-[260px] space-y-3 p-1" style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                    {params.length ? (
                        params.map((param) => {
                            const value = config.modelParams?.[param.fieldKey] ?? param.defaultValue;
                            const label = t(`canvas.configNode.modelParams.${param.fieldKey}`, { defaultValue: param.fieldKey });
                            if (param.type === "BOOLEAN") {
                                const checked = value === true || value === "true";
                                return (
                                    <label key={param.fieldKey} className="flex items-center justify-between gap-2 text-sm">
                                        <span>{label}</span>
                                        <input type="checkbox" checked={checked} onChange={(event) => onParamChange(param.fieldKey, event.target.checked)} />
                                    </label>
                                );
                            }
                            if (param.type === "INT") {
                                return (
                                    <label key={param.fieldKey} className="block space-y-1 text-sm">
                                        <span>{label}</span>
                                        <input type="range" min={param.min ?? 0} max={param.max ?? 100} value={Number(value) || 0} className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-black/15 dark:bg-white/15" onChange={(event) => onParamChange(param.fieldKey, Number(event.target.value))} />
                                    </label>
                                );
                            }
                            if (param.options?.length) {
                                return (
                                    <label key={param.fieldKey} className="block space-y-1 text-sm">
                                        <span>{label}</span>
                                        <select className="w-full rounded-md border bg-transparent px-2 py-1" style={{ borderColor: theme.node.stroke }} value={String(value ?? "")} onChange={(event) => onParamChange(param.fieldKey, event.target.value)}>
                                            {param.options.map((option) => (
                                                <option key={option} value={option}>
                                                    {option}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                );
                            }
                            return (
                                <label key={param.fieldKey} className="block space-y-1 text-sm">
                                    <span>{label}</span>
                                    <input
                                        className="w-full rounded-md border bg-transparent px-2 py-1 outline-none"
                                        style={{ borderColor: theme.node.stroke }}
                                        value={String(value ?? "")}
                                        title={"description" in param ? param.description : undefined}
                                        onChange={(event) => onParamChange(param.fieldKey, event.target.value)}
                                    />
                                </label>
                            );
                        })
                    ) : (
                        <div className="py-4 text-center text-sm opacity-60">{t("canvas.configNode.modelSettingsEmpty")}</div>
                    )}
                </div>
            }
        >
            <button type="button" className={buttonClassName || "inline-flex h-10 items-center gap-1.5 rounded-lg px-2"} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                <Box className="size-3.5 opacity-70" />
                <span className="truncate text-sm">{summary || t("canvas.configNode.modelSettings")}</span>
            </button>
        </Popover>
    );
}
