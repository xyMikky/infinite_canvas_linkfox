export const PHOTOPEA_ORIGIN = "https://www.photopea.com";
export const PHOTOPEA_SAVE_REQUEST = "canvas-photopea-save";

// Photopea 每条脚本都会回传 done；只接收带本命令标记的完成事件，避免菜单或其它脚本串线。
export function createPhotopeaClient(getWindow: () => Pick<Window, "postMessage"> | null | undefined) {
    let disposed: Error | null = null;
    let initialized = false;
    let sequence = 0;
    let tail = Promise.resolve<unknown>(null);
    type Reply = { buffer: ArrayBuffer | null; value: string | null };
    let current: { marker: string; acknowledged: boolean; error?: Error; reply: Reply; resolve: (reply: Reply) => void; reject: (error: Error) => void } | null = null;
    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const session = Math.random().toString(36).slice(2);
    const dispose = (error = new Error("photopea-closed")) => {
        if (disposed) return;
        disposed = error;
        clearTimeout(timer);
        readyReject(error);
        current?.reject(error);
        current = null;
    };
    let timer = setTimeout(() => dispose(new Error("photopea-load-timeout")), 30000);
    const send = (message: string | ArrayBuffer, expression?: string) => {
        const result = tail.then(async () => {
            await ready;
            const frame = getWindow();
            if (disposed) throw disposed;
            if (!frame) throw new Error("photopea-closed");
            return new Promise<Reply>((resolve, reject) => {
                const marker = `canvas-photopea:${session}:${++sequence}`;
                const binary = message instanceof ArrayBuffer;
                current = { marker, acknowledged: binary, reply: { buffer: null, value: null }, resolve, reject };
                timer = setTimeout(() => dispose(new Error("photopea-command-timeout")), 30000);
                const script = expression
                    ? `app.echoToOE(${JSON.stringify(marker + ":value:")} + (${expression}));`
                    : message;
                const completed = `try { ${script}\n;app.echoToOE(${JSON.stringify(marker + ":ok")}); } catch (e) { app.echoToOE(${JSON.stringify(marker + ":error:script-failed")}); }`;
                // 显式回报脚本失败，不能让异常缺失回执后被误判为通信中断。
                const payload = binary ? message : expression ? completed
                    : `if (app.documents.length) { ${completed} } else { app.echoToOE(${JSON.stringify(marker + ":error:no-document")}); }`;
                try { frame.postMessage(payload, PHOTOPEA_ORIGIN); }
                catch { dispose(new Error("photopea-closed")); }
            });
        });
        tail = result.catch(() => {});
        return result;
    };
    const run = async (script: string) => (await send(script)).buffer;
    const query = async (expression: string) => {
        const { value } = await send("", expression);
        if (value === null) throw new Error("photopea-invalid-reply");
        return value;
    };
    const waitFor = async (expression: string) => {
        const deadline = Date.now() + 30000;
        while (await query(expression) !== "true") {
            if (Date.now() >= deadline) {
                // 查询仍有回执，只是图片未完成加载，不应销毁整个编辑会话。
                throw new Error("photopea-image-timeout");
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    };
    return {
        ready,
        dispose,
        run,
        async openImage(buffer: ArrayBuffer) {
            const count = Number(await query("app.documents.length"));
            await send(buffer);
            await waitFor(`app.documents.length > ${count}`);
        },
        async openLayer(buffer: ArrayBuffer, title: string) {
            const source = `canvas-photopea-document:${session}:${++sequence}`;
            const target = JSON.parse(await query(`(function () {
    if (!app.documents.length) return "null";
    app.activeDocument.source = ${JSON.stringify(source)};
    return JSON.stringify(app.activeDocument.source);
})()`)) as string | null;
            if (!target) throw new Error("no-document");
            await this.openImage(buffer);
            // 跨文档 duplicate 在 Photopea 中可能复制到临时文档自身，改用合并复制和粘贴。
            await run(`(function () {
var imported = app.activeDocument;
var target = null;
for (var i = 0; i < app.documents.length; i++) {
    if (app.documents[i].source === ${JSON.stringify(target)}) target = app.documents[i];
}
if (target && target !== imported) {
    imported.selection.selectAll();
    imported.selection.copy(true);
    imported.close(SaveOptions.DONOTSAVECHANGES);
    app.activeDocument = target;
    if (app.activeDocument.source !== ${JSON.stringify(target)}) throw new Error("photopea-target-missing");
    var before = app.activeDocument.layers.length;
    if (before) app.activeDocument.activeLayer = app.activeDocument.layers[0];
    app.activeDocument.paste();
    if (app.activeDocument.layers.length <= before) throw new Error("photopea-layer-missing");
    app.activeDocument.activeLayer.name = ${JSON.stringify(title)};
} else { throw new Error("photopea-target-missing"); }
})()`);
        },
        receive(event: Pick<MessageEvent, "source" | "origin" | "data">) {
            if (disposed || event.origin !== PHOTOPEA_ORIGIN || event.source !== getWindow()) return;
            if (!initialized && event.data === "done") {
                initialized = true;
                clearTimeout(timer);
                readyResolve();
                return;
            }
            if (!current) return;
            if (event.data instanceof ArrayBuffer) current.reply.buffer = event.data;
            else if (event.data === current.marker + ":ok") current.acknowledged = true;
            else if (typeof event.data === "string" && event.data.startsWith(current.marker + ":value:")) {
                current.reply.value = event.data.slice((current.marker + ":value:").length);
            }
            else if (typeof event.data === "string" && event.data.startsWith(current.marker + ":error:")) {
                current.acknowledged = true;
                current.error = new Error(event.data.slice((current.marker + ":error:").length));
            } else if (event.data === "done" && current.acknowledged) {
                clearTimeout(timer);
                const finished = current;
                current = null;
                if (finished.error) finished.reject(finished.error);
                else finished.resolve(finished.reply);
            }
        },
    };
}
