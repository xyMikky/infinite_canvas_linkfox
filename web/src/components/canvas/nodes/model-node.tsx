import { Box, Hand, ImageDown, ImageIcon, LoaderCircle, Moon, RotateCcw, Sun, Upload } from "lucide-react";
import { nanoid } from "nanoid";
import { message as antdMessage } from "antd";
import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { imageMetadata } from "@/lib/canvas/canvas-node-factory";
import { canvasThemes } from "@/lib/canvas-theme";
import { isModel3dFileName, model3dMimeType } from "@/lib/canvas/model-3d-preview";
import type { Model3dViewerHandle } from "@/lib/canvas/model-3d-viewer";
import i18n from "@/i18n";
import { getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { useModelAngleExportStore } from "@/stores/canvas/use-model-angle-export-store";
import type { CanvasNodeData } from "@/types/canvas";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasNodeContext, CanvasNodeDefinition } from "@/types/canvas-plugin";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";

export const MODEL_NODE_TYPE = "model";

const NODE_WIDTH = 420;
const NODE_HEIGHT = 320;
const MAX_MODEL_BYTES = 32_000_000;
const MODEL_ACCEPT = ".glb,.gltf,.obj,.stl,.ply,.fbx,.dae,.3mf,.pcd,.vtk";
const PREVIEW_BG = { dark: "#1c1917", light: "#f5f5f4" } as const;
const CONTROL_CLASS = "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs transition-colors hover:bg-[var(--model-control-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 disabled:cursor-default disabled:opacity-35";

export async function createModelAngleImageNode(input: {
    node: CanvasNodeData;
    blob: Blob;
    prompt: string;
    applyOps: (ops: CanvasAgentOp[]) => void;
}) {
    const hide = antdMessage.loading(i18n.t("canvas.modelNode.exportAngleLoading"), 0);
    try {
        const uploaded = await uploadImage(input.blob);
        const maxSide = 420;
        const scale = Math.min(1, maxSide / Math.max(uploaded.width, uploaded.height));
        const width = Math.max(160, Math.round(uploaded.width * scale));
        const height = Math.max(120, Math.round(uploaded.height * scale));
        const id = `image-${nanoid()}`;
        input.applyOps([
            {
                type: "add_node",
                id,
                nodeType: CanvasNodeType.Image,
                title: i18n.t("canvas.modelNode.angleImageTitle"),
                position: { x: input.node.position.x + input.node.width + 96, y: input.node.position.y },
                width,
                height,
                metadata: { ...imageMetadata(uploaded), prompt: input.prompt },
            },
            { type: "connect_nodes", fromNodeId: input.node.id, toNodeId: id },
            { type: "select_nodes", ids: [id] },
        ]);
        antdMessage.success(i18n.t("canvas.modelNode.exportAngleDone"));
    } catch {
        antdMessage.error(i18n.t("canvas.modelNode.exportAngleFailed"));
        throw new Error("export failed");
    } finally {
        hide();
    }
}

export function getModelNodeDefinition(): CanvasNodeDefinition {
    return {
        type: MODEL_NODE_TYPE,
        title: i18n.t("canvas.nodeTypes.model"),
        description: i18n.t("canvas.modelNode.description"),
        icon: <Box className="size-5" />,
        defaultSize: { width: NODE_WIDTH, height: NODE_HEIGHT },
        defaultMetadata: {
            content: "",
            status: "idle",
            mimeType: "",
            storageKey: "",
            modelShowTextures: false,
            modelPreviewBg: "dark",
            interactive: false,
        },
        minimapColor: "#a78bfa",
        hidePanel: true,
        interactionToggle: true,
        hideInteractionToolbar: true,
        forceInteractive: (node) => !String(node.metadata?.storageKey || node.metadata?.content || "").trim(),
        keepAspectRatio: () => true,
        resource: (node) => {
            const name = (node.title || "").trim() || i18n.t("canvas.nodeTypes.model");
            if (!String(node.metadata?.storageKey || node.metadata?.content || "").trim()) return null;
            return { kind: "text", text: i18n.t("canvas.smartPreview.model3dLabel", { name }) };
        },
        Content: ModelNodeContent,
    };
}

function ModelNodeContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { t } = useTranslation();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [status, setStatus] = useState<"empty" | "loading" | "ready" | "missing" | "failed">("empty");
    const storageKey = String(ctx.node.metadata?.storageKey || "").trim();
    const fileName = String(ctx.node.metadata?.modelFileName || ctx.node.title || "").trim() || "model.glb";
    const interactive = Boolean(ctx.node.metadata?.interactive);
    const showTextures = Boolean(ctx.node.metadata?.modelShowTextures);
    const previewBg = ctx.node.metadata?.modelPreviewBg === "light" ? "light" : "dark";
    const background = PREVIEW_BG[previewBg];
    const previewTheme = canvasThemes[previewBg];
    const compact = ctx.node.width < 400;
    const viewerRef = useRef<Model3dViewerHandle | null>(null);
    const interactiveRef = useRef(interactive);
    const backgroundRef = useRef(background);
    interactiveRef.current = interactive;
    backgroundRef.current = background;

    // #region agent log
    useEffect(() => {
        fetch('http://127.0.0.1:7475/ingest/5542b978-a3f6-40e8-8231-ec6ddb075fc3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'deafa8'},body:JSON.stringify({sessionId:'deafa8',runId:'pre-fix-3',hypothesisId:'F',location:'model-node.tsx:channel',message:'model node rendered (log channel check)',data:{fileName,hasStorageKey:Boolean(storageKey)},timestamp:Date.now()})}).catch((error)=>console.warn('[agent log] ingest unreachable',error));
    }, [fileName, storageKey]);
    // #endregion

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !storageKey) {
            setStatus(storageKey ? "loading" : "empty");
            return;
        }
        let cancelled = false;
        setStatus("loading");
        void (async () => {
            try {
                if (!isModel3dFileName(fileName)) {
                    if (!cancelled) setStatus("failed");
                    return;
                }
                const blob = await getMediaBlob(storageKey);
                if (cancelled) return;
                if (!blob?.size) {
                    setStatus("missing");
                    return;
                }
                const buffer = await blob.arrayBuffer();
                if (cancelled) return;
                const { mountModel3dViewer } = await import("@/lib/canvas/model-3d-viewer");
                const handle = await mountModel3dViewer({
                    canvas,
                    buffer,
                    fileName,
                    interactive: interactiveRef.current,
                    background: backgroundRef.current,
                    showTextures,
                });
                if (cancelled) {
                    handle.dispose();
                    return;
                }
                viewerRef.current = handle;
                handle.setInteractive(interactiveRef.current);
                handle.setBackground(backgroundRef.current);
                setStatus("ready");
            } catch {
                if (!cancelled) setStatus("failed");
            }
        })();
        return () => {
            cancelled = true;
            viewerRef.current?.dispose();
            viewerRef.current = null;
        };
    }, [fileName, showTextures, storageKey]);

    useEffect(() => {
        viewerRef.current?.setInteractive(interactive);
    }, [interactive]);

    useEffect(() => {
        viewerRef.current?.setBackground(background);
    }, [background]);

    const openExportDialog = () => {
        const viewer = viewerRef.current;
        if (!viewer) {
            antdMessage.error(t("canvas.modelNode.exportAngleFailed"));
            return;
        }
        useModelAngleExportStore.getState().setSession({
            nodeId: ctx.node.id,
            storageKey,
            fileName,
            background,
            showTextures,
            pose: viewer.getPose(),
        });
    };

    const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        if (!isModel3dFileName(file.name)) {
            setStatus("failed");
            return;
        }
        if (file.size > MAX_MODEL_BYTES) {
            setStatus("failed");
            return;
        }
        setStatus("loading");
        try {
            const typed =
                file.type && file.type !== "application/octet-stream"
                    ? file
                    : new File([file], file.name, { type: model3dMimeType(file.name) });
            const uploaded = await uploadMediaFile(typed, "model");
            ctx.updateNode({ title: file.name });
            ctx.updateMetadata({
                content: uploaded.url,
                storageKey: uploaded.storageKey,
                bytes: uploaded.bytes,
                mimeType: model3dMimeType(file.name) || uploaded.mimeType,
                modelFileName: file.name,
                modelShowTextures: false,
                modelPreviewBg: ctx.node.metadata?.modelPreviewBg === "light" ? "light" : "dark",
                status: "success",
                errorDetails: undefined,
            });
        } catch {
            setStatus("failed");
        }
    };

    if (!storageKey) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-4" data-canvas-no-zoom>
                <input ref={inputRef} type="file" accept={MODEL_ACCEPT} className="hidden" onChange={(event) => void onPick(event)} />
                <Box className="size-8" strokeWidth={1.25} style={{ color: ctx.theme.node.placeholder }} aria-hidden />
                <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-black/5 dark:hover:bg-white/10"
                    style={{ color: ctx.theme.node.text }}
                    onClick={(event) => {
                        event.stopPropagation();
                        inputRef.current?.click();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <Upload className="size-4" />
                    {t("canvas.modelNode.upload")}
                </button>
                <div className="text-center text-xs" style={{ color: ctx.theme.node.placeholder }}>
                    {t("canvas.modelNode.hint")}
                </div>
            </div>
        );
    }

    return (
        <div
            className="flex h-full min-h-0 w-full flex-col"
            data-canvas-no-zoom
            style={{ background, color: previewTheme.node.text, "--model-control-hover": previewTheme.toolbar.itemHover } as CSSProperties}
        >
            <div className="relative min-h-0 flex-1">
                <canvas ref={canvasRef} className={`h-full w-full ${interactive ? "cursor-grab active:cursor-grabbing" : ""}`} />
                {status !== "ready" ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-4 text-center text-xs" style={{ color: previewTheme.node.placeholder }} role="status">
                        {status === "loading" ? <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" /> : <Box className="size-6" strokeWidth={1.25} />}
                        <span>
                            {status === "loading"
                                ? t("canvas.smartPreview.model3dLoading")
                                : status === "missing"
                                  ? t("canvas.smartPreview.model3dMissing")
                                  : t("canvas.smartPreview.model3dFailed")}
                        </span>
                    </div>
                ) : interactive && !compact ? (
                    <div className="pointer-events-none absolute inset-x-3 bottom-2 text-center text-[10px]" style={{ color: previewTheme.node.placeholder }}>
                        {t("canvas.modelNode.interactionHint")}
                    </div>
                ) : null}
            </div>
            <div
                className="pointer-events-auto flex h-11 shrink-0 items-center gap-1 border-t px-2"
                style={{ borderColor: `${previewTheme.toolbar.border}66` }}
                role="group"
                aria-label={t("canvas.modelNode.previewControls")}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
            >
                <button
                    type="button"
                    className={CONTROL_CLASS}
                    style={{ background: interactive ? previewTheme.toolbar.activeBg : undefined }}
                    title={t(interactive ? "canvas.plugins.interactiveTitle" : "canvas.plugins.movableTitle")}
                    aria-label={t("canvas.plugins.interact")}
                    aria-pressed={interactive}
                    disabled={status !== "ready"}
                    onClick={() => ctx.updateMetadata({ interactive: !interactive })}
                >
                    <Hand className="size-3.5" />
                    {!compact ? t("canvas.plugins.interact") : null}
                </button>
                <div className="min-w-0 flex-1" />
                <button
                    type="button"
                    className={CONTROL_CLASS}
                    title={t(previewBg === "dark" ? "canvas.modelNode.bgLight" : "canvas.modelNode.bgDark")}
                    aria-label={t(previewBg === "dark" ? "canvas.modelNode.bgLight" : "canvas.modelNode.bgDark")}
                    onClick={() => ctx.updateMetadata({ modelPreviewBg: previewBg === "dark" ? "light" : "dark" })}
                >
                    {previewBg === "dark" ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
                    {!compact ? t(previewBg === "dark" ? "canvas.modelNode.bgDarkShort" : "canvas.modelNode.bgLightShort") : null}
                </button>
                <button
                    type="button"
                    className={CONTROL_CLASS}
                    title={t(showTextures ? "canvas.modelNode.texturesOff" : "canvas.modelNode.texturesOn")}
                    aria-label={t("canvas.modelNode.textures")}
                    aria-pressed={showTextures}
                    disabled={status !== "ready"}
                    onClick={() => ctx.updateMetadata({ modelShowTextures: !showTextures })}
                >
                    {showTextures ? <ImageIcon className="size-3.5" /> : <Box className="size-3.5" />}
                    {!compact ? t(showTextures ? "canvas.modelNode.textures" : "canvas.modelNode.clay") : null}
                </button>
                <button
                    type="button"
                    className={CONTROL_CLASS}
                    title={t("canvas.modelNode.exportAngle")}
                    aria-label={t("canvas.modelNode.exportAngle")}
                    disabled={status !== "ready"}
                    onClick={openExportDialog}
                >
                    <ImageDown className="size-3.5" />
                    {!compact ? t("canvas.modelNode.exportAngle") : null}
                </button>
                <button
                    type="button"
                    className={CONTROL_CLASS}
                    title={t("canvas.modelNode.resetAngle")}
                    aria-label={t("canvas.modelNode.resetAngle")}
                    disabled={status !== "ready"}
                    onClick={() => viewerRef.current?.resetCamera()}
                >
                    <RotateCcw className="size-3.5" />
                </button>
            </div>
        </div>
    );
}
