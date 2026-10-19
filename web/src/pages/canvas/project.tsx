import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, Ref } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Group, Video } from "lucide-react";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { requestEdit, requestGeneration, requestImageQuestion } from "@/services/api/image";
import { isPlainTextToImageEndpoint, prepareRunninghubImageRefs } from "@/services/api/runninghub-image";
import { clearRunninghubImageUploadCache } from "@/services/api/runninghub-client";
import { requestAudioGeneration, requestLyricsGeneration, storeGeneratedAudio } from "@/services/api/audio";
import { requestVideoGeneration, storeGeneratedVideo } from "@/services/api/video";
import { requestModelGeneration, storeGeneratedModel } from "@/services/api/model";
import { closedGenerationError, defaultConfig, isCodexCliTextModel, resolveModelRequestConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { buildCodexTextSystemPrompt, useCodexTextJobStore, waitForCodexTextJob } from "@/stores/use-codex-text-job-store";
import { imageToDataUrl, resolveImageUrl, uploadImage, getImageBlob } from "@/services/image-storage";
import { getMediaBlob, resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { nanoid } from "nanoid";
import { onCanvasEvent } from "@/lib/canvas/canvas-event-bus";
import { Streamdown } from "streamdown";
import { getDataUrlByteSize, readImageMeta, stripImageMetadata } from "@/lib/image-utils";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useAssetStore } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { fitNodesViewport } from "@/lib/canvas/canvas-viewport-coords";
import { cropDataUrl, splitDataUrl } from "@/lib/canvas/canvas-image-data";
import { blurImageDataUrl, type ImageBlurOptions } from "@/lib/canvas/image-blur";
import { runRhCompositePipeline } from "@/lib/canvas/rh-composite-run";
import { runRhCutoutPipeline } from "@/lib/canvas/rh-cutout";
import { CanvasNodeRhUpscaleDialog, type RhUpscaleDialogParams } from "@/components/canvas/canvas-node-rh-upscale-dialog";
import { fitNodeSize, nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import { App, Button, Modal } from "antd";
import { NODE_DEFAULT_SIZE, getNodeSpec } from "@/constant/canvas";
import { CanvasConnectionsLayer } from "@/components/canvas/canvas-connections-layer";
import { CanvasNodesLayer, type CanvasNodesLayerHandle } from "@/components/canvas/canvas-nodes-layer";
import { CanvasConnectionLabelEditor } from "@/components/canvas/canvas-connection-label-editor";
import { CanvasConfigComposer } from "@/components/canvas/canvas-config-composer";
import { CanvasConfigNodePanel } from "@/components/canvas/canvas-config-node-panel";
import { countWorkbenchRuns } from "@/lib/canvas/workbench-state";
import { CanvasNodeContextMenu } from "@/components/canvas/canvas-context-menu";
import { CanvasNodeAngleDialog, type CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import { CanvasNodeCropDialog, type CanvasImageCropRect } from "@/components/canvas/canvas-node-crop-dialog";
import { CanvasNodeBlurDialog } from "@/components/canvas-node-blur-dialog";
import { CanvasNodePaintDialog } from "@/components/canvas-node-paint-dialog";
import { CanvasNodeOutpaintDialog } from "@/components/canvas-node-outpaint-dialog";
import { CanvasPhotopeaEditor, type PhotopeaApplyMode } from "@/components/canvas-photopea-editor";
import { CanvasPinterestSearch } from "@/components/canvas-pinterest-search";
import type { CanvasImageMaskEditPayload } from "@/lib/canvas/local-edit-selection";
import { CanvasVideoLocalEditDialog } from "@/components/canvas/canvas-video-local-edit-dialog";
import type { VideoLocalEditSelection } from "@/lib/canvas/video-local-edit";
import { prepareVideoLocalEdit } from "@/lib/canvas/video-local-edit-media";
import { LOCAL_VIDEO_EDIT_MODEL } from "@/lib/canvas/video-local-edit-model";
import { generateVideoLocalEdit } from "@/lib/canvas/video-local-edit-generation";
import { applyVideoLocalEditRestore } from "@/lib/canvas/video-local-edit-commit";
import { CanvasNodeSplitDialog, type CanvasImageSplitParams } from "@/components/canvas/canvas-node-split-dialog";
import { buildNodeGenerationContext, buildNodeGenerationInputs, buildNodeResponseMessages, hydrateNodeGenerationContext, type NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import { buildAddCodexSkillNodeOp, collectUpstreamCodexSkillsFromGraph, readCodexSkillFromDataTransfer } from "@/components/canvas/nodes/codex-skill-node";
import { buildAddFolderNodeOp, FOLDER_NODE_TYPE } from "@/components/canvas/nodes/folder-node";
import { MODEL_NODE_TYPE, createModelAngleImageNode } from "@/components/canvas/nodes/model-node";
import { useModelAngleExportStore } from "@/stores/canvas/use-model-angle-export-store";
import { ModelAngleExportDialog } from "@/components/canvas/nodes/model-angle-export-dialog";
import { CanvasReportDialog } from "@/components/canvas/canvas-report-dialog";
import { SMART_PREVIEW_NODE_TYPE } from "@/components/canvas/nodes/smart-preview-node";
import { computeMindNodeSize, DEFAULT_MIND_COLOR, mindRootDefaultSize, mindTopicDefaultSize } from "@/components/canvas/nodes/mind-node";
import {
    isAnnotationNode,
    isMindCreateType,
    isMindNode,
    isMindSideCollapsed,
    isDecisionNode,
    collectMindCollapsedNodeIds,
    MIND_CREATE_CHILD,
    MIND_CREATE_ROOT,
    MIND_NODE_TYPE,
    mindChildrenOf,
    mindKindFromCreateType,
    mindLinkKind,
    mindParentOf,
    mindSideNeighbors,
    mindNodeSideAnchor,
    nearestMindHandleSide,
    nextDecisionBranchLabel,
    resolveMindConnection,
    orderAnnotationConnection,
    placeMindChildPosition,
    placeMindNeighborPosition,
    placeMindSiblingPosition,
    positionMindNodeAfterResize,
    resolveConnectionKind,
    toggleMindCollapsedSides,
    type MindCollapseSide,
} from "@/lib/canvas/mind-map";
import { getExcelSheet, stashExcelSheets } from "@/lib/canvas/excel-sheet-cache";
import { addFolderAssetFromNode, buildFolderNodeOpFromAsset } from "@/lib/canvas/folder-asset";
import { captureDropSnapshot, collectDroppedFolders, collectDroppedLooseFiles } from "@/lib/canvas/folder-drop";
import { folderCopyLimitBytes, persistDroppedFolder, persistDroppedLooseFile } from "@/lib/canvas/folder-desktop-storage";
import { stashFolderPreviewSources } from "@/lib/canvas/folder-preview-cache";
import { buildStandaloneSmartPreviewOp, isStandalonePreviewDropFile } from "@/lib/canvas/standalone-preview-drop";
import { isModel3dFileName, model3dMimeType } from "@/lib/canvas/model-3d-preview";
import { applyCanvasNodesToComposer, isCodexPanelConnectTarget, isPointOverCodexPanelDropZone } from "@/lib/agent/canvas-selection-to-composer";
import { isPointOverAssetDropZone, isPointOverPromptDropZone, readSidePanelInsertFromDataTransfer, resolveSidePanelInsertPayloadAsync, setCanvasAssetDropHover, setCanvasPromptDropHover } from "@/lib/canvas/side-panel-insert-drag";
import { readToolbarCreateNodeFromDataTransfer } from "@/lib/canvas/toolbar-create-node-drag";
import { CODEX_IMAGE_NODE_TYPE } from "@/stores/use-codex-image-job-store";
import { buildPromptAssetCanvasNodes, persistPromptAssetMedia, previewPromptAssetFromNodes, type PromptAssetDraft } from "@/lib/canvas/prompt-asset";
import { PromptAssetSaveDialog } from "@/pages/prompts/components/prompt-asset-save-dialog";
import { createLocalPrompt, LOCAL_PROMPT_SOURCE_ID } from "@/services/api/local-prompts";
import { promptGroupKey } from "@/lib/library-groups";
import { useLibraryGroupAssignment } from "@/hooks/use-library-group-assignment";
import { useLibraryGroupStore } from "@/stores/use-library-group-store";
import { useQueryClient } from "@tanstack/react-query";
import { copyNodeImageToSystemClipboard, isCopyableImageNode } from "@/lib/canvas/copy-image-to-clipboard";
import { canUseAsyncClipboard, dataTransferHasImageHint, readImageFilesFromDataTransfer } from "@/lib/clipboard";
import { CanvasNodeHoverToolbar, CanvasNodeInfoModal, applyHoverToolbarScreenPosition } from "@/components/canvas/canvas-node-hover-toolbar";
import { InfiniteCanvas, type InfiniteCanvasHandle } from "@/components/canvas/infinite-canvas";
import { Minimap } from "@/components/canvas/canvas-mini-map";
import { CanvasNode, cancelCanvasNodeTouchInteraction } from "@/components/canvas/canvas-node";
import { isCanvasTouchPinchActive } from "@/lib/canvas/touch-pinch";
import { CanvasNodePromptPanel, type CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasToolbar } from "@/components/canvas/canvas-toolbar";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { CanvasSidePanel } from "@/components/canvas/canvas-side-panel";
import { CanvasZoomControls } from "@/components/canvas/canvas-zoom-controls";
import { useAgentStore } from "@/stores/use-agent-store";
import type { AgentAttachment } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAgentBridge } from "@/pages/canvas/hooks/use-agent-bridge";
import { usePluginHost } from "@/pages/canvas/hooks/use-plugin-host";
import { buildNodeMentionReferences, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { arrangeSelectedNodes as layoutSelectedNodePositions } from "@/lib/canvas/arrange-nodes";
import { alignConnectionById } from "@/lib/canvas/align-connection-points";
import { LOCAL_EDIT_BANANA_MODEL, LOCAL_EDIT_DEFAULT_RESOLUTION, smartCropFromBox, uncropPaste } from "@/lib/canvas/banana-local-edit";
import { OUTPAINT_MODEL, OUTPAINT_RESOLUTION, OUTPAINT_SIZE, composeOutpaintWorkImage, outpaintImageRect, type OutpaintBox } from "@/lib/canvas/outpaint";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { getAudioDownloadBlob } from "@/lib/canvas/audio-clip";
import { getVideoDownloadBlob, assertCanvasVideoDuration } from "@/lib/canvas/video-clip";
import { applyNodeConfigPatch, audioMetadata, buildAudioGenerationMetadata, buildImageGenerationMetadata, createCanvasNode, ensureWorkbenchNodeSize, fitWorkbenchNodeHeight, imageMetadata, modelMetadata, videoMetadata } from "@/lib/canvas/canvas-node-factory";
import { isRunninghubLyricsConfig } from "@/lib/canvas/audio-setting-schema";
import { buildGroupBundleText, isDataGroup, suggestDataGroupTitle } from "@/lib/canvas/canvas-group-bundle";
import { boundsForGroupFrame, collectConnectedComponentIds, collectGroupDragMemberIds, distanceToNodeBorder, expandSelectionByConnections, findContainingGroupId, findGroupDropTarget, getConnectionTargetAnchor, isDataGroupBorderHit, nearestBorderAnchor, normalizeConnection, sideToRelativeAnchor, snapNodesIntoGroup } from "@/lib/canvas/canvas-node-geometry";
import { absoluteXingSurfacePoint, isNearXingSurface, isXingXiaochiNode, nearestXingSurfaceAnchor, sideToXingSurfaceAnchor, worldToXingAnchor } from "@/lib/canvas/xing-xiaochi-ports";
import { getLiveXingWorldPoint } from "@/lib/canvas/xing-xiaochi-live-registry";
import { snapDragToNearbyNodes, smoothSnapOffset, type AlignGuide } from "@/lib/canvas/snap-node-align";
import { buildConnectionHitItems, connectionLabelWorld, getConnectionEndpoints, hitTestConnectionAt, isConnectionDashed, sameConnectionNodeGeometry } from "@/lib/canvas/canvas-connection-geometry";
import { useCanvasInteractionStore } from "@/stores/canvas/use-canvas-interaction-store";
import { useCanvasRoomStore } from "@/stores/canvas/use-canvas-room-store";
import { getVerticalResultPlacement, RESULT_COLUMN_GAP, RESULT_STACK_OFFSET_X } from "@/lib/canvas/canvas-batch-layout";
import { runninghubImagesPerTask } from "@/services/api/runninghub-models";
import { flattenBatchImageNodes } from "@/lib/canvas/flatten-batch-images";
import {
    audioExtension,
    buildAngleLabel,
    buildAnglePrompt,
    buildGenerationConfig,
    findRetrySourceNode,
    generationReferenceUrls,
    getGenerationCount,
    getImageSettingsReferenceOptions,
    getInputSummary,
    hydrateAssistantImages,
    hydrateCanvasImages,
    imageExtension,
    isAudioFile,
    isGenerationCanceled,
    resetInterruptedGeneration,
    cloneCanvasNodeData,
    resolveMetadataReferences,
    sourceNodeReferenceImages,
} from "@/lib/canvas/canvas-generation-helpers";
import {
    bindCanvasGenerationView,
    createCanvasGenerationScope,
    finishCanvasGenerationRequest,
    hasLiveCanvasGeneration,
    listCanvasGenerationRequests,
    liveRunningNodeIdForProject,
    patchGenerationNodes,
} from "@/lib/canvas/canvas-generation-runtime";
import { getNodeDefinition, isBuiltinNodeType as isBuiltinType, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { shouldPersistProjectToLocal, useCanvasRoomSync } from "@/hooks/use-canvas-room-sync";
import { clearRoomMediaContext, setRoomMediaContext } from "@/lib/canvas/room/room-media-context";
import { registerBuiltinNodes } from "@/components/canvas/nodes/builtin-nodes";
import { CanvasRefreshShell } from "@/components/canvas/canvas-refresh-shell";
import { CanvasTopBar } from "@/components/canvas/canvas-top-bar";
import { CanvasShareModal } from "@/components/canvas/canvas-share-modal";
import { ConnectionCreateMenu, NodeCreateMenu, connectionCreateMenuPositionFromAttach, type PendingConnectionCreate } from "@/components/canvas/canvas-create-menus";
import {
    CanvasNodeType,
    type CanvasAssistantImage,
    type CanvasAssistantSession,
    type CanvasConnection,
    type CanvasNodeData,
    type CanvasNodeImage,
    type CanvasNodeMetadata,
    type CanvasNodeTypeId,
    type ConnectionHandle,
    type ConnectionHandleSide,
    type ContextMenuState,
    type Position,
    type SelectionBox,
    type ViewportTransform,
} from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio } from "@/types/media";

// Register built-in nodes in the shared registry once when the module loads.
registerBuiltinNodes();

type CanvasClipboard = {
    marker: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

type ConnectionDropTarget = {
    nodeId: string | null;
    isNearNode: boolean;
    side?: ConnectionHandleSide;
};

type CanvasHistoryEntry = Pick<CanvasClipboard, "nodes" | "connections"> & {
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
};

function sameHistoryEntry(a: CanvasHistoryEntry | null, b: CanvasHistoryEntry) {
    return !!a && a.nodes === b.nodes && a.connections === b.connections && a.chatSessions === b.chatSessions &&
        a.activeChatId === b.activeChatId && a.backgroundMode === b.backgroundMode && a.showImageInfo === b.showImageInfo;
}

const VIDEO_NODE_MAX_WIDTH = 420;
const VIDEO_NODE_MAX_HEIGHT = 420;
// Stable empty reference array prevents `... || []` from invalidating CanvasNode's React.memo on every render.
const EMPTY_REFERENCES: CanvasResourceReference[] = [];
const CONNECTION_HANDLE_HIT_RADIUS = 40;
const CONNECTION_NODE_HIT_PADDING = 32;
const NODE_STATUS_IDLE = "idle" as const;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;

const ALIGN_GUIDE_FADE_IN_MS = 70;
const ALIGN_GUIDE_FADE_OUT_MS = 120;

type HeldAlignGuide = AlignGuide & { opacity: number };

function alignGuideKey(guide: AlignGuide) {
    const base = `${guide.axis}:${Math.round(guide.position * 10)}`;
    return guide.kind === "spacing" ? `s:${base}:${Math.round(guide.start * 10)}` : base;
}

function useHeldAlignGuides(guides: AlignGuide[]) {
    const [held, setHeld] = useState<HeldAlignGuide[]>([]);
    const signature = guides.map((guide) => `${alignGuideKey(guide)}:${guide.start}:${guide.end}`).join("|");

    useEffect(() => {
        const incoming = new Map(guides.map((guide) => [alignGuideKey(guide), guide]));
        setHeld((current) => {
            const next: HeldAlignGuide[] = [];
            const seen = new Set<string>();
            for (const guide of guides) {
                seen.add(alignGuideKey(guide));
                next.push({ ...guide, opacity: 1 });
            }
            for (const item of current) {
                if (seen.has(alignGuideKey(item))) continue;
                next.push({ ...item, opacity: 0 });
            }
            return next;
        });
        const timer = window.setTimeout(() => {
            setHeld((current) => current.filter((item) => item.opacity > 0 || incoming.has(alignGuideKey(item))));
        }, ALIGN_GUIDE_FADE_OUT_MS);
        return () => window.clearTimeout(timer);
    }, [signature]);

    return held;
}

/** 等距对齐参考线：间隙中的线段 + 两端刻度 */
function SpacingGuideLine({ guide, zoom }: { guide: HeldAlignGuide; zoom: number }) {
    const stroke = Math.max(1 / Math.max(zoom, 0.01), 0.5);
    const tick = 8 / Math.max(zoom, 0.01);
    const length = Math.max(0, guide.end - guide.start);
    const horizontal = guide.axis === "y";
    const color = "#f43f5e";
    const tickStyle = (atEnd: boolean): CSSProperties =>
        horizontal
            ? { position: "absolute", top: -tick / 2, [atEnd ? "right" : "left"]: 0, width: 0, height: tick, borderLeft: `${stroke}px solid ${color}` }
            : { position: "absolute", left: -tick / 2, [atEnd ? "bottom" : "top"]: 0, width: tick, height: 0, borderTop: `${stroke}px solid ${color}` };
    return (
        <div
            className="absolute"
            style={{
                left: horizontal ? guide.start : guide.position,
                top: horizontal ? guide.position : guide.start,
                width: horizontal ? length : 0,
                height: horizontal ? 0 : length,
                borderTop: horizontal ? `${stroke}px solid ${color}` : undefined,
                borderLeft: horizontal ? undefined : `${stroke}px solid ${color}`,
                opacity: guide.opacity,
                transition: `opacity ${guide.opacity ? ALIGN_GUIDE_FADE_IN_MS : ALIGN_GUIDE_FADE_OUT_MS}ms ease-out`,
            }}
        >
            <div style={tickStyle(false)} />
            <div style={tickStyle(true)} />
        </div>
    );
}

type CanvasAlignGuidesHandle = { setGuides: (guides: AlignGuide[]) => void };

function CanvasAlignGuides({ ref, zoom }: { ref: Ref<CanvasAlignGuidesHandle>; zoom: number }) {
    const [guides, setGuides] = useState<AlignGuide[]>([]);
    // 高频辅助线只更新自身，避免每次拖动都重新渲染整张画布页面。
    useImperativeHandle(ref, () => ({
        setGuides: (next) => setGuides((current) =>
            current.length === next.length && current.every((guide, index) => {
                const other = next[index];
                return guide.axis === other.axis && guide.position === other.position &&
                    guide.start === other.start && guide.end === other.end && guide.kind === other.kind;
            }) ? current : next),
    }), []);
    const held = useHeldAlignGuides(guides);
    const stroke = Math.max(1 / Math.max(zoom, 0.01), 0.5);
    const glow = 2 / Math.max(zoom, 0.01);
    if (!held.length) return null;
    return (
        <div className="pointer-events-none absolute left-0 top-0 z-[90]">
            {held.map((guide) =>
                guide.kind === "spacing" ? (
                    <SpacingGuideLine key={alignGuideKey(guide)} guide={guide} zoom={zoom} />
                ) : guide.axis === "x" ? (
                    <div
                        key={`x:${guide.position}`}
                        className="absolute"
                        style={{
                            left: guide.position,
                            top: guide.start,
                            width: 0,
                            height: Math.max(0, guide.end - guide.start),
                            borderLeft: `${stroke}px solid #22c55e`,
                            boxShadow: `0 0 ${glow}px rgba(34,197,94,0.55)`,
                            opacity: guide.opacity,
                            transition: `opacity ${guide.opacity ? ALIGN_GUIDE_FADE_IN_MS : ALIGN_GUIDE_FADE_OUT_MS}ms ease-out`,
                        }}
                    />
                ) : (
                    <div
                        key={`y:${guide.position}`}
                        className="absolute"
                        style={{
                            left: guide.start,
                            top: guide.position,
                            width: Math.max(0, guide.end - guide.start),
                            height: 0,
                            borderTop: `${stroke}px solid #22c55e`,
                            boxShadow: `0 0 ${glow}px rgba(34,197,94,0.55)`,
                            opacity: guide.opacity,
                            transition: `opacity ${guide.opacity ? ALIGN_GUIDE_FADE_IN_MS : ALIGN_GUIDE_FADE_OUT_MS}ms ease-out`,
                        }}
                    />
                ),
            )}
        </div>
    );
}



export default function CanvasPage() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <CanvasRefreshShell />;

    return <InfiniteCanvasPage />;
}

function excelPreviewHasImages(preview: Array<Array<{ text?: string; imageUrl?: string }>>) {
    return preview.some((row) => row.some((cell) => Boolean(cell?.imageUrl)));
}

function excelPreviewWithImages(
    cachedPreview: Array<Array<{ text: string; imageUrl?: string }>>,
    parentPreview: Array<Array<{ text: string; imageUrl?: string }>>,
) {
    if (excelPreviewHasImages(cachedPreview)) return cachedPreview;
    if (excelPreviewHasImages(parentPreview)) return parentPreview;
    return cachedPreview.length ? cachedPreview : parentPreview;
}

function InfiniteCanvasPage() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    // Subscribe to the registry version so plugin registration changes rerender the canvas.
    const nodeRegistryVersion = useNodeRegistryVersion((state) => state.version);
    const params = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const projectId = params.id || "";
    const localAgentConnected = useAgentStore((state) => state.connected);
    const localAgentActivity = useAgentStore((state) => state.activity);
    const localAgentEnabled = useAgentStore((state) => state.enabled);
    const agentPanelOpen = useAgentStore((state) => state.panelOpen);
    const toggleAgentPanel = useAgentStore((state) => state.togglePanel);
    const openAgentPanel = useAgentStore((state) => state.openPanel);
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasViewportApiRef = useRef<InfiniteCanvasHandle | null>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<{ nodeId?: string; position?: Position } | null>(null);
    const clipboardRef = useRef<CanvasClipboard | null>(null);
    const historyRef = useRef<{ past: CanvasHistoryEntry[]; future: CanvasHistoryEntry[] }>({ past: [], future: [] });
    const lastHistoryRef = useRef<CanvasHistoryEntry | null>(null);
    const historyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const viewportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const applyingHistoryRef = useRef(false);
    const historyPausedRef = useRef(false);
    const didInitialCenterRef = useRef(false);
    const rafRef = useRef<number | null>(null);
    const snapSmoothRef = useRef({ x: 0, y: 0, lastT: 0 });
    const nodeDraggingRef = useRef(false);
    const dragRef = useRef<{
        isDraggingNode: boolean;
        rightButton?: boolean;
        hasMoved: boolean;
        startX: number;
        startY: number;
        dragIds: Set<string>;
        initialSelectedNodes: { id: string; x: number; y: number }[];
        /** 本次拖动手势开始时冻结的优先对齐目标（上一次点过的节点） */
        preferredTargetId: string | null;
        pressedNodeId: string | null;
    }>({
        isDraggingNode: false,
        hasMoved: false,
        startX: 0,
        startY: 0,
        dragIds: new Set(),
        initialSelectedNodes: [],
        preferredTargetId: null,
        pressedNodeId: null,
    });
    const pendingDragPointRef = useRef<{ clientX: number; clientY: number } | null>(null);
    const suppressDragContextMenuRef = useRef(false);
    /** 对齐锚点：点选某节点后，拖动其它节点时对该目标放开 96px 正交间距限制 */
    const lastAlignClickNodeIdRef = useRef<string | null>(null);
    /** capture 阶段点到的节点；内部 stopPropagation 时也能在 mouseup 记入锚点 */
    const pendingAlignNodeIdRef = useRef<string | null>(null);
    const saveNodeAssetRef = useRef<(node: CanvasNodeData) => void | Promise<void>>(() => undefined);
    const savePromptAssetRef = useRef<(nodes: CanvasNodeData[]) => void | Promise<void>>(() => undefined);

    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    const cleanupAssetImages = useAssetStore((state) => state.cleanupImages);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const storageReadError = useCanvasStore((state) => state.hydrationError ? state.storageError || "画布存储暂时无法读取" : "");
    const createProject = useCanvasStore((state) => state.createProject);
    const openProject = useCanvasStore((state) => state.openProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const renameProject = useCanvasStore((state) => state.renameProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const currentProject = useCanvasStore((state) => state.projects.find((project) => project.id === projectId));
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [chatSessions, setChatSessions] = useState<CanvasAssistantSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [canvasTool, setCanvasTool] = useState<"select" | "relatedSelect" | "pan">("select");
    const canvasToolRef = useRef(canvasTool);
    canvasToolRef.current = canvasTool;
    const [size, setSize] = useState({ width: 1200, height: 720 });
    const [selectedNodeIds, setSelectedNodeIds] = [
        useCanvasInteractionStore((state) => state.selectedNodeIds),
        useCanvasInteractionStore((state) => state.setSelectedNodeIds),
    ] as const;
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    const [editingConnectionLabelId, setEditingConnectionLabelId] = useState<string | null>(null);
    const [connectionLabelDraft, setConnectionLabelDraft] = useState("");
    const setHoveredNodeId = useCanvasInteractionStore((state) => state.setHoveredNodeId);
    /** 节点点击置顶：取消选中后仍保持相对层级（会话内） */
    const nodeStackOrderRef = useRef(new Map<string, number>());
    const nodeStackSeqRef = useRef(0);
    const [nodeStackTick, setNodeStackTick] = useState(0);
    const bringNodeToFront = useCallback((nodeId: string) => {
        if (!nodeId) return;
        nodeStackSeqRef.current += 1;
        nodeStackOrderRef.current.set(nodeId, nodeStackSeqRef.current);
        setNodeStackTick((tick) => tick + 1);
    }, []);
    const nodeStackOrder = useMemo(() => new Map(nodeStackOrderRef.current), [nodeStackTick]);
    const [connectingParams, setConnectingParams] = useState<ConnectionHandle | null>(null);
    const [connectionTargetNodeId, setConnectionTargetNodeId] = [
        useCanvasInteractionStore((state) => state.connectionTargetNodeId),
        useCanvasInteractionStore((state) => state.setConnectionTargetNodeId),
    ] as const;
    const relatedConnectionIds = useCanvasInteractionStore((state) => state.relatedConnectionIds);
    const relatedNodeIds = useCanvasInteractionStore((state) => state.relatedNodeIds);
    // 传递连线模式：仅影响开启后新建的连线；旧连线保持普通语义
    const [carryConnectionMode, setCarryConnectionMode] = useState(false);
    const carryConnectionModeRef = useRef(carryConnectionMode);
    carryConnectionModeRef.current = carryConnectionMode;
    const [mindMapMode, setMindMapMode] = useState(false);
    const mindMapModeRef = useRef(mindMapMode);
    mindMapModeRef.current = mindMapMode;
    const [pendingConnectionCreate, setPendingConnectionCreate] = useState<PendingConnectionCreate | null>(null);
    const [mouseWorld, setMouseWorld] = useState<Position>({ x: 0, y: 0 });
    const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
    const alignGuidesRef = useRef<CanvasAlignGuidesHandle>(null);
    const setAlignGuides = useCallback((guides: AlignGuide[]) => alignGuidesRef.current?.setGuides(guides), []);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [nodeCreatePosition, setNodeCreatePosition] = useState<Position | null>(null);
    const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
    const [isMiniMapOpen, setIsMiniMapOpen] = useState(false);
    const [connectionsHidden, setConnectionsHidden] = useState(() => localStorage.getItem("canvas-connections-hidden") === "1");
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>("lines");
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [promptAssetDraft, setPromptAssetDraft] = useState<(PromptAssetDraft & { title: string }) | null>(null);
    const [promptAssetSaving, setPromptAssetSaving] = useState(false);
    const [projectLoaded, setProjectLoaded] = useState(false);
    const [projectLoadError, setProjectLoadError] = useState("");
    const [projectLoadAttempt, setProjectLoadAttempt] = useState(0);
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [nodeImageSettingsOpen, setNodeImageSettingsOpen] = useState(false);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editRequestNonce, setEditRequestNonce] = useState(0);
    const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
    const [cropNodeId, setCropNodeId] = useState<string | null>(null);
    const [blurNodeId, setBlurNodeId] = useState<string | null>(null);
    const [paintNodeId, setPaintNodeId] = useState<string | null>(null);
    const [outpaintNodeId, setOutpaintNodeId] = useState<string | null>(null);
    const [photopeaNodeId, setPhotopeaNodeId] = useState<string | null>(null);
    const [pinSearchNodeId, setPinSearchNodeId] = useState<string | null>(null);
    /** 同一次搜图连续添加多张时向下级联摆放 */
    const pinSearchAddCountRef = useRef(0);
    const [maskEditNodeId, setMaskEditNodeId] = useState<string | null>(null);
    const [videoLocalEditNodeId, setVideoLocalEditNodeId] = useState<string | null>(null);
    const [splitNodeId, setSplitNodeId] = useState<string | null>(null);
    const [upscaleNodeId, setUpscaleNodeId] = useState<string | null>(null);
    const [angleNodeId, setAngleNodeId] = useState<string | null>(null);
    const modelAngleExport = useModelAngleExportStore((state) => state.session);
    const setModelAngleExport = useModelAngleExportStore((state) => state.setSession);
    const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
    const [expandedImageNodeIds, setExpandedImageNodeIds] = useState<Set<string>>(() => new Set());
    const [isNodeDragging, setIsNodeDragging] = useState(false);
    const [isNodeResizing, setIsNodeResizing] = useState(false);
    const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);
    const [shareModalOpen, setShareModalOpen] = useState(false);
    const [roomTitleOverride, setRoomTitleOverride] = useState<string | null>(null);

    const canvasTitle = roomTitleOverride || currentProject?.title || t("canvas.projectPage.untitledCanvas");
    const {
        roomActive,
        roomRole,
        onlineCount,
        shareUrls,
        sharePath,
        readOnly: roomReadOnly,
        isGuest,
        isHost,
        startShare,
        stopShare,
        roomId,
        roomToken,
    } = useCanvasRoomSync({
        projectId,
        title: canvasTitle,
        backgroundMode,
        nodes,
        connections,
        setNodes,
        setConnections,
        setTitle: (next) => {
            if (currentProject) renameProject(projectId, next);
            else setRoomTitleOverride(next);
        },
        setBackgroundMode,
        viewport,
        setViewport,
        projectLoaded,
        onRoomClosed: () => message.warning(t("canvas.roomShare.hostClosed")),
    });

    useEffect(() => {
        if (roomActive && roomId && roomToken && roomRole) {
            setRoomMediaContext({ roomId, token: roomToken, role: roomRole });
        } else {
            clearRoomMediaContext();
        }
        return () => clearRoomMediaContext();
    }, [roomActive, roomId, roomRole, roomToken]);

    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const viewportRef = useRef(viewport);
    const hoverToolbarElRef = useRef<HTMLDivElement | null>(null);
    const hoverToolbarNodeRef = useRef<CanvasNodeData | null>(null);
    const nodesLayerRef = useRef<CanvasNodesLayerHandle | null>(null);
    const focusAnimRef = useRef<number | null>(null);
    const generateNodeRef = useRef<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>(null);
    const handleAssetInsertRef = useRef<(payload: InsertAssetPayload, at?: { x: number; y: number }) => void>(() => {});
    const connectingParamsRef = useRef(connectingParams);
    const connectionTargetNodeIdRef = useRef(connectionTargetNodeId);
    const overlayRepaintRef = useRef<(() => void) | null>(null);
    const connectionHitItemsRef = useRef<ReturnType<typeof buildConnectionHitItems>>([]);
    const selectionBoxRef = useRef(selectionBox);
    const pendingConnectionCreateRef = useRef(pendingConnectionCreate);
    const viewProjectIdRef = useRef(projectId);
    const loadedProjectIdRef = useRef<string | null>(null);
    /** 同源节点多轮生图时，下一列结果占位的右边界游标（避免并发 hydrate 后仍叠在同一列） */
    const resultStackRightRef = useRef(new Map<string, number>());

    const createGenerationScope = useCallback(() => createCanvasGenerationScope(projectId, nodesRef.current, connectionsRef.current), [projectId]);

    const createHistoryEntry = useCallback(
        (): CanvasHistoryEntry => ({
            nodes: nodesRef.current,
            connections: connectionsRef.current,
            chatSessions,
            activeChatId,
            backgroundMode,
            showImageInfo,
        }),
        [activeChatId, backgroundMode, chatSessions, showImageInfo],
    );

    const cleanupCanvasFiles = useCallback(
        (extra?: unknown) => {
            cleanupAssetImages({ extra, history: historyRef.current, lastHistory: lastHistoryRef.current });
        },
        [cleanupAssetImages],
    );

    const claimResultColumnAnchor = useCallback((sourceId: string, parentRightX: number, columnWidth: number, siblingRightEdges: number[] = []) => {
        const map = resultStackRightRef.current;
        const width = Math.max(1, columnWidth);
        const occupiedRight = Math.max(parentRightX, ...siblingRightEdges.filter((edge) => Number.isFinite(edge)));
        const stored = map.get(sourceId);
        const columnStride = RESULT_STACK_OFFSET_X + width;
        // 并发预约只保留「紧贴当前占用」的游标；中间列删掉/挪走后回落到占用右缘，填回空位而不是继续往右开列
        const keepStored = stored != null && stored <= occupiedRight + columnStride + 1;
        const right = Math.max(occupiedRight, keepStored ? stored! : occupiedRight);
        const gap = right > parentRightX ? RESULT_COLUMN_GAP : RESULT_STACK_OFFSET_X;
        // getVerticalResultPlacement 会加上首列偏移，这里只缩短已有结果列之后的间距。
        const anchor = right + gap - RESULT_STACK_OFFSET_X;
        map.set(sourceId, anchor + columnStride);
        return anchor;
    }, []);

    const ensureResultStackCursor = useCallback((sourceId: string, columnRight: number, previousColumnRight?: number) => {
        const map = resultStackRightRef.current;
        const stored = map.get(sourceId);
        // 只回收仍属于本轮的预占宽度，不能覆盖更晚一轮的并发预约。
        const ownsCursor = stored != null && previousColumnRight != null && Math.abs(stored - previousColumnRight) < 1;
        map.set(sourceId, ownsCursor ? columnRight : Math.max(columnRight, stored ?? columnRight));
    }, []);

    const stopGenerationByRunningId = useCallback((runningId: string) => {
        const affectedByProject = new Map<string, Set<string>>();
        for (const request of listCanvasGenerationRequests()) {
            if (request.runningNodeId !== runningId) continue;
            request.controller.abort();
            finishCanvasGenerationRequest(request.targetNodeId, request.controller);
            const affected = affectedByProject.get(request.projectId) || new Set<string>();
            affected.add(request.targetNodeId);
            affected.add(request.originNodeId);
            affectedByProject.set(request.projectId, affected);
        }
        setRunningNodeId((current) => (current === runningId ? null : current));
        affectedByProject.forEach((affectedNodeIds, generationProjectId) => {
            patchGenerationNodes(generationProjectId, (prev) =>
                prev.map((node) =>
                    affectedNodeIds.has(node.id) && node.metadata?.status === NODE_STATUS_LOADING
                        ? {
                              ...node,
                              metadata: {
                                  ...node.metadata,
                                  status: NODE_STATUS_IDLE,
                                  errorDetails: undefined,
                                  images: node.metadata.images?.map((image) =>
                                      image.status === NODE_STATUS_LOADING ? { ...image, status: NODE_STATUS_ERROR, errorDetails: t("common.requestCanceled") } : image,
                                  ),
                              },
                          }
                        : node,
                ),
            );
        });
    }, [t]);

    const confirmStopGeneration = useCallback(
        (nodeId: string) => {
            modal.confirm({
                title: t("canvas.projectPage.stopTitle"),
                content: t("canvas.projectPage.stopDescription"),
                okText: t("canvas.projectPage.stop"),
                cancelText: t("canvas.projectPage.continue"),
                okButtonProps: { danger: true },
                onOk: () => stopGenerationByRunningId(nodeId),
            });
        },
        [modal, stopGenerationByRunningId, t],
    );

    useEffect(() => {
        if (!hydrated) return;
        const previousProjectId = viewProjectIdRef.current;
        if (previousProjectId !== projectId) {
            const prevRoom = useCanvasRoomStore.getState();
            if (loadedProjectIdRef.current === previousProjectId && shouldPersistProjectToLocal(prevRoom.role, prevRoom.active)) {
                updateProject(previousProjectId, {
                    nodes: nodesRef.current,
                    connections: connectionsRef.current,
                    chatSessions,
                    activeChatId,
                    backgroundMode,
                    showImageInfo,
                    viewport: viewportRef.current,
                });
            }
            viewProjectIdRef.current = projectId;
        }
        setProjectLoaded(false);
        setProjectLoadError("");
        setRunningNodeId(null);
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        pendingDragPointRef.current = null;
        dragRef.current.isDraggingNode = false;
        dragRef.current.hasMoved = false;
        dragRef.current.dragIds = new Set();
        dragRef.current.initialSelectedNodes = [];
        historyPausedRef.current = false;
        nodeDraggingRef.current = false;
        setIsNodeDragging(false);
        setDropTargetGroupId(null);
        setAlignGuides([]);
        useCanvasInteractionStore.getState().reset();
        loadedProjectIdRef.current = null;
        const roomIdParam = searchParams.get("room");
        const roomTokenParam = searchParams.get("token");
        const isRoomGuestJoin = Boolean(roomIdParam && roomTokenParam);
        const project = openProject(projectId);
        if (!project && !isRoomGuestJoin) {
            navigate("/canvas", { replace: true });
            return;
        }

        let canceled = false;
        const restore = async (): Promise<void> => {
            if (isRoomGuestJoin && !project) {
                setNodes([]);
                setConnections([]);
                setBackgroundMode("lines");
                setViewport({ x: 0, y: 0, k: 1 });
                setProjectLoaded(true);
                loadedProjectIdRef.current = projectId;
                return;
            }
            clearRunninghubImageUploadCache();
            const configSnapshot = { ...useConfigStore.getState().config, channelMode: "local" as const };
            const latest = useCanvasStore.getState().projects.find((item) => item.id === projectId) || project;
            const live = hasLiveCanvasGeneration(projectId);
            const nodesForHydrate = live ? latest.nodes : resetInterruptedGeneration(latest.nodes);
            const hydratedNodes = (await hydrateCanvasImages(nodesForHydrate))
                .map(ensureWorkbenchNodeSize)
                .map((node) => fitWorkbenchNodeHeight(node, configSnapshot));
            if (canceled) return;
            const hydratedSessions = await hydrateAssistantImages(latest.chatSessions || []);
            if (canceled) return;
            const storeNow = useCanvasStore.getState().projects.find((item) => item.id === projectId) || latest;
            const hydratedById = new Map(hydratedNodes.map((node) => [node.id, node]));
            const originalById = new Map(latest.nodes.map((node) => [node.id, node]));
            // hydrate 期间完成的上传/生成以最新快照为准，未变化的节点保留恢复后的媒体地址。
            const mergedNodes = storeNow.nodes.map((storeNode) => {
                const hydrated = hydratedById.get(storeNode.id);
                if (!hydrated) return ensureWorkbenchNodeSize(fitWorkbenchNodeHeight(storeNode, configSnapshot));
                const original = originalById.get(storeNode.id);
                if (storeNode === original) return hydrated;
                return {
                    ...hydrated,
                    ...storeNode,
                    metadata: {
                        ...hydrated.metadata,
                        ...storeNode.metadata,
                        content: storeNode.metadata?.content === original?.metadata?.content ? hydrated.metadata?.content : storeNode.metadata?.content,
                        storageKey: storeNode.metadata?.storageKey === original?.metadata?.storageKey ? hydrated.metadata?.storageKey : storeNode.metadata?.storageKey,
                    },
                };
            });
            const flattened = flattenBatchImageNodes(mergedNodes, storeNow.connections);
            const restoredNodes = flattened.nodes;
            const restoredConnections = flattened.connections;
            const restoredSessions = storeNow.chatSessions === latest.chatSessions ? hydratedSessions : storeNow.chatSessions || [];
            setNodes(restoredNodes);
            setConnections(restoredConnections);
            setExpandedImageNodeIds(new Set());
            setChatSessions(restoredSessions);
            setActiveChatId((storeNow || latest).activeChatId || null);
            setBackgroundMode((storeNow || latest).backgroundMode);
            setShowImageInfo((storeNow || latest).showImageInfo || false);
            setViewport((storeNow || latest).viewport);
            historyRef.current = { past: [], future: [] };
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
            lastHistoryRef.current = {
                nodes: restoredNodes,
                connections: restoredConnections,
                chatSessions: restoredSessions,
                activeChatId: (storeNow || latest).activeChatId || null,
                backgroundMode: (storeNow || latest).backgroundMode,
                showImageInfo: (storeNow || latest).showImageInfo || false,
            };
            setHistoryState({ canUndo: false, canRedo: false });
            setRunningNodeId(liveRunningNodeIdForProject(projectId));
            loadedProjectIdRef.current = projectId;
            setProjectLoaded(true);
        };
        void restore().catch((error) => {
            if (canceled) return;
            console.error("画布内容恢复失败，保留原始项目", error);
            setProjectLoadError("画布内容暂时读取失败，原始项目已保留。请重试或返回画布列表。");
        });
        return () => {
            canceled = true;
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
            pendingDragPointRef.current = null;
        };
    }, [hydrated, navigate, openProject, projectId, projectLoadAttempt, searchParams, setAlignGuides, updateProject]);

    useEffect(() => {
        if (!projectLoaded || loadedProjectIdRef.current !== projectId) return;
        return bindCanvasGenerationView({ projectId, setNodes, setConnections, setRunningNodeId });
    }, [projectId, projectLoaded]);

    useEffect(() => {
        if (!projectLoaded || !["new", "recent", "choose"].includes(searchParams.get("mode") || "")) return;
        if (!searchParams.has("agentUrl")) openAgentPanel();
    }, [openAgentPanel, projectLoaded, searchParams]);

    useEffect(() => {
        if (!projectLoaded || loadedProjectIdRef.current !== projectId || applyingHistoryRef.current || historyPausedRef.current || roomActive) return;
        const next = createHistoryEntry();
        const previous = lastHistoryRef.current;
        if (sameHistoryEntry(previous, next)) {
            setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
            return;
        }
        setHistoryState({ canUndo: true, canRedo: false });

        if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
        historyCommitTimerRef.current = setTimeout(() => {
            const current = createHistoryEntry();
            const last = lastHistoryRef.current;
            historyCommitTimerRef.current = null;
            if (!last || sameHistoryEntry(last, current)) return;
            historyRef.current.past = [...historyRef.current.past.slice(-49), last];
            historyRef.current.future = [];
            setHistoryState({ canUndo: true, canRedo: false });
            lastHistoryRef.current = current;
        }, 180);

        return () => {
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
        };
    }, [activeChatId, backgroundMode, chatSessions, connections, createHistoryEntry, nodes, projectId, projectLoaded, roomActive, showImageInfo]);

    useEffect(() => {
        if (!projectLoaded || historyPausedRef.current) return;
        if (!shouldPersistProjectToLocal(roomRole, roomActive)) return;
        if (loadedProjectIdRef.current !== projectId) return;
        updateProject(projectId, { nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo });
    }, [activeChatId, backgroundMode, chatSessions, connections, nodes, projectId, projectLoaded, roomActive, roomRole, showImageInfo, updateProject]);

    useEffect(() => {
        if (!dialogNodeId) setNodeImageSettingsOpen(false);
    }, [dialogNodeId]);

    // 图片组展开 id 若指向已删除节点，必须清掉，否则会误伤全局工具栏显示
    useEffect(() => {
        if (expandedImageNodeIds.size === 0) return;
        const alive = new Set(nodes.map((node) => node.id));
        let changed = false;
        const next = new Set<string>();
        expandedImageNodeIds.forEach((id) => {
            if (alive.has(id)) next.add(id);
            else changed = true;
        });
        if (changed) setExpandedImageNodeIds(next);
    }, [expandedImageNodeIds, nodes]);

    useEffect(() => {
        if (!projectLoaded || roomActive) return;
        if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        viewportSaveTimerRef.current = setTimeout(() => {
            updateProject(projectId, { viewport: viewportRef.current });
            viewportSaveTimerRef.current = null;
        }, 500);
        return () => {
            if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
        };
    }, [projectId, projectLoaded, roomActive, updateProject, viewport]);

    useLayoutEffect(() => {
        nodesRef.current = nodes;
        connectionsRef.current = connections;
        selectedNodeIdsRef.current = selectedNodeIds;
        connectingParamsRef.current = connectingParams;
        connectionTargetNodeIdRef.current = connectionTargetNodeId;
        pendingConnectionCreateRef.current = pendingConnectionCreate;
    }, [nodes, connections, selectedNodeIds, connectingParams, connectionTargetNodeId, pendingConnectionCreate]);

    // 仅随 React viewport 提交更新；勿与选区等放在同一 effect，否则缩放手势未提交时点击空白会把 live 视口回滚，连线瞬间错位
    useLayoutEffect(() => {
        viewportRef.current = viewport;
        overlayRepaintRef.current?.();
    }, [viewport]);

    useEffect(() => {
        useCanvasInteractionStore.getState().setConnectionsForHighlight(connections);
    }, [connections]);

    useLayoutEffect(() => {
        selectionBoxRef.current = selectionBox;
    }, [selectionBox]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const updateSize = () => {
            const rect = el.getBoundingClientRect();
            const width = Math.round(rect.width);
            const height = Math.round(rect.height);
            setSize((current) => (current.width === width && current.height === height ? current : { width, height }));
            if (!didInitialCenterRef.current) {
                didInitialCenterRef.current = true;
                setViewport({ x: width / 2, y: height / 2, k: 1 });
            }
        };

        updateSize();
        const resizeObserver = new ResizeObserver(updateSize);
        resizeObserver.observe(el);
        return () => resizeObserver.disconnect();
    }, []);

    const screenToCanvas = useCallback((clientX: number, clientY: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        const currentViewport = viewportRef.current;
        const localX = clientX - (rect?.left || 0);
        const localY = clientY - (rect?.top || 0);

        return {
            x: (localX - currentViewport.x) / currentViewport.k,
            y: (localY - currentViewport.y) / currentViewport.k,
        };
    }, []);

    const getCanvasCenter = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        return screenToCanvas((rect?.left || 0) + (rect?.width || size.width) / 2, (rect?.top || 0) + (rect?.height || size.height) / 2);
    }, [screenToCanvas, size.height, size.width]);

    const setConnecting = useCallback((next: ConnectionHandle | null) => {
        connectingParamsRef.current = next;
        setConnectingParams(next);
        useAgentStore.getState().setAgentState({
            canvasWireActive: Boolean(next),
            ...(next ? {} : { codexPanelDropHover: false }),
        });
        if (!next) {
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
        }
    }, []);

    const keepNodeToolbar = useCallback(
        (nodeId: string) => {
            if (nodeDraggingRef.current || nodeImageSettingsOpen || !selectedNodeIdsRef.current.has(nodeId)) return;
            setToolbarNodeId(nodeId);
        },
        [nodeImageSettingsOpen],
    );

    const hideNodeToolbar = useCallback(() => {}, []);

    const connectNodes = useCallback(
        (current: ConnectionHandle, targetNodeId: string, world?: Position, dropSide?: ConnectionHandleSide) => {
            if (current.nodeId === targetNodeId) return;

            const connection = normalizeConnection(current.nodeId, targetNodeId, nodesRef.current, current.handleType);
            if (!connection) {
                message.warning(t("canvas.projectPage.configConnection"));
                return;
            }
            const { fromNodeId, toNodeId } = connection;
            const fromNode = nodesRef.current.find((node) => node.id === fromNodeId);
            const toNode = nodesRef.current.find((node) => node.id === toNodeId);
            const linkKind = mindLinkKind(fromNode, toNode, current.side);
            const mindResolved =
                linkKind === "mind" || (linkKind !== "annotation" && isMindNode(fromNode) && isMindNode(toNode))
                    ? resolveMindConnection(current.nodeId, targetNodeId, current.side, dropSide, nodesRef.current, connectionsRef.current)
                    : null;
            const ordered = mindResolved
                ? { fromNodeId: mindResolved.fromNodeId, toNodeId: mindResolved.toNodeId }
                : linkKind === "annotation"
                  ? orderAnnotationConnection(fromNodeId, toNodeId, nodesRef.current)
                  : { fromNodeId, toNodeId };
            const fromOrdered = nodesRef.current.find((node) => node.id === ordered.fromNodeId);
            const toOrdered = nodesRef.current.find((node) => node.id === ordered.toNodeId);
            const involvesGroup = fromOrdered?.type === CanvasNodeType.Group || toOrdered?.type === CanvasNodeType.Group;
            const involvesXing = isXingXiaochiNode(fromOrdered) || isXingXiaochiNode(toOrdered);
            const useSurfaceAnchor = involvesGroup || involvesXing;
            const fromAnchor = !useSurfaceAnchor
                ? undefined
                : isXingXiaochiNode(fromOrdered)
                  ? current.nodeId === fromOrdered.id
                      ? current.anchor ||
                        (world ? nearestXingSurfaceAnchor(fromOrdered, world) : sideToXingSurfaceAnchor(current.side, fromOrdered))
                      : world
                        ? nearestXingSurfaceAnchor(fromOrdered, world)
                        : sideToXingSurfaceAnchor("left", fromOrdered)
                  : fromOrdered?.type === CanvasNodeType.Group
                    ? current.nodeId === fromOrdered.id
                        ? sideToRelativeAnchor(current.side)
                        : world
                          ? nearestBorderAnchor(fromOrdered, world)
                          : { x: 0, y: 0.5 }
                    : current.nodeId === fromOrdered?.id && current.side
                      ? sideToRelativeAnchor(current.side)
                      : undefined;
            const toAnchor = !useSurfaceAnchor
                ? undefined
                : isXingXiaochiNode(toOrdered)
                  ? current.nodeId === toOrdered.id
                      ? current.anchor ||
                        (world ? nearestXingSurfaceAnchor(toOrdered, world) : sideToXingSurfaceAnchor(current.side, fromOrdered))
                      : world
                        ? nearestXingSurfaceAnchor(toOrdered, world)
                        : sideToXingSurfaceAnchor("right", toOrdered)
                  : toOrdered?.type === CanvasNodeType.Group
                    ? current.nodeId === toOrdered.id
                        ? sideToRelativeAnchor(current.side)
                        : world
                          ? nearestBorderAnchor(toOrdered, world)
                          : { x: 0, y: 0.5 }
                    : current.nodeId === toOrdered?.id && current.side
                      ? sideToRelativeAnchor(current.side)
                      : undefined;
            const mindSides = mindResolved
                ? { fromSide: mindResolved.fromSide, toSide: mindResolved.toSide }
                : null;
            const existing = connectionsRef.current.find(
                (conn) => conn.fromNodeId === ordered.fromNodeId && conn.toNodeId === ordered.toNodeId,
            );
            if (existing) {
                if (mindSides?.fromSide || mindSides?.toSide || fromAnchor || toAnchor) {
                    setConnections((prev) =>
                        prev.map((conn) =>
                            conn.id === existing.id
                                ? {
                                      ...conn,
                                      ...(mindSides?.fromSide ? { fromSide: mindSides.fromSide } : {}),
                                      ...(mindSides?.toSide ? { toSide: mindSides.toSide } : {}),
                                      ...(fromAnchor ? { fromAnchor } : {}),
                                      ...(toAnchor ? { toAnchor } : {}),
                                  }
                                : conn,
                        ),
                    );
                }
            } else {
                const decisionLabel =
                    linkKind === "mind" && isDecisionNode(fromOrdered)
                        ? nextDecisionBranchLabel(ordered.fromNodeId, connectionsRef.current)
                        : "";
                setConnections((prev) => [
                    ...prev,
                    {
                        id: `conn-${Date.now()}`,
                        ...ordered,
                        ...(linkKind ? { kind: linkKind } : {}),
                        ...(!linkKind && carryConnectionModeRef.current ? { carry: true } : {}),
                        ...(fromAnchor ? { fromAnchor } : {}),
                        ...(toAnchor ? { toAnchor } : {}),
                        ...(mindSides?.fromSide ? { fromSide: mindSides.fromSide } : {}),
                        ...(mindSides?.toSide ? { toSide: mindSides.toSide } : {}),
                        ...(decisionLabel ? { label: decisionLabel } : {}),
                    },
                ]);
            }
            setContextMenu(null);
        },
        [message, t],
    );

    const createMindRootAt = useCallback((world: Position) => {
        const size = mindRootDefaultSize();
        const label = t("canvas.mindMap.centerTopic");
        const newNode = createCanvasNode(MIND_NODE_TYPE, world, {
            content: label,
            mindRole: "root",
            mindShape: "capsule",
            mindColor: DEFAULT_MIND_COLOR,
            fontSize: 15,
            mindFocusEdit: Date.now(),
            status: "idle",
        });
        newNode.title = label;
        newNode.width = size.width;
        newNode.height = size.height;
        newNode.position = { x: world.x - size.width / 2, y: world.y - size.height / 2 };
        setNodes((prev) => [...prev, newNode]);
        setSelectedNodeIds(new Set([newNode.id]));
        setToolbarNodeId(newNode.id);
        setSelectedConnectionId(null);
        setDialogNodeId(null);
        return newNode;
    }, [t]);

    const createMindTopicAt = useCallback((world: Position, parentId?: string, createType: string = MIND_CREATE_CHILD, linkSide?: "top" | "bottom" | "left" | "right") => {
        const kind = mindKindFromCreateType(createType);
        const label =
            kind === "decision"
                ? t("canvas.mindMap.decisionTopic")
                : kind === "annotation"
                  ? t("canvas.mindMap.annotationTopic")
                  : t("canvas.mindMap.childTopic");
        const shape = kind === "decision" ? "hexagon" as const : kind === "annotation" ? "underline" as const : "rounded" as const;
        const size = computeMindNodeSize(label, false, 13, shape);
        const parent = parentId ? nodesRef.current.find((node) => node.id === parentId) : null;
        // 标注落在松手/菜单位置，不要强制吸到主题正上/下方
        const center = world;
        const newNode = createCanvasNode(MIND_NODE_TYPE, center, {
            content: label,
            mindRole: "topic",
            mindKind: kind,
            mindShape: shape,
            mindColor: parent?.metadata?.mindColor || (kind === "decision" ? "#d97706" : kind === "annotation" ? "#64748b" : DEFAULT_MIND_COLOR),
            fontSize: 13,
            mindFocusEdit: Date.now(),
            status: "idle",
        });
        newNode.title = label;
        newNode.width = size.width;
        newNode.height = size.height;
        newNode.position = { x: center.x - size.width / 2, y: center.y - size.height / 2 };
        setNodes((prev) => [...prev, newNode]);
        if (parent && isMindNode(parent)) {
            if (kind === "annotation") {
                // 标注 → 原节点，箭头指向被备注主题
                setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: newNode.id, toNodeId: parent.id, kind: "annotation" }]);
            } else {
                const branchLabel = isDecisionNode(parent) ? nextDecisionBranchLabel(parent.id, connectionsRef.current) : "";
                setConnections((prev) => [
                    ...prev,
                    {
                        id: nanoid(),
                        fromNodeId: parent.id,
                        toNodeId: newNode.id,
                        kind: "mind",
                        ...(linkSide ? { fromSide: linkSide } : {}),
                        ...(branchLabel ? { label: branchLabel } : {}),
                    },
                ]);
            }
        }
        setSelectedNodeIds(new Set([newNode.id]));
        setToolbarNodeId(newNode.id);
        setSelectedConnectionId(null);
        setDialogNodeId(null);
        return newNode;
    }, [t]);

    const createMindFromMenu = useCallback((type: string, world: Position, parentId?: string, linkSide?: "top" | "bottom" | "left" | "right") => {
        if (type === MIND_CREATE_ROOT) return createMindRootAt(world);
        if (isMindCreateType(type)) return createMindTopicAt(world, parentId, type, linkSide);
        return null;
    }, [createMindRootAt, createMindTopicAt]);

    const createConnectedNode = useCallback(
        (type: string, pending: PendingConnectionCreate) => {
            if (isMindCreateType(type)) {
                const sourceId = pending.connection.nodeId;
                createMindFromMenu(
                    type === MIND_CREATE_ROOT ? MIND_CREATE_CHILD : type,
                    pending.attachPoint,
                    sourceId,
                    pending.connection.side,
                );
                setPendingConnectionCreate(null);
                setConnecting(null);
                return;
            }
            const metadata =
                type === CanvasNodeType.Config
                    ? { model: effectiveConfig.imageModel || effectiveConfig.model, size: effectiveConfig.size, count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count) }
                    : undefined;
            const newNode = createCanvasNode(type, pending.attachPoint, metadata);
            const connection = normalizeConnection(pending.connection.nodeId, newNode.id, [...nodesRef.current, newNode], pending.connection.handleType);
            if (!connection) {
                message.warning(t("canvas.projectPage.configConnection"));
                return;
            }
            setNodes((prev) => [...prev, newNode]);
            // 新节点也可并入导图：从导图主题拖出创建看板/图片等时按 mind 连线处理
            const fromNode = connection.fromNodeId === newNode.id ? newNode : nodesRef.current.find((node) => node.id === connection.fromNodeId);
            const toNode = connection.toNodeId === newNode.id ? newNode : nodesRef.current.find((node) => node.id === connection.toNodeId);
            const linkKind = mindLinkKind(fromNode, toNode, pending.connection.side);
            const ordered =
                linkKind === "annotation"
                    ? orderAnnotationConnection(connection.fromNodeId, connection.toNodeId, [...nodesRef.current, newNode])
                    : { fromNodeId: connection.fromNodeId, toNodeId: connection.toNodeId };
            setConnections((prev) => [
                ...prev,
                {
                    id: nanoid(),
                    ...ordered,
                    ...(linkKind ? { kind: linkKind } : {}),
                    ...(!linkKind && carryConnectionModeRef.current ? { carry: true } : {}),
                },
            ]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            if (type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio && type !== SMART_PREVIEW_NODE_TYPE && type !== MIND_NODE_TYPE) setDialogNodeId(newNode.id);
            setPendingConnectionCreate(null);
            setConnecting(null);
        },
        [createMindFromMenu, effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message, setConnecting, t],
    );

    const cancelPendingConnectionCreate = useCallback(() => {
        setPendingConnectionCreate(null);
        setConnecting(null);
    }, [setConnecting]);

    const getConnectionDropTarget = useCallback(
        (clientX: number, clientY: number, current: ConnectionHandle): ConnectionDropTarget => {
            const world = screenToCanvas(clientX, clientY);
            const scale = Math.max(viewportRef.current.k, 0.05);
            const padding = CONNECTION_NODE_HIT_PADDING / scale;
            const handleRadius = CONNECTION_HANDLE_HIT_RADIUS / scale;
            const borderHit = Math.max(handleRadius, 14 / scale);
            let isNearNode = false;
            let bestNodeId: string | null = null;
            let bestSide: ConnectionHandleSide | undefined;
            let bestPriority = Number.POSITIVE_INFINITY;

            [...nodesRef.current]
                .reverse()
                .forEach((node) => {
                    const isGroup = node.type === CanvasNodeType.Group;
                    const mind = isMindNode(node);
                    let hitsHandle = false;
                    let hitSide: ConnectionHandleSide | undefined;
                    if (mind) {
                        let bestDist = Number.POSITIVE_INFINITY;
                        (["left", "right", "top", "bottom"] as const).forEach((side) => {
                            const tip = mindNodeSideAnchor(node, side);
                            const dist = (world.x - tip.x) ** 2 + (world.y - tip.y) ** 2;
                            if (dist < bestDist) {
                                bestDist = dist;
                                hitSide = side;
                            }
                        });
                        hitsHandle = bestDist <= handleRadius * handleRadius;
                    } else if (!isGroup) {
                        const anchor = getConnectionTargetAnchor(node, current);
                        const dx = world.x - anchor.x;
                        const dy = world.y - anchor.y;
                        hitsHandle = dx * dx + dy * dy <= handleRadius * handleRadius;
                    }
                    const hitsInside = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
                    const hitsExpanded = world.x >= node.position.x - padding && world.x <= node.position.x + node.width + padding && world.y >= node.position.y - padding && world.y <= node.position.y + node.height + padding;
                    const hitsGroupBorder = isGroup && distanceToNodeBorder(node, world) <= borderHit;
                    const hitsXingSurface = isXingXiaochiNode(node) && isNearXingSurface(node, world, Math.max(borderHit, 36));

                    if (!hitsHandle && !hitsInside && !hitsExpanded && !hitsGroupBorder && !hitsXingSurface) return;
                    isNearNode = true;
                    if (node.id === current.nodeId || !normalizeConnection(current.nodeId, node.id, nodesRef.current, current.handleType)) return;

                    if (mind && !hitSide) hitSide = nearestMindHandleSide(node, world);
                    // 子节点优先于组；导图四向连接点优先于框体；星小驰表面粘滞略优先于框内
                    const priority = isGroup
                        ? hitsInside
                            ? 3
                            : hitsGroupBorder
                              ? 4
                              : 5
                        : hitsHandle
                          ? 0
                          : hitsXingSurface
                            ? 0.5
                            : hitsInside
                              ? 1
                              : 2;
                    if (priority < bestPriority) {
                        bestNodeId = node.id;
                        bestSide = hitSide;
                        bestPriority = priority;
                    }
                });

            return { nodeId: bestNodeId, isNearNode, side: bestSide };
        },
        [screenToCanvas],
    );

    const mindHiddenIdsRef = useRef(new Set<string>());
    const mindHiddenIds = useMemo(() => {
        const next = collectMindCollapsedNodeIds(nodes, connections);
        const previous = mindHiddenIdsRef.current;
        if (next.size === previous.size && [...next].every((id) => previous.has(id))) return previous;
        mindHiddenIdsRef.current = next;
        return next;
    }, [connections, nodes]);
    const visibleConnections = useMemo(
        () => (connectionsHidden ? [] : connections.filter((connection) => !mindHiddenIds.has(connection.fromNodeId) && !mindHiddenIds.has(connection.toNodeId))),
        [connections, connectionsHidden, mindHiddenIds],
    );

    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const geometryNodeByIdRef = useRef(new Map<string, CanvasNodeData>());
    const geometryNodeById = useMemo(() => {
        const previous = geometryNodeByIdRef.current;
        if (previous.size === nodes.length && nodes.every((node) => sameConnectionNodeGeometry(previous.get(node.id), node))) return previous;
        // 全体几何变化仍会失效，保留导图相邻扇出、判断出口、组框端口和第三方节点避障依赖。
        geometryNodeByIdRef.current = nodeById;
        return nodeById;
    }, [nodeById, nodes]);
    const connectionHitItems = useMemo(() => buildConnectionHitItems(visibleConnections, geometryNodeById), [geometryNodeById, visibleConnections]);

    useLayoutEffect(() => {
        connectionHitItemsRef.current = connectionHitItems;
    }, [connectionHitItems]);

    // 工具栏跟随选中节点：默认仅单选；思维导图模式下多选且全是导图节点时也显示，便于批量改样式/颜色。
    // 勿优先用可能过期的 toolbarNodeId（新建/Agent 落点常只改 selected）。拖动/缩放时隐藏。
    const selectedIdList = Array.from(selectedNodeIds);
    const singleSelectedNodeId = selectedIdList.length === 1 ? selectedIdList[0] : null;
    const mindMultiSelected =
        mindMapMode &&
        selectedIdList.length > 1 &&
        selectedIdList.every((id) => isMindNode(nodeById.get(id)));
    const toolbarNode = (() => {
        if (singleSelectedNodeId) return nodeById.get(singleSelectedNodeId) || null;
        if (!mindMultiSelected) return null;
        const minds = selectedIdList.map((id) => nodeById.get(id)).filter((node): node is CanvasNodeData => Boolean(node));
        if (!minds.length) return null;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        for (const mind of minds) {
            minX = Math.min(minX, mind.position.x);
            minY = Math.min(minY, mind.position.y);
            maxX = Math.max(maxX, mind.position.x + mind.width);
        }
        const primary = minds.reduce((best, node) =>
            node.position.y < best.position.y || (node.position.y === best.position.y && node.position.x < best.position.x) ? node : best,
        );
        // 用选区顶边中点锚工具栏；元数据取最靠上的节点做颜色/字号预览
        return { ...primary, position: { x: minX, y: minY }, width: Math.max(1, maxX - minX) };
    })();
    const visibleToolbarNode =
        toolbarNode?.type === CanvasNodeType.Config || isXingXiaochiNode(toolbarNode) || isNodeDragging || isNodeResizing || nodeImageSettingsOpen || connectingParams || pendingConnectionCreate || (toolbarNode != null && expandedImageNodeIds.has(toolbarNode.id))
            ? null
            : toolbarNode;
    hoverToolbarNodeRef.current = visibleToolbarNode;
    const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;
    const cropNode = cropNodeId ? nodeById.get(cropNodeId) || null : null;
    const blurNode = blurNodeId ? nodeById.get(blurNodeId) || null : null;
    const paintNode = paintNodeId ? nodeById.get(paintNodeId) || null : null;
    const outpaintNode = outpaintNodeId ? nodeById.get(outpaintNodeId) || null : null;
    const photopeaNode = photopeaNodeId ? nodeById.get(photopeaNodeId) || null : null;
    const pinSearchNode = pinSearchNodeId ? nodeById.get(pinSearchNodeId) || null : null;
    const maskEditNode = maskEditNodeId ? nodeById.get(maskEditNodeId) || null : null;
    const videoLocalEditNode = videoLocalEditNodeId ? nodeById.get(videoLocalEditNodeId) || null : null;
    const splitNode = splitNodeId ? nodeById.get(splitNodeId) || null : null;
    const upscaleNode = upscaleNodeId ? nodeById.get(upscaleNodeId) || null : null;
    const angleNode = angleNodeId ? nodeById.get(angleNodeId) || null : null;
    const previewNode = previewNodeId ? nodeById.get(previewNodeId) || null : null;
    const groupChildCountById = useMemo(() => {
        const map = new Map<string, number>();
        nodes.forEach((node) => {
            const groupId = node.metadata?.groupId;
            if (groupId) map.set(groupId, (map.get(groupId) || 0) + 1);
        });
        return map;
    }, [nodes]);
    // 拖动时只改 position：用 ref 判断（比 isNodeDragging state 更早生效），冻结引用列表 / Agent 快照 / 侧栏列表
    const configInputsCacheRef = useRef<Map<string, NodeGenerationInput[]>>(new Map());
    const mentionReferencesCacheRef = useRef<Map<string, ReturnType<typeof buildNodeMentionReferences>>>(new Map());
    const agentPublishNodesRef = useRef(nodes);
    const sidePanelNodesRef = useRef(nodes);
    if (!nodeDraggingRef.current) {
        agentPublishNodesRef.current = nodes;
        sidePanelNodesRef.current = nodes;
    }
    const configInputsById = useMemo(() => {
        if (nodeDraggingRef.current) return configInputsCacheRef.current;
        const map = new Map<string, NodeGenerationInput[]>();
        nodes.forEach((node) => {
            if (node.type !== CanvasNodeType.Config) return;
            map.set(node.id, buildNodeGenerationInputs(node.id, nodes, connections));
        });
        configInputsCacheRef.current = map;
        return map;
    }, [connections, isNodeDragging, nodes]);
    const mentionReferencesByNodeId = useMemo(() => {
        if (nodeDraggingRef.current) return mentionReferencesCacheRef.current;
        const map = new Map<string, ReturnType<typeof buildNodeMentionReferences>>();
        nodes.forEach((node) => map.set(node.id, buildNodeMentionReferences(node, nodes, connections)));
        mentionReferencesCacheRef.current = map;
        return map;
    }, [connections, isNodeDragging, nodes]);
    const { applyAgentOps } = useAgentBridge({
        projectId,
        title: currentProject?.title,
        nodes: nodeDraggingRef.current ? agentPublishNodesRef.current : nodes,
        connections,
        selectedNodeIds,
        viewport,
        viewportSize: size,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        viewportRef,
        generateNodeRef,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setViewport,
        setContextMenu,
    });

    const { pluginHost, renderPluginPanel, buildNodeToolbarItems } = usePluginHost({
        effectiveConfig,
        isAiConfigReady,
        openConfigDialog,
        theme,
        nodesRef,
        connectionsRef,
        viewportRef,
        setNodes,
        setDialogNodeId,
        applyAgentOps,
    });

    useEffect(() => () => setModelAngleExport(null), [projectId, setModelAngleExport]);

    const exportModelAngleImage = useCallback(
        async (blob: Blob, prompt: string) => {
            const session = modelAngleExport;
            if (!session) return;
            const node = nodesRef.current.find((item) => item.id === session.nodeId);
            if (!node) {
                message.error(t("canvas.modelNode.exportAngleFailed"));
                return;
            }
            await createModelAngleImageNode({ node, blob, prompt, applyOps: applyAgentOps });
            setModelAngleExport(null);
        },
        [applyAgentOps, message, modelAngleExport, setModelAngleExport, t],
    );
    const createNode = useCallback(
        (type: CanvasNodeTypeId, position?: Position) => {
            const targetPosition = position || getCanvasCenter();
            const configMetadata =
                type === CanvasNodeType.Config
                    ? {
                          model: effectiveConfig.imageModel || effectiveConfig.model,
                          size: effectiveConfig.size,
                          count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                      }
                    : undefined;
            const newNode = createCanvasNode(type, targetPosition, configMetadata);

            setNodes((prev) => [...prev, newNode]);
            setSelectedNodeIds(new Set([newNode.id]));
            setToolbarNodeId(newNode.id);
            setSelectedConnectionId(null);
            const definition = getNodeDefinition(type);
            // Display-only plugin nodes with hidePanel do not open a panel; custom Panels require autoOpenPanel on creation.
            // Plugin nodes declaring useBuiltinPanel open the built-in generation panel on creation, like image nodes.
            // Built-in image, video, and config nodes retain their existing open-on-create behavior.
            const wantsPanel = definition?.hidePanel
                ? false
                : definition?.Panel
                  ? Boolean(definition.autoOpenPanel)
                  : definition?.useBuiltinPanel
                    ? true
                    : isBuiltinType(type) && type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio && type !== CanvasNodeType.Group;
            if (wantsPanel) setDialogNodeId(newNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, getCanvasCenter],
    );

    const createMindChildOf = useCallback((parentId: string) => {
        const parent = nodesRef.current.find((node) => node.id === parentId);
        if (!parent || !isMindNode(parent) || isAnnotationNode(parent)) return;
        const size = mindTopicDefaultSize();
        const siblings = mindChildrenOf(parent.id, nodesRef.current, connectionsRef.current);
        const center = placeMindChildPosition(parent, siblings, size);
        const label = t("canvas.mindMap.childTopic");
        const newNode = createCanvasNode(MIND_NODE_TYPE, center, {
            content: label,
            mindRole: "topic",
            mindKind: "topic",
            mindShape: "rounded",
            mindColor: parent.metadata?.mindColor || DEFAULT_MIND_COLOR,
            fontSize: 13,
            mindFocusEdit: Date.now(),
            status: "idle",
        });
        newNode.title = label;
        newNode.width = size.width;
        newNode.height = size.height;
        newNode.position = { x: center.x - size.width / 2, y: center.y - size.height / 2 };
        setNodes((prev) => [...prev, newNode]);
        const branchLabel = isDecisionNode(parent) ? nextDecisionBranchLabel(parent.id, connectionsRef.current) : "";
        setConnections((prev) => [
            ...prev,
            { id: nanoid(), fromNodeId: parent.id, toNodeId: newNode.id, kind: "mind", ...(branchLabel ? { label: branchLabel } : {}) },
        ]);
        setSelectedNodeIds(new Set([newNode.id]));
        setToolbarNodeId(newNode.id);
        setSelectedConnectionId(null);
        setDialogNodeId(null);
    }, [t]);

    const createMindSiblingOf = useCallback((nodeId: string) => {
        const current = nodesRef.current.find((node) => node.id === nodeId);
        if (!current || !isMindNode(current) || isAnnotationNode(current)) return;
        const parent = mindParentOf(current.id, nodesRef.current, connectionsRef.current);
        if (!parent) {
            createMindChildOf(current.id);
            return;
        }
        const isDecision = current.metadata?.mindKind === "decision";
        const shape = isDecision ? "hexagon" as const : "rounded" as const;
        const label = isDecision ? t("canvas.mindMap.decisionTopic") : t("canvas.mindMap.childTopic");
        const size = computeMindNodeSize(label, false, 13, shape);
        const siblings = mindChildrenOf(parent.id, nodesRef.current, connectionsRef.current);
        const center = placeMindSiblingPosition(current, parent, siblings, size);
        const newNode = createCanvasNode(MIND_NODE_TYPE, center, {
            content: label,
            mindRole: "topic",
            mindKind: isDecision ? "decision" : "topic",
            mindShape: shape,
            mindColor: current.metadata?.mindColor || parent.metadata?.mindColor || DEFAULT_MIND_COLOR,
            fontSize: 13,
            mindFocusEdit: Date.now(),
            status: "idle",
        });
        newNode.title = label;
        newNode.width = size.width;
        newNode.height = size.height;
        newNode.position = { x: center.x - size.width / 2, y: center.y - size.height / 2 };
        setNodes((prev) => [...prev, newNode]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: parent.id, toNodeId: newNode.id, kind: "mind", ...(isDecisionNode(parent) ? { label: nextDecisionBranchLabel(parent.id, connectionsRef.current) } : {}) }]);
        setSelectedNodeIds(new Set([newNode.id]));
        setToolbarNodeId(newNode.id);
        setSelectedConnectionId(null);
        setDialogNodeId(null);
    }, [createMindChildOf, t]);

    /** 方向键：在选中主题的对应方位创建同样式导图节点并连线 */
    const createMindNeighborOf = useCallback((nodeId: string, side: "top" | "bottom" | "left" | "right") => {
        const current = nodesRef.current.find((node) => node.id === nodeId);
        if (!current || !isMindNode(current) || isAnnotationNode(current)) return;
        const isDecision = current.metadata?.mindKind === "decision";
        const isRoot = current.metadata?.mindRole === "root";
        const shape = (current.metadata?.mindShape || (isDecision ? "hexagon" : isRoot ? "capsule" : "rounded")) as Parameters<typeof computeMindNodeSize>[3];
        const fontSize = typeof current.metadata?.fontSize === "number" ? current.metadata.fontSize : isRoot ? 15 : 13;
        const label = isDecision ? t("canvas.mindMap.decisionTopic") : t("canvas.mindMap.childTopic");
        const size = computeMindNodeSize(label, false, fontSize, shape);
        const center = placeMindNeighborPosition(current, side, size);
        const newNode = createCanvasNode(MIND_NODE_TYPE, center, {
            content: label,
            mindRole: "topic",
            mindKind: isDecision ? "decision" : "topic",
            mindShape: shape,
            mindColor: current.metadata?.mindColor || DEFAULT_MIND_COLOR,
            fontSize,
            mindFocusEdit: Date.now(),
            status: "idle",
        });
        newNode.title = label;
        newNode.width = size.width;
        newNode.height = size.height;
        newNode.position = { x: center.x - size.width / 2, y: center.y - size.height / 2 };
        setNodes((prev) => [...prev, newNode]);
        const branchLabel = isDecisionNode(current) ? nextDecisionBranchLabel(current.id, connectionsRef.current) : "";
        setConnections((prev) => [
            ...prev,
            { id: nanoid(), fromNodeId: current.id, toNodeId: newNode.id, kind: "mind", ...(branchLabel ? { label: branchLabel } : {}) },
        ]);
        setSelectedNodeIds(new Set([newNode.id]));
        setToolbarNodeId(newNode.id);
        setSelectedConnectionId(null);
        setDialogNodeId(null);
    }, [t]);

    const arrangeSelectedNodes = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        if (selectedIds.size < 2) return;
        const selected = nodesRef.current.filter((node) => selectedIds.has(node.id));
        if (selected.length < 2) return;
        const positions = layoutSelectedNodePositions(selected, connectionsRef.current);
        if (!positions.size) return;
        setNodes((prev) => prev.map((node) => {
            const next = positions.get(node.id);
            return next ? { ...node, position: next } : node;
        }));
        setContextMenu(null);
    }, []);

    const alignSelectedConnectionPoints = useCallback((connectionId: string) => {
        const positions = alignConnectionById(connectionId, nodesRef.current, connectionsRef.current);
        if (!positions.size) return;
        setNodes((prev) => prev.map((node) => {
            const next = positions.get(node.id);
            return next ? { ...node, position: next } : node;
        }));
        setContextMenu(null);
    }, []);

    const groupSelectedNodes = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        if (selectedIds.size < 2) return;
        const selected = nodesRef.current.filter((node) => selectedIds.has(node.id));
        if (selected.length < 2) return;
        const selectedGroupIds = new Set(selected.filter((node) => node.type === CanvasNodeType.Group).map((node) => node.id));
        const children = selected.filter((node) => {
            const parentId = node.metadata?.groupId;
            return !(parentId && selectedGroupIds.has(parentId));
        });
        if (children.length < 2) return;
        const frame = boundsForGroupFrame(children);
        if (!frame) return;
        const childIds = new Set(children.map((node) => node.id));
        const parentGroupIds = new Set(children.map((node) => node.metadata?.groupId).filter((id): id is string => Boolean(id)));
        const parentGroupId = parentGroupIds.size === 1 ? [...parentGroupIds][0] : undefined;
        const groupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const bundleText = buildGroupBundleText(children);
        const title = suggestDataGroupTitle(children, nodesRef.current, t("canvas.node.dataGroup"));
        const groupNode: CanvasNodeData = {
            id: groupId,
            type: CanvasNodeType.Group,
            title,
            position: frame.position,
            width: frame.width,
            height: frame.height,
            metadata: {
                groupKind: "data",
                groupBundleText: bundleText,
                content: bundleText,
                ...(parentGroupId ? { groupId: parentGroupId } : {}),
            },
        };
        setNodes((prev) => {
            const next: CanvasNodeData[] = [];
            let inserted = false;
            for (const node of prev) {
                if (!inserted && childIds.has(node.id)) {
                    next.push(groupNode);
                    inserted = true;
                }
                if (childIds.has(node.id)) {
                    next.push({ ...node, metadata: { ...node.metadata, groupId } });
                } else {
                    next.push(node);
                }
            }
            if (!inserted) next.unshift(groupNode);
            return next;
        });
        setSelectedNodeIds(new Set([groupId]));
        setSelectedConnectionId(null);
        setDialogNodeId(null);
        setToolbarNodeId(groupId);
        setContextMenu(null);
    }, [t]);

    const deleteNodes = useCallback(
        (ids: Set<string>) => {
            if (!ids.size) return;
            const allIds = new Set(ids);
            setNodes((prev) => {
                const next = prev.filter((node) => !allIds.has(node.id));
                return next.map((node) => {
                    const groupId = node.metadata?.groupId;
                    if (groupId && allIds.has(groupId)) return { ...node, metadata: { ...node.metadata, groupId: undefined } };
                    return node;
                });
            });
            setConnections((prev) => prev.filter((conn) => !allIds.has(conn.fromNodeId) && !allIds.has(conn.toNodeId)));
            setSelectedNodeIds(new Set());
            setSelectedConnectionId(null);
            setHoveredNodeId((current) => (current && allIds.has(current) ? null : current));
            setToolbarNodeId((current) => (current && allIds.has(current) ? null : current));
            setExpandedImageNodeIds((current) => {
                if (current.size === 0) return current;
                const next = new Set([...current].filter((id) => !allIds.has(id)));
                return next.size === current.size ? current : next;
            });
            setDialogNodeId((current) => (current && allIds.has(current) ? null : current));
            setEditingNodeId((current) => (current && allIds.has(current) ? null : current));
            setInfoNodeId((current) => (current && allIds.has(current) ? null : current));
            setCropNodeId((current) => (current && allIds.has(current) ? null : current));
            setBlurNodeId((current) => (current && allIds.has(current) ? null : current));
            setPaintNodeId((current) => (current && allIds.has(current) ? null : current));
            setOutpaintNodeId((current) => (current && allIds.has(current) ? null : current));
            setMaskEditNodeId((current) => (current && allIds.has(current) ? null : current));
            setAngleNodeId((current) => (current && allIds.has(current) ? null : current));
            setModelAngleExport((current) => (current && allIds.has(current.nodeId) ? null : current));
            setPreviewNodeId((current) => (current && allIds.has(current) ? null : current));
            setRunningNodeId((current) => (current && allIds.has(current) ? null : current));
            setContextMenu((current) => (current?.type === "node" && allIds.has(current.nodeId) ? null : current));
            cleanupCanvasFiles({ projectId, nodes: nodesRef.current.filter((node) => !allIds.has(node.id)), chatSessions });
        },
        [chatSessions, cleanupCanvasFiles, projectId],
    );

    const deleteConnection = useCallback((connectionId: string) => {
        setConnections((prev) => prev.filter((conn) => conn.id !== connectionId));
        setSelectedConnectionId((current) => (current === connectionId ? null : current));
        setEditingConnectionLabelId((current) => (current === connectionId ? null : current));
        setContextMenu((current) => (current?.type === "connection" && current.connectionId === connectionId ? null : current));
    }, []);

    const beginEditConnectionLabel = useCallback((connectionId: string) => {
        const connection = connectionsRef.current.find((item) => item.id === connectionId);
        if (!connection) return;
        setSelectedConnectionId(connectionId);
        setSelectedNodeIds(new Set());
        setNodeCreatePosition(null);
        setContextMenu(null);
        setEditingConnectionLabelId(connectionId);
        setConnectionLabelDraft(connection.label || "");
    }, [setSelectedNodeIds]);

    const toggleConnectionDash = useCallback((connectionId: string) => {
        setConnections((prev) =>
            prev.map((conn) => {
                if (conn.id !== connectionId) return conn;
                const from = nodesRef.current.find((node) => node.id === conn.fromNodeId);
                const to = nodesRef.current.find((node) => node.id === conn.toNodeId);
                return { ...conn, dashed: !isConnectionDashed(conn, from, to) };
            }),
        );
        setContextMenu(null);
    }, []);

    const commitConnectionLabel = useCallback(() => {
        const connectionId = editingConnectionLabelId;
        if (!connectionId) return;
        const nextLabel = connectionLabelDraft.trim();
        setConnections((prev) =>
            prev.map((conn) => {
                if (conn.id !== connectionId) return conn;
                if (!nextLabel) {
                    if (!conn.label) return conn;
                    const { label: _removed, ...rest } = conn;
                    return rest;
                }
                return { ...conn, label: nextLabel };
            }),
        );
        setEditingConnectionLabelId(null);
        setConnectionLabelDraft("");
    }, [connectionLabelDraft, editingConnectionLabelId]);

    const cancelConnectionLabelEdit = useCallback(() => {
        setEditingConnectionLabelId(null);
        setConnectionLabelDraft("");
    }, []);

    const collapsePlanDocument = useCallback(() => {
        const { planDocument, setAgentState } = useAgentStore.getState();
        if (!planDocument || planDocument.collapsed) return;
        setAgentState({ planDocument: { ...planDocument, collapsed: true } });
    }, []);

    const deselectCanvas = useCallback(() => {
        cancelPendingConnectionCreate();
        // 图片组展开态仅由「N 张」按钮切换，点空白画布取消选中时不收起
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setSelectionBox(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setDialogNodeId(null);
        setEditingNodeId(null);
        collapsePlanDocument();
    }, [cancelPendingConnectionCreate, collapsePlanDocument]);

    const clearCanvas = useCallback(() => {
        setNodes([]);
        setConnections([]);
        setInfoNodeId(null);
        setCropNodeId(null);
        setBlurNodeId(null);
        setPaintNodeId(null);
        setOutpaintNodeId(null);
        setMaskEditNodeId(null);
        setVideoLocalEditNodeId(null);
        setAngleNodeId(null);
        setPreviewNodeId(null);
        setRunningNodeId(null);
        setExpandedImageNodeIds(new Set());
        deselectCanvas();
        setClearConfirmOpen(false);
        cleanupCanvasFiles({ projectId, nodes: [], chatSessions: [] });
    }, [cleanupCanvasFiles, deselectCanvas, projectId]);

    const duplicateNode = useCallback((nodeId: string) => {
        const source = nodesRef.current.find((node) => node.id === nodeId);
        if (!source) return null;

        const id = `${source.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const next = cloneCanvasNodeData(source, {
            id,
            title: `${source.title} Copy`,
            position: { x: source.position.x + 36, y: source.position.y + 36 },
        });

        nodesRef.current = [...nodesRef.current, next];
        selectedNodeIdsRef.current = new Set([id]);
        setNodes(nodesRef.current);
        setSelectedNodeIds(selectedNodeIdsRef.current);
        setSelectedConnectionId(null);
        bringNodeToFront(id);
        if (next.type !== CanvasNodeType.Group) setDialogNodeId(id);
        return id;
    }, [bringNodeToFront]);

    const copySelectedNodes = useCallback((event: ClipboardEvent) => {
        if (!event.clipboardData) return;
        const selectedIds = selectedNodeIdsRef.current;
        if (!selectedIds.size) return;

        const copiedNodes = nodesRef.current
            .filter((node) => selectedIds.has(node.id))
            .map((node) => ({
                ...node,
                position: { ...node.position },
                metadata: node.metadata ? { ...node.metadata } : undefined,
            }));

        if (!copiedNodes.length) return;

        const marker = `<!--infinite-canvas:${nanoid()}-->`;
        event.clipboardData.setData("text/html", marker);
        event.preventDefault();
        clipboardRef.current = {
            marker,
            nodes: copiedNodes,
            connections: connectionsRef.current.filter((connection) => selectedIds.has(connection.fromNodeId) && selectedIds.has(connection.toNodeId)).map((connection) => ({ ...connection })),
        };

        // 同步把图片写入系统剪贴板，供画布外的应用粘贴
        const imageNode = copiedNodes.find(isCopyableImageNode);
        if (imageNode) {
            void copyNodeImageToSystemClipboard(imageNode, marker).then((ok) => {
                if (ok) message.success(t("canvas.projectPage.imageCopiedToSystem"));
            });
        }
    }, [message, t]);

    const getPasteMediaReplaceTarget = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        if (selectedIds.size !== 1) return null;
        const [selectedId] = selectedIds;
        const node = nodesRef.current.find((item) => item.id === selectedId);
        if (!node) return null;
        if (
            node.type !== CanvasNodeType.Image &&
            node.type !== CanvasNodeType.Video &&
            node.type !== CanvasNodeType.Audio &&
            node.type !== MODEL_NODE_TYPE
        ) {
            return null;
        }
        return node;
    }, []);

    /** 用画布内已复制的图片节点内容替换目标框（不新建节点） */
    const applyCopiedImageNodeToTarget = useCallback((targetId: string, source: CanvasNodeData) => {
        const naturalWidth = source.metadata?.naturalWidth || source.width || 1;
        const naturalHeight = source.metadata?.naturalHeight || source.height || 1;
        const nextSize = fitNodeSize(naturalWidth, naturalHeight);
        const title = source.title.endsWith(" Copy") ? source.title.slice(0, -5) : source.title;
        setNodes((prev) =>
            prev.map((node) =>
                node.id === targetId
                    ? {
                          ...node,
                          type: CanvasNodeType.Image,
                          title,
                          width: nextSize.width,
                          height: nextSize.height,
                          metadata: {
                              ...node.metadata,
                              content: source.metadata?.content,
                              storageKey: source.metadata?.storageKey,
                              naturalWidth: source.metadata?.naturalWidth,
                              naturalHeight: source.metadata?.naturalHeight,
                              bytes: source.metadata?.bytes,
                              mimeType: source.metadata?.mimeType,
                              status: NODE_STATUS_SUCCESS,
                              // 保留目标节点已选的生成配置
                              model: node.metadata?.model,
                              size: node.metadata?.size,
                              quality: node.metadata?.quality,
                              count: node.metadata?.count,
                              background: node.metadata?.background,
                              modelParams: node.metadata?.modelParams,
                              prompt: node.metadata?.prompt,
                              composerContent: node.metadata?.composerContent,
                              errorDetails: undefined,
                              freeResize: false,
                              images: undefined,
                              generationType: undefined,
                              references: undefined,
                              primaryImageId: undefined,
                          },
                      }
                    : node,
            ),
        );
        setSelectedNodeIds(new Set([targetId]));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(targetId);
        message.success(t("canvas.projectPage.clipboardImageReplaced"));
    }, [message, t]);

    const pasteCopiedNodes = useCallback((clipboardHtml: string) => {
        const clipboard = clipboardRef.current;
        if (!clipboard?.nodes.length || !clipboardHtml.includes(clipboard.marker)) return false;

        const replaceTarget = getPasteMediaReplaceTarget();
        const soleImageSource =
            clipboard.nodes.length === 1 && isCopyableImageNode(clipboard.nodes[0]) ? clipboard.nodes[0] : null;
        if (replaceTarget && soleImageSource && replaceTarget.id !== soleImageSource.id) {
            applyCopiedImageNodeToTarget(replaceTarget.id, soleImageSource);
            return true;
        }

        const center = getCanvasCenter();
        const bounds = clipboard.nodes.reduce(
            (acc, node) => ({
                left: Math.min(acc.left, node.position.x),
                top: Math.min(acc.top, node.position.y),
                right: Math.max(acc.right, node.position.x + node.width),
                bottom: Math.max(acc.bottom, node.position.y + node.height),
            }),
            { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
        );
        const dx = center.x - (bounds.left + bounds.right) / 2;
        const dy = center.y - (bounds.top + bounds.bottom) / 2;
        const idMap = new Map<string, string>();
        const nextNodes = clipboard.nodes.map((node, index) => {
            const id = `${node.type}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
            idMap.set(node.id, id);
            return cloneCanvasNodeData(node, {
                id,
                title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`,
                position: {
                    x: node.position.x + dx,
                    y: node.position.y + dy,
                },
            });
        });

        const pastedNodes = nextNodes.map((node) => {
            const groupId = node.metadata?.groupId;
            if (!groupId) return node;
            return { ...node, metadata: { ...node.metadata, groupId: idMap.get(groupId) } };
        });

        const nextConnections = clipboard.connections.flatMap((connection, index) => {
            const fromNodeId = idMap.get(connection.fromNodeId);
            const toNodeId = idMap.get(connection.toNodeId);
            if (!fromNodeId || !toNodeId) return [];
            return [
                {
                    ...connection,
                    id: `conn-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
                    fromNodeId,
                    toNodeId,
                },
            ];
        });

        setNodes((prev) => [...prev, ...pastedNodes]);
        setConnections((prev) => [...prev, ...nextConnections]);
        setSelectedNodeIds(new Set(pastedNodes.map((node) => node.id)));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(pastedNodes[0]?.type === CanvasNodeType.Group ? null : pastedNodes[0]?.id || null);
        return true;
    }, [applyCopiedImageNodeToTarget, getCanvasCenter, getPasteMediaReplaceTarget]);

    const fitAllNodes = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        const panel = useCanvasSidePanelStore.getState();
        const left = panel.panelOpen ? panel.width + 1 : 0;
        const next = fitNodesViewport(nodesRef.current, {
            x: left + 48, y: 72,
            width: Math.max(1, (rect?.width || size.width) - left - 96),
            height: Math.max(1, (rect?.height || size.height) - 168),
        });
        if (focusAnimRef.current) cancelAnimationFrame(focusAnimRef.current);
        focusAnimRef.current = null;
        viewportRef.current = next;
        setContextMenu(null);
        if (canvasViewportApiRef.current) canvasViewportApiRef.current.applyViewport(next, { immediate: true });
        else setViewport(next);
    }, [size.height, size.width]);

    const focusNode = useCallback(
        (nodeId: string) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (!node) return;
            const worldX = node.position.x + node.width / 2;
            const worldY = node.position.y + node.height / 2;
            const k = Math.min(Math.max(Math.min((size.width * 0.6) / node.width, (size.height * 0.6) / node.height), 0.05), 1);
            const target = { x: size.width / 2 - worldX * k, y: size.height / 2 - worldY * k, k };
            setSelectedNodeIds(new Set([nodeId]));
            setSelectedConnectionId(null);
            setContextMenu(null);
            bringNodeToFront(nodeId);

            if (focusAnimRef.current) cancelAnimationFrame(focusAnimRef.current);
            const start = { ...viewportRef.current };
            const duration = 450;
            const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
            let startTime: number | null = null;
            const step = (now: number) => {
                if (startTime === null) startTime = now;
                const progress = Math.min((now - startTime) / duration, 1);
                const t = easeOutCubic(progress);
                const next = { x: start.x + (target.x - start.x) * t, y: start.y + (target.y - start.y) * t, k: start.k + (target.k - start.k) * t };
                viewportRef.current = next;
                if (canvasViewportApiRef.current) canvasViewportApiRef.current.applyViewport(next, { immediate: progress >= 1 });
                else setViewport(next);
                focusAnimRef.current = progress < 1 ? requestAnimationFrame(step) : null;
            };
            focusAnimRef.current = requestAnimationFrame(step);
        },
        [bringNodeToFront, size.height, size.width],
    );

    useEffect(() => () => void (focusAnimRef.current && cancelAnimationFrame(focusAnimRef.current)), []);

    useEffect(() => {
        const offFocus = onCanvasEvent("node:focus", (id) => {
            if (typeof id === "string") focusNode(id);
        });
        const offPreview = onCanvasEvent("node:preview", (id) => {
            const node = nodesRef.current.find((item) => item.id === id);
            if (!node) return;
            if (node.type === SMART_PREVIEW_NODE_TYPE) {
                focusNode(node.id);
                pluginHost.updateMetadata(node.id, { smartPreviewFullscreen: true });
            } else if (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Text) {
                setPreviewNodeId(node.id);
            } else {
                focusNode(node.id);
                pluginHost.openPanel(node.id);
            }
        });
        return () => { offFocus(); offPreview(); };
    }, [focusNode, pluginHost]);

    const setZoomScale = useCallback(
        (scale: number) => {
            const prev = viewportRef.current;
            const nextScale = Math.min(Math.max(scale, prev.k < 0.05 ? Number.EPSILON : 0.05), 5);
            if (Math.abs(prev.k - nextScale) < 0.0001) return;
            const next = {
                x: size.width / 2 - ((size.width / 2 - prev.x) / prev.k) * nextScale,
                y: size.height / 2 - ((size.height / 2 - prev.y) / prev.k) * nextScale,
                k: nextScale,
            };
            viewportRef.current = next;
            setContextMenu(null);
            if (canvasViewportApiRef.current) canvasViewportApiRef.current.applyViewport(next);
            else setViewport(next);
        },
        [size.height, size.width],
    );

    const liveScaleListenersRef = useRef(new Set<(scale: number) => void>());
    const subscribeLiveScale = useCallback((listener: (scale: number) => void) => {
        liveScaleListenersRef.current.add(listener);
        return () => {
            liveScaleListenersRef.current.delete(listener);
        };
    }, []);

    const handleViewportLive = useCallback(
        (next: ViewportTransform) => {
            viewportRef.current = next;
            overlayRepaintRef.current?.();
            nodesLayerRef.current?.updateViewport(next);
            liveScaleListenersRef.current.forEach((listener) => listener(next.k));
            applyHoverToolbarScreenPosition(hoverToolbarElRef.current, hoverToolbarNodeRef.current, next);
        },
        [],
    );

    const handleViewportChange = useCallback((next: ViewportTransform) => {
        viewportRef.current = next;
        overlayRepaintRef.current?.();
        setViewport((prev) => (prev.x === next.x && prev.y === next.y && prev.k === next.k ? prev : next));
        setContextMenu(null);
    }, []);

    const applyHistory = useCallback((entry: CanvasHistoryEntry) => {
        if (historyCommitTimerRef.current) {
            clearTimeout(historyCommitTimerRef.current);
            historyCommitTimerRef.current = null;
        }
        const historyProjectId = loadedProjectIdRef.current;
        applyingHistoryRef.current = true;
        setNodes(entry.nodes);
        setConnections(entry.connections);
        setChatSessions(entry.chatSessions);
        setActiveChatId(entry.activeChatId);
        setBackgroundMode(entry.backgroundMode);
        setShowImageInfo(entry.showImageInfo);
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setTimeout(() => {
            if (loadedProjectIdRef.current !== historyProjectId) {
                applyingHistoryRef.current = false;
                return;
            }
            lastHistoryRef.current = entry;
            applyingHistoryRef.current = false;
            setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
        });
    }, []);

    const undoCanvas = useCallback(() => {
        if (roomActive) {
            message.info(t("canvas.roomShare.undoDisabled"));
            return;
        }
        if (applyingHistoryRef.current || loadedProjectIdRef.current !== projectId) return;
        if (historyCommitTimerRef.current) {
            clearTimeout(historyCommitTimerRef.current);
            historyCommitTimerRef.current = null;
        }
        const latest = createHistoryEntry();
        const committed = lastHistoryRef.current;
        if (committed && !sameHistoryEntry(committed, latest)) {
            historyRef.current.past = [...historyRef.current.past.slice(-49), committed];
            historyRef.current.future = [];
            lastHistoryRef.current = latest;
        }
        const previous = historyRef.current.past.pop();
        const current = lastHistoryRef.current;
        if (!previous || !current) return;
        historyRef.current.future.push(current);
        applyHistory(previous);
    }, [applyHistory, createHistoryEntry, projectId, roomActive, message, t]);

    const redoCanvas = useCallback(() => {
        if (roomActive) {
            message.info(t("canvas.roomShare.undoDisabled"));
            return;
        }
        if (applyingHistoryRef.current || loadedProjectIdRef.current !== projectId || !sameHistoryEntry(lastHistoryRef.current, createHistoryEntry())) return;
        const next = historyRef.current.future.pop();
        const current = lastHistoryRef.current;
        if (!next || !current) return;
        historyRef.current.past.push(current);
        applyHistory(next);
    }, [applyHistory, createHistoryEntry, projectId, roomActive, message, t]);

    const importRoomCopy = useCallback(() => {
        const id = importProject({
            title: `${canvasTitle} (${t("canvas.roomShare.copySuffix")})`,
            nodes,
            connections,
            backgroundMode,
            viewport,
        });
        message.success(t("canvas.roomShare.importCopyDone"));
        navigate(`/canvas/${id}`);
    }, [backgroundMode, canvasTitle, connections, importProject, message, navigate, nodes, t, viewport]);

    const createAndOpenProject = useCallback(() => {
        const id = createProject(t("canvas.defaultTitle", { count: useCanvasStore.getState().projects.length + 1 }));
        navigate(`/canvas/${id}`);
    }, [createProject, navigate, t]);

    const deleteCurrentProject = useCallback(() => {
        deleteProjects([projectId]);
        cleanupAssetImages();
        navigate("/canvas");
    }, [cleanupAssetImages, deleteProjects, navigate, projectId]);

    const exportCurrentProject = useCallback(async () => {
        const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
        if (!project) return message.error(t("canvas.projectPage.notFound"));
        const hide = message.loading(t("canvas.projectPage.exporting"), 0);
        try {
            await exportCanvasProjects([project], project.title || t("canvas.title"));
            message.success(t("canvas.projectPage.exported"));
        } catch (error) {
            console.error(error);
            message.error(t("canvas.sidePanel.exportFailed"));
        } finally {
            hide();
        }
    }, [message, projectId, t]);

    const handleCanvasMouseDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            suppressDragContextMenuRef.current = false;
            setContextMenu(null);
            setNodeCreatePosition(null);
            setHoveredNodeId(null);
            setToolbarNodeId(null);
            setDialogNodeId(null);
            setEditingNodeId(null);
            if (pendingConnectionCreateRef.current) cancelPendingConnectionCreate();
            collapsePlanDocument();
            if (event.button !== 0) return;

            const world = screenToCanvas(event.clientX, event.clientY);
            const hitConnection = hitTestConnectionAt(world.x, world.y, connectionHitItemsRef.current);
            if (hitConnection) {
                setSelectedConnectionId(hitConnection);
                setSelectedNodeIds(new Set());
                setContextMenu(null);
                return;
            }
            const nextSelectionBox = {
                startWorldX: world.x,
                startWorldY: world.y,
                currentWorldX: world.x,
                currentWorldY: world.y,
                additive: event.shiftKey,
                initialSelectedNodeIds: event.shiftKey ? Array.from(selectedNodeIdsRef.current) : [],
            };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            if (!event.shiftKey) {
                setSelectedNodeIds(new Set());
            }

            setSelectedConnectionId(null);
        },
        [cancelPendingConnectionCreate, collapsePlanDocument, screenToCanvas, setSelectedNodeIds],
    );

    // Selection-only logic shared by the bubbling drag entry point and outer capture handler.
    // Returns the single target ID after the click, or null for multi-selection or deselection, to sync the toolbar.
    // Shift/Cmd/Ctrl append selection; Alt+click duplicates via handleNodeSelectCapture instead.
    const selectNodeByEvent = useCallback((event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }, nodeId: string) => {
        const related = canvasToolRef.current === "relatedSelect";
        const componentIds = related ? collectConnectedComponentIds(nodeId, connectionsRef.current, nodesRef.current) : new Set([nodeId]);
        const nextSelected = new Set(selectedNodeIdsRef.current);
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            if (nextSelected.has(nodeId)) {
                for (const id of componentIds) nextSelected.delete(id);
            } else {
                for (const id of componentIds) nextSelected.add(id);
            }
        } else if (nextSelected.has(nodeId) && nextSelected.size > 1) {
            // 已在多选中：保持选区，便于整体拖动（不要降成只选当前节点）
        } else {
            nextSelected.clear();
            for (const id of componentIds) nextSelected.add(id);
        }
        setSelectedNodeIds(nextSelected, !related);
        selectedNodeIdsRef.current = nextSelected;
        if (nextSelected.has(nodeId)) bringNodeToFront(nodeId);
        const soloId = nextSelected.size === 1 && nextSelected.has(nodeId) ? nodeId : null;
        setToolbarNodeId(soloId);
        return { nextSelected, soloId };
    }, [bringNodeToFront]);

    // Capture-phase selection lets any inner element, including textarea or iframe, select the node and show its toolbar.
    // It only selects; body onMouseDown still starts dragging, so text selection inside editors does not drag the node.
    // Cache the capture result for the following bubbling drag handler to avoid applying shift-selection twice.
    const pendingSelectionRef = useRef<Set<string> | null>(null);
    const handleNodeSelectCapture = useCallback(
        (event: ReactMouseEvent | ReactPointerEvent, nodeId: string) => {
            suppressDragContextMenuRef.current = false;
            if (event.button !== 0) return;
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (node && !isDataGroupBorderHit(node, screenToCanvas(event.clientX, event.clientY), viewportRef.current.k)) return;
            setContextMenu(null);
            setHoveredNodeId(null);
            setSelectedConnectionId(null);
            pendingAlignNodeIdRef.current = nodeId;
            // 点选节点 A 后再按节点 B：此时选区仍是 A，立刻记为对齐锚点（不依赖 A 的 mousedown 是否冒泡）
            const previousSelected = selectedNodeIdsRef.current;
            if (previousSelected.size === 1) {
                const previousId = previousSelected.values().next().value as string | undefined;
                if (previousId && previousId !== nodeId) lastAlignClickNodeIdRef.current = previousId;
            }
            // Alt+选中：复制节点；随后可直接拖动副本。Shift/Cmd/Ctrl 仍用于追加选择。
            if (event.altKey && !event.shiftKey) {
                const copiedId = duplicateNode(nodeId);
                pendingSelectionRef.current = copiedId ? new Set([copiedId]) : null;
                return;
            }
            const { nextSelected } = selectNodeByEvent(event, nodeId);
            pendingSelectionRef.current = nextSelected;
        },
        [duplicateNode, screenToCanvas, selectNodeByEvent],
    );

    const handleNodeMouseDown = useCallback((event: ReactMouseEvent | ReactPointerEvent, nodeId: string) => {
        // 右键关联拖动，中键仍交给画布平移。
        if (event.button !== 0 && event.button !== 2) return;
        if ("pointerType" in event && event.pointerType !== "mouse" && isCanvasTouchPinchActive()) return;
        if ("pointerType" in event && event.pointerType !== "mouse") {
            event.preventDefault();
            try {
                event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
                // 某些嵌套 SVG/iframe 目标不允许捕获，窗口级 pointermove 仍会接管拖动。
            }
        }
        const rightButton = event.button === 2;
        const node = nodesRef.current.find((item) => item.id === nodeId);
        if (node && !isDataGroupBorderHit(node, screenToCanvas(event.clientX, event.clientY), viewportRef.current.k)) return;
        event.stopPropagation();
        // Capture 未跑到时，Alt+按下同样走复制（与 capture 一致）。
        if (!rightButton && !pendingSelectionRef.current && event.altKey && !event.shiftKey) {
            const copiedId = duplicateNode(nodeId);
            pendingSelectionRef.current = copiedId ? new Set([copiedId]) : null;
        }
        // Capture already selected the node; this only starts dragging, with a fallback selection if capture did not run.
        const currentNodes = nodesRef.current;
        const nextSelected = rightButton
            ? collectConnectedComponentIds(nodeId, connectionsRef.current, currentNodes)
            : pendingSelectionRef.current ?? selectNodeByEvent(event, nodeId).nextSelected;
        pendingSelectionRef.current = null;
        const dragIds = new Set(nextSelected);
        currentNodes.forEach((node) => {
            if (!nextSelected.has(node.id)) return;
            if (node.type === CanvasNodeType.Group) collectGroupDragMemberIds(node.id, node, currentNodes, dragIds);
        });
        // 冻结对齐锚点；拖动过程中不要把当前节点写成锚点，否则下一次会丢目标
        const previousAlignTarget = lastAlignClickNodeIdRef.current;
        const preferredTargetId = previousAlignTarget && !dragIds.has(previousAlignTarget) ? previousAlignTarget : null;
        dragRef.current = {
            isDraggingNode: true,
            rightButton,
            hasMoved: false,
            startX: event.clientX,
            startY: event.clientY,
            dragIds,
            initialSelectedNodes: currentNodes.filter((node) => dragIds.has(node.id)).map((node) => ({ id: node.id, x: node.position.x, y: node.position.y })),
            preferredTargetId,
            pressedNodeId: nodeId,
        };
        useCanvasInteractionStore.getState().setLiveDrag(null);
        snapSmoothRef.current = { x: 0, y: 0, lastT: 0 };
        historyPausedRef.current = true;
        nodeDraggingRef.current = true;
        setIsNodeDragging(true);
    }, [duplicateNode, screenToCanvas, selectNodeByEvent]);

    const finishNodeDrag = useCallback((clientX?: number, clientY?: number) => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        if (!dragRef.current.isDraggingNode) return;

        const hasMoved = dragRef.current.hasMoved;
        const wasClick = !dragRef.current.rightButton && !hasMoved && dragRef.current.initialSelectedNodes.length === 1;
        const clickedNodeId = dragRef.current.initialSelectedNodes[0]?.id;
        const pressedNodeId = dragRef.current.pressedNodeId;
        if (!hasMoved) {
            const alignId = pressedNodeId || clickedNodeId || pendingAlignNodeIdRef.current;
            if (alignId) lastAlignClickNodeIdRef.current = alignId;
        }
        pendingAlignNodeIdRef.current = null;
        const currentViewport = viewportRef.current;
        const dx = clientX == null ? 0 : (clientX - dragRef.current.startX) / currentViewport.k;
        const dy = clientY == null ? 0 : (clientY - dragRef.current.startY) / currentViewport.k;
        const initialPositions = dragRef.current.initialSelectedNodes;

        historyPausedRef.current = false;
        nodeDraggingRef.current = false;
        setIsNodeDragging(false);
        setDropTargetGroupId(null);
        setAlignGuides([]);
        setCanvasAssetDropHover(false);
        setCanvasPromptDropHover(false);
        useAgentStore.getState().setAgentState({ codexPanelDropHover: false });
        if (dragRef.current.hasMoved && clientX != null && clientY != null) {
            const revertDraggedNodes = () => {
                useCanvasInteractionStore.getState().setLiveDrag(null);
                setNodes((prev) =>
                    prev.map((item) => {
                        const initial = initialPositions.find((pos) => pos.id === item.id);
                        return initial ? { ...item, position: { x: initial.x, y: initial.y } } : item;
                    }),
                );
                dragRef.current.isDraggingNode = false;
                dragRef.current.hasMoved = false;
                dragRef.current.initialSelectedNodes = [];
            };

            // 不能用 elementFromPoint：松手时指针下往往是正在拖的节点，点不到侧栏
            if (isPointOverAssetDropZone(clientX, clientY)) {
                const nodeId = initialPositions[0]?.id;
                const node = nodeId ? nodesRef.current.find((item) => item.id === nodeId) : null;
                const canSave =
                    node &&
                    (node.type === FOLDER_NODE_TYPE
                        || (node.type === CanvasNodeType.Image && node.metadata?.content)
                        || (node.type === CanvasNodeType.Video && node.metadata?.content)
                        || (node.type === CanvasNodeType.Text && node.metadata?.content?.trim()));
                revertDraggedNodes();
                if (canSave && node) void saveNodeAssetRef.current(node);
                return;
            }
            if (isPointOverPromptDropZone(clientX, clientY)) {
                const nodeIds = new Set(initialPositions.map((item) => item.id));
                const targets = nodesRef.current.filter((item) => nodeIds.has(item.id));
                revertDraggedNodes();
                if (targets.length) void savePromptAssetRef.current(targets);
                return;
            }
            if (!dragRef.current.rightButton && canvasToolRef.current !== "relatedSelect" && isPointOverCodexPanelDropZone(clientX, clientY)) {
                const nodeIds = initialPositions.map((item) => item.id);
                const liveNodes = nodesRef.current;
                revertDraggedNodes();
                void applyCanvasNodesToComposer(nodeIds, { nodes: liveNodes }).then((result) => {
                    if (result.ok) message.success(t("agent.composer.canvasSelectionAdded", { count: result.count }));
                    else if (result.reason === "no-canvas") message.warning(t("agent.composer.noCanvas"));
                    else if (result.reason === "too-large") message.warning(t("agent.composer.imageLimit"));
                    else message.warning(t("agent.composer.canvasSelectionEmpty"));
                });
                return;
            }
            const movedIds = new Set(initialPositions.map((item) => item.id));
            const snapped = snapDragToNearbyNodes({
                movingIds: movedIds,
                initialPositions,
                allNodes: nodesRef.current,
                connections: connectionsRef.current,
                dx,
                dy,
                zoom: currentViewport.k,
                preferredTargetId: dragRef.current.preferredTargetId,
            });
            setNodes((prev) => {
                const moved = prev.map((node) => {
                    const initial = initialPositions.find((item) => item.id === node.id);
                    return initial ? { ...node, position: { x: initial.x + snapped.dx, y: initial.y + snapped.dy } } : node;
                });
                const targetGroup = findGroupDropTarget(movedIds, moved);
                if (targetGroup) return snapNodesIntoGroup(movedIds, moved, targetGroup);
                return moved.map((node) => {
                    if (!movedIds.has(node.id)) return node;
                    if (node.metadata?.groupId && movedIds.has(node.metadata.groupId)) return node;
                    const groupId = findContainingGroupId(node, moved);
                    if (node.metadata?.groupId === groupId) return node;
                    return { ...node, metadata: { ...node.metadata, groupId } };
                });
            });
        }

        useCanvasInteractionStore.getState().setLiveDrag(null);
        dragRef.current.isDraggingNode = false;
        dragRef.current.hasMoved = false;
        dragRef.current.initialSelectedNodes = [];
        dragRef.current.preferredTargetId = null;
        dragRef.current.pressedNodeId = null;
        if (wasClick && clickedNodeId) {
            const clickedNode = nodesRef.current.find((node) => node.id === clickedNodeId);
            const clickedDefinition = clickedNode ? getNodeDefinition(clickedNode.type) : undefined;
            if (clickedNode?.type === CanvasNodeType.Text) {
                setDialogNodeId((current) => (current === clickedNodeId ? current : null));
            } else if (clickedDefinition?.hidePanel) {
                // Clicking a display-only plugin node selects it without opening a lower panel.
                setDialogNodeId((current) => (current === clickedNodeId ? current : null));
            } else if (clickedNode?.type !== CanvasNodeType.Group) {
                setDialogNodeId(clickedNodeId);
            }
        }
    }, [setAlignGuides]);

    const cancelTouchCanvasInteraction = useCallback(() => {
        cancelCanvasNodeTouchInteraction();
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        pendingDragPointRef.current = null;
        if (dragRef.current.isDraggingNode) {
            const initialById = new Map(dragRef.current.initialSelectedNodes.map((item) => [item.id, item]));
            const restore = (items: CanvasNodeData[]) =>
                items.map((item) => {
                    const initial = initialById.get(item.id);
                    return initial ? { ...item, position: { x: initial.x, y: initial.y } } : item;
                });
            nodesRef.current = restore(nodesRef.current);
            setNodes(restore);
        }
        dragRef.current.isDraggingNode = false;
        dragRef.current.hasMoved = false;
        dragRef.current.initialSelectedNodes = [];
        dragRef.current.dragIds = new Set();
        dragRef.current.preferredTargetId = null;
        dragRef.current.pressedNodeId = null;
        historyPausedRef.current = false;
        nodeDraggingRef.current = false;
        setIsNodeDragging(false);
        setIsNodeResizing(false);
        useCanvasInteractionStore.getState().setLiveDrag(null);
        selectionBoxRef.current = null;
        setSelectionBox(null);
        pendingSelectionRef.current = null;
        setConnecting(null);
        setConnectionTargetNodeId(null);
        connectionTargetNodeIdRef.current = null;
        setDropTargetGroupId(null);
        setAlignGuides([]);
        setCanvasAssetDropHover(false);
        setCanvasPromptDropHover(false);
        useAgentStore.getState().setAgentState({ codexPanelDropHover: false });
    }, [setAlignGuides, setConnecting]);

    const handleGlobalMouseMove = useCallback(
        (event: MouseEvent) => {
            if (isCanvasTouchPinchActive()) return;
            const currentViewport = viewportRef.current;

            if (dragRef.current.isDraggingNode) {
                pendingDragPointRef.current = { clientX: event.clientX, clientY: event.clientY };
                if (Math.abs(event.clientX - dragRef.current.startX) > 3 || Math.abs(event.clientY - dragRef.current.startY) > 3) {
                    if (!dragRef.current.hasMoved && dragRef.current.rightButton) {
                        suppressDragContextMenuRef.current = true;
                        setContextMenu(null);
                        setHoveredNodeId(null);
                        setSelectedConnectionId(null);
                        const selected = new Set(dragRef.current.dragIds);
                        selectedNodeIdsRef.current = selected;
                        setSelectedNodeIds(selected, false);
                        setToolbarNodeId(null);
                    }
                    dragRef.current.hasMoved = true;
                }
                if (dragRef.current.rightButton && !dragRef.current.hasMoved) return;
                if (rafRef.current) return;
                rafRef.current = requestAnimationFrame(() => {
                    rafRef.current = null;
                    const pending = pendingDragPointRef.current;
                    if (!pending || !dragRef.current.isDraggingNode || isCanvasTouchPinchActive()) return;

                    // 先读投放区域，再写节点位置，避免同一帧交错读写布局。
                    const overAssets = isPointOverAssetDropZone(pending.clientX, pending.clientY);
                    const overPrompt = isPointOverPromptDropZone(pending.clientX, pending.clientY);
                    const overCodex = !dragRef.current.rightButton && canvasToolRef.current !== "relatedSelect" && isPointOverCodexPanelDropZone(pending.clientX, pending.clientY);
                    const initialPositions = dragRef.current.initialSelectedNodes;
                    const dx = (pending.clientX - dragRef.current.startX) / currentViewport.k;
                    const dy = (pending.clientY - dragRef.current.startY) / currentViewport.k;
                    const initialById = new Map(initialPositions.map((item) => [item.id, item]));
                    const movedIds = dragRef.current.dragIds;
                    const snapped = snapDragToNearbyNodes({
                        movingIds: movedIds,
                        initialPositions,
                        allNodes: nodesRef.current,
                        connections: connectionsRef.current,
                        dx,
                        dy,
                        zoom: currentViewport.k,
                        preferredTargetId: dragRef.current.preferredTargetId,
                    });
                    const now = performance.now();
                    const dt = snapSmoothRef.current.lastT ? now - snapSmoothRef.current.lastT : 16;
                    snapSmoothRef.current.lastT = now;
                    const offset = smoothSnapOffset(snapSmoothRef.current, { x: snapped.dx - dx, y: snapped.dy - dy }, dt);
                    snapSmoothRef.current.x = offset.x;
                    snapSmoothRef.current.y = offset.y;
                    const displayDx = dx + offset.x;
                    const displayDy = dy + offset.y;
                    const nextNodes = nodesRef.current.map((node) => {
                        const initial = initialById.get(node.id);
                        return initial ? { ...node, position: { x: initial.x + displayDx, y: initial.y + displayDy } } : node;
                    });
                    nodesRef.current = nextNodes;
                    useCanvasInteractionStore.getState().setLiveDrag({ dx: displayDx, dy: displayDy, ids: movedIds });
                    overlayRepaintRef.current?.();

                    const dropId = findGroupDropTarget(movedIds, nextNodes)?.id || null;
                    setDropTargetGroupId((current) => (current === dropId ? current : dropId));
                    setAlignGuides(snapped.guides);

                    setCanvasAssetDropHover(overAssets);
                    setCanvasPromptDropHover(overPrompt);
                    const agentState = useAgentStore.getState();
                    if (agentState.codexPanelDropHover !== overCodex) agentState.setAgentState({ codexPanelDropHover: overCodex });
                });
                return;
            }

            if (connectingParamsRef.current && !pendingConnectionCreateRef.current) {
                const overCodex = isCodexPanelConnectTarget(event.clientX, event.clientY);
                useAgentStore.getState().setAgentState({ codexPanelDropHover: overCodex });
                const dropTarget = overCodex
                    ? { nodeId: null, isNearNode: true }
                    : getConnectionDropTarget(event.clientX, event.clientY, connectingParamsRef.current);
                connectionTargetNodeIdRef.current = dropTarget.nodeId;
                setConnectionTargetNodeId(dropTarget.nodeId);
                setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            }
        },
        [finishNodeDrag, getConnectionDropTarget, screenToCanvas, setAlignGuides],
    );

    const handleGlobalPointerMove = useCallback(
        (event: PointerEvent) => {
            if (dragRef.current.isDraggingNode) {
                handleGlobalMouseMove(event);
                return;
            }

            const currentSelection = selectionBoxRef.current;
            if (!currentSelection) return;

            if (event.buttons === 0) {
                selectionBoxRef.current = null;
                setSelectionBox(null);
                return;
            }

            const world = screenToCanvas(event.clientX, event.clientY);
            const rectX = Math.min(currentSelection.startWorldX, world.x);
            const rectY = Math.min(currentSelection.startWorldY, world.y);
            const rectW = Math.abs(world.x - currentSelection.startWorldX);
            const rectH = Math.abs(world.y - currentSelection.startWorldY);
            const nextSelected = new Set<string>(currentSelection.additive ? currentSelection.initialSelectedNodeIds : []);

            nodesRef.current
                .forEach((node) => {
                    const intersects = rectX < node.position.x + node.width && rectX + rectW > node.position.x && rectY < node.position.y + node.height && rectY + rectH > node.position.y;

                    if (intersects) nextSelected.add(node.id);
                });

            const finalSelected =
                canvasToolRef.current === "relatedSelect"
                    ? expandSelectionByConnections(nextSelected, connectionsRef.current, nodesRef.current)
                    : nextSelected;

            const nextSelectionBox = { ...currentSelection, currentWorldX: world.x, currentWorldY: world.y };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            setSelectedNodeIds(finalSelected, canvasToolRef.current !== "relatedSelect");
        },
        [handleGlobalMouseMove, screenToCanvas],
    );

    const handleGlobalMouseUp = useCallback(
        (event: MouseEvent) => {
            finishNodeDrag(event.clientX, event.clientY);
            if (pendingAlignNodeIdRef.current) {
                lastAlignClickNodeIdRef.current = pendingAlignNodeIdRef.current;
                pendingAlignNodeIdRef.current = null;
            }

            selectionBoxRef.current = null;
            setSelectionBox(null);

            if (pendingConnectionCreateRef.current) return;

            const currentConnection = connectingParamsRef.current;
            if (currentConnection) {
                if (isCodexPanelConnectTarget(event.clientX, event.clientY)) {
                    const sourceNodeId = currentConnection.nodeId;
                    setConnecting(null);
                    void applyCanvasNodesToComposer([sourceNodeId], { nodes: nodesRef.current }).then((result) => {
                        if (result.ok) message.success(t("agent.composer.canvasSelectionAdded", { count: result.count }));
                        else if (result.reason === "no-canvas") message.warning(t("agent.composer.noCanvas"));
                        else if (result.reason === "too-large") message.warning(t("agent.composer.imageLimit"));
                        else message.warning(t("agent.composer.canvasSelectionEmpty"));
                    });
                    return;
                }
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, currentConnection);
                if (dropTarget.nodeId) {
                    connectNodes(currentConnection, dropTarget.nodeId, screenToCanvas(event.clientX, event.clientY), dropTarget.side);
                    setConnecting(null);
                } else if (dropTarget.isNearNode) {
                    setConnecting(null);
                } else {
                    const attachPoint = screenToCanvas(event.clientX, event.clientY);
                    // 虚线停在松手点；菜单对边对齐到该点（左边拖出→菜单右边贴线，不跳动）
                    setMouseWorld(attachPoint);
                    setPendingConnectionCreate({
                        connection: currentConnection,
                        attachPoint,
                        position: connectionCreateMenuPositionFromAttach(attachPoint, currentConnection.side),
                    });
                }
            }
        },
        [connectNodes, finishNodeDrag, getConnectionDropTarget, message, screenToCanvas, setConnecting, t],
    );

    useEffect(() => {
        const handlePointerUp = (event: PointerEvent) => {
            if (event.pointerType !== "mouse") {
                handleGlobalMouseUp(event);
                return;
            }
            finishNodeDrag(event.clientX, event.clientY);
            if (pendingAlignNodeIdRef.current) {
                lastAlignClickNodeIdRef.current = pendingAlignNodeIdRef.current;
                pendingAlignNodeIdRef.current = null;
            }
        };
        const cancelNodeDrag = (event: Event) => {
            if (event instanceof PointerEvent && event.pointerType !== "mouse") {
                // 系统意外取消单指拖动时保留已移动的位置；双指手势开始前会先主动取消并复位。
                if (dragRef.current.isDraggingNode && dragRef.current.hasMoved) {
                    const point = pendingDragPointRef.current;
                    finishNodeDrag(point?.clientX ?? event.clientX, point?.clientY ?? event.clientY);
                } else {
                    cancelTouchCanvasInteraction();
                }
            } else finishNodeDrag();
        };
        window.addEventListener("mousemove", handleGlobalMouseMove);
        window.addEventListener("mouseup", handleGlobalMouseUp);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", cancelNodeDrag);
        window.addEventListener("blur", cancelNodeDrag);
        window.addEventListener("pointermove", handleGlobalPointerMove);
        return () => {
            window.removeEventListener("mousemove", handleGlobalMouseMove);
            window.removeEventListener("mouseup", handleGlobalMouseUp);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", cancelNodeDrag);
            window.removeEventListener("blur", cancelNodeDrag);
            window.removeEventListener("pointermove", handleGlobalPointerMove);
        };
    }, [cancelTouchCanvasInteraction, finishNodeDrag, handleGlobalMouseMove, handleGlobalMouseUp, handleGlobalPointerMove]);

    const createImageFileNode = useCallback(async (file: File, position: Position) => {
        const { setNodes, isActive } = createGenerationScope();
        const image = await uploadImage(file);
        const size = fitNodeSize(image.width, image.height);
        const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newNode: CanvasNodeData = {
            id,
            type: CanvasNodeType.Image,
            title: file.name,
            position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
            width: size.width,
            height: size.height,
            metadata: imageMetadata(image),
        };

        setNodes((prev) => [...prev, newNode]);
        if (isActive()) setSelectedNodeIds(new Set([id]));
        if (isActive()) setSelectedConnectionId(null);
        if (isActive()) setDialogNodeId(id);
    }, [createGenerationScope]);

    /** 将本地图片/视频/音频/模型填入已有节点（拖入或上传替换） */
    const applyMediaFileToNode = useCallback(async (nodeId: string, file: File) => {
        const { setNodes, isActive } = createGenerationScope();
        if (isModel3dFileName(file.name)) {
            if (file.size > 32_000_000) {
                message.error(t("canvas.modelNode.tooLarge"));
                return;
            }
            const typed =
                file.type && file.type !== "application/octet-stream"
                    ? file
                    : new File([file], file.name, { type: model3dMimeType(file.name) });
            const model = await uploadMediaFile(typed, "model");
            const spec = getNodeSpec(MODEL_NODE_TYPE);
            setNodes((prev) =>
                prev.map((node) =>
                    node.id === nodeId
                        ? {
                              ...node,
                              type: MODEL_NODE_TYPE,
                              title: file.name,
                              position: { x: node.position.x + node.width / 2 - spec.width / 2, y: node.position.y + node.height / 2 - spec.height / 2 },
                              width: spec.width,
                              height: spec.height,
                              metadata: { ...node.metadata, ...modelMetadata(model, file.name), errorDetails: undefined },
                          }
                        : node,
                ),
            );
            return;
        }
        if (isAudioFile(file)) {
            const audio = await uploadMediaFile(file, "audio");
            const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
            setNodes((prev) =>
                prev.map((node) =>
                    node.id === nodeId
                        ? {
                              ...node,
                              type: CanvasNodeType.Audio,
                              title: file.name,
                              position: { x: node.position.x + node.width / 2 - spec.width / 2, y: node.position.y + node.height / 2 - spec.height / 2 },
                              width: spec.width,
                              height: spec.height,
                              metadata: { ...node.metadata, ...audioMetadata(audio), clipStartMs: undefined, clipEndMs: undefined, errorDetails: undefined },
                          }
                        : node,
                ),
            );
        } else if (file.type.startsWith("video/")) {
            try {
                await assertCanvasVideoDuration(file);
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("canvas.videoPlayer.tooLong"));
                return;
            }
            const video = await uploadMediaFile(file, "video");
            const nextSize = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
            setNodes((prev) =>
                prev.map((node) =>
                    node.id === nodeId
                        ? {
                              ...node,
                              type: CanvasNodeType.Video,
                              title: file.name,
                              position: { x: node.position.x + node.width / 2 - nextSize.width / 2, y: node.position.y + node.height / 2 - nextSize.height / 2 },
                              width: nextSize.width,
                              height: nextSize.height,
                              metadata: { ...node.metadata, ...videoMetadata(video), clipStartMs: undefined, clipEndMs: undefined, includeAudio: undefined, errorDetails: undefined },
                          }
                        : node,
                ),
            );
        } else {
            const image = await uploadImage(file);
            const s = fitNodeSize(image.width, image.height);
            setNodes((prev) =>
                prev.map((node) =>
                    node.id === nodeId
                        ? {
                              ...node,
                              type: CanvasNodeType.Image,
                              title: file.name,
                              width: s.width,
                              height: s.height,
                              metadata: {
                                  ...node.metadata,
                                  ...imageMetadata(image),
                                  // 保留用户已选的生成配置（模型/比例/质量/张数等），上传或替换图片不应重置
                                  model: node.metadata?.model,
                                  size: node.metadata?.size,
                                  quality: node.metadata?.quality,
                                  count: node.metadata?.count,
                                  background: node.metadata?.background,
                                  modelParams: node.metadata?.modelParams,
                                  prompt: node.metadata?.prompt,
                                  composerContent: node.metadata?.composerContent,
                                  errorDetails: undefined,
                                  freeResize: false,
                                  images: undefined,
                                  generationType: undefined,
                                  references: undefined,
                                  primaryImageId: undefined,
                              },
                          }
                        : node,
                ),
            );
        }
        if (isActive()) setSelectedNodeIds(new Set([nodeId]));
        if (isActive()) setSelectedConnectionId(null);
        if (isActive()) setDialogNodeId(nodeId);
    }, [createGenerationScope, message, t]);

    const findNodeAtClientPoint = useCallback(
        (clientX: number, clientY: number) => {
            const world = screenToCanvas(clientX, clientY);
            return [...nodesRef.current]
                .reverse()
                .find((node) => world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height);
        },
        [screenToCanvas],
    );

    const createVideoFileNode = useCallback(async (file: File, position: Position) => {
        const { setNodes, isActive } = createGenerationScope();
        try {
            await assertCanvasVideoDuration(file);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.videoPlayer.tooLong"));
            return;
        }
        const video = await uploadMediaFile(file, "video");
        const size = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
        const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Video,
                title: file.name,
                position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
                width: size.width,
                height: size.height,
                metadata: videoMetadata(video),
            },
        ]);
        if (isActive()) setSelectedNodeIds(new Set([id]));
        if (isActive()) setSelectedConnectionId(null);
        if (isActive()) setDialogNodeId(id);
    }, [createGenerationScope, message, t]);

    const createAudioFileNode = useCallback(async (file: File, position: Position) => {
        const { setNodes, isActive } = createGenerationScope();
        const audio = await uploadMediaFile(file, "audio");
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
        const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Audio,
                title: file.name,
                position: { x: position.x - spec.width / 2, y: position.y - spec.height / 2 },
                width: spec.width,
                height: spec.height,
                metadata: audioMetadata(audio),
            },
        ]);
        if (isActive()) setSelectedNodeIds(new Set([id]));
        if (isActive()) setSelectedConnectionId(null);
    }, [createGenerationScope]);

    const createModelFileNode = useCallback(
        async (file: File, position: Position) => {
            const { setNodes, isActive } = createGenerationScope();
            if (file.size > 32_000_000) {
                message.error(t("canvas.modelNode.tooLarge"));
                return;
            }
            const typed =
                file.type && file.type !== "application/octet-stream"
                    ? file
                    : new File([file], file.name, { type: model3dMimeType(file.name) });
            const model = await uploadMediaFile(typed, "model");
            const spec = getNodeSpec(MODEL_NODE_TYPE);
            const id = `model-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            setNodes((prev) => [
                ...prev,
                {
                    id,
                    type: MODEL_NODE_TYPE,
                    title: file.name,
                    position: { x: position.x - spec.width / 2, y: position.y - spec.height / 2 },
                    width: spec.width,
                    height: spec.height,
                    metadata: modelMetadata(model, file.name),
                },
            ]);
            if (isActive()) setSelectedNodeIds(new Set([id]));
            if (isActive()) setSelectedConnectionId(null);
        },
        [createGenerationScope, message, t],
    );

    const applyDroppedText = useCallback(
        (text: string, clientX: number, clientY: number) => {
            const trimmed = text.trim();
            if (!trimmed) return false;

            const target = findNodeAtClientPoint(clientX, clientY);
            const canFillText =
                target?.type === CanvasNodeType.Text &&
                !(target.metadata?.documentKind === "excel" && target.metadata?.excelSheets?.length);

            if (canFillText && target) {
                const wasEmpty = !String(target.metadata?.content || "").trim();
                setNodes((prev) =>
                    prev.map((node) =>
                        node.id === target.id
                            ? {
                                  ...node,
                                  title: wasEmpty ? trimmed.slice(0, 32) || node.title : node.title,
                                  metadata: {
                                      ...node.metadata,
                                      content: trimmed,
                                      status: NODE_STATUS_SUCCESS,
                                      errorDetails: undefined,
                                  },
                              }
                            : node,
                    ),
                );
                setSelectedNodeIds(new Set([target.id]));
                setSelectedConnectionId(null);
                setDialogNodeId(target.id);
                return true;
            }

            const node = {
                ...createCanvasNode(CanvasNodeType.Text, screenToCanvas(clientX, clientY), { content: trimmed, status: NODE_STATUS_SUCCESS }),
                title: trimmed.slice(0, 32) || t("canvas.projectPage.clipboardText"),
            };
            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(node.id);
            return true;
        },
        [findNodeAtClientPoint, screenToCanvas, t],
    );

    const createTextNodeFromClipboard = useCallback(
        (text: string) => {
            const { setNodes, isActive } = createGenerationScope();
            const trimmed = text.trim();
            if (!trimmed) return false;

            const node = {
                ...createCanvasNode(CanvasNodeType.Text, getCanvasCenter(), { content: trimmed, status: NODE_STATUS_SUCCESS }),
                title: trimmed.slice(0, 32) || t("canvas.projectPage.clipboardText"),
            };

            setNodes((prev) => [...prev, node]);
            if (isActive()) setSelectedNodeIds(new Set([node.id]));
            if (isActive()) setSelectedConnectionId(null);
            if (isActive()) setContextMenu(null);
            if (isActive()) setDialogNodeId(node.id);
            return true;
        },
        [createGenerationScope, getCanvasCenter, t],
    );

    const applyClipboardImage = useCallback(
        async (data: DataTransfer | null) => {
            try {
                const images = readImageFilesFromDataTransfer(data);
                if (!images.length) return false;
                const file = images[0];
                const replaceTarget = getPasteMediaReplaceTarget();
                if (replaceTarget) {
                    await applyMediaFileToNode(replaceTarget.id, file);
                    message.success(t("canvas.projectPage.clipboardImageReplaced"));
                    return true;
                }
                await createImageFileNode(file, getCanvasCenter());
                message.success(t("canvas.projectPage.clipboardImageAdded"));
                return true;
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("common.imageReadFailed"));
            }
            return false;
        },
        [applyMediaFileToNode, createImageFileNode, getCanvasCenter, getPasteMediaReplaceTarget, message, t],
    );

    const pasteSystemClipboardImage = useCallback(async () => {
        if (!canUseAsyncClipboard() || !navigator.clipboard) return false;
        const replaceTarget = getPasteMediaReplaceTarget();
        const center = getCanvasCenter();
        try {
            const items = await navigator.clipboard.read();
            const imageItem = items.find((item) => item.types.some((type) => type.startsWith("image/")));
            if (!imageItem) return false;
            const imageType = imageItem.types.find((type) => type.startsWith("image/"));
            if (!imageType) return false;
            const blob = await imageItem.getType(imageType);
            const file = new File([blob], "clipboard-image.png", { type: imageType });
            if (replaceTarget) {
                await applyMediaFileToNode(replaceTarget.id, file);
                message.success(t("canvas.projectPage.clipboardImageReplaced"));
                return true;
            }
            await createImageFileNode(file, center);
            message.success(t("canvas.projectPage.clipboardImageAdded"));
            return true;
        } catch {
            return false;
        }
    }, [applyMediaFileToNode, createImageFileNode, getCanvasCenter, getPasteMediaReplaceTarget, message, t]);

    const applyClipboardDataTransfer = useCallback(
        async (data: DataTransfer | null) => {
            if (await applyClipboardImage(data)) return true;
            const text = data?.getData("text/plain") || "";
            if (createTextNodeFromClipboard(text)) {
                message.success(t("canvas.projectPage.clipboardTextAdded"));
                return true;
            }
            return false;
        },
        [applyClipboardImage, createTextNodeFromClipboard, message, t],
    );

    const pasteSystemClipboard = useCallback(async () => {
        if (await pasteSystemClipboardImage()) return true;
        if (!canUseAsyncClipboard() || !navigator.clipboard) return false;
        try {
            const text = await navigator.clipboard.readText();
            if (createTextNodeFromClipboard(text)) {
                message.success(t("canvas.projectPage.clipboardTextAdded"));
                return true;
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("imageWorkbench.clipboardEmpty"));
        }
        return false;
    }, [createTextNodeFromClipboard, message, pasteSystemClipboardImage, t]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true'],[data-canvas-shortcuts-ignore]")) return;

            const key = event.key.toLowerCase();
            const isModifierShortcut = event.metaKey || event.ctrlKey;

            if (isModifierShortcut && key === "c" && window.getSelection()?.toString()) return;

            if (isModifierShortcut && !event.altKey && key === "z") {
                event.preventDefault();
                if (event.shiftKey) redoCanvas();
                else undoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "y") {
                event.preventDefault();
                redoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "a") {
                event.preventDefault();
                setSelectedNodeIds(new Set(nodesRef.current.map((node) => node.id)));
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "s") {
                event.preventDefault();
                const room = useCanvasRoomStore.getState();
                if (!shouldPersistProjectToLocal(room.role, room.active)) {
                    message.info(t("canvas.roomShare.guestSaveHint"));
                    return;
                }
                updateProject(projectId, {
                    nodes: nodesRef.current,
                    connections: connectionsRef.current,
                    chatSessions,
                    activeChatId,
                    backgroundMode,
                    showImageInfo,
                });
                message.success(t("canvas.projectPage.saved"));
                return;
            }

            if (!isModifierShortcut && !event.altKey && event.shiftKey && key === "g") {
                event.preventDefault();
                groupSelectedNodes();
                return;
            }

            if (!isModifierShortcut && !event.altKey && !event.shiftKey && event.key === "Tab") {
                const selected = [...selectedNodeIdsRef.current];
                if (selected.length === 1) {
                    const node = nodesRef.current.find((item) => item.id === selected[0]);
                    if (isMindNode(node) && !isAnnotationNode(node)) {
                        event.preventDefault();
                        createMindChildOf(selected[0]);
                        return;
                    }
                }
            }

            if (!isModifierShortcut && !event.altKey && !event.shiftKey && event.key === "Enter") {
                const selected = [...selectedNodeIdsRef.current];
                if (selected.length === 1) {
                    const node = nodesRef.current.find((item) => item.id === selected[0]);
                    if (isMindNode(node) && !isAnnotationNode(node)) {
                        event.preventDefault();
                        createMindSiblingOf(selected[0]);
                        return;
                    }
                }
            }

            if (!isModifierShortcut && !event.altKey && !event.shiftKey) {
                const arrowSide =
                    event.key === "ArrowUp" ? "top" as const
                    : event.key === "ArrowDown" ? "bottom" as const
                    : event.key === "ArrowLeft" ? "left" as const
                    : event.key === "ArrowRight" ? "right" as const
                    : null;
                if (arrowSide) {
                    const selected = [...selectedNodeIdsRef.current];
                    if (selected.length === 1) {
                        const node = nodesRef.current.find((item) => item.id === selected[0]);
                        if (isMindNode(node) && !isAnnotationNode(node)) {
                            event.preventDefault();
                            createMindNeighborOf(selected[0], arrowSide);
                            return;
                        }
                    }
                }
            }

            if (event.key === "Delete" || event.key === "Backspace") {
                if (selectedNodeIdsRef.current.size) {
                    deleteNodes(new Set(selectedNodeIdsRef.current));
                } else if (selectedConnectionId) {
                    deleteConnection(selectedConnectionId);
                }
            }

            if (event.key === "Escape") {
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                setEditingConnectionLabelId(null);
                setConnectionLabelDraft("");
                setContextMenu(null);
                setNodeCreatePosition(null);
                setSelectionBox(null);
                setConnecting(null);
                setHoveredNodeId(null);
                setToolbarNodeId(null);
                setDialogNodeId(null);
                setEditingNodeId(null);
                setInfoNodeId(null);
                setCropNodeId(null);
                setBlurNodeId(null);
                setPaintNodeId(null);
                setOutpaintNodeId(null);
                setMaskEditNodeId(null);
                setVideoLocalEditNodeId(null);
                setPendingConnectionCreate(null);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [activeChatId, backgroundMode, chatSessions, createMindChildOf, createMindNeighborOf, createMindSiblingOf, deleteConnection, deleteNodes, groupSelectedNodes, message, projectId, redoCanvas, selectedConnectionId, setConnecting, showImageInfo, t, undoCanvas, updateProject]);

    useEffect(() => {
        const isMindNodeEditTarget = (target: EventTarget | null) => {
            const element = target instanceof Element ? target : null;
            return Boolean(element?.closest("[data-mind-node-edit]"));
        };
        const isShortcutIgnoredTarget = (target: EventTarget | null) => {
            const element = target instanceof Element ? target : null;
            // 勿把 data-canvas-no-zoom 算进来：它只用于禁滚轮缩放，HTML/预览节点也有，会误伤粘贴
            return (
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement ||
                target instanceof HTMLSelectElement ||
                Boolean(element?.closest("[contenteditable='true'],[data-canvas-shortcuts-ignore]"))
            );
        };
        const insertTextIntoTextarea = (el: HTMLTextAreaElement, text: string) => {
            if (!text) return;
            const start = el.selectionStart ?? el.value.length;
            const end = el.selectionEnd ?? start;
            const next = el.value.slice(0, start) + text + el.value.slice(end);
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
            setter?.call(el, next);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.selectionStart = el.selectionEnd = start + text.length;
        };
        const handleCopy = (event: ClipboardEvent) => {
            if (event.defaultPrevented || isShortcutIgnoredTarget(event.target) || window.getSelection()?.toString()) return;
            copySelectedNodes(event);
        };
        const handlePaste = (event: ClipboardEvent) => {
            const mindEdit = isMindNodeEditTarget(event.target);
            if (isShortcutIgnoredTarget(event.target) && !mindEdit) return;

            const data = event.clipboardData;
            // 只有系统剪贴板仍属于这次节点复制，才使用内存中的节点和连线。
            if (!mindEdit && pasteCopiedNodes(data?.getData("text/html") || "")) {
                event.preventDefault();
                return;
            }
            const hasSyncImage = readImageFilesFromDataTransfer(data).length > 0 || dataTransferHasImageHint(data);
            const hasSyncText = Boolean((data?.getData("text/plain") || "").trim());

            if (mindEdit) {
                if (!hasSyncImage && !canUseAsyncClipboard()) return;
                event.preventDefault();
                event.stopPropagation();
                const textarea = event.target instanceof HTMLTextAreaElement ? event.target : null;
                void (async () => {
                    let applied = false;
                    if (hasSyncImage) applied = await applyClipboardImage(data);
                    if (!applied && canUseAsyncClipboard()) applied = await pasteSystemClipboardImage();
                    if (applied) {
                        window.dispatchEvent(new Event("canvas-mind-commit-edit"));
                        textarea?.blur();
                        return;
                    }
                    if (textarea) {
                        const text = data?.getData("text/plain") || (canUseAsyncClipboard() ? await navigator.clipboard.readText().catch(() => "") : "");
                        insertTextIntoTextarea(textarea, text);
                        textarea.focus();
                    }
                })();
                return;
            }

            const hasSyncPayload = hasSyncImage || hasSyncText;
            if (!hasSyncPayload && !canUseAsyncClipboard()) return;
            event.preventDefault();
            void (async () => {
                if (hasSyncPayload && (await applyClipboardDataTransfer(data))) return;
                if (canUseAsyncClipboard()) await pasteSystemClipboard();
            })();
        };
        window.addEventListener("copy", handleCopy);
        window.addEventListener("paste", handlePaste, true);
        return () => {
            window.removeEventListener("copy", handleCopy);
            window.removeEventListener("paste", handlePaste, true);
        };
    }, [applyClipboardDataTransfer, applyClipboardImage, copySelectedNodes, pasteCopiedNodes, pasteSystemClipboard, pasteSystemClipboardImage]);

    const handleConnectStart = useCallback(
        (event: ReactMouseEvent | ReactPointerEvent, nodeId: string, handleType: "source" | "target", side?: "left" | "right" | "top" | "bottom") => {
            event.stopPropagation();
            if ("pointerType" in event && event.pointerType !== "mouse") event.preventDefault();
            const world = screenToCanvas(event.clientX, event.clientY);
            setMouseWorld(world);
            const node = nodesRef.current.find((item) => item.id === nodeId);
            let anchor: { x: number; y: number } | undefined;
            if (node && isXingXiaochiNode(node)) {
                // 始终按点击世界坐标的极角取表面点，忽略左右固定侧（否则会吸到尖角）
                anchor = nearestXingSurfaceAnchor(node, world);
                const live = getLiveXingWorldPoint(node, absoluteXingSurfacePoint(node, anchor));
                if (live) anchor = worldToXingAnchor(node, live);
            }
            setConnecting({ nodeId, handleType, side, ...(anchor ? { anchor } : {}) });
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
            setSelectedConnectionId(null);
        },
        [screenToCanvas, setConnecting],
    );

    const handleToggleMindCollapse = useCallback((nodeId: string, side: MindCollapseSide) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        if (!node || !isMindNode(node) || isAnnotationNode(node)) return;
        if (!mindSideNeighbors(node, side, nodesRef.current, connectionsRef.current).length && !isMindSideCollapsed(node, side)) return;
        const nextSides = toggleMindCollapsedSides(node.metadata?.mindCollapsedSides, side);
        const nextNodes = nodesRef.current.map((item) =>
            item.id === nodeId ? { ...item, metadata: { ...item.metadata, mindCollapsedSides: nextSides } } : item,
        );
        setNodes(nextNodes);
        const hidden = collectMindCollapsedNodeIds(nextNodes, connectionsRef.current);
        if (!hidden.size) return;
        const prevSelected = selectedNodeIdsRef.current;
        const nextSelected = new Set([...prevSelected].filter((id) => !hidden.has(id)));
        if (nextSelected.size !== prevSelected.size) setSelectedNodeIds(nextSelected);
    }, [setSelectedNodeIds]);

    const handleNodeResize = useCallback((nodeId: string, width: number, height: number, position?: Position) => {
        const nextWidth = Math.max(1, Math.round(width));
        const nextHeight = Math.max(1, Math.round(height));
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const nextPosition = position || node.position;
                if (node.width === nextWidth && node.height === nextHeight && node.position.x === nextPosition.x && node.position.y === nextPosition.y) return node;
                return { ...node, width: nextWidth, height: nextHeight, position: nextPosition };
            }),
        );
    }, []);

    const handleNodeResizeStart = useCallback(() => {
        historyPausedRef.current = true;
        setIsNodeResizing(true);
        setExpandedImageNodeIds(new Set());
        setNodeImageSettingsOpen(false);
    }, []);
    const handleNodeResizeEnd = useCallback(() => {
        historyPausedRef.current = false;
        setIsNodeResizing(false);
        setAlignGuides([]);
    }, [setAlignGuides]);
    const getPreferredAlignTargetId = useCallback(() => lastAlignClickNodeIdRef.current, []);

    const toggleNodeFreeResize = useCallback((nodeId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const freeResize = !node.metadata?.freeResize;
                if (freeResize || node.type !== CanvasNodeType.Image) return { ...node, metadata: { ...node.metadata, freeResize } };
                const ratio = (node.metadata?.naturalWidth || node.width) / (node.metadata?.naturalHeight || node.height || 1);
                const height = node.width / ratio;
                return { ...node, height, position: { x: node.position.x, y: node.position.y + node.height / 2 - height / 2 }, metadata: { ...node.metadata, freeResize } };
            }),
        );
    }, []);

    const handleNodeContentChange = useCallback((nodeId: string, content: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, content } } : node)));
    }, []);

    const handleNodeTitleChange = useCallback((nodeId: string, title: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, title } : node)));
    }, []);

    const toggleBatchExpanded = useCallback((nodeId: string) => {
        setExpandedImageNodeIds((current) => {
            const next = new Set(current);
            if (next.has(nodeId)) next.delete(nodeId);
            else next.add(nodeId);
            return next;
        });
    }, []);

    const setBatchPrimary = useCallback((nodeId: string, imageId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const image = node.metadata?.images?.find((item) => item.id === imageId);
                if (!image?.content) return node;
                const edge = Math.max(node.width, node.height);
                const size = node.metadata?.freeResize ? { width: node.width, height: node.height } : fitNodeSize(image.naturalWidth, image.naturalHeight, edge, edge);
                return {
                    ...node,
                    position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 },
                    ...size,
                    metadata: {
                        ...node.metadata,
                        content: image.content,
                        storageKey: image.storageKey,
                        naturalWidth: image.naturalWidth,
                        naturalHeight: image.naturalHeight,
                        bytes: image.bytes,
                        mimeType: image.mimeType,
                        primaryImageId: image.id,
                    },
                };
            }),
        );
    }, []);

    const duplicateBatchImage = useCallback((node: CanvasNodeData, imageId: string) => {
        const image = node.metadata?.images?.find((item) => item.id === imageId);
        if (!image?.content) return;
        const id = nanoid();
        const edge = Math.max(node.width, node.height);
        const size = fitNodeSize(image.naturalWidth, image.naturalHeight, edge, edge);
        const copy: CanvasNodeData = {
            id,
            type: CanvasNodeType.Image,
            title: node.title,
            position: { x: node.position.x + node.width * 2 + 96, y: node.position.y + node.height / 2 - size.height / 2 },
            ...size,
            metadata: {
                content: image.content,
                storageKey: image.storageKey,
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
                bytes: image.bytes,
                mimeType: image.mimeType,
                status: NODE_STATUS_SUCCESS,
                prompt: node.metadata?.prompt,
                generationType: node.metadata?.generationType,
                model: node.metadata?.model,
                size: node.metadata?.size,
                quality: node.metadata?.quality,
                background: node.metadata?.background,
                references: node.metadata?.references,
            },
        };
        setNodes((prev) => [...prev, copy]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, []);

    const openTextEditor = useCallback((node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Text) return;
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setDialogNodeId(node.id);
        setEditingNodeId(node.id);
        setEditRequestNonce((value) => value + 1);
    }, []);

    const handleNodePromptChange = useCallback((nodeId: string, prompt: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt } } : node)));
    }, []);

    const handleVideoClipChange = useCallback((nodeId: string, clip: { clipStartMs: number; clipEndMs: number; includeAudio: boolean }) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...clip } } : node)));
    }, []);

    const handleAudioClipChange = useCallback((nodeId: string, clip: { clipStartMs: number; clipEndMs: number }) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...clip } } : node)));
    }, []);

    const captureVideoFrameToNode = useCallback(
        async (node: CanvasNodeData, blob: Blob) => {
            const { setNodes, setConnections, isActive } = createGenerationScope();
            try {
                const image = await uploadImage(blob);
                const width = Math.min(node.width, Math.max(220, image.width));
                const childId = nanoid();
                const child: CanvasNodeData = {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title: t("canvas.node.frameNode"),
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width,
                    height: width * (image.height / image.width),
                    metadata: {
                        ...imageMetadata(image),
                        prompt: node.metadata?.prompt,
                    },
                };
                setNodes((prev) => [...prev, child]);
                setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
                if (isActive()) setSelectedNodeIds(new Set([childId]));
                message.success(t("canvas.videoPlayer.frameSaved"));
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("canvas.videoPlayer.frameFailed"));
            }
        },
        [createGenerationScope, message, t],
    );

    const handleConfigNodeChange = useCallback((nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const next = applyNodeConfigPatch(node, patch);
                if (next.type !== CanvasNodeType.Config) return next;
                if (patch.model === undefined && patch.generationMode === undefined) return next;
                return fitWorkbenchNodeHeight(next, effectiveConfig);
            }),
        );
    }, [effectiveConfig]);

    const toggleLocalEditView = useCallback((nodeId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId || !node.metadata?.localEditPreprocess) return node;
                const showOriginal = !node.metadata.localEditViewOriginal;
                const content = showOriginal
                    ? node.metadata.localEditOriginalContent || node.metadata.localEditOriginalStorageKey || node.metadata.content
                    : node.metadata.localEditProcessedContent || node.metadata.localEditProcessedStorageKey || node.metadata.content;
                const storageKey = showOriginal
                    ? node.metadata.localEditOriginalStorageKey || node.metadata.storageKey
                    : node.metadata.localEditProcessedStorageKey || node.metadata.storageKey;
                if (!content) return node;
                return {
                    ...node,
                    metadata: {
                        ...node.metadata,
                        localEditViewOriginal: showOriginal,
                        content,
                        ...(storageKey ? { storageKey } : {}),
                    },
                };
            }),
        );
    }, []);

    const downloadNodeImage = useCallback(async (node: CanvasNodeData) => {
        if (node.type === CanvasNodeType.Video) {
            if (!node.metadata?.content) return;
            const hide = message.loading(t("canvas.videoPlayer.preparingClip"), 0);
            try {
                const { blob, fellBack } = await getVideoDownloadBlob({
                    id: node.id,
                    name: `${node.title || node.id}.mp4`,
                    type: node.metadata.mimeType || "video/mp4",
                    url: node.metadata.content,
                    storageKey: node.metadata.storageKey,
                    bytes: node.metadata.bytes,
                    width: node.metadata.naturalWidth,
                    height: node.metadata.naturalHeight,
                    durationMs: node.metadata.durationMs,
                    clipStartMs: node.metadata.clipStartMs,
                    clipEndMs: node.metadata.clipEndMs,
                    includeAudio: node.metadata.includeAudio,
                });
                saveAs(blob, `canvas-video-${node.id}.mp4`);
                if (fellBack) message.warning(t("canvas.videoPlayer.clipFailedDownloadOriginal"));
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("canvas.videoPlayer.clipFailed"));
            } finally {
                hide();
            }
            return;
        }
        if (node.type === CanvasNodeType.Audio) {
            if (!node.metadata?.content) return;
            const hide = message.loading(t("canvas.audioPlayer.preparingClip"), 0);
            try {
                const { blob, fellBack } = await getAudioDownloadBlob({
                    id: node.id,
                    name: `${node.title || node.id}.${audioExtension(node.metadata.mimeType)}`,
                    type: node.metadata.mimeType || "audio/mpeg",
                    url: node.metadata.content,
                    storageKey: node.metadata.storageKey,
                    bytes: node.metadata.bytes,
                    durationMs: node.metadata.durationMs,
                    clipStartMs: node.metadata.clipStartMs,
                    clipEndMs: node.metadata.clipEndMs,
                });
                saveAs(blob, `canvas-audio-${node.id}.${audioExtension(blob.type || node.metadata.mimeType)}`);
                if (fellBack) message.warning(t("canvas.audioPlayer.clipFailedDownloadOriginal"));
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("canvas.audioPlayer.clipFailed"));
            } finally {
                hide();
            }
            return;
        }
        if (node.type !== CanvasNodeType.Image || !node.metadata?.content) return;
        try {
            const raw =
                (node.metadata.storageKey ? await getImageBlob(node.metadata.storageKey) : null) ||
                (await (await fetch(node.metadata.content)).blob());
            const clean = await stripImageMetadata(raw);
            const ext = clean.type.includes("jpeg") ? "jpg" : imageExtension(node.metadata.content) || "png";
            saveAs(clean, `canvas-image-${node.id}.${ext}`);
        } catch {
            saveAs(node.metadata.content, `canvas-image-${node.id}.${imageExtension(node.metadata.content)}`);
        }
    }, [message, t]);

    const downloadBatchImage = useCallback(async (node: CanvasNodeData, imageId: string) => {
        const image = node.metadata?.images?.find((item) => item.id === imageId);
        if (!image?.content) return;
        try {
            const raw =
                (image.storageKey ? await getImageBlob(image.storageKey) : null) ||
                (await (await fetch(image.content)).blob());
            const clean = await stripImageMetadata(raw);
            const ext = clean.type.includes("jpeg") ? "jpg" : imageExtension(image.content) || "png";
            saveAs(clean, `canvas-image-${node.id}-${image.id}.${ext}`);
        } catch {
            saveAs(image.content, `canvas-image-${node.id}-${image.id}.${imageExtension(image.content)}`);
        }
    }, []);

    const assignAssetGroup = useLibraryGroupAssignment("assets");
    const saveNodeAsset = useCallback(
        async (node: CanvasNodeData) => {
            const groupId = useLibraryGroupStore.getState().selected.assets;
            if (node.type === FOLDER_NODE_TYPE) {
                const hide = message.loading(t("canvas.sidePanel.addingAssets"), 0);
                try {
                    const id = await addFolderAssetFromNode(node);
                    await assignAssetGroup([id], groupId);
                    message.success(t("common.addedToAssets"));
                } catch (error) {
                    console.error(error);
                    message.error(t("canvas.sidePanel.addFailed"));
                } finally {
                    hide();
                }
                return;
            }
            if (node.type === CanvasNodeType.Text) {
                const content = node.metadata?.content?.trim();
                if (!content) return message.error(t("canvas.projectPage.noTextToSave"));
                const id = addAsset({ kind: "text", title: node.metadata?.prompt?.slice(0, 24) || t("canvas.projectPage.canvasText"), coverUrl: "", tags: [], source: "Canvas", data: { content }, metadata: { source: "canvas", nodeId: node.id } });
                await assignAssetGroup([id], groupId);
                message.success(t("common.addedToAssets"));
                return;
            }
            if (node.type === CanvasNodeType.Video) {
                if (!node.metadata?.content) return message.error(t("canvas.projectPage.noVideoToSave"));
                const id = addAsset({
                    kind: "video",
                    title: node.metadata?.prompt?.slice(0, 24) || t("canvas.projectPage.canvasVideo"),
                    coverUrl: "",
                    tags: [],
                    source: "Canvas",
                    data: { url: node.metadata.content, storageKey: node.metadata.storageKey, width: node.width, height: node.height, bytes: node.metadata.bytes || 0, mimeType: node.metadata.mimeType || "video/mp4" },
                    metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
                });
                await assignAssetGroup([id], groupId);
                message.success(t("common.addedToAssets"));
                return;
            }
            if (!node.metadata?.content) return message.error(t("canvas.projectPage.noImageToSave"));
            const dataUrl = node.metadata.storageKey ? "" : node.metadata.content;
            const id = addAsset({
                kind: "image",
                title: node.metadata?.prompt?.slice(0, 24) || t("canvas.projectPage.canvasImage"),
                coverUrl: node.metadata.content,
                tags: [],
                source: "Canvas",
                data: {
                    dataUrl,
                    storageKey: node.metadata.storageKey,
                    width: node.metadata.naturalWidth || node.width,
                    height: node.metadata.naturalHeight || node.height,
                    bytes: node.metadata.bytes || getDataUrlByteSize(dataUrl),
                    mimeType: node.metadata.mimeType || "image/png",
                },
                metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
            });
            await assignAssetGroup([id], groupId);
            message.success(t("common.addedToAssets"));
        },
        [addAsset, assignAssetGroup, message, t],
    );
    saveNodeAssetRef.current = saveNodeAsset;

    const savePromptAsset = useCallback((targets: CanvasNodeData[]) => {
        const draft = previewPromptAssetFromNodes(targets, connectionsRef.current, effectiveConfig);
        if (!draft) {
            message.warning(t("canvas.sidePanel.promptAssetEmpty"));
            return;
        }
        setPromptAssetDraft({
            title: t("canvas.sidePanel.promptAssetDefaultTitle"),
            prompt: draft.prompt,
            media: draft.media,
            generation: draft.generation,
        });
    }, [effectiveConfig, message, t]);
    savePromptAssetRef.current = savePromptAsset;

    const assignPromptGroup = useLibraryGroupAssignment("prompts");
    const confirmPromptAsset = useCallback(
        async (values: PromptAssetDraft & { title: string }) => {
            setPromptAssetSaving(true);
            try {
                const created = await createLocalPrompt({
                    title: values.title,
                    prompt: values.prompt,
                    bundle: await persistPromptAssetMedia(values.media),
                    generation: values.generation,
                });
                await assignPromptGroup([promptGroupKey({ sourceId: LOCAL_PROMPT_SOURCE_ID, id: created.id })], values.groupId);
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ["side-panel-prompts", LOCAL_PROMPT_SOURCE_ID] }),
                    queryClient.invalidateQueries({ queryKey: ["prompts"] }),
                ]);
                setPromptAssetDraft(null);
                message.success(t("canvas.sidePanel.promptAssetSaved"));
            } catch (error) {
                console.error(error);
                message.error(t("canvas.sidePanel.promptAssetFailed"));
            } finally {
                setPromptAssetSaving(false);
            }
        },
        [assignPromptGroup, message, queryClient, t],
    );

    const createImageReversePromptNodes = useCallback(
        (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
                message.warning(t("canvas.projectPage.emptyReverse"));
                return;
            }

            const gap = 96;
            const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
            const configSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Config];
            const centerY = node.position.y + node.height / 2;
            const textNode = {
                ...createCanvasNode(CanvasNodeType.Text, { x: node.position.x + node.width + gap + textSpec.width / 2, y: centerY }, { content: t("canvas.projectPage.reversePreset"), prompt: t("canvas.projectPage.reversePreset"), status: NODE_STATUS_SUCCESS, fontSize: 14 }),
                title: t("canvas.projectPage.reverseTitle"),
            };
            const configNode = {
                ...createCanvasNode(
                    CanvasNodeType.Config,
                    { x: textNode.position.x + textNode.width + gap + configSpec.width / 2, y: centerY },
                    {
                        generationMode: "text",
                        model: effectiveConfig.textModel || effectiveConfig.model || defaultConfig.textModel,
                        count: 1,
                        composerContent: t("canvas.reverseComposer", { imageId: node.id, textId: textNode.id }),
                    },
                ),
                title: t("canvas.projectPage.reverseConfigTitle"),
            };

            setNodes((prev) => [...prev, textNode, configNode]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: configNode.id }, { id: nanoid(), fromNodeId: textNode.id, toNodeId: configNode.id }]);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
            setContextMenu(null);
        },
        [effectiveConfig.model, effectiveConfig.textModel, message, t],
    );

    const cropImageNode = useCallback(async (node: CanvasNodeData, crop: CanvasImageCropRect) => {
        const { setNodes, setConnections, isActive } = createGenerationScope();
        if (!node.metadata?.content) return;
        const cropped = await cropDataUrl(node.metadata.content, crop);
        const image = await uploadImage(cropped);
        const width = Math.min(node.width, Math.max(220, image.width));
        const childId = nanoid();
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title: "Cropped Image",
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width,
            height: width * (image.height / image.width),
            metadata: {
                ...imageMetadata(image),
                prompt: node.metadata?.prompt,
            },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        if (isActive()) setSelectedNodeIds(new Set([childId]));
        if (isActive()) setDialogNodeId(childId);
        if (isActive()) setCropNodeId(null);
    }, [createGenerationScope]);

    const blurImageNode = useCallback(async (node: CanvasNodeData, options: ImageBlurOptions) => {
        const { setNodes, setConnections, isActive } = createGenerationScope();
        if (!node.metadata?.content) return;
        try {
            const blurred = await blurImageDataUrl(node.metadata.content, options);
            const image = await uploadImage(blurred);
            const width = Math.min(node.width, Math.max(220, image.width));
            const childId = nanoid();
            const child: CanvasNodeData = {
                id: childId,
                type: CanvasNodeType.Image,
                title: t("canvas.projectPage.blurredImage"),
                position: { x: node.position.x + node.width + 96, y: node.position.y },
                width,
                height: width * (image.height / image.width),
                metadata: {
                    ...imageMetadata(image),
                    prompt: node.metadata?.prompt,
                },
            };
            setNodes((prev) => [...prev, child]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            if (isActive()) setSelectedNodeIds(new Set([childId]));
            if (isActive()) setDialogNodeId(childId);
            if (isActive()) setBlurNodeId(null);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.projectPage.blurFailed"));
        }
    }, [createGenerationScope, message, t]);

    const paintImageNode = useCallback(async (node: CanvasNodeData, paintedDataUrl: string) => {
        const { setNodes, setConnections, isActive } = createGenerationScope();
        if (!paintedDataUrl) return;
        try {
            const image = await uploadImage(paintedDataUrl);
            const width = Math.min(node.width, Math.max(220, image.width));
            const childId = nanoid();
            const child: CanvasNodeData = {
                id: childId,
                type: CanvasNodeType.Image,
                title: t("canvas.projectPage.paintedImage"),
                position: { x: node.position.x + node.width + 96, y: node.position.y },
                width,
                height: width * (image.height / image.width),
                metadata: {
                    ...imageMetadata(image),
                    prompt: node.metadata?.prompt,
                },
            };
            setNodes((prev) => [...prev, child]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            if (isActive()) setSelectedNodeIds(new Set([childId]));
            if (isActive()) setDialogNodeId(childId);
            if (isActive()) setPaintNodeId(null);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.projectPage.paintFailed"));
        }
    }, [createGenerationScope, message, t]);

    const outpaintImageNode = useCallback(
        async (node: CanvasNodeData, box: OutpaintBox) => {
            const { setNodes, setConnections, isActive } = createGenerationScope();
            if (!node.metadata?.content) return;
            let work: Awaited<ReturnType<typeof composeOutpaintWorkImage>>;
            try {
                work = await composeOutpaintWorkImage(node.metadata.content, box, outpaintImageRect());
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("canvas.projectPage.outpaintPreprocessFailed"));
                return;
            }
            if (isActive()) setOutpaintNodeId(null);
            try {
                const [previewUploaded, workUploaded] = await Promise.all([uploadImage(work.compareDataUrl), uploadImage(work.dataUrl)]);
                const size = fitNodeSize(previewUploaded.width, previewUploaded.height);
                const childId = nanoid();
                setNodes((prev) => [
                    ...prev,
                    {
                        id: childId,
                        type: CanvasNodeType.Image,
                        title: t("canvas.projectPage.outpaintPreprocess"),
                        position: { x: node.position.x + node.width + 96, y: node.position.y },
                        ...size,
                        metadata: {
                            ...imageMetadata(previewUploaded),
                            prompt: work.prompt,
                            outpaintPreprocess: true,
                            outpaintWorkContent: workUploaded.url,
                            outpaintWorkStorageKey: workUploaded.storageKey,
                            outpaintPreviewContent: previewUploaded.url,
                            outpaintPreviewStorageKey: previewUploaded.storageKey,
                            model: OUTPAINT_MODEL,
                            size: OUTPAINT_SIZE,
                            quality: OUTPAINT_RESOLUTION,
                            count: 1,
                        },
                    },
                ]);
                setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
                if (isActive()) setSelectedNodeIds(new Set([childId]));
                message.success(t("canvas.projectPage.outpaintPreprocessSaved"));
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("canvas.projectPage.outpaintPreprocessFailed"));
            }
        },
        [createGenerationScope, message, t],
    );

    const applyPhotopeaImage = useCallback(
        async (blob: Blob, mode: PhotopeaApplyMode) => {
            const { setNodes, setConnections, isActive } = createGenerationScope();
            const node = photopeaNodeId ? nodesRef.current.find((item) => item.id === photopeaNodeId) : null;
            if (!node) throw new Error(t("canvas.editors.photopeaFailed"));
            const image = await uploadImage(blob);
            const size = node.metadata?.freeResize ? { width: node.width, height: node.height } : fitNodeSize(image.width, image.height);
            if (mode === "replace") {
                setNodes((prev) =>
                    prev.map((item) => {
                        if (item.id !== node.id) return item;
                        const primaryId = item.metadata?.primaryImageId || item.metadata?.images?.[0]?.id;
                        const nextImage = { id: primaryId || nanoid(), ...imageMetadata(image) };
                        return {
                            ...item,
                            width: size.width,
                            height: size.height,
                            metadata: {
                                ...item.metadata,
                                ...imageMetadata(image),
                                prompt: item.metadata?.prompt,
                                composerContent: item.metadata?.composerContent,
                                model: item.metadata?.model,
                                size: item.metadata?.size,
                                quality: item.metadata?.quality,
                                count: item.metadata?.count,
                                errorDetails: undefined,
                                images: item.metadata?.images?.map((slot) => (slot.id === primaryId ? { ...slot, ...nextImage, id: slot.id } : slot)),
                            },
                        };
                    }),
                );
                message.success(t("canvas.projectPage.photopeaSaved"));
                if (isActive()) setPhotopeaNodeId(null);
                return;
            }
            const childId = nanoid();
            const child: CanvasNodeData = {
                id: childId,
                type: CanvasNodeType.Image,
                title: t("canvas.projectPage.photopeaNewNode"),
                position: { x: node.position.x + node.width + 96, y: node.position.y },
                width: size.width,
                height: size.height,
                metadata: { ...imageMetadata(image), prompt: node.metadata?.prompt },
            };
            setNodes((prev) => [...prev, child]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            if (isActive()) setSelectedNodeIds(new Set([childId]));
            if (isActive()) setPhotopeaNodeId(null);
            message.success(t("canvas.projectPage.photopeaSaved"));
        },
        [createGenerationScope, message, photopeaNodeId, t],
    );

    const addPinterestImage = useCallback(
        async (blob: Blob, pin: { title: string }) => {
            const { setNodes } = createGenerationScope();
            const node = pinSearchNodeId ? nodesRef.current.find((item) => item.id === pinSearchNodeId) : null;
            if (!node) throw new Error("node missing");
            const image = await uploadImage(blob);
            const size = fitNodeSize(image.width, image.height);
            const index = pinSearchAddCountRef.current;
            pinSearchAddCountRef.current += 1;
            const childId = nanoid();
            const child: CanvasNodeData = {
                id: childId,
                type: CanvasNodeType.Image,
                title: pin.title || t("canvas.projectPage.pinterestNewNode"),
                position: { x: node.position.x + node.width + 96 + index * 48, y: node.position.y + index * 48 },
                width: size.width,
                height: size.height,
                metadata: imageMetadata(image),
            };
            setNodes((prev) => [...prev, child]);
            message.success(t("canvas.projectPage.pinterestAdded"));
        },
        [createGenerationScope, message, pinSearchNodeId, t],
    );

    const splitImageNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageSplitParams) => {
            const { setNodes, setConnections, isActive } = createGenerationScope();
            if (!node.metadata?.content) return;
            setSplitNodeId(null);
            const pieces = await splitDataUrl(node.metadata.content, params);
            const gap = 16;
            const cellWidth = node.width / params.columns;
            const cellHeight = node.height / params.rows;
            const startX = node.position.x + node.width + 96;
            const startY = node.position.y;
            const childNodes = await Promise.all(
                pieces.map(async (piece) => {
                    const image = await uploadImage(piece.dataUrl);
                    const id = nanoid();
                    return {
                        id,
                        type: CanvasNodeType.Image,
                        title: t("canvas.projectPage.splitTitle", { name: node.title || t("assets.kinds.image"), row: piece.row + 1, column: piece.column + 1 }),
                        position: { x: startX + piece.column * (cellWidth + gap), y: startY + piece.row * (cellHeight + gap) },
                        width: cellWidth,
                        height: cellHeight,
                        metadata: {
                            ...imageMetadata(image),
                            prompt: node.metadata?.prompt,
                        },
                    } satisfies CanvasNodeData;
                }),
            );
            setNodes((prev) => [...prev, ...childNodes]);
            setConnections((prev) => [...prev, ...childNodes.map((child) => ({ id: nanoid(), fromNodeId: node.id, toNodeId: child.id }))]);
            if (isActive()) setSelectedNodeIds(new Set(childNodes.map((child) => child.id)));
            if (isActive()) setSelectedConnectionId(null);
            if (isActive()) setDialogNodeId(null);
            message.success(t("canvas.projectPage.splitSuccess", { count: childNodes.length }));
        },
        [createGenerationScope, message, t],
    );

    const saveVideoLocalEdit = useCallback(async (node: CanvasNodeData, selection: VideoLocalEditSelection, signal: AbortSignal, onProgress: (text: string) => void) => {
        const scope = createGenerationScope();
        if (listCanvasGenerationRequests().some(request => request.projectId === projectId && request.targetNodeId === node.id)) throw new Error("视频正在生成，请先停止或等待完成后再修改选区");
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal.addEventListener("abort", abort, { once: true });
        scope.startGenerationRequest(node.id, node.id, node.id, controller);
        try {
            signal.throwIfAborted();
            const plan = await prepareVideoLocalEdit(node, selection, controller.signal, onProgress);
            controller.signal.throwIfAborted();
            const latestNodes = scope.isActive() ? nodesRef.current : useCanvasStore.getState().projects.find(project => project.id === projectId)?.nodes || [];
            const latest = latestNodes.find(item => item.id === node.id);
            if (!latest || latest.metadata?.storageKey !== node.metadata?.storageKey || latest.metadata?.content !== node.metadata?.content || latest.metadata?.videoLocalEdit?.id !== node.metadata?.videoLocalEdit?.id) throw new Error("原视频已改变，未保存这次预处理，请重新打开局部编辑");
            const existing = latestNodes.find(item => item.metadata?.videoLocalEditTargetId === node.id);
            const workbench = existing || createCanvasNode(CanvasNodeType.Config, { x: node.position.x + node.width + 260, y: node.position.y + node.height / 2 });
            const configured = fitWorkbenchNodeHeight({ ...workbench, title: "局部视频编辑", metadata: { ...workbench.metadata, generationMode: "video", model: LOCAL_VIDEO_EDIT_MODEL, seconds: String(plan.range.generationSeconds), generateAudio: "false", videoLocalEditTargetId: node.id, status: "idle", errorDetails: undefined } }, effectiveConfig);
            // 关闭与落盘同批提交；弹窗 source 改变会取消自身旧异步回调。
            signal.removeEventListener("abort", abort);
            if (scope.isActive()) setVideoLocalEditNodeId(null);
            scope.setNodes(previous => {
                if (controller.signal.aborted) return previous;
                const current = previous.find(item => item.id === node.id);
                if (!current || current.metadata?.storageKey !== node.metadata?.storageKey || current.metadata?.content !== node.metadata?.content || current.metadata?.videoLocalEdit?.id !== node.metadata?.videoLocalEdit?.id) return previous;
                const updated = previous.map(item => item.id === node.id ? { ...item, metadata: { ...item.metadata, storageKey: item.metadata?.storageKey || plan.originalStorageKey, videoLocalEdit: plan } } : item.id === configured.id ? configured : item);
                return existing ? updated : [...updated, configured];
            });
            scope.setConnections(previous => previous.some(edge => edge.fromNodeId === node.id && edge.toNodeId === configured.id) ? previous : [...previous, { id: nanoid(), fromNodeId: node.id, toNodeId: configured.id }]);
            if (scope.isActive()) {
                setSelectedNodeIds(new Set([configured.id]));
                setSelectedConnectionId(null);
                setDialogNodeId(configured.id);
            }
        } finally {
            signal.removeEventListener("abort", abort);
            scope.finishGenerationRequest(node.id, controller);
        }
    }, [createGenerationScope, projectId, effectiveConfig]);

    const restoreVideoLocalEdit = useCallback(async (node: CanvasNodeData) => {
        const scope = createGenerationScope();
        const plan = node.metadata?.videoLocalEdit;
        if (!plan) return;
        for (const request of listCanvasGenerationRequests()) if (request.projectId === projectId && request.targetNodeId === node.id) request.controller.abort();
        const controller = scope.startGenerationRequest(node.id, node.id);
        try {
            const originalBlob = await getMediaBlob(plan.originalStorageKey);
            const url = originalBlob?.size ? await resolveMediaUrl(plan.originalStorageKey, plan.originalUrl || "") : "";
            controller.signal.throwIfAborted();
            if (!url) throw new Error("原视频文件不可读取，未修改当前视频");
            scope.setNodes(previous => controller.signal.aborted ? previous : applyVideoLocalEditRestore(previous, node, { url, storageKey: plan.originalStorageKey, mimeType: originalBlob!.type || "video/mp4", bytes: originalBlob!.size }));
        } catch (error) {
            if (!controller.signal.aborted) message.error(error instanceof Error ? error.message : "恢复原片失败");
        } finally { scope.finishGenerationRequest(node.id, controller); }
    }, [createGenerationScope, projectId, message]);

    const maskEditImageNode = useCallback(
        async (node: CanvasNodeData, payload: CanvasImageMaskEditPayload) => {
            const { setNodes } = createGenerationScope();
            if (!node.metadata?.content) return;
            setMaskEditNodeId(null);
            try {
                const originalSrc = node.metadata.localEditPreprocess
                    ? node.metadata.localEditOriginalContent || node.metadata.content
                    : node.metadata.content;
                const [uploadedOriginal, uploadedProcessed] = await Promise.all([uploadImage(originalSrc), uploadImage(payload.paintedDataUrl)]);
                const forceRatio = payload.forceRatio || "1:1";
                const crop = await smartCropFromBox(payload.paintedDataUrl, payload.selection, { expandFactor: 0, forceRatio });
                const uploadedCrop = await uploadImage(crop.croppedImageDataUrl);
                // 所选比例同步到 size（底部设置显示/请求用）与 modelParams.aspectRatio；auto / 原图 → auto
                const aspectRatio = forceRatio === "Auto" ? "auto" : forceRatio;
                const nextParams = { ...(node.metadata.modelParams || {}), aspectRatio };
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? {
                                  ...item,
                                  metadata: {
                                      ...item.metadata,
                                      ...imageMetadata(uploadedProcessed),
                                      localEditPreprocess: true,
                                      localEditViewOriginal: false,
                                      localEditSelection: payload.selectionNorm,
                                      localEditOriginalContent: uploadedOriginal.url,
                                      localEditOriginalStorageKey: uploadedOriginal.storageKey,
                                      localEditProcessedContent: uploadedProcessed.url,
                                      localEditProcessedStorageKey: uploadedProcessed.storageKey,
                                      localEditCropBox: crop.cropBox,
                                      localEditCroppedContent: uploadedCrop.url,
                                      localEditCroppedStorageKey: uploadedCrop.storageKey,
                                      localEditChosenRatio: aspectRatio,
                                      model: LOCAL_EDIT_BANANA_MODEL,
                                      count: 1,
                                      size: aspectRatio,
                                      quality: LOCAL_EDIT_DEFAULT_RESOLUTION,
                                      modelParams: nextParams,
                                  },
                              }
                            : item,
                    ),
                );
                message.success(t("canvas.projectPage.maskPreprocessSaved"));
            } catch (error) {
                message.error(error instanceof Error ? error.message : t("canvas.projectPage.maskPreprocessFailed"));
            }
        },
        [createGenerationScope, message, t],
    );

    const restoreLocalEditImageNode = useCallback(
        (node: CanvasNodeData) => {
            const originalContent = node.metadata?.localEditOriginalContent || "";
            const originalKey = node.metadata?.localEditOriginalStorageKey;
            if (!originalContent && !originalKey) {
                message.error(t("canvas.projectPage.maskPreprocessRestoreFailed"));
                return;
            }
            setMaskEditNodeId(null);
            setNodes((prev) =>
                prev.map((item) => {
                    if (item.id !== node.id) return item;
                    return {
                        ...item,
                        metadata: {
                            ...item.metadata,
                            content: originalContent || item.metadata.content,
                            storageKey: originalKey || item.metadata.storageKey,
                            localEditPreprocess: undefined,
                            localEditViewOriginal: undefined,
                            localEditSelection: undefined,
                            localEditOriginalContent: undefined,
                            localEditOriginalStorageKey: undefined,
                            localEditProcessedContent: undefined,
                            localEditProcessedStorageKey: undefined,
                            localEditCropBox: undefined,
                            localEditCroppedContent: undefined,
                            localEditCroppedStorageKey: undefined,
                            localEditChosenRatio: undefined,
                        },
                    };
                }),
            );
            message.success(t("canvas.projectPage.maskPreprocessRestored"));
        },
        [message, t],
    );

    const upscaleImageNode = useCallback(
        async (node: CanvasNodeData, params: RhUpscaleDialogParams) => {
            const content = node.metadata?.content || "";
            const storageKey = node.metadata?.storageKey || "";
            if (!content && !storageKey) return;
            setUpscaleNodeId(null);

            const { setNodes, setConnections, startGenerationRequest, finishGenerationRequest } = createCanvasGenerationScope(
                projectId,
                nodesRef.current,
                connectionsRef.current,
            );
            const childId = nanoid();
            // 占位尺寸跟原图节点一致并按倍率放大，避免默认 340×240 导致高度/比例与原图不一致
            const placeholderWidth = Math.max(1, Math.round(node.width * params.ratio));
            const placeholderHeight = Math.max(1, Math.round(node.height * params.ratio));
            setNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title: t("canvas.rhComposite.resultTitle"),
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: placeholderWidth,
                    height: placeholderHeight,
                    metadata: {
                        content: "",
                        prompt: "",
                        status: NODE_STATUS_LOADING,
                        references: [content || storageKey].filter(Boolean),
                    },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));

            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const sourceUrl = await resolveImageUrl(storageKey, content);
                const sourceDataUrl = await imageToDataUrl({
                    url: sourceUrl || content,
                    storageKey,
                    dataUrl: content.startsWith("data:") ? content : undefined,
                });
                if (!sourceDataUrl) throw new Error(t("canvas.rhComposite.needImage"));

                const result = await runRhCompositePipeline({
                    sourceDataUrl,
                    scale: { ratio: params.ratio, maxSide: params.maxSide, alignMultiple: 1, resample: "lanczos" },
                    signal: controller.signal,
                    needApiKeyMessage: t("canvas.rhComposite.needApiKey"),
                    noOutputMessage: t("canvas.rhComposite.noOutput"),
                });
                const uploaded = await uploadImage(result.dataUrl);
                // 按源节点显示尺寸 × 像素放大倍率排布，避免误用默认 340×240 把结果压得很小
                const srcNaturalW = Math.max(1, node.metadata?.naturalWidth || 0);
                const srcNaturalH = Math.max(1, node.metadata?.naturalHeight || 0);
                const grow =
                    srcNaturalW > 1 && srcNaturalH > 1
                        ? Math.min(uploaded.width / srcNaturalW, uploaded.height / srcNaturalH)
                        : params.ratio;
                const size =
                    grow > 0
                        ? { width: Math.max(1, Math.round(node.width * grow)), height: Math.max(1, Math.round(node.height * grow)) }
                        : fitNodeSize(uploaded.width, uploaded.height);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === childId
                            ? {
                                  ...item,
                                  ...size,
                                  title: t("canvas.rhComposite.resultTitle"),
                                  metadata: {
                                      ...item.metadata,
                                      ...imageMetadata(uploaded),
                                      prompt: result.prompt,
                                      status: "success",
                                      errorDetails: "",
                                      references: [content || storageKey].filter(Boolean),
                                  },
                              }
                            : item,
                    ),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
                message.error(errorDetails);
            } finally {
                finishGenerationRequest(childId, controller);
            }
        },
        [message, projectId, t],
    );

    const cutoutImageNode = useCallback(
        async (node: CanvasNodeData) => {
            const content = node.metadata?.content || "";
            const storageKey = node.metadata?.storageKey || "";
            if (!content && !storageKey) return;

            const { setNodes, setConnections, startGenerationRequest, finishGenerationRequest } = createCanvasGenerationScope(
                projectId,
                nodesRef.current,
                connectionsRef.current,
            );
            const childId = nanoid();
            setNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title: t("canvas.projectPage.cutoutResult"),
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: node.width,
                    height: node.height,
                    metadata: {
                        content: "",
                        prompt: "",
                        status: NODE_STATUS_LOADING,
                        references: [content || storageKey].filter(Boolean),
                    },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));

            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const sourceUrl = await resolveImageUrl(storageKey, content);
                const sourceDataUrl = await imageToDataUrl({
                    url: sourceUrl || content,
                    storageKey,
                    dataUrl: content.startsWith("data:") ? content : undefined,
                });
                if (!sourceDataUrl) throw new Error(t("canvas.rhComposite.needImage"));

                const result = await runRhCutoutPipeline({
                    sourceDataUrl,
                    signal: controller.signal,
                    needApiKeyMessage: t("canvas.rhComposite.needApiKey"),
                    noOutputMessage: t("canvas.rhComposite.noOutput"),
                });
                const uploaded = await uploadImage(result.dataUrl);
                const size = fitNodeSize(uploaded.width, uploaded.height, node.width, node.height);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === childId
                            ? {
                                  ...item,
                                  ...size,
                                  title: t("canvas.projectPage.cutoutResult"),
                                  metadata: {
                                      ...item.metadata,
                                      ...imageMetadata(uploaded),
                                      status: "success",
                                      errorDetails: "",
                                      references: [content || storageKey].filter(Boolean),
                                  },
                              }
                            : item,
                    ),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.cutoutFailed");
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
                message.error(errorDetails);
            } finally {
                finishGenerationRequest(childId, controller);
            }
        },
        [message, projectId, t],
    );

    const generateAngleNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageAngleParams) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1" };
            const blockedGeneration = closedGenerationError(generationConfig.model);
            if (blockedGeneration) {
                message.warning(blockedGeneration.message);
                return;
            }
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                message.warning(t("canvas.projectPage.configRequired"));
                openConfigDialog(true);
                return;
            }
            const { setNodes, setConnections, setRunningNodeId, startGenerationRequest, finishGenerationRequest } = createCanvasGenerationScope(
                projectId,
                nodesRef.current,
                connectionsRef.current,
            );
            const childId = nanoid();
            const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const title = buildAngleLabel(params);
            const prompt = buildAnglePrompt(params);
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [
                { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey },
            ]);
            setAngleNodeId(null);
            setRunningNodeId(childId);
            setNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title,
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: imageConfig.width,
                    height: imageConfig.height,
                    metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setDialogNodeId(childId);
            const controller = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(
                    generationConfig,
                    prompt,
                    [{ id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey }],
                    undefined,
                    { signal: controller.signal },
                ).then((items) => items[0]);
                const uploaded = await uploadImage(image.dataUrl);
                const size = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(childId, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, isAiConfigReady, openConfigDialog, projectId, t],
    );

    const handleFontSizeChange = useCallback((nodeId: string, fontSize: number) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, fontSize } } : node)));
    }, []);

    const handleUploadRequest = useCallback((nodeId?: string, position?: Position) => {
        uploadTargetRef.current = { nodeId, position };
        imageInputRef.current?.click();
    }, []);

    const handleImageInputChange = useCallback(
        async (event: ReactChangeEvent<HTMLInputElement>) => {
            const files = Array.from(event.target.files || []).filter(
                (f) => f.type.startsWith("image/") || f.type.startsWith("video/") || isAudioFile(f),
            );
            if (!files.length) {
                uploadTargetRef.current = null;
                event.target.value = "";
                return;
            }

            const target = uploadTargetRef.current;
            const basePosition =
                target?.position ||
                screenToCanvas(
                    (containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2,
                    (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2,
                );
            const STAGGER = 40; // Offset between multiple imported files.

            // When replacing a target node, use the first file as the replacement and create the rest nearby.
            if (target?.nodeId) {
                const [first, ...rest] = files;
                await applyMediaFileToNode(target.nodeId, first);
                for (let i = 0; i < rest.length; i++) {
                    const offsetPos = { x: basePosition.x + (i + 1) * STAGGER, y: basePosition.y + (i + 1) * STAGGER };
                    const f = rest[i];
                    if (isModel3dFileName(f.name)) {
                        void createModelFileNode(f, offsetPos);
                    } else if (isAudioFile(f)) {
                        void createAudioFileNode(f, offsetPos);
                    } else if (f.type.startsWith("video/")) {
                        void createVideoFileNode(f, offsetPos);
                    } else {
                        void createImageFileNode(f, offsetPos);
                    }
                }
            } else {
                // Without a replacement target, create all files near the canvas center.
                for (let i = 0; i < files.length; i++) {
                    const offsetPos = { x: basePosition.x + i * STAGGER, y: basePosition.y + i * STAGGER };
                    const f = files[i];
                    if (isModel3dFileName(f.name)) {
                        void createModelFileNode(f, offsetPos);
                    } else if (isAudioFile(f)) {
                        void createAudioFileNode(f, offsetPos);
                    } else if (f.type.startsWith("video/")) {
                        void createVideoFileNode(f, offsetPos);
                    } else {
                        void createImageFileNode(f, offsetPos);
                    }
                }
            }

            uploadTargetRef.current = null;
            event.target.value = "";
        },
        [applyMediaFileToNode, createAudioFileNode, createImageFileNode, createModelFileNode, createVideoFileNode, screenToCanvas, size.height, size.width],
    );

    const handleDrop = useCallback(
        (event: ReactDragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const skillPayload = readCodexSkillFromDataTransfer(event.dataTransfer);
            if (skillPayload) {
                const pos = screenToCanvas(event.clientX, event.clientY);
                applyAgentOps([buildAddCodexSkillNodeOp({ skill: skillPayload, position: pos })]);
                return;
            }

            const toolbarCreateType = readToolbarCreateNodeFromDataTransfer(event.dataTransfer);
            if (toolbarCreateType) {
                createNode(toolbarCreateType, screenToCanvas(event.clientX, event.clientY));
                return;
            }

            const sidePanelDrag = readSidePanelInsertFromDataTransfer(event.dataTransfer);
            if (sidePanelDrag) {
                const dropAt = screenToCanvas(event.clientX, event.clientY);
                const insertAsset = handleAssetInsertRef.current;
                void resolveSidePanelInsertPayloadAsync(sidePanelDrag).then((payload) => {
                    if (payload) insertAsset(payload, dropAt);
                    else if (sidePanelDrag.source === "folderFile") message.warning(t("canvas.sidePanel.folderFileMissing"));
                });
                return;
            }

            const clientX = event.clientX;
            const clientY = event.clientY;
            // 同步快照：await 之后 DataTransfer 会被浏览器清空
            const droppedText = (event.dataTransfer.getData("text/plain") || event.dataTransfer.getData("text") || "").trim();
            const dropSnapshot = captureDropSnapshot(event.dataTransfer);
            const hasFileItems = dropSnapshot.entries.length > 0 || dropSnapshot.files.length > 0;
            if (!hasFileItems) {
                if (droppedText) applyDroppedText(droppedText, clientX, clientY);
                return;
            }
            const dropTargetNode = findNodeAtClientPoint(clientX, clientY);
            // 文件解析期间可能切换项目或移动视口，插入位置绑定松手时的原画布。
            const dropPosition = screenToCanvas(clientX, clientY);

            void (async () => {
                const folders = await collectDroppedFolders(dropSnapshot);
                if (folders.length) {
                    const base = dropPosition;
                    const { canvasDataDir, folderCopyMaxMb } = useConfigStore.getState().config;
                    const maxBytes = folderCopyLimitBytes(folderCopyMaxMb);
                    const ops = [];
                    let referenced = 0;
                    let copied = 0;
                    for (let i = 0; i < folders.length; i += 1) {
                        const folder = folders[i];
                        const id = `folder-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;
                        const persist = await persistDroppedFolder({
                            nodeId: id,
                            folder,
                            canvasDataDir: canvasDataDir || "",
                            maxBytes,
                        });
                        // 预览源先写完再挂节点，避免智能预览自动打开时缓存未就绪
                        if (folder.previewCandidates?.length) {
                            await stashFolderPreviewSources(id, folder.previewCandidates);
                        }
                        if (persist.mode === "reference") referenced += 1;
                        else if (persist.copied) copied += 1;
                        ops.push(
                            buildAddFolderNodeOp({
                                id,
                                folderName: folder.folderName,
                                entries: folder.entries,
                                truncated: folder.truncated,
                                topLevelDirs: folder.topLevelDirs,
                                skill: folder.skill,
                                position: { x: base.x + i * 48, y: base.y + i * 48 },
                                storageMode: persist.mode,
                                localPath: persist.localPath,
                                dataPath: persist.dataPath,
                                totalBytes: persist.totalBytes,
                            }),
                        );
                    }
                    applyAgentOps(ops);
                    const names = folders.map((folder) => folder.folderName).join("、");
                    message.success(t("canvas.folderNode.dropped", { name: names }));
                    if (referenced) message.info(t("canvas.folderNode.referenceHint", { count: referenced, mb: folderCopyMaxMb || 500 }));
                    else if (copied) message.info(t("canvas.folderNode.copiedHint", { count: copied }));
                    if (folders.some((folder) => folder.truncated)) {
                        message.info(t("canvas.folderNode.truncatedHint"));
                    }
                    return;
                }

                // 原生可预览单文件 → 直接智能预览节点；其余非媒体 → 单文件文件夹（可再拉线预览）
                const isDropMediaFile = (file: File) =>
                    file.type.startsWith("image/") || file.type.startsWith("video/") || isAudioFile(file) || isModel3dFileName(file.name);
                const looseFiles = await collectDroppedLooseFiles(dropSnapshot, { exclude: isDropMediaFile });
                if (looseFiles.length) {
                    const base = dropPosition;
                    const previewOps = [];
                    const folderOps = [];
                    let previewIndex = 0;
                    let folderIndex = 0;
                    const previewNames: string[] = [];
                    const folderNames: string[] = [];
                    let previewTruncated = false;
                    for (const folder of looseFiles) {
                        const file = folder.previewCandidates[0]?.file;
                        if (file && !folder.skill && isStandalonePreviewDropFile(file)) {
                            const op = await buildStandaloneSmartPreviewOp({
                                file,
                                position: { x: base.x + previewIndex * 48, y: base.y + previewIndex * 48 },
                            });
                            if (op) {
                                previewOps.push(op);
                                previewNames.push(folder.folderName);
                                if (op.type === "add_node" && op.metadata?.errorDetails === "truncated") {
                                    previewTruncated = true;
                                }
                                previewIndex += 1;
                                continue;
                            }
                        }
                        const id = `folder-${Date.now()}-${folderIndex}-${Math.random().toString(36).slice(2, 7)}`;
                        const persist = persistDroppedLooseFile(folder);
                        if (folder.previewCandidates?.length) {
                            await stashFolderPreviewSources(id, folder.previewCandidates);
                        }
                        folderOps.push(
                            buildAddFolderNodeOp({
                                id,
                                folderName: folder.folderName,
                                entries: folder.entries,
                                truncated: folder.truncated,
                                position: { x: base.x + (previewIndex + folderIndex) * 48, y: base.y + (previewIndex + folderIndex) * 48 },
                                storageMode: persist.mode,
                                localPath: persist.localPath,
                                dataPath: persist.dataPath,
                                totalBytes: persist.totalBytes,
                            }),
                        );
                        folderNames.push(folder.folderName);
                        folderIndex += 1;
                    }
                    if (previewOps.length || folderOps.length) applyAgentOps([...previewOps, ...folderOps]);
                    if (previewNames.length) {
                        message.success(t("canvas.projectPage.vectorPreviewDropped", { count: previewNames.length }));
                        if (previewTruncated) message.info(t("canvas.projectPage.vectorPreviewTruncated"));
                    }
                    if (folderNames.length) {
                        message.success(t("canvas.folderNode.filesDropped", { name: folderNames.join("、") }));
                        message.info(t("canvas.folderNode.previewViaSmartHint"));
                    }
                }

                const mediaFiles = dropSnapshot.files.filter(
                    (item) => isDropMediaFile(item) && !(item.webkitRelativePath || "").includes("/"),
                );
                if (!mediaFiles.length) {
                    if (!looseFiles.length && droppedText) applyDroppedText(droppedText, clientX, clientY);
                    return;
                }
                const STAGGER = 40;
                const canFillNode =
                    dropTargetNode &&
                    (dropTargetNode.type === CanvasNodeType.Image ||
                        dropTargetNode.type === CanvasNodeType.Video ||
                        dropTargetNode.type === CanvasNodeType.Audio ||
                        dropTargetNode.type === MODEL_NODE_TYPE);
                if (canFillNode) {
                    const [first, ...rest] = mediaFiles;
                    await applyMediaFileToNode(dropTargetNode.id, first);
                    const basePos = {
                        x: dropTargetNode.position.x + dropTargetNode.width / 2,
                        y: dropTargetNode.position.y + dropTargetNode.height / 2,
                    };
                    for (let i = 0; i < rest.length; i++) {
                        const pos = { x: basePos.x + (i + 1) * STAGGER, y: basePos.y + (i + 1) * STAGGER };
                        const f = rest[i];
                        if (isModel3dFileName(f.name)) void createModelFileNode(f, pos);
                        else if (isAudioFile(f)) void createAudioFileNode(f, pos);
                        else if (f.type.startsWith("video/")) void createVideoFileNode(f, pos);
                        else void createImageFileNode(f, pos);
                    }
                    return;
                }
                const basePos = dropPosition;
                for (let i = 0; i < mediaFiles.length; i++) {
                    const pos = { x: basePos.x + i * STAGGER, y: basePos.y + i * STAGGER };
                    const f = mediaFiles[i];
                    if (isModel3dFileName(f.name)) {
                        void createModelFileNode(f, pos);
                    } else if (isAudioFile(f)) {
                        void createAudioFileNode(f, pos);
                    } else if (f.type.startsWith("video/")) {
                        void createVideoFileNode(f, pos);
                    } else {
                        void createImageFileNode(f, pos);
                    }
                }
            })();
        },
        [applyAgentOps, applyDroppedText, applyMediaFileToNode, createAudioFileNode, createImageFileNode, createModelFileNode, createVideoFileNode, findNodeAtClientPoint, message, screenToCanvas, setSelectedConnectionId, t],
    );

    const startTitleEditing = useCallback(() => {
        setTitleDraft(currentProject?.title || t("canvas.projectPage.untitledCanvas"));
        setTitleEditing(true);
    }, [currentProject?.title, t]);

    const finishTitleEditing = useCallback(() => {
        const nextTitle = titleDraft.trim();
        if (nextTitle) renameProject(projectId, nextTitle);
        setTitleEditing(false);
    }, [projectId, renameProject, titleDraft]);

    const preventCanvasContextMenu = useCallback(
        (event: ReactMouseEvent) => {
            if (suppressDragContextMenuRef.current) {
                event.preventDefault();
                return;
            }
            if ((event.target as HTMLElement).closest("[data-node-id]")) return;
            const world = screenToCanvas(event.clientX, event.clientY);
            const hitConnection = hitTestConnectionAt(world.x, world.y, connectionHitItemsRef.current);
            if (hitConnection) {
                event.preventDefault();
                setSelectedConnectionId(hitConnection);
                setSelectedNodeIds(new Set());
                setContextMenu({ type: "connection", x: event.clientX, y: event.clientY, connectionId: hitConnection });
                return;
            }
            event.preventDefault();
            setContextMenu(null);
        },
        [screenToCanvas, setSelectedNodeIds],
    );

    // 局部会重新声明同名 nodesRef/connectionsRef（遮蔽组件级 ref），必须在遮蔽作用域外读取组件级 ref，否则触发 TDZ ReferenceError。

    const handleGenerateNode = useCallback(
        async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => {
            const generationScope = createGenerationScope();
            const nodesRef = generationScope.nodesRef;
            const connectionsRef = generationScope.connectionsRef;
            const setNodes = generationScope.setNodes;
            const setConnections = generationScope.setConnections;
            const setRunningNodeId = generationScope.setRunningNodeId;
            const startGenerationRequest = generationScope.startGenerationRequest;
            const finishGenerationRequest = generationScope.finishGenerationRequest;
            const hasRunningFor = generationScope.hasRunningFor;

            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            const generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode);
            const blockedGeneration = closedGenerationError(generationConfig.model, mode === "audio" || mode === "model" ? mode : undefined);
            if (blockedGeneration) {
                message.warning(blockedGeneration.message);
                return;
            }
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                message.warning(t("canvas.projectPage.configRequired"));
                openConfigDialog(true);
                return;
            }

            if (sourceNode?.metadata?.videoLocalEditTargetId) {
                try { await generateVideoLocalEdit(generationScope, projectId, sourceNode, generationConfig, prompt); }
                catch (error) { message.error(error instanceof Error ? error.message : "视频局部编辑失败，原片未更改"); }
                return;
            }

            // useBuiltinPanel.writeBackToSelf reuses built-in generation while writing the result back to the plugin node.
            // Image mode currently supports display-only nodes such as panoramas, with a useBuiltinPanel.promptPrefix.
            const builtinPanel = sourceNode ? getNodeDefinition(sourceNode.type)?.useBuiltinPanel : undefined;
            if (sourceNode && builtinPanel?.writeBackToSelf && builtinPanel.mode === "image") {
                const scene = prompt.trim();
                if (!scene) return;
                setRunningNodeId(nodeId);
                const controller = startGenerationRequest(nodeId, nodeId, nodeId);
                setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt: scene, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)));
                try {
                    const fullPrompt = (builtinPanel.promptPrefix || "") + scene;
                    // Upstream image nodes become references; without them this is text-to-image.
                    const upstreamNodes = connectionsRef.current
                        .filter((conn) => conn.toNodeId === nodeId)
                        .map((conn) => nodesRef.current.find((node) => node.id === conn.fromNodeId))
                        .filter((node): node is CanvasNodeData => Boolean(node));
                    const refs = upstreamNodes.flatMap((up) =>
                        typeof up.metadata?.content === "string" && up.metadata.content && up.type !== sourceNode.type
                            ? [{ id: up.id, name: `${up.title || up.id}.png`, type: up.metadata.mimeType || "image/png", dataUrl: up.metadata.content, storageKey: up.metadata.storageKey }]
                            : [],
                    );
                    const image = refs.length
                        ? await requestEdit({ ...generationConfig, count: "1" }, fullPrompt, refs, undefined, { signal: controller.signal }).then((items) => items[0])
                        : await requestGeneration({ ...generationConfig, count: "1" }, fullPrompt, { signal: controller.signal }).then((items) => items[0]);
                    const uploaded = await uploadImage(image.dataUrl);
                    setNodes((prev) =>
                        prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: scene, model: generationConfig.model, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)),
                    );
                    setDialogNodeId(null);
                } catch (error) {
                    if (!isGenerationCanceled(error)) {
                        const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                        message.error(errorDetails);
                        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                    }
                } finally {
                    finishGenerationRequest(nodeId, controller);
                }
                return;
            }

            setRunningNodeId(nodeId);
            const generationRunId = nanoid();
            const runController = startGenerationRequest(generationRunId, nodeId, nodeId);
            const finishRun = () => {
                for (const request of listCanvasGenerationRequests()) {
                    if (request.controller === runController) finishGenerationRequest(request.targetNodeId, runController);
                }
            };
            const sourceTextContent = sourceNode?.type === CanvasNodeType.Text ? sourceNode.metadata?.content?.trim() || "" : "";
            const editingTextNode = mode === "text" && Boolean(sourceTextContent);
            // Agent / 配置节点生图：hydrate 前就挂上「生成中」占位，避免长时间只有思考态、画布无框
            let pendingChildIds: string[] = [];
            let reservedImageRootId: string | undefined;
            let reservedImageColumn: { anchor: number; right: number } | undefined;
            let markedSourceLoadingEarly = false;
            const settleEarlySource = (status: typeof NODE_STATUS_IDLE | typeof NODE_STATUS_ERROR, errorDetails?: string) => {
                if (!markedSourceLoadingEarly) return;
                setNodes((prev) => hasRunningFor(nodeId) ? prev : prev.map((node) =>
                    node.id === nodeId && node.metadata?.status === NODE_STATUS_LOADING
                        ? { ...node, metadata: { ...node.metadata, status, errorDetails } }
                        : node,
                ));
            };
            const settleLoadingChildren = (ids: string[], status: typeof NODE_STATUS_IDLE | typeof NODE_STATUS_ERROR, errorDetails?: string) => {
                if (!ids.length) return;
                setNodes((prev) =>
                    prev.map((node) =>
                        ids.includes(node.id) && node.metadata?.status === NODE_STATUS_LOADING
                            ? { ...node, metadata: { ...node.metadata, status, errorDetails } }
                            : node,
                    ),
                );
            };
            if (mode === "image") {
                const isConfigNodeEarly = sourceNode?.type === CanvasNodeType.Config;
                const isImageNodeEarly = sourceNode?.type === CanvasNodeType.Image;
                const isEmptyImageNodeEarly = isImageNodeEarly && !sourceNode?.metadata?.content;
                // 并发继续生成：不复用已有「生成中」子节点，避免抢走上一轮占位
                if (!isEmptyImageNodeEarly && (isConfigNodeEarly || isImageNodeEarly || sourceNode?.type === CanvasNodeType.Text)) {
                        const imageSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                        const parentSpec = NODE_DEFAULT_SIZE[isConfigNodeEarly ? CanvasNodeType.Config : isImageNodeEarly ? CanvasNodeType.Image : CanvasNodeType.Text];
                        const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                        const parentWidth = sourceNode?.width || parentSpec.width;
                        const parentHeight = sourceNode?.height || parentSpec.height;
                        reservedImageRootId = nanoid();
                        pendingChildIds = [reservedImageRootId];
                        const parentRightXEarly = parentPosition.x + parentWidth;
                        const siblingRightsEarly = connectionsRef.current
                            .filter((connection) => connection.fromNodeId === nodeId)
                            .map((connection) => nodesRef.current.find((item) => item.id === connection.toNodeId))
                            .filter((item): item is CanvasNodeData => Boolean(item && item.type === CanvasNodeType.Image))
                            .map((item) => item.position.x + item.width);
                        const earlyAnchor = claimResultColumnAnchor(nodeId, parentRightXEarly, imageSpec.width, siblingRightsEarly);
                        const earlyPosition = getVerticalResultPlacement(0, 1, imageSpec.height, parentPosition.y + parentHeight / 2, earlyAnchor);
                        reservedImageColumn = { anchor: earlyAnchor, right: earlyPosition.x + imageSpec.width };
                        const earlyNode: CanvasNodeData = {
                            id: reservedImageRootId,
                            type: CanvasNodeType.Image,
                            title: prompt.slice(0, 32) || "Generated Image",
                            position: earlyPosition,
                            width: imageSpec.width,
                            height: imageSpec.height,
                            metadata: {
                                prompt,
                                status: NODE_STATUS_LOADING,
                            },
                        };
                        markedSourceLoadingEarly = !isImageNodeEarly;
                        setNodes((prev) => {
                            const next = [
                                ...prev.map((node) =>
                                    node.id === nodeId
                                        ? isImageNodeEarly
                                            ? node
                                            : { ...node, metadata: { ...node.metadata, ...(isConfigNodeEarly ? {} : { prompt }), status: NODE_STATUS_LOADING, errorDetails: undefined } }
                                        : node,
                                ),
                                earlyNode,
                            ];
                            nodesRef.current = next;
                            return next;
                        });
                        setConnections((prev) => {
                            const next = [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: reservedImageRootId! }];
                            connectionsRef.current = next;
                            return next;
                        });
                        startGenerationRequest(reservedImageRootId, nodeId, nodeId, runController);
                }
            }
            let generationContext;
            try {
                generationContext = await hydrateNodeGenerationContext(
                    buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, editingTextNode ? t("canvas.projectPage.editTextPrompt", { source: sourceTextContent, prompt }) : prompt),
                );
            } catch (error) {
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                message.error(errorDetails);
                if (pendingChildIds.length) {
                    setNodes((prev) => prev.map((node) => (pendingChildIds.includes(node.id) ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                }
                finishRun();
                settleEarlySource(NODE_STATUS_ERROR, errorDetails);
                setRunningNodeId((current) => {
                    if (current !== nodeId) return current;
                    return hasRunningFor(nodeId) ? nodeId : null;
                });
                return;
            }
            const effectivePrompt = generationContext.prompt.trim();
            if (runController.signal.aborted) {
                settleLoadingChildren(pendingChildIds, NODE_STATUS_IDLE);
                finishRun();
                settleEarlySource(NODE_STATUS_IDLE);
                setRunningNodeId((current) => {
                    if (current !== nodeId) return current;
                    return hasRunningFor(nodeId) ? nodeId : null;
                });
                return;
            }
            const markSourceStatus = sourceNode?.type !== CanvasNodeType.Image && !editingTextNode;
            if (!effectivePrompt && (mode === "text" || mode === "audio")) {
                settleLoadingChildren(pendingChildIds, NODE_STATUS_IDLE);
                finishRun();
                setRunningNodeId((current) => {
                    if (current !== nodeId) return current;
                    return hasRunningFor(nodeId) ? nodeId : null;
                });
                return;
            }
            if (markSourceStatus && !reservedImageRootId) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...(node.type === CanvasNodeType.Config ? {} : { prompt }), status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)));

            try {
                if (mode === "image") {
                    const count = getGenerationCount(generationConfig.count);
                    const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                    const isImageNode = sourceNode?.type === CanvasNodeType.Image;
                    const isEmptyImageNode = isImageNode && !sourceNode?.metadata?.content;
                    const ignoreConnectedImageRefs = isPlainTextToImageEndpoint(generationConfig.model || "");
                    const localEditPasteSource = ignoreConnectedImageRefs
                        ? null
                        : (() => {
                              const resolve = (node?: CanvasNodeData | null) => {
                                  if (!node?.metadata?.localEditPreprocess || !node.metadata.localEditCropBox) return null;
                                  const original = node.metadata.localEditOriginalContent || node.metadata.content;
                                  if (!original) return null;
                                  return { original, originalStorageKey: node.metadata.localEditOriginalStorageKey, cropBox: node.metadata.localEditCropBox };
                              };
                              return resolve(sourceNode) || generationContext.referenceImages.map((ref) => resolve(nodesRef.current.find((item) => item.id === ref.id))).find(Boolean) || null;
                          })();
                    // 局部预处理：数量默认 1；比例用预处理所选（原图/auto → auto）
                    const localEditSource =
                        sourceNode?.metadata?.localEditPreprocess
                            ? sourceNode
                            : generationContext.referenceImages.map((ref) => nodesRef.current.find((item) => item.id === ref.id)).find((item) => item?.metadata?.localEditPreprocess) || null;
                    const localEditAspectRatio =
                        localEditSource?.metadata?.size || localEditSource?.metadata?.modelParams?.aspectRatio || localEditSource?.metadata?.localEditChosenRatio || "1:1";
                    const imageGenerationConfig =
                        sourceNode?.metadata?.localEditPreprocess || localEditPasteSource
                            ? {
                                  ...generationConfig,
                                  count: sourceNode?.metadata?.count || localEditSource?.metadata?.count || "1",
                                  size: sourceNode?.metadata?.size || localEditAspectRatio,
                                  quality: sourceNode?.metadata?.quality || localEditSource?.metadata?.quality || LOCAL_EDIT_DEFAULT_RESOLUTION,
                                  modelParams: { aspectRatio: localEditAspectRatio, ...generationConfig.modelParams, ...(sourceNode?.metadata?.modelParams || {}) },
                              }
                            : generationConfig;
                    const sourceReference =
                        isImageNode && sourceNode?.metadata?.content
                            ? sourceNode.metadata.localEditPreprocess
                                ? await (async () => {
                                      const cropDataUrl = await imageToDataUrl({
                                          dataUrl: sourceNode.metadata.localEditCroppedContent,
                                          storageKey: sourceNode.metadata.localEditCroppedStorageKey,
                                      });
                                      if (cropDataUrl) {
                                          return [
                                              {
                                                  id: sourceNode.id,
                                                  name: `${sourceNode.title || sourceNode.id}-crop.png`,
                                                  type: "image/png",
                                                  dataUrl: cropDataUrl,
                                                  storageKey: sourceNode.metadata.localEditCroppedStorageKey,
                                              },
                                          ];
                                      }
                                      throw new Error("局部编辑裁剪图读取失败，请重新框选后生成");
                                  })()
                                : sourceNode.metadata.outpaintPreprocess && (sourceNode.metadata.outpaintWorkContent || sourceNode.metadata.outpaintWorkStorageKey)
                                  ? [
                                        {
                                            id: sourceNode.id,
                                            name: `${sourceNode.title || sourceNode.id}-outpaint.png`,
                                            type: "image/png",
                                            dataUrl: await imageToDataUrl({
                                                dataUrl: sourceNode.metadata.outpaintWorkContent,
                                                storageKey: sourceNode.metadata.outpaintWorkStorageKey,
                                            }),
                                            storageKey: sourceNode.metadata.outpaintWorkStorageKey,
                                        },
                                    ]
                                : [
                                      {
                                          id: sourceNode.id,
                                          name: `${sourceNode.title || sourceNode.id}.png`,
                                          type: sourceNode.metadata.mimeType || "image/png",
                                          dataUrl: sourceNode.metadata.content,
                                          storageKey: sourceNode.metadata.storageKey,
                                      },
                                  ]
                            : [];
                    const outpaintSource =
                        sourceNode?.metadata?.outpaintPreprocess
                            ? sourceNode
                            : generationContext.referenceImages.map((ref) => nodesRef.current.find((item) => item.id === ref.id)).find((item) => item?.metadata?.outpaintPreprocess) || null;
                    const referenceImages = ignoreConnectedImageRefs ? [] : sourceReference.length ? sourceReference : generationContext.referenceImages;
                    const imageApiFormat = resolveModelRequestConfig(imageGenerationConfig, imageGenerationConfig.model).apiFormat;
                    const imagesPerTask = imageApiFormat === "runninghub" ? runninghubImagesPerTask(imageGenerationConfig.model || "") : 1;
                    // 固定多图模型按组提交，每任务分配 imagesPerTask 个结果节点
                    const layoutCount = count * imagesPerTask;
                    const generationType = referenceImages.length ? ("edit" as const) : ("generation" as const);
                    const generationMetadata = {
                        ...buildImageGenerationMetadata(generationType, imageGenerationConfig, layoutCount, referenceImages),
                        // 局部编辑：API 仍用裁剪图（references），滑块对比用完整原图
                        ...(localEditPasteSource
                            ? {
                                  compareReferences: [localEditPasteSource.originalStorageKey || localEditPasteSource.original].filter(Boolean),
                              }
                            : outpaintSource
                              ? {
                                    compareReferences: [outpaintSource.metadata?.outpaintPreviewStorageKey || outpaintSource.metadata?.storageKey].filter(Boolean),
                                }
                              : {}),
                    };
                    const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : isImageNode ? CanvasNodeType.Image : CanvasNodeType.Text];
                    const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                    const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                    // 用源节点真实宽高偏移，避免大图仍按默认尺寸摆放导致占位框重叠
                    const parentWidth = sourceNode?.width || parentConfig.width;
                    const parentHeight = sourceNode?.height || parentConfig.height;
                    const firstImageNode =
                        isImageNode && sourceNode?.metadata?.content
                            ? sourceNode
                            : referenceImages.map((ref) => nodesRef.current.find((item) => item.id === ref.id && item.type === CanvasNodeType.Image)).find((item): item is CanvasNodeData => Boolean(item)) || null;
                    const sizeSource = isEmptyImageNode ? sourceNode : firstImageNode;
                    const resultWidth = sizeSource?.width || imageConfig.width;
                    const resultHeight = sizeSource?.height || imageConfig.height;
                    const parentCenterY = parentPosition.y + parentHeight / 2;
                    const parentRightX = parentPosition.x + parentWidth;
                    const reusableIds = reservedImageRootId ? [reservedImageRootId] : [];
                    // 多图：每个结果独立节点竖排；空图节点 count=1 仍原地填充（固定多图模型除外）
                    const fillEmptyInPlace = isEmptyImageNode && count === 1 && imagesPerTask === 1;
                    // 并发继续生成：不复用上一轮占位；按当前仍连着的子图右缘排下一列（中间列删/挪走后会回填空位）
                    const siblingImages = connectionsRef.current
                        .filter((connection) => connection.fromNodeId === nodeId)
                        .map((connection) => nodesRef.current.find((item) => item.id === connection.toNodeId))
                        .filter((item): item is CanvasNodeData => Boolean(item && item.type === CanvasNodeType.Image && item.id !== reservedImageRootId));
                    const siblingRights = siblingImages.map((item) => item.position.x + item.width);
                    let placementAnchorX = parentRightX;
                    if (!fillEmptyInPlace) {
                        if (reservedImageRootId) {
                            const reserved = nodesRef.current.find((item) => item.id === reservedImageRootId);
                            placementAnchorX = reserved
                                ? reserved.position.x - RESULT_STACK_OFFSET_X
                                : (reservedImageColumn?.anchor ?? claimResultColumnAnchor(nodeId, parentRightX, resultWidth, siblingRights));
                            ensureResultStackCursor(nodeId, placementAnchorX + RESULT_STACK_OFFSET_X + resultWidth, reservedImageColumn?.right);
                        } else {
                            placementAnchorX = claimResultColumnAnchor(nodeId, parentRightX, resultWidth, siblingRights);
                        }
                    }
                    const resultIds = Array.from({ length: layoutCount }, (_, index) => {
                        if (fillEmptyInPlace) return nodeId;
                        if (reusableIds[index]) return reusableIds[index];
                        return nanoid();
                    });
                    pendingChildIds = fillEmptyInPlace ? [nodeId] : resultIds;
                    const resultNodes: CanvasNodeData[] = resultIds.map((id, index) => {
                        const position = fillEmptyInPlace
                            ? { x: parentPosition.x, y: parentPosition.y }
                            : getVerticalResultPlacement(index, layoutCount, resultHeight, parentCenterY, placementAnchorX);
                        return {
                            id,
                            type: CanvasNodeType.Image,
                            title: effectivePrompt.slice(0, 32) || (layoutCount > 1 ? `Generated Image ${index + 1}` : "Generated Image"),
                            position,
                            width: resultWidth,
                            height: resultHeight,
                            metadata: {
                                prompt: effectivePrompt,
                                status: NODE_STATUS_LOADING,
                                ...generationMetadata,
                            },
                        };
                    });
                    const existingIdSet = new Set(nodesRef.current.map((item) => item.id));
                    const reuseIds = new Set(resultIds.filter((id) => existingIdSet.has(id)));
                    const nodesToAdd = resultNodes.filter((node) => !reuseIds.has(node.id));

                    setNodes((prev) => {
                        const next = [
                            ...prev.map((node) => {
                                if (node.id === nodeId) {
                                    if (isConfigNode) {
                                        return { ...node, metadata: { ...node.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined } };
                                    }
                                    if (fillEmptyInPlace) {
                                        const root = resultNodes[0];
                                        return {
                                            ...node,
                                            position: root.position,
                                            width: root.width,
                                            height: root.height,
                                            title: root.title,
                                            metadata: { ...node.metadata, ...root.metadata, images: undefined, primaryImageId: undefined, errorDetails: undefined },
                                        };
                                    }
                                    if (isImageNode) {
                                        if (isEmptyImageNode) return node;
                                        return { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } };
                                    }
                                    return {
                                        ...node,
                                        type: CanvasNodeType.Text,
                                        title: prompt.slice(0, 32) || "Prompt",
                                        width: parentConfig.width,
                                        height: parentConfig.height,
                                        metadata: { ...node.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS, fontSize: 14, errorDetails: undefined },
                                    };
                                }
                                const reused = resultNodes.find((item) => item.id === node.id);
                                if (!reused) return node;
                                return {
                                    ...node,
                                    title: reused.title,
                                    position: reused.position,
                                    width: reused.width,
                                    height: reused.height,
                                    metadata: { ...node.metadata, ...reused.metadata, images: undefined, primaryImageId: undefined, errorDetails: undefined },
                                };
                            }),
                            ...nodesToAdd,
                        ];
                        nodesRef.current = next;
                        return next;
                    });
                    if (!fillEmptyInPlace) {
                        setConnections((prev) => {
                            const known = new Set(prev.filter((item) => item.fromNodeId === nodeId).map((item) => item.toNodeId));
                            const additions = resultIds
                                .filter((id) => id !== nodeId && !known.has(id))
                                .map((id) => ({ id: nanoid(), fromNodeId: nodeId, toNodeId: id }));
                            if (!additions.length) return prev;
                            const next = [...prev, ...additions];
                            connectionsRef.current = next;
                            return next;
                        });
                    }
                    setSelectedNodeIds(new Set([nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(nodeId);

                    resultIds.forEach((id) => {
                        if (id !== nodeId) startGenerationRequest(id, nodeId, nodeId, runController);
                    });
                    const controller = runController;
                    let hasSuccess = false;
                    let hasFailure = false;
                    let firstError = "";
                    const applyGeneratedImage = async (targetNodeId: string, image: { id: string; dataUrl: string }) => {
                        const pastedDataUrl = localEditPasteSource
                            ? await uncropPaste(
                                  await imageToDataUrl({
                                      dataUrl: localEditPasteSource.original,
                                      storageKey: localEditPasteSource.originalStorageKey,
                                  }),
                                  image.dataUrl,
                                  localEditPasteSource.cropBox,
                                  0,
                              )
                            : image.dataUrl;
                        const uploaded = await uploadImage(pastedDataUrl);
                        const imageSize = fitNodeSize(
                            uploaded.width,
                            uploaded.height,
                            sizeSource?.width || imageConfig.width,
                            sizeSource?.height || imageConfig.height,
                        );
                        setNodes((prev) =>
                            prev.map((node) => {
                                if (node.id !== targetNodeId) return node;
                                const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                                return {
                                    ...node,
                                    position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                    ...imageSize,
                                    metadata: {
                                        ...node.metadata,
                                        content: uploaded.url,
                                        storageKey: uploaded.storageKey,
                                        naturalWidth: uploaded.width,
                                        naturalHeight: uploaded.height,
                                        bytes: uploaded.bytes,
                                        mimeType: uploaded.mimeType,
                                        status: NODE_STATUS_SUCCESS,
                                        errorDetails: undefined,
                                        images: undefined,
                                        primaryImageId: undefined,
                                    },
                                };
                            }),
                        );
                        hasSuccess = true;
                        if (isConfigNode) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)));
                    };
                    const markGeneratedFailure = (targetNodeId: string, errorDetails: string) => {
                        if (!firstError) firstError = errorDetails;
                        hasFailure = true;
                        setNodes((prev) =>
                            prev.map((node) =>
                                node.id === targetNodeId
                                    ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails, images: undefined, primaryImageId: undefined } }
                                    : node,
                            ),
                        );
                    };
                    // LinkFox 通过 outputNum 一次返回 N 张；固定多图模型「N 组」= N 个任务，每任务保留全部图片。
                    // 其他渠道仍按 N×count=1 并发，便于各占位独立结算。
                    const rhRequestConfig = resolveModelRequestConfig(imageGenerationConfig, imageGenerationConfig.model);
                    const rhImageRefs = imageApiFormat === "runninghub" && referenceImages.length
                        ? await prepareRunninghubImageRefs(
                              { ...rhRequestConfig, model: imageGenerationConfig.model, modelParams: imageGenerationConfig.modelParams },
                              referenceImages,
                              controller.signal,
                          )
                        : undefined;
                    const useLinkfoxBatch = imageApiFormat === "linkfox";
                    if (useLinkfoxBatch) {
                        try {
                            const batch = referenceImages.length
                                ? await requestEdit({ ...imageGenerationConfig, count: String(count) }, effectivePrompt, referenceImages, undefined, { signal: controller.signal })
                                : await requestGeneration({ ...imageGenerationConfig, count: String(count) }, effectivePrompt, { signal: controller.signal });
                            await Promise.all(
                                resultIds.map(async (targetNodeId, index) => {
                                    const image = batch[index];
                                    if (!image) {
                                        markGeneratedFailure(targetNodeId, t("canvas.projectPage.generationFailed"));
                                        return;
                                    }
                                    try {
                                        await applyGeneratedImage(targetNodeId, image);
                                    } catch (error) {
                                        if (isGenerationCanceled(error)) {
                                            settleLoadingChildren([targetNodeId], NODE_STATUS_IDLE);
                                            return;
                                        }
                                        markGeneratedFailure(targetNodeId, error instanceof Error ? error.message : t("canvas.projectPage.generationFailed"));
                                    }
                                }),
                            );
                        } catch (error) {
                            if (isGenerationCanceled(error)) {
                                settleLoadingChildren(resultIds, NODE_STATUS_IDLE);
                            } else {
                                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                                resultIds.forEach((targetNodeId) => markGeneratedFailure(targetNodeId, errorDetails));
                            }
                        }
                    } else if (imagesPerTask > 1) {
                        await Promise.all(
                            Array.from({ length: count }, async (_, taskIndex) => {
                                const slotIds = resultIds.slice(
                                    taskIndex * imagesPerTask,
                                    (taskIndex + 1) * imagesPerTask,
                                );
                                try {
                                    const requestOptions = { signal: controller.signal, runninghubImageRefs: rhImageRefs };
                                    const batch = referenceImages.length
                                        ? await requestEdit({ ...imageGenerationConfig, count: "1" }, effectivePrompt, referenceImages, undefined, requestOptions)
                                        : await requestGeneration({ ...imageGenerationConfig, count: "1" }, effectivePrompt, requestOptions);
                                    await Promise.all(
                                        slotIds.map(async (targetNodeId, index) => {
                                            const image = batch[index];
                                            if (!image) {
                                                markGeneratedFailure(targetNodeId, t("canvas.projectPage.generationFailed"));
                                                return;
                                            }
                                            try {
                                                await applyGeneratedImage(targetNodeId, image);
                                            } catch (error) {
                                                if (isGenerationCanceled(error)) {
                                                    settleLoadingChildren([targetNodeId], NODE_STATUS_IDLE);
                                                    return;
                                                }
                                                markGeneratedFailure(targetNodeId, error instanceof Error ? error.message : t("canvas.projectPage.generationFailed"));
                                            }
                                        }),
                                    );
                                } catch (error) {
                                    if (isGenerationCanceled(error)) {
                                        settleLoadingChildren(slotIds, NODE_STATUS_IDLE);
                                        return;
                                    }
                                    const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                                    slotIds.forEach((targetNodeId) => markGeneratedFailure(targetNodeId, errorDetails));
                                }
                            }),
                        );
                    } else {
                        await Promise.all(
                            resultIds.map(async (targetNodeId) => {
                                try {
                                    const image = referenceImages.length
                                        ? await requestEdit({ ...imageGenerationConfig, count: "1" }, effectivePrompt, referenceImages, undefined, { signal: controller.signal, runninghubImageRefs: rhImageRefs }).then((items) => items[0])
                                        : await requestGeneration({ ...imageGenerationConfig, count: "1" }, effectivePrompt, { signal: controller.signal }).then((items) => items[0]);
                                    await applyGeneratedImage(targetNodeId, image);
                                    return true;
                                } catch (error) {
                                    if (isGenerationCanceled(error)) {
                                        settleLoadingChildren([targetNodeId], NODE_STATUS_IDLE);
                                        return false;
                                    }
                                    markGeneratedFailure(targetNodeId, error instanceof Error ? error.message : t("canvas.projectPage.generationFailed"));
                                }
                                return false;
                            }),
                        );
                    }
                    resultIds.forEach((id) => {
                        if (id !== nodeId) finishGenerationRequest(id, controller);
                    });
                    if (controller.signal.aborted) {
                        settleLoadingChildren(isConfigNode ? [nodeId, ...resultIds] : resultIds, NODE_STATUS_IDLE);
                        return;
                    }
                    // 节点上保留首个具体错误，避免只显示「全部失败」无法区分渠道/本地问题
                    const failureDetail = firstError || t("canvas.projectPage.generationFailed");
                    if (hasFailure) {
                        message.error(hasSuccess ? t("canvas.projectPage.partialFailed") : failureDetail);
                    }
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === nodeId && isConfigNode
                                ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : failureDetail } }
                                : node,
                        ),
                    );
                    return;
                }

                if (mode === "video") {
                    const spec = nodeSizeFromRatio(generationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                    const isEmptyVideoNode = sourceNode?.type === CanvasNodeType.Video && !sourceNode.metadata?.content;
                    const videoId = isEmptyVideoNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const videoNode: CanvasNodeData = {
                        id: videoId,
                        type: CanvasNodeType.Video,
                        title: effectivePrompt.slice(0, 32) || "Generated Video",
                        position: isEmptyVideoNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y },
                        width: isEmptyVideoNode ? sourceNode.width : spec.width,
                        height: isEmptyVideoNode ? sourceNode.height : spec.height,
                        metadata: {
                            prompt: effectivePrompt,
                            status: NODE_STATUS_LOADING,
                            model: generationConfig.model,
                            size: generationConfig.size,
                            seconds: generationConfig.videoSeconds,
                            vquality: generationConfig.vquality,
                            generateAudio: generationConfig.videoGenerateAudio,
                            watermark: generationConfig.videoWatermark,
                            realPersonMode: generationConfig.videoRealPersonMode,
                            videoReferenceMode: generationConfig.videoReferenceMode,
                            references: generationReferenceUrls(generationContext),
                        },
                    };
                    pendingChildIds = [videoId];
                    setNodes((prev) =>
                        isEmptyVideoNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...videoNode } : node))
                            : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), videoNode],
                    );
                    if (!isEmptyVideoNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: videoId }]);
                    const controller = startGenerationRequest(videoId, nodeId, nodeId, runController);
                    try {
                        const video = await storeGeneratedVideo(
                            await requestVideoGeneration(generationConfig, effectivePrompt, generationContext.referenceImages, generationContext.referenceVideos, generationContext.referenceAudios, { signal: controller.signal }),
                        );
                        const videoSize = fitNodeSize(video.width || spec.width, video.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                        setNodes((prev) =>
                            prev.map((node) =>
                                node.id === videoId
                                    ? {
                                          ...node,
                                          width: videoSize.width,
                                          height: videoSize.height,
                                          position: { x: node.position.x + node.width / 2 - videoSize.width / 2, y: node.position.y + node.height / 2 - videoSize.height / 2 },
                                          metadata: {
                                              ...node.metadata,
                                              ...videoMetadata(video),
                                              prompt: effectivePrompt,
                                              model: generationConfig.model,
                                              size: generationConfig.size,
                                              seconds: generationConfig.videoSeconds,
                                              vquality: generationConfig.vquality,
                                              generateAudio: generationConfig.videoGenerateAudio,
                                              watermark: generationConfig.videoWatermark,
                                              realPersonMode: generationConfig.videoRealPersonMode,
                                              videoReferenceMode: generationConfig.videoReferenceMode,
                                              references: generationReferenceUrls(generationContext),
                                          },
                                      }
                                    : node,
                            ),
                        );
                    } finally {
                        finishGenerationRequest(videoId, controller);
                    }
                    return;
                }

                if (mode === "model") {
                    const spec = getNodeSpec(MODEL_NODE_TYPE);
                    const isEmptyModelNode = sourceNode?.type === MODEL_NODE_TYPE && !sourceNode.metadata?.content;
                    const modelId = isEmptyModelNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const modelNode: CanvasNodeData = {
                        id: modelId,
                        type: MODEL_NODE_TYPE,
                        title: effectivePrompt.slice(0, 32) || t("canvas.nodeTypes.model"),
                        position: isEmptyModelNode && sourceNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y },
                        width: isEmptyModelNode && sourceNode ? sourceNode.width : spec.width,
                        height: isEmptyModelNode && sourceNode ? sourceNode.height : spec.height,
                        metadata: {
                            prompt: effectivePrompt,
                            status: NODE_STATUS_LOADING,
                            model: generationConfig.model,
                            modelParams: generationConfig.modelParams,
                            references: generationReferenceUrls(generationContext),
                            interactive: false,
                            modelShowTextures: false,
                            modelPreviewBg: "dark",
                        },
                    };
                    pendingChildIds = [modelId];
                    setNodes((prev) =>
                        isEmptyModelNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...modelNode } : node))
                            : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), modelNode],
                    );
                    if (!isEmptyModelNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: modelId }]);
                    const controller = startGenerationRequest(modelId, nodeId, nodeId, runController);
                    try {
                        const generated = await storeGeneratedModel(await requestModelGeneration(generationConfig, effectivePrompt, generationContext.referenceImages, { signal: controller.signal }));
                        setNodes((prev) =>
                            prev.map((node) =>
                                node.id === modelId
                                    ? {
                                          ...node,
                                          metadata: {
                                              ...node.metadata,
                                              ...modelMetadata(generated, generated.fileName),
                                              modelShowTextures: generated.showTextures,
                                              prompt: effectivePrompt,
                                              model: generationConfig.model,
                                              modelParams: generationConfig.modelParams,
                                              references: generationReferenceUrls(generationContext),
                                          },
                                      }
                                    : node,
                            ),
                        );
                    } finally {
                        finishGenerationRequest(modelId, controller);
                    }
                    return;
                }

                if (mode === "audio") {
                    if (isRunninghubLyricsConfig(generationConfig)) {
                        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
                        const reuseNode = Boolean(sourceNode && !sourceNode.metadata?.content && (sourceNode.type === CanvasNodeType.Text || sourceNode.type === CanvasNodeType.Audio));
                        const textId = reuseNode ? nodeId : nanoid();
                        const parent = sourceNode?.position || { x: 0, y: 0 };
                        const textNode: CanvasNodeData = {
                            id: textId,
                            type: CanvasNodeType.Text,
                            title: effectivePrompt.slice(0, 32) || "Generated Text",
                            position: reuseNode && sourceNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y + ((sourceNode?.height || spec.height) - spec.height) / 2 },
                            width: reuseNode && sourceNode ? sourceNode.width : spec.width,
                            height: reuseNode && sourceNode ? sourceNode.height : spec.height,
                            metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, fontSize: 14, model: generationConfig.model },
                        };
                        pendingChildIds = [textId];
                        setNodes((prev) =>
                            reuseNode
                                ? prev.map((node) => (node.id === nodeId ? { ...node, ...textNode } : node))
                                : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), textNode],
                        );
                        if (!reuseNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: textId }]);
                        const controller = startGenerationRequest(textId, nodeId, nodeId, runController);
                        try {
                            const content = await requestLyricsGeneration(generationConfig, effectivePrompt, { signal: controller.signal });
                            setNodes((prev) =>
                                prev.map((node) =>
                                    node.id === textId
                                        ? { ...node, type: CanvasNodeType.Text, metadata: { ...node.metadata, content, prompt: effectivePrompt, status: NODE_STATUS_SUCCESS, fontSize: 14, model: generationConfig.model } }
                                        : node,
                                ),
                            );
                        } finally {
                            finishGenerationRequest(textId, controller);
                        }
                        return;
                    }
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    const isEmptyAudioNode = sourceNode?.type === CanvasNodeType.Audio && !sourceNode.metadata?.content;
                    const audioId = isEmptyAudioNode ? nodeId : nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const audioNode: CanvasNodeData = {
                        id: audioId,
                        type: CanvasNodeType.Audio,
                        title: effectivePrompt.slice(0, 32) || "Generated Audio",
                        position: isEmptyAudioNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y + ((sourceNode?.height || spec.height) - spec.height) / 2 },
                        width: isEmptyAudioNode ? sourceNode.width : spec.width,
                        height: isEmptyAudioNode ? sourceNode.height : spec.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, ...buildAudioGenerationMetadata(generationConfig) },
                    };
                    pendingChildIds = [audioId];
                    setNodes((prev) =>
                        isEmptyAudioNode
                            ? prev.map((node) => (node.id === nodeId ? { ...node, ...audioNode } : node))
                            : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), audioNode],
                    );
                    if (!isEmptyAudioNode) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: audioId }]);
                    const controller = startGenerationRequest(audioId, nodeId, nodeId, runController);
                    try {
                        const audio = await storeGeneratedAudio(await requestAudioGeneration(generationConfig, effectivePrompt, generationContext.referenceAudios, { signal: controller.signal }), generationConfig.audioFormat);
                        setNodes((prev) => prev.map((node) => (node.id === audioId ? { ...node, metadata: { ...node.metadata, ...audioMetadata(audio), prompt: effectivePrompt, ...buildAudioGenerationMetadata(generationConfig), clipStartMs: undefined, clipEndMs: undefined } } : node)));
                    } finally {
                        finishGenerationRequest(audioId, controller);
                    }
                    return;
                }

                let streamed = "";
                const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                // 文本生成始终 1 个结果；count 是生图张数，不能拿来建文本占位
                const textCount = 1;
                const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : CanvasNodeType.Text];
                const textConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
                const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                const childIds = isConfigNode || editingTextNode ? Array.from({ length: textCount }, () => nanoid()) : [];
                pendingChildIds = childIds;
                if (isConfigNode || editingTextNode) {
                    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
                        id,
                        type: CanvasNodeType.Text,
                        title: effectivePrompt.slice(0, 32) || "Generated Text",
                        position: {
                            x: parentPosition.x + parentConfig.width + 96,
                            y: parentPosition.y + parentConfig.height / 2 - textConfig.height / 2 + (index - (textCount - 1) / 2) * (textConfig.height + 36),
                        },
                        width: textConfig.width,
                        height: textConfig.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, fontSize: 14, model: generationConfig.model, reasoningEffort: generationConfig.reasoningEffort },
                    }));
                    setNodes((prev) => [...prev.map((node) => (node.id === nodeId && isConfigNode ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)), ...childNodes]);
                    setConnections((prev) => [...prev, ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: nodeId, toNodeId: childId }))]);
                }

                const controller = runController;
                const textTargetIds = childIds.length ? childIds : [nodeId];
                textTargetIds.forEach((targetNodeId) => startGenerationRequest(targetNodeId, nodeId, nodeId, controller));
                let answers: Array<{ nodeId: string; content: string }> = [];
                if (isCodexCliTextModel(generationConfig.model)) {
                    try {
                        const content = await requestCodexCliText({
                            sourceNodeId: nodeId,
                            prompt: effectivePrompt,
                            messageText: prompt.trim(),
                            referenceImages: generationContext.referenceImages,
                            skills: collectUpstreamCodexSkillsFromGraph(nodeId, nodesRef.current, connectionsRef.current),
                            signal: controller.signal,
                            onDelta: (text) => {
                                streamed = text;
                                // 配置节点结果写在子文本节点上，流式时也要更新，避免一直停在「生成中」
                                setNodes((prev) =>
                                    prev.map((node) =>
                                        textTargetIds.includes(node.id) ? { ...node, type: CanvasNodeType.Text, metadata: { ...node.metadata, content: text, status: NODE_STATUS_LOADING } } : node,
                                    ),
                                );
                            },
                        });
                        streamed = content || streamed;
                        answers = textTargetIds.map((targetNodeId) => ({ nodeId: targetNodeId, content: streamed }));
                    } finally {
                        textTargetIds.forEach((targetNodeId) => finishGenerationRequest(targetNodeId, controller));
                    }
                } else {
                    answers = await Promise.all(
                        textTargetIds.map((targetNodeId) => {
                            let localStreamed = "";
                            return requestImageQuestion(
                                generationConfig,
                                buildNodeResponseMessages({ ...generationContext, prompt: effectivePrompt }),
                                (text) => {
                                    localStreamed = text;
                                    streamed = text;
                                    setNodes((prev) => prev.map((node) => (node.id === targetNodeId ? { ...node, type: CanvasNodeType.Text, metadata: { ...node.metadata, content: text, status: NODE_STATUS_LOADING } } : node)));
                                },
                                { signal: controller.signal },
                            )
                                .then((answer) => ({ nodeId: targetNodeId, content: answer || localStreamed }))
                                .finally(() => finishGenerationRequest(targetNodeId, controller));
                        }),
                    );
                }
                if (controller.signal.aborted) {
                    // 已有结果时仍写回，避免停止竞态把成功内容丢掉、节点永久生成中
                    if (!streamed.trim() && !answers.some((item) => item.content?.trim())) return;
                }
                const answerByNodeId = new Map(answers.map((item) => [item.nodeId, item.content]));
                setNodes((prev) =>
                    prev.map((node) =>
                        childIds.includes(node.id)
                            ? { ...node, metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || streamed, status: NODE_STATUS_SUCCESS } }
                            : node.id === nodeId && isConfigNode
                              ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } }
                              : node.id === nodeId && !editingTextNode
                                ? {
                                      ...node,
                                      type: CanvasNodeType.Text,
                                      title: prompt.slice(0, 32) || "Generated Text",
                                      metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || streamed, model: generationConfig.model, reasoningEffort: generationConfig.reasoningEffort, status: NODE_STATUS_SUCCESS },
                                  }
                                : node,
                    ),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) {
                    settleLoadingChildren(pendingChildIds, NODE_STATUS_IDLE);
                    return;
                }
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((node) => (node.id === nodeId || pendingChildIds.includes(node.id) ? (node.id === nodeId && !markSourceStatus ? node : { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } }) : node)),
                );
            } finally {
                finishRun();
                setRunningNodeId((current) => {
                    if (current !== nodeId) return current;
                    return hasRunningFor(nodeId) ? nodeId : null;
                });
            }
        },
        [effectiveConfig, claimResultColumnAnchor, createGenerationScope, ensureResultStackCursor, isAiConfigReady, message, openConfigDialog, projectId, t],
    );
    useEffect(() => {
        generateNodeRef.current = handleGenerateNode;
    }, [handleGenerateNode]);

    const handleRetryNode = useCallback(
        async (node: CanvasNodeData, imageId?: string) => {
            const generationScope = createGenerationScope();
            const nodesRef = generationScope.nodesRef;
            const connectionsRef = generationScope.connectionsRef;
            const setNodes = generationScope.setNodes;
            const setRunningNodeId = generationScope.setRunningNodeId;
            const startGenerationRequest = generationScope.startGenerationRequest;
            const finishGenerationRequest = generationScope.finishGenerationRequest;
            const sourceNode = findRetrySourceNode(node.id, nodesRef.current, connectionsRef.current) || node;
            const savedImageMetadata = node.type === CanvasNodeType.Image ? node.metadata : undefined;
            const hasSavedImageMetadata = Boolean(savedImageMetadata?.generationType);
            const generationConfig =
                hasSavedImageMetadata && savedImageMetadata
                    ? {
                          ...effectiveConfig,
                          model: savedImageMetadata.model || effectiveConfig.imageModel || effectiveConfig.model,
                          quality: savedImageMetadata.quality || effectiveConfig.quality,
                          size: savedImageMetadata.size || effectiveConfig.size,
                          background: savedImageMetadata.background ?? effectiveConfig.background,
                          count: "1",
                      }
                    : { ...buildGenerationConfig(effectiveConfig, sourceNode, node.type === CanvasNodeType.Text ? "text" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image"), count: "1" };
            const retryCapability = node.type === CanvasNodeType.Audio ? "audio" : node.type === MODEL_NODE_TYPE ? "model" : undefined;
            const blockedGeneration = closedGenerationError(generationConfig.model, retryCapability);
            if (blockedGeneration) {
                message.warning(blockedGeneration.message);
                return;
            }
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                message.warning(t("canvas.projectPage.configRequired"));
                openConfigDialog(true);
                return;
            }

            const context = hasSavedImageMetadata ? null : await hydrateNodeGenerationContext(buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, sourceNode.metadata?.prompt || node.metadata?.prompt || ""));
            const prompt = (savedImageMetadata?.prompt || context?.prompt || "").trim();
            if (!prompt) {
                message.warning(t("canvas.projectPage.retryPromptMissing"));
                return;
            }
            const generationType = savedImageMetadata?.generationType;
            const useReferenceImages = generationType ? generationType === "edit" : Boolean(context?.referenceImages.length);
            const retryReferenceImages =
                hasSavedImageMetadata && savedImageMetadata ? await resolveMetadataReferences(savedImageMetadata) : useReferenceImages ? (context?.referenceImages.length ? context.referenceImages : sourceNodeReferenceImages(sourceNode)) : [];
            if (useReferenceImages && !retryReferenceImages) {
                message.error(t("canvas.projectPage.referenceMissing"));
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: item.metadata?.content ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: item.metadata?.content ? undefined : t("canvas.projectPage.referenceMissing"), images: item.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_ERROR, errorDetails: t("canvas.projectPage.referenceMissing") } : image)) } } : item)));
                return;
            }
            const retryImages = retryReferenceImages || [];

            setRunningNodeId(node.id);
            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined, images: item.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_LOADING, errorDetails: undefined } : image)) } } : item)));
            const controller = startGenerationRequest(node.id, sourceNode.id, node.id);

            try {
                if (node.type === CanvasNodeType.Text) {
                    if (!context) return;
                    const lyricsModel = node.metadata?.model || generationConfig.model;
                    if (isRunninghubLyricsConfig({ ...generationConfig, model: lyricsModel })) {
                        const content = await requestLyricsGeneration({ ...generationConfig, model: lyricsModel }, prompt, { signal: controller.signal });
                        setNodes((prev) =>
                            prev.map((item) =>
                                item.id === node.id
                                    ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content, prompt, status: NODE_STATUS_SUCCESS, fontSize: 14, model: lyricsModel } }
                                    : item,
                            ),
                        );
                        return;
                    }
                    let streamed = "";
                    const answer = isCodexCliTextModel(generationConfig.model)
                        ? await requestCodexCliText({
                              sourceNodeId: node.id,
                              prompt,
                              referenceImages: context.referenceImages,
                              skills: (() => {
                                  const own = collectUpstreamCodexSkillsFromGraph(node.id, nodesRef.current, connectionsRef.current);
                                  return own.length ? own : collectUpstreamCodexSkillsFromGraph(sourceNode.id, nodesRef.current, connectionsRef.current);
                              })(),
                              signal: controller.signal,
                              onDelta: (text) => {
                                  streamed = text;
                                  setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: text, status: NODE_STATUS_LOADING } } : item)));
                              },
                          })
                        : await requestImageQuestion(
                              generationConfig,
                              buildNodeResponseMessages({ ...context, prompt }),
                              (text) => {
                                  streamed = text;
                                  setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: text, status: NODE_STATUS_LOADING } } : item)));
                              },
                              { signal: controller.signal },
                          );
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: answer || streamed, prompt, status: NODE_STATUS_SUCCESS } } : item)));
                    return;
                }
                if (node.type === CanvasNodeType.Video) {
                    const video = await storeGeneratedVideo(await requestVideoGeneration(generationConfig, prompt, retryImages, context?.referenceVideos || [], context?.referenceAudios || [], { signal: controller.signal }));
                    const videoSize = fitNodeSize(video.width || node.width, video.height || node.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) =>
                        prev.map((item) =>
                            item.id === node.id
                                ? {
                                      ...item,
                                      width: videoSize.width,
                                      height: videoSize.height,
                                      position: { x: item.position.x + item.width / 2 - videoSize.width / 2, y: item.position.y + item.height / 2 - videoSize.height / 2 },
                                      metadata: {
                                          ...item.metadata,
                                          ...videoMetadata(video),
                                          prompt,
                                          model: generationConfig.model,
                                          size: generationConfig.size,
                                          seconds: generationConfig.videoSeconds,
                                          vquality: generationConfig.vquality,
                                          generateAudio: generationConfig.videoGenerateAudio,
                                          watermark: generationConfig.videoWatermark,
                                          realPersonMode: generationConfig.videoRealPersonMode,
                                          videoReferenceMode: generationConfig.videoReferenceMode,
                                      },
                                  }
                                : item,
                        ),
                    );
                    return;
                }
                if (node.type === CanvasNodeType.Audio) {
                    const audio = await storeGeneratedAudio(await requestAudioGeneration(generationConfig, prompt, context?.referenceAudios || [], { signal: controller.signal }), generationConfig.audioFormat);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, ...audioMetadata(audio), prompt, ...buildAudioGenerationMetadata(generationConfig), clipStartMs: undefined, clipEndMs: undefined } } : item)));
                    return;
                }

                const image = useReferenceImages
                    ? await requestEdit(generationConfig, prompt, retryImages, undefined, { signal: controller.signal }).then((items) => items[0])
                    : await requestGeneration(generationConfig, prompt, { signal: controller.signal }).then((items) => items[0]);
                const uploadedImage = await uploadImage(image.dataUrl);
                const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                const retryImage: CanvasNodeImage = {
                    id: imageId || node.metadata?.primaryImageId || nanoid(),
                    status: NODE_STATUS_SUCCESS,
                    content: uploadedImage.url,
                    storageKey: uploadedImage.storageKey,
                    naturalWidth: uploadedImage.width,
                    naturalHeight: uploadedImage.height,
                    bytes: uploadedImage.bytes,
                    mimeType: uploadedImage.mimeType,
                };
                const generationMetadata = savedImageMetadata?.generationType
                    ? {
                          generationType: savedImageMetadata.generationType,
                          model: generationConfig.model,
                          size: generationConfig.size,
                          quality: generationConfig.quality,
                          ...(generationConfig.background ? { background: generationConfig.background } : {}),
                          count: savedImageMetadata.count || 1,
                          references: savedImageMetadata.references,
                      }
                    : buildImageGenerationMetadata(useReferenceImages ? "edit" : "generation", generationConfig, 1, retryImages);
                setNodes((prev) =>
                    prev.map((item) => {
                        if (item.id !== node.id) return item;
                        const makePrimary = !imageId || !item.metadata?.content;
                        const edge = imageId ? Math.max(item.width, item.height) : 0;
                        const imageSize = imageId && item.metadata?.freeResize ? { width: item.width, height: item.height } : imageId ? fitNodeSize(uploadedImage.width, uploadedImage.height, edge, edge) : fitNodeSize(uploadedImage.width, uploadedImage.height, imageConfig.width, imageConfig.height);
                        return {
                            ...item,
                            type: CanvasNodeType.Image,
                            ...(makePrimary ? { width: imageSize.width, height: imageSize.height, ...(imageId ? { position: { x: item.position.x + item.width / 2 - imageSize.width / 2, y: item.position.y + item.height / 2 - imageSize.height / 2 } } : {}) } : {}),
                            metadata: {
                                ...item.metadata,
                                ...(makePrimary ? imageMetadata(uploadedImage) : { status: NODE_STATUS_SUCCESS }),
                                images: item.metadata?.images?.map((current) => (current.id === retryImage.id ? retryImage : current)),
                                primaryImageId: makePrimary ? retryImage.id : item.metadata?.primaryImageId,
                                prompt,
                                ...generationMetadata,
                            },
                        };
                    }),
                );
            } catch (error) {
                if (isGenerationCanceled(error)) return;
                const errorDetails = error instanceof Error ? error.message : t("canvas.projectPage.generationFailed");
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: item.metadata?.content ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: item.metadata?.content ? undefined : errorDetails, images: item.metadata?.images?.map((image) => (image.id === imageId ? { ...image, status: NODE_STATUS_ERROR, errorDetails } : image)) } } : item)));
            } finally {
                finishGenerationRequest(node.id, controller);
                setRunningNodeId(null);
            }
        },
        [effectiveConfig, createGenerationScope, isAiConfigReady, message, openConfigDialog, projectId, t],
    );

    const deleteBatchImage = useCallback((nodeId: string, imageId: string) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        if ((node?.metadata?.images?.length || 0) <= 2) {
            setExpandedImageNodeIds((current) => {
                if (!current.has(nodeId)) return current;
                const next = new Set(current);
                next.delete(nodeId);
                return next;
            });
        }
        setNodes((prev) =>
            prev.map((item) => {
                if (item.id !== nodeId) return item;
                const images = item.metadata?.images?.filter((image) => image.id !== imageId) || [];
                return { ...item, metadata: { ...item.metadata, images, count: images.length, primaryImageId: item.metadata?.primaryImageId === imageId ? images[0]?.id : item.metadata?.primaryImageId } };
            }),
        );
    }, []);

    const retryBatchImage = useCallback((node: CanvasNodeData, imageId: string) => void handleRetryNode(node, imageId), [handleRetryNode]);

    const generateImageFromTextNode = useCallback(
        (node: CanvasNodeData) => {
            const prompt = (node.metadata?.content || node.metadata?.prompt || "").trim();
            if (!prompt) {
                message.warning(t("canvas.projectPage.emptyTextImage"));
                return;
            }
            const sourceNode = nodesRef.current.find((item) => item.id === node.id);
            if (!sourceNode) return;
            const nodeSize = getNodeSpec(CanvasNodeType.Config);
            const configNode = createCanvasNode(
                CanvasNodeType.Config,
                {
                    x: sourceNode.position.x + sourceNode.width + 96 + nodeSize.width / 2,
                    y: sourceNode.position.y + sourceNode.height / 2,
                },
                {
                    prompt: "",
                    model: effectiveConfig.imageModel || effectiveConfig.model,
                    size: effectiveConfig.size,
                    count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                },
            );
            const connection = { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: configNode.id };
            const nextNodes = nodesRef.current.map((item) => (item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS } } : item)).concat(configNode);
            const nextConnections = [...connectionsRef.current, connection];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message, t],
    );

    const toggleExcelSheetDetail = useCallback((nodeId: string, expanded: boolean) => {
        setNodes((prev) =>
            prev.map((item) => {
                if (item.id !== nodeId || !item.metadata?.excelParentId) return item;
                return {
                    ...item,
                    width: expanded ? 1100 : 420,
                    height: expanded ? 720 : 280,
                };
            }),
        );
    }, []);

    const toggleExcelSheetNodes = useCallback((node: CanvasNodeData) => {
        const sourceNode = nodesRef.current.find((item) => item.id === node.id);
        const sheets = sourceNode?.metadata?.excelSheets || [];
        if (!sourceNode || sourceNode.metadata?.documentKind !== "excel" || !sheets.length) return;

        const existingIds = (sourceNode.metadata.excelSheetNodeIds || []).filter((id) => nodesRef.current.some((item) => item.id === id));
        if (existingIds.length) {
            const remove = new Set(existingIds);
            const nextNodes = nodesRef.current
                .filter((item) => !remove.has(item.id))
                .map((item) => (item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, excelSheetNodeIds: undefined } } : item));
            const nextConnections = connectionsRef.current.filter((item) => !remove.has(item.fromNodeId) && !remove.has(item.toNodeId));
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([sourceNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(sourceNode.id);
            return;
        }

        const gap = 96;
        const sheetGap = 48;
        const sheetWidth = 420;
        const sheetHeight = 280;
        const startX = sourceNode.position.x + sourceNode.width + gap + sheetWidth / 2;
        if (!getExcelSheet(sourceNode.id, 0) && sheets.some((sheet) => sheet.preview?.length)) {
            stashExcelSheets(sourceNode.id, sheets);
        }

        const sheetNodes = sheets.map((sheet, index) => {
            const cached = getExcelSheet(sourceNode.id, index);
            const parentPreview = sheet.preview || [];
            const cachedPreview = cached?.preview || [];
            const preview = excelPreviewWithImages(cachedPreview, parentPreview);
            const centerY = sourceNode.position.y + sheetHeight / 2 + index * (sheetHeight + sheetGap);
            const created = createCanvasNode(
                CanvasNodeType.Text,
                { x: startX, y: centerY },
                {
                    content: sheet.content || cached?.content || "",
                    status: NODE_STATUS_SUCCESS,
                    fontSize: 14,
                    excelParentId: sourceNode.id,
                    excelPreview: preview,
                    excelRowCount: sheet.rowCount || cached?.rowCount || 0,
                    excelColCount: sheet.colCount || cached?.colCount || 0,
                    excelColWidths: sheet.colWidths || cached?.colWidths,
                    excelRowHeights: sheet.rowHeights || cached?.rowHeights,
                    excelMerges: sheet.merges || cached?.merges,
                    excelStyles: sheet.styles || cached?.styles,
                },
            );
            return {
                ...created,
                title: sheet.name.slice(0, 48) || t("canvas.node.excelTitle"),
                width: sheetWidth,
                height: sheetHeight,
                position: { x: startX - sheetWidth / 2, y: centerY - sheetHeight / 2 },
            };
        });
        const sheetIds = sheetNodes.map((item) => item.id);
        const sheetConnections = sheetNodes.map((item) => ({ id: nanoid(), fromNodeId: sourceNode.id, toNodeId: item.id }));
        const nextNodes = nodesRef.current
            .map((item) => (item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, excelSheetNodeIds: sheetIds } } : item))
            .concat(sheetNodes);
        const nextConnections = [...connectionsRef.current, ...sheetConnections];
        nodesRef.current = nextNodes;
        connectionsRef.current = nextConnections;
        setNodes(nextNodes);
        setConnections(nextConnections);
        setSelectedNodeIds(new Set(sheetIds));
        setSelectedConnectionId(null);
        setDialogNodeId(null);
    }, [t]);

    const getDefaultInsertCenter = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        return screenToCanvas((rect?.left || 0) + size.width / 2, (rect?.top || 0) + size.height / 2);
    }, [screenToCanvas, size.height, size.width]);

    const insertAssistantImage = useCallback(
        async (image: CanvasAssistantImage, at?: { x: number; y: number }) => {
            const { setNodes, isActive } = createGenerationScope();
            const center = at || getDefaultInsertCenter();
            const resolvedUrl = image.storageKey ? await resolveImageUrl(image.storageKey, image.dataUrl || "") : image.dataUrl || "";
            if (!resolvedUrl) {
                message.error(t("canvas.sidePanel.insertImageFailed"));
                return;
            }
            const storedImage = image.storageKey ? { url: resolvedUrl, storageKey: image.storageKey, width: 1, height: 1, bytes: 0, mimeType: "image/png" } : await uploadImage(resolvedUrl);
            const meta = storedImage.width === 1 && storedImage.height === 1 ? await readImageMeta(storedImage.url) : storedImage;
            const config = fitNodeSize(meta.width, meta.height);
            const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const node: CanvasNodeData = {
                id,
                type: CanvasNodeType.Image,
                title: image.prompt.slice(0, 32) || "Generated Image",
                position: { x: center.x - config.width / 2, y: center.y - config.height / 2 },
                width: config.width,
                height: config.height,
                metadata: { ...imageMetadata({ ...storedImage, width: meta.width, height: meta.height }), prompt: image.prompt },
            };

            setNodes((prev) => [...prev, node]);
            if (isActive()) setSelectedNodeIds(new Set([id]));
            if (isActive()) setSelectedConnectionId(null);
            if (isActive()) setDialogNodeId(id);
        },
        [createGenerationScope, getDefaultInsertCenter, message, t],
    );

    const insertAssistantText = useCallback(
        (text: string, title?: string, at?: { x: number; y: number }) => {
            const { setNodes, isActive } = createGenerationScope();
            const center = at || getDefaultInsertCenter();
            const node = {
                ...createCanvasNode(CanvasNodeType.Text, center, { content: text, status: NODE_STATUS_SUCCESS }),
                title: title || text.slice(0, 32) || "Assistant Text",
            };

            setNodes((prev) => [...prev, node]);
            if (isActive()) setSelectedNodeIds(new Set([node.id]));
            if (isActive()) setSelectedConnectionId(null);
        },
        [createGenerationScope, getDefaultInsertCenter],
    );

    const handleAssetInsert = useCallback(
        (payload: InsertAssetPayload, at?: { x: number; y: number }) => {
            const { setNodes, setConnections, isActive } = createGenerationScope();
            if (payload.kind === "text") {
                insertAssistantText(payload.content, payload.title, at);
            } else if (payload.kind === "promptAsset") {
                const center = at || getDefaultInsertCenter();
                const built = buildPromptAssetCanvasNodes(payload, center);
                if (!built.nodes.length) {
                    insertAssistantText(payload.prompt, payload.title, at);
                } else {
                    setNodes((prev) => [...prev, ...built.nodes]);
                    if (built.connections.length) setConnections((prev) => [...prev, ...built.connections]);
                    if (isActive()) setSelectedNodeIds(new Set(built.nodes.map((node) => node.id)));
                    if (isActive()) setSelectedConnectionId(null);
                }
            } else if (payload.kind === "folder") {
                const asset = useAssetStore.getState().assets.find((item) => item.id === payload.assetId);
                if (!asset || asset.kind !== "folder") {
                    message.warning(t("canvas.sidePanel.folderMissing"));
                    return;
                }
                const center = at || getDefaultInsertCenter();
                void buildFolderNodeOpFromAsset(asset, center).then((op) => {
                    applyAgentOps([op]);
                    if (isActive() && op.id) setSelectedNodeIds(new Set([op.id]));
                    message.success(t("canvas.folderNode.dropped", { name: asset.data.folderName || asset.title }));
                });
            } else if (payload.kind === "video") {
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                const center = at || getDefaultInsertCenter();
                const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const nextSize = fitNodeSize(payload.width || spec.width, payload.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                setNodes((prev) => [
                    ...prev,
                    {
                        id,
                        type: CanvasNodeType.Video,
                        title: payload.title,
                        position: { x: center.x - nextSize.width / 2, y: center.y - nextSize.height / 2 },
                        width: nextSize.width,
                        height: nextSize.height,
                        metadata: { content: payload.url, storageKey: payload.storageKey, status: NODE_STATUS_SUCCESS, naturalWidth: payload.width, naturalHeight: payload.height },
                    },
                ]);
                if (isActive()) setSelectedNodeIds(new Set([id]));
            } else {
                void insertAssistantImage({ id: `asset-${Date.now()}`, prompt: payload.title, dataUrl: payload.dataUrl, storageKey: payload.storageKey }, at);
            }
            if (isActive()) setAssetPickerOpen(false);
        },
        [createGenerationScope, applyAgentOps, getDefaultInsertCenter, insertAssistantImage, insertAssistantText, message, t],
    );
    handleAssetInsertRef.current = handleAssetInsert;
    // Memoize every callback and render function passed to CanvasNode.
    // CanvasNode uses React.memo, but new prop references would invalidate it on every render and rerender every node
    // during click, hover, or viewport changes, which is especially expensive for Markdown. These useCallback values
    // and their memoized map/handler dependencies remain stable during interaction, so unchanged nodes do not rerender.
    const handleNodeHoverStart = useCallback((nodeId: string) => {
        if (nodeDraggingRef.current) return;
        setHoveredNodeId(nodeId);
    }, []);
    const handleNodeHoverEnd = useCallback((nodeId: string) => {
        setHoveredNodeId((current) => (current === nodeId ? null : current));
    }, []);
    const handleNodeViewImage = useCallback((node: CanvasNodeData) => setPreviewNodeId(node.id), []);
    const handleNodeRetry = useCallback((node: CanvasNodeData) => void handleRetryNode(node), [handleRetryNode]);
    const handleNodeContextMenu = useCallback((event: ReactMouseEvent, nodeId: string) => {
        event.preventDefault();
        event.stopPropagation();
        if (suppressDragContextMenuRef.current) return;
        setContextMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId });
    }, []);

    const renderNodePanel = useCallback(
        (panelNode: CanvasNodeData) =>
            getNodeDefinition(panelNode.type)?.Panel ? (
                renderPluginPanel(panelNode)
            ) : panelNode.type === CanvasNodeType.Config ? (
                <CanvasConfigComposer
                    value={panelNode.metadata?.composerContent ?? panelNode.metadata?.prompt ?? ""}
                    inputs={configInputsById.get(panelNode.id) || []}
                    onChange={(composerContent) => handleConfigNodeChange(panelNode.id, { composerContent })}
                    onClose={() => setDialogNodeId(null)}
                />
            ) : (
                <CanvasNodePromptPanel
                    node={panelNode}
                    isRunning={runningNodeId === panelNode.id}
                    hasGeneratedResults={connections.some((connection) => connection.fromNodeId === panelNode.id)}
                    mentionReferences={mentionReferencesByNodeId.get(panelNode.id) || EMPTY_REFERENCES}
                    onPromptChange={handleNodePromptChange}
                    onConfigChange={handleConfigNodeChange}
                    onGenerate={handleGenerateNode}
                    onStop={confirmStopGeneration}
                    modeOverride={getNodeDefinition(panelNode.type)?.useBuiltinPanel?.mode}
                    onImageSettingsOpenChange={(open) => {
                        setNodeImageSettingsOpen(open);
                        if (open) setToolbarNodeId(null);
                    }}
                />
            ),
        [configInputsById, confirmStopGeneration, connections, handleConfigNodeChange, handleGenerateNode, handleNodePromptChange, mentionReferencesByNodeId, renderPluginPanel, runningNodeId],
    );

    const renderNodeContentPanel = useCallback(
        (contentNode: CanvasNodeData) => {
            const inputs = configInputsById.get(contentNode.id) || [];
            const localEditReference = inputs
                .map((input) => (input.type === "image" ? nodesRef.current.find((item) => item.id === input.nodeId) : null))
                .find((item) => item?.metadata?.localEditPreprocess);
            const localEditAspectRatio =
                localEditReference?.metadata?.size || localEditReference?.metadata?.modelParams?.aspectRatio || localEditReference?.metadata?.localEditChosenRatio || "1:1";
            const activeRunCount = countWorkbenchRuns(listCanvasGenerationRequests(), projectId, contentNode.id);
            return (
                <CanvasConfigNodePanel
                    node={contentNode}
                    isRunning={activeRunCount > 0}
                    activeRunCount={activeRunCount}
                    composerOpen={dialogNodeId === contentNode.id}
                    hasGeneratedResults={connections.some(connection => {
                        if (connection.fromNodeId !== contentNode.id || connection.kind) return false;
                        const result = nodesRef.current.find(node => node.id === connection.toNodeId);
                        return Boolean(result?.metadata?.content || result?.metadata?.images?.some(image => image.content));
                    })}
                    inputSummary={getInputSummary(inputs)}
                    referenceImages={getImageSettingsReferenceOptions(inputs)}
                    hasLocalEditReference={Boolean(localEditReference)}
                    localEditAspectRatio={localEditAspectRatio}
                    onConfigChange={handleConfigNodeChange}
                    onComposerToggle={() => setDialogNodeId((current) => (current === contentNode.id ? null : contentNode.id))}
                    onStop={confirmStopGeneration}
                    onGenerate={(nodeId) => {
                        const target = nodesRef.current.find((item) => item.id === nodeId);
                        void handleGenerateNode(nodeId, target?.metadata?.generationMode || "image", target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                    }}
                />
            );
        },
        [configInputsById, confirmStopGeneration, connections, dialogNodeId, handleConfigNodeChange, handleGenerateNode, projectId, runningNodeId],
    );

    if (!projectLoaded) return <CanvasRefreshShell error={projectLoadError || storageReadError} onRetry={() => {
        if (storageReadError) void useCanvasStore.persist.rehydrate();
        else setProjectLoadAttempt((attempt) => attempt + 1);
    }} />;

    return (
        <main className="relative h-full min-h-0 overflow-hidden" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <CanvasTopBar
                title={canvasTitle}
                titleDraft={titleDraft}
                isTitleEditing={titleEditing}
                onTitleDraftChange={setTitleDraft}
                onStartTitleEditing={startTitleEditing}
                onFinishTitleEditing={finishTitleEditing}
                onCancelTitleEditing={() => setTitleEditing(false)}
                canUndo={roomActive ? false : historyState.canUndo}
                canRedo={roomActive ? false : historyState.canRedo}
                onHome={() => navigate("/")}
                onProjects={() => navigate("/canvas")}
                onCreateProject={createAndOpenProject}
                onDeleteProject={deleteCurrentProject}
                onExportProject={exportCurrentProject}
                onImportImage={() => handleUploadRequest()}
                onUndo={undoCanvas}
                onRedo={redoCanvas}
                agentOpen={agentPanelOpen}
                compactAgentStatus={{ connected: localAgentConnected, enabled: localAgentEnabled, activity: localAgentActivity }}
                onToggleAgent={toggleAgentPanel}
                elevated={Boolean(modelAngleExport)}
                sharing={isHost && roomActive}
                onlineCount={onlineCount}
                onShare={() => setShareModalOpen(true)}
                showImportRoomCopy={isGuest && roomActive}
                onImportRoomCopy={importRoomCopy}
            />
            <CanvasShareModal
                open={shareModalOpen}
                sharing={isHost && roomActive}
                shareUrls={shareUrls}
                sharePath={sharePath}
                onlineCount={onlineCount}
                onClose={() => setShareModalOpen(false)}
                onStart={startShare}
                onStop={stopShare}
            />
            {isGuest && roomActive ? (
                <div
                    className={`pointer-events-auto absolute left-1/2 top-16 z-[1200] flex -translate-x-1/2 items-center gap-3 rounded-xl border px-4 py-2 text-sm shadow-sm ${
                        roomReadOnly
                            ? "border-amber-200/80 bg-amber-50/95 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/90 dark:text-amber-100"
                            : "border-stone-200/80 bg-white/95 text-stone-700 dark:border-stone-700/50 dark:bg-stone-900/90 dark:text-stone-200"
                    }`}
                >
                    <span>{roomReadOnly ? t("canvas.roomShare.hostClosed") : t("canvas.roomShare.guestSaveHint")}</span>
                    <Button size="small" type="primary" onClick={importRoomCopy}>
                        {t("canvas.roomShare.importCopy")}
                    </Button>
                </div>
            ) : null}
            <section className="absolute inset-0 overflow-hidden">
                <InfiniteCanvas
                    containerRef={containerRef}
                    viewportApiRef={canvasViewportApiRef}
                    viewport={viewport}
                    tool={canvasTool}
                    backgroundMode={backgroundMode}
                    onViewportLive={handleViewportLive}
                    onViewportChange={handleViewportChange}
                    onCanvasMouseDown={handleCanvasMouseDown}
                    onCanvasDeselect={deselectCanvas}
                    onTouchGestureStart={cancelTouchCanvasInteraction}
                    onCanvasDoubleClick={(event) => {
                        setContextMenu(null);
                        setPendingConnectionCreate(null);
                        const world = screenToCanvas(event.clientX, event.clientY);
                        const hitConnection = hitTestConnectionAt(world.x, world.y, connectionHitItemsRef.current);
                        if (hitConnection) {
                            beginEditConnectionLabel(hitConnection);
                            return;
                        }
                        setNodeCreatePosition(world);
                    }}
                    onContextMenu={preventCanvasContextMenu}
                    onDrop={handleDrop}
                    overlay={
                        <>
                            <CanvasConnectionsLayer
                                size={size}
                                viewport={viewport}
                                viewportRef={viewportRef}
                                repaintRef={overlayRepaintRef}
                                nodesRef={nodesRef}
                                connections={visibleConnections}
                                nodeById={geometryNodeById}
                                selectedConnectionId={selectedConnectionId}
                                relatedConnectionIds={relatedConnectionIds}
                                editingLabelConnectionId={editingConnectionLabelId}
                                connectingParams={connectingParams}
                                connectingNode={connectingParams ? nodeById.get(connectingParams.nodeId) : undefined}
                                mouseWorld={mouseWorld}
                                connectionTargetNode={connectionTargetNodeId ? nodeById.get(connectionTargetNodeId) : undefined}
                            />
                        </>
                    }
                >
                    <CanvasNodesLayer
                        key={projectId}
                        ref={nodesLayerRef}
                        nodes={nodes}
                        viewport={viewport}
                        size={size}
                        expandedImageNodeIds={expandedImageNodeIds}
                        hiddenNodeIds={mindHiddenIds}
                        panelNodeId={dialogNodeId}
                        isNodeDragging={isNodeDragging}
                        dragRef={dragRef}
                        ready={projectLoaded && loadedProjectIdRef.current === projectId}
                        renderNode={(node, lodVisual, keepContentActive, deferContent) => (
                            <CanvasNode
                                data={node}
                                scale={viewport.k}
                                viewportScale={viewport.k}
                                viewportScaleRef={viewportRef}
                                contentLod={lodVisual.contentLod}
                                keepContentActive={keepContentActive}
                                deferContent={deferContent}
                                lodShellOpacity={lodVisual.shellOpacity}
                                lodFullOpacity={lodVisual.fullOpacity}
                                showLodMedia={lodVisual.showLodMedia}
                                stackZIndex={nodeStackOrder.get(node.id) || 0}
                                isConnecting={connectingParams?.nodeId === node.id || connectionTargetNodeId === node.id}
                                editRequestNonce={editingNodeId === node.id ? editRequestNonce : 0}
                                showPanel={
                                    !selectionBox &&
                                    (node.type === CanvasNodeType.Video
                                        ? selectedNodeIds.size === 1 && selectedNodeIds.has(node.id)
                                        : !getNodeDefinition(node.type)?.hidePanel && dialogNodeId === node.id)
                                }
                                groupChildCount={groupChildCountById.get(node.id) || 0}
                                dataGroupActive={node.type === CanvasNodeType.Group && isDataGroup(node, nodes)}
                                isGroupDropTarget={dropTargetGroupId === node.id}
                                batchExpanded={expandedImageNodeIds.has(node.id)}
                                showImageInfo={showImageInfo}
                                mentionReferences={mentionReferencesByNodeId.get(node.id) || EMPTY_REFERENCES}
                                pluginHost={pluginHost}
                                registryVersion={nodeRegistryVersion}
                                renderPanel={renderNodePanel}
                                renderNodeContent={renderNodeContentPanel}
                                onMouseDown={handleNodeMouseDown}
                                onSelectCapture={handleNodeSelectCapture}
                                onHoverStart={handleNodeHoverStart}
                                onHoverEnd={handleNodeHoverEnd}
                                onConnectStart={handleConnectStart}
                                onToggleMindCollapse={handleToggleMindCollapse}
                                onResizeStart={handleNodeResizeStart}
                                onResize={handleNodeResize}
                                onResizeEnd={handleNodeResizeEnd}
                                onResizeGuides={setAlignGuides}
                                getPreferredAlignTargetId={getPreferredAlignTargetId}
                                onContentChange={handleNodeContentChange}
                                onTitleChange={handleNodeTitleChange}
                                onToggleBatch={toggleBatchExpanded}
                                onSetBatchPrimary={setBatchPrimary}
                                onDuplicateBatchImage={duplicateBatchImage}
                                onDownloadBatchImage={downloadBatchImage}
                                onRetryBatchImage={retryBatchImage}
                                onDeleteBatchImage={deleteBatchImage}
                                onRetry={handleNodeRetry}
                                onGenerateImage={generateImageFromTextNode}
                                onExpandExcelSheets={toggleExcelSheetNodes}
                                excelSheetsExpanded={Boolean(node.metadata?.excelSheetNodeIds?.some((id) => nodeById.has(id)))}
                                onToggleExcelSheetDetail={toggleExcelSheetDetail}
                                onViewImage={handleNodeViewImage}
                                onToggleLocalEditView={toggleLocalEditView}
                                onVideoClipChange={handleVideoClipChange}
                                onAudioClipChange={handleAudioClipChange}
                                onCaptureVideoFrame={captureVideoFrameToNode}
                                onContextMenu={handleNodeContextMenu}
                            />
                        )}
                    />

                    <CanvasAlignGuides ref={alignGuidesRef} zoom={viewport.k} />
                    {selectionBox ? (
                        <svg
                            className="pointer-events-none absolute z-[100] overflow-visible"
                            style={{
                                left: Math.min(selectionBox.startWorldX, selectionBox.currentWorldX),
                                top: Math.min(selectionBox.startWorldY, selectionBox.currentWorldY),
                                width: Math.abs(selectionBox.currentWorldX - selectionBox.startWorldX),
                                height: Math.abs(selectionBox.currentWorldY - selectionBox.startWorldY),
                            }}
                        >
                            <rect width="100%" height="100%" fill={theme.canvas.selectionFill} stroke={theme.canvas.selectionStroke} strokeOpacity={0.55} strokeWidth={1 / viewport.k} strokeDasharray={`${6 / viewport.k} ${4 / viewport.k}`} />
                        </svg>
                    ) : null}
                    {pendingConnectionCreate ? (
                        <ConnectionCreateMenu
                            pending={pendingConnectionCreate}
                            mode={
                                mindMapMode || isMindNode(nodeById.get(pendingConnectionCreate.connection.nodeId))
                                    ? "mind"
                                    : "default"
                            }
                            onCreate={(type) => createConnectedNode(type, pendingConnectionCreate)}
                            onClose={cancelPendingConnectionCreate}
                            onMenuSize={(size) => {
                                setPendingConnectionCreate((prev) => {
                                    if (!prev) return prev;
                                    const nextPos = connectionCreateMenuPositionFromAttach(prev.attachPoint, prev.connection.side, size);
                                    if (Math.abs(nextPos.x - prev.position.x) < 0.5 && Math.abs(nextPos.y - prev.position.y) < 0.5) return prev;
                                    return { ...prev, position: nextPos };
                                });
                            }}
                        />
                    ) : null}
                    {nodeCreatePosition ? (
                        <NodeCreateMenu
                            position={nodeCreatePosition}
                            mode={mindMapMode ? "mind" : "default"}
                            onCreate={(type) => {
                                if (isMindCreateType(type)) createMindFromMenu(type, nodeCreatePosition);
                                else createNode(type, nodeCreatePosition);
                                setNodeCreatePosition(null);
                            }}
                            onClose={() => setNodeCreatePosition(null)}
                        />
                    ) : null}
                </InfiniteCanvas>

                {editingConnectionLabelId
                    ? (() => {
                          const connection = connections.find((item) => item.id === editingConnectionLabelId);
                          const from = connection ? nodeById.get(connection.fromNodeId) : undefined;
                          const to = connection ? nodeById.get(connection.toNodeId) : undefined;
                          if (!connection || !from || !to) return null;
                          const mid = connectionLabelWorld(
                              getConnectionEndpoints(
                                  from,
                                  to,
                                  resolveConnectionKind(connection, from, to),
                                  connection,
                                  nodeById,
                                  connections,
                                  { connectionId: connection.id },
                              ),
                          );
                          return (
                              <CanvasConnectionLabelEditor
                                  world={mid}
                                  viewport={viewport}
                                  value={connectionLabelDraft}
                                  onChange={setConnectionLabelDraft}
                                  onCommit={commitConnectionLabel}
                                  onCancel={cancelConnectionLabelEdit}
                              />
                          );
                      })()
                    : null}

                <CanvasNodeHoverToolbar
                    node={visibleToolbarNode}
                    viewport={viewport}
                    rootRef={hoverToolbarElRef}
                    extraTools={visibleToolbarNode ? buildNodeToolbarItems(visibleToolbarNode) : undefined}
                    onKeep={keepNodeToolbar}
                    onLeave={hideNodeToolbar}
                    onInfo={(node) => setInfoNodeId(node.id)}
                    onEditText={openTextEditor}
                    onDecreaseFont={(node) => handleFontSizeChange(node.id, Math.max(10, (node.metadata?.fontSize || 14) - 2))}
                    onIncreaseFont={(node) => handleFontSizeChange(node.id, Math.min(32, (node.metadata?.fontSize || 14) + 2))}
                    onToggleDialog={(node) => setDialogNodeId((current) => (current === node.id ? null : node.id))}
                    onGenerateImage={generateImageFromTextNode}
                    onUpload={(node) => handleUploadRequest(node.id)}
                    onDownload={downloadNodeImage}
                    onSaveAsset={(node) => void saveNodeAsset(node)}
                    onMaskEdit={(node) => setMaskEditNodeId(node.id)}
                    onVideoLocalEdit={(node) => setVideoLocalEditNodeId(node.id)}
                    onPaint={(node) => setPaintNodeId(node.id)}
                    onCrop={(node) => setCropNodeId(node.id)}
                    onBlur={(node) => setBlurNodeId(node.id)}
                    onOutpaint={(node) => setOutpaintNodeId(node.id)}
                    onPhotopea={(node) => setPhotopeaNodeId(node.id)}
                    onPinSearch={(node) => {
                        pinSearchAddCountRef.current = 0;
                        setPinSearchNodeId(node.id);
                    }}
                    onCutout={(node) => void cutoutImageNode(node)}
                    onSplit={(node) => setSplitNodeId(node.id)}
                    onUpscale={(node) => setUpscaleNodeId(node.id)}
                    onAngle={(node) => setAngleNodeId(node.id)}
                    onViewImage={(node) => setPreviewNodeId(node.id)}
                    onReversePrompt={createImageReversePromptNodes}
                    onRetry={(node) => void handleRetryNode(node)}
                    onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                    onDelete={(node) => deleteNodes(new Set([node.id]))}
                    onPatchMindMetadata={(nodeId, patch) => {
                        const selected = selectedNodeIdsRef.current;
                        const multiMind =
                            mindMapModeRef.current &&
                            selected.size > 1 &&
                            [...selected].every((id) => isMindNode(nodesRef.current.find((node) => node.id === id)));
                        const targetIds = multiMind ? [...selected] : [nodeId];
                        const conns = connectionsRef.current;
                        setNodes((prev) =>
                            prev.map((item) => {
                                if (!targetIds.includes(item.id) || !isMindNode(item)) return item;
                                if (patch.mindShape && item.metadata?.mindKind === "annotation") return item;
                                const metadata = { ...item.metadata, ...patch };
                                if (!multiMind || (patch.mindShape == null && patch.fontSize == null)) {
                                    return { ...item, metadata };
                                }
                                const isRoot = metadata.mindRole === "root";
                                const fontSize = Math.max(11, Math.min(28, Number(metadata.fontSize) || (isRoot ? 15 : 13)));
                                const shape = (metadata.mindShape || (isRoot ? "capsule" : "rounded")) as Parameters<typeof computeMindNodeSize>[3];
                                const size = computeMindNodeSize(String(metadata.content || item.title || ""), isRoot, fontSize, shape);
                                const withMeta = { ...item, metadata };
                                const position = positionMindNodeAfterResize(withMeta, size.width, size.height, prev, conns);
                                return { ...withMeta, width: size.width, height: size.height, position };
                            }),
                        );
                    }}
                    onUpdateMindSize={(nodeId, size) => {
                        // 多选批量改样式时尺寸已在 onPatchMindMetadata 里按各节点重算
                        if (mindMapModeRef.current && selectedNodeIdsRef.current.size > 1) return;
                        const conns = connectionsRef.current;
                        setNodes((prev) =>
                            prev.map((item) => {
                                if (item.id !== nodeId) return item;
                                const position = positionMindNodeAfterResize(item, size.width, size.height, prev, conns);
                                return { ...item, width: size.width, height: size.height, position };
                            }),
                        );
                    }}
                />

                <CanvasToolbar
                    selectedCount={selectedNodeIds.size}
                    canvasTool={canvasTool}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    backgroundMode={backgroundMode}
                    showImageInfo={showImageInfo}
                    carryConnection={carryConnectionMode}
                    onCarryConnectionChange={setCarryConnectionMode}
                    mindMapMode={mindMapMode}
                    onMindMapModeChange={setMindMapMode}
                    onAddImage={() => createNode(CanvasNodeType.Image)}
                    onAddVideo={() => createNode(CanvasNodeType.Video)}
                    onAddAudio={() => createNode(CanvasNodeType.Audio)}
                    onAddText={() => createNode(CanvasNodeType.Text)}
                    onAddConfig={() => createNode(CanvasNodeType.Config)}
                    onAddXingXiaochi={() => createNode(CODEX_IMAGE_NODE_TYPE)}
                    onAddExtensionNode={(type) => createNode(type)}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    onUpload={() => handleUploadRequest()}
                    onDelete={() => deleteNodes(new Set(selectedNodeIds))}
                    onGroupSelected={groupSelectedNodes}
                    onArrangeSelected={arrangeSelectedNodes}
                    onClear={() => setClearConfirmOpen(true)}
                    onCanvasToolChange={setCanvasTool}
                    onBackgroundModeChange={setBackgroundMode}
                    onShowImageInfoChange={setShowImageInfo}
                />

                {isMiniMapOpen ? <Minimap nodes={nodes} viewport={viewport} viewportSize={size} onViewportChange={setViewport} /> : null}

                <CanvasZoomControls
                    scale={viewport.k}
                    subscribeLiveScale={subscribeLiveScale}
                    onScaleChange={setZoomScale}
                    onReset={fitAllNodes}
                    isMiniMapOpen={isMiniMapOpen}
                    onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)}
                    connectionsHidden={connectionsHidden}
                    onToggleConnectionsHidden={() =>
                        setConnectionsHidden((value) => {
                            const next = !value;
                            localStorage.setItem("canvas-connections-hidden", next ? "1" : "0");
                            if (next) setSelectedConnectionId(null);
                            return next;
                        })
                    }
                />

                {contextMenu ? (
                    <CanvasNodeContextMenu
                        menu={contextMenu}
                        onClose={() => setContextMenu(null)}
                        onCopyImage={(() => {
                            if (contextMenu.type !== "node") return undefined;
                            const node = nodes.find((item) => item.id === contextMenu.nodeId);
                            if (!node || !isCopyableImageNode(node)) return undefined;
                            return () => {
                                setContextMenu(null);
                                void copyNodeImageToSystemClipboard(node).then((ok) => {
                                    if (ok) message.success(t("canvas.projectPage.imageCopiedToSystem"));
                                    else message.warning(t("canvas.projectPage.imageCopyFailed"));
                                });
                            };
                        })()}
                        onDuplicate={() => {
                            if (contextMenu.type !== "node") return;
                            duplicateNode(contextMenu.nodeId);
                            setContextMenu(null);
                        }}
                        onAlignConnection={
                            contextMenu.type === "connection"
                                ? () => alignSelectedConnectionPoints(contextMenu.connectionId)
                                : undefined
                        }
                        onEditConnectionLabel={
                            contextMenu.type === "connection"
                                ? () => {
                                      beginEditConnectionLabel(contextMenu.connectionId);
                                      setContextMenu(null);
                                  }
                                : undefined
                        }
                        onToggleConnectionDash={
                            contextMenu.type === "connection" ? () => toggleConnectionDash(contextMenu.connectionId) : undefined
                        }
                        connectionDashed={
                            contextMenu.type === "connection"
                                ? (() => {
                                      const conn = connections.find((item) => item.id === contextMenu.connectionId);
                                      if (!conn) return false;
                                      const from = nodes.find((node) => node.id === conn.fromNodeId);
                                      const to = nodes.find((node) => node.id === conn.toNodeId);
                                      return isConnectionDashed(conn, from, to);
                                  })()
                                : undefined
                        }
                        onDelete={() => {
                            if (contextMenu.type === "node") {
                                deleteNodes(new Set([contextMenu.nodeId]));
                            } else {
                                deleteConnection(contextMenu.connectionId);
                            }
                            setContextMenu(null);
                        }}
                    />
                ) : null}

                <input ref={imageInputRef} type="file" multiple accept="image/*,video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" className="hidden" onChange={handleImageInputChange} />

                <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} />

                {videoLocalEditNode ? <CanvasVideoLocalEditDialog key={`video-local:${projectId}:${videoLocalEditNode.id}`} node={videoLocalEditNode} open onClose={() => setVideoLocalEditNodeId(null)} onConfirm={(selection, signal, onProgress) => saveVideoLocalEdit(videoLocalEditNode, selection, signal, onProgress)} onRestore={() => void restoreVideoLocalEdit(videoLocalEditNode)} /> : null}

                {cropNode?.metadata?.content ? <CanvasNodeCropDialog dataUrl={cropNode.metadata.content} open={Boolean(cropNode)} onClose={() => setCropNodeId(null)} onConfirm={(crop) => void cropImageNode(cropNode!, crop)} /> : null}
                {blurNode?.metadata?.content ? <CanvasNodeBlurDialog dataUrl={blurNode.metadata.content} open={Boolean(blurNode)} onClose={() => setBlurNodeId(null)} onConfirm={(options) => blurImageNode(blurNode!, options)} /> : null}
                {paintNode?.metadata?.content ? <CanvasNodePaintDialog key={`paint:${projectId}:${paintNode.id}`} dataUrl={paintNode.metadata.content} open={Boolean(paintNode)} onClose={() => setPaintNodeId(null)} onConfirm={(painted) => paintImageNode(paintNode!, painted)} /> : null}
                {outpaintNode?.metadata?.content ? <CanvasNodeOutpaintDialog dataUrl={outpaintNode.metadata.content} open={Boolean(outpaintNode)} onClose={() => setOutpaintNodeId(null)} onConfirm={(box) => void outpaintImageNode(outpaintNode!, box)} /> : null}

                {photopeaNode ? <CanvasPhotopeaEditor key={`${projectId}:${photopeaNode.id}`} node={photopeaNode} open onClose={() => setPhotopeaNodeId(null)} onApply={applyPhotopeaImage} /> : null}

                <CanvasPinterestSearch node={pinSearchNode} open={Boolean(pinSearchNode)} onClose={() => setPinSearchNodeId(null)} onAdd={addPinterestImage} />

                {maskEditNode?.metadata?.content || maskEditNode?.metadata?.localEditOriginalContent ? (
                    <CanvasNodePaintDialog
                        key={`local-edit:${projectId}:${maskEditNode.id}`}
                        mode="local-edit"
                        dataUrl={maskEditNode.metadata.localEditOriginalContent || maskEditNode.metadata.content || ""}
                        open={Boolean(maskEditNode)}
                        canRestore={Boolean(maskEditNode.metadata.localEditPreprocess && (maskEditNode.metadata.localEditOriginalContent || maskEditNode.metadata.localEditOriginalStorageKey))}
                        onClose={() => setMaskEditNodeId(null)}
                        onConfirm={(payload) => maskEditImageNode(maskEditNode!, payload)}
                        onRestore={() => restoreLocalEditImageNode(maskEditNode)}
                    />
                ) : null}

                {splitNode?.metadata?.content ? <CanvasNodeSplitDialog dataUrl={splitNode.metadata.content} open={Boolean(splitNode)} onClose={() => setSplitNodeId(null)} onConfirm={(params) => void splitImageNode(splitNode!, params)} /> : null}

                {upscaleNode ? (
                    <CanvasNodeRhUpscaleDialog
                        open={Boolean(upscaleNode)}
                        sourceWidth={upscaleNode.metadata?.naturalWidth}
                        sourceHeight={upscaleNode.metadata?.naturalHeight}
                        onClose={() => setUpscaleNodeId(null)}
                        onConfirm={(params) => void upscaleImageNode(upscaleNode, params)}
                    />
                ) : null}

                {angleNode?.metadata?.content ? <CanvasNodeAngleDialog dataUrl={angleNode.metadata.content} open={Boolean(angleNode)} onClose={() => setAngleNodeId(null)} onConfirm={(params) => void generateAngleNode(angleNode!, params)} /> : null}

                <CanvasReportDialog key={projectId} />
                {modelAngleExport ? (
                    <ModelAngleExportDialog
                        open
                        storageKey={modelAngleExport.storageKey}
                        fileName={modelAngleExport.fileName}
                        background={modelAngleExport.background}
                        showTextures={modelAngleExport.showTextures}
                        initialPose={modelAngleExport.pose}
                        onClose={() => setModelAngleExport(null)}
                        onExport={(blob, prompt) => exportModelAngleImage(blob, prompt)}
                    />
                ) : null}

                <Modal
                    title={previewNode?.title || t("canvas.projectPage.imageDetails")}
                    open={Boolean(previewNode?.metadata?.content)}
                    centered
                    onCancel={() => setPreviewNodeId(null)}
                    footer={null}
                    width="auto"
                    styles={{ body: { padding: 0, display: "flex", justifyContent: "center", alignItems: "center", maxHeight: "80vh" } }}
                >
                    {previewNode?.type === CanvasNodeType.Text ? (
                        <div className="thin-scrollbar max-h-[75vh] w-[min(760px,80vw)] overflow-y-auto whitespace-pre-wrap break-words p-4">
                            {previewNode.metadata?.documentKind === "markdown" ? (
                                <Streamdown mode="static" controls={false}>{String(previewNode.metadata.content || "")}</Streamdown>
                            ) : String(previewNode.metadata?.content || "")}
                        </div>
                    ) : previewNode?.metadata?.content ? <img src={previewNode.metadata.content} alt={previewNode.title || t("assets.kinds.image")} style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }} /> : null}
                </Modal>

                <Modal
                    title={t("canvas.projectPage.clearTitle")}
                    open={clearConfirmOpen}
                    centered
                    onCancel={() => setClearConfirmOpen(false)}
                    footer={
                        <>
                            <Button onClick={() => setClearConfirmOpen(false)}>{t("common.cancel")}</Button>
                            <Button danger type="primary" onClick={clearCanvas}>
                                {t("canvas.projectPage.clear")}
                            </Button>
                        </>
                    }
                >
                    <p className="text-sm opacity-60">{t("canvas.projectPage.clearDescription")}</p>
                </Modal>

                <AssetPickerModal open={assetPickerOpen} onInsert={handleAssetInsert} onClose={() => setAssetPickerOpen(false)} />
            </section>
            <CanvasSidePanel nodes={nodeDraggingRef.current ? sidePanelNodesRef.current : nodes} connections={connections} selectedNodeIds={selectedNodeIds} onFocusNode={focusNode} onPreviewNode={setPreviewNodeId} onInsertAsset={handleAssetInsert} />
            <PromptAssetSaveDialog draft={promptAssetDraft} saving={promptAssetSaving} onCancel={() => !promptAssetSaving && setPromptAssetDraft(null)} onSubmit={(values) => void confirmPromptAsset(values)} />
        </main>
    );
}

async function requestCodexCliText(input: {
    sourceNodeId: string;
    prompt: string;
    /** 对话里展示的用户原文；默认取 prompt 截断，避免把整表贴进气泡 */
    messageText?: string;
    referenceImages: Array<{ id?: string; name?: string; type?: string; dataUrl?: string; storageKey?: string }>;
    skills?: Array<{ name: string; path: string }>;
    signal?: AbortSignal;
    onDelta?: (text: string) => void;
}) {
    const agent = useAgentStore.getState();
    if (!agent.connected) throw new Error(i18n.t("canvas.codexText.agentRequired"));
    const attachments: AgentAttachment[] = [];
    for (const image of input.referenceImages || []) {
        const dataUrl = image.dataUrl || "";
        if (!dataUrl.startsWith("data:")) continue;
        attachments.push({
            id: image.id || nanoid(),
            name: image.name || "reference.png",
            type: image.type || "image/png",
            size: getDataUrlByteSize(dataUrl),
            width: 0,
            height: 0,
            url: "",
            dataUrl,
        });
    }
    const skill = input.skills?.[0];
    const prompt = buildCodexTextSystemPrompt({
        sourceNodeId: input.sourceNodeId,
        userPrompt: input.prompt,
        hasReferences: attachments.length > 0,
    });
    const jobId = useCodexTextJobStore.getState().queue({
        sourceNodeId: input.sourceNodeId,
        prompt,
        messageText: (input.messageText || input.prompt).trim().slice(0, 500) || undefined,
        attachments,
        ...(skill ? { skill } : {}),
    });
    try {
        const text = await waitForCodexTextJob(jobId, { signal: input.signal, onDelta: input.onDelta });
        if (!text.trim()) throw new Error(i18n.t("canvas.codexText.empty"));
        return text.trim();
    } finally {
        useCodexTextJobStore.getState().clear(jobId);
    }
}
