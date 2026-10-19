import { useEffect, useRef, useState, type DragEvent } from "react";
import { Button, Modal } from "antd";
import { Layers, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { createPhotopeaClient, PHOTOPEA_ORIGIN, PHOTOPEA_SAVE_REQUEST } from "@/lib/canvas/photopea-client";
import { photopeaNodeImageSource, readPhotopeaImageBlob } from "@/lib/canvas/photopea-image";
import { readSidePanelInsertFromDataTransfer, resolveSidePanelInsertPayloadAsync, SIDE_PANEL_INSERT_MIME } from "@/lib/canvas/side-panel-insert-drag";
import { readFileAsDataUrl } from "@/lib/image-utils";
import { usePhotopeaLayerStore, type PhotopeaLayerImage } from "@/stores/canvas/use-photopea-layer-store";
import { CANVAS_OVERLAY_MODAL_Z_INDEX, useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData } from "@/types/canvas";

export type PhotopeaApplyMode = "replace" | "new";

export function CanvasPhotopeaEditor({
    node, open, onClose, onApply,
}: {
    node: CanvasNodeData | null;
    open: boolean;
    onClose: () => void;
    onApply: (blob: Blob, mode: PhotopeaApplyMode) => Promise<void>;
}) {
    const { t, i18n } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const sidePanelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const sidePanelWidth = useCanvasSidePanelStore((state) => state.width);
    const panelLeft = sidePanelOpen ? sidePanelWidth : 0;
    useEffect(() => {
        // 弹窗会遮住顶栏开关，进入编辑时先露出画布/资产图片入口。
        if (open) useCanvasSidePanelStore.getState().openPanel();
    }, [open]);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const saveRef = useRef<((mode: PhotopeaApplyMode) => void) | null>(null);
    const [frameSrc, setFrameSrc] = useState("");
    const [attempt, setAttempt] = useState(0);
    const [ready, setReady] = useState(false);
    const [connectionLost, setConnectionLost] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [pending, setPending] = useState(0);
    const [saving, setSaving] = useState(false);
    const [dropHover, setDropHover] = useState(false);

    useEffect(() => {
        if (!open || !node) {
            setFrameSrc("");
            return;
        }
        // 一次打开绑定原节点与保存动作；主题/语言变化不重载 iframe，以免丢失未保存的图层。
        let cancelled = false;
        let unavailable = false;
        let count = 0;
        let queue = Promise.resolve();
        const client = createPhotopeaClient(() => frameRef.current?.contentWindow);
        setReady(false);
        setConnectionLost(false);
        setError("");
        setNotice("");
        setPending(0);
        setSaving(false);
        setDropHover(false);
        const config = {
            environment: {
                theme: useThemeStore.getState().theme === "dark" ? 1 : 0,
                lang: i18n.language.startsWith("zh") ? "zh" : "en",
                intro: false,
                customIO: { save: `app.echoToOE("${PHOTOPEA_SAVE_REQUEST}");` },
            },
        };
        setFrameSrc(`${PHOTOPEA_ORIGIN}#${encodeURIComponent(JSON.stringify(config))}`);
        const readImage = async (image: PhotopeaLayerImage) => {
            const blob = await readPhotopeaImageBlob(image);
            if (cancelled) throw new Error("photopea-closed");
            return blob;
        };
        const initialization = (async () => {
            const [buffer] = await Promise.all([
                readImage(photopeaNodeImageSource(node))
                    .then((blob) => blob.arrayBuffer())
                    .catch(() => { throw new Error("photopea-image-read"); }),
                client.ready,
            ]);
            await client.openImage(buffer);
            if (!cancelled) setReady(true);
        })();
        void initialization.catch((reason) => {
            if (cancelled) return;
            unavailable = true;
            client.dispose();
            const code = reason instanceof Error ? reason.message : "";
            setError(t(code === "photopea-load-timeout" ? "canvas.editors.photopeaLoadFailed"
                : code === "photopea-image-read" ? "canvas.editors.photopeaLoadImageFailed" : "canvas.editors.photopeaOpenImageFailed"));
        });
        const enqueue = (task: () => Promise<void>) => {
            if (cancelled || unavailable) return;
            count += 1;
            frameRef.current?.blur();
            setPending(count);
            setNotice("");
            queue = queue.then(() => initialization).then(async () => {
                if (!cancelled && !unavailable) await task();
            }).catch((reason) => {
                if (cancelled) return;
                const code = reason instanceof Error ? reason.message : "";
                if (code === "photopea-command-timeout" || code === "photopea-closed") {
                    unavailable = true;
                    setConnectionLost(true);
                    setNotice(t("canvas.editors.photopeaConnectionLost"));
                } else setNotice(t(code === "no-document" ? "canvas.editors.photopeaEmpty" : "canvas.editors.photopeaOperationFailed"));
            }).finally(() => {
                count -= 1;
                if (!cancelled) setPending(count);
            });
        };
        const unregister = usePhotopeaLayerStore.getState().register((image) => enqueue(async () => {
            const buffer = await (await readImage(image)).arrayBuffer();
            await client.openLayer(buffer, image.title || t("canvas.editors.photopeaLayer"));
        }));
        saveRef.current = (mode) => {
            if (count || cancelled) return;
            enqueue(async () => {
                setSaving(true);
                try {
                    const buffer = await client.run('app.activeDocument.saveToOE("png");');
                    if (cancelled) return;
                    if (!buffer?.byteLength) throw new Error("empty-image");
                    await onApply(new Blob([buffer], { type: "image/png" }), mode);
                } finally {
                    if (!cancelled) setSaving(false);
                }
            });
        };
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== PHOTOPEA_ORIGIN || event.source !== frameRef.current?.contentWindow) return;
            if (event.data === PHOTOPEA_SAVE_REQUEST) saveRef.current?.("replace");
            else client.receive(event);
        };
        window.addEventListener("message", onMessage);
        return () => {
            cancelled = true;
            unregister();
            saveRef.current = null;
            client.dispose();
            window.removeEventListener("message", onMessage);
        };
    }, [open, node?.id, attempt]);

    const onDrop = async (event: DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setDropHover(false);
        const handler = usePhotopeaLayerStore.getState().handler;
        if (!handler) return;
        const drag = readSidePanelInsertFromDataTransfer(event.dataTransfer);
        const files = [...event.dataTransfer.files].filter((file) => file.type.startsWith("image/"));
        try {
            if (drag) {
                const payload = await resolveSidePanelInsertPayloadAsync(drag);
                if (payload?.kind !== "image") throw new Error("unsupported-image");
                handler({ url: payload.dataUrl, storageKey: payload.storageKey, title: payload.title });
            } else if (files.length) {
                for (const file of files) handler({ url: await readFileAsDataUrl(file), title: file.name });
            } else throw new Error("unsupported-image");
        } catch {
            if (usePhotopeaLayerStore.getState().handler === handler) setNotice(t("canvas.editors.photopeaImportFailed"));
        }
    };

    return (
        <Modal
            title={t("canvas.editors.photopeaTitle")}
            open={open}
            onCancel={onClose}
            width={`calc(100vw - ${panelLeft + 40}px)`}
            centered
            maskClosable={false}
            destroyOnHidden
            zIndex={CANVAS_OVERLAY_MODAL_Z_INDEX}
            getContainer={() => document.body}
            footer={
                <div className="flex flex-col gap-3">
                    <div
                        className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2 text-left"
                        style={{ borderColor: dropHover ? theme.node.activeStroke : theme.node.stroke, color: theme.node.muted, background: dropHover ? theme.toolbar.itemHover : "transparent" }}
                        onDragOver={(event) => {
                            if (![...event.dataTransfer.types].some((type) => type === SIDE_PANEL_INSERT_MIME || type === "Files")) return;
                            event.preventDefault();
                            event.stopPropagation();
                            event.dataTransfer.dropEffect = "copy";
                            setDropHover(true);
                        }}
                        onDragLeave={() => setDropHover(false)}
                        onDrop={(event) => void onDrop(event)}
                    >
                        <button type="button" className="inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-xs hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} onClick={() => useCanvasSidePanelStore.getState().openPanel()}>
                            <Layers className="size-3.5" />{t("canvas.editors.photopeaImportLayer")}
                        </button>
                        <span className="min-w-0 flex-1 text-xs" role="status">{pending ? t(saving ? "canvas.editors.photopeaSaving" : "canvas.editors.photopeaImporting", { count: pending }) : t("canvas.editors.photopeaImportHint")}</span>
                    </div>
                    {notice ? <div className="flex items-center gap-2 text-left text-xs" role="alert" style={{ color: theme.node.text }}>
                        <span className="flex-1">{notice}</span>
                        <button type="button" onClick={() => setNotice("")} aria-label={t("common.close")}><X className="size-3.5" /></button>
                    </div> : null}
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button onClick={onClose}>{t("common.cancel")}</Button>
                        <Button onClick={() => saveRef.current?.("new")} loading={saving} disabled={!ready || Boolean(error) || connectionLost || pending > 0}>
                            {t("canvas.editors.photopeaSaveNew")}
                        </Button>
                        <Button type="primary" onClick={() => saveRef.current?.("replace")} loading={saving} disabled={!ready || Boolean(error) || connectionLost || pending > 0}>
                            {t("canvas.editors.photopeaSaveCurrent")}
                        </Button>
                    </div>
                </div>
            }
            styles={{
                container: { display: "flex", flexDirection: "column", maxHeight: "calc(100dvh - 32px)" },
                header: { flexShrink: 0 },
                footer: { flexShrink: 0 },
                body: { padding: 0, height: "68vh", minHeight: 0, flex: "1 1 auto", overflow: "hidden" },
                mask: { left: panelLeft },
                wrapper: { left: panelLeft },
            }}
            modalRender={(content) => (
                <div
                    data-canvas-shortcuts-ignore
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onContextMenu={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                >{content}</div>
            )}
        >
            <div className="relative h-full overflow-hidden">
                {frameSrc ? <iframe key={`${node?.id}:${attempt}`} ref={frameRef} title="Photopea" src={frameSrc} className="absolute inset-0 h-full w-full border-0" /> : null}
                {!ready || error ? (
                    <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm" style={{ background: theme.node.panel, color: theme.node.text }}>
                        <div className="flex flex-col items-center gap-3" role={error ? "alert" : "status"}>
                            <span>{error || t("canvas.editors.photopeaLoading")}</span>
                            {error ? <Button type="text" icon={<RotateCcw className="size-3.5" />} onClick={() => setAttempt((value) => value + 1)}>{t("common.retry")}</Button> : null}
                        </div>
                    </div>
                ) : pending > 0 ? <div className="absolute inset-0 cursor-progress" aria-hidden /> : null}
            </div>
        </Modal>
    );
}
