import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Plus } from "lucide-react";
import { Button, Modal } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import {
    blobToSearchJpeg,
    fetchPinterestPinImage,
    pinterestPinPageUrl,
    pinterestVisualSearch,
    type PinterestPin,
} from "@/services/api/pinterest";
import { CANVAS_OVERLAY_MODAL_Z_INDEX } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData } from "@/types/canvas";

const PAGE_SIZE = 60;
const PLACEHOLDER_ASPECTS = [4 / 3, 3 / 2, 5 / 4, 1, 5 / 3, 6 / 5];
const PLACEHOLDER_COUNT = 24;
const LOAD_MORE_MARGIN = 320;

type CanvasPinterestSearchProps = {
    node: CanvasNodeData | null | undefined;
    open: boolean;
    onClose: () => void;
    onAdd: (blob: Blob, pin: { title: string }) => Promise<void> | void;
};

export function CanvasPinterestSearch({ node, open, onClose, onAdd }: CanvasPinterestSearchProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [pins, setPins] = useState<PinterestPin[]>([]);
    const [bookmark, setBookmark] = useState("");
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState("");
    const [addingId, setAddingId] = useState("");
    const [loadedMap, setLoadedMap] = useState<Record<string, boolean>>({});
    const [columns, setColumns] = useState(4);
    const jpegRef = useRef<Blob | null>(null);
    const bookmarkRef = useRef("");
    const loadingMoreLock = useRef(false);
    const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
    const [sentinelEl, setSentinelEl] = useState<HTMLDivElement | null>(null);
    const gridRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        bookmarkRef.current = bookmark;
    }, [bookmark]);

    useEffect(() => {
        const el = gridRef.current;
        if (!open || !el) return;
        const sync = () => setColumns(columnCountForWidth(el.clientWidth));
        sync();
        const observer = new ResizeObserver(sync);
        observer.observe(el);
        return () => observer.disconnect();
    }, [open]);

    useEffect(() => {
        if (!open || !node?.metadata?.content) {
            setPins([]);
            setBookmark("");
            setError("");
            setLoading(false);
            setLoadingMore(false);
            setLoadedMap({});
            jpegRef.current = null;
            loadingMoreLock.current = false;
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError("");
        setPins([]);
        setLoadedMap({});
        void (async () => {
            try {
                const blob = await fetch(node.metadata?.content || "").then((res) => res.blob());
                const jpeg = await blobToSearchJpeg(blob);
                jpegRef.current = jpeg;
                const result = await pinterestVisualSearch(jpeg, PAGE_SIZE);
                if (cancelled) return;
                setPins(result.pins);
                setBookmark(result.bookmark);
            } catch {
                if (!cancelled) setError(t("canvas.editors.pinterestFailed"));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [node?.id, node?.metadata?.content, open, t]);

    const loadMore = useCallback(async () => {
        if (!jpegRef.current || !bookmarkRef.current || loadingMoreLock.current) return;
        loadingMoreLock.current = true;
        setLoadingMore(true);
        try {
            const result = await pinterestVisualSearch(jpegRef.current, PAGE_SIZE, bookmarkRef.current);
            if (!result.pins.length) {
                setBookmark("");
                return;
            }
            setPins((prev) => mergePins(prev, result.pins));
            setBookmark(result.bookmark);
        } catch {
            setError(t("canvas.editors.pinterestFailed"));
        } finally {
            loadingMoreLock.current = false;
            setLoadingMore(false);
        }
    }, [t]);

    const maybeLoadMoreFromScroll = useCallback(() => {
        if (!scrollEl || loading || !bookmarkRef.current) return;
        if (scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight <= LOAD_MORE_MARGIN) void loadMore();
    }, [loadMore, scrollEl, loading]);

    useEffect(() => {
        if (!open || !scrollEl || !sentinelEl || !bookmark || loading) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) void loadMore();
            },
            { root: scrollEl, rootMargin: `${LOAD_MORE_MARGIN}px 0px`, threshold: 0 },
        );
        observer.observe(sentinelEl);
        const onScroll = () => maybeLoadMoreFromScroll();
        scrollEl.addEventListener("scroll", onScroll, { passive: true });
        maybeLoadMoreFromScroll();
        return () => {
            observer.disconnect();
            scrollEl.removeEventListener("scroll", onScroll);
        };
    }, [open, bookmark, loading, pins.length, scrollEl, sentinelEl, loadMore, maybeLoadMoreFromScroll]);

    const addPin = async (pin: PinterestPin, closeAfter = false) => {
        if (addingId) return;
        setAddingId(pin.id);
        try {
            const blob = await fetchPinterestPinImage(pin);
            await onAdd(blob, { title: pin.title || pin.description || t("canvas.projectPage.pinterestNewNode") });
            if (closeAfter) onClose();
        } catch {
            setError(t("canvas.editors.pinterestAddFailed"));
        } finally {
            setAddingId("");
        }
    };

    const masonry = useMemo(() => distribute(pins, columns, (pin) => (pin.width && pin.height ? pin.height / pin.width : 1.25)), [pins, columns]);
    const placeholders = useMemo(
        () => distribute(Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => index), columns, (index) => PLACEHOLDER_ASPECTS[index % PLACEHOLDER_ASPECTS.length]),
        [columns],
    );

    return (
        <Modal
            title={t("canvas.editors.pinterestTitle")}
            open={open}
            onCancel={onClose}
            footer={null}
            width="92vw"
            centered
            destroyOnHidden
            transitionName=""
            maskTransitionName=""
            zIndex={CANVAS_OVERLAY_MODAL_Z_INDEX}
            getContainer={() => document.body}
            styles={{ body: { maxHeight: "86vh", overflow: "hidden", padding: 0 } }}
        >
            <div ref={setScrollEl} className="h-[86vh] overflow-y-auto px-6 py-4">
                {error && !pins.length && !loading ? <div className="grid min-h-[60vh] place-items-center text-sm text-red-400">{error}</div> : null}
                {!error && !pins.length && !loading ? (
                    <div className="grid min-h-[60vh] place-items-center text-sm" style={{ color: theme.node.muted }}>
                        {t("canvas.editors.pinterestEmpty")}
                    </div>
                ) : null}
                <div ref={gridRef} className="flex gap-2">
                    {(loading && !pins.length ? placeholders : masonry).map((column, columnIndex) => (
                        <div key={columnIndex} className="flex min-w-0 flex-1 flex-col gap-2">
                            {loading && !pins.length
                                ? (column as number[]).map((index) => (
                                      <div key={`ph-${index}`} className="rounded-lg bg-black/5 dark:bg-white/5" style={{ aspectRatio: `1 / ${PLACEHOLDER_ASPECTS[index % PLACEHOLDER_ASPECTS.length]}` }} />
                                  ))
                                : (column as PinterestPin[]).map((pin) => (
                                      <div
                                          key={pin.id}
                                          className="group relative cursor-pointer overflow-hidden rounded-lg bg-black/5 select-none dark:bg-white/5"
                                          style={pin.width && pin.height ? { aspectRatio: `${pin.width} / ${pin.height}` } : undefined}
                                          onDoubleClick={() => {
                                              void addPin(pin, true);
                                          }}
                                      >
                                          <img
                                              src={pin.mediumUrl}
                                              alt={pin.title}
                                              draggable={false}
                                              className={`${pin.width && pin.height ? "absolute inset-0 h-full w-full object-cover" : "block w-full"} ${loadedMap[pin.id] ? "opacity-100" : "opacity-0"}`}
                                              onLoad={() => setLoadedMap((prev) => (prev[pin.id] ? prev : { ...prev, [pin.id]: true }))}
                                          />
                                          <div className="absolute inset-x-0 bottom-0 hidden items-center justify-end gap-1 bg-black/55 p-1.5 group-hover:flex" onDoubleClick={(event) => event.stopPropagation()}>
                                              <Button
                                                  size="small"
                                                  icon={<Plus className="size-3.5" />}
                                                  loading={addingId === pin.id}
                                                  title={t("canvas.editors.pinterestAddKeep")}
                                                  aria-label={t("canvas.editors.pinterestAddKeep")}
                                                  onClick={(event) => {
                                                      event.stopPropagation();
                                                      void addPin(pin);
                                                  }}
                                              />
                                              <Button
                                                  size="small"
                                                  icon={<ExternalLink className="size-3.5" />}
                                                  title={t("canvas.editors.pinterestOpen")}
                                                  aria-label={t("canvas.editors.pinterestOpen")}
                                                  onClick={(event) => {
                                                      event.stopPropagation();
                                                      window.open(pinterestPinPageUrl(pin), "_blank", "noopener,noreferrer");
                                                  }}
                                              />
                                          </div>
                                      </div>
                                  ))}
                        </div>
                    ))}
                </div>
                <div ref={setSentinelEl} className="h-10 w-full shrink-0" aria-hidden />
                {loadingMore ? (
                    <div className="py-3 text-center text-xs" style={{ color: theme.node.muted }}>
                        {t("canvas.editors.pinterestLoadingMore")}
                    </div>
                ) : null}
                {error && pins.length ? <div className="pt-2 text-center text-xs text-red-400">{error}</div> : null}
            </div>
        </Modal>
    );
}

function mergePins(current: PinterestPin[], next: PinterestPin[]) {
    const seen = new Set(current.map((pin) => pin.id));
    return [...current, ...next.filter((pin) => pin.id && !seen.has(pin.id))];
}

function columnCountForWidth(width: number) {
    if (width >= 1536) return 6;
    if (width >= 1280) return 5;
    if (width >= 768) return 4;
    return 3;
}

function distribute<T>(items: T[], columnCount: number, weightOf: (item: T) => number) {
    const columns = Array.from({ length: columnCount }, () => [] as T[]);
    const heights = Array.from({ length: columnCount }, () => 0);
    for (const item of items) {
        let target = 0;
        for (let index = 1; index < columnCount; index++) {
            if (heights[index] < heights[target]) target = index;
        }
        columns[target].push(item);
        heights[target] += weightOf(item);
    }
    return columns;
}
