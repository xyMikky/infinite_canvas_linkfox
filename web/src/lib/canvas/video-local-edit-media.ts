import { nanoid } from "nanoid";
import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import type { VideoGenerationResult } from "@/services/api/video";
import type { CanvasNodeData } from "@/types/canvas";
import { buildVideoEditComposeArgs, buildVideoEditPrepareArgs, normalizeVideoEditKeyframes, readVideoEditProbe, validateGeneratedEdit, type VideoLocalEditPlan, type VideoLocalEditSelection } from "./video-local-edit";

type Progress = (text: string) => void;
const MAX_JOB_MS = 10 * 60_000;

async function readMedia(storageKey: string | undefined, url: string | undefined, signal: AbortSignal) {
    signal.throwIfAborted();
    if (storageKey) {
        const blob = await getMediaBlob(storageKey);
        if (blob?.size) return blob;
    }
    if (!url || url.startsWith("blob:")) throw new Error("原视频文件不可读取，请重新导入视频");
    try {
        const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
        if (!response.ok) throw new Error();
        const blob = await response.blob();
        if (!blob.size) throw new Error();
        return blob;
    } catch {
        signal.throwIfAborted();
        throw new Error("视频下载失败，请检查网络或重新导入视频");
    }
}

/** 每项任务独占 worker，取消只终止自己的任务，不与视频裁切/音频导出抢虚拟文件。 */
async function withVideoWorker<T>(signal: AbortSignal, progress: Progress, work: (ffmpeg: FFmpeg) => Promise<T>) {
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const ffmpeg = new FFmpeg();
    const urls: string[] = [];
    const timeout = AbortSignal.timeout(MAX_JOB_MS);
    const jobSignal = AbortSignal.any([signal, timeout]);
    const terminate = () => ffmpeg.terminate();
    jobSignal.addEventListener("abort", terminate, { once:true });
    try {
        jobSignal.throwIfAborted();
        progress("正在加载视频处理器…");
        const base = new URL(`${import.meta.env.BASE_URL}ffmpeg/`,window.location.href);
        for (const file of ["ffmpeg-core.js","ffmpeg-core.wasm"]) {
            const response = await fetch(new URL(file,base),{signal:jobSignal});
            if (!response.ok) throw new Error("视频处理器加载失败，请重新打开画布后重试");
            const bytes = await response.arrayBuffer();
            urls.push(URL.createObjectURL(new Blob([bytes],{type:file.endsWith(".js")?"text/javascript":"application/wasm"})));
        }
        await ffmpeg.load({coreURL:urls[0],wasmURL:urls[1]},{signal:jobSignal});
        const result=await work(ffmpeg);
        jobSignal.throwIfAborted();
        return result;
    } catch(error) {
        if (signal.aborted) throw new DOMException("已取消视频处理","AbortError");
        if (timeout.aborted) throw new Error("视频处理超时，原片未更改，请缩短选段或降低源文件体积后重试");
        if (error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)) throw error;
        throw new Error("视频处理失败，原片未更改；请检查视频格式或可用内存后重试");
    } finally {
        jobSignal.removeEventListener("abort",terminate);
        ffmpeg.terminate();
        urls.forEach(url=>URL.revokeObjectURL(url));
    }
}

async function inspect(ffmpeg: FFmpeg, name: string) {
    // 当前 bundled core 的 ffprobe 成功写 JSON 后也会返回 -1；只读本次新文件，严格校验解码帧数。
    try { await ffmpeg.deleteFile("probe.json"); } catch { /* first probe */ }
    const code=await ffmpeg.ffprobe(["-v","error","-count_frames","-show_streams","-show_format","-of","json",name,"-o","probe.json"]);
    if (code !== 0 && code !== -1) throw new Error("视频帧信息读取失败，无法安全对齐，原片未更改");
    const data=await ffmpeg.readFile("probe.json","utf8");
    return readVideoEditProbe(JSON.parse(String(data)));
}

async function readOutput(ffmpeg: FFmpeg, name: string) {
    const data=await ffmpeg.readFile(name);
    if (!(data instanceof Uint8Array) || !data.byteLength) throw new Error("没有生成有效的视频文件，原片未更改");
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return new Blob([copy],{type:"video/mp4"});
}

export async function renderVideoLocalEdit(node: CanvasNodeData, selection: VideoLocalEditSelection, signal: AbortSignal, progress: Progress) {
    const originalKey=node.metadata?.storageKey;
    const originalUrl=node.metadata?.content;
    const source=await readMedia(originalKey,originalUrl,signal);
    return withVideoWorker(signal,progress,async ffmpeg=>{
        await ffmpeg.writeFile("original.mp4",new Uint8Array(await source.arrayBuffer()));
        progress("正在读取原片帧率与音轨…");
        const original=await inspect(ffmpeg,"original.mp4");
        const safeSelection={...selection,keyframes:normalizeVideoEditKeyframes(selection.keyframes,original.duration)};
        const prepared=buildVideoEditPrepareArgs(safeSelection,original);
        if (safeSelection.paintLayer) {
            if (!safeSelection.paintLayer.startsWith("data:image/png;base64,")) throw new Error("画笔图层无效，请重新绘制");
            const layer=await fetch(safeSelection.paintLayer,{signal}).then(response=>response.arrayBuffer());
            await ffmpeg.writeFile("paint.png",new Uint8Array(layer));
        }
        if (prepared.range.generationSeconds>15) throw new Error("当前视频编辑模型最多支持 15 秒，请缩短选段");
        if (original.width%2 || original.height%2) throw new Error("当前局部编辑需要偶数像素的视频宽高，请先调整源视频尺寸");
        progress(`正在按 ${safeSelection.keyframes.length} 个关键帧裁切并转换为 24fps…`);
        if (await ffmpeg.exec(prepared.args)!==0) throw new Error("视频局部预处理失败，原片未更改");
        const inputMeta=await inspect(ffmpeg,"input.mp4");
        if (inputMeta.frames!==prepared.range.frameCount || Math.abs(inputMeta.fps-24)>.001) throw new Error("预处理帧数校验失败，已停止保存");
        const inputBlob=await readOutput(ffmpeg,"input.mp4");
        if (inputBlob.size>200_000_000) throw new Error("局部视频超过当前 200MB 输入上限，请缩短选段或缩小区域");
        signal.throwIfAborted();
        return { source, original, prepared, inputBlob, safeSelection };
    });
}

export async function prepareVideoLocalEdit(node: CanvasNodeData, selection: VideoLocalEditSelection, signal: AbortSignal, progress: Progress): Promise<VideoLocalEditPlan> {
    const prior=node.metadata?.videoLocalEdit;
    const originalKey=node.metadata?.storageKey;
    const { source, original, prepared, inputBlob, safeSelection }=await renderVideoLocalEdit(node,selection,signal,progress);
    signal.throwIfAborted();
    progress("正在保存原片与局部视频…");
    const storedOriginal=originalKey?{storageKey:originalKey}:await uploadMediaFile(new Blob([source],{type:source.type.startsWith("video/")?source.type:"video/mp4"}),"video-local-original");
    const input=await uploadMediaFile(inputBlob,"video-local-input");
    signal.throwIfAborted();
    return {id:nanoid(),selection:safeSelection,range:prepared.range,original,baseStorageKey:storedOriginal.storageKey,restoreOriginal:prior?.restoreOriginal || original,originalStorageKey:prior?.originalStorageKey || storedOriginal.storageKey,inputStorageKey:input.storageKey,inputWidth:prepared.width,inputHeight:prepared.height,currentStorageKey:node.metadata?.storageKey || storedOriginal.storageKey};
}

export async function composeVideoLocalEdit(plan: VideoLocalEditPlan, result: VideoGenerationResult, signal: AbortSignal, progress: Progress) {
    const source=await readMedia(plan.baseStorageKey,undefined,signal);
    const generated=result.blob || await readMedia(undefined,result.url,signal);
    return withVideoWorker(signal,progress,async ffmpeg=>{
        await ffmpeg.writeFile("original.mp4",new Uint8Array(await source.arrayBuffer()));
        await ffmpeg.writeFile("generated.mp4",new Uint8Array(await generated.arrayBuffer()));
        progress("正在校验 24fps 生成结果与额外对齐帧…");
        const generatedMeta=await inspect(ffmpeg,"generated.mp4");
        validateGeneratedEdit(generatedMeta,plan.range.generationSeconds);
        progress(`正在还原 ${plan.original.fps.toFixed(3)}fps 并贴回原画面、保留原音轨…`);
        let code=await ffmpeg.exec(buildVideoEditComposeArgs(plan,generatedMeta));
        if (code!==0 && plan.original.hasAudio) {
            signal.throwIfAborted();
            // MP4 不接收的原音频编码仅转码音轨，不使用生成音轨。
            code=await ffmpeg.exec(buildVideoEditComposeArgs(plan,generatedMeta,false));
        }
        if (code!==0) throw new Error("视频贴回失败，原片未更改，请重试");
        const outputMeta=await inspect(ffmpeg,"output.mp4");
        const tolerance=1/plan.original.fps+.002;
        if (Math.abs(outputMeta.duration-plan.original.duration)>tolerance || Math.abs(outputMeta.frames-plan.original.frames)>1 || outputMeta.hasAudio!==plan.original.hasAudio) throw new Error("贴回后的时长、帧数或音轨校验失败，原片未更改");
        const output=await readOutput(ffmpeg,"output.mp4");
        signal.throwIfAborted();
        progress("校验通过，正在保存视频…");
        const stored=await uploadMediaFile(output,"video-local-result");
        signal.throwIfAborted();
        return stored;
    });
}
