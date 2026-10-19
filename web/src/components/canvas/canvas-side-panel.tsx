import { memo, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";
import { App, Dropdown, Empty, Input, Modal, Popconfirm, Select, Spin, Tag, Typography } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronsDownUp, Download, Eye, FileText, Folder, Image as ImageIcon, ListChecks, Music2, Network, Pencil, Plus, Search, Settings2, Sparkles, Square, Trash2, Type, UnfoldVertical, Video } from "lucide-react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { exportCanvasNodes } from "@/lib/canvas/canvas-export";
import { buildCanvasOutline } from "@/lib/canvas/canvas-outline";
import { photopeaNodeImageSource } from "@/lib/canvas/photopea-image";
import { MIND_NODE_TYPE } from "@/lib/canvas/mind-map";
import { addFolderAssetFromBundle, childrenOfFolderAsset, folderAssetFileToImagePayload, isFolderImageFileName, readFolderAssetThumbnail, removeFolderAssetEntry, saveFolderAssetImages } from "@/lib/canvas/folder-asset";
import { bundleFromDirectoryFileList, captureDropSnapshot, collectDroppedFolders, collectDroppedLooseFiles, type CapturedDropSnapshot } from "@/lib/canvas/folder-drop";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { assetDragPreview, assetToInsertPayload, CANVAS_ASSET_DROP_HOVER_EVENT, CANVAS_PROMPT_DROP_HOVER_EVENT, setSidePanelDragGhost, SIDE_PANEL_INSERT_MIME, writeSidePanelInsertDataTransfer } from "@/lib/canvas/side-panel-insert-drag";
import { tryPickModelAngleBackground } from "@/components/canvas/nodes/model-angle-export-dialog";
import { cn } from "@/lib/utils";
import { persistPromptAssetMedia, type PromptAssetDraft } from "@/lib/canvas/prompt-asset";
import { PromptAssetSaveDialog } from "@/pages/prompts/components/prompt-asset-save-dialog";
import { LibraryGroupFilter, LibraryGroupManageMenu, LibraryGroupMove } from "@/components/library-groups";
import { ALL_LIBRARY_GROUPS, matchesLibraryGroup, promptGroupKey } from "@/lib/library-groups";
import { useLibraryGroupStore } from "@/stores/use-library-group-store";
import { useLibraryGroupAssignment } from "@/hooks/use-library-group-assignment";
import { PromptDetailDialog } from "@/pages/prompts/components/prompt-detail-dialog";
import { PromptEditorDialog } from "@/pages/prompts/components/prompt-editor-dialog";
import { createLocalPrompt, deleteLocalPrompt, isLocalPromptSource, LOCAL_PROMPT_SOURCE_ID, localPromptCategory, updateLocalPrompt, type LocalPromptInput } from "@/services/api/local-prompts";
import { fetchSourcePrompts, type Prompt } from "@/services/api/prompts";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { useAssetStore, type Asset, type AssetKind, type FolderAsset } from "@/stores/use-asset-store";
import { usePhotopeaLayerStore } from "@/stores/canvas/use-photopea-layer-store";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";
import { CANVAS_SIDE_PANEL_MAX_WIDTH, CANVAS_SIDE_PANEL_MIN_WIDTH, CANVAS_SIDE_PANEL_MOTION_MS, CANVAS_SIDE_PANEL_Z_INDEX, useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasConnection, type CanvasFolderEntry, type CanvasNodeData } from "@/types/canvas";
import { CODEX_SKILL_NODE_TYPE } from "@/components/canvas/nodes/codex-skill-node";
import { FOLDER_NODE_TYPE } from "@/components/canvas/nodes/folder-node";

import type { InsertAssetPayload } from "./asset-picker-modal";
import { AssetImage } from "@/components/asset-image";
import { AssetVirtualGrid } from "./asset-virtual-grid";
import { AssetPageControls } from "./asset-page-controls";
import { useAssetPagePreload } from "@/hooks/use-asset-page-preload";

const ASSET_PAGE_SIZE = 20;

const PANEL_MOTION_SECONDS = CANVAS_SIDE_PANEL_MOTION_MS / 1000;
const PANEL_EASE = [0.22, 1, 0.36, 1] as const;

type PanelTab = "canvas" | "assets" | "prompts";

type Props = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: Set<string>;
    onFocusNode: (nodeId: string) => void;
    onPreviewNode: (nodeId: string) => void;
    onInsertAsset: (payload: InsertAssetPayload) => void;
};

/** 侧栏卡片拖出画布时会带自定义 MIME；系统文件拖入不要拦 */
function isSidePanelInternalDrag(dataTransfer: DataTransfer) {
    return [...dataTransfer.types].includes(SIDE_PANEL_INSERT_MIME);
}

async function importDropSnapshotToAssets(snapshot: CapturedDropSnapshot, t: (key: string, opts?: Record<string, unknown>) => string) {
    const addAsset = useAssetStore.getState().addAsset;
    const groupId = useLibraryGroupStore.getState().selected.assets;
    const assetIds: string[] = [];
    let added = 0;
    const folders = await collectDroppedFolders(snapshot);
    if (folders.length) {
        for (const folder of folders) {
            assetIds.push(await addFolderAssetFromBundle(folder));
            added += 1;
        }
        return { added, assetIds, groupId, truncated: folders.some((folder) => folder.truncated) };
    }
    const isMedia = (file: File) => file.type.startsWith("image/") || file.type.startsWith("video/");
    const mediaFiles = snapshot.files.filter((file) => isMedia(file) && !(file.webkitRelativePath || "").includes("/"));
    for (const file of mediaFiles) {
        if (file.type.startsWith("image/")) {
            const image = await uploadImage(file);
            assetIds.push(addAsset({ kind: "image", title: file.name || t("assets.kinds.image"), coverUrl: image.url, tags: [], data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType } }));
            added += 1;
        } else if (file.type.startsWith("video/")) {
            const media = await uploadMediaFile(file, "video");
            assetIds.push(addAsset({ kind: "video", title: file.name || t("assets.kinds.video"), coverUrl: "", tags: [], data: { url: media.url, storageKey: media.storageKey, width: media.width || 0, height: media.height || 0, bytes: media.bytes, mimeType: media.mimeType } }));
            added += 1;
        }
    }
    const loose = await collectDroppedLooseFiles(snapshot, { exclude: isMedia });
    for (const fileBundle of loose) {
        assetIds.push(await addFolderAssetFromBundle(fileBundle));
        added += 1;
    }
    return { added, assetIds, groupId, truncated: loose.some((folder) => folder.truncated) };
}

const NODE_TYPE_ICON: Record<string, typeof Square> = {
    [CanvasNodeType.Image]: ImageIcon,
    [CanvasNodeType.Video]: Video,
    [CanvasNodeType.Audio]: Music2,
    [CanvasNodeType.Text]: Type,
    [CanvasNodeType.Config]: Settings2,
    [CanvasNodeType.Group]: Folder,
    [MIND_NODE_TYPE]: Network,
    [CODEX_SKILL_NODE_TYPE]: Sparkles,
    [FOLDER_NODE_TYPE]: Folder,
};

const STATUS_COLOR: Record<string, string> = {
    success: "#22c55e",
    loading: "#f59e0b",
    error: "#ef4444",
    idle: "transparent",
};

export function CanvasSidePanel({ nodes, connections, selectedNodeIds, onFocusNode, onPreviewNode, onInsertAsset }: Props) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const { id: projectId } = useParams();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [tab, setTab] = useState<PanelTab>("canvas");
    const width = useCanvasSidePanelStore((state) => state.width);
    const panelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const panelMounted = useCanvasSidePanelStore((state) => state.panelMounted);
    const panelClosing = useCanvasSidePanelStore((state) => state.panelClosing);
    const setWidth = useCanvasSidePanelStore((state) => state.setWidth);
    const [resizing, setResizing] = useState(false);
    const [dropActive, setDropActive] = useState(false);
    const [promptDropActive, setPromptDropActive] = useState(false);
    const [assetUploading, setAssetUploading] = useState(false);
    const assignGroup = useLibraryGroupAssignment("assets");
    const asideRef = useRef<HTMLDivElement | null>(null);

    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;
        let nextWidth = startWidth;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = Math.min(CANVAS_SIDE_PANEL_MAX_WIDTH, Math.max(CANVAS_SIDE_PANEL_MIN_WIDTH, startWidth + moveEvent.clientX - startX));
            setWidth(nextWidth);
        };
        const onUp = () => {
            localStorage.setItem("canvas-side-panel-width", String(nextWidth));
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    const canAcceptAssetDrop = tab === "assets" && !assetUploading && !panelClosing;

    useEffect(() => {
        const onHover = (event: Event) => {
            const active = Boolean((event as CustomEvent<{ active?: boolean }>).detail?.active);
            if (tab !== "assets" || assetUploading) {
                setDropActive(false);
                return;
            }
            setDropActive(active);
        };
        window.addEventListener(CANVAS_ASSET_DROP_HOVER_EVENT, onHover);
        return () => window.removeEventListener(CANVAS_ASSET_DROP_HOVER_EVENT, onHover);
    }, [tab, assetUploading]);

    useEffect(() => {
        const onHover = (event: Event) => {
            const active = Boolean((event as CustomEvent<{ active?: boolean }>).detail?.active);
            setPromptDropActive(tab === "prompts" && active);
        };
        window.addEventListener(CANVAS_PROMPT_DROP_HOVER_EVENT, onHover);
        return () => window.removeEventListener(CANVAS_PROMPT_DROP_HOVER_EVENT, onHover);
    }, [tab]);

    const onAssetDragEnter = (event: ReactDragEvent) => {
        if (!canAcceptAssetDrop || isSidePanelInternalDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        setDropActive(true);
    };

    const onAssetDragLeave = (event: ReactDragEvent) => {
        if (!dropActive) return;
        const next = event.relatedTarget;
        if (next instanceof Node && asideRef.current?.contains(next)) return;
        setDropActive(false);
    };

    const onAssetDragOver = (event: ReactDragEvent) => {
        if (!canAcceptAssetDrop || isSidePanelInternalDrag(event.dataTransfer)) return;
        // 不依赖 types 是否含 Files：部分环境下 dragover 阶段 types 不完整，不 preventDefault 就无法 drop
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
        if (!dropActive) setDropActive(true);
    };

    const onAssetDrop = (event: ReactDragEvent) => {
        if (tab !== "assets" || isSidePanelInternalDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        setDropActive(false);
        if (assetUploading) return;
        const snapshot = captureDropSnapshot(event.dataTransfer);
        if (!snapshot.entries.length && !snapshot.files.length) {
            message.warning(t("canvas.sidePanel.dropUnsupported"));
            return;
        }
        void (async () => {
            setAssetUploading(true);
            const hide = message.loading(t("canvas.sidePanel.addingAssets"), 0);
            try {
                const { added, truncated, assetIds, groupId } = await importDropSnapshotToAssets(snapshot, t as (key: string, opts?: Record<string, unknown>) => string);
                if (assetIds.length) await assignGroup(assetIds, groupId);
                if (added) message.success(t("canvas.sidePanel.droppedAssets", { count: added }));
                else message.warning(t("canvas.sidePanel.dropUnsupported"));
                if (truncated) message.info(t("canvas.folderNode.truncatedHint"));
            } catch (error) {
                console.error(error);
                message.error(t("canvas.sidePanel.addFailed"));
            } finally {
                hide();
                setAssetUploading(false);
            }
        })();
    };

    if (!panelMounted) return null;

    return (
        <motion.div
            className="relative flex h-full shrink-0"
            style={{ zIndex: CANVAS_SIDE_PANEL_Z_INDEX, overflow: "clip", pointerEvents: panelClosing ? "none" : undefined }}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelOpen ? width + 1 : 0, opacity: panelOpen ? 1 : 0 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }}
        >
            <motion.aside
                className="relative flex h-full shrink-0 flex-col overflow-hidden border-r"
                initial={{ x: -48 }}
                animate={{ x: panelClosing ? -28 : 0 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }}
                style={{ width, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                data-canvas-no-zoom
            >
                <div
                    ref={asideRef}
                    className="relative flex h-full min-h-0 flex-col"
                    data-asset-drop-zone={tab === "assets" ? "true" : undefined}
                    data-prompt-drop-zone={tab === "prompts" ? "true" : undefined}
                    onDragEnter={onAssetDragEnter}
                    onDragLeave={onAssetDragLeave}
                    onDragOver={onAssetDragOver}
                    onDrop={onAssetDrop}
                >
                    {tab === "assets" && dropActive ? (
                        <div
                            className="pointer-events-none absolute inset-2 z-[70] flex items-center justify-center rounded-xl border-2 border-dashed text-sm font-medium"
                            style={{ borderColor: theme.node.activeStroke, color: theme.node.text, background: `${theme.node.panel}ee` }}
                        >
                            {t("canvas.sidePanel.dropToAdd")}
                        </div>
                    ) : null}
                    {tab === "prompts" && promptDropActive ? (
                        <div
                            className="pointer-events-none absolute inset-2 z-[70] flex items-center justify-center rounded-xl border-2 border-dashed px-6 text-center text-sm font-medium"
                            style={{ borderColor: theme.node.activeStroke, color: theme.node.text, background: `${theme.node.panel}ee` }}
                        >
                            {t("canvas.sidePanel.dropToPromptAsset")}
                        </div>
                    ) : null}
                    <div className="flex items-center gap-6 border-b px-4 pt-16" style={{ borderColor: theme.toolbar.border }}>
                        <TabButton label={t("canvas.sidePanel.canvas")} active={tab === "canvas"} theme={theme} onClick={() => setTab("canvas")} />
                        <TabButton label={t("canvas.sidePanel.assets")} active={tab === "assets"} theme={theme} onClick={() => setTab("assets")} />
                        <TabButton label={t("canvas.sidePanel.prompts")} active={tab === "prompts"} theme={theme} onClick={() => setTab("prompts")} />
                    </div>
                    <div className="min-h-0 flex-1 overflow-hidden">
                        {tab === "canvas" ? (
                            <CanvasNodesTab key={projectId} nodes={nodes} connections={connections} selectedNodeIds={selectedNodeIds} onFocusNode={onFocusNode} onPreviewNode={onPreviewNode} theme={theme} />
                        ) : tab === "assets" ? (
                            <CanvasAssetsTab onInsert={onInsertAsset} theme={theme} uploading={assetUploading} setUploading={setAssetUploading} />
                        ) : (
                            <CanvasPromptsTab onInsert={onInsertAsset} theme={theme} />
                        )}
                    </div>
                </div>
                <button type="button" className="absolute inset-y-0 right-0 z-40 w-4 translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label={t("canvas.sidePanel.resize")} />
            </motion.aside>
        </motion.div>
    );
}

function TabButton({ label, active, theme, onClick }: { label: string; active: boolean; theme: CanvasTheme; onClick: () => void }) {
    return (
        <button type="button" onClick={onClick} aria-pressed={active} className="relative py-2.5 text-[13px] font-medium transition-opacity hover:opacity-100" style={{ color: active ? theme.node.text : theme.node.placeholder }}>
            {label}
            {active ? <motion.span layoutId="sidePanelTabIndicator" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full" style={{ background: theme.toolbar.activeText }} transition={{ type: "spring", stiffness: 500, damping: 34 }} /> : null}
        </button>
    );
}

// ---------------------------------------------------------------------------
// Canvas tab: local outline, search and node focus.
// ---------------------------------------------------------------------------

const CanvasNodesTab = memo(function CanvasNodesTab({ nodes, connections, selectedNodeIds, onFocusNode, onPreviewNode, theme }: Pick<Props, "nodes" | "connections" | "selectedNodeIds" | "onFocusNode" | "onPreviewNode"> & { theme: CanvasTheme }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const photopeaOpen = usePhotopeaLayerStore((state) => Boolean(state.handler));
    const [keyword, setKeyword] = useState("");
    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [selectMode, setSelectMode] = useState(false);
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const [exporting, setExporting] = useState(false);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const outline = useMemo(() => buildCanvasOutline(nodes, connections), [nodes, connections]);
    const filterOptions = useMemo(() => [
        { value: "all", label: t("common.all") },
        ...Array.from(new Set(nodes.map((node) => node.type))).map((value) => ({
            value,
            label: t(`canvas.sidePanel.filter.${value}`, { defaultValue: getNodeDefinition(value)?.title || value }),
        })),
    ], [nodes, t]);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return nodes.filter((node) => (typeFilter === "all" || node.type === typeFilter) && (!query || [node.title, node.metadata?.content, node.metadata?.prompt].filter(Boolean).join(" ").toLowerCase().includes(query)));
    }, [nodes, keyword, typeFilter]);

    const filtering = Boolean(keyword.trim()) || typeFilter !== "all";
    const matchedIds = useMemo(() => new Set(filtered.map((node) => node.id)), [filtered]);
    const rows = useMemo(() => {
        const visibleIds = new Set(matchedIds);
        if (filtering) {
            for (const id of matchedIds) {
                let parent = outline.parentById.get(id);
                while (parent && !visibleIds.has(parent)) {
                    visibleIds.add(parent);
                    parent = outline.parentById.get(parent);
                }
            }
        }
        const result: Array<{ node: CanvasNodeData; depth: number; childCount: number }> = [];
        const stack = outline.roots.map((node) => ({ node, depth: 0 })).reverse();
        while (stack.length) {
            const entry = stack.pop()!;
            if (!visibleIds.has(entry.node.id)) continue;
            const children = outline.childrenById.get(entry.node.id) || [];
            result.push({ ...entry, childCount: children.length });
            if (filtering || !collapsed.has(entry.node.id)) {
                for (let i = children.length - 1; i >= 0; i -= 1) stack.push({ node: children[i], depth: entry.depth + 1 });
            }
        }
        return result;
    }, [outline, matchedIds, filtering, collapsed]);
    useEffect(() => {
        // 在画布中选中子节点时展开其祖先；手动折叠不改动选区或画布上的导图。
        setCollapsed((current) => {
            const next = new Set(current);
            for (const id of selectedNodeIds) {
                let parent = outline.parentById.get(id);
                while (parent) {
                    next.delete(parent);
                    parent = outline.parentById.get(parent);
                }
            }
            return next.size === current.size ? current : next;
        });
    }, [outline, selectedNodeIds]);
    const allCollapsed = outline.childrenById.size > 0 && Array.from(outline.childrenById.keys()).every((id) => collapsed.has(id));
    const toggleBranch = (id: string) => setCollapsed((current) => {
        const next = new Set(current);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });

    const exitSelect = () => {
        setSelectMode(false);
        setChecked(new Set());
    };
    const toggleChecked = (id: string) =>
        setChecked((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    const allChecked = filtered.length > 0 && filtered.every((node) => checked.has(node.id));
    const toggleAll = () => setChecked(allChecked ? new Set() : new Set(filtered.map((node) => node.id)));

    const handleExport = async () => {
        const targets = nodes.filter((node) => checked.has(node.id));
        if (!targets.length) return;
        setExporting(true);
        const hide = message.loading(t("canvas.sidePanel.exporting"), 0);
        try {
            await exportCanvasNodes(targets, t("canvas.sidePanel.exportName", { count: targets.length }));
            message.success(t("canvas.sidePanel.exported", { count: targets.length }));
            exitSelect();
        } catch (error) {
            console.error(error);
            message.error(t("canvas.sidePanel.exportFailed"));
        } finally {
            hide();
            setExporting(false);
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="px-4 pb-2 pt-3.5">
                <Input allowClear prefix={<Search className="mr-1 size-3.5" style={{ color: theme.node.placeholder }} />} aria-label={t("canvas.sidePanel.searchNodes")} placeholder={t("canvas.sidePanel.searchNodes")} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="flex flex-wrap items-center gap-1 px-3 pb-2">
                <span className="pl-1 text-xs" style={{ color: theme.node.placeholder }}>{t("canvas.sidePanel.outline")}</span>
                <span className="ml-1 text-[11px] tabular-nums" style={{ color: theme.node.placeholder }}>{filtered.length}</span>
                <button
                    type="button"
                    onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(outline.childrenById.keys()))}
                    disabled={filtering || !outline.childrenById.size}
                    className="ml-auto grid size-7 place-items-center rounded transition hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10"
                    style={{ color: theme.node.placeholder }}
                    aria-label={t(allCollapsed ? "canvas.sidePanel.expandAll" : "canvas.sidePanel.collapseAll")}
                    title={t(allCollapsed ? "canvas.sidePanel.expandAll" : "canvas.sidePanel.collapseAll")}
                >
                    {allCollapsed ? <UnfoldVertical className="size-3.5" /> : <ChevronsDownUp className="size-3.5" />}
                </button>
                <button
                    type="button"
                    onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
                    className="flex h-7 items-center gap-1 rounded px-1.5 text-xs transition hover:bg-black/5 dark:hover:bg-white/10"
                    style={{ color: selectMode ? theme.node.text : theme.node.placeholder }}
                    aria-pressed={selectMode}
                    aria-label={selectMode ? t("common.cancel") : t("canvas.sidePanel.select")}
                    title={selectMode ? t("common.cancel") : t("canvas.sidePanel.select")}
                >
                    <ListChecks className="size-3.5" />
                    {selectMode ? t("common.cancel") : null}
                </button>
                {selectMode ? null : (
                    <Select
                        size="small"
                        variant="borderless"
                        className="w-20"
                        value={typeFilter}
                        onChange={setTypeFilter}
                        aria-label={t("canvas.sidePanel.filterType")}
                        getPopupContainer={() => document.body}
                        options={filterOptions}
                    />
                )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4" style={{ scrollbarWidth: "thin", scrollbarColor: `${theme.node.stroke} transparent` }}>
                {filtered.length ? (
                    <div role="list" aria-label={t("canvas.sidePanel.outline")}>
                        {rows.map(({ node, depth, childCount }) => {
                            const Icon = NODE_TYPE_ICON[node.type] || FileText;
                            const isImage = node.type === CanvasNodeType.Image && node.metadata?.content;
                            const isChecked = checked.has(node.id);
                            const active = selectMode ? isChecked : selectedNodeIds.has(node.id);
                            const expanded = filtering || !collapsed.has(node.id);
                            const title = node.title || getNodeDefinition(node.type)?.title || t("canvas.node.untitled");
                            const indent = Math.min(depth, 5) * 12;
                            return (
                                <div key={node.id} role="listitem" className={cn("group relative flex min-h-9 w-full items-center rounded-md", !active && "hover:bg-black/5 dark:hover:bg-white/5")} style={{ paddingLeft: indent + 2, background: active ? theme.toolbar.activeBg : undefined }}>
                                    {depth > 0 ? <span className="pointer-events-none absolute inset-y-0 w-px" style={{ left: indent - 3, background: theme.toolbar.border }} /> : null}
                                    {active ? <span className="pointer-events-none absolute inset-y-2 left-0 w-0.5 rounded-full" style={{ background: theme.node.activeStroke }} /> : null}
                                    {childCount ? (
                                        <button
                                            type="button"
                                            className="grid h-8 w-5 shrink-0 place-items-center rounded hover:bg-black/5 disabled:cursor-default dark:hover:bg-white/10"
                                            style={{ color: theme.node.placeholder }}
                                            onClick={() => toggleBranch(node.id)}
                                            aria-expanded={expanded}
                                            aria-label={t(expanded ? "canvas.sidePanel.collapseBranch" : "canvas.sidePanel.expandBranch", { title })}
                                            disabled={filtering}
                                        >
                                            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                                        </button>
                                    ) : <span className="w-5 shrink-0" />}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (isImage && usePhotopeaLayerStore.getState().tryImport({ ...photopeaNodeImageSource(node), title })) return;
                                            if (selectMode) {
                                                toggleChecked(node.id);
                                                return;
                                            }
                                            if (
                                                isImage &&
                                                tryPickModelAngleBackground({
                                                    url: String(node.metadata?.content || ""),
                                                    storageKey: node.metadata?.storageKey,
                                                    width: node.metadata?.naturalWidth,
                                                    height: node.metadata?.naturalHeight,
                                                })
                                            ) {
                                                return;
                                            }
                                            onFocusNode(node.id);
                                        }}
                                        className="flex min-h-9 min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left"
                                        aria-pressed={active}
                                        title={`${title}\n${isImage && photopeaOpen ? t("canvas.editors.photopeaImportLayer") : selectMode ? t("canvas.sidePanel.select") : isImage ? t("canvas.modelNode.clickImageAsBg") : t("canvas.sidePanel.focusNode")}`}
                                    >
                                        {selectMode ? <CheckMark checked={isChecked} theme={theme} /> : null}
                                        <span className={cn("grid shrink-0 place-items-center overflow-hidden", isImage ? "size-6 rounded" : "size-4")}>
                                            {isImage ? <img src={node.metadata!.content} alt="" loading="lazy" className="size-full object-cover" /> : <Icon className="size-3.5" style={{ color: theme.node.placeholder }} />}
                                        </span>
                                        <span className={cn("min-w-0 flex-1 truncate text-[13px] leading-5", childCount && "font-medium")} style={{ color: matchedIds.has(node.id) ? theme.node.text : theme.node.placeholder }}>{title}</span>
                                        {childCount ? <span className="text-[11px] tabular-nums" style={{ color: theme.node.placeholder }} title={t("canvas.sidePanel.childCount", { count: childCount })}>{childCount}</span> : null}
                                        {node.metadata?.status && node.metadata.status !== "idle" ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[node.metadata.status] || "transparent" }} /> : null}
                                    </button>
                                    {selectMode || !isImage ? null : (
                                        <div className="shrink-0 pr-1">
                                            <button type="button" onClick={() => onPreviewNode(node.id)} className="grid size-6 place-items-center rounded opacity-55 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10" aria-label={t("canvas.sidePanel.preview")} title={t("canvas.sidePanel.preview")}>
                                                <Eye className="size-3.5" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="px-3 pt-12 text-center text-xs" style={{ color: theme.node.placeholder }}>{t(nodes.length ? "canvas.sidePanel.noMatchingNodes" : "canvas.sidePanel.noNodes")}</div>
                )}
            </div>
            {selectMode ? (
                <div className="flex items-center gap-2 border-t px-3 py-2.5" style={{ borderColor: theme.toolbar.border }}>
                    <button type="button" onClick={toggleAll} className="rounded-md px-2 py-1 text-xs font-medium opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10">
                        {allChecked ? t("canvas.sidePanel.clearAll") : t("workbench.selectAll")}
                    </button>
                    <span className="text-xs opacity-45">{t("canvas.sidePanel.selected", { count: checked.size })}</span>
                    <button
                        type="button"
                        onClick={() => void handleExport()}
                        disabled={!checked.size || exporting}
                        className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
                        style={{ color: theme.node.text }}
                    >
                        <Download className="size-3.5" />
                        {t("canvas.exportSelected")}
                    </button>
                </div>
            ) : null}
        </div>
    );
});

function CheckMark({ checked, theme }: { checked: boolean; theme: CanvasTheme }) {
    return (
        <span className="grid size-4 shrink-0 place-items-center rounded border transition" style={{ borderColor: checked ? theme.toolbar.activeText : theme.node.stroke, background: checked ? theme.toolbar.activeText : "transparent" }}>
            {checked ? <Check className="size-3" style={{ color: theme.node.panel }} /> : null}
        </span>
    );
}

// ---------------------------------------------------------------------------
// Assets tab: collapsible type groups, tag filtering, and click-to-insert.
// ---------------------------------------------------------------------------

const ASSET_GROUPS: { kind: AssetKind; icon: typeof Square }[] = [
    { kind: "image", icon: ImageIcon },
    { kind: "video", icon: Video },
    { kind: "text", icon: FileText },
    { kind: "folder", icon: Folder },
];

const buildInsertPayload = assetToInsertPayload;

const CanvasAssetsTab = memo(function CanvasAssetsTab({
    onInsert,
    theme,
    uploading,
    setUploading,
}: {
    onInsert: (payload: InsertAssetPayload) => void;
    theme: CanvasTheme;
    uploading: boolean;
    setUploading: (value: boolean) => void;
}) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const assets = useAssetStore((state) => state.assets);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const library = useLibraryGroupStore((state) => state.data.assets);
    const selectedGroup = useLibraryGroupStore((state) => state.selected.assets);
    const assignGroup = useLibraryGroupAssignment("assets");
    const [keyword, setKeyword] = useState("");
    const [tagFilter, setTagFilter] = useState<string>("all");
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [expandedFolderId, setExpandedFolderId] = useState<string | null>(null);
    const [folderBrowsePath, setFolderBrowsePath] = useState("");
    const [assetPage, setAssetPage] = useState(1);
    const assetScrollRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);

    const allTags = useMemo(() => Array.from(new Set(assets.flatMap((asset) => asset.tags || []))).slice(0, 20), [assets]);
    const groupCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const asset of assets) {
            const id = library.members[asset.id];
            if (id) counts.set(id, (counts.get(id) || 0) + 1);
        }
        return counts;
    }, [assets, library.members]);
    const groupEntries = useMemo(() => selectedGroup === ALL_LIBRARY_GROUPS && tagFilter === "all" ? library.groups.filter((group) => group.name.toLowerCase().includes(keyword.trim().toLowerCase())) : [], [library.groups, selectedGroup, tagFilter, keyword]);
    const activeGroup = library.groups.find((group) => group.id === selectedGroup);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        const hideGrouped = selectedGroup === ALL_LIBRARY_GROUPS && !query && tagFilter === "all";
        return assets.filter((asset) => {
            if (hideGrouped && library.members[asset.id]) return false;
            return matchesLibraryGroup(library, asset.id, selectedGroup) && (tagFilter === "all" || (asset.tags || []).includes(tagFilter)) && (!query || [asset.title, ...(asset.tags || [])].join(" ").toLowerCase().includes(query));
        });
    }, [assets, keyword, tagFilter, library, selectedGroup]);

    useEffect(() => { setExpandedFolderId(null); setFolderBrowsePath(""); }, [selectedGroup]);

    const pagedAssets = useMemo(() => filtered.slice((assetPage - 1) * ASSET_PAGE_SIZE, assetPage * ASSET_PAGE_SIZE), [filtered, assetPage]);
    const groups = useMemo(() => ASSET_GROUPS.map((group) => ({ ...group, items: pagedAssets.filter((asset) => asset.kind === group.kind) })).filter((group) => group.items.length > 0), [pagedAssets]);
    useAssetPagePreload(filtered, assetPage, ASSET_PAGE_SIZE, undefined, !expandedFolderId);
    useEffect(() => { setAssetPage(1); }, [selectedGroup, keyword, tagFilter]);
    useEffect(() => { setAssetPage((page) => Math.min(page, Math.max(1, Math.ceil(filtered.length / ASSET_PAGE_SIZE)))); }, [filtered.length]);
    useEffect(() => { assetScrollRef.current?.scrollTo({ top: 0 }); }, [assetPage, expandedFolderId, folderBrowsePath]);

    const expandedFolder = useMemo(() => {
        if (!expandedFolderId) return null;
        const asset = assets.find((item) => item.id === expandedFolderId);
        return asset?.kind === "folder" ? asset : null;
    }, [assets, expandedFolderId]);

    useEffect(() => {
        if (expandedFolderId && !expandedFolder) {
            setExpandedFolderId(null);
            setFolderBrowsePath("");
        }
    }, [expandedFolder, expandedFolderId]);

    const openFolder = (assetId: string) => {
        setExpandedFolderId(assetId);
        setFolderBrowsePath("");
    };
    const handleFiles = async (fileList: FileList | null) => {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        setUploading(true);
        const hide = message.loading(t("canvas.sidePanel.addingAssets"), 0);
        try {
            const { added, assetIds, groupId } = await importDropSnapshotToAssets({ entries: [], files }, t as (key: string, opts?: Record<string, unknown>) => string);
            if (assetIds.length) await assignGroup(assetIds, groupId);
            if (added) message.success(t("canvas.sidePanel.addedAssets", { count: added }));
            else message.warning(t("canvas.sidePanel.mediaOnly"));
        } catch (error) {
            console.error(error);
            message.error(t("canvas.sidePanel.addFailed"));
        } finally {
            hide();
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const handleFolder = async (fileList: FileList | null) => {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        setUploading(true);
        const hide = message.loading(t("canvas.sidePanel.addingAssets"), 0);
        try {
            const bundle = await bundleFromDirectoryFileList(files);
            if (!bundle) {
                message.warning(t("canvas.sidePanel.folderEmpty"));
                return;
            }
            const id = await addFolderAssetFromBundle(bundle);
            await assignGroup([id], selectedGroup);
            message.success(t("canvas.sidePanel.addedFolder", { name: bundle.folderName }));
            if (bundle.truncated) message.info(t("canvas.folderNode.truncatedHint"));
        } catch (error) {
            console.error(error);
            message.error(t("canvas.sidePanel.addFailed"));
        } finally {
            hide();
            setUploading(false);
            if (folderInputRef.current) folderInputRef.current.value = "";
        }
    };

    return (
        <div className="relative flex h-full flex-col">
            <div className="flex items-center gap-2 px-3 pb-2 pt-1">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder={t("canvas.sidePanel.searchAssets")} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
                <Dropdown
                    disabled={uploading}
                    menu={{
                        items: [
                            { key: "media", label: t("canvas.sidePanel.addMedia"), icon: <ImageIcon className="size-3.5" />, onClick: () => fileInputRef.current?.click() },
                            { key: "folder", label: t("canvas.sidePanel.addFolder"), icon: <Folder className="size-3.5" />, onClick: () => folderInputRef.current?.click() },
                        ],
                    }}
                    trigger={["click"]}
                >
                    <button
                        type="button"
                        disabled={uploading}
                        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
                        style={{ color: theme.node.text }}
                    >
                        <Plus className="size-3.5" />
                        {t("canvas.sidePanel.add")}
                    </button>
                </Dropdown>
                <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => void handleFiles(e.target.files)} />
                <input
                    ref={(el) => {
                        folderInputRef.current = el;
                        if (el) {
                            el.setAttribute("webkitdirectory", "");
                            el.setAttribute("directory", "");
                        }
                    }}
                    type="file"
                    className="hidden"
                    multiple
                    onChange={(e) => void handleFolder(e.target.files)}
                />
            </div>
            <div className="px-3 pb-2"><LibraryGroupFilter scope="assets" /></div>
            {allTags.length ? (
                <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                    <Tag.CheckableTag checked={tagFilter === "all"} className={cn("prompt-filter-tag", tagFilter === "all" && "is-active")} onChange={() => setTagFilter("all")}>
                        {t("common.all")}
                    </Tag.CheckableTag>
                    {allTags.map((tag) => (
                        <Tag.CheckableTag key={tag} checked={tagFilter === tag} className={cn("prompt-filter-tag", tagFilter === tag && "is-active")} onChange={() => setTagFilter((prev) => (prev === tag ? "all" : tag))}>
                            {tag}
                        </Tag.CheckableTag>
                    ))}
                </div>
            ) : null}
            {expandedFolder ? (
                <FolderAssetBrowser
                    asset={expandedFolder}
                    browsePath={folderBrowsePath}
                    theme={theme}
                    onBrowsePathChange={setFolderBrowsePath}
                    onClose={() => {
                        setExpandedFolderId(null);
                        setFolderBrowsePath("");
                    }}
                    onInsert={onInsert}
                />
            ) : (
            <div ref={assetScrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {groupEntries.length > 0 && (
                    <div className="mb-3 grid grid-cols-2 gap-2 px-1 pt-1">
                        {groupEntries.map((group) => (
                            <LibraryGroupManageMenu key={group.id} scope="assets" group={group} trigger={["contextMenu"]}>
                                <button type="button" onClick={() => {
                                    setKeyword("");
                                    setTagFilter("all");
                                    setAssetPage(1);
                                    useLibraryGroupStore.getState().select("assets", group.id);
                                }} className="flex min-h-24 w-full flex-col items-start justify-center gap-2 rounded-lg px-3 py-3 text-left transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} title={group.name}>
                                    <Folder className="size-5 shrink-0 opacity-60" />
                                    <span className="w-full truncate text-xs font-medium">{group.name}</span>
                                    <span className="text-[10px] opacity-45">{groupCounts.get(group.id) ? `${groupCounts.get(group.id)} 个素材` : "暂无素材 · 点击进入"}</span>
                                </button>
                            </LibraryGroupManageMenu>
                        ))}
                    </div>
                )}
                {groups.length ? (
                    <div className="space-y-1">
                        {groups.map((group) => {
                            const isCollapsed = collapsed[group.kind];
                            return (
                                <div key={group.kind}>
                                    <button
                                        type="button"
                                        onClick={() => setCollapsed((prev) => ({ ...prev, [group.kind]: !prev[group.kind] }))}
                                        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-semibold opacity-75 transition hover:opacity-100"
                                    >
                                        <ChevronRight className={cn("size-3.5 transition-transform", !isCollapsed && "rotate-90")} />
                                        <group.icon className="size-3.5" />
                                        <span>{t(`assets.kinds.${group.kind}`)}</span>
                                        <span className="opacity-50">{group.items.length}</span>
                                    </button>
                                    {isCollapsed ? null : (
                                        <AssetVirtualGrid items={group.items}>
                                            {(asset) => (
                                                <AssetCard
                                                    key={asset.id}
                                                    asset={asset}
                                                    theme={theme}
                                                    onOpenFolder={asset.kind === "folder" ? () => openFolder(asset.id) : undefined}
                                                    onInsert={() => {
                                                        if (asset.kind === "image" && usePhotopeaLayerStore.getState().tryImport({ url: asset.data.dataUrl || asset.coverUrl || "", storageKey: asset.data.storageKey, title: asset.title })) return;
                                                        if (
                                                            asset.kind === "image" &&
                                                            tryPickModelAngleBackground({
                                                                url: asset.data.dataUrl || asset.coverUrl || "",
                                                                storageKey: asset.data.storageKey,
                                                                width: asset.data.width,
                                                                height: asset.data.height,
                                                            })
                                                        ) {
                                                            return;
                                                        }
                                                        onInsert(buildInsertPayload(asset));
                                                    }}
                                                    onRemove={() => (removeAsset(asset.id), message.success(t("canvas.sidePanel.assetRemoved")))}
                                                />
                                            )}
                                        </AssetVirtualGrid>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : activeGroup && !keyword.trim() && tagFilter === "all" ? (
                    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center" style={{ color: theme.node.text }}>
                        <Folder className="size-8 opacity-40" />
                        <div className="max-w-full break-words text-sm font-medium">{activeGroup.name}</div>
                        <div className="text-xs leading-6 opacity-50">分组暂无素材<br />拖入素材或点击上方「添加」，即可保存到此分组</div>
                        <button
                            type="button"
                            onClick={() => useLibraryGroupStore.getState().select("assets", ALL_LIBRARY_GROUPS)}
                            className="rounded-md px-2 py-1 text-xs transition hover:bg-black/5 dark:hover:bg-white/10"
                        >
                            {t("libraryGroups.backToAll")}
                        </button>
                    </div>
                ) : groupEntries.length ? null : (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={assets.length ? t("canvas.sidePanel.noAssets") : t("canvas.sidePanel.dropHint")}
                        className="pt-16"
                    />
                )}
            </div>
            )}
            {!expandedFolder && <AssetPageControls page={assetPage} total={filtered.length} pageSize={ASSET_PAGE_SIZE} onChange={setAssetPage} />}
        </div>
    );
});

function parentFolderPath(path: string) {
    const idx = path.lastIndexOf("/");
    return idx === -1 ? "" : path.slice(0, idx);
}

function RenameAssetDialog({ assetId, open, initialName, onClose }: { assetId: string; open: boolean; initialName: string; onClose: () => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [name, setName] = useState(initialName);
    const [error, setError] = useState("");
    useEffect(() => {
        if (!open) return;
        setName(initialName);
        setError("");
    }, [open, initialName]);
    const save = () => {
        const next = name.trim();
        if (!next || next.length > 80) {
            setError(t("canvas.sidePanel.assetNameRequired"));
            return;
        }
        useAssetStore.getState().updateAsset(assetId, { title: next });
        message.success(t("canvas.sidePanel.assetRenamed"));
        onClose();
    };
    return (
        <Modal title={t("canvas.sidePanel.renameAssetTitle")} open={open} centered width={400} zIndex={CANVAS_SIDE_PANEL_Z_INDEX + 100}
            okText={t("common.save")} cancelText={t("common.cancel")} onOk={save} onCancel={onClose} destroyOnHidden>
            <div data-canvas-shortcuts-ignore>
                <Input autoFocus value={name} maxLength={80} aria-label={t("canvas.sidePanel.renameAsset")} status={error ? "error" : undefined} onChange={(event) => { setError(""); setName(event.target.value); }} onPressEnter={save} />
                {error ? <Typography.Text type="danger" className="mt-2 block text-xs" role="alert">{error}</Typography.Text> : null}
            </div>
        </Modal>
    );
}

function FolderEntryContextMenu({ name, onRemove, children }: { name: string; onRemove: () => void; children: ReactElement }) {
    const { t } = useTranslation();
    const { modal } = App.useApp();
    return (
        <div className="min-w-0">
            <Dropdown
                trigger={["contextMenu"]}
                menu={{ items: [{
                    key: "delete",
                    danger: true,
                    label: t("canvas.sidePanel.remove"),
                    icon: <Trash2 className="size-3.5" />,
                    onClick: () => {
                        modal.confirm({
                            title: t("canvas.sidePanel.folderRemoveEntryTitle", { name }),
                            content: t("canvas.sidePanel.folderRemoveEntryHint"),
                            okText: t("canvas.sidePanel.remove"),
                            cancelText: t("common.cancel"),
                            okButtonProps: { danger: true },
                            zIndex: CANVAS_SIDE_PANEL_Z_INDEX + 100,
                            onOk: onRemove,
                        });
                    },
                }] }}
            >
                <div className="min-w-0">{children}</div>
            </Dropdown>
        </div>
    );
}

function FolderAssetBrowser({
    asset,
    browsePath,
    theme,
    onBrowsePathChange,
    onClose,
    onInsert,
}: {
    asset: FolderAsset;
    browsePath: string;
    theme: CanvasTheme;
    onBrowsePathChange: (path: string) => void;
    onClose: () => void;
    onInsert: (payload: InsertAssetPayload) => void;
}) {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const [inserting, setInserting] = useState<string | null>(null);
    const [renaming, setRenaming] = useState(false);
    const repairInput = useRef<HTMLInputElement>(null);
    const [repairing, setRepairing] = useState(false);
    const [page, setPage] = useState(1);
    const browserRef = useRef<HTMLDivElement>(null);
    const entries = useMemo(() => childrenOfFolderAsset(asset.data.entries || [], browsePath), [asset.data.entries, browsePath]);
    useAssetPagePreload(entries, page, ASSET_PAGE_SIZE, asset);
    useEffect(() => { setPage(1); }, [asset.id, browsePath]);
    useEffect(() => { setPage((current) => Math.min(current, Math.max(1, Math.ceil(entries.length / ASSET_PAGE_SIZE)))); }, [entries.length]);
    useEffect(() => { browserRef.current?.scrollTo({ top: 0 }); }, [page]);
    const title = browsePath ? browsePath.split("/").pop() || browsePath : asset.title || asset.data.folderName;

    const goBack = () => {
        if (!browsePath) {
            onClose();
            return;
        }
        onBrowsePathChange(parentFolderPath(browsePath));
    };
    const removeEntry = (entry: CanvasFolderEntry) => {
        removeFolderAssetEntry(asset, entry.path);
        message.success(t("canvas.sidePanel.folderEntryRemoved"));
    };
    const removeFolderAsset = () => {
        if (browsePath) {
            modal.confirm({
                title: t("canvas.sidePanel.folderRemoveEntryTitle", { name: title }),
                content: t("canvas.sidePanel.folderRemoveEntryHint"),
                okText: t("canvas.sidePanel.remove"),
                cancelText: t("common.cancel"),
                okButtonProps: { danger: true },
                zIndex: CANVAS_SIDE_PANEL_Z_INDEX + 100,
                onOk: () => {
                    removeFolderAssetEntry(asset, browsePath);
                    onBrowsePathChange(parentFolderPath(browsePath));
                    message.success(t("canvas.sidePanel.folderEntryRemoved"));
                },
            });
            return;
        }
        modal.confirm({
            title: t("canvas.sidePanel.folderRemoveAssetTitle", { name: asset.title || asset.data.folderName }),
            content: t("canvas.sidePanel.folderRemoveEntryHint"),
            okText: t("canvas.sidePanel.remove"),
            cancelText: t("common.cancel"),
            okButtonProps: { danger: true },
            zIndex: CANVAS_SIDE_PANEL_Z_INDEX + 100,
            onOk: () => {
                onClose();
                useAssetStore.getState().removeAsset(asset.id);
                message.success(t("canvas.sidePanel.assetRemoved"));
            },
        });
    };

    const insertEntry = async (entry: CanvasFolderEntry) => {
        if (entry.kind !== "file" || !isFolderImageFileName(entry.name)) return;
        const photopeaImport = usePhotopeaLayerStore.getState().handler;
        setInserting(entry.path);
        const hide = message.loading(t("canvas.sidePanel.addingAssets"), 0);
        try {
            const payload = await folderAssetFileToImagePayload(asset, entry.path, entry.name);
            if (!payload || payload.kind !== "image") {
                message.error(t("canvas.sidePanel.folderFileMissing"));
                return;
            }
            if (photopeaImport) {
                photopeaImport({ url: payload.dataUrl, storageKey: payload.storageKey, title: payload.title });
                return;
            }
            onInsert(payload);
            message.success(t("canvas.sidePanel.inserted"));
        } catch (error) {
            console.error(error);
            message.error(t("canvas.sidePanel.insertImageFailed"));
        } finally {
            hide();
            setInserting(null);
        }
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-1 px-3 pb-2">
                <button
                    type="button"
                    onClick={goBack}
                    className="grid size-7 shrink-0 place-items-center rounded-md transition hover:bg-black/5 dark:hover:bg-white/10"
                    style={{ color: theme.node.text }}
                    aria-label={t("canvas.sidePanel.folderBack")}
                    title={t("canvas.sidePanel.folderBack")}
                >
                    <ChevronLeft className="size-4" />
                </button>
                <Dropdown trigger={["contextMenu"]} menu={{ items: [
                    ...(!browsePath ? [{ key: "rename", label: t("canvas.sidePanel.renameAsset"), icon: <Pencil className="size-3.5" />, onClick: () => setRenaming(true) }] : []),
                    { key: "delete", danger: true, label: t("canvas.sidePanel.removeAsset"), icon: <Trash2 className="size-3.5" />, onClick: removeFolderAsset },
                ] }}>
                    <div className="min-w-0 flex-1 truncate text-xs font-semibold" style={{ color: theme.node.text }} title={title}>
                        {title}
                    </div>
                </Dropdown>
                <span className="shrink-0 text-[10px] opacity-45">{entries.length}</span>
                <button type="button" disabled={repairing} className="shrink-0 rounded px-1 py-1 text-[10px] opacity-70 hover:bg-black/5 dark:hover:bg-white/10" onClick={() => repairInput.current?.click()}>{repairing ? "恢复中…" : "恢复原文件"}</button>
                <input ref={repairInput} type="file" className="hidden" multiple {...{ webkitdirectory: "" }} onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    event.target.value = "";
                    if (!files.length) return;
                    if (files[0].webkitRelativePath.split("/")[0] !== asset.data.folderName) { message.error(`请选择原文件夹：${asset.data.folderName}`); return; }
                    const paths = new Set(asset.data.entries.filter((item) => item.kind === "file").map((item) => item.path));
                    const items = files.map((file) => ({ file, path: file.webkitRelativePath.split("/").slice(1).join("/") })).filter((item) => paths.has(item.path) && isFolderImageFileName(item.file.name));
                    if (!items.length) { message.error("所选文件夹没有匹配的图片"); return; }
                    setRepairing(true);
                    void saveFolderAssetImages(asset.id, items).then(() => {
                        useAssetStore.getState().updateAsset(asset.id, {});
                        message.success(`已恢复 ${items.length} 张图片原件`);
                    }).catch((error) => message.error(error instanceof Error ? error.message : "原文件恢复失败")).finally(() => setRepairing(false));
                }} />
            </div>
            <div ref={browserRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {entries.length ? (
                <div className="grid grid-cols-2 items-start gap-2 px-1 pb-2">
                    {entries.slice((page - 1) * ASSET_PAGE_SIZE, page * ASSET_PAGE_SIZE).map((entry) => {
                        if (entry.kind === "directory") {
                            return (
                                <FolderEntryContextMenu key={entry.path} name={entry.name} onRemove={() => removeEntry(entry)}>
                                    <button
                                        type="button"
                                        onClick={() => onBrowsePathChange(entry.path)}
                                        className="group relative aspect-square w-full overflow-hidden rounded-xl border transition duration-200 hover:-translate-y-0.5 hover:shadow-lg"
                                        style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.text }}
                                        title={entry.name}
                                    >
                                        <div className="flex size-full flex-col items-center justify-center gap-1.5 px-2 text-center">
                                            <Folder className="size-7 opacity-70" />
                                            <div className="line-clamp-2 text-[11px] font-medium leading-snug opacity-80">{entry.name}</div>
                                        </div>
                                    </button>
                                </FolderEntryContextMenu>
                            );
                        }
                        if (isFolderImageFileName(entry.name)) {
                            return (
                                <FolderEntryContextMenu key={entry.path} name={entry.name} onRemove={() => removeEntry(entry)}>
                                    <FolderImageEntryCard
                                        asset={asset}
                                        entry={entry}
                                        theme={theme}
                                        inserting={inserting === entry.path}
                                        onInsert={() => void insertEntry(entry)}
                                    />
                                </FolderEntryContextMenu>
                            );
                        }
                        return (
                            <FolderEntryContextMenu key={entry.path} name={entry.name} onRemove={() => removeEntry(entry)}>
                                <FolderFilePlaceholderCard entry={entry} theme={theme} />
                            </FolderEntryContextMenu>
                        );
                    })}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("canvas.sidePanel.folderBrowseEmpty")} className="pt-10" />
            )}
            </div>
            <AssetPageControls page={page} total={entries.length} pageSize={ASSET_PAGE_SIZE} onChange={setPage} />
            <RenameAssetDialog assetId={asset.id} open={renaming} initialName={asset.title || asset.data.folderName} onClose={() => setRenaming(false)} />
        </div>
    );
}

function FolderFilePlaceholderCard({ entry, theme }: { entry: CanvasFolderEntry; theme: CanvasTheme }) {
    return (
        <div className="relative aspect-square overflow-hidden rounded-xl border" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.text }} title={entry.name}>
            <div className="flex size-full flex-col items-center justify-center gap-1.5 px-2 text-center">
                <FileText className="size-7 opacity-70" />
                <div className="line-clamp-2 text-[11px] font-medium leading-snug opacity-80">{entry.name}</div>
            </div>
        </div>
    );
}

function FolderImageEntryCard({
    asset,
    entry,
    theme,
    inserting,
    onInsert,
}: {
    asset: FolderAsset;
    entry: CanvasFolderEntry;
    theme: CanvasTheme;
    inserting: boolean;
    onInsert: () => void;
}) {
    const { t } = useTranslation();
    const [thumb, setThumb] = useState<string>("");
    const cardRef = useRef<HTMLDivElement>(null);
    const [loadError, setLoadError] = useState("");
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        let url = "";
        let started = false;
        setThumb("");
        setLoadError("");
        const observer = new IntersectionObserver(([visible]) => {
            if (!visible.isIntersecting || started) return;
            started = true;
            void readFolderAssetThumbnail(asset, entry.path, controller.signal).then((blob) => {
                if (controller.signal.aborted) return;
                url = URL.createObjectURL(blob);
                setThumb(url);
            }).catch((error) => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "图片加载失败"); });
        }, { rootMargin: "160px" });
        if (cardRef.current) observer.observe(cardRef.current);
        return () => {
            controller.abort();
            observer.disconnect();
            if (url) URL.revokeObjectURL(url);
        };
    }, [asset.id, asset.updatedAt, entry.path, retry]);

    return (
        <div
            ref={cardRef}
            draggable={!inserting}
            onDragStart={(event) => {
                event.currentTarget.setAttribute("data-dragging", "true");
                writeSidePanelInsertDataTransfer(event.dataTransfer, { source: "folderFile", assetId: asset.id, path: entry.path, name: entry.name });
                setSidePanelDragGhost(event.nativeEvent, { imageUrl: thumb || undefined, label: entry.name, size: 96 });
            }}
            onDragEnd={(event) => event.currentTarget.removeAttribute("data-dragging")}
            onClick={() => { if (loadError) { setRetry((value) => value + 1); return; } if (!inserting && usePhotopeaLayerStore.getState().handler) onInsert(); }}
            className={cn("group relative cursor-grab overflow-hidden rounded-xl border transition duration-200 hover:-translate-y-0.5 hover:shadow-lg active:cursor-grabbing data-[dragging=true]:hover:translate-y-0", !thumb && "aspect-square")}
            style={{ borderColor: theme.node.stroke, background: theme.node.panel }}
            title={t("canvas.sidePanel.dragToCanvas")}
        >
            {thumb ? (
                <img src={thumb} alt="" draggable={false} className="pointer-events-none block h-auto w-full" />
            ) : (
                <div className="pointer-events-none flex size-full flex-col items-center justify-center gap-1 px-2 text-center">
                    <ImageIcon className="size-6 opacity-50" />
                    <div className="line-clamp-2 text-[11px] leading-snug opacity-70">{entry.name}</div>
                    <div className="px-1 text-center text-[10px] opacity-60" title={loadError || undefined}>{loadError ? "原件读取失败，请点顶部「恢复原文件」" : "等待加载…"}</div>
                </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-center gap-2.5 pb-2 opacity-0 transition duration-200 group-hover:pointer-events-auto group-hover:opacity-100 group-data-[dragging=true]:pointer-events-none group-data-[dragging=true]:opacity-0">
                <button
                    type="button"
                    disabled={inserting}
                    onClick={(event) => {
                        event.stopPropagation();
                        onInsert();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    className="grid size-8 place-items-center rounded-full bg-white/90 text-stone-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-stone-900 disabled:opacity-50 dark:bg-black/60 dark:text-stone-100 dark:hover:bg-black/80"
                    aria-label={t("canvas.sidePanel.inserted")}
                >
                    {inserting ? <Spin size="small" /> : <Plus className="size-4" />}
                </button>
            </div>
        </div>
    );
}

function AssetCard({ asset, theme, onInsert, onRemove, onOpenFolder }: { asset: Asset; theme: CanvasTheme; onInsert: () => void; onRemove: () => void; onOpenFolder?: () => void }) {
    const { t } = useTranslation();
    const { modal } = App.useApp();
    const [renaming, setRenaming] = useState(false);
    const photopeaOpen = usePhotopeaLayerStore((state) => Boolean(state.handler));
    const assetName = asset.kind === "folder" ? asset.title || asset.data.folderName : asset.title;
    return (
        <>
        <Dropdown trigger={["contextMenu"]} menu={{ items: [
            { key: "rename", label: t("canvas.sidePanel.renameAsset"), icon: <Pencil className="size-3.5" />, onClick: () => setRenaming(true) },
            {
            key: "delete",
            danger: true,
            label: t("canvas.sidePanel.removeAsset"),
            icon: <Trash2 className="size-3.5" />,
            onClick: () => {
                modal.confirm({
                    title: t("canvas.sidePanel.removeAssetTitle"),
                    okText: t("canvas.sidePanel.remove"),
                    cancelText: t("common.cancel"),
                    okButtonProps: { danger: true },
                    zIndex: CANVAS_SIDE_PANEL_Z_INDEX + 100,
                    onOk: onRemove,
                });
            },
        }] }}>
        <div
            draggable
            onDragStart={(event) => {
                event.currentTarget.setAttribute("data-dragging", "true");
                writeSidePanelInsertDataTransfer(event.dataTransfer, { source: "asset", assetId: asset.id });
                const preview = assetDragPreview(asset);
                if (asset.kind === "image") preview.imageUrl = event.currentTarget.querySelector("img")?.src;
                setSidePanelDragGhost(event.nativeEvent, preview);
            }}
            onDragEnd={(event) => event.currentTarget.removeAttribute("data-dragging")}
            onDoubleClick={(event) => {
                if (!onOpenFolder) return;
                event.preventDefault();
                event.stopPropagation();
                onOpenFolder();
            }}
            onClick={() => {
                if (asset.kind === "image" && usePhotopeaLayerStore.getState().tryImport({ url: asset.data.dataUrl || asset.coverUrl || "", storageKey: asset.data.storageKey, title: asset.title })) return;
                if (
                    asset.kind === "image" &&
                    tryPickModelAngleBackground({
                        url: asset.data.dataUrl || asset.coverUrl || "",
                        storageKey: asset.data.storageKey,
                        width: asset.data.width,
                        height: asset.data.height,
                    })
                ) {
                    return;
                }
            }}
            className={cn("group relative cursor-grab overflow-hidden rounded-xl border transition duration-200 hover:-translate-y-0.5 hover:shadow-lg active:cursor-grabbing data-[dragging=true]:hover:translate-y-0", asset.kind !== "image" && "aspect-square")}
            style={{ borderColor: theme.node.stroke, background: theme.node.panel }}
            title={asset.kind === "folder" ? t("canvas.sidePanel.folderExpandHint") : asset.kind === "image" ? t(photopeaOpen ? "canvas.editors.photopeaImportLayer" : "canvas.modelNode.clickImageAsBg") : t("canvas.sidePanel.dragToCanvas")}
        >
            <div data-drag-preview className={asset.kind === "image" ? "w-full" : "size-full"}>
                <AssetCover asset={asset} />
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-center gap-1 pb-2 opacity-0 transition duration-200 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-data-[dragging=true]:pointer-events-none group-data-[dragging=true]:opacity-0">
                <LibraryGroupMove scope="assets" itemKeys={[asset.id]} compact overlay />
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        setRenaming(true);
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    className="grid size-8 place-items-center rounded-full bg-white/90 text-stone-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-stone-900 dark:bg-black/60 dark:text-stone-100 dark:hover:bg-black/80"
                    aria-label={t("canvas.sidePanel.renameAsset")}
                    title={t("canvas.sidePanel.renameAsset")}
                >
                    <Pencil className="size-4" />
                </button>
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onInsert();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    className="grid size-8 place-items-center rounded-full bg-white/90 text-stone-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-stone-900 dark:bg-black/60 dark:text-stone-100 dark:hover:bg-black/80"
                    aria-label={t("canvas.sidePanel.inserted")}
                >
                    <Plus className="size-4" />
                </button>
                <Popconfirm
                    title={t("canvas.sidePanel.removeAssetTitle")}
                    okText={t("canvas.sidePanel.remove")}
                    cancelText={t("common.cancel")}
                    okButtonProps={{ danger: true }}
                    onConfirm={onRemove}
                    getPopupContainer={() => document.body}
                    zIndex={CANVAS_SIDE_PANEL_Z_INDEX + 100}
                >
                    <button
                        type="button"
                        onClick={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        className="grid size-8 place-items-center rounded-full bg-white/90 text-stone-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-red-500 dark:bg-black/60 dark:text-stone-100 dark:hover:bg-black/80 dark:hover:text-red-400"
                        aria-label={t("canvas.sidePanel.removeAsset")}
                    >
                        <Trash2 className="size-4" />
                    </button>
                </Popconfirm>
            </div>
        </div>
        </Dropdown>
        <RenameAssetDialog assetId={asset.id} open={renaming} initialName={assetName} onClose={() => setRenaming(false)} />
        </>
    );
}

function AssetCover({ asset }: { asset: Asset }) {
    if (asset.kind === "text") return <div className="pointer-events-none size-full overflow-hidden whitespace-pre-wrap break-words p-2.5 text-[11px] leading-snug opacity-80">{asset.data.content}</div>;
    if (asset.kind === "folder") {
        return (
            <div className="pointer-events-none flex size-full flex-col items-center justify-center gap-1.5 px-2 text-center">
                <Folder className="size-7 opacity-70" />
                <div className="line-clamp-2 text-[11px] font-medium leading-snug opacity-80">{asset.title || asset.data.folderName}</div>
                <div className="text-[10px] opacity-50">{asset.data.entryCount || asset.data.entries?.length || 0}</div>
            </div>
        );
    }
    if (asset.kind === "video") {
        if (asset.coverUrl) return <img src={asset.coverUrl} alt="" draggable={false} className="pointer-events-none size-full object-cover transition duration-300 group-hover:scale-[1.04]" />;
        return <video src={`${asset.data.url}#t=0.1`} muted playsInline preload="metadata" draggable={false} className="pointer-events-none size-full object-cover transition duration-300 group-hover:scale-[1.04]" />;
    }
    return <AssetImage asset={asset} />;
}

// ---------------------------------------------------------------------------
// Prompt library tab: collapsible source groups, lazy loading, and copy or text-node insertion actions.
// ---------------------------------------------------------------------------

const CanvasPromptsTab = memo(function CanvasPromptsTab({ onInsert, theme }: { onInsert: (payload: InsertAssetPayload) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const assignGroup = useLibraryGroupAssignment("prompts");
    const sources = usePromptSourceStore((state) => state.sources);
    const promptGroups = useMemo(
        () => [{ id: LOCAL_PROMPT_SOURCE_ID, name: localPromptCategory() }, ...sources.filter((source) => source.enabled).map((source) => ({ id: source.id, name: source.name }))],
        [sources, t],
    );
    const [keyword, setKeyword] = useState("");
    const [expanded, setExpanded] = useState<Record<string, boolean>>({ [LOCAL_PROMPT_SOURCE_ID]: true });
    const [detail, setDetail] = useState<Prompt | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
    const [assetDraft, setAssetDraft] = useState<(PromptAssetDraft & { title: string; id: string }) | null>(null);
    const [saving, setSaving] = useState(false);

    const copyPrompt = async (prompt: string) => {
        try {
            await navigator.clipboard.writeText(prompt);
            message.success(t("canvas.sidePanel.promptCopied"));
        } catch {
            message.error(t("canvas.sidePanel.copyFailed"));
        }
    };

    const invalidatePromptViews = () => Promise.all([
        queryClient.invalidateQueries({ queryKey: ["side-panel-prompts", LOCAL_PROMPT_SOURCE_ID] }),
        queryClient.invalidateQueries({ queryKey: ["prompts"] }),
    ]);

    const openEdit = (item: Prompt) => {
        if (!isLocalPromptSource(item.sourceId)) {
            setDetail(item);
            return;
        }
        if (item.bundle?.length || item.generation) {
            setAssetDraft({ id: item.id, title: item.title, prompt: item.prompt, media: item.bundle || [], generation: item.generation });
            return;
        }
        setEditingPrompt(item);
        setEditorOpen(true);
    };

    const handleCreate = async (values: LocalPromptInput) => {
        setSaving(true);
        try {
            if (editingPrompt) {
                await updateLocalPrompt(editingPrompt.id, values);
                await assignGroup([promptGroupKey(editingPrompt)], values.groupId);
                message.success(t("prompts.editor.updated"));
            } else {
                const created = await createLocalPrompt(values);
                await assignGroup([promptGroupKey({ sourceId: LOCAL_PROMPT_SOURCE_ID, id: created.id })], values.groupId);
                message.success(t("prompts.editor.created"));
                setExpanded((prev) => ({ ...prev, [LOCAL_PROMPT_SOURCE_ID]: true }));
            }
            setEditorOpen(false);
            setEditingPrompt(null);
            await invalidatePromptViews();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("prompts.editor.saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    const handleSaveAsset = async (values: PromptAssetDraft & { title: string }) => {
        if (!assetDraft) return;
        setSaving(true);
        try {
            await updateLocalPrompt(assetDraft.id, {
                title: values.title,
                prompt: values.prompt,
                bundle: await persistPromptAssetMedia(values.media),
                generation: values.generation,
            });
            useAssetStore.getState().cleanupImages();
            await assignGroup([promptGroupKey({ sourceId: LOCAL_PROMPT_SOURCE_ID, id: assetDraft.id })], values.groupId);
            setAssetDraft(null);
            message.success(t("prompts.editor.updated"));
            await invalidatePromptViews();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("prompts.editor.saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (item: Prompt) => {
        try {
            await deleteLocalPrompt(item.id);
            if (detail?.id === item.id) setDetail(null);
            if (assetDraft?.id === item.id) setAssetDraft(null);
            message.success(t("prompts.editor.deleted"));
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["side-panel-prompts", LOCAL_PROMPT_SOURCE_ID] }),
                queryClient.invalidateQueries({ queryKey: ["prompts"] }),
            ]);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("prompts.editor.saveFailed"));
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-3 pb-2 pt-1">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder={t("canvas.sidePanel.searchPrompts")} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
                <button
                    type="button"
                    onClick={() => {
                        setEditingPrompt(null);
                        setEditorOpen(true);
                    }}
                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition hover:bg-black/5 dark:hover:bg-white/10"
                    style={{ color: theme.node.text }}
                >
                    <Plus className="size-3.5" />
                    {t("canvas.sidePanel.add")}
                </button>
            </div>
            <div className="px-3 pb-2"><LibraryGroupFilter scope="prompts" /></div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                <div className="space-y-1">
                    {promptGroups.map((source) => (
                        <PromptSourceGroup
                            key={source.id}
                            sourceId={source.id}
                            sourceName={source.name}
                            keyword={keyword}
                            open={!!expanded[source.id]}
                            theme={theme}
                            onToggle={() => setExpanded((prev) => ({ ...prev, [source.id]: !prev[source.id] }))}
                            onInsert={onInsert}
                            onView={openEdit}
                            onDelete={source.id === LOCAL_PROMPT_SOURCE_ID ? handleDelete : undefined}
                        />
                    ))}
                </div>
            </div>
            <PromptDetailDialog prompt={detail} onClose={() => setDetail(null)} onCopy={(prompt) => void copyPrompt(prompt)} onDelete={detail && isLocalPromptSource(detail.sourceId) ? () => void handleDelete(detail) : undefined} />
            <PromptEditorDialog
                open={editorOpen}
                prompt={editingPrompt}
                saving={saving}
                onCancel={() => {
                    setEditorOpen(false);
                    setEditingPrompt(null);
                }}
                onSubmit={handleCreate}
            />
            <PromptAssetSaveDialog draft={assetDraft} saving={saving} onCancel={() => !saving && setAssetDraft(null)} onSubmit={(values) => void handleSaveAsset(values)} />
        </div>
    );
});

function PromptSourceGroup({
    sourceId,
    sourceName,
    keyword,
    open,
    theme,
    onToggle,
    onInsert,
    onView,
    onDelete,
}: {
    sourceId: string;
    sourceName: string;
    keyword: string;
    open: boolean;
    theme: CanvasTheme;
    onToggle: () => void;
    onInsert: (payload: InsertAssetPayload) => void;
    onView: (prompt: Prompt) => void;
    onDelete?: (prompt: Prompt) => void;
}) {
    const { t } = useTranslation();
    // Cache a source after its first expansion to avoid repeated requests; search results also need the data for counts.
    const library = useLibraryGroupStore((state) => state.data.prompts);
    const selectedGroup = useLibraryGroupStore((state) => state.selected.prompts);
    const showResults = open || !!keyword.trim() || selectedGroup !== ALL_LIBRARY_GROUPS;
    const query = useQuery({ queryKey: ["side-panel-prompts", sourceId], queryFn: () => fetchSourcePrompts(sourceId), enabled: showResults, staleTime: 1000 * 60 * 60 });

    const filtered = useMemo(() => {
        const items = query.data || [];
        const q = keyword.trim().toLowerCase();
        return items.filter((item) => matchesLibraryGroup(library, promptGroupKey(item), selectedGroup) && (!q || [item.title, item.prompt, ...item.tags].join(" ").toLowerCase().includes(q)));
    }, [query.data, keyword, library, selectedGroup]);

    const insertPrompt = (item: Prompt) =>
        onInsert(item.bundle?.length || item.generation ? { kind: "promptAsset", title: item.title, prompt: item.prompt, bundle: item.bundle || [], generation: item.generation } : { kind: "text", content: item.prompt, title: item.title });

    return (
        <div>
            <button type="button" onClick={onToggle} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-semibold opacity-75 transition hover:opacity-100">
                <ChevronRight className={cn("size-3.5 transition-transform", showResults && "rotate-90")} />
                <BookOpen className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">{sourceName}</span>
                {showResults && query.isSuccess ? <span className="opacity-50">{filtered.length}</span> : null}
            </button>
            {showResults ? (
                <div className="px-1 pb-2 pt-1">
                    {query.isLoading ? (
                        <div className="flex justify-center py-6">
                            <Spin size="small" />
                        </div>
                    ) : query.isError ? (
                        <button type="button" onClick={() => void query.refetch()} className="block w-full py-4 text-center text-xs text-red-500 opacity-80 transition hover:opacity-100">
                            {t("canvas.sidePanel.loadFailedRetry")}
                        </button>
                    ) : filtered.length ? (
                        <div className="space-y-1.5">
                            {filtered.map((item) => (
                                <PromptRow key={item.id} item={item} theme={theme} onInsert={() => insertPrompt(item)} onView={() => onView(item)} onDelete={onDelete ? () => onDelete(item) : undefined} />
                            ))}
                        </div>
                    ) : (
                        <div className="py-4 text-center text-xs opacity-40">{keyword.trim() ? t("canvas.sidePanel.noMatchingPrompts") : t("canvas.sidePanel.sourceEmpty")}</div>
                    )}
                </div>
            ) : null}
        </div>
    );
}

function PromptRow({ item, theme, onInsert, onView, onDelete }: { item: Prompt; theme: CanvasTheme; onInsert: () => void; onView: () => void; onDelete?: () => void }) {
    const { t } = useTranslation();
    return (
        <div
            draggable
            onDragStart={(event) => {
                event.currentTarget.setAttribute("data-dragging", "true");
                writeSidePanelInsertDataTransfer(event.dataTransfer, { source: "prompt", title: item.title, content: item.prompt, bundle: item.bundle, generation: item.generation });
                setSidePanelDragGhost(event.nativeEvent, { imageUrl: item.coverUrl || undefined, label: item.title || item.prompt, size: 96 });
            }}
            onDragEnd={(event) => event.currentTarget.removeAttribute("data-dragging")}
            className="group relative flex cursor-grab items-center gap-2.5 rounded-lg px-2 py-2 transition hover:bg-black/5 active:cursor-grabbing dark:hover:bg-white/5"
            title={t("canvas.sidePanel.dragToCanvas")}
        >
            <div data-drag-preview className="flex min-w-0 flex-1 items-center gap-2.5">
                {item.coverUrl ? (
                    <img src={item.coverUrl} alt="" draggable={false} className="pointer-events-none size-10 shrink-0 rounded-md object-cover" loading="lazy" />
                ) : (
                    <span className="grid size-10 shrink-0 place-items-center rounded-md" style={{ background: theme.node.panel }}>
                        <FileText className="size-4 opacity-50" />
                    </span>
                )}
                <button type="button" onClick={onView} className="min-w-0 flex-1 cursor-inherit text-left">
                    <div className="truncate text-sm font-medium leading-snug">{item.title}</div>
                    <div className="mt-0.5 truncate text-xs leading-snug opacity-50">{item.prompt}</div>
                </button>
            </div>
            <LibraryGroupMove scope="prompts" itemKeys={[promptGroupKey(item)]} compact />
            <div className="flex shrink-0 flex-col items-center gap-0.5 group-data-[dragging=true]:opacity-0">
                <button type="button" onClick={onView} onMouseDown={(event) => event.stopPropagation()} className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10" aria-label={onDelete ? t("common.edit") : t("canvas.sidePanel.viewDetails")} title={onDelete ? t("common.edit") : t("canvas.sidePanel.viewDetails")}>
                    {onDelete ? <Pencil className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
                <button
                    type="button"
                    onClick={onInsert}
                    onMouseDown={(event) => event.stopPropagation()}
                    className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
                    style={{ color: theme.toolbar.activeText }}
                    aria-label={t("canvas.sidePanel.inserted")}
                    title={t("canvas.sidePanel.inserted")}
                >
                    <Plus className="size-3.5" />
                </button>
                {onDelete ? (
                    <Popconfirm
                        title={t("prompts.editor.deleteTitle", { name: item.title })}
                        description={t("prompts.editor.deleteDescription")}
                        okText={t("common.delete")}
                        cancelText={t("common.cancel")}
                        okButtonProps={{ danger: true }}
                        onConfirm={onDelete}
                        getPopupContainer={() => document.body}
                        zIndex={CANVAS_SIDE_PANEL_Z_INDEX + 100}
                    >
                        <button type="button" onMouseDown={(event) => event.stopPropagation()} className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 hover:text-red-500 dark:hover:bg-white/10 dark:hover:text-red-400" aria-label={t("common.delete")} title={t("common.delete")}>
                            <Trash2 className="size-3.5" />
                        </button>
                    </Popconfirm>
                ) : null}
            </div>
        </div>
    );
}
