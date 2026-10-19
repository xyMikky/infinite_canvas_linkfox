import { Check, Hand, Monitor, MousePointer2, Pause, Play, Redo2, RotateCcw, Smartphone, Tablet, Type, Undo2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { BrowserHtmlPreview } from "@/components/canvas/browser-preview";
import { createCanvasGenerationScope } from "@/lib/canvas/canvas-generation-runtime";
import { attachHtmlDesignRuntime, type HtmlDesignMode } from "@/lib/canvas/html-design-runtime";
import { isHtmlDesignBoard, isHtmlDesignDocument, patchHtmlDesignText, readHtmlDesignSource, replaceHtmlDesignContent, reverseHtmlTextEdit, type HtmlTextEdit } from "@/lib/canvas/html-design-source";
import type { CanvasNodeContext } from "@/types/canvas-plugin";

const DEVICES = {
    desktop: { width: 1440, height: 900, label: "桌面", Icon: Monitor },
    tablet: { width: 768, height: 1024, label: "平板", Icon: Tablet },
    mobile: { width: 390, height: 844, label: "手机", Icon: Smartphone },
};
const MODES = [
    { value: "select", label: "选择", Icon: MousePointer2 },
    { value: "text", label: "文案", Icon: Type },
    { value: "interact", label: "交互", Icon: Hand },
] as const;
const buttonClass = "inline-flex shrink-0 items-center justify-center gap-1 rounded px-2 py-1.5 text-[11px] hover:bg-black/5 disabled:opacity-35 dark:hover:bg-white/10";

export function HtmlDesignBoard({ ctx, folderNodeId = "" }: { ctx: CanvasNodeContext; folderNodeId?: string }) {
    const { id: projectId = "" } = useParams<{ id: string }>();
    const meta = ctx.node.metadata || {};
    const source = String(meta.content || "");
    const path = meta.smartPreviewPath || "";
    const enabled = isHtmlDesignBoard(meta);
    const fullscreen = Boolean(meta.smartPreviewFullscreen);
    const theme = ctx.theme;
    const parsed = useMemo(() => enabled ? readHtmlDesignSource(source) : null, [enabled, source]);
    // 文案不变更页面结构时保留原 object URL，避免重启页面状态与动画。
    const shape = parsed?.shape ?? source;
    const [rendered, setRendered] = useState({ source, shape });
    if (rendered.shape !== shape) setRendered({ source, shape });
    const [mode, setMode] = useState<HtmlDesignMode>("select");
    const [paused, setPaused] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [reload, setReload] = useState(0);
    const [ready, setReady] = useState(false);
    const [notice, setNotice] = useState("");
    const [visible, setVisible] = useState(true);
    const [history, setHistory] = useState<{ undo: HtmlTextEdit[]; redo: HtmlTextEdit[] }>({ undo: [], redo: [] });
    const [size, setSize] = useState({ width: 420, height: 280 });
    const stage = useRef<HTMLDivElement>(null);
    const frame = useRef<HTMLIFrameElement | null>(null);
    const loadedSource = useRef<string | null>(null);
    const documentUrl = useRef("");
    const runtime = useRef<ReturnType<typeof attachHtmlDesignRuntime> | null>(null);
    const savedSource = useRef(source);
    const latest = useRef({ ctx, source, path, parsed, mode, paused, speed, visible, enabled });
    latest.current = { ctx, source, path, parsed, mode, paused, speed, visible, enabled };

    useLayoutEffect(() => {
        const element = stage.current;
        if (!element) return;
        const observer = new ResizeObserver(([entry]) => {
            const width = Math.max(1, Math.round(entry.contentRect.width));
            const height = Math.max(1, Math.round(entry.contentRect.height));
            setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        const element = stage.current;
        if (!element) return;
        const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        if (savedSource.current !== source) {
            savedSource.current = source;
            setHistory({ undo: [], redo: [] });
        }
    }, [source]);
    useEffect(() => {
        if (enabled && meta.interactive) ctx.updateMetadata({ interactive: false });
    }, [enabled, meta.interactive, ctx.updateMetadata]);

    const saveEdit = useCallback((edit: HtmlTextEdit, operation: "edit" | "undo" | "redo" = "edit") => {
        const current = latest.current;
        const scope = createCanvasGenerationScope(projectId, current.ctx.getNodes(), current.ctx.getConnections());
        if (!current.enabled || !scope.isActive() || !frame.current || !isHtmlDesignDocument(frame.current, documentUrl.current)) return false;
        const node = current.ctx.getNode(current.ctx.node.id);
        const expected = savedSource.current;
        if (!node || (node.metadata?.smartPreviewPath || "") !== current.path || node.metadata?.content !== expected) {
            setNotice("页面已更新，请重新选择文字后编辑。");
            return false;
        }
        const original = readHtmlDesignSource(expected);
        edit = { ...edit, beforeBreaks: original.lineBreaks[edit.id] };
        const next = patchHtmlDesignText(original, edit);
        if (next == null) { setNotice("这段文字已变化，请重新选择后编辑。"); return false; }
        if (edit.before === edit.after && edit.afterBreaks?.join(",") === original.lineBreaks[edit.id]?.join(",")) return true;
        const nodeId = node.id;
        scope.setNodes(nodes => replaceHtmlDesignContent(nodes, { nodeId, path: current.path, expected, content: next }));
        savedSource.current = next;
        setHistory(previous => operation === "undo"
            ? { undo: previous.undo.slice(0, -1), redo: [...previous.redo, reverseHtmlTextEdit(edit)] }
            : operation === "redo"
                ? { undo: [...previous.undo, edit], redo: previous.redo.slice(0, -1) }
                : { undo: [...previous.undo.slice(-49), edit], redo: [] });
        setNotice("文案已更新至画布，导出 HTML 将包含修改。");
        return true;
    }, [projectId]);

    const syncRuntime = useCallback(() => {
        const current = latest.current;
        if (!current.enabled || !current.parsed) return;
        const { mode, paused, speed, visible } = current;
        runtime.current?.update({ mode, paused, speed, visible, fields: current.parsed.fields, lineBreaks: current.parsed.lineBreaks });
    }, []);
    const bindRuntime = useCallback((element: HTMLIFrameElement) => {
        frame.current = element;
        runtime.current?.dispose();
        runtime.current = null;
        setReady(false);
        if (!latest.current.enabled) return;
        if (!isHtmlDesignDocument(element, documentUrl.current)) {
            loadedSource.current = null;
            setNotice("已打开链接页面；点击重新播放返回原页面后可编辑文案。");
            return;
        }
        try {
            runtime.current = attachHtmlDesignRuntime(element, edit => saveEdit(edit), () => setNotice("这段文字已被更新，已显示最新版本，请重新编辑。"));
            syncRuntime();
            setReady(true);
            setNotice("");
        } catch (error) { setNotice(error instanceof Error ? error.message : "页面暂时无法编辑，请重新加载。"); }
    }, [saveEdit, syncRuntime]);
    useEffect(() => { syncRuntime(); }, [parsed, mode, paused, speed, visible, syncRuntime]);
    useEffect(() => {
        setReady(false);
        if (frame.current && loadedSource.current === rendered.source) bindRuntime(frame.current);
        return () => { runtime.current?.dispose(); runtime.current = null; };
    }, [rendered.source, reload, enabled, bindRuntime]);

    const viewport = meta.htmlDesignViewport && (meta.htmlDesignViewport === "auto" || Object.hasOwn(DEVICES, meta.htmlDesignViewport)) ? meta.htmlDesignViewport : "desktop";
    const device = enabled && viewport !== "auto" ? DEVICES[viewport] : size;
    const scale = Math.min(size.width / device.width, size.height / device.height, 1);
    const fieldCount = parsed ? Object.keys(parsed.fields).length : 0;
    const undo = () => {
        runtime.current?.flush();
        const edit = history.undo.at(-1);
        if (edit) saveEdit(reverseHtmlTextEdit(edit), "undo");
    };
    const redo = () => {
        const edit = history.redo.at(-1);
        if (edit) saveEdit(edit, "redo");
    };
    return (
        <div className="flex h-full min-h-0 w-full flex-col" style={{ color: theme.node.text }} data-canvas-no-zoom data-html-design-board={enabled ? "" : undefined}>
            {enabled ? <div
                className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b px-2 py-1"
                style={{ borderColor: theme.node.stroke }}
                onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
            >
                <div className="flex items-center gap-0.5" role="group" aria-label="画板操作模式">
                    {MODES.map(({ value, label, Icon }) => <button key={value} type="button" className={buttonClass}
                        aria-pressed={mode === value} disabled={value === "text" && (!ready || !fieldCount)}
                        title={value === "text" ? "点击标记文字编辑；Enter 保存，Shift+Enter 换行，Esc 取消" : label}
                        style={mode === value ? { background: theme.toolbar.activeBg } : undefined}
                        onClick={() => { runtime.current?.flush(); setMode(value); setNotice(""); }}>
                        <Icon className="size-3.5" />{label}
                    </button>)}
                </div>
                <div className="flex items-center gap-1" role="group" aria-label="页面尺寸">
                    <select aria-label="设备视口" className="max-w-32 rounded bg-transparent px-1 py-1 text-[11px]" value={viewport}
                        style={{ color: theme.node.text, backgroundColor: theme.node.panel }}
                        onChange={event => ctx.updateMetadata({ htmlDesignViewport: event.target.value as typeof viewport })}>
                        {Object.entries(DEVICES).map(([key, item]) => <option key={key} value={key}>{item.label} · {item.width}</option>)}
                        <option value="auto">跟随节点</option>
                    </select>
                    <span className="text-[10px] tabular-nums" style={{ color: theme.node.muted }}>{Math.round(scale * 100)}%</span>
                </div>
                <div className="flex items-center gap-0.5" role="group" aria-label="文案与动效">
                    <button type="button" className={buttonClass} title="撤销文案" aria-label="撤销文案" disabled={!ready || !history.undo.length} onClick={undo}><Undo2 className="size-3.5" /></button>
                    <button type="button" className={buttonClass} title="重做文案" aria-label="重做文案" disabled={!ready || !history.redo.length} onClick={redo}><Redo2 className="size-3.5" /></button>
                    <button type="button" className={buttonClass} disabled={!ready || mode === "text"} aria-pressed={paused} title={paused ? "继续标准动画" : "暂停标准动画"} aria-label={paused ? "继续标准动画" : "暂停标准动画"} onClick={() => setPaused(value => !value)}>{paused || mode === "text" ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}</button>
                    <select aria-label="标准动画速度" title="仅控制 CSS 和 Web Animations；视频及自定义脚本不受影响" value={speed} className="rounded px-1 py-1 text-[11px]"
                        style={{ color: theme.node.text, backgroundColor: theme.node.panel }} onChange={event => setSpeed(Number(event.target.value))}>
                        {[0.25, 0.5, 1, 2].map(value => <option key={value} value={value}>{value}×</option>)}
                    </select>
                    <button type="button" className={buttonClass} title="重新播放整页（重置临时交互状态，保留已保存文案）" aria-label="重新播放整页" onClick={() => {
                        runtime.current?.flush();
                        loadedSource.current = null;
                        setRendered({ source: savedSource.current, shape });
                        setMode("interact"); setPaused(false); setReload(value => value + 1);
                    }}><RotateCcw className="size-3.5" /></button>
                </div>
            </div> : null}
            <div ref={stage} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden" style={enabled ? { background: theme.canvas.background } : undefined}>
                <div className="relative shrink-0" style={{ width: device.width * scale, height: device.height * scale }}>
                    <div className="absolute left-0 top-0 origin-top-left overflow-hidden" style={{ width: device.width, height: device.height, transform: `scale(${scale})` }}>
                        <BrowserHtmlPreview content={rendered.source} folderNodeId={folderNodeId} path={path} reload={reload}
                            interactive={enabled ? mode !== "select" : fullscreen || Boolean(meta.interactive)} onLoad={(element, pageSource, pageUrl) => {
                                loadedSource.current = pageSource;
                                documentUrl.current = pageUrl;
                                if (pageSource === rendered.source) bindRuntime(element);
                            }} />
                    </div>
                </div>
            </div>
            {enabled ? <div className="flex shrink-0 items-center gap-1.5 border-t px-3 py-1.5 text-[10px] leading-4" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                {notice.startsWith("文案已更新") ? <Check className="size-3 shrink-0" /> : null}
                <span>{notice || (!fieldCount ? "此 HTML 未标记可编辑文案，可切换设备和体验交互。" : mode === "text" ? "蓝框文字可编辑 · 失焦保存 · Esc 取消 · 标准动画暂时暂停" : mode === "interact" ? "点击、悬停和滚动体验页面 · 文案保存在画布内" : "拖动画板排列方案 · 进入文案或交互模式继续设计")}</span>
            </div> : null}
        </div>
    );
}
