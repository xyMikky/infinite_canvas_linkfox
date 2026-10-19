import { createZip } from "@/lib/zip";
import { createReportDeliveryHtml, reportAssetKey, type CanvasReport } from "./document";

export async function createReportArchive(report: CanvasReport, runtime: string, signal: AbortSignal) {
    const sourcePath = reportAssetKey(`/${report.path}`, "");
    const files: { name: string; data: BlobPart }[] = [
        { name: "打开报告.html", data: createReportDeliveryHtml(report, runtime) },
        { name: `source/${sourcePath}`, data: report.source },
        { name: "文档状态.json", data: JSON.stringify(report.state, null, 2) },
        { name: "交付说明.txt", data: "双击打开报告.html 即可阅读与演示，无需安装画布或联网。保留 SDK 图表交互；重新打开恢复交付状态。\nsource 中是整份原始源码，展开节点的独立修改不反向合入源码。\n文档状态保存 useCanvasState 数据，React 组件临时状态不打包。素材清单记录原引用与包内路径。\n动态分支请在交付前逐一打开检查；画布定位等宿主专属动作在独立报告中不可用。" },
    ];
    const manifest: { reference: string; file: string }[] = [];
    for (const [key, dataUrl] of Object.entries(report.assets)) {
        signal.throwIfAborted();
        if (!/^data:(image|audio|video|font)\//.test(dataUrl)) throw new Error("素材必须先内嵌再交付");
        const file = /^[a-z][\w+.-]*:/i.test(key)
            ? `assets/${manifest.length + 1}.${dataUrl.split(";")[0].split("/")[1].replace("svg+xml", "svg")}`
            : `source/${reportAssetKey(`/${key}`, "")}`;
        files.push({ name: file, data: await (await fetch(dataUrl, { signal })).blob() });
        manifest.push({ reference: key, file });
    }
    files.push({ name: "素材清单.json", data: JSON.stringify(manifest, null, 2) });
    signal.throwIfAborted();
    const zip = await createZip(files);
    signal.throwIfAborted();
    return zip;
}
