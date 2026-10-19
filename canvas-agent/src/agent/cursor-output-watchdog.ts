/** Cursor CLI 初始化期间尚不会发送 stream-json，启动等待与模型回复等待分开计时。 */
export function watchCursorOutput(onTimeout: (phase: "startup" | "response") => void) {
    let timer = setTimeout(() => onTimeout("startup"), 60000);
    return {
        activity() {
            clearTimeout(timer);
            timer = setTimeout(() => onTimeout("response"), 75000);
        },
        stop() { clearTimeout(timer); },
    };
}
