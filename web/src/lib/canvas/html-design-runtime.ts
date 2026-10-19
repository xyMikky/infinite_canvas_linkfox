import { createHtmlMotionController } from "@/lib/canvas/html-design-motion";
import { isEditableHtmlText, readHtmlText, readHtmlTextBreaks, writeHtmlText, type HtmlTextEdit } from "@/lib/canvas/html-design-source";

export type HtmlDesignMode = "select" | "text" | "interact";
export type HtmlDesignSettings = { mode: HtmlDesignMode; fields: Record<string, string>; lineBreaks: Record<string, number[]>; paused: boolean; speed: number; visible: boolean };

/** 绑定当前 iframe 的文档；不序列化运行中的 DOM，也不将辅助样式保存进用户 HTML。 */
export function attachHtmlDesignRuntime(frame: HTMLIFrameElement, commit: (edit: HtmlTextEdit) => boolean, conflict: () => void) {
    const document = frame.contentDocument;
    const view = frame.contentWindow;
    if (!document?.body || !view) throw new Error("当前页面无法编辑；请重新打开原始 HTML。");
    let settings: HtmlDesignSettings = { mode: "select", fields: {}, lineBreaks: {}, paused: false, speed: 1, visible: true };
    let editing: { element: HTMLElement; id: string; before: string; dirty: boolean; children: Node[] } | null = null;
    let disposed = false;
    const leaves = new Map<string, HTMLElement>();
    const motion = createHtmlMotionController(() => document.getAnimations());
    const style = document.createElement("style");
    style.setAttribute("data-infinite-ui-tools", "");
    style.textContent = '[data-infinite-ui-editable]{outline:1px dashed #3b82f6!important;outline-offset:3px;cursor:text!important}[data-infinite-ui-editable]:focus{outline:2px solid #3b82f6!important}';
    document.head.appendChild(style);
    const stop = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
    function finish(cancel = false) {
        if (!editing) return;
        const { element, id, before, dirty, children } = editing;
        editing = null;
        // innerText 保留编辑器产生的换行；暂时取消大小写样式，避免把 CSS 大写写成文案。
        const transform = element.style.getPropertyValue("text-transform");
        const priority = element.style.getPropertyPriority("text-transform");
        element.style.setProperty("text-transform", "none", "important");
        const after = dirty ? (element.innerText || "").replace(/\r\n/g, "\n") : before;
        if (transform) element.style.setProperty("text-transform", transform, priority);
        else element.style.removeProperty("text-transform");
        element.removeAttribute("contenteditable");
        const afterBreaks = Array.from(after.matchAll(/\n/g), match => match.index!);
        const changed = after !== before || (dirty && afterBreaks.join(",") !== settings.lineBreaks[id]?.join(","));
        if (cancel || !changed || !commit({ id, before, after, afterBreaks })) element.replaceChildren(...children);
        else {
            writeHtmlText(element, after);
            settings = { ...settings, fields: { ...settings.fields, [id]: after } };
        }
    }
    function syncMotion() {
        motion.update(settings.paused || settings.mode === "text" || !settings.visible, settings.speed);
    }
    function pointer(event: Event) {
        if (settings.mode !== "text") return;
        const target = event.target as Element | null;
        const element = target?.closest?.("[data-infinite-ui-editable]") as HTMLElement | null;
        if (editing?.element === element) { event.stopImmediatePropagation(); return; }
        stop(event);
        finish();
        if (!element) return;
        const id = element.getAttribute("data-ui-text")!;
        if (!Object.hasOwn(settings.fields, id) || readHtmlText(element) !== settings.fields[id]) return;
        editing = { element, id, before: settings.fields[id], dirty: false, children: Array.from(element.childNodes, node => node.cloneNode(true)) };
        element.setAttribute("contenteditable", "plaintext-only");
        element.focus({ preventScroll: true });
        const selection = view!.getSelection();
        const range = document!.createRange();
        range.selectNodeContents(element);
        selection?.removeAllRanges();
        selection?.addRange(range);
    }
    function blockAction(event: Event) {
        if (settings.mode === "text") stop(event);
    }
    function mouseDown(event: Event) {
        if (settings.mode === "text") event.stopImmediatePropagation();
    }
    function keyboard(event: KeyboardEvent) {
        if (settings.mode !== "text") return;
        event.stopImmediatePropagation();
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") { event.preventDefault(); finish(true); }
        else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); finish(); }
        else if (!editing) event.preventDefault();
    }
    function paste(event: ClipboardEvent) {
        if (settings.mode !== "text") return;
        event.stopImmediatePropagation();
        // plaintext-only 原生粘贴会去掉格式，并保留浏览器输入撤销栈。
        if (!editing) event.preventDefault();
    }
    function blur() { finish(); }
    function input(event: Event) {
        if (settings.mode !== "text") return;
        event.stopImmediatePropagation();
        if (editing) editing.dirty = true;
    }
    function keyUp(event: Event) {
        if (settings.mode === "text") event.stopImmediatePropagation();
    }
    view.addEventListener("pointerdown", pointer, true);
    view.addEventListener("mousedown", mouseDown, true);
    for (const event of ["click", "dblclick", "submit", "dragstart", "drop"]) view.addEventListener(event, blockAction, true);
    view.addEventListener("keydown", keyboard, true);
    view.addEventListener("keyup", keyUp, true);
    view.addEventListener("paste", paste, true);
    view.addEventListener("input", input, true);
    view.addEventListener("blur", blur);
    document.addEventListener("focusout", blur, true);
    document.addEventListener("animationstart", syncMotion, true);
    document.addEventListener("transitionrun", syncMotion, true);
    // 只在需要控制速度/暂停且可见时补齐脚本创建的 Web Animations，无逐帧全页扫描。
    let timer: number | undefined;
    return {
        update(next: HtmlDesignSettings) {
            if (disposed) return;
            if (editing && next.fields[editing.id] !== editing.before) { finish(true); conflict(); }
            if (settings.mode !== next.mode) finish();
            settings = next;
            for (const element of leaves.values()) element.removeAttribute("data-infinite-ui-editable");
            leaves.clear();
            const candidates = new Map<string, HTMLElement[]>();
            for (const element of document.querySelectorAll<HTMLElement>("[data-ui-text]")) {
                const id = element.getAttribute("data-ui-text")!;
                candidates.set(id, [...(candidates.get(id) || []), element]);
            }
            for (const [id, elements] of candidates) {
                if (!Object.hasOwn(next.fields, id) || elements.length !== 1) continue;
                const element = elements[0];
                if (editing?.element !== element && !isEditableHtmlText(element)) continue;
                if (editing?.element !== element && (readHtmlText(element) !== next.fields[id]
                    || readHtmlTextBreaks(element).join(",") !== next.lineBreaks[id]?.join(","))) writeHtmlText(element, next.fields[id], next.lineBreaks[id]);
                leaves.set(id, element);
                if (next.mode === "text") element.setAttribute("data-infinite-ui-editable", "");
            }
            syncMotion();
            const poll = next.visible && (next.paused || next.mode === "text" || next.speed !== 1);
            if (poll && timer === undefined) timer = window.setInterval(syncMotion, 300);
            else if (!poll && timer !== undefined) { window.clearInterval(timer); timer = undefined; }
        },
        flush: () => finish(),
        dispose() {
            disposed = true;
            finish(true);
            window.clearInterval(timer);
            motion.dispose();
            style.remove();
            for (const element of leaves.values()) element.removeAttribute("data-infinite-ui-editable");
            view.removeEventListener("pointerdown", pointer, true);
            view.removeEventListener("mousedown", mouseDown, true);
            for (const event of ["click", "dblclick", "submit", "dragstart", "drop"]) view.removeEventListener(event, blockAction, true);
            view.removeEventListener("keydown", keyboard, true);
            view.removeEventListener("keyup", keyUp, true);
            view.removeEventListener("paste", paste, true);
            view.removeEventListener("input", input, true);
            view.removeEventListener("blur", blur);
            document.removeEventListener("focusout", blur, true);
            document.removeEventListener("animationstart", syncMotion, true);
            document.removeEventListener("transitionrun", syncMotion, true);
        },
    };
}
