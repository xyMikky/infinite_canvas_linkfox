import { useState } from "react";
import { App, Button, Modal, Spin } from "antd";
import { History } from "lucide-react";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { listCanvasBackups, readCanvasBackup, restoreCanvasBackup, type CanvasBackup } from "@/services/canvas-persistence";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

export function CanvasBackups() {
    const { message, modal } = App.useApp();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [backups, setBackups] = useState<CanvasBackup[]>([]);
    const savePending = useCanvasStore(state => state.savePending);
    const load = async () => {
        setOpen(true);
        setLoading(true);
        setError("");
        try { setBackups(await listCanvasBackups()); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "读取备份失败"); }
        finally { setLoading(false); }
    };
    return <>
        <Button icon={<History className="size-4" />} onClick={() => void load()}>恢复备份</Button>
        <Modal title="画布恢复备份" open={open} onCancel={() => setOpen(false)} footer={null}>
            <p className="mb-4 text-sm text-muted-foreground">升级原件与最近 20 份历史保留在本机。恢复会创建副本；也可以下载含素材的 ZIP 留存。</p>
            {loading ? <Spin /> : error ? <p role="alert">{error}</p> : !backups.length ? <p>暂无恢复备份</p> : <div className="max-h-[55vh] overflow-auto">
                {backups.map(backup => <div key={backup.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-3">
                    <div><div>{new Date(backup.createdAt).toLocaleString()}</div><div className="text-xs text-muted-foreground">{backup.projects} 个画布 · {backup.nodes} 个节点 · {backup.id.startsWith("upgrade-") ? "升级原件" : "历史快照"}</div></div>
                    <div className="flex gap-1">
                        <Button type="text" onClick={async () => {
                            try { await exportCanvasProjects(await readCanvasBackup(backup.id), "画布恢复备份"); }
                            catch { message.error("下载失败，备份仍保留在本机。"); }
                        }}>下载 ZIP</Button>
                        <Button type="text" disabled={savePending} onClick={() => modal.confirm({
                            title: "从这份备份恢复？", content: "现有画布将保留，恢复内容以副本加入。完成后页面会重新加载。", okText: "恢复副本", cancelText: "取消",
                            onOk: async () => {
                                if (useCanvasStore.getState().savePending) throw new Error("请先导出当前尚未保存的内容。");
                                await restoreCanvasBackup(backup.id);
                                window.location.reload();
                            },
                        })}>恢复副本</Button>
                    </div>
                </div>)}
            </div>}
            {savePending ? <p className="mt-3 text-sm">当前还有未保存内容，请先导出留存。</p> : null}
        </Modal>
    </>;
}
