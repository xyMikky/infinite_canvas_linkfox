import { Alert, App, Button } from "antd";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

export function CanvasStorageNotice() {
    const { message } = App.useApp();
    const error = useCanvasStore(state => state.storageError);
    const hydrated = useCanvasStore(state => state.hydrated);
    const retrySave = useCanvasStore(state => state.retrySave);
    if (!error || !hydrated) return null;
    return (
        <div className="fixed bottom-4 left-4 right-4 z-[10000] mx-auto max-w-3xl" data-canvas-shortcuts-ignore>
            <Alert type="error" showIcon message="画布尚未保存，请保留当前页面" description={error}
                action={<div className="flex flex-wrap gap-2">
                    <Button onClick={async () => {
                        try {
                            const { exportCanvasProjects } = await import("@/lib/canvas/canvas-export");
                            await exportCanvasProjects(useCanvasStore.getState().projects, "画布-未保存内容");
                        } catch { message.error("导出失败，请保留当前页面后重试。"); }
                    }}>导出当前内容</Button>
                    <Button onClick={() => void retrySave()}>重试保存</Button>
                </div>} />
        </div>
    );
}
