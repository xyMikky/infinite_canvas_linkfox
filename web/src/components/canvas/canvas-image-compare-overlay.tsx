import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { resolveImageUrl } from "@/services/image-storage";
import { useCanvasInteractionStore } from "@/stores/canvas/use-canvas-interaction-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { CanvasPluginHost } from "@/types/canvas-plugin";

function imageNodeCompareRef(node: CanvasNodeData) {
    const meta = node.metadata;
    if (!meta) return "";
    return (meta.storageKey || meta.content || "").trim();
}

function isImageNode(node: CanvasNodeData | null | undefined): node is CanvasNodeData {
    return node?.type === CanvasNodeType.Image && Boolean(imageNodeCompareRef(node));
}

function collectGroupImageRefs(group: CanvasNodeData, host: CanvasPluginHost, add: (items: string[]) => void) {
    if (group.type !== CanvasNodeType.Group) return;
    for (const node of host.getNodes()) {
        if (node.metadata?.groupId !== group.id || node.type !== CanvasNodeType.Image) continue;
        const ref = imageNodeCompareRef(node);
        if (ref) add([ref]);
    }
}

/** 当前连线上直接接入的图片（双向：连入或连出；含数据组内图片） */
function collectWiredImageRefs(node: CanvasNodeData, host: CanvasPluginHost) {
    const collected: string[] = [];
    const selfRef = imageNodeCompareRef(node);
    const selfContent = (node.metadata?.content || "").trim();
    const add = (items: string[]) => {
        for (const item of items) {
            if (!item || collected.includes(item)) continue;
            if (item === selfRef || item === selfContent) continue;
            collected.push(item);
        }
    };
    for (const conn of host.getConnections()) {
        if (conn.toNodeId === node.id) {
            const peer = host.getNode(conn.fromNodeId);
            if (isImageNode(peer)) add([imageNodeCompareRef(peer)]);
            else if (peer?.type === CanvasNodeType.Group) collectGroupImageRefs(peer, host, add);
        } else if (conn.fromNodeId === node.id) {
            const peer = host.getNode(conn.toNodeId);
            if (isImageNode(peer)) add([imageNodeCompareRef(peer)]);
            else if (peer?.type === CanvasNodeType.Group) collectGroupImageRefs(peer, host, add);
        }
    }
    return collected;
}

/** 收集对照图：指定对比图 → 当前连线图片 →（无连线时）任务参考图 → 工作台上游图 */
export function resolveTaskCompareReferences(node: CanvasNodeData, host?: CanvasPluginHost | null) {
    const collected: string[] = [];
    const selfRef = imageNodeCompareRef(node);
    const selfContent = (node.metadata?.content || "").trim();
    const add = (items: string[]) => {
        for (const item of items) {
            if (!item || collected.includes(item)) continue;
            if (item === selfRef || item === selfContent) continue;
            collected.push(item);
        }
    };

    add((node.metadata?.compareReferences || []).filter(Boolean));

    const wired = host ? collectWiredImageRefs(node, host) : [];
    add(wired);
    // 有连线时以连线为准，不再叠生图 metadata.references（避免断线后仍显示旧对照）
    if (wired.length || !host) {
        if (!wired.length) add((node.metadata?.references || []).filter(Boolean));
        return collected.slice(0, 4);
    }

    add((node.metadata?.references || []).filter(Boolean));

    const connections = host.getConnections();
    const collectUpstream = (upstream: CanvasNodeData | null | undefined) => {
        if (!upstream || isImageNode(upstream)) return;
        if (upstream.metadata?.localEditPreprocess) {
            const original = upstream.metadata.localEditOriginalStorageKey || upstream.metadata.localEditOriginalContent;
            if (original) add([original]);
            return;
        }
        const localEditInput = connections
            .map((item) => (item.toNodeId === upstream.id ? host.getNode(item.fromNodeId) : null))
            .find((item) => item?.metadata?.localEditPreprocess);
        if (localEditInput) {
            const original = localEditInput.metadata?.localEditOriginalStorageKey || localEditInput.metadata?.localEditOriginalContent;
            if (original) add([original]);
            return;
        }
        collectGroupImageRefs(upstream, host, add);
        add((upstream.metadata?.compareReferences || upstream.metadata?.references || []).filter(Boolean));
        add(
            connections
                .filter((item) => item.toNodeId === upstream.id)
                .map((item) => host.getNode(item.fromNodeId))
                .filter((item): item is CanvasNodeData => isImageNode(item))
                .map((item) => imageNodeCompareRef(item)),
        );
    };

    for (const conn of connections) {
        if (conn.toNodeId === node.id) collectUpstream(host.getNode(conn.fromNodeId));
    }
    return collected.slice(0, 4);
}

/** 订阅连线 store，避免节点 memo 导致连线后对照图不刷新 */
function useTaskCompareReferences(node: CanvasNodeData, host?: CanvasPluginHost | null) {
    const connections = useCanvasInteractionStore((state) => state._connections);
    const compareKey = (node.metadata?.compareReferences || []).join("\0");
    const referencesKey = (node.metadata?.references || []).join("\0");
    return useMemo(() => resolveTaskCompareReferences(node, host), [node, host, connections, compareKey, referencesKey]);
}

function isUsableCompareCandidate(url: string) {
    const value = url.trim();
    if (!value) return false;
    if (/favicon\.(ico|png|svg)|apple-touch-icon/i.test(value)) return false;
    return true;
}

async function toDisplayUrl(raw: string) {
    if (raw.startsWith("image:")) return (await resolveImageUrl(raw, "")) || "";
    return raw;
}

/** 把 storageKey / 地址解析成可显示 URL，并只保留能真正加载的图（最多 2 张） */
function useReadyCompareRefs(rawUrls: string[]) {
    const key = rawUrls.join("\0");
    const [refs, setRefs] = useState<string[]>([]);

    useEffect(() => {
        let cancelled = false;
        const candidates = key ? key.split("\0").filter(isUsableCompareCandidate) : [];
        setRefs([]);
        if (!candidates.length) return;
        void (async () => {
            const ready: string[] = [];
            for (const raw of candidates) {
                if (ready.length >= 2) break;
                if (cancelled) return;
                const src = await toDisplayUrl(raw).catch(() => "");
                if (cancelled) return;
                if (!src || src.startsWith("image:")) continue;
                const ok = await new Promise<boolean>((resolve) => {
                    const img = new Image();
                    img.onload = () => resolve(img.naturalWidth >= 8 && img.naturalHeight >= 8);
                    img.onerror = () => resolve(false);
                    img.src = src;
                });
                if (cancelled) return;
                if (ok) ready.push(src);
            }
            if (!cancelled) setRefs(ready);
        })();
        return () => {
            cancelled = true;
        };
    }, [key]);

    return refs;
}

/** 滑块对比：对照图解析订阅连线 store；选中时常显入口 */
export function ImageTaskCompareLayer({
    node,
    pluginHost,
    resultUrl,
    resultStorageKey,
    pinned = false,
}: {
    node: CanvasNodeData;
    pluginHost?: CanvasPluginHost | null;
    resultUrl: string;
    resultStorageKey?: string;
    pinned?: boolean;
}) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const rawRefs = useTaskCompareReferences(node, pluginHost);
    const refsKey = rawRefs.join("\0");
    const [resolvedResult, setResolvedResult] = useState("");
    const [hoverCorner, setHoverCorner] = useState(false);
    const [compareOn, setCompareOn] = useState(false);
    const [refIndex, setRefIndex] = useState(0);
    const [ratio, setRatio] = useState(0.5);
    const stageRef = useRef<HTMLDivElement>(null);
    const dragAbortRef = useRef<AbortController | null>(null);
    const showControls = pinned || hoverCorner || compareOn;
    // 普通浏览不为隐藏的对比入口加载原图；选中或悬停入口后再准备对照图。
    const refs = useReadyCompareRefs(showControls ? rawRefs : []);
    const compareUrl = refs[Math.min(refIndex, Math.max(refs.length - 1, 0))] || "";

    useEffect(() => {
        if (!compareOn) return;
        let cancelled = false;
        setResolvedResult("");
        void resolveImageUrl(resultStorageKey || "", resultUrl).then((url) => {
            if (!cancelled) setResolvedResult(url || resultUrl);
        }).catch(() => { if (!cancelled) setCompareOn(false); });
        return () => {
            cancelled = true;
        };
    }, [compareOn, resultStorageKey, resultUrl]);

    useEffect(() => {
        if (!compareOn) return;
        if (!refs.length) setCompareOn(false);
        else if (refIndex >= refs.length) setRefIndex(0);
    }, [compareOn, refIndex, refs.length]);

    useEffect(() => {
        setRefIndex(0);
        setRatio(0.5);
    }, [refsKey]);

    useEffect(() => () => dragAbortRef.current?.abort(), []);

    if (!rawRefs.length) return null;

    const updateRatioFromClientX = (clientX: number) => {
        const box = stageRef.current?.getBoundingClientRect();
        if (!box?.width) return;
        setRatio(Math.min(1, Math.max(0, (clientX - box.left) / box.width)));
    };

    const startDrag = (event: ReactPointerEvent) => {
        if (!compareOn || !compareUrl) return;
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        updateRatioFromClientX(event.clientX);
        dragAbortRef.current?.abort();
        const controller = new AbortController();
        dragAbortRef.current = controller;
        const move = (next: PointerEvent) => {
            if ((next.buttons & 1) === 0) {
                controller.abort();
                return;
            }
            updateRatioFromClientX(next.clientX);
        };
        const stop = () => controller.abort();
        document.addEventListener("pointermove", move, { signal: controller.signal });
        document.addEventListener("pointerup", stop, { signal: controller.signal });
        document.addEventListener("pointercancel", stop, { signal: controller.signal });
    };

    const stopPrimaryPointer = (event: { button: number; stopPropagation: () => void }) => {
        if (event.button !== 0) return;
        event.stopPropagation();
    };

    const chipStyle = {
        background: theme.toolbar.panel,
        borderColor: theme.toolbar.border,
        color: theme.toolbar.activeText,
    } as const;

    return (
        <>
            {compareOn && compareUrl && resolvedResult ? (
                <div
                    ref={stageRef}
                    className="pointer-events-auto absolute inset-0 z-[55] cursor-ew-resize overflow-hidden rounded-[inherit]"
                    style={{ background: theme.node.panel }}
                    onPointerDown={startDrag}
                    onMouseDown={stopPrimaryPointer}
                >
                    <img src={resolvedResult} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-contain" draggable={false} />
                    <div
                        className="pointer-events-none absolute inset-0"
                        style={{
                            background: theme.node.panel,
                            clipPath: `inset(0 ${(1 - ratio) * 100}% 0 0)`,
                        }}
                    >
                        <img src={compareUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-contain" draggable={false} />
                    </div>
                    <div
                        className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,.35)]"
                        style={{ left: `${ratio * 100}%`, transform: "translateX(-50%)" }}
                    >
                        <span className="absolute left-1/2 top-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-black/20 bg-white text-[11px] font-medium text-black shadow">
                            ‖
                        </span>
                    </div>
                </div>
            ) : null}

            <div
                className="pointer-events-auto absolute left-3 top-3 z-[60] min-h-10 min-w-10"
                onMouseEnter={() => setHoverCorner(true)}
                onMouseLeave={() => setHoverCorner(false)}
                onMouseDown={stopPrimaryPointer}
                onPointerDown={stopPrimaryPointer}
            >
                {showControls ? (
                    <div className="flex flex-wrap items-center gap-1">
                        <button
                            type="button"
                            className="flex h-8 items-center rounded-lg border px-2.5 text-[10px] font-medium shadow-[0_6px_18px_rgba(15,23,42,.16)] backdrop-blur-md transition hover:scale-[1.02]"
                            style={{ ...chipStyle, ...(compareOn ? { background: theme.toolbar.activeBg } : {}) }}
                            title={t("canvas.imageTools.compareTitle")}
                            disabled={!refs.length}
                            onClick={(event) => {
                                event.stopPropagation();
                                setCompareOn((value) => !value);
                                setRatio(0.5);
                            }}
                        >
                            {t("canvas.imageTools.compare")}
                        </button>
                        {compareOn && refs.length > 1
                            ? refs.map((_, index) => (
                                  <button
                                      key={index}
                                      type="button"
                                      className="flex h-8 items-center rounded-lg border px-2 text-[10px] font-medium shadow-[0_6px_18px_rgba(15,23,42,.16)] backdrop-blur-md transition hover:scale-[1.02]"
                                      style={{ ...chipStyle, ...(refIndex === index ? { background: theme.toolbar.activeBg } : {}) }}
                                      title={t("canvas.editors.compareWithImage", { index: index + 1 })}
                                      onClick={(event) => {
                                          event.stopPropagation();
                                          setRefIndex(index);
                                          setRatio(0.5);
                                      }}
                                  >
                                      {t("canvas.editors.compareImageN", { index: index + 1 })}
                                  </button>
                              ))
                            : null}
                    </div>
                ) : null}
            </div>
        </>
    );
}
