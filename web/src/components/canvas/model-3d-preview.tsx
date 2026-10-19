import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { loadFolderPreviewSourceBuffer } from "@/lib/canvas/folder-preview-cache";
import { isModel3dFileName } from "@/lib/canvas/model-3d-preview";
import type { CanvasTheme } from "@/lib/canvas-theme";

export function Model3dPreview({
    folderNodeId,
    path,
    fileName,
    interactive = false,
    theme,
}: {
    folderNodeId: string;
    path: string;
    fileName: string;
    interactive?: boolean;
    theme: CanvasTheme;
}) {
    const { t } = useTranslation();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [status, setStatus] = useState<"loading" | "ready" | "missing" | "failed">("loading");

    // #region agent log
    useEffect(() => {
        const props = arguments[0] as Record<string, unknown> | undefined;
        fetch('http://127.0.0.1:7475/ingest/5542b978-a3f6-40e8-8231-ec6ddb075fc3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'deafa8'},body:JSON.stringify({sessionId:'deafa8',runId:'pre-fix',hypothesisId:'A,B',location:'model-3d-preview.tsx:props',message:'model preview props',data:{passedShowTextures:props?.showTextures,passedPreviewBg:props?.previewBg,usedBackground:theme.canvas.background,interactive},timestamp:Date.now()})}).catch(()=>{});
    });
    // #endregion
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        let cancelled = false;
        let dispose: (() => void) | undefined;
        setStatus("loading");
        void (async () => {
            try {
                if (!isModel3dFileName(fileName)) {
                    if (!cancelled) setStatus("failed");
                    return;
                }
                const data = await loadFolderPreviewSourceBuffer(folderNodeId, path);
                if (cancelled) return;
                if (!data?.byteLength) {
                    setStatus("missing");
                    return;
                }
                const { mountModel3dViewer } = await import("@/lib/canvas/model-3d-viewer");
                dispose = await mountModel3dViewer({
                    canvas,
                    buffer: data,
                    fileName,
                    interactive,
                    background: theme.canvas.background,
                });
                // #region agent log
                fetch('http://127.0.0.1:7475/ingest/5542b978-a3f6-40e8-8231-ec6ddb075fc3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'deafa8'},body:JSON.stringify({sessionId:'deafa8',runId:'pre-fix',hypothesisId:'C,D',location:'model-3d-preview.tsx:mounted',message:'viewer mounted',data:{disposeType:typeof dispose,cancelled},timestamp:Date.now()})}).catch(()=>{});
                // #endregion
                if (cancelled) {
                    dispose();
                    return;
                }
                setStatus("ready");
            } catch (error) {
                // #region agent log
                fetch('http://127.0.0.1:7475/ingest/5542b978-a3f6-40e8-8231-ec6ddb075fc3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'deafa8'},body:JSON.stringify({sessionId:'deafa8',runId:'pre-fix',hypothesisId:'D',location:'model-3d-preview.tsx:catch',message:'load failed',data:{error:String(error),cancelled},timestamp:Date.now()})}).catch(()=>{});
                // #endregion
                if (!cancelled) setStatus("failed");
            }
        })();
        return () => {
            cancelled = true;
            // #region agent log
            try { dispose?.(); } catch (error) { fetch('http://127.0.0.1:7475/ingest/5542b978-a3f6-40e8-8231-ec6ddb075fc3',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'deafa8'},body:JSON.stringify({sessionId:'deafa8',runId:'pre-fix',hypothesisId:'C',location:'model-3d-preview.tsx:cleanup',message:'cleanup dispose threw',data:{error:String(error),disposeType:typeof dispose},timestamp:Date.now()})}).catch(()=>{}); throw error; }
            // #endregion
        };
    }, [fileName, folderNodeId, interactive, path, theme.canvas.background]);

    return (
        <div className="relative h-full min-h-0 w-full" data-canvas-no-zoom>
            <canvas ref={canvasRef} className="h-full w-full" />
            {status !== "ready" ? (
                <div className="absolute inset-0 grid place-items-center px-4 text-center text-xs" style={{ color: theme.node.placeholder }}>
                    {status === "loading" ? t("canvas.smartPreview.model3dLoading") : status === "missing" ? t("canvas.smartPreview.model3dMissing") : t("canvas.smartPreview.model3dFailed")}
                </div>
            ) : null}
        </div>
    );
}
