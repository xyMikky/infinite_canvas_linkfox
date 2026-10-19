import { useEffect, useRef, useState } from "react";
import { Download, FileArchive, LoaderCircle, RotateCcw, X } from "lucide-react";
import { saveAs } from "file-saver";
import { canvasThemes } from "@/lib/canvas-theme";
import { randomId } from "@/lib/utils";
import { useThemeStore } from "@/stores/use-theme-store";
import { useCanvasReportStore, type CanvasReportSession } from "@/stores/canvas/use-canvas-report-store";
import { collectReportAssetReferences, createReportDeliveryHtml, createReportDocument } from "@/lib/canvas/report/document";
import { createReportArchive } from "@/lib/canvas/report/archive";
import { loadReportAsset, reportBlobDataUrl } from "@/lib/canvas/report/assets";

export function CanvasReportDialog() {
    const session = useCanvasReportStore((state) => state.session);
    useEffect(() => () => useCanvasReportStore.getState().close(), []);
    return session ? <ReportSession key={session.nodeId} session={session} /> : null;
}

function ReportSession({ session }: { session: CanvasReportSession }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const close = useCanvasReportStore((state) => state.close);
    const dialogRef = useRef<HTMLDialogElement>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [attempt, setAttempt] = useState(0);
    const [srcDoc, setSrcDoc] = useState("");
    const [loading, setLoading] = useState(true);
    const [ready, setReady] = useState(false);
    const [issues, setIssues] = useState<string[]>([]);
    const [runtimeError, setRuntimeError] = useState("");
    const [pending, setPending] = useState(0);
    const [assetCount, setAssetCount] = useState(0);
    const [exporting, setExporting] = useState(false);
    const [unresolved, setUnresolved] = useState(0);
    const runtime = useRef("");
    const report = useRef(structuredClone(session.report));
    const controllerRef = useRef<AbortController | null>(null);
    const button = "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs hover:bg-black/5 disabled:cursor-default disabled:opacity-40 dark:hover:bg-white/10";

    useEffect(() => {
        const focused = document.activeElement;
        dialogRef.current?.showModal();
        return () => { if (focused instanceof HTMLElement && focused.isConnected) focused.focus(); };
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        controllerRef.current = controller;
        const { signal } = controller;
        const channel = randomId();
        const requested = new Set<string>();
        let totalBytes = 0;
        let readyTimer: ReturnType<typeof setTimeout> | undefined;
        report.current = structuredClone(session.report);
        setLoading(true); setReady(false); setSrcDoc(""); setIssues([]); setRuntimeError(""); setPending(0); setAssetCount(0); setUnresolved(0);
        const loadAssets = async (references: string[], send = false) => {
            const next = references.filter((reference) => !/^(data:|#)/.test(reference) && !requested.has(reference));
            next.forEach((reference) => requested.add(reference));
            if (!next.length) return;
            setPending((count) => count + next.length);
            const loaded: Record<string, string> = {};
            for (let index = 0; index < next.length; index += 4) {
                if (signal.aborted) return;
                const batch = next.slice(index, index + 4);
                const results = await Promise.allSettled(batch.map((reference) => loadReportAsset(reference, session.report.path, session.folderId, signal)));
                if (signal.aborted) return;
                results.forEach((result, offset) => {
                    if (result.status === "rejected") {
                        setIssues((old) => [...old, `${batch[offset]}：${result.reason instanceof Error ? result.reason.message : "素材读取失败"}`]);
                    } else if (Object.hasOwn(report.current.assets, result.value.key)) {
                        loaded[result.value.key] = report.current.assets[result.value.key];
                    } else {
                        totalBytes += result.value.bytes;
                        if (totalBytes > 64 * 1024 * 1024) setIssues((old) => [...old, "素材总量超过 64 MB，请精简报告后重试"]);
                        else {
                            loaded[result.value.key] = result.value.dataUrl;
                            report.current.assets[result.value.key] = result.value.dataUrl;
                        }
                    }
                });
                setPending((count) => count - batch.length);
            }
            if (signal.aborted) return;
            setAssetCount(Object.keys(report.current.assets).length);
            if (send) iframeRef.current?.contentWindow?.postMessage({ type: "canvas-report-assets", channel, assets: loaded }, "*");
        };
        const receive = (event: MessageEvent) => {
            if (signal.aborted || event.source !== iframeRef.current?.contentWindow || event.data?.channel !== channel || event.data.type !== "canvas-report-status") return;
            const data = event.data;
            if (data.ready === true || data.error) clearTimeout(readyTimer);
            setReady(data.ready === true);
            setRuntimeError(typeof data.error === "string" ? data.error : "");
            if (data.state && typeof data.state === "object" && !Array.isArray(data.state)) report.current.state = data.state;
            if (data.theme === "light" || data.theme === "dark") report.current.theme = data.theme;
            const resources = Array.isArray(data.resources) ? data.resources.filter((value: unknown): value is string => typeof value === "string") : [];
            setUnresolved(resources.length);
            void loadAssets(resources, true);
        };
        window.addEventListener("message", receive);
        void (async () => {
            try {
                const response = await fetch(`${import.meta.env.BASE_URL}canvas-report-runtime.js`, { signal });
                if (!response.ok || !/javascript/.test(response.headers.get("content-type") || "")) throw new Error("交付运行时未就绪，请重新启动开发端；安装版请更新完整安装包");
                runtime.current = await reportBlobDataUrl(new Blob([await response.text()], { type: "text/javascript" }));
                await loadAssets(collectReportAssetReferences(session.report.source));
                if (signal.aborted) return;
                setSrcDoc(createReportDocument(report.current, runtime.current, channel));
                readyTimer = setTimeout(() => setRuntimeError("报告未能完成加载，请检查文档代码和素材后重试"), 30_000);
            } catch (error) {
                if (!signal.aborted) setRuntimeError(error instanceof Error ? error.message : "报告准备失败");
            } finally { if (!signal.aborted) setLoading(false); }
        })();
        return () => { controller.abort(); clearTimeout(readyTimer); window.removeEventListener("message", receive); };
    }, [session, attempt]);

    const canExport = ready && !loading && !pending && !issues.length && !runtimeError && !unresolved && !exporting;
    const download = async (zip: boolean) => {
        if (!canExport) return;
        const signal = controllerRef.current!.signal;
        const snapshot = structuredClone(report.current);
        const name = snapshot.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 100) || "Canvas 报告";
        setExporting(true);
        try {
            if (zip) {
                const archive = await createReportArchive(snapshot, runtime.current, signal);
                signal.throwIfAborted();
                saveAs(archive, `${name}-交付包.zip`);
            } else saveAs(new Blob([createReportDeliveryHtml(snapshot, runtime.current)], { type: "text/html;charset=utf-8" }), `${name}.html`);
        } catch (error) {
            if (!signal.aborted) setIssues((old) => [...old, error instanceof Error ? error.message : "导出失败，请重试"]);
        } finally { if (!signal.aborted) setExporting(false); }
    };

    return <dialog ref={dialogRef} aria-labelledby="canvas-report-title" className="m-auto h-[94vh] max-h-none w-[96vw] max-w-none overflow-hidden rounded-xl border p-0 backdrop:bg-black/50" style={{ background: theme.canvas.background, color: theme.node.text, borderColor: theme.node.stroke }} onCancel={close} onClose={close}>
        <div className="flex h-full flex-col" data-canvas-no-zoom data-canvas-shortcuts-ignore>
            <header className="flex shrink-0 items-center justify-between gap-4 border-b px-5 py-3" style={{ borderColor: theme.node.stroke }}>
                <div className="min-w-0"><h2 id="canvas-report-title" className="m-0 text-sm font-medium">阅读与交付</h2><p className="mb-0 mt-1 truncate text-[11px]" style={{ color: theme.node.muted }}>{session.report.path}</p></div>
                <button className={button} onClick={close} aria-label="关闭交付预览"><X className="size-4" /></button>
            </header>
            <div className="shrink-0 border-b px-5 py-2 text-[11px] leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                {session.fromExploded ? "当前交付展开前的整份原始文档；画布片段的文字、布局与独立交互修改不会合入。" : "交付整份文档与可保存的交互状态；本窗口不会改动画布，组件的临时状态不打包。"}
                <span className="ml-2">交付前请检查各标签与折叠内容；画布定位等宿主动作仅在画布内可用。</span>
            </div>
            <div className="relative min-h-0 flex-1">
                {srcDoc ? <iframe ref={iframeRef} title="Canvas TSX 交付预览" sandbox="allow-scripts" srcDoc={srcDoc} className="h-full w-full border-0" /> : null}
                {loading ? <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm"><LoaderCircle className="size-4 animate-spin" />正在准备报告与素材{pending ? `（${pending} 项）` : ""}…</div> : null}
            </div>
            {runtimeError || issues.length ? <div role="alert" className="max-h-28 shrink-0 overflow-auto border-t px-5 py-3 text-xs" style={{ borderColor: theme.node.stroke }}>
                <div className="mb-1 font-medium">暂不能交付，请处理后重试</div>
                {[runtimeError, ...issues].filter(Boolean).map((issue, index) => <p key={index} className="my-1 break-all" style={{ color: theme.node.muted }}>{issue}</p>)}
            </div> : null}
            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-4 py-2" style={{ borderColor: theme.node.stroke }}>
                <div className="flex items-center gap-2">
                    <span className="text-[11px]" style={{ color: theme.node.muted }}>{canExport ? `可交付 · ${assetCount} 项素材已内嵌` : pending ? `正在准备 ${pending} 项素材` : "检查报告与素材"}</span>
                    <button className={button} disabled={loading || exporting} onClick={() => setAttempt((value) => value + 1)} title="重新加载源码和素材，重置本窗口的阅读状态"><RotateCcw className="size-3.5" />重试</button>
                </div>
                <div className="flex items-center gap-1">
                    <button className={button} disabled={!canExport} onClick={() => void download(false)}><Download className="size-3.5" />导出 HTML</button>
                    <button className={button} disabled={!canExport} onClick={() => void download(true)}>{exporting ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileArchive className="size-3.5" />}下载交付包</button>
                </div>
            </footer>
        </div>
    </dialog>;
}
