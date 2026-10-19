import { Button, Modal, Slider } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { RH_DEFAULT_SCALE_MAX_SIDE, RH_DEFAULT_SCALE_RATIO } from "@/lib/canvas/rh-composite";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export type RhUpscaleDialogParams = {
    ratio: number;
    maxSide: number;
};

export function CanvasNodeRhUpscaleDialog({
    open,
    sourceWidth,
    sourceHeight,
    onClose,
    onConfirm,
}: {
    open: boolean;
    sourceWidth?: number;
    sourceHeight?: number;
    onClose: () => void;
    onConfirm: (params: RhUpscaleDialogParams) => void;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [ratio, setRatio] = useState(RH_DEFAULT_SCALE_RATIO);
    const [maxSide, setMaxSide] = useState(RH_DEFAULT_SCALE_MAX_SIDE);

    useEffect(() => {
        if (!open) return;
        setRatio(RH_DEFAULT_SCALE_RATIO);
        setMaxSide(RH_DEFAULT_SCALE_MAX_SIDE);
    }, [open]);

    const preview = useMemo(() => {
        const srcW = Math.max(1, sourceWidth || 0);
        const srcH = Math.max(1, sourceHeight || 0);
        if (!sourceWidth || !sourceHeight) return null;
        let w = Math.max(1, Math.round(srcW * ratio));
        let h = Math.max(1, Math.round(srcH * ratio));
        const longest = Math.max(w, h);
        if (maxSide > 0 && longest > maxSide) {
            const clamp = maxSide / longest;
            w = Math.max(1, Math.round(w * clamp));
            h = Math.max(1, Math.round(h * clamp));
        }
        return { width: w, height: h };
    }, [maxSide, ratio, sourceHeight, sourceWidth]);

    const fieldStyle = {
        background: theme.node.fill,
        color: theme.node.text,
        borderColor: theme.node.stroke,
    } as const;

    return (
        <Modal
            title={t("canvas.editors.rhUpscaleTitle")}
            open={open}
            onCancel={onClose}
            footer={null}
            centered
            width={440}
            destroyOnHidden
        >
            <div className="space-y-4" data-canvas-no-zoom>
                <div className="text-xs leading-5 opacity-70" style={{ color: theme.node.muted }}>
                    {t("canvas.editors.rhUpscaleHint")}
                </div>
                <label className="grid gap-1 text-xs" style={{ color: theme.node.muted }}>
                    {t("canvas.rhComposite.scaleRatio")}
                    <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                            <Slider min={1} max={2} step={0.1} value={ratio} onChange={setRatio} />
                        </div>
                        <input
                            type="number"
                            min={1}
                            max={2}
                            step={0.1}
                            value={Number(ratio.toFixed(2))}
                            onChange={(event) => setRatio(Math.min(2, Math.max(1, Number(event.target.value) || RH_DEFAULT_SCALE_RATIO)))}
                            className="h-8 w-14 shrink-0 appearance-none rounded-md border px-1 text-center text-xs tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            style={fieldStyle}
                        />
                    </div>
                </label>
                <label className="grid gap-1 text-xs" style={{ color: theme.node.muted }}>
                    {t("canvas.rhComposite.scaleMaxSide")}
                    <input
                        type="number"
                        min={0}
                        max={8192}
                        step={1}
                        value={maxSide}
                        onChange={(event) => setMaxSide(Math.max(0, Math.floor(Number(event.target.value) || 0)))}
                        className="h-9 rounded-md border px-2 text-sm outline-none"
                        style={fieldStyle}
                    />
                </label>
                {preview ? (
                    <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                        {t("canvas.editors.rhUpscalePreview", {
                            from: `${sourceWidth} × ${sourceHeight}`,
                            to: `${preview.width} × ${preview.height}`,
                        })}
                    </div>
                ) : null}
                <div className="flex justify-end gap-2 pt-1">
                    <Button onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="primary" onClick={() => onConfirm({ ratio, maxSide })}>
                        {t("canvas.editors.rhUpscaleConfirm")}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
