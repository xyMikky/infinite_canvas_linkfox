import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button, InputNumber, Modal } from "antd";
import { Circle, Focus, Grid2X2, MoveHorizontal, MoveVertical, RotateCcw, Save } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_OVERLAY_MODAL_Z_INDEX } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";
import {
    clampBlurAmount,
    createBlurPreviewSource,
    IMAGE_BLUR_AMOUNT,
    paintBlurPreview,
    type BlurPreviewSource,
    type ImageBlurMethod,
    type ImageBlurOptions,
} from "@/lib/canvas/image-blur";

const METHODS = [
    { id: "gaussian", icon: Circle },
    { id: "box", icon: Grid2X2 },
    { id: "motionH", icon: MoveHorizontal },
    { id: "motionV", icon: MoveVertical },
    { id: "radial", icon: Focus },
] as const;

export function CanvasNodeBlurDialog({
    dataUrl,
    open,
    onClose,
    onConfirm,
}: {
    dataUrl: string;
    open: boolean;
    onClose: () => void;
    onConfirm: (options: ImageBlurOptions) => void | Promise<void>;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [method, setMethod] = useState<ImageBlurMethod>("gaussian");
    const [amount, setAmount] = useState(IMAGE_BLUR_AMOUNT.default);
    const [showOriginal, setShowOriginal] = useState(false);
    const [ready, setReady] = useState(false);
    const [applying, setApplying] = useState(false);
    const [previewCanvas, setPreviewCanvas] = useState<HTMLCanvasElement | null>(null);
    const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
    const sourceRef = useRef<BlurPreviewSource | null>(null);
    const paintTokenRef = useRef(0);
    const unfiltered = showOriginal || clampBlurAmount(amount) === 0;

    useEffect(() => {
        if (!open || !previewCanvas) return;
        const measure = () => {
            const rect = previewCanvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const width = Math.ceil(rect.width * dpr);
            const height = Math.ceil(rect.height * dpr);
            setPreviewSize((size) => size.width === width && size.height === height ? size : { width, height });
        };
        const observer = new ResizeObserver(measure);
        observer.observe(previewCanvas);
        window.addEventListener("resize", measure);
        measure();
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", measure);
        };
    }, [open, previewCanvas]);

    useEffect(() => {
        if (!open) return;
        setMethod("gaussian");
        setAmount(IMAGE_BLUR_AMOUNT.default);
        setShowOriginal(false);
    }, [dataUrl, open]);

    useEffect(() => {
        setReady(false);
        sourceRef.current = null;
        if (!open || !dataUrl || previewSize.width <= 0 || previewSize.height <= 0) return;
        const controller = new AbortController();
        void createBlurPreviewSource(dataUrl, previewSize, controller.signal)
            .then((source) => {
                if (controller.signal.aborted) return;
                sourceRef.current = source;
                setReady(true);
            })
            .catch(() => {
                if (!controller.signal.aborted) setReady(false);
            });
        return () => {
            controller.abort();
            sourceRef.current = null;
        };
    }, [dataUrl, open, previewSize]);

    useEffect(() => {
        if (!open || !ready || unfiltered) return;
        const source = sourceRef.current;
        const canvas = previewCanvas;
        if (!source || !canvas) return;
        const token = ++paintTokenRef.current;
        const frame = window.requestAnimationFrame(() => {
            if (token !== paintTokenRef.current) return;
            paintBlurPreview(source, canvas, { method, amount: clampBlurAmount(amount) });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [amount, method, open, ready, unfiltered, previewCanvas]);

    return (
        <Modal
            title={<h2 className="m-0 pr-8 text-base font-semibold">{t("canvas.editors.blurTitle")}</h2>}
            open={open && Boolean(dataUrl)}
            onCancel={onClose}
            footer={
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <Button
                        type="text"
                        icon={<RotateCcw className="size-3.5" />}
                        disabled={!ready || applying}
                        onClick={() => { setMethod("gaussian"); setAmount(IMAGE_BLUR_AMOUNT.default); setShowOriginal(false); }}
                    >{t("canvas.editors.reset")}</Button>
                    <div className="flex items-center gap-2">
                        <Button type="text" onClick={onClose}>{t("canvas.editors.cancel")}</Button>
                        <Button
                            type="primary"
                            icon={<Save className="size-4" />}
                            loading={applying}
                            disabled={!ready}
                            onClick={() => {
                                setApplying(true);
                                void Promise.resolve(onConfirm({ method, amount: clampBlurAmount(amount) })).finally(() => setApplying(false));
                            }}
                        >{t("canvas.editors.confirmBlur")}</Button>
                    </div>
                </div>
            }
            width="min(1180px, 96vw)"
            centered
            destroyOnHidden
            transitionName=""
            maskTransitionName=""
            zIndex={CANVAS_OVERLAY_MODAL_Z_INDEX}
            getContainer={() => document.body}
            styles={{
                container: { display: "flex", flexDirection: "column", height: "min(820px, calc(100dvh - 40px))", padding: 0, overflow: "hidden", background: theme.node.panel, color: theme.node.text },
                header: { flexShrink: 0, margin: 0, padding: "18px 24px", background: theme.node.panel, borderBottom: "1px solid " + theme.toolbar.border },
                body: { flex: 1, minHeight: 0, overflow: "hidden" },
                footer: { flexShrink: 0, margin: 0, padding: "12px 20px", borderTop: "1px solid " + theme.toolbar.border },
            }}
            modalRender={(content) => (
                <div
                    data-canvas-shortcuts-ignore
                    data-canvas-no-zoom
                    style={{ "--blur-hover": theme.toolbar.itemHover } as CSSProperties}
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                >{content}</div>
            )}
        >
            <div className="grid h-full min-h-0 overflow-y-auto overscroll-contain md:grid-cols-[minmax(0,1fr)_300px] md:overflow-hidden">
                <div className="flex min-h-0 min-w-0 flex-col gap-3 p-4 md:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="m-0 text-xs font-medium">{t("canvas.editors.blurPreview")}</h3>
                        <div className="flex items-center gap-1" role="group" aria-label={t("canvas.editors.blurCompare")}>
                            {[true, false].map((original) => (
                                <button
                                    key={String(original)}
                                    type="button"
                                    aria-pressed={showOriginal === original}
                                    disabled={!ready}
                                    className="rounded-md px-3 py-1.5 text-xs transition-colors hover:bg-[var(--blur-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40"
                                    style={{ background: showOriginal === original ? theme.toolbar.activeBg : undefined, color: showOriginal === original ? theme.node.text : theme.node.placeholder }}
                                    onClick={() => setShowOriginal(original)}
                                >{t(original ? "canvas.editors.originalMode" : "canvas.editors.blurEffect")}</button>
                            ))}
                        </div>
                    </div>
                    <div className="relative h-[44dvh] min-h-[240px] w-full shrink-0 overflow-hidden rounded-xl p-4 md:h-auto md:min-h-0 md:flex-1" style={{ background: theme.canvas.background }}>
                        <div className="relative h-full w-full">
                            <canvas ref={setPreviewCanvas} className="absolute inset-0 h-full w-full object-contain" style={{ visibility: ready && !unfiltered ? "visible" : "hidden" }} />
                            {ready && unfiltered ? <img src={dataUrl} alt={t("canvas.editors.originalMode")} draggable={false} className="absolute inset-0 h-full w-full object-contain" /> : null}
                        </div>
                        {!ready ? <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs" role="status" style={{ color: theme.node.placeholder }}>{t("canvas.editors.loading")}</div> : null}
                    </div>
                    <p className="m-0 text-[11px]" style={{ color: theme.node.placeholder }}>{t("canvas.editors.blurCompareHint")}</p>
                </div>
                <aside className="flex min-h-0 flex-col gap-6 border-t p-5 md:overflow-y-auto md:border-t-0 md:border-l" style={{ borderColor: theme.toolbar.border }}>
                    <section aria-labelledby="blur-method-label">
                        <h3 id="blur-method-label" className="mb-3 text-xs font-semibold">{t("canvas.editors.blurMethod")}</h3>
                        <div className="space-y-1" role="group" aria-labelledby="blur-method-label">
                            {METHODS.map(({ id, icon: Icon }) => (
                                <button
                                    key={id}
                                    type="button"
                                    aria-pressed={method === id}
                                    disabled={applying}
                                    className="flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-[var(--blur-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40"
                                    style={{ background: method === id ? theme.toolbar.activeBg : undefined }}
                                    onClick={() => { setMethod(id); setShowOriginal(false); }}
                                >
                                    <Icon className="mt-0.5 size-4 shrink-0" style={{ color: method === id ? theme.node.text : theme.node.placeholder }} />
                                    <span className="min-w-0">
                                        <span className="block text-xs font-medium">{t(`canvas.editors.blurMethods.${id}`)}</span>
                                        <span className="mt-1 block text-[11px] leading-relaxed" style={{ color: theme.node.placeholder }}>{t(`canvas.editors.blurHints.${id}`)}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </section>
                    <section className="border-t pt-5" style={{ borderColor: theme.toolbar.border }}>
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <h3 className="m-0 text-xs font-semibold">{t("canvas.editors.blurAmount")}</h3>
                            <InputNumber
                                size="small"
                                min={IMAGE_BLUR_AMOUNT.min}
                                max={IMAGE_BLUR_AMOUNT.max}
                                step={IMAGE_BLUR_AMOUNT.step}
                                precision={2}
                                controls={false}
                                disabled={applying}
                                value={amount}
                                aria-label={t("canvas.editors.blurAmount")}
                                style={{ width: 80, flexShrink: 0 }}
                                styles={{ input: { textAlign: "right", fontVariantNumeric: "tabular-nums" } }}
                                onChange={(value) => { if (value !== null) { setAmount(clampBlurAmount(value)); setShowOriginal(false); } }}
                            />
                        </div>
                        <input
                            type="range"
                            className="block h-4 w-full cursor-pointer disabled:opacity-40"
                            style={{ accentColor: theme.node.activeStroke }}
                            min={IMAGE_BLUR_AMOUNT.min}
                            max={IMAGE_BLUR_AMOUNT.max}
                            step={IMAGE_BLUR_AMOUNT.step}
                            disabled={applying}
                            value={amount}
                            aria-label={t("canvas.editors.blurAmount")}
                            onChange={(event) => { setAmount(clampBlurAmount(Number(event.target.value))); setShowOriginal(false); }}
                        />
                        <div className="mt-2 flex justify-between text-[10px] tabular-nums" style={{ color: theme.node.placeholder }}><span>{IMAGE_BLUR_AMOUNT.min.toFixed(2)}</span><span>{IMAGE_BLUR_AMOUNT.max.toFixed(2)}</span></div>
                        <p className="mb-0 mt-4 text-[11px] leading-relaxed" style={{ color: theme.node.placeholder }}>{t("canvas.editors.blurFineTune", { step: IMAGE_BLUR_AMOUNT.step.toFixed(2) })}</p>
                    </section>
                </aside>
            </div>
        </Modal>
    );
}
