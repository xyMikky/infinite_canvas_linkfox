/** Async Clipboard API 仅在 localhost / HTTPS 等安全上下文中可用；局域网 HTTP 需走 copy/paste 事件。 */
export function canUseAsyncClipboard() {
    return typeof window !== "undefined" && window.isSecureContext && Boolean(navigator.clipboard?.read && navigator.clipboard?.write);
}

function isClipboardImageFile(file: File | null | undefined) {
    if (!file || !file.size) return false;
    return file.type.startsWith("image/") || !file.type;
}

export function dataTransferHasImageHint(data: DataTransfer | null | undefined) {
    if (!data) return false;
    if (readImageFilesFromDataTransfer(data).length) return true;
    return Array.from(data.items || []).some((item) => item.type.startsWith("image/"));
}

export function readImageFilesFromDataTransfer(data: DataTransfer | null | undefined) {
    if (!data) return [] as File[];
    const files: File[] = [];
    for (const file of Array.from(data.files || [])) {
        if (isClipboardImageFile(file)) files.push(file);
    }
    if (files.length) return files;
    for (const item of Array.from(data.items || [])) {
        if (item.kind !== "file") continue;
        if (item.type && !item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (isClipboardImageFile(file)) files.push(file!);
    }
    return files;
}

export async function copyBlobToSystemClipboard(blob: Blob, mimeType = "image/png", html?: string) {
    if (canUseAsyncClipboard() && typeof ClipboardItem !== "undefined") {
        try {
            await navigator.clipboard.write([new ClipboardItem({
                [mimeType]: blob,
                ...(html ? { "text/html": new Blob([html], { type: "text/html" }) } : {}),
            })]);
            return true;
        } catch {
            // fall through to copy event
        }
    }
    return copyBlobViaCopyEvent(blob, mimeType, html);
}

function copyBlobViaCopyEvent(blob: Blob, mimeType: string, html?: string) {
    return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (ok: boolean) => {
            if (settled) return;
            settled = true;
            document.removeEventListener("copy", onCopy);
            resolve(ok);
        };
        const onCopy = (event: ClipboardEvent) => {
            event.preventDefault();
            const data = event.clipboardData;
            if (!data) return finish(false);
            try {
                data.clearData();
                if (html) data.setData("text/html", html);
                data.items.add(blob, mimeType);
                finish(true);
            } catch {
                finish(false);
            }
        };
        document.addEventListener("copy", onCopy);
        if (!document.execCommand("copy")) finish(false);
    });
}
