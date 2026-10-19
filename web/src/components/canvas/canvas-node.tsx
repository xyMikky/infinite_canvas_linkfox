import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Group, Image as ImageIcon, Minus, Music2, Plus, Puzzle, RefreshCw, Sheet, Trash2, Video } from "lucide-react";
import { Streamdown } from "streamdown";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes } from "@/lib/image-utils";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { CODEX_IMAGE_NODE_TYPE } from "@/stores/use-codex-image-job-store";
import { getXingBodyRect } from "@/lib/canvas/xing-xiaochi-ports";
import { isLegacyCodexNodeTitle } from "@/components/canvas/xing-xiaochi-avatar";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import {
    isAnnotationNode,
    isMindSideCollapsed,
    mindShapePolyPoints,
    mindShapeTipInset,
    nearestMindResizeCorner,
    MIND_NODE_TYPE,
    type MindCollapseSide,
} from "@/lib/canvas/mind-map";
import { useThemeStore } from "@/stores/use-theme-store";
import { useCanvasInteractionStore } from "@/stores/canvas/use-canvas-interaction-store";
import { CanvasAudioDock, CanvasAudioPlayerProvider, CanvasAudioSurface } from "@/components/canvas-audio-player";
import { CanvasVideoDock, CanvasVideoPlayerProvider, CanvasVideoSurface } from "@/components/canvas-video-player";
import { ExcelVirtualSheet } from "@/components/canvas/excel-virtual-sheet";
import { ImageTaskCompareLayer } from "@/components/canvas/canvas-image-compare-overlay";
import { snapResizeToNearbyNodes, type AlignGuide } from "@/lib/canvas/snap-node-align";
import { handleNodeContentWheel } from "@/lib/canvas/canvas-wheel";
import { CanvasNodeImage } from "@/lib/canvas/canvas-node-image";
import { CANVAS_IMAGE_FADE_MS, scheduleOpacityFadeIn } from "@/lib/canvas/canvas-image-thumb";
import { canvasNodeFullLayerRef, canvasNodeLiveLodOpacity, canvasNodeShellLayerRef, type CanvasNodeContentLod } from "@/lib/canvas/canvas-node-lod";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import {
    CanvasNodeType,
    type CanvasNodeData,
    type CanvasNodeImage as CanvasNodeImageData,
    type ConnectionHandleSide,
    type Position,
    type ViewportTransform,
} from "@/types/canvas";
import type { CanvasNodeContext, CanvasPluginHost } from "@/types/canvas-plugin";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { isCanvasTouchPinchActive } from "@/lib/canvas/touch-pinch";

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "top" | "right" | "bottom" | "left";
type NodePressEvent = React.MouseEvent | React.PointerEvent;
let cancelActiveNodeResize: (() => void) | null = null;
let activeNodeHandlePress = false;
let cancelNodeHandlePressOnUp = false;

export function cancelCanvasNodeTouchInteraction() {
    cancelActiveNodeResize?.();
    if (activeNodeHandlePress) cancelNodeHandlePressOnUp = true;
}
const selectionBlue = "#2f80ff";
const NodeContentActivity = (React as typeof React & { Activity: React.ExoticComponent<{ mode: "visible" | "hidden"; children: ReactNode }> }).Activity;

type CanvasNodeProps = {
    data: CanvasNodeData;
    scale: number;
    viewportScale?: number;
    /** 手势缩放时的实时视口，节点拉伸按这个算，避免 React 视口节流后比例不准 */
    viewportScaleRef?: React.RefObject<ViewportTransform>;
    /** 视口级内容 LOD；选中/编辑/面板打开/生成中时节点内部仍强制 full */
    contentLod?: CanvasNodeContentLod;
    /** 选中、组拖动成员和打开面板的节点保持完整内容。 */
    keepContentActive?: boolean;
    /** 缓冲区仅显示外壳，进入屏幕后再加载完整内容。 */
    deferContent?: boolean;
    /** 壳态层不透明度（与完整内容交叉淡入） */
    lodShellOpacity?: number;
    /** 完整内容层不透明度 */
    lodFullOpacity?: number;
    /** 壳态是否仍挂媒体缩略图；远景关掉，避免原图像素模糊合成 */
    showLodMedia?: boolean;
    /** 叠放稳定层级（取最近选中后的叠放序） */
    stackZIndex?: number;
    isConnecting: boolean;
    editRequestNonce?: number;
    showPanel: boolean;
    showImageInfo: boolean;
    mentionReferences?: CanvasResourceReference[];
    pluginHost?: CanvasPluginHost;
    registryVersion?: number;
    renderPanel?: (node: CanvasNodeData) => ReactNode;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    groupChildCount?: number;
    /** 数据组：可作上游文本资源并显示右侧连线手柄 */
    dataGroupActive?: boolean;
    isGroupDropTarget?: boolean;
    batchExpanded?: boolean;
    onMouseDown: (event: NodePressEvent, nodeId: string) => void;
    onSelectCapture?: (event: NodePressEvent, nodeId: string) => void;
    onHoverStart: (nodeId: string) => void;
    onHoverEnd: (nodeId: string) => void;
    onConnectStart: (event: NodePressEvent, nodeId: string, handleType: "source" | "target", side?: ConnectionHandleSide) => void;
    onToggleMindCollapse?: (nodeId: string, side: MindCollapseSide) => void;
    onResizeStart: (nodeId: string) => void;
    onResize: (nodeId: string, width: number, height: number, position?: Position) => void;
    onResizeEnd: (nodeId: string) => void;
    onResizeGuides?: (guides: AlignGuide[]) => void;
    getPreferredAlignTargetId?: () => string | null;
    onContentChange: (nodeId: string, content: string) => void;
    onTitleChange: (nodeId: string, title: string) => void;
    onToggleBatch?: (nodeId: string) => void;
    onSetBatchPrimary?: (nodeId: string, imageId: string) => void;
    onDuplicateBatchImage?: (node: CanvasNodeData, imageId: string) => void;
    onDownloadBatchImage?: (node: CanvasNodeData, imageId: string) => void;
    onRetryBatchImage?: (node: CanvasNodeData, imageId: string) => void;
    onDeleteBatchImage?: (nodeId: string, imageId: string) => void;
    onRetry?: (node: CanvasNodeData) => void;
    onGenerateImage?: (node: CanvasNodeData) => void;
    onExpandExcelSheets?: (node: CanvasNodeData) => void;
    excelSheetsExpanded?: boolean;
    onToggleExcelSheetDetail?: (nodeId: string, expanded: boolean) => void;
    onViewImage?: (node: CanvasNodeData) => void;
    onToggleLocalEditView?: (nodeId: string) => void;
    onVideoClipChange?: (nodeId: string, clip: { clipStartMs: number; clipEndMs: number; includeAudio: boolean }) => void;
    onAudioClipChange?: (nodeId: string, clip: { clipStartMs: number; clipEndMs: number }) => void;
    onCaptureVideoFrame?: (node: CanvasNodeData, blob: Blob) => void;
    onContextMenu: (event: React.MouseEvent, nodeId: string) => void;
};

type NodeContentRendererProps = {
    node: CanvasNodeData;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    isSelected: boolean;
    isEditingContent: boolean;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    pluginContext?: CanvasNodeContext | null;
    onContentChange: (nodeId: string, content: string) => void;
    onStopEditing: () => void;
    mentionReferences: CanvasResourceReference[];
    onRetry?: (node: CanvasNodeData) => void;
    onGenerateImage?: (node: CanvasNodeData) => void;
    onExpandExcelSheets?: (node: CanvasNodeData) => void;
    excelSheetsExpanded?: boolean;
    excelDetailOpen?: boolean;
    onToggleExcelSheetDetail?: (nodeId: string, expanded: boolean) => void;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: (imageId: string) => void;
    onDuplicateBatchImage?: (imageId: string) => void;
    onDownloadBatchImage?: (imageId: string) => void;
    onRetryBatchImage?: (imageId: string) => void;
    onDeleteBatchImage?: (imageId: string) => void;
    groupChildCount: number;
    dataGroupActive?: boolean;
    viewportScale?: number;
    lodFullOpacity?: number;
    mediaShellVisual?: boolean;
    showLodMedia?: boolean;
    pluginHost?: CanvasPluginHost;
};

export const CanvasNode = React.memo(function CanvasNode({
    data,
    scale,
    viewportScale,
    viewportScaleRef,
    contentLod = "full",
    keepContentActive = false,
    deferContent = false,
    lodShellOpacity = 0,
    lodFullOpacity = 1,
    showLodMedia = true,
    stackZIndex = 0,
    isConnecting,
    editRequestNonce = 0,
    showPanel,
    showImageInfo,
    mentionReferences = [],
    pluginHost,
    renderPanel,
    renderNodeContent,
    groupChildCount = 0,
    dataGroupActive = false,
    isGroupDropTarget = false,
    batchExpanded = false,
    onMouseDown,
    onSelectCapture,
    onHoverStart,
    onHoverEnd,
    onConnectStart,
    onToggleMindCollapse,
    onResizeStart,
    onResize,
    onResizeEnd,
    onResizeGuides,
    getPreferredAlignTargetId,
    onContentChange,
    onTitleChange,
    onToggleBatch,
    onSetBatchPrimary,
    onDuplicateBatchImage,
    onDownloadBatchImage,
    onRetryBatchImage,
    onDeleteBatchImage,
    onRetry,
    onGenerateImage,
    onExpandExcelSheets,
    excelSheetsExpanded = false,
    onToggleExcelSheetDetail,
    onViewImage,
    onToggleLocalEditView,
    onVideoClipChange,
    onAudioClipChange,
    onCaptureVideoFrame,
    onContextMenu,
}: CanvasNodeProps) {
    const nodeId = data.id;
    const effectiveViewportScale = viewportScale ?? scale;
    const isSelected = useCanvasInteractionStore((state) => state.selectedNodeIds.has(nodeId));
    const isRelated = useCanvasInteractionStore((state) => state.relatedNodeIds.has(nodeId));
    const isFocusRelated = useCanvasInteractionStore((state) => {
        if (state.selectedNodeIds.size > 1) return false;
        return state.hoveredNodeId === nodeId || (state.selectedNodeIds.size === 1 && state.selectedNodeIds.has(nodeId));
    });
    const isConnectionTarget = useCanvasInteractionStore((state) => state.connectionTargetNodeId === nodeId);
    // 拖拽跟手：只改 DOM transform，不订阅 liveDrag（避免每帧重渲 iframe/HTML 等内容）
    const nodeRootRef = useRef<HTMLDivElement | null>(null);
    const positionRef = useRef(data.position);
    positionRef.current = data.position;
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const [hovered, setHovered] = useState(false);
    const definition = getNodeDefinition(data.type);
    const pluginContext = useMemo<CanvasNodeContext | null>(() => (pluginHost ? buildNodeContext(pluginHost, data, theme, scale, isSelected) : null), [pluginHost, data, theme, scale, isSelected]);
    const [isEditingContent, setIsEditingContent] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState(data.title || "");
    const displayTitle =
        data.type === CODEX_IMAGE_NODE_TYPE && isLegacyCodexNodeTitle(data.title)
            ? t("canvas.codexImage.title")
            : data.title;
    const hasImageContent = data.type === CanvasNodeType.Image && Boolean(data.metadata?.content);
    const hasVideoContent = data.type === CanvasNodeType.Video && Boolean(data.metadata?.content);
    const hasAudioContent = data.type === CanvasNodeType.Audio && Boolean(data.metadata?.content);
    const isGroup = data.type === CanvasNodeType.Group;
    const isDataGroup = isGroup && (dataGroupActive || data.metadata?.groupKind === "data" || Boolean(data.metadata?.groupBundleText || data.metadata?.content));
    const isMind = data.type === MIND_NODE_TYPE;
    /** canvas.tsx 拆分片段：外壳不套圆角/裁切，外形由片段 HTML 自带 */
    const isCanvasFragment = Boolean(data.metadata?.canvasFragment);
    const definitionBareShell =
        typeof definition?.bareShell === "function" ? Boolean(definition.bareShell(data)) : Boolean(definition?.bareShell);
    const isXingXiaochi = data.type === CODEX_IMAGE_NODE_TYPE;
    const bareShell = isMind || isCanvasFragment || definitionBareShell || isXingXiaochi;
    const mindShapeName = String(data.metadata?.mindShape || "");
    const mindTipInset = isMind ? mindShapeTipInset(mindShapeName) : null;
    /** 菱形/六边形/圆：缩放应抓住外形尖点/边中点，而不是包围盒四角空白 */
    const mindResizeOnTips = Boolean(mindTipInset && (mindShapeName === "diamond" || mindShapeName === "hexagon" || mindShapeName === "circle"));
    const batchCount = 0;
    const isBatchRoot = false;
    const isExcelDoc = data.metadata?.documentKind === "excel" && Boolean(data.metadata?.excelSheets?.length);
    const isExcelSheet = Boolean(data.metadata?.excelParentId);
    const [excelDetailOpen, setExcelDetailOpen] = useState(false);
    const forceFullContent =
        keepContentActive ||
        isSelected ||
        showPanel ||
        isMind ||
        isXingXiaochi ||
        batchExpanded ||
        isEditingContent ||
        isEditingTitle ||
        data.metadata?.status === "loading" ||
        data.metadata?.images?.some((image) => image.status === "loading");
    const contentDeferred = deferContent && !forceFullContent;
    // 重预览首次需要时才挂载，之后缩小仅隐藏；离屏休眠仍由外层 Activity 负责。
    const keepContentMounted = Boolean(definition?.keepContentMounted?.(data));
    const hasMountedContentRef = useRef(false);
    const mediaPreview = hasImageContent || hasVideoContent;
    // 图片/视频始终走完整层（同一 <img>），远景仅切换视觉样式，避免缩放时重载
    const mediaShellVisual = mediaPreview && !forceFullContent && (contentDeferred || contentLod === "shell");
    const shellOpacity = contentDeferred ? 1 : forceFullContent || mediaPreview ? 0 : lodShellOpacity;
    const fullOpacity = contentDeferred ? 0 : forceFullContent || mediaPreview ? 1 : lodFullOpacity;
    const showShellLayer = shellOpacity > 0.02;
    const fullLayerShown = !contentDeferred && (forceFullContent || mediaPreview || fullOpacity > 0.02);
    const contentActive = !contentDeferred && (forceFullContent || mediaPreview || contentLod === "full");
    const showFullLayer = fullLayerShown || contentActive || ((keepContentMounted || contentDeferred) && hasMountedContentRef.current);
    useLayoutEffect(() => {
        if (fullLayerShown || contentActive) hasMountedContentRef.current = true;
    }, [contentActive, fullLayerShown]);
    const shellDominant = mediaShellVisual || shellOpacity > fullOpacity;
    const preferFullContent = fullOpacity >= 0.72;
    const belowPanelWidth = hasVideoContent || hasAudioContent ? 600 : showPanel && renderPanel ? (definition?.panelWidth ?? 560) : 560;
    // Nodes with the interaction/move toggle ignore content pointer events in move mode and allow interaction in interactive mode.
    // forceInteractive states such as editing stay interactive, as do empty nodes so their upload and generation actions remain usable.
    const supportsInteractionToggle = Boolean(definition?.interactionToggle);
    const forceInteractive = supportsInteractionToggle ? Boolean(definition?.forceInteractive?.(data)) : false;
    // 智能预览 HTML 等可能只有 path、正文在 iframe 里，不能因 !content 误判为「空节点可点」
    const hasToggleableContent = Boolean(
        String(data.metadata?.content || "").trim() ||
            String(data.metadata?.smartPreviewPath || "").trim() ||
            String(data.metadata?.storageKey || "").trim(),
    );
    const contentInteractive =
        !supportsInteractionToggle || forceInteractive || !hasToggleableContent ? true : Boolean(data.metadata?.interactive);
    // 触屏拖动必须在 pointerdown 前声明 touch-action，否则节点选中后工具栏出现等布局变化
    // 可能让 Chromium 把手势交还给页面并触发 pointercancel。交互型预览开启时仍保留原生触控。
    const ownsTouchDrag =
        !isEditingContent &&
        !isEditingTitle &&
        (data.type === CanvasNodeType.Text ||
            data.type === CanvasNodeType.Image ||
            data.type === CanvasNodeType.Video ||
            data.type === CanvasNodeType.Audio ||
            data.type === CanvasNodeType.Group ||
            isMind ||
            isXingXiaochi ||
            (supportsInteractionToggle && !contentInteractive));
    // Transparent nodes such as SVGs / .canvas.tsx blend into the canvas while retaining outlines for selected or related states.
    const transparentBg =
        typeof definition?.transparentBackground === "function" ? Boolean(definition.transparentBackground(data)) : Boolean(definition?.transparentBackground);
    const isActive = isConnectionTarget || isSelected || isFocusRelated;
    const imageBorderColor = isActive ? selectionBlue : isRelated ? theme.node.muted : "transparent";
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const titleInputRef = useRef<HTMLInputElement>(null);
    const resizeRef = useRef({
        isResizing: false,
        corner: "bottom-right" as ResizeCorner,
        startX: 0,
        startY: 0,
        startLeft: 0,
        startTop: 0,
        startWidth: 0,
        startHeight: 0,
        keepRatio: false,
        ratio: 1,
    });

    useEffect(() => {
        setTitleDraft(data.title || "");
    }, [data.title]);

    useEffect(() => {
        if (!isEditingTitle) return;
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
    }, [isEditingTitle]);

    const applyLiveTransform = useCallback(() => {
        const el = nodeRootRef.current;
        if (!el) return;
        const live = useCanvasInteractionStore.getState().liveDrag;
        const dx = live?.ids.has(nodeId) ? live.dx : 0;
        const dy = live?.ids.has(nodeId) ? live.dy : 0;
        const { x, y } = positionRef.current;
        el.style.transform = `translate(${x + dx}px, ${y + dy}px)`;
    }, [nodeId]);

    useLayoutEffect(() => {
        applyLiveTransform();
    }, [applyLiveTransform, data.position.x, data.position.y]);

    useEffect(() => useCanvasInteractionStore.subscribe((state, previous) => {
        if (state.liveDrag === previous.liveDrag) return;
        // 只移动本次拖拽节点；结束时也需清掉上一帧的临时位移。
        if (state.liveDrag?.ids.has(nodeId) || previous.liveDrag?.ids.has(nodeId)) applyLiveTransform();
    }), [applyLiveTransform, nodeId]);

    const finishTitleEditing = useCallback(() => {
        const title = titleDraft.trim() || data.title || t("canvas.node.untitled");
        setTitleDraft(title);
        setIsEditingTitle(false);
        if (title !== data.title) onTitleChange(data.id, title);
    }, [data.id, data.title, onTitleChange, t, titleDraft]);

    useEffect(() => {
        if (!isEditingTitle) return;
        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && titleInputRef.current?.contains(target)) return;
            finishTitleEditing();
        };
        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [finishTitleEditing, isEditingTitle]);

    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        // 编辑时拦截滚轮以便滚动正文；预览态不拦截，保证画布可放大也可缩小
        const handleWheel = (event: WheelEvent) => event.stopPropagation();
        textarea.addEventListener("wheel", handleWheel, { passive: true });
        return () => textarea.removeEventListener("wheel", handleWheel);
    }, [data.type, isEditingContent]);

    useEffect(() => {
        if (!isEditingContent) return;
        const textarea = textareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    }, [isEditingContent]);

    useEffect(() => {
        if (!editRequestNonce || data.type !== CanvasNodeType.Text) return;
        setIsEditingContent(true);
    }, [data.type, editRequestNonce]);

    useEffect(() => {
        if (!isEditingContent) return;

        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (isEditingContent && textareaRef.current?.contains(target)) return;

            setIsEditingContent(false);
        };

        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [isEditingContent]);

    const scaleRef = useRef(scale);
    const onResizeRef = useRef(onResize);
    const onResizeEndRef = useRef(onResizeEnd);
    const onResizeGuidesRef = useRef(onResizeGuides);
    const getPreferredAlignTargetIdRef = useRef(getPreferredAlignTargetId);
    const pluginHostRef = useRef(pluginHost);
    scaleRef.current = scale;
    onResizeRef.current = onResize;
    onResizeEndRef.current = onResizeEnd;
    onResizeGuidesRef.current = onResizeGuides;
    getPreferredAlignTargetIdRef.current = getPreferredAlignTargetId;
    pluginHostRef.current = pluginHost;

    const handleResizeMove = useCallback(
        (event: MouseEvent) => {
            if (!resizeRef.current.isResizing || isCanvasTouchPinchActive()) return;

            const currentScale = Math.max(viewportScaleRef?.current?.k ?? scaleRef.current, 0.05);
            const dx = (event.clientX - resizeRef.current.startX) / currentScale;
            const dy = (event.clientY - resizeRef.current.startY) / currentScale;
            const minWidth = data.type === MIND_NODE_TYPE ? 72 : 220;
            const minHeight = data.type === MIND_NODE_TYPE ? 28 : 160;
            const startRight = resizeRef.current.startLeft + resizeRef.current.startWidth;
            const startBottom = resizeRef.current.startTop + resizeRef.current.startHeight;
            const corner = resizeRef.current.corner;
            const fromLeft = corner === "left" || corner === "top-left" || corner === "bottom-left";
            const fromRight = corner === "right" || corner === "top-right" || corner === "bottom-right";
            const fromTop = corner === "top" || corner === "top-left" || corner === "top-right";
            const fromBottom = corner === "bottom" || corner === "bottom-left" || corner === "bottom-right";
            const edgeOnly = corner === "top" || corner === "right" || corner === "bottom" || corner === "left";
            const rawWidth = Math.max(minWidth, resizeRef.current.startWidth + (fromLeft ? -dx : fromRight ? dx : 0));
            const rawHeight = Math.max(minHeight, resizeRef.current.startHeight + (fromTop ? -dy : fromBottom ? dy : 0));
            let width = rawWidth;
            let height = rawHeight;
            const keepRatio = resizeRef.current.keepRatio;
            if (keepRatio) {
                const ratio = resizeRef.current.ratio;
                if (edgeOnly) {
                    if (fromTop || fromBottom) width = height * ratio;
                    else height = width / ratio;
                } else if (Math.abs(dx) >= Math.abs(dy)) {
                    height = width / ratio;
                } else {
                    width = height * ratio;
                }
                if (height < minHeight) {
                    height = minHeight;
                    width = height * ratio;
                }
                if (width < minWidth) {
                    width = minWidth;
                    height = width / ratio;
                }
            }

            const startLeft = resizeRef.current.startLeft;
            const startTop = resizeRef.current.startTop;
            let left = fromLeft ? startRight - width : startLeft;
            let top = fromTop ? startBottom - height : startTop;
            if (keepRatio && edgeOnly && (fromTop || fromBottom)) {
                left = startLeft + (resizeRef.current.startWidth - width) / 2;
            }
            if (keepRatio && edgeOnly && (fromLeft || fromRight)) {
                top = startTop + (resizeRef.current.startHeight - height) / 2;
            }
            let box = { left, top, right: left + width, bottom: top + height };
            const host = pluginHostRef.current;
            if (host) {
                const snapped = snapResizeToNearbyNodes({
                    nodeId: data.id,
                    box,
                    edges: { left: fromLeft, right: fromRight, top: fromTop, bottom: fromBottom },
                    minWidth,
                    minHeight,
                    keepRatio,
                    ratio: resizeRef.current.ratio,
                    allNodes: host.getNodes(),
                    connections: host.getConnections(),
                    zoom: currentScale,
                    preferredTargetId: getPreferredAlignTargetIdRef.current?.() || null,
                });
                box = { ...snapped.box };
                if (snapped.pins.top != null) {
                    box.top = snapped.pins.top;
                    if (!fromBottom) box.bottom = startBottom;
                }
                if (snapped.pins.bottom != null) {
                    box.bottom = snapped.pins.bottom;
                    if (!fromTop) box.top = startTop;
                }
                if (snapped.pins.left != null) {
                    box.left = snapped.pins.left;
                    if (!fromRight) box.right = startRight;
                }
                if (snapped.pins.right != null) {
                    box.right = snapped.pins.right;
                    if (!fromLeft) box.left = startLeft;
                }
                if (keepRatio) {
                    const ratio = resizeRef.current.ratio;
                    if (snapped.pins.top != null || snapped.pins.bottom != null) {
                        const nextHeight = box.bottom - box.top;
                        const nextWidth = Math.max(minWidth, nextHeight * ratio);
                        if (fromLeft && !fromRight) box.left = box.right - nextWidth;
                        else if (fromRight && !fromLeft) box.right = box.left + nextWidth;
                        else {
                            const cx = (box.left + box.right) / 2;
                            box.left = cx - nextWidth / 2;
                            box.right = cx + nextWidth / 2;
                        }
                    } else if (snapped.pins.left != null || snapped.pins.right != null) {
                        const nextWidth = box.right - box.left;
                        const nextHeight = Math.max(minHeight, nextWidth / ratio);
                        if (fromTop && !fromBottom) box.top = box.bottom - nextHeight;
                        else if (fromBottom && !fromTop) box.bottom = box.top + nextHeight;
                        else {
                            const cy = (box.top + box.bottom) / 2;
                            box.top = cy - nextHeight / 2;
                            box.bottom = cy + nextHeight / 2;
                        }
                    }
                    if (snapped.pins.top != null) box.top = snapped.pins.top;
                    if (snapped.pins.bottom != null) box.bottom = snapped.pins.bottom;
                    if (snapped.pins.left != null) box.left = snapped.pins.left;
                    if (snapped.pins.right != null) box.right = snapped.pins.right;
                }
                onResizeGuidesRef.current?.(snapped.guides);
            }

            onResizeRef.current(data.id, box.right - box.left, box.bottom - box.top, {
                x: box.left,
                y: box.top,
            });
        },
        [data.id, data.type],
    );

    const handleResizeUp = useCallback(() => {
        resizeRef.current.isResizing = false;
        if (cancelActiveNodeResize === handleResizeUp) cancelActiveNodeResize = null;
        window.removeEventListener("mousemove", handleResizeMove);
        window.removeEventListener("mouseup", handleResizeUp);
        window.removeEventListener("pointermove", handleResizeMove);
        window.removeEventListener("pointerup", handleResizeUp);
        window.removeEventListener("pointercancel", handleResizeUp);
        onResizeGuidesRef.current?.([]);
        onResizeEndRef.current(data.id);
    }, [data.id, handleResizeMove]);

    const handleResizeMouseDown = (event: NodePressEvent, corner: ResizeCorner) => {
        if (data.type === CanvasNodeType.Config) return;
        if ("pointerType" in event && event.pointerType !== "mouse" && isCanvasTouchPinchActive()) return;
        event.stopPropagation();
        event.preventDefault();
        cancelActiveNodeResize?.();
        onResizeStart(data.id);
        const naturalWidth = data.metadata?.naturalWidth;
        const naturalHeight = data.metadata?.naturalHeight;
        const ratio =
            Number.isFinite(naturalWidth) && Number.isFinite(naturalHeight) && (naturalWidth as number) > 0 && (naturalHeight as number) > 0
                ? (naturalWidth as number) / (naturalHeight as number)
                : data.width / Math.max(1, data.height);
        resizeRef.current = {
            isResizing: true,
            corner,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: data.position.x,
            startTop: data.position.y,
            startWidth: data.width,
            startHeight: data.height,
            keepRatio: (data.type === CanvasNodeType.Image && !data.metadata?.freeResize) || data.type === CanvasNodeType.Video || Boolean(definition?.keepAspectRatio?.(data)),
            ratio: Number.isFinite(ratio) && ratio > 0 ? ratio : 1,
        };
        cancelActiveNodeResize = handleResizeUp;
        if ("pointerType" in event && event.pointerType !== "mouse") {
            window.addEventListener("pointermove", handleResizeMove);
            window.addEventListener("pointerup", handleResizeUp);
            window.addEventListener("pointercancel", handleResizeUp);
        } else {
            window.addEventListener("mousemove", handleResizeMove);
            window.addEventListener("mouseup", handleResizeUp);
        }
    };

    useEffect(() => {
        return () => {
            if (cancelActiveNodeResize === handleResizeUp) cancelActiveNodeResize = null;
            window.removeEventListener("mousemove", handleResizeMove);
            window.removeEventListener("mouseup", handleResizeUp);
            window.removeEventListener("pointermove", handleResizeMove);
            window.removeEventListener("pointerup", handleResizeUp);
            window.removeEventListener("pointercancel", handleResizeUp);
        };
    }, [handleResizeMove, handleResizeUp]);

    const nodeContentElement = (
        <NodeContent
            node={data}
            theme={theme}
            isSelected={isSelected}
            isEditingContent={isEditingContent}
            textareaRef={textareaRef}
            isBatchRoot={isBatchRoot}
            batchCount={batchCount}
            batchExpanded={batchExpanded}
            renderNodeContent={renderNodeContent}
            pluginContext={pluginContext}
            mentionReferences={mentionReferences}
            onContentChange={onContentChange}
            onStopEditing={() => setIsEditingContent(false)}
            onRetry={onRetry}
            onGenerateImage={onGenerateImage}
            onExpandExcelSheets={onExpandExcelSheets}
            excelSheetsExpanded={excelSheetsExpanded}
            excelDetailOpen={excelDetailOpen}
            onToggleExcelSheetDetail={onToggleExcelSheetDetail}
            onToggleBatch={() => onToggleBatch?.(data.id)}
            onSetBatchPrimary={(imageId) => onSetBatchPrimary?.(data.id, imageId)}
            onDuplicateBatchImage={(imageId) => onDuplicateBatchImage?.(data, imageId)}
            onDownloadBatchImage={(imageId) => onDownloadBatchImage?.(data, imageId)}
            onRetryBatchImage={(imageId) => onRetryBatchImage?.(data, imageId)}
            onDeleteBatchImage={(imageId) => onDeleteBatchImage?.(data.id, imageId)}
            groupChildCount={groupChildCount}
            dataGroupActive={isDataGroup}
            viewportScale={effectiveViewportScale}
            lodFullOpacity={fullOpacity}
            mediaShellVisual={mediaShellVisual}
            showLodMedia={showLodMedia && !contentDeferred}
            pluginHost={pluginHost}
        />
    );

    const images = data.metadata?.images || [];
    const primaryImageId = data.metadata?.primaryImageId || images[0]?.id;
    const expandedBatchCards = null;

    const nodeTree = (
        <div
            ref={nodeRootRef}
            data-node-id={data.id}
            data-node-selected={isSelected ? "true" : undefined}
            className="node-element absolute flex select-none flex-col transition-shadow duration-200"
            style={{
                transform: `translate(${data.position.x}px, ${data.position.y}px)`,
                width: data.width,
                height: data.height,
                transition: "box-shadow 200ms ease",
                // 组永远压在普通节点之下（含选中态），否则选中组框会挡住组内子节点，无法单独点选/拖动
                // 星小驰形象保持较高层，避免被其它节点/连线视觉盖住眼睛
                zIndex: isGroup
                    ? 5 + Math.min(stackZIndex, 4)
                    : isXingXiaochi
                      ? 50_000 + stackZIndex + (isSelected ? 1_000_000 : 0)
                      : 10 + stackZIndex + (isSelected ? 1_000_000 : 0),
                // 多图展开时副图会溢出节点框；contain 会在高缩放时撑爆合成层，导致右侧副图被裁掉
                contain: batchExpanded ? undefined : "layout style",
            }}
            onMouseEnter={() => {
                setHovered(true);
                onHoverStart(data.id);
            }}
            onMouseLeave={() => {
                setHovered(false);
                onHoverEnd(data.id);
            }}
            onMouseDownCapture={(event) => onSelectCapture?.(event, data.id)}
            onPointerDownCapture={(event) => {
                if (event.pointerType !== "mouse") onSelectCapture?.(event, data.id);
            }}
            onContextMenu={(event) => onContextMenu(event, data.id)}
        >
            {/* 星小驰等形象节点：名称画在 Content 里，不再叠顶栏标题条 */}
            {!isMind && !isXingXiaochi && (isSelected || hovered || isEditingTitle) && (
                <div className="absolute left-3 top-[-28px] z-[65] max-w-[calc(100%-24px)]" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    {isEditingTitle ? (
                        <input
                            ref={titleInputRef}
                            value={titleDraft}
                            maxLength={64}
                            className="h-6 max-w-full border-0 border-b border-dashed bg-transparent px-0 text-left text-xs font-medium outline-none"
                            style={{ borderColor: theme.node.muted, color: theme.node.text }}
                            onChange={(event) => setTitleDraft(event.target.value)}
                            onBlur={finishTitleEditing}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") finishTitleEditing();
                                if (event.key === "Escape") {
                                    setTitleDraft(data.title || "");
                                    setIsEditingTitle(false);
                                }
                            }}
                        />
                    ) : (
                        <button
                            type="button"
                            className="block max-w-full truncate border-b border-dashed border-transparent px-0 py-0.5 text-left text-xs font-medium opacity-75 transition hover:border-current hover:opacity-100"
                            style={{ color: theme.node.text }}
                            title={t("canvas.node.renameHint")}
                            onDoubleClick={(event) => {
                                event.stopPropagation();
                                setTitleDraft(displayTitle || data.title || "");
                                setIsEditingTitle(true);
                            }}
                        >
                            {displayTitle || t("canvas.node.untitled")}
                        </button>
                    )}
                </div>
            )}

            <div
                className={`relative h-full w-full overflow-visible ${
                    bareShell
                        ? "pointer-events-auto rounded-none border-0"
                        : `rounded-3xl ${shellDominant && (hasImageContent || hasVideoContent) ? "border" : "border-2"}`
                }`}
                style={{
                    touchAction: ownsTouchDrag ? "none" : undefined,
                    background: bareShell
                        ? "transparent"
                        : isGroup
                          ? isDataGroup
                            ? "transparent"
                            : `${theme.toolbar.panel}66`
                          : mediaShellVisual
                            ? "#0c0b0a"
                            : hasImageContent || hasVideoContent || transparentBg
                              ? "transparent"
                              : theme.node.fill,
                    // 缩小时强制保留淡描边，避免透明边图片节点几乎看不见轮廓；导图/拆分片段外形自绘，外壳不再套圆角边框
                    borderColor: bareShell
                        ? "transparent"
                        : isGroup
                          ? isGroupDropTarget
                              ? selectionBlue
                              : isDataGroup
                                ? "#4ade80"
                                : isActive
                                  ? selectionBlue
                                  : theme.node.stroke
                          : shellDominant
                            ? isActive
                                ? selectionBlue
                                : hasImageContent || hasVideoContent
                                  ? "rgba(255,255,255,0.1)"
                                  : theme.node.stroke
                            : hasImageContent
                              ? imageBorderColor
                              : isActive
                                ? selectionBlue
                                : isRelated
                                  ? theme.node.muted
                                  : transparentBg
                                    ? "transparent"
                                    : theme.node.stroke,
                    borderStyle: isGroup ? "dashed" : "solid",
                    boxShadow: bareShell
                        ? isXingXiaochi
                            ? undefined
                            : isCanvasFragment && (isActive || hovered)
                              ? `0 0 0 2px ${isActive ? selectionBlue : `${selectionBlue}99`}`
                              : isCanvasFragment && isRelated
                                ? `0 0 0 1px ${theme.node.muted}88`
                                : undefined
                        : isGroupDropTarget
                          ? `0 0 0 2px ${selectionBlue}66, inset 0 0 0 999px ${selectionBlue}10`
                          : isActive
                            ? `0 0 0 1px ${selectionBlue}55`
                            : isRelated
                              ? `0 0 0 1px ${theme.node.muted}55, 0 18px 48px rgba(0,0,0,.14)`
                              : shellDominant && (hasImageContent || hasVideoContent)
                                ? "0 10px 28px rgba(0,0,0,.28)"
                                : undefined,
                }}
                onMouseDown={(event) => {
                    // 数据组仅边框可拖；中空区域交给上层成员节点
                    if (isDataGroup) return;
                    onMouseDown(event, data.id);
                }}
                onPointerDown={(event) => {
                    if (event.pointerType === "mouse" || isDataGroup) return;
                    onMouseDown(event, data.id);
                }}
                onDoubleClick={(event) => {
                    if (definition?.onDoubleClick && pluginContext) {
                        if (definition.onDoubleClick(pluginContext)) event.stopPropagation();
                        return;
                    }
                    if (data.type === CanvasNodeType.Image && hasImageContent) {
                        event.stopPropagation();
                        onViewImage?.(data);
                        return;
                    }
                    if (data.type !== CanvasNodeType.Text) return;
                    event.stopPropagation();
                    setIsEditingContent(true);
                }}
            >
                <div
                    className={`relative flex h-full w-full items-center justify-center ${
                        bareShell ? "overflow-visible rounded-none" : "overflow-hidden rounded-[inherit]"
                    }`}
                    style={
                        {
                            background: bareShell || isGroup ? "transparent" : mediaShellVisual ? "#0c0b0a" : hasImageContent || hasVideoContent || transparentBg ? "transparent" : theme.node.fill,
                            pointerEvents: isDataGroup ? "none" : contentInteractive ? undefined : "none",
                        } as React.CSSProperties
                    }
                    onMouseDown={(event) => {
                        // 仅「交互」开关打开时拦下拖拽；标题拖动手柄始终可拖节点
                        if (!(supportsInteractionToggle && data.metadata?.interactive)) return;
                        const target = event.target;
                        if (target instanceof Element && target.closest("[data-smart-preview-drag-handle]")) return;
                        event.stopPropagation();
                    }}
                    onPointerDown={(event) => {
                        if (!(supportsInteractionToggle && data.metadata?.interactive)) return;
                        const target = event.target;
                        if (target instanceof Element && target.closest("[data-smart-preview-drag-handle]")) return;
                        event.stopPropagation();
                    }}
                >
                    {isDataGroup ? (
                        <DataGroupBorderDragLayer
                            borderPx={Math.max(10, Math.min(20, 14 / Math.max(effectiveViewportScale, 0.05)))}
                            onMouseDown={(event) => onMouseDown(event, data.id)}
                            onSelectCapture={(event) => onSelectCapture?.(event, data.id)}
                        />
                    ) : null}
                    {showShellLayer ? (
                        <div ref={contentDeferred ? undefined : canvasNodeShellLayerRef} className="absolute inset-0" style={{ opacity: contentDeferred ? 1 : canvasNodeLiveLodOpacity("shell"), zIndex: shellDominant ? 2 : 1 }}>
                            <NodeLodShell node={data} theme={theme} showMedia={showLodMedia && !contentDeferred} viewportScale={effectiveViewportScale} definitionIcon={definition?.icon} />
                        </div>
                    ) : null}
                    {showFullLayer ? (
                        <div
                            ref={fullLayerShown && !mediaPreview && !forceFullContent ? canvasNodeFullLayerRef : undefined}
                            className={
                                !fullLayerShown
                                    ? "pointer-events-none invisible absolute inset-0"
                                    : showShellLayer
                                      ? "absolute inset-0 flex h-full w-full items-center justify-center"
                                      : "relative flex h-full w-full items-center justify-center"
                            }
                            style={{
                                opacity: fullLayerShown ? (mediaPreview || forceFullContent ? 1 : canvasNodeLiveLodOpacity("full")) : 0,
                                visibility: fullLayerShown ? undefined : "hidden",
                                zIndex: fullLayerShown && (!showShellLayer || fullOpacity >= shellOpacity) ? 2 : 1,
                            }}
                            aria-hidden={!fullLayerShown}
                        >
                            <NodeContentActivity mode={contentDeferred && !mediaPreview ? "hidden" : "visible"}>
                                {nodeContentElement}
                            </NodeContentActivity>
                        </div>
                    ) : null}
                </div>

                {data.type === CanvasNodeType.Image && data.metadata?.localEditPreprocess && data.metadata.localEditSelection ? (
                    <div
                        className="pointer-events-none absolute z-30 border-2 border-sky-400/90 shadow-[0_0_0_1px_rgba(0,0,0,.35)]"
                        style={{
                            left: `${data.metadata.localEditSelection.x * 100}%`,
                            top: `${data.metadata.localEditSelection.y * 100}%`,
                            width: `${data.metadata.localEditSelection.width * 100}%`,
                            height: `${data.metadata.localEditSelection.height * 100}%`,
                        }}
                    />
                ) : null}
                {data.type === CanvasNodeType.Video && data.metadata?.videoLocalEdit ? (
                    <div className="pointer-events-none absolute bottom-3 right-8 z-[60]">
                        <span className="rounded-md px-2 py-1 text-[11px] font-medium leading-none backdrop-blur-sm" style={{ background: theme.toolbar.panel, color: theme.node.text, border: `1px solid ${theme.toolbar.border}` }}>局部预处理 · 24fps</span>
                    </div>
                ) : null}
                {data.type === CanvasNodeType.Image && data.metadata?.localEditPreprocess ? (
                    // z 高于右下角缩放手柄(z-50)，并略向内避开角点，否则点击会被手柄吃掉
                    <div className={`pointer-events-auto absolute z-[60] ${showImageInfo && hasImageContent ? "bottom-10 right-8" : "bottom-3 right-8"}`}>
                        <button
                            type="button"
                            className="rounded-md px-2 py-1 text-[11px] font-medium leading-none backdrop-blur-sm transition hover:opacity-90"
                            style={{ background: theme.toolbar.panel, color: theme.node.text, border: `1px solid ${theme.toolbar.border}` }}
                            title={t("canvas.projectPage.maskPreprocessToggleHint")}
                            onPointerDown={(event) => event.stopPropagation()}
                            onMouseDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                            }}
                            onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                onToggleLocalEditView?.(data.id);
                            }}
                        >
                            {data.metadata.localEditViewOriginal ? t("canvas.projectPage.maskPreprocessBadgeOriginal") : t("canvas.projectPage.maskPreprocessBadge")}
                        </button>
                    </div>
                ) : null}
                {data.type === CanvasNodeType.Image && data.metadata?.outpaintPreprocess ? (
                    <div className={`pointer-events-none absolute z-[60] ${showImageInfo && hasImageContent ? "bottom-10 right-8" : "bottom-3 right-8"}`}>
                        <span
                            className="rounded-md px-2 py-1 text-[11px] font-medium leading-none backdrop-blur-sm"
                            style={{ background: theme.toolbar.panel, color: theme.node.text, border: `1px solid ${theme.toolbar.border}` }}
                        >
                            {t("canvas.projectPage.outpaintPreprocessBadge")}
                        </span>
                    </div>
                ) : null}
                {showImageInfo && hasImageContent ? <ImageInfoBar node={data} /> : null}

                {!isGroup && !bareShell && !hasImageContent && !hasVideoContent && !hasAudioContent ? <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12" style={{ background: `linear-gradient(to top, ${theme.canvas.background}66, transparent)` }} /> : null}

                {mindResizeOnTips ? (
                    <MindShapeBorderResize
                        shape={mindShapeName}
                        width={data.width}
                        height={data.height}
                        visible={isSelected || hovered}
                        onResizeMouseDown={handleResizeMouseDown}
                    />
                ) : isXingXiaochi || data.type === CanvasNodeType.Config ? null : (
                    <>
                        <ResizeHandle corner="top-left" onMouseDown={handleResizeMouseDown} />
                        <ResizeHandle corner="top-right" onMouseDown={handleResizeMouseDown} />
                        <ResizeHandle corner="bottom-left" onMouseDown={handleResizeMouseDown} />
                        <ResizeHandle corner="bottom-right" onMouseDown={handleResizeMouseDown} />
                        {!isMind ? (
                            <>
                                <ResizeHandle corner="top" onMouseDown={handleResizeMouseDown} />
                                <ResizeHandle corner="bottom" onMouseDown={handleResizeMouseDown} />
                            </>
                        ) : null}
                    </>
                )}
            </div>

                        {isXingXiaochi ? (
                <XingSurfaceWireRing node={data} onConnectStart={(event) => onConnectStart(event, data.id, "source")} />
            ) : null}
            {!isGroup && !(isMind && isAnnotationNode(data)) && !isXingXiaochi ? (
                <ConnectionHandleDot
                    side="left"
                    tipInset={mindResizeOnTips ? mindTipInset?.left : undefined}
                    outwardPx={mindResizeOnTips ? 10 : 0}
                    compact={isMind}
                    visible={hovered || isConnecting || (isSelected && !isXingXiaochi) || (isMind && isMindSideCollapsed(data, "left"))}
                    collapseEnabled={isMind && !isAnnotationNode(data)}
                    collapsed={isMind && isMindSideCollapsed(data, "left")}
                    collapseTitle={t("canvas.mindMap.collapseBranch")}
                    expandTitle={t("canvas.mindMap.expandBranch")}
                    onToggleCollapse={() => onToggleMindCollapse?.(data.id, "left")}
                    onMouseDown={(event) => onConnectStart(event, data.id, "target", "left")}
                />
            ) : null}
            {isMind ? (
                <>
                    <ConnectionHandleDot
                        side="top"
                        tipInset={mindResizeOnTips ? mindTipInset?.top : undefined}
                        outwardPx={mindResizeOnTips ? 10 : 0}
                        compact
                        visible={isSelected || isConnecting || isMindSideCollapsed(data, "top") || (hovered && isAnnotationNode(data))}
                        collapseEnabled={!isAnnotationNode(data)}
                        collapsed={isMindSideCollapsed(data, "top")}
                        collapseTitle={t("canvas.mindMap.collapseBranch")}
                        expandTitle={t("canvas.mindMap.expandBranch")}
                        onToggleCollapse={() => onToggleMindCollapse?.(data.id, "top")}
                        onMouseDown={(event) => onConnectStart(event, data.id, "source", "top")}
                    />
                    <ConnectionHandleDot
                        side="bottom"
                        tipInset={mindResizeOnTips ? mindTipInset?.bottom : undefined}
                        outwardPx={mindResizeOnTips ? 10 : 0}
                        compact
                        visible={isSelected || isConnecting || isMindSideCollapsed(data, "bottom") || (hovered && isAnnotationNode(data))}
                        collapseEnabled={!isAnnotationNode(data)}
                        collapsed={isMindSideCollapsed(data, "bottom")}
                        collapseTitle={t("canvas.mindMap.collapseBranch")}
                        expandTitle={t("canvas.mindMap.expandBranch")}
                        onToggleCollapse={() => onToggleMindCollapse?.(data.id, "bottom")}
                        onMouseDown={(event) => onConnectStart(event, data.id, "source", "bottom")}
                    />
                </>
            ) : null}
            {isExcelDoc ? (
                <ExcelExpandHandle
                    visible={hovered || isSelected || isConnecting || excelSheetsExpanded}
                    expanded={excelSheetsExpanded}
                    expandLabel={t("canvas.node.excelExpand")}
                    collapseLabel={t("canvas.node.excelCollapse")}
                    dragConnectLabel={t("canvas.node.excelHandleDragConnect")}
                    onToggle={() => onExpandExcelSheets?.(data)}
                    onConnectStart={(event) => onConnectStart(event, data.id, "source")}
                />
            ) : isExcelSheet ? (
                <ExcelExpandHandle
                    visible={hovered || isSelected || isConnecting || excelDetailOpen}
                    expanded={excelDetailOpen}
                    expandLabel={t("canvas.node.excelExpandDetail")}
                    collapseLabel={t("canvas.node.excelCollapseDetail")}
                    dragConnectLabel={t("canvas.node.excelHandleDragConnect")}
                    onToggle={() => {
                        const next = !excelDetailOpen;
                        setExcelDetailOpen(next);
                        onToggleExcelSheetDetail?.(data.id, next);
                    }}
                    onConnectStart={(event) => onConnectStart(event, data.id, "source")}
                />
            ) : isDataGroup ? (
                <ConnectionHandleDot side="right" visible={hovered || isConnecting || (isSelected && !isXingXiaochi)} onMouseDown={(event) => onConnectStart(event, data.id, "source", "right")} />
            ) : !isGroup && !(isMind && isAnnotationNode(data)) && !isXingXiaochi ? (
                <ConnectionHandleDot
                    side="right"
                    tipInset={mindResizeOnTips ? mindTipInset?.right : undefined}
                    outwardPx={mindResizeOnTips ? 10 : 0}
                    compact={isMind}
                    visible={(definition?.hasSourceHandle ?? true) && data.type !== CanvasNodeType.Config && (hovered || isConnecting || (isSelected && !isXingXiaochi) || (isMind && isMindSideCollapsed(data, "right")))}
                    collapseEnabled={isMind && !isAnnotationNode(data)}
                    collapsed={isMind && isMindSideCollapsed(data, "right")}
                    collapseTitle={t("canvas.mindMap.collapseBranch")}
                    expandTitle={t("canvas.mindMap.expandBranch")}
                    onToggleCollapse={() => onToggleMindCollapse?.(data.id, "right")}
                    onMouseDown={(event) => onConnectStart(event, data.id, "source", "right")}
                />
            ) : null}

            {(hasVideoContent && isSelected && preferFullContent) || (hasAudioContent && isSelected && preferFullContent) || (showPanel && !isGroup && renderPanel) ? (
                <div
                    className="pointer-events-none absolute left-1/2 top-full z-[70] flex -translate-x-1/2 flex-col gap-2 pt-2"
                    style={{ width: belowPanelWidth, maxWidth: `min(${belowPanelWidth}px, calc(100vw - 24px))` }}
                >
                    {hasVideoContent && isSelected && preferFullContent ? (
                        <div className="pointer-events-auto min-w-0">
                            <CanvasVideoDock onCaptureFrame={(blob) => onCaptureVideoFrame?.(data, blob)} />
                        </div>
                    ) : null}
                    {hasAudioContent && isSelected && preferFullContent ? (
                        <div className="pointer-events-auto min-w-0">
                            <CanvasAudioDock />
                        </div>
                    ) : null}
                    {showPanel && !isGroup && renderPanel ? <div className="pointer-events-auto w-full min-w-0">{renderPanel(data)}</div> : null}
                </div>
            ) : null}
        </div>
    );

    if (hasVideoContent && data.metadata?.content && showFullLayer) {
        return (
            <CanvasVideoPlayerProvider
                nodeId={data.id}
                selected={isSelected}
                src={data.metadata.content}
                clipStartMs={data.metadata.clipStartMs}
                clipEndMs={data.metadata.clipEndMs}
                includeAudio={data.metadata.includeAudio !== false}
                onClipChange={(next) => onVideoClipChange?.(data.id, next)}
            >
                {nodeTree}
                {expandedBatchCards}
            </CanvasVideoPlayerProvider>
        );
    }
    if (hasAudioContent && data.metadata?.content && showFullLayer) {
        return (
            <CanvasAudioPlayerProvider
                nodeId={data.id}
                selected={isSelected}
                src={data.metadata.content}
                clipStartMs={data.metadata.clipStartMs}
                clipEndMs={data.metadata.clipEndMs}
                onClipChange={(next) => onAudioClipChange?.(data.id, next)}
            >
                {nodeTree}
                {expandedBatchCards}
            </CanvasAudioPlayerProvider>
        );
    }
    return (
        <>
            {nodeTree}
            {expandedBatchCards}
        </>
    );
});

function getLodPreviewSrc(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Image) {
        const images = node.metadata?.images || [];
        const primaryId = node.metadata?.primaryImageId || images[0]?.id;
        const primary = images.find((image) => image.id === primaryId);
        return primary?.content || node.metadata?.content || "";
    }
    if (node.type === CanvasNodeType.Video) return node.metadata?.content || "";
    return "";
}

function NodeLodShell({
    node,
    theme,
    showMedia,
    viewportScale,
    definitionIcon,
}: {
    node: CanvasNodeData;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    showMedia: boolean;
    viewportScale: number;
    definitionIcon?: ReactNode;
}) {
    const { t } = useTranslation();
    const previewSrc = showMedia ? getLodPreviewSrc(node) : "";
    const [videoRevealed, setVideoRevealed] = useState(false);
    const videoRevealedRef = useRef(false);

    useLayoutEffect(() => {
        videoRevealedRef.current = false;
        setVideoRevealed(false);
    }, [previewSrc]);

    const revealVideo = useCallback(() => {
        if (videoRevealedRef.current || !previewSrc) return;
        videoRevealedRef.current = true;
        scheduleOpacityFadeIn(() => setVideoRevealed(true));
    }, [previewSrc]);

    if (previewSrc && node.type === CanvasNodeType.Image) {
        return (
            <div className="relative h-full w-full overflow-hidden rounded-[inherit] bg-[#0c0b0a]">
                <CanvasNodeImage
                    src={previewSrc}
                    storageKey={node.metadata?.storageKey}
                    viewportScale={viewportScale}
                    nodeWidth={node.width}
                    nodeHeight={node.height}
                    naturalWidth={node.metadata?.naturalWidth}
                    naturalHeight={node.metadata?.naturalHeight}
                    mimeType={node.metadata?.mimeType}
                    lodFullOpacity={0}
                    alt=""
                    className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
                />
                {(node.title || "").trim() ? (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-3 pb-2 pt-10">
                        <div className="truncate text-left text-xs font-medium text-white/95">{node.title}</div>
                    </div>
                ) : null}
            </div>
        );
    }

    if (previewSrc && node.type === CanvasNodeType.Video) {
        return (
            <div className="relative h-full w-full overflow-hidden rounded-[inherit] bg-black">
                <video
                    key={previewSrc}
                    src={previewSrc}
                    muted
                    playsInline
                    preload="metadata"
                    draggable={false}
                    onLoadedData={revealVideo}
                    ref={(element) => {
                        if (element && element.readyState >= 2) revealVideo();
                    }}
                    className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity ease-out ${videoRevealed ? "opacity-100" : "opacity-0"}`}
                    style={{ transitionDuration: `${CANVAS_IMAGE_FADE_MS}ms` }}
                />
                {(node.title || "").trim() ? (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-3 pb-2 pt-10">
                        <div className="truncate text-left text-xs font-medium text-white/95">{node.title}</div>
                    </div>
                ) : null}
            </div>
        );
    }

    const icon =
        definitionIcon ||
        (node.type === CanvasNodeType.Image ? (
            <ImageIcon className="size-8" />
        ) : node.type === CanvasNodeType.Video ? (
            <Video className="size-8" />
        ) : node.type === CanvasNodeType.Audio ? (
            <Music2 className="size-8" />
        ) : node.type === CanvasNodeType.Group ? (
            <Group className="size-8" />
        ) : node.metadata?.documentKind === "excel" || node.metadata?.excelParentId ? (
            <Sheet className="size-8" />
        ) : (
            <Puzzle className="size-8" />
        ));
    const lodBare = node.type === CODEX_IMAGE_NODE_TYPE;
    return (
        <div
            className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center"
            style={{ color: theme.node.muted, background: lodBare ? "transparent" : theme.node.fill }}
        >
            <div className={lodBare ? "opacity-100 [&_svg]:size-10" : "opacity-80 [&_svg]:size-8"}>{icon}</div>
            {!lodBare ? (
                <div className="max-w-full truncate text-xs font-medium" style={{ color: theme.node.text }} title={node.title || t("canvas.node.untitled")}>
                    {node.title || t("canvas.node.untitled")}
                </div>
            ) : null}
        </div>
    );
}

function NodeContent(props: NodeContentRendererProps) {
    if (props.node.type === CanvasNodeType.Config && props.renderNodeContent) return props.renderNodeContent(props.node);
    if (props.isBatchRoot) return <ImageNodeContent {...props} />;
    if (props.node.metadata?.status === "loading") return <LoadingContent theme={props.theme} />;
    if (props.node.metadata?.status === "error") return <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} />;

    const Renderer = nodeContentRenderers[props.node.type as CanvasNodeType];
    if (Renderer) return <Renderer {...props} />;

    // Render plugin nodes with their registered renderer, or show the missing-plugin placeholder.
    const definition = getNodeDefinition(props.node.type);
    if (definition?.Content && props.pluginContext) {
        const PluginContent = definition.Content;
        return <PluginContent ctx={props.pluginContext} />;
    }
    return <MissingPluginContent theme={props.theme} type={props.node.type} />;
}

const nodeContentRenderers = {
    [CanvasNodeType.Text]: TextContent,
    [CanvasNodeType.Image]: ImageNodeContent,
    [CanvasNodeType.Config]: EmptyImageContent,
    [CanvasNodeType.Video]: VideoNodeContent,
    [CanvasNodeType.Audio]: AudioNodeContent,
    [CanvasNodeType.Group]: GroupNodeContent,
} satisfies Record<CanvasNodeType, (props: NodeContentRendererProps) => ReactNode>;

function GroupNodeContent({ node, theme, groupChildCount, dataGroupActive }: NodeContentRendererProps) {
    const { t } = useTranslation();
    const isData = Boolean(dataGroupActive) || node.metadata?.groupKind === "data" || Boolean(node.metadata?.groupBundleText || node.metadata?.content);
    // 智能打组仅靠外框绿色虚线标识，内部不放标题/说明（成员节点叠在框内显示）
    if (isData) return <div className="pointer-events-none h-full w-full" />;
    return (
        <div className="pointer-events-none flex h-full w-full flex-col p-4">
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: theme.node.text }}>
                <span className="grid size-8 place-items-center rounded-xl" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
                    <Group className="size-4" />
                </span>
                <span>{t("canvas.node.group")}</span>
                <span className="ml-auto rounded-full px-2 py-1 text-[11px] font-medium" style={{ background: theme.node.fill, color: theme.node.muted }}>
                    {t("canvas.node.nodeCount", { count: groupChildCount })}
                </span>
            </div>
            <div className="mt-3 flex-1 rounded-2xl border border-dashed" style={{ borderColor: theme.node.stroke, background: `${theme.node.fill}55` }} />
        </div>
    );
}

function DataGroupBorderDragLayer({
    borderPx,
    onMouseDown,
    onSelectCapture,
}: {
    borderPx: number;
    onMouseDown: (event: NodePressEvent) => void;
    onSelectCapture: (event: NodePressEvent) => void;
}) {
    const strip = (className: string, style: React.CSSProperties) => (
        <div
            className={`pointer-events-auto absolute z-20 cursor-grab active:cursor-grabbing ${className}`}
            style={style}
            onMouseDownCapture={(event) => onSelectCapture(event)}
            onMouseDown={onMouseDown}
            onPointerDownCapture={(event) => {
                if (event.pointerType !== "mouse") onSelectCapture(event);
            }}
            onPointerDown={(event) => {
                if (event.pointerType !== "mouse") onMouseDown(event);
            }}
        />
    );
    return (
        <>
            {strip("left-0 right-0 top-0", { height: borderPx })}
            {strip("bottom-0 left-0 right-0", { height: borderPx })}
            {strip("bottom-0 left-0 top-0", { width: borderPx })}
            {strip("bottom-0 right-0 top-0", { width: borderPx })}
        </>
    );
}

function LoadingContent({ theme }: Pick<NodeContentRendererProps, "theme">) {
    const { t } = useTranslation();
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.activeStroke }}>
            <div className="size-10 animate-spin rounded-full border-2" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />
            <span className="text-[10px] tracking-[0.2em]">{t("canvas.node.generating")}</span>
        </div>
    );
}

function ErrorContent({ node, theme, onRetry }: Pick<NodeContentRendererProps, "node" | "theme" | "onRetry">) {
    const { t } = useTranslation();
    const detail = (node.metadata?.errorDetails || "").trim() || t("canvas.node.failed");
    return (
        <div className="flex max-w-[260px] flex-col items-center gap-3 px-5 text-center">
            <GenerationErrorText detail={detail} className="text-xs leading-5 text-red-300" />
            <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition hover:scale-[1.02]"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                onClick={(event) => {
                    event.stopPropagation();
                    onRetry?.(node);
                }}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <RefreshCw className="size-3.5" />
                {t("canvas.node.retry")}
            </button>
        </div>
    );
}

function MissingPluginContent({ theme, type }: Pick<NodeContentRendererProps, "theme"> & { type: string }) {
    const { t } = useTranslation();
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: theme.node.placeholder }}>
            <Puzzle className="size-7 opacity-40" />
            <span className="text-sm">{t("canvas.node.missingPlugin")}</span>
            <span className="text-[11px] opacity-70">{t("canvas.node.missingPluginDescription", { type })}</span>
        </div>
    );
}

function TextContent({
    node,
    theme,
    isEditingContent,
    textareaRef,
    mentionReferences,
    onContentChange,
    onStopEditing,
    onGenerateImage,
    excelDetailOpen = false,
}: NodeContentRendererProps) {
    const { t } = useTranslation();
    const content = node.metadata?.content || "";
    const excelSheets = node.metadata?.excelSheets || [];
    const isExcelDoc = node.metadata?.documentKind === "excel" && excelSheets.length > 0;
    const isExcelSheet = Boolean(node.metadata?.excelParentId);
    const excelPreview = node.metadata?.excelPreview || [];
    const fontSize = node.metadata?.fontSize || 14;
    const textStyle = { fontSize: `${fontSize}px`, lineHeight: `${Math.round(fontSize * 1.65)}px`, color: theme.node.text, boxSizing: "border-box" } as React.CSSProperties;
    const heavyPlainText = !isExcelDoc && !isExcelSheet && content.length > 12_000;

    return (
        <div className="flex h-full w-full flex-col overflow-hidden pt-8">
            <button
                type="button"
                className="absolute right-3 top-3 z-20 inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium opacity-85 backdrop-blur-md transition hover:scale-[1.02] hover:opacity-100"
                style={{ background: `${theme.toolbar.panel}dd`, borderColor: theme.node.stroke, color: theme.node.text }}
                onClick={(event) => {
                    event.stopPropagation();
                    onGenerateImage?.(node);
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={t("canvas.node.generateImage")}
                aria-label={t("canvas.node.generateImage")}
            >
                <ImageIcon className="size-3.5" />
                {t("canvas.node.generate")}
            </button>
            {isEditingContent ? (
                <CanvasResourceMentionTextarea
                    ref={textareaRef}
                    className="thin-scrollbar block h-full w-full resize-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent pl-4 pr-14 pt-0 pb-4 m-0 font-mono outline-none select-text appearance-none"
                    style={textStyle}
                    value={node.metadata?.content || ""}
                    references={mentionReferences}
                    highlightLabels={false}
                    onChange={(value) => onContentChange(node.id, value)}
                    onBlur={onStopEditing}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") onStopEditing();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                />
            ) : isExcelDoc ? (
                <div className="flex h-full w-full flex-col gap-3 overflow-hidden px-4 pb-4 pr-14 pt-0" style={{ color: theme.node.text }}>
                    <div className="flex items-start gap-2.5">
                        <span className="grid size-9 shrink-0 place-items-center" style={{ color: theme.node.muted }}>
                            <Sheet className="size-5" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">{node.title || t("canvas.node.excelTitle")}</div>
                            <div className="mt-0.5 text-[11px]" style={{ color: theme.node.muted }}>
                                {t("canvas.node.excelSheetCount", { count: excelSheets.length })}
                            </div>
                        </div>
                    </div>
                    <div className="thin-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto" onWheel={handleNodeContentWheel}>
                        {excelSheets.map((sheet, index) => (
                            <div key={`${sheet.name}-${index}`} className="flex items-center gap-2 truncate text-xs" style={{ color: theme.node.muted }}>
                                <span className="truncate" style={{ color: theme.node.text }}>{sheet.name}</span>
                                <span className="shrink-0 opacity-70">{t("canvas.node.excelSheetSize", { rows: sheet.rowCount, cols: sheet.colCount })}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ) : isExcelSheet ? (
                <ExcelSheetPreviewContent
                    theme={theme}
                    title={node.title}
                    preview={excelPreview}
                    fallbackText={content}
                    rowCount={node.metadata?.excelRowCount || 0}
                    colCount={node.metadata?.excelColCount || 0}
                    detailOpen={excelDetailOpen}
                    colWidths={node.metadata?.excelColWidths}
                    rowHeights={node.metadata?.excelRowHeights}
                    merges={node.metadata?.excelMerges}
                    styles={node.metadata?.excelStyles}
                />
            ) : content ? (
                <div className="thin-scrollbar block h-full w-full overflow-y-auto break-words bg-transparent pl-4 pr-14 pt-0 pb-4" style={textStyle} onWheel={handleNodeContentWheel}>
                    {heavyPlainText ? (
                        <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[12px] leading-5">{content.slice(0, 8_000)}{content.length > 8_000 ? "\n…" : ""}</pre>
                    ) : (
                        <Streamdown className="agent-streamdown canvas-text-md" controls={false} linkSafety={{ enabled: false }} lineNumbers={false}>
                            {content}
                        </Streamdown>
                    )}
                </div>
            ) : (
                <div className="thin-scrollbar block h-full w-full overflow-y-auto bg-transparent pl-4 pr-14 pt-0 pb-4" style={textStyle}>
                    <span style={{ color: theme.node.placeholder }}>{t("canvas.node.editText")}</span>
                </div>
            )}
        </div>
    );
}

const EXCEL_COLLAPSE_ROWS = 8;
const EXCEL_COLLAPSE_COLS = 6;

function ExcelSheetPreviewContent({
    theme,
    title,
    preview,
    fallbackText,
    rowCount,
    colCount,
    detailOpen,
    colWidths,
    rowHeights,
    merges,
    styles,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    title: string;
    preview: Array<Array<{ text: string; imageUrl?: string; s?: number } | string | null | undefined>>;
    fallbackText: string;
    rowCount: number;
    colCount: number;
    detailOpen: boolean;
    colWidths?: number[];
    rowHeights?: number[];
    merges?: Array<{ r: number; c: number; rs: number; cs: number }>;
    styles?: Array<{ bg?: string; color?: string; bold?: boolean }>;
}) {
    const { t } = useTranslation();
    const rows = useMemo(() => buildExcelPreviewRows(preview, fallbackText), [preview, fallbackText]);
    const cachedRows = rows.length;
    const cachedCols = rows[0]?.length || 0;
    const fullLoaded = cachedRows >= rowCount && cachedCols >= colCount && rowCount > 0;
    const collapsedRows = Math.min(EXCEL_COLLAPSE_ROWS, cachedRows);
    const collapsedCols = Math.min(EXCEL_COLLAPSE_COLS, cachedCols);
    const clipped = detailOpen ? !fullLoaded : rowCount > collapsedRows || colCount > collapsedCols;

    return (
        <div className="flex h-full w-full flex-col overflow-hidden px-3 pb-3 pr-14 pt-0" style={{ color: theme.node.text }}>
            <div className="mb-2 flex items-center gap-2 text-[11px]" style={{ color: theme.node.muted }}>
                <Sheet className="size-3.5 shrink-0" />
                <span className="truncate">{title || t("canvas.node.excelTitle")}</span>
                {rowCount || colCount ? <span className="shrink-0">{t("canvas.node.excelSheetSize", { rows: rowCount, cols: colCount })}</span> : null}
            </div>
            {cachedRows ? (
                <div className="min-h-0 flex-1">
                    <ExcelVirtualSheet rows={rows} detailOpen={detailOpen} collapseRows={EXCEL_COLLAPSE_ROWS} collapseCols={EXCEL_COLLAPSE_COLS} colWidths={colWidths} rowHeights={rowHeights} merges={merges} styles={styles} />
                </div>
            ) : (
                <div className="text-xs" style={{ color: theme.node.placeholder }}>{t("canvas.node.excelEmptySheet")}</div>
            )}
            <div className="mt-2 shrink-0 truncate text-[10px]" style={{ color: theme.node.muted }}>
                {detailOpen
                    ? clipped
                        ? t("canvas.node.excelFullTruncated", { rows: cachedRows, cols: cachedCols })
                        : t("canvas.node.excelFullLoaded", { rows: cachedRows, cols: cachedCols })
                    : clipped
                      ? t("canvas.node.excelPreviewHint", { rows: collapsedRows || EXCEL_COLLAPSE_ROWS, cols: collapsedCols || EXCEL_COLLAPSE_COLS })
                      : t("canvas.node.excelSheetSize", { rows: collapsedRows, cols: collapsedCols })}
            </div>
        </div>
    );
}

function buildExcelPreviewRows(
    preview: Array<Array<{ text: string; imageUrl?: string } | string | null | undefined>>,
    fallbackText: string,
) {
    if (preview?.length) {
        return preview.map((row) => (Array.isArray(row) ? row : [row]).map((cell) => normalizeExcelPreviewCell(cell)));
    }
    return fallbackText
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .slice(0, 2000)
        .map((line) => line.split("\t").slice(0, 200).map((text) => ({ text, imageUrl: undefined as string | undefined })));
}

function normalizeExcelPreviewCell(cell: { text?: string; imageUrl?: string; s?: number } | string | null | undefined) {
    if (typeof cell === "string") return { text: cell, imageUrl: undefined as string | undefined };
    if (!cell || typeof cell !== "object") return { text: "", imageUrl: undefined as string | undefined };
    return { text: cell.text ?? "", imageUrl: cell.imageUrl, s: cell.s };
}

function ImageNodeContent(props: NodeContentRendererProps) {
    if (!props.node.metadata?.content && !props.isBatchRoot) return <EmptyImageContent {...props} />;

    return (
        <ImageContent
            node={props.node}
            batchExpanded={props.batchExpanded}
            isSelected={props.isSelected}
            pluginHost={props.pluginHost}
            viewportScale={props.viewportScale}
            lodFullOpacity={props.lodFullOpacity}
            mediaShellVisual={props.mediaShellVisual}
            showLodMedia={props.showLodMedia}
            onToggleBatch={props.onToggleBatch}
            onRetryBatchImage={props.onRetryBatchImage}
            onDeleteBatchImage={props.onDeleteBatchImage}
        />
    );
}

function EmptyImageContent({ theme }: NodeContentRendererProps) {
    const { t } = useTranslation();
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
            <div className="flex size-14 items-center justify-center rounded-2xl" style={{ background: theme.toolbar.activeBg }}>
                <ImageIcon className="size-6 opacity-30" />
            </div>
            <span className="text-[10px] tracking-[0.18em] opacity-50">{t("canvas.node.emptyImage")}</span>
        </div>
    );
}

function MediaLodTitleBar({ title }: { title: string }) {
    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-3 pb-2 pt-10">
            <div className="truncate text-left text-xs font-medium text-white/95">{title}</div>
        </div>
    );
}

function VideoNodeContent({ node, theme, mediaShellVisual = false, showLodMedia = true }: NodeContentRendererProps) {
    const { t } = useTranslation();
    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
                <Video className="size-7 opacity-35" />
                <span className="text-sm">{t("canvas.node.emptyVideo")}</span>
            </div>
        );
    const title = (node.title || "").trim();
    const showMedia = !mediaShellVisual || showLodMedia;
    return (
        <div className={`relative h-full w-full overflow-hidden rounded-[inherit] ${mediaShellVisual ? "bg-black" : ""}`}>
            <CanvasVideoSurface className={`h-full w-full rounded-[18px] bg-black ${mediaShellVisual ? "object-cover" : "object-contain"} ${showMedia ? "" : "invisible"}`} />
            {mediaShellVisual && !showLodMedia ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center" style={{ color: theme.node.placeholder }}>
                    <Video className="size-8 opacity-35" />
                </div>
            ) : null}
            {mediaShellVisual && title && showLodMedia ? <MediaLodTitleBar title={title} /> : null}
        </div>
    );
}

function AudioNodeContent({ node, theme }: NodeContentRendererProps) {
    const { t } = useTranslation();
    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ color: theme.node.placeholder }}>
                <Music2 className="size-7 opacity-35" />
                <span className="text-sm">{t("canvas.node.emptyAudio")}</span>
            </div>
        );
    return <CanvasAudioSurface title={(node.title || "").trim() || t("canvas.node.audio")} />;
}

function ImageContent({
    node,
    batchExpanded,
    isSelected = false,
    pluginHost,
    viewportScale = 1,
    lodFullOpacity = 1,
    mediaShellVisual = false,
    showLodMedia = true,
    onRetryBatchImage,
    onDeleteBatchImage,
}: {
    node: CanvasNodeData;
    batchExpanded?: boolean;
    isSelected?: boolean;
    pluginHost?: CanvasPluginHost;
    viewportScale?: number;
    lodFullOpacity?: number;
    mediaShellVisual?: boolean;
    showLodMedia?: boolean;
    onToggleBatch?: () => void;
    onRetryBatchImage?: (imageId: string) => void;
    onDeleteBatchImage?: (imageId: string) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const images = node.metadata?.images || [];
    const primaryImageId = node.metadata?.primaryImageId || images[0]?.id;
    const primaryImage = images.find((image) => image.id === primaryImageId);
    const primaryContent = primaryImage?.content || node.metadata?.content;
    const resultStorageKey = primaryImage?.storageKey || node.metadata?.storageKey;
    const title = (node.title || "").trim();
    const showMedia = !mediaShellVisual || showLodMedia;
    const fitClass = node.metadata?.freeResize ? "object-fill" : mediaShellVisual ? "object-cover" : "object-contain";

    return (
        <div className={`relative h-full w-full overflow-hidden rounded-[inherit] ${mediaShellVisual ? "bg-[#0c0b0a]" : ""}`}>
            <div className="relative h-full w-full overflow-hidden rounded-3xl">
                {primaryContent ? (
                    <CanvasNodeImage
                        src={primaryContent}
                        storageKey={resultStorageKey}
                        alt={node.title}
                        viewportScale={viewportScale}
                        lodFullOpacity={lodFullOpacity}
                        nodeWidth={node.width}
                        nodeHeight={node.height}
                        naturalWidth={primaryImage?.naturalWidth || node.metadata?.naturalWidth}
                        naturalHeight={primaryImage?.naturalHeight || node.metadata?.naturalHeight}
                        mimeType={primaryImage?.mimeType || node.metadata?.mimeType}
                        enabled={showMedia}
                        draggable={false}
                        onDragStart={(event) => event.preventDefault()}
                        className={`pointer-events-none block h-full w-full select-none ${fitClass} ${showMedia ? "" : "invisible"}`}
                    />
                ) : (
                    <ImageSlotStatus image={primaryImage} />
                )}
                {primaryContent && showMedia ? (
                    <ImageTaskCompareLayer
                        node={node}
                        pluginHost={pluginHost}
                        resultUrl={primaryContent}
                        resultStorageKey={resultStorageKey}
                        pinned={isSelected}
                    />
                ) : null}
            </div>
            {mediaShellVisual && !showLodMedia ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center" style={{ color: theme.node.placeholder }}>
                    <ImageIcon className="size-8 opacity-35" />
                </div>
            ) : null}
            {mediaShellVisual && title && showLodMedia ? <MediaLodTitleBar title={title} /> : null}
            {primaryImage?.status === "error" ? <BatchImageFailureActions placement="left" onRetry={() => onRetryBatchImage?.(primaryImage.id)} onDelete={() => onDeleteBatchImage?.(primaryImage.id)} /> : null}
        </div>
    );
}

function BatchImageFailureActions({ placement, onRetry, onDelete }: { placement: "left" | "right"; onRetry: () => void; onDelete: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    return (
        <div className={`absolute top-3 z-30 flex items-center gap-1.5 ${placement === "left" ? "left-3" : "right-3"}`}>
            <button type="button" className="flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium shadow-sm transition hover:scale-[1.02]" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onClick={(event) => (event.stopPropagation(), onRetry())}>
                <RefreshCw className="size-3.5" />
                {t("canvas.node.retry")}
            </button>
            <button type="button" className="grid size-8 place-items-center rounded-lg border shadow-sm transition hover:scale-[1.02]" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onClick={(event) => (event.stopPropagation(), onDelete())} aria-label={t("common.delete")} title={t("common.delete")}>
                <Trash2 className="size-3.5" />
            </button>
        </div>
    );
}

function ImageSlotStatus({ image }: { image?: CanvasNodeImageData }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { t } = useTranslation();
    const failed = image?.status === "error";
    const detail = (image?.errorDetails || "").trim() || t("canvas.node.failed");
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center" style={{ background: theme.node.fill, color: failed ? theme.node.text : theme.node.activeStroke }}>
            {failed ? <GenerationErrorText detail={detail} className="text-xs leading-5 text-red-300" /> : <div className="size-10 animate-spin rounded-full border-2" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />}
            {!failed ? <span className="text-[10px] tracking-[0.2em]">{t("canvas.node.generating")}</span> : null}
        </div>
    );
}

/** 节点内展示简短错误；悬停用 title 看完整原文，便于区分渠道商与本地问题。 */
function GenerationErrorText({ detail, className }: { detail: string; className?: string }) {
    const { t } = useTranslation();
    const short = detail.length > 96 ? `${detail.slice(0, 96)}…` : detail;
    return (
        <span className={`cursor-help break-words ${className || ""}`} title={detail} aria-label={detail}>
            {short}
            {detail.length > 96 ? <span className="mt-1 block text-[10px] opacity-70">{t("canvas.node.errorHoverHint")}</span> : null}
        </span>
    );
}

function ImageInfoBar({ node }: { node: CanvasNodeData }) {
    const width = Math.round(node.metadata?.naturalWidth || node.width);
    const height = Math.round(node.metadata?.naturalHeight || node.height);
    const size = formatBytes(node.metadata?.bytes || 0);
    return (
        <div className="pointer-events-none absolute bottom-3 right-3 z-40 max-w-[calc(100%-24px)]">
            <span className="max-w-full truncate rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium leading-none text-white backdrop-blur-sm">
                {width} x {height}
                {size ? ` · ${size}` : ""}
            </span>
        </div>
    );
}

function MindShapeBorderResize({
    shape,
    width,
    height,
    visible,
    onResizeMouseDown,
}: {
    shape: string;
    width: number;
    height: number;
    visible: boolean;
    onResizeMouseDown: (event: NodePressEvent, corner: ResizeCorner) => void;
}) {
    const poly = mindShapePolyPoints(shape);
    if (!visible) return null;

    const startResize = (event: React.MouseEvent<SVGElement> | React.PointerEvent<SVGElement>) => {
        event.stopPropagation();
        event.preventDefault();
        const svg = event.currentTarget.ownerSVGElement;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const localX = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * width;
        const localY = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * height;
        const corner = nearestMindResizeCorner(shape, localX, localY, width, height);
        onResizeMouseDown(event, corner);
    };

    return (
        <svg className="pointer-events-none absolute inset-0 z-40 h-full w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
            {poly ? (
                <polygon
                    points={poly
                        .split(/\s+/)
                        .map((pair) => {
                            const [px, py] = pair.split(",").map(Number);
                            return `${(px / 100) * width},${(py / 100) * height}`;
                        })
                        .join(" ")}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={16}
                    className="pointer-events-stroke cursor-nwse-resize"
                    style={{ pointerEvents: "stroke" }}
                    onMouseDown={startResize}
                    onPointerDown={(event) => {
                        if (event.pointerType !== "mouse") startResize(event);
                    }}
                />
            ) : (
                <ellipse
                    cx={width / 2}
                    cy={height / 2}
                    rx={width / 2}
                    ry={height / 2}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={16}
                    style={{ pointerEvents: "stroke", cursor: "nwse-resize" }}
                    onMouseDown={startResize}
                    onPointerDown={(event) => {
                        if (event.pointerType !== "mouse") startResize(event);
                    }}
                />
            )}
        </svg>
    );
}

function ResizeHandle({ corner, onMouseDown }: { corner: ResizeCorner; onMouseDown: (event: NodePressEvent, corner: ResizeCorner) => void }) {
    const positionClass = {
        "top-left": "-left-[14px] -top-[14px] cursor-nwse-resize",
        "top-right": "-right-[14px] -top-[14px] cursor-nesw-resize",
        "bottom-left": "-bottom-[14px] -left-[14px] cursor-nesw-resize",
        "bottom-right": "-bottom-[14px] -right-[14px] cursor-nwse-resize",
        top: "left-1/2 -top-[14px] -translate-x-1/2 cursor-ns-resize",
        bottom: "left-1/2 -bottom-[14px] -translate-x-1/2 cursor-ns-resize",
        left: "top-1/2 -left-[14px] -translate-y-1/2 cursor-ew-resize",
        right: "top-1/2 -right-[14px] -translate-y-1/2 cursor-ew-resize",
    }[corner];

    return (
        <div
            className={`canvas-touch-resize-handle absolute z-50 size-7 ${positionClass}`}
            onMouseDown={(event) => onMouseDown(event, corner)}
            onPointerDown={(event) => {
                if (event.pointerType !== "mouse") onMouseDown(event, corner);
            }}
        />
    );
}


/** 星小驰：轮廓外环起线（中空透传拖动），落点仍为表面任意吸附 */
function XingSurfaceWireRing({
    node,
    onConnectStart,
}: {
    node: CanvasNodeData;
    onConnectStart: (event: NodePressEvent) => void;
}) {
    const body = getXingBodyRect(node);
    const pad = 0.03;
    const ox = Math.max(0, body.x - pad);
    const oy = Math.max(0, body.y - pad);
    const ow = Math.min(1 - ox, body.w + pad * 2);
    const oh = Math.min(1 - oy, body.h + pad * 2);
    const ix = body.x + body.w * 0.28;
    const iy = body.y + body.h * 0.28;
    const iw = body.w * 0.44;
    const ih = body.h * 0.44;
    const outer = `M ${ox} ${oy} H ${ox + ow} V ${oy + oh} H ${ox} Z`;
    const inner = `M ${ix} ${iy} H ${ix + iw} V ${iy + ih} H ${ix} Z`;
    return (
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 z-30 overflow-visible" aria-hidden>
            <path
                d={`${outer} ${inner}`}
                fill="transparent"
                fillRule="evenodd"
                className="pointer-events-auto cursor-crosshair"
                onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.button !== 0) return;
                    onConnectStart(event);
                }}
                onPointerDown={(event) => {
                    if (event.pointerType === "mouse") return;
                    event.stopPropagation();
                    if (event.button !== 0) return;
                    onConnectStart(event);
                }}
            />
        </svg>
    );
}


function ConnectionHandleDot({
    side,
    visible,
    onMouseDown,
    tipInset,
    outwardPx = 0,
    compact = false,
    collapseEnabled = false,
    collapsed = false,
    onToggleCollapse,
    collapseTitle,
    expandTitle,
}: {
    side: ConnectionHandleSide;
    visible: boolean;
    onMouseDown: (event: NodePressEvent) => void;
    /** 导图尖点相对包围盒比例；有值时圆点落在尖点附近 */
    tipInset?: number;
    /** 沿轴向外移，避免盖住节点本体（拖动误触连线） */
    outwardPx?: number;
    /** 导图小节点用更小命中区 */
    compact?: boolean;
    /** 点击收起/展开该侧分支；拖动仍创建连线 */
    collapseEnabled?: boolean;
    collapsed?: boolean;
    onToggleCollapse?: () => void;
    collapseTitle?: string;
    expandTitle?: string;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const useTip = typeof tipInset === "number";
    const out = compact ? Math.max(outwardPx, 8) : outwardPx;
    const dragRef = useRef<{ x: number; y: number; connecting: boolean } | null>(null);
    const positionClass = useTip
        ? ""
        : side === "left"
          ? `top-1/2 ${compact ? "-left-4" : "-left-6"} -translate-y-1/2`
          : side === "right"
            ? `top-1/2 ${compact ? "-right-4" : "-right-6"} -translate-y-1/2`
            : side === "top"
              ? `left-1/2 ${compact ? "-top-4" : "-top-6"} -translate-x-1/2`
              : `left-1/2 ${compact ? "-bottom-4" : "-bottom-6"} -translate-x-1/2`;
    const tipStyle = useTip
        ? side === "left" || side === "right"
          ? {
                left: `calc(${tipInset * 100}% + ${(side === "right" ? out : -out)}px)`,
                top: "50%",
                transform: "translate(-50%, -50%)",
            }
          : {
                left: "50%",
                top: `calc(${tipInset * 100}% + ${(side === "bottom" ? out : -out)}px)`,
                transform: "translate(-50%, -50%)",
            }
        : undefined;
    const tip = collapseEnabled ? (collapsed ? expandTitle : collapseTitle) : undefined;

    useEffect(
        () => () => {
            if (dragRef.current) {
                activeNodeHandlePress = false;
                cancelNodeHandlePressOnUp = false;
            }
            dragRef.current = null;
        },
        [],
    );

    const beginPress = (event: NodePressEvent, pointerMode: boolean) => {
        if (!collapseEnabled || !onToggleCollapse) {
            onMouseDown(event);
            return;
        }
        event.stopPropagation();
        if (pointerMode) event.preventDefault();
        if (event.button !== 0) return;
        const pointerId = "pointerId" in event ? event.pointerId : null;
        activeNodeHandlePress = true;
        cancelNodeHandlePressOnUp = false;
        dragRef.current = { x: event.clientX, y: event.clientY, connecting: false };
        const move = (clientX: number, clientY: number) => {
            const state = dragRef.current;
            if (!state || state.connecting) return;
            const dx = clientX - state.x;
            const dy = clientY - state.y;
            if (dx * dx + dy * dy < EXCEL_HANDLE_DRAG_THRESHOLD_SQ) return;
            state.connecting = true;
            onMouseDown({
                clientX,
                clientY,
                button: 0,
                stopPropagation: () => undefined,
                preventDefault: () => undefined,
            } as unknown as NodePressEvent);
        };
        const onMouseMove = (moveEvent: MouseEvent) => move(moveEvent.clientX, moveEvent.clientY);
        const onPointerMove = (moveEvent: PointerEvent) => {
            if (pointerId != null && moveEvent.pointerId !== pointerId) return;
            move(moveEvent.clientX, moveEvent.clientY);
        };
        const finish = (upPointerId?: number) => {
            if (pointerId != null && upPointerId != null && upPointerId !== pointerId) return;
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
            window.removeEventListener("pointercancel", onPointerUp);
            const state = dragRef.current;
            dragRef.current = null;
            const canceled = cancelNodeHandlePressOnUp;
            activeNodeHandlePress = false;
            cancelNodeHandlePressOnUp = false;
            if (state && !state.connecting && !canceled) onToggleCollapse();
        };
        const onMouseUp = () => finish();
        const onPointerUp = (upEvent: PointerEvent) => finish(upEvent.pointerId);
        if (pointerMode) {
            window.addEventListener("pointermove", onPointerMove);
            window.addEventListener("pointerup", onPointerUp);
            window.addEventListener("pointercancel", onPointerUp);
        } else {
            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
        }
    };

    return (
        <div
            className={`canvas-touch-connection-handle absolute z-[45] flex ${compact ? "size-6" : "size-12"} cursor-crosshair items-center justify-center transition-opacity duration-150 ${positionClass} ${
                visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
            }`}
            style={tipStyle}
            title={tip}
            aria-label={tip}
            onMouseDown={(event) => beginPress(event, false)}
            onPointerDown={(event) => {
                if (event.pointerType !== "mouse") beginPress(event, true);
            }}
        >
            <div
                className={`${compact ? "size-2.5" : "size-3"} grid place-items-center rounded-full border-2 transition-all hover:scale-125`}
                style={{
                    background: collapsed ? theme.node.activeStroke : theme.node.panel,
                    borderColor: collapsed ? theme.node.activeStroke : theme.node.muted,
                    color: collapsed ? theme.node.panel : theme.node.muted,
                }}
            >
                {collapsed ? <Plus className={compact ? "size-1.5" : "size-2"} strokeWidth={3} /> : null}
            </div>
        </div>
    );
}

const EXCEL_HANDLE_DRAG_THRESHOLD_SQ = 36; // 6px

function ExcelExpandHandle({
    visible,
    expanded,
    onToggle,
    onConnectStart,
    expandLabel,
    collapseLabel,
    dragConnectLabel,
}: {
    visible: boolean;
    expanded: boolean;
    onToggle: () => void;
    onConnectStart: (event: NodePressEvent) => void;
    expandLabel: string;
    collapseLabel: string;
    dragConnectLabel: string;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const label = expanded ? collapseLabel : expandLabel;
    const tip = `${label} · ${dragConnectLabel}`;
    const dragRef = useRef<{ x: number; y: number; connecting: boolean } | null>(null);

    useEffect(() => () => {
        if (dragRef.current) {
            activeNodeHandlePress = false;
            cancelNodeHandlePressOnUp = false;
        }
        dragRef.current = null;
    }, []);

    const beginPress = (event: NodePressEvent, pointerMode: boolean) => {
        event.stopPropagation();
        if (pointerMode) event.preventDefault();
        if (event.button !== 0) return;
        const pointerId = "pointerId" in event ? event.pointerId : null;
        activeNodeHandlePress = true;
        cancelNodeHandlePressOnUp = false;
        dragRef.current = { x: event.clientX, y: event.clientY, connecting: false };
        const move = (clientX: number, clientY: number) => {
            const state = dragRef.current;
            if (!state || state.connecting) return;
            const dx = clientX - state.x;
            const dy = clientY - state.y;
            if (dx * dx + dy * dy < EXCEL_HANDLE_DRAG_THRESHOLD_SQ) return;
            state.connecting = true;
            onConnectStart({
                clientX,
                clientY,
                button: 0,
                stopPropagation: () => undefined,
                preventDefault: () => undefined,
            } as unknown as NodePressEvent);
        };
        const onMouseMove = (moveEvent: MouseEvent) => move(moveEvent.clientX, moveEvent.clientY);
        const onPointerMove = (moveEvent: PointerEvent) => {
            if (pointerId != null && moveEvent.pointerId !== pointerId) return;
            move(moveEvent.clientX, moveEvent.clientY);
        };
        const finish = (upPointerId?: number) => {
            if (pointerId != null && upPointerId != null && upPointerId !== pointerId) return;
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
            window.removeEventListener("pointercancel", onPointerUp);
            const state = dragRef.current;
            dragRef.current = null;
            const canceled = cancelNodeHandlePressOnUp;
            activeNodeHandlePress = false;
            cancelNodeHandlePressOnUp = false;
            if (state && !state.connecting && !canceled) onToggle();
        };
        const onMouseUp = () => finish();
        const onPointerUp = (upEvent: PointerEvent) => finish(upEvent.pointerId);
        if (pointerMode) {
            window.addEventListener("pointermove", onPointerMove);
            window.addEventListener("pointerup", onPointerUp);
            window.addEventListener("pointercancel", onPointerUp);
        } else {
            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
        }
    };

    return (
        <button
            type="button"
            className={`absolute top-1/2 z-30 flex size-12 -right-6 -translate-y-1/2 cursor-crosshair items-center justify-center transition-opacity duration-150 ${
                visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
            }`}
            title={tip}
            aria-label={tip}
            onClick={(event) => {
                // 点击由 mouseup 处理，避免与拖动连线抢事件
                event.preventDefault();
                event.stopPropagation();
            }}
            onMouseDown={(event) => beginPress(event, false)}
            onPointerDown={(event) => {
                if (event.pointerType !== "mouse") beginPress(event, true);
            }}
        >
            <span
                className="grid size-6 place-items-center rounded-full border transition hover:scale-110 hover:bg-black/5 dark:hover:bg-white/10"
                style={{ background: theme.node.panel, borderColor: theme.node.muted, color: theme.node.text }}
            >
                {expanded ? <Minus className="size-3.5" /> : <Plus className="size-3.5" />}
            </span>
        </button>
    );
}
