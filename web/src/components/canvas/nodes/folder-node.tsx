import { Tooltip } from "antd";
import { ChevronDown, ChevronUp, File, Folder, FolderOpen, Minus, Plus, Sparkles } from "lucide-react";
import { useMemo, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { handleNodeContentWheel } from "@/lib/canvas/canvas-wheel";
import type { FolderSkillSummary } from "@/lib/canvas/folder-drop";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import type { CanvasFolderEntry, CanvasNodeMetadata } from "@/types/canvas";
import type { CanvasNodeContext, CanvasNodeDefinition } from "@/types/canvas-plugin";

export const FOLDER_NODE_TYPE = "folder";

const COLUMN_WIDTH = 168;
const BASE_WIDTH = 300;
const NODE_HEIGHT = 280;

export function folderMetadataFromBundle(input: {
    folderName: string;
    entries: CanvasFolderEntry[];
    truncated?: boolean;
    topLevelDirs?: string[];
    skill?: FolderSkillSummary;
    storageMode?: "copy" | "reference";
    localPath?: string;
    dataPath?: string;
    totalBytes?: number;
}): CanvasNodeMetadata {
    return {
        folderName: input.folderName,
        folderEntries: input.entries,
        folderEntryCount: input.entries.length,
        folderTruncated: Boolean(input.truncated),
        ...(input.topLevelDirs?.length ? { folderTopLevelDirs: input.topLevelDirs } : {}),
        folderPreviewMode: "list",
        folderColumnRoots: [""],
        folderSelectedPath: "",
        folderStorageMode: input.storageMode,
        folderLocalPath: input.localPath || "",
        folderDataPath: input.dataPath || "",
        folderTotalBytes: input.totalBytes,
        ...(input.skill
            ? {
                  folderSkillName: input.skill.name,
                  folderSkillDisplayName: input.skill.displayName,
                  folderSkillDescription: input.skill.description,
              }
            : {}),
    };
}

export function buildAddFolderNodeOp(input: {
    folderName: string;
    entries: CanvasFolderEntry[];
    truncated?: boolean;
    topLevelDirs?: string[];
    skill?: FolderSkillSummary;
    position: { x: number; y: number };
    id?: string;
    storageMode?: "copy" | "reference";
    localPath?: string;
    dataPath?: string;
    totalBytes?: number;
}): CanvasAgentOp {
    return {
        type: "add_node",
        id: input.id,
        nodeType: FOLDER_NODE_TYPE,
        title: input.folderName,
        position: input.position,
        metadata: folderMetadataFromBundle(input),
    };
}

function isSkillMdEntry(entry: CanvasFolderEntry) {
    return entry.kind === "file" && /^skill\.md$/i.test(entry.name);
}

function resolveFolderSkillDescription(
    ctx: CanvasNodeContext,
    skills: ReturnType<typeof useAgentSkillStore.getState>["skills"],
) {
    const fromMeta = (ctx.node.metadata?.folderSkillDescription || "").trim();
    if (fromMeta) {
        return {
            title: (ctx.node.metadata?.folderSkillDisplayName || ctx.node.metadata?.folderSkillName || ctx.node.metadata?.folderName || "").trim(),
            description: fromMeta,
        };
    }
    const folderName = (ctx.node.metadata?.folderName || ctx.node.title || "").trim().toLowerCase();
    if (!folderName) return null;
    const matched = skills.find((skill) => {
        const name = (skill.name || "").toLowerCase();
        const display = (skill.interface?.displayName || "").toLowerCase();
        const path = (skill.path || "").replace(/\\/g, "/").toLowerCase();
        return name === folderName || display === folderName || path.includes(`/${folderName}/`) || path.endsWith(`/${folderName}`);
    });
    if (!matched) return null;
    const description = (matched.interface?.shortDescription || matched.shortDescription || matched.description || "").trim();
    if (!description) return null;
    return {
        title: (matched.interface?.displayName || matched.name || folderName).trim(),
        description,
    };
}

function childrenOf(entries: CanvasFolderEntry[], parentPath: string): CanvasFolderEntry[] {
    const prefix = parentPath ? `${parentPath}/` : "";
    return entries
        .filter((entry) => {
            if (!parentPath) return !entry.path.includes("/");
            if (!entry.path.startsWith(prefix)) return false;
            const rest = entry.path.slice(prefix.length);
            return Boolean(rest) && !rest.includes("/");
        })
        .sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
}

function parentOfPath(path: string) {
    const idx = path.lastIndexOf("/");
    return idx === -1 ? "" : path.slice(0, idx);
}

function widthForColumns(columnCount: number) {
    return Math.max(BASE_WIDTH, 24 + columnCount * COLUMN_WIDTH);
}

function FolderContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { t } = useTranslation();
    const skills = useAgentSkillStore((state) => state.skills);
    const name = (ctx.node.metadata?.folderName || ctx.node.title || "").trim();
    const entries = ctx.node.metadata?.folderEntries || [];
    const truncated = Boolean(ctx.node.metadata?.folderTruncated);
    const count = ctx.node.metadata?.folderEntryCount ?? entries.length;
    const columnRoots = useMemo(() => {
        const roots = ctx.node.metadata?.folderColumnRoots;
        return roots?.length ? roots : [""];
    }, [ctx.node.metadata?.folderColumnRoots]);
    const selectedPath = (ctx.node.metadata?.folderSelectedPath || "").trim();
    const skillExpanded = Boolean(ctx.node.metadata?.folderSkillExpanded);
    const hasSkillFile = useMemo(() => entries.some((entry) => isSkillMdEntry(entry) && !entry.path.includes("/")), [entries]);
    const skillPreview = useMemo(() => resolveFolderSkillDescription(ctx, skills), [
        ctx.node.metadata?.folderSkillDescription,
        ctx.node.metadata?.folderSkillDisplayName,
        ctx.node.metadata?.folderSkillName,
        ctx.node.metadata?.folderName,
        ctx.node.title,
        skills,
    ]);

    const syncWidth = (nextRoots: string[]) => {
        const nextWidth = widthForColumns(nextRoots.length);
        if (Math.abs((ctx.node.width || BASE_WIDTH) - nextWidth) > 1) {
            ctx.updateNode({ width: nextWidth });
        }
    };

    const selectEntry = (entry: CanvasFolderEntry, columnIndex: number) => {
        const nextRoots = columnRoots.slice(0, columnIndex + 1);
        ctx.updateMetadata({
            folderSelectedPath: entry.path,
            folderColumnRoots: nextRoots,
        });
        syncWidth(nextRoots);
    };

    const expandNext = () => {
        const lastRoot = columnRoots[columnRoots.length - 1] ?? "";
        const lastChildren = childrenOf(entries, lastRoot);
        let target = selectedPath && parentOfPath(selectedPath) === lastRoot && lastChildren.some((item) => item.path === selectedPath && item.kind === "directory")
            ? selectedPath
            : "";
        if (!target) {
            const selectedInTree = selectedPath
                ? lastChildren.find((item) => item.path === selectedPath && item.kind === "directory")
                : undefined;
            target = selectedInTree?.path || lastChildren.find((item) => item.kind === "directory")?.path || "";
        }
        if (!target) return;
        if (columnRoots.includes(target)) return;
        const nextRoots = [...columnRoots, target];
        ctx.updateMetadata({
            folderSelectedPath: target,
            folderColumnRoots: nextRoots,
        });
        syncWidth(nextRoots);
    };

    const collapseLast = () => {
        if (columnRoots.length <= 1) return;
        const nextRoots = columnRoots.slice(0, -1);
        const lastRoot = nextRoots[nextRoots.length - 1] ?? "";
        ctx.updateMetadata({
            folderColumnRoots: nextRoots,
            folderSelectedPath: lastRoot,
        });
        syncWidth(nextRoots);
    };

    const stopDrag = (event: ReactMouseEvent | ReactPointerEvent) => {
        event.stopPropagation();
    };

    // 只有根目录存在 SKILL.md 才当 Skill 文件夹；勿因嵌套 skill 元数据改标题/徽章
    const isSkillFolder = hasSkillFile;
    const accent = isSkillFolder ? "#a78bfa" : "#38bdf8";
    const skillId = (ctx.node.metadata?.folderSkillName || "").trim();

    return (
        <div className="flex h-full w-full flex-col gap-2 px-3 py-3" style={{ color: ctx.theme.node.muted }}>
            <div className="flex items-start gap-2">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: ctx.theme.toolbar.activeBg, color: accent }}>
                    {isSkillFolder ? <Sparkles className="size-4" /> : <FolderOpen className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-semibold" style={{ color: ctx.theme.node.text }}>
                            {(isSkillFolder && skillPreview?.title) || name || t("canvas.folderNode.title")}
                        </span>
                        {isSkillFolder ? (
                            <span className="shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium" style={{ background: "rgba(167,139,250,0.16)", color: accent }}>
                                {t("canvas.folderNode.skillTag")}
                            </span>
                        ) : null}
                    </div>
                    <div className="truncate text-[11px]" style={{ color: ctx.theme.node.faint }}>
                        {isSkillFolder && skillId ? `$${skillId} · ` : ""}
                        {t("canvas.folderNode.entryCount", { count })}
                        {truncated ? ` · ${t("canvas.folderNode.truncated")}` : ""}
                        {columnRoots.length > 1 ? ` · ${t("canvas.folderNode.level", { level: columnRoots.length })}` : ""}
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5" onPointerDown={stopDrag} onMouseDown={stopDrag}>
                    {isSkillFolder ? (
                        <button
                            type="button"
                            className="grid size-7 place-items-center rounded-lg transition hover:bg-black/5 dark:hover:bg-white/10"
                            style={{ color: accent }}
                            title={skillExpanded ? t("canvas.folderNode.skillCollapse") : t("canvas.folderNode.skillExpand")}
                            onClick={(event) => {
                                event.stopPropagation();
                                ctx.updateMetadata({ folderSkillExpanded: !skillExpanded });
                            }}
                        >
                            {skillExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                        </button>
                    ) : null}
                    {columnRoots.length > 1 ? (
                        <button
                            type="button"
                            className="grid size-7 place-items-center rounded-lg transition hover:opacity-90"
                            style={{ background: ctx.theme.toolbar.activeBg, color: ctx.theme.node.text }}
                            title={t("canvas.folderNode.collapse")}
                            onClick={(event) => {
                                event.stopPropagation();
                                collapseLast();
                            }}
                        >
                            <Minus className="size-3.5" />
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="grid size-7 place-items-center rounded-lg transition hover:opacity-90"
                        style={{ background: ctx.theme.toolbar.activeBg, color: "#38bdf8" }}
                        title={t("canvas.folderNode.expand")}
                        onClick={(event) => {
                            event.stopPropagation();
                            expandNext();
                        }}
                    >
                        <Plus className="size-3.5" />
                    </button>
                </div>
            </div>

            {isSkillFolder && skillExpanded ? (
                <div
                    className="thin-scrollbar max-h-24 shrink-0 overflow-auto rounded-lg px-2 py-1.5 text-[11px] leading-5"
                    style={{ background: "rgba(167,139,250,0.10)" }}
                    onPointerDown={stopDrag}
                    onMouseDown={stopDrag}
                    onWheel={handleNodeContentWheel}
                >
                    {skillPreview?.description ? (
                        <span className="whitespace-pre-wrap">{skillPreview.description}</span>
                    ) : (
                        <span className="opacity-70">{t("canvas.folderNode.skillEmpty")}</span>
                    )}
                </div>
            ) : null}

            <div
                className="flex min-h-0 flex-1 gap-1.5 overflow-hidden"
                onPointerDown={stopDrag}
                onMouseDown={stopDrag}
            >
                {columnRoots.map((root, columnIndex) => {
                    const columnEntries = childrenOf(entries, root);
                    const title = root ? root.split("/").pop() || root : name || t("canvas.folderNode.title");
                    return (
                        <div
                            key={`${columnIndex}:${root || "root"}`}
                            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg"
                            style={{ background: "rgba(0,0,0,0.18)", flexBasis: COLUMN_WIDTH }}
                        >
                            <div className="truncate border-b border-white/5 px-2 py-1 text-[10px] opacity-70" style={{ color: ctx.theme.node.faint }}>
                                {title}
                            </div>
                            <div className="thin-scrollbar min-h-0 flex-1 overflow-auto px-1.5 py-1 text-[11px] leading-5" onWheel={handleNodeContentWheel}>
                                {!columnEntries.length ? (
                                    <div className="px-1 opacity-70">{t("canvas.folderNode.empty")}</div>
                                ) : (
                                    columnEntries.map((entry) => {
                                        const active = selectedPath === entry.path || columnRoots[columnIndex + 1] === entry.path;
                                        const Icon = entry.kind === "directory" ? Folder : File;
                                        const showSkillTip = isSkillMdEntry(entry) && skillPreview;
                                        const row = (
                                            <button
                                                type="button"
                                                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left truncate transition"
                                                style={{
                                                    background: active ? "rgba(56,189,248,0.16)" : "transparent",
                                                    color: entry.kind === "directory" ? ctx.theme.node.text : ctx.theme.node.muted,
                                                }}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    selectEntry(entry, columnIndex);
                                                }}
                                                onDoubleClick={(event) => {
                                                    event.stopPropagation();
                                                    selectEntry(entry, columnIndex);
                                                    if (entry.kind === "directory") {
                                                        const nextRoots = [...columnRoots.slice(0, columnIndex + 1), entry.path];
                                                        ctx.updateMetadata({
                                                            folderSelectedPath: entry.path,
                                                            folderColumnRoots: nextRoots,
                                                        });
                                                        syncWidth(nextRoots);
                                                    }
                                                }}
                                            >
                                                <Icon className="size-3 shrink-0 opacity-70" />
                                                <span className="truncate">{entry.name}</span>
                                            </button>
                                        );
                                        if (!showSkillTip) {
                                            return <div key={entry.path}>{row}</div>;
                                        }
                                        return (
                                            <Tooltip
                                                key={entry.path}
                                                color="#ffffff"
                                                styles={{
                                                    root: {
                                                        maxWidth: 420,
                                                        color: "#1c1917",
                                                        boxShadow: "0 10px 28px rgba(15,23,42,.18)",
                                                        fontSize: 13,
                                                        lineHeight: 1.55,
                                                        padding: "10px 12px",
                                                    },
                                                }}
                                                title={
                                                    <div className="space-y-1.5">
                                                        <div className="text-[13px] font-semibold text-stone-900">
                                                            {skillPreview.title || t("canvas.folderNode.skillPreviewTitle")}
                                                        </div>
                                                        <div className="whitespace-pre-wrap text-[13px] text-stone-700">
                                                            {skillPreview.description}
                                                        </div>
                                                    </div>
                                                }
                                                placement="right"
                                                mouseEnterDelay={0.2}
                                            >
                                                <div>{row}</div>
                                            </Tooltip>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="text-[10px] opacity-60">
                {isSkillFolder
                    ? t("canvas.folderNode.skillHint")
                    : ctx.node.metadata?.folderStorageMode === "reference"
                      ? t("canvas.folderNode.hintReference")
                      : ctx.node.metadata?.folderDataPath
                        ? t("canvas.folderNode.hintCopied")
                        : t("canvas.folderNode.hint")}
            </div>
        </div>
    );
}

export function getFolderNodeDefinition(): CanvasNodeDefinition {
    return {
        type: FOLDER_NODE_TYPE,
        title: "Folder",
        description: "Local folder snapshot for workflow / data nodes",
        icon: <Folder className="size-5" />,
        defaultSize: { width: BASE_WIDTH, height: NODE_HEIGHT },
        defaultMetadata: {
            folderName: "",
            folderEntries: [],
            folderEntryCount: 0,
            folderTruncated: false,
            folderSkillName: "",
            folderSkillDisplayName: "",
            folderSkillDescription: "",
            folderPreviewMode: "list",
            folderColumnRoots: [""],
            folderSelectedPath: "",
        },
        minimapColor: "#38bdf8",
        showInCreateMenu: false,
        hidePanel: true,
        resource: () => null,
        Content: FolderContent,
    };
}
