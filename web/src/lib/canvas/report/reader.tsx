import { Component, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { compileCursorCanvasSource } from "../cursor-canvas-runtime";
import { CanvasRuntimeProvider, useHostTheme } from "../cursor-canvas-sdk/theme";
import { CANVAS_SANS_FONT_STACK } from "../cursor-canvas-sdk/tokens";
import { reportAssetKey, type CanvasReport } from "./document";
import css from "./reader.css?inline";

const payload = JSON.parse(document.getElementById("canvas-report-data")!.textContent!) as CanvasReport & { channel: string };
const style = document.createElement("style");
style.textContent = css;
document.head.append(style);
document.title = payload.title;
const notify = (value: Record<string, unknown>) => {
    if (payload.channel) window.parent.postMessage({ ...value, channel: payload.channel, type: "canvas-report-status" }, "*");
};

class ReportErrorBoundary extends Component<{ children: ReactNode; onError: (message: string) => void }, { error: string }> {
    state = { error: "" };
    static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : String(error) }; }
    componentDidCatch(error: Error) { this.props.onError(error.message); }
    render() { return this.state.error ? <div role="alert" className="report-error">报告运行失败：{this.state.error}</div> : this.props.children; }
}

type Section = { title: string; top: number; element: HTMLElement | null };
const flatButton = "report-button";

function ReportReader({ values, kind, setKind }: { values: Record<string, unknown>; kind: "light" | "dark"; setKind: (kind: "light" | "dark") => void }) {
    const theme = useHostTheme();
    const articleRef = useRef<HTMLElement>(null);
    const scrollRef = useRef<HTMLElement>(null);
    const [sections, setSections] = useState<Section[]>([]);
    const [height, setHeight] = useState(0);
    const [current, setCurrent] = useState(0);
    const [presenting, setPresenting] = useState(false);
    const [outlineOpen, setOutlineOpen] = useState(false);
    const [error, setError] = useState("");
    const [missing, setMissing] = useState<string[]>([]);
    const [ready, setReady] = useState(false);
    const compiled = useMemo(() => {
        const result = compileCursorCanvasSource(payload.source);
        return result.ok ? { ok: true as const, Component: memo(result.Component) } : result;
    }, []);
    const content = useMemo(() => compiled.ok ? <compiled.Component /> : null, [compiled]);

    useEffect(() => {
        const onError = (event: ErrorEvent) => setError(event.message || "报告运行失败");
        const onRejection = (event: PromiseRejectionEvent) => setError(String(event.reason?.message || event.reason || "报告异步操作失败"));
        window.addEventListener("error", onError);
        window.addEventListener("unhandledrejection", onRejection);
        window.dispatchEvent(new Event("canvas-report-mounted"));
        return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
    }, []);

    useEffect(() => {
        notify({ ready, error: error || (compiled.ok ? "" : compiled.error), resources: missing, state: values, theme: kind });
    }, [ready, error, compiled, missing, values, kind]);

    useLayoutEffect(() => {
        const article = articleRef.current;
        if (!article || !compiled.ok) return;
        let frame = 0;
        let disposed = false;
        const assets = { ...payload.assets };
        const unresolved = new Set<string>();
        const resolve = (url: string) => {
            if (!url || /^(data:|#)/i.test(url)) return url;
            try {
                const key = reportAssetKey(url, payload.path);
                if (Object.hasOwn(assets, key)) {
                    const hash = !url.startsWith("blob:") && url.includes("#") ? url.slice(url.indexOf("#")) : "";
                    return assets[key] + hash;
                }
                unresolved.add(url);
            } catch (failure) { setError(String(failure)); }
            return url;
        };
        const cssUrls = (text: string) => text.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (_, _quote, url) => `url("${resolve(url.trim())}")`);
        const materialize = () => {
            unresolved.clear();
            article.querySelectorAll("img,video,audio,source,image,use,[style],style").forEach((element) => {
                if (element instanceof HTMLImageElement) element.loading = "eager";
                for (const attribute of ["src", "poster", ...(element.matches("image,use") ? ["href", "xlink:href"] : [])]) {
                    const previous = element.getAttribute(attribute);
                    if (previous) {
                        const next = resolve(previous);
                        if (previous !== next) element.setAttribute(attribute, next);
                    }
                }
                const srcset = element.getAttribute("srcset");
                if (srcset) {
                    const next = srcset.replace(/(data:[^\s]+|[^\s,]+)(\s+[\d.]+[wx])?/g, (_, url, size = "") => resolve(url) + size);
                    if (next !== srcset) element.setAttribute("srcset", next);
                }
                const previous = element.getAttribute("style");
                if (previous?.includes("url(")) {
                    const next = cssUrls(previous);
                    if (next !== previous) element.setAttribute("style", next);
                }
                if (element.tagName === "STYLE" && element.textContent?.includes("url(")) {
                    const next = cssUrls(element.textContent);
                    if (next !== element.textContent) element.textContent = next;
                }
            });
            const nextMissing = [...unresolved];
            setMissing((old) => JSON.stringify(old) === JSON.stringify(nextMissing) ? old : nextMissing);
        };
        const measure = () => {
            frame = 0;
            materialize();
            const rect = article.getBoundingClientRect();
            const headings = [...article.querySelectorAll<HTMLElement>("h2")];
            if (!headings.length) headings.push(...article.querySelectorAll<HTMLElement>("h1,h3"));
            const next: Section[] = [{ title: payload.title, top: 0, element: null }];
            for (const heading of headings) {
                if (!heading.getClientRects().length) continue;
                const top = Math.max(0, heading.getBoundingClientRect().top - rect.top - 8);
                const section = { title: heading.textContent?.trim() || "未命名章节", top, element: heading };
                if (top < 24) next[0] = section;
                else if (top - next[next.length - 1].top > 8) next.push(section);
            }
            setHeight(article.scrollHeight);
            setSections((old) => old.length === next.length && old.every((item, index) => item.title === next[index].title && Math.abs(item.top - next[index].top) < 1 && item.element === next[index].element) ? old : next);
            setReady(!unresolved.size && [...article.querySelectorAll("img")].every((image) =>
                (!image.getAttribute("src") && !image.getAttribute("srcset")) || (image.complete && image.naturalWidth > 0)));
        };
        const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(measure); };
        const observer = new MutationObserver(schedule);
        observer.observe(article, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["src", "srcset", "poster", "href", "xlink:href", "style", "hidden", "open"] });
        const resize = new ResizeObserver(schedule);
        resize.observe(article);
        const receive = (event: MessageEvent) => {
            if (event.source !== window.parent || !payload.channel || event.data?.channel !== payload.channel || event.data.type !== "canvas-report-assets") return;
            for (const [key, value] of Object.entries(event.data.assets || {})) {
                if (typeof value === "string" && /^data:(image|audio|video|font)\//.test(value)) assets[key] = value;
            }
            schedule();
        };
        window.addEventListener("message", receive);
        article.addEventListener("load", schedule, true);
        document.fonts.ready.then(schedule);
        schedule();
        return () => { disposed = true; observer.disconnect(); resize.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("message", receive); article.removeEventListener("load", schedule, true); };
    }, [compiled]);

    const index = Math.min(current, Math.max(0, sections.length - 1));
    const go = useCallback((next: number) => {
        const target = Math.max(0, Math.min(sections.length - 1, next));
        setCurrent(target);
        setOutlineOpen(false);
        scrollRef.current?.scrollTo({ top: presenting ? 0 : sections[target]?.top || 0, behavior: "instant" });
    }, [sections, presenting]);
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.target instanceof Element && event.target.closest("input,textarea,select,[contenteditable=true]")) return;
            if (event.key === "Escape") { setPresenting(false); return; }
            if (!presenting) return;
            if (["ArrowRight", "PageDown", "ArrowLeft", "PageUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                go(event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : index + (["ArrowRight", "PageDown"].includes(event.key) ? 1 : -1));
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [presenting, go, index, sections.length]);
    useLayoutEffect(() => {
        scrollRef.current?.scrollTo({ top: presenting ? 0 : sections[index]?.top || 0 });
    }, [presenting]);

    const variables = {
        "--report-bg": theme.bg.editor, "--report-text": theme.text.primary, "--report-muted": theme.text.secondary,
        "--report-line": theme.palette.strokeSecondary, "--report-hover": theme.palette.fillTertiary,
        "--report-focus": theme.palette.accent, fontFamily: CANVAS_SANS_FONT_STACK, colorScheme: kind,
    } as CSSProperties;
    return <div className={`report-reader ${presenting ? "is-presenting" : ""}`} style={variables}>
        <header className="report-header">
            <button className={`${flatButton} report-outline-toggle`} onClick={() => setOutlineOpen(!outlineOpen)} aria-label="切换目录">☰</button>
            <div className="report-identity"><span className="report-eyebrow">CANVAS / REPORT</span><strong title={payload.title}>{payload.title}</strong></div>
            <nav className="report-modes" aria-label="报告模式">
                <button className={flatButton} aria-pressed={!presenting} onClick={() => setPresenting(false)}>阅读</button>
                <button className={flatButton} aria-pressed={presenting} onClick={() => setPresenting(true)}>演示</button>
            </nav>
            <button className={flatButton} onClick={() => setKind(kind === "dark" ? "light" : "dark")} title="切换报告主题">{kind === "dark" ? "浅色" : "深色"}</button>
        </header>
        <div className="report-workspace">
            <aside className={`report-outline ${outlineOpen ? "is-open" : ""}`} aria-label="报告目录">
                <div className="report-outline-label">目录 <span>{String(sections.length).padStart(2, "0")}</span></div>
                {sections.map((section, position) => <button key={position} className={flatButton} aria-current={index === position ? "location" : undefined} onClick={() => go(position)}>
                    <span className="report-section-number">{String(position + 1).padStart(2, "0")}</span><span>{section.title}</span>
                </button>)}
                <p className="report-outline-note">交互只保留在本次阅读中，重新打开恢复交付时的状态。</p>
            </aside>
            <main className="report-scroll" ref={scrollRef} onScroll={() => {
                if (presenting) return;
                const top = scrollRef.current?.scrollTop || 0;
                let next = 0;
                sections.forEach((section, position) => { if (section.top <= top + 64) next = position; });
                setCurrent(next);
            }}>
                {error || !compiled.ok ? <div className="report-error" role="alert">{error || (!compiled.ok && compiled.error)}</div> : null}
                {missing.length && !payload.channel ? <div className="report-error" role="alert">以下素材未包含在交付包中：{missing.join("、")}</div> : null}
                <div className="report-stage" style={presenting ? { height: Math.max(1, (sections[index + 1]?.top ?? height) - (sections[index]?.top || 0)), overflow: "hidden" } : undefined}>
                    <article ref={articleRef} style={{ transform: presenting ? `translateY(-${sections[index]?.top || 0}px)` : undefined }} onErrorCapture={(event) => {
                        const target = event.target;
                        if (target instanceof HTMLImageElement && (target.currentSrc || target.getAttribute("src"))?.startsWith("data:")) setError("图片素材无法解码，请替换后再交付");
                    }}>
                        <ReportErrorBoundary onError={setError}>{content}</ReportErrorBoundary>
                    </article>
                </div>
            </main>
        </div>
        {presenting ? <footer className="report-presentation-bar">
            <span>{sections[index]?.title || payload.title}</span>
            <button className={flatButton} disabled={index === 0} onClick={() => go(index - 1)} aria-label="上一章">←</button>
            <span className="report-page-number">{index + 1} / {sections.length || 1}</span>
            <button className={flatButton} disabled={index >= sections.length - 1} onClick={() => go(index + 1)} aria-label="下一章">→</button>
            <span className="report-key-hint">← → 翻章 · Esc 阅读</span>
        </footer> : null}
    </div>;
}

function App() {
    const [kind, setKind] = useState(payload.theme);
    const [values, setValues] = useState(payload.state);
    const update = useCallback((key: string, action: (previous: unknown) => unknown) => {
        setValues((previous) => {
            const json = JSON.stringify(action(Object.hasOwn(previous, key) ? previous[key] : undefined));
            if (json === undefined) throw new Error("useCanvasState 仅支持可 JSON 序列化的数据");
            return { ...previous, [key]: JSON.parse(json) };
        });
    }, []);
    const state = useMemo(() => ({ values, update }), [values, update]);
    return <CanvasRuntimeProvider kind={kind} state={state}><ReportReader values={values} kind={kind} setKind={setKind} /></CanvasRuntimeProvider>;
}

createRoot(document.getElementById("root")!).render(<App />);
