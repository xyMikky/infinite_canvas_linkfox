/** 时间均为原视频绝对秒；矩形为归一化坐标。 */
export type VideoEditKeyframe = { time: number; x: number; y: number; width: number; height: number };
export type VideoLocalEditSelection = { start: number; end: number; keyframes: VideoEditKeyframe[]; paintLayer?: string; aspectPreset?: string };
export type VideoEditProbe = { width: number; height: number; duration: number; fps: number; frameRate: string; frames: number; hasAudio: boolean; pixelFormat?: string; sampleAspectRatio?: string; colorTransfer?: string };
export type VideoLocalEditPlan = {
    id: string;
    selection: VideoLocalEditSelection;
    range: ReturnType<typeof expandVideoEditRange>;
    original: VideoEditProbe;
    /** 当前这轮的底片；再次框选以已完成的视频为底片，不回滚区域外的旧修改。 */
    baseStorageKey: string;
    restoreOriginal: VideoEditProbe;
    originalStorageKey: string;
    originalUrl?: string;
    inputStorageKey: string;
    inputUrl?: string;
    inputWidth: number;
    inputHeight: number;
    /** 只有当前片仍是这份媒体时，才允许生成结果写回。 */
    currentStorageKey: string;
};

export function expandVideoEditRange(start: number, end: number, duration: number) {
    if (![start, end, duration].every(Number.isFinite) || duration <= 0 || start < 0 || end <= start || start >= duration) throw new Error("请选择有效的视频时间区间");
    const clampedEnd = Math.min(duration, end);
    const selectedSeconds = clampedEnd - start;
    const wholeSeconds = Math.round(selectedSeconds);
    // 整数约束针对时长：1.3–4.3 本身是 3 秒，不再把两个端点分别取整。
    const keepRange = wholeSeconds > 0 && Math.abs(selectedSeconds - wholeSeconds) < 1e-8;
    const expandedStart = keepRange ? start : Math.floor(start);
    const expandedEnd = keepRange ? clampedEnd : Math.min(duration, Math.ceil(end));
    const seconds = expandedEnd - expandedStart;
    // 局部编辑统一至少 3 秒；冻结尾帧补齐，不扩大实际替换区间。
    const generationSeconds = Math.max(3, Math.ceil(seconds - 1e-8));
    return { start: expandedStart, end: expandedEnd, duration: seconds, generationSeconds, frameCount: generationSeconds * 24 };
}

export function normalizeVideoEditKeyframes(keyframes: VideoEditKeyframe[], duration: number) {
    if (!keyframes.length || keyframes.length > 32) throw new Error("请设置 1–32 个选区关键帧");
    const sorted = keyframes.map(key => {
        if (![key.time, key.x, key.y, key.width, key.height].every(Number.isFinite) || key.time < 0 || key.time > duration + .001 || key.x < 0 || key.y < 0 || key.width < .01 || key.height < .01 || key.x + key.width > 1.00001 || key.y + key.height > 1.00001) throw new Error("关键帧选区超出视频范围，请重新框选");
        return { ...key };
    }).sort((a,b) => a.time-b.time);
    if (sorted.some((key, i) => i > 0 && key.time - sorted[i-1].time < .0001)) throw new Error("同一时间只能保留一个关键帧");
    return sorted;
}

export function interpolateVideoEditRect(keys: VideoEditKeyframe[], time: number) {
    const sorted = [...keys].sort((a,b) => a.time-b.time);
    if (!sorted.length) return { x: .2, y: .2, width: .6, height: .6 };
    let left = sorted[0], right = sorted[sorted.length-1];
    if (time <= left.time) right = left;
    else if (time >= right.time) left = right;
    else for (let i=1; i<sorted.length; i++) if (time <= sorted[i].time) { left=sorted[i-1]; right=sorted[i]; break; }
    const k = right.time === left.time ? 0 : Math.max(0, Math.min(1, (time-left.time)/(right.time-left.time)));
    return { x:left.x+(right.x-left.x)*k, y:left.y+(right.y-left.y)*k, width:left.width+(right.width-left.width)*k, height:left.height+(right.height-left.height)*k };
}

const decimal = (n: number) => Number(n.toFixed(8)).toString();
const firstFrameAt = (seconds: number, fps: number) => Math.ceil(seconds * fps - 1e-8);
function rectExpressions(keys: VideoEditKeyframe[], clock: string) {
    const expression = (field: "x" | "y" | "width" | "height") => {
        if (keys.every(key => key[field] === keys[0][field])) return decimal(keys[0][field]);
        let tail = decimal(keys[keys.length-1][field]);
        for (let i=keys.length-2; i>=0; i--) {
            const a=keys[i], b=keys[i+1];
            const lerp = `${decimal(a[field])}+(${decimal(b[field]-a[field])})*(${clock}-${decimal(a.time)})/${decimal(b.time-a.time)}`;
            tail = `if(lt(${clock},${decimal(b.time)}),${lerp},${tail})`;
        }
        return `(if(lte(${clock},${decimal(keys[0].time)}),${decimal(keys[0][field])},${tail}))`;
    };
    return { x:expression("x"), y:expression("y"), width:expression("width"), height:expression("height") };
}

export function readVideoEditProbe(data: { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> }): VideoEditProbe {
    const stream = data.streams?.find(s => s.codec_type === "video");
    const frameRate = String(stream?.avg_frame_rate || stream?.r_frame_rate || "0/1");
    const [numerator, denominator = 1] = frameRate.split("/").map(Number);
    const fps = numerator / denominator;
    const sideData = stream?.side_data_list as Array<{ rotation?: number }> | undefined;
    const rotation=Number(sideData?.find(item=>item.rotation!==undefined)?.rotation || (stream?.tags as Record<string,unknown> | undefined)?.rotate || 0);
    const rotated=Math.abs(rotation)%180===90;
    const width=Number(rotated?stream?.height:stream?.width), height=Number(rotated?stream?.width:stream?.height);
    const frames=Number(stream?.nb_read_frames || stream?.nb_frames);
    // 不同 FFmpeg 的容器时长可能包含起始偏移；按音视频轨的实际跨度统一编辑时间轴。
    const timelineStart=Number(data.format?.start_time) || 0;
    const spans=data.streams?.filter(s=>s.codec_type==="video" || s.codec_type==="audio").map(s=> {
        const length=Number(s.duration), start=Number(s.start_time);
        return Number.isFinite(length) && length>0 ? length+(Number.isFinite(start)?start:timelineStart)-timelineStart : 0;
    }) || [];
    const duration=Math.max(0,...spans) || Number(data.format?.duration);
    const sar=String(stream?.sample_aspect_ratio || "");
    const [sarWidth,sarHeight]=sar.split(":").map(Number);
    // 只归一化不改变整数显示宽度的舍入误差，真正的非方形像素仍由预处理拒绝。
    const sampleAspectRatio=sarWidth>0 && sarHeight>0 && Math.round(Number(stream?.width)*sarWidth/sarHeight)===Number(stream?.width) ? "1:1" : sar;
    if (![width,height,frames,duration,fps].every(n => Number.isFinite(n) && n>0)) throw new Error("无法读取视频的完整帧率与时长信息，请更换有效的视频文件");
    if (Number(stream?.nb_frames)>frames) throw new Error("视频包含无法解码的帧，已停止处理，原片未更改");
    if (rotation%90!==0) throw new Error("当前视频旋转角度无法安全贴回，请先将原视频旋转导出后重试");
    return { width, height, frames, duration, fps, frameRate, hasAudio: Boolean(data.streams?.some(s => s.codec_type === "audio")), pixelFormat:String(stream?.pix_fmt || ""), sampleAspectRatio, colorTransfer:String(stream?.color_transfer || "") };
}

export function validateGeneratedEdit(video: Pick<VideoEditProbe, "fps" | "frames">, seconds: number) {
    if (Math.abs(video.fps-24)>.001) throw new Error("生成结果不是 24fps，已停止贴回，原片保持不变");
    const expected=seconds*24;
    if (video.frames !== expected && video.frames !== expected+1) throw new Error(`生成结果帧数不匹配：需要 ${expected} 或 ${expected+1} 帧，实际 ${video.frames} 帧。原片保持不变`);
    return video.frames === expected+1 ? 1 : 0;
}

/** geq 连续采样整个矩形，允许关键帧同时修改位置和大小，无须散帧文件。 */
export function buildVideoEditPrepareArgs(selection: VideoLocalEditSelection, source: VideoEditProbe) {
    if (source.pixelFormat && source.pixelFormat!=="yuv420p" || ["smpte2084","arib-std-b67"].includes(source.colorTransfer || "")) throw new Error("当前局部编辑支持 8 位 4:2:0 SDR 视频；为避免改变原片画质，暂不处理其他像素格式或 HDR 视频");
    if (source.sampleAspectRatio && !["1:1","0:1","N/A"].includes(source.sampleAspectRatio)) throw new Error("当前局部编辑需要方形像素视频，请先按显示比例导出源视频后重试");
    const range=expandVideoEditRange(selection.start,selection.end,source.duration);
    const keys=normalizeVideoEditKeyframes(selection.keyframes,source.duration);
    const frameStart=firstFrameAt(range.start,source.fps)/source.fps;
    const rect=rectExpressions(keys, `(T+${decimal(frameStart)})`);
    const rawWidth=Math.max(...keys.map(k=>k.width))*source.width;
    const rawHeight=Math.max(...keys.map(k=>k.height))*source.height;
    if (Math.max(rawWidth/rawHeight,rawHeight/rawWidth)>3) throw new Error("选区过于狭长，当前视频编辑模型要求宽高比在 1:3 至 3:1 之间，请扩大较短的一边");
    const scale=Math.max(720/Math.min(rawWidth,rawHeight),Math.min(1,2160/Math.max(rawWidth,rawHeight)));
    const width=Math.max(720,Math.min(2160,Math.ceil(rawWidth*scale/2)*2));
    const height=Math.max(720,Math.min(2160,Math.ceil(rawHeight*scale/2)*2));
    const planes=["lum","cb","cr"].map(plane=>`${plane}='${plane}((${rect.x})*W+X*${rect.width},(${rect.y})*H+Y*${rect.height})'`).join(":");
    const filter=`trim=start=${range.start}:end=${range.end},setpts=PTS-STARTPTS,fps=24,format=yuv420p,geq=${planes},scale=${width}:${height}:flags=lanczos,setsar=1,tpad=stop_mode=clone:stop_duration=3,trim=end_frame=${range.frameCount},setpts=N/(24*TB)`;
    const filters=selection.paintLayer ? ["-i","paint.png","-filter_complex",`[0:v]${filter}[crop];[1:v]scale=${width}:${height}[paint];[crop][paint]overlay=0:0:eof_action=repeat:format=auto,format=yuv420p[out]`,"-map","[out]"] : ["-vf",filter];
    return { range, width, height, args:["-i","original.mp4",...filters,"-an","-c:v","libx264","-preset","ultrafast","-crf","16","-pix_fmt","yuv420p","-movflags","+faststart","input.mp4"] };
}

/** 先去掉额外切入帧，再恢复原帧率；原片做主时钟，只在指定时空区域取新画面。 */
export function buildVideoEditComposeArgs(plan: VideoLocalEditPlan, generated: VideoEditProbe, copyAudio = true) {
    const drop=validateGeneratedEdit(generated,plan.range.generationSeconds);
    const { original: source, range }=plan;
    // tpad 的秒数会就近舍入；小数起点必须取区间内第一帧，避免额外跳过有效首帧。
    const startFrame=firstFrameAt(range.start,source.fps);
    const rect=rectExpressions(normalizeVideoEditKeyframes(plan.selection.keyframes,source.duration),`(T+${decimal(startFrame/source.fps)})`);
    const inverse=["lum","cb","cr"].map(plane=>`${plane}='${plane}((X-${rect.x}*W)/${rect.width},(Y-${rect.y}*H)/${rect.height})'`).join(":");
    const globalRect=rectExpressions(plan.selection.keyframes,"T");
    const mask=`gte(T,${range.start})*lt(T,${range.end})*gte(X,${globalRect.x}*W)*lt(X,(${globalRect.x}+${globalRect.width})*W)*gte(Y,${globalRect.y}*H)*lt(Y,(${globalRect.y}+${globalRect.height})*H)`;
    let graph=[
        `[0:v]setpts=PTS-STARTPTS,format=yuv420p,setsar=1[original]`,
        `[1:v]trim=start_frame=${drop}:end_frame=${drop+range.frameCount},setpts=N/(24*TB),fps=${source.frameRate},trim=duration=${range.duration},scale=${source.width}:${source.height}:flags=lanczos,format=yuv420p,geq=${inverse},setsar=1,tpad=start_mode=clone:start=${startFrame}:stop_mode=clone:stop_duration=${source.duration}[patch]`,
        `[original][patch]blend=all_expr='if(${mask},B,A)':shortest=1[out]`,
    ].join(";");
    const first=plan.selection.keyframes[0];
    const pixels=[first.x*source.width,first.y*source.height,first.width*source.width,first.height*source.height];
    // 对齐 4:2:0 像素边界的静止选区可直接缩放叠加，免去全画面逐像素逆映射。
    if (plan.selection.keyframes.every(key=>key.x===first.x && key.y===first.y && key.width===first.width && key.height===first.height)
        && pixels.every(value=>Math.abs(value-Math.round(value/2)*2)<1e-8) && pixels[2]>=2 && pixels[3]>=2) {
        const [x,y,width,height]=pixels.map(Math.round);
        graph=[
            `[0:v]setpts=PTS-STARTPTS,format=yuv420p,setsar=1[original]`,
            `[1:v]trim=start_frame=${drop}:end_frame=${drop+range.frameCount},setpts=N/(24*TB),fps=${source.frameRate},trim=duration=${range.duration},scale=${width}:${height}:flags=lanczos,format=yuv420p,setsar=1,tpad=start_mode=clone:start=${startFrame}:stop_mode=clone:stop_duration=${source.duration}[patch]`,
            `[original][patch]overlay=x=${x}:y=${y}:enable='gte(t,${range.start})*lt(t,${range.end})':eof_action=pass:shortest=1[out]`,
        ].join(";");
    }
    return ["-i","original.mp4","-i","generated.mp4","-filter_complex",graph,"-map","[out]","-map","0:a?","-c:v","libx264","-preset","ultrafast","-crf","0","-pix_fmt","yuv420p","-fps_mode","passthrough","-c:a",copyAudio?"copy":"aac","-t",decimal(source.duration),"-movflags","+faststart","output.mp4"];
}
