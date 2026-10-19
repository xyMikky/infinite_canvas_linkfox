import { create } from "zustand";

import type { AgentAttachment } from "@/stores/use-agent-store";

export const CODEX_IMAGE_NODE_TYPE = "codex-image";

export type CodexImageJobRequest = {
    id: string;
    nodeId: string;
    /** 本任务独占的 Codex 线程；每次运行新建，节点之间不共享上下文 */
    threadId: string;
    turnId: string;
    prompt: string;
    size: string;
    quality: string;
    /** 0 / 未指定 = auto（由对话判断张数）；1–4 = 强制张数 */
    count: number;
    /** 实际预期张数；0 = auto 尚未由 Codex 判定 */
    expectedCount: number;
    /** 「生成中」占位图片节点 id（auto 时在 Codex 报 COUNT 后再创建） */
    placeholderNodeIds: string[];
    attachments: AgentAttachment[];
    /** 画布上游 Skill 节点注入；发给 /agent/codex/turn */
    skill?: { name: string; path: string };
    status: "queued" | "running" | "done" | "error";
    /** 本地进度（排队/发送/等待），不是 Codex 思考 */
    statusLog: string;
    /** 来自 Codex 事件的真实输出：reasoning / 助手回复 / revisedPrompt 等 */
    cliLog: string;
    /** 兼容旧字段：status + cli 合并展示 */
    thinking: string;
    /** 已导入的图片指纹（路径 / 尺寸哈希），防止 path+base64 或并发事件重复落节点 */
    importedKeys: string[];
    importedCount: number;
    error?: string;
    messageId?: string;
};

type CodexImageJobStore = {
    /** 并发任务列表；每个节点一次运行一条，互不干扰 */
    jobs: CodexImageJobRequest[];
    queue: (input: Omit<CodexImageJobRequest, "id" | "threadId" | "turnId" | "status" | "statusLog" | "cliLog" | "thinking" | "importedKeys" | "importedCount" | "error" | "messageId">) => string;
    markRunning: (id: string, messageId: string) => boolean;
    /** 记录任务所属 Codex 线程与 turn，事件按此归属 */
    setScope: (id: string, patch: { threadId?: string; turnId?: string }) => void;
    setStatusLog: (id: string, text: string) => void;
    appendStatusLog: (id: string, chunk: string) => void;
    appendCliLog: (id: string, chunk: string) => void;
    setCliLog: (id: string, text: string) => void;
    /** 登记已导入指纹；返回本次新写入的 key 数量 */
    markImported: (id: string, keys: string[]) => number;
    /** 写入 Codex 判定后的占位节点 */
    setPlaceholders: (id: string, ids: string[], expectedCount: number) => void;
    succeed: (id: string) => void;
    fail: (error: string, id: string) => void;
    clear: (id?: string) => void;
};

function isCodexJobLive(status: CodexImageJobRequest["status"]) {
    return status === "queued" || status === "running";
}

/** 按 id 读取任务。 */
export function codexImageJob(id: string): CodexImageJobRequest | null {
    return useCodexImageJobStore.getState().jobs.find((job) => job.id === id) || null;
}

/** 按 Codex 线程读取运行中的任务，用于把 SSE 事件归属到发起它的节点。 */
export function codexImageJobByThread(threadId: string): CodexImageJobRequest | null {
    if (!threadId) return null;
    return useCodexImageJobStore.getState().jobs.find((job) => job.threadId === threadId && isCodexJobLive(job.status)) || null;
}

/** 当前排队或运行中的全部任务。 */
export function liveCodexImageJobs(): CodexImageJobRequest[] {
    return useCodexImageJobStore.getState().jobs.filter((job) => isCodexJobLive(job.status));
}

function mergeThinking(statusLog: string, cliLog: string) {
    const status = statusLog.trim();
    const cli = cliLog.trim();
    if (status && cli) return `${status}\n\n── Codex 输出 ──\n${cli}`;
    if (cli) return `── Codex 输出 ──\n${cli}`;
    return status;
}

function patchJob(current: CodexImageJobRequest, patch: Partial<CodexImageJobRequest>): CodexImageJobRequest {
    const next = { ...current, ...patch };
    next.thinking = mergeThinking(next.statusLog, next.cliLog);
    return next;
}

const CN_NUM: Record<string, number> = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** 强制 count≥1 时返回固定张数；auto 返回 0（尚未由 Codex 声明）。 */
export function resolveExpectedCodexCount(userPrompt: string, countSetting: number) {
    if (countSetting >= 1) return Math.min(4, Math.floor(countSetting));
    return 0;
}

/** 从 Codex 输出解析其声明的张数（COUNT: N）。 */
export function parseCodexDeclaredCount(text: string): number | null {
    const raw = text.trim();
    if (!raw) return null;
    const patterns = [
        /\bCOUNT\s*[:：]\s*(\d+)\b/i,
        /(?:将|会|需|要|准备)?生成\s*(\d+)\s*张/,
        /共\s*(\d+)\s*张/,
        /([一二两三四五])\s*张(?:独立|结果|图)?/,
    ];
    for (const pattern of patterns) {
        const match = raw.match(pattern);
        if (!match) continue;
        const token = match[1];
        const n = CN_NUM[token] || Number(token);
        if (!Number.isFinite(n) || n < 1) continue;
        return Math.min(4, Math.floor(n));
    }
    return null;
}

export function buildCodexImageSystemPrompt(input: { nodeId: string; size: string; count: number; expectedCount?: number; userPrompt: string; hasReferences: boolean }) {
    const mode = input.hasReferences ? "图生图（基于附件参考图编辑/再生成）" : "文生图";
    const autoCount = !input.count || input.count < 1;
    const forced = !autoCount ? Math.min(4, Math.max(1, input.count)) : 0;
    const countLine = autoCount
        ? [
            "张数：auto（由你根据用户意图判断需要几张独立结果图，1–4）。",
            "重要：在调用 image_gen 之前，先用 2–4 句中文说明判断（张数依据、每张差异/色调/角度），然后再单独输出一行：",
            "COUNT: N",
            "其中 N 为你判定的张数。例如用户要红/黑/原色三版 → COUNT: 3。",
            "随后生成正好 N 张独立结果图；不要拼贴对比图，除非用户明确要求对比图/拼图。",
            "画布会在收到 COUNT 后再创建「生成中」占位节点，请勿假设占位已存在。",
        ].join("\n")
        : `张数：强制 ${forced} 张独立结果图（画布已预创建占位节点）。请先用 2–4 句中文说明每张图的差异，再生成正好 ${forced} 张。`;
    return [
        "【系统设定 · Infinite Canvas Codex 生图节点】",
        `你被绑定到画布专用节点「Codex CLI 生图」（nodeId=${input.nodeId}）。`,
        "本节点唯一任务：使用 Codex 内置 image_gen / $imagegen 生成图片，模型固定为 gpt-image-2。",
        `当前模式：${mode}。`,
        "禁止：写代码、修改仓库文件、网页搜索、调用画布 LinkFox/其它 API 生图渠道、创建无关节点或执行与生图无关的操作。",
        "必须：使用内置 image_gen（gpt-image-2）；不要改用其他模型。",
        // 内置 image_gen 无 quality 工具参数；质量仅 CLI 回退路径可控，故不在此伪造
        `生成参数：size=${input.size || "auto"}（提示偏好）；count=${autoCount ? "由 COUNT 行决定" : forced}。`,
        countLine,
        "生成完成后，回复的最后必须逐行给出每张图的本机绝对路径，格式固定为：",
        "SAVED: <绝对路径>",
        "路径通常位于 ~/.codex/generated_images/<会话ID>/ 下。若工具没有返回落盘路径，请用最小命令找到最新生成的图片文件并给出其绝对路径；确实没有文件时输出 SAVED: NONE。",
        "除 COUNT / SAVED 与上述 2–4 句判断说明外，不要长篇闲聊。",
        "---",
        "用户提示词：",
        input.userPrompt.trim(),
    ].join("\n");
}

export const useCodexImageJobStore = create<CodexImageJobStore>((set, get) => {
    /** 只改动目标任务，其余任务对象保持同一引用，避免无关节点重渲染。 */
    const update = (id: string, patch: (job: CodexImageJobRequest) => Partial<CodexImageJobRequest> | null, liveOnly = true) => {
        const jobs = get().jobs;
        const current = jobs.find((job) => job.id === id);
        if (!current || (liveOnly && !isCodexJobLive(current.status))) return null;
        const value = patch(current);
        if (!value) return null;
        const next = patchJob(current, value);
        set({ jobs: jobs.map((job) => job.id === id ? next : job) });
        return next;
    };
    return {
        jobs: [],
        queue: (input) => {
            const id = `codex-job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const job: CodexImageJobRequest = {
                ...input,
                id,
                threadId: "",
                turnId: "",
                expectedCount: Math.min(4, Math.max(0, input.expectedCount || 0)),
                placeholderNodeIds: input.placeholderNodeIds || [],
                status: "queued",
                statusLog: "",
                cliLog: "",
                thinking: "",
                importedKeys: [],
                importedCount: 0,
            };
            // 同一节点只保留最新一条任务，避免节点匹配到上一轮的残留
            set({ jobs: [...get().jobs.filter((item) => item.nodeId !== job.nodeId).slice(-16), job] });
            return id;
        },
        markRunning: (id, messageId) => {
            const current = codexImageJob(id);
            if (!current || current.status !== "queued") return false;
            return Boolean(update(id, () => ({ status: "running", messageId })));
        },
        setScope: (id, patch) => void update(id, () => patch),
        setPlaceholders: (id, placeholderNodeIds, expectedCount) => {
            const n = Math.min(4, Math.max(1, expectedCount));
            // 已有占位则只抬高 expectedCount，不覆盖 id
            update(id, (job) => job.placeholderNodeIds.length
                ? (n > job.expectedCount ? { expectedCount: n } : null)
                : { placeholderNodeIds, expectedCount: n });
        },
        markImported: (id, keys) => {
            const current = codexImageJob(id);
            if (!current || !isCodexJobLive(current.status)) return 0;
            const seen = new Set(current.importedKeys);
            const fresh = keys.map((key) => key.trim()).filter((key) => key && !seen.has(key));
            if (!fresh.length) return 0;
            fresh.forEach((key) => seen.add(key));
            update(id, (job) => ({ importedKeys: Array.from(seen).slice(-64), importedCount: job.importedCount + fresh.length }));
            return fresh.length;
        },
        setStatusLog: (id, text) => void update(id, () => ({ statusLog: text.slice(-8000) })),
        appendStatusLog: (id, chunk) => {
            const line = chunk.trim();
            if (!line) return;
            update(id, (job) => job.status !== "running" || job.statusLog.includes(line)
                ? null
                : { statusLog: `${job.statusLog}${job.statusLog ? "\n" : ""}${line}`.slice(-8000) });
        },
        appendCliLog: (id, chunk) => {
            if (!chunk) return;
            const piece = chunk.replace(/\r\n/g, "\n");
            const trimmed = piece.trim();
            if (!trimmed) return;
            update(id, (job) => {
                if (trimmed.length > 20) {
                    if (job.cliLog.includes(trimmed)) return null;
                    if (trimmed.includes(job.cliLog.trim()) && job.cliLog.trim()) return { cliLog: trimmed.slice(-16000) };
                }
                if (job.cliLog.endsWith(piece) || job.cliLog.endsWith(trimmed)) return null;
                const next = job.cliLog && !job.cliLog.endsWith("\n") && !piece.startsWith("\n")
                    ? `${job.cliLog}\n${piece}`
                    : `${job.cliLog}${piece}`;
                return { cliLog: next.slice(-16000) };
            });
        },
        setCliLog: (id, text) => void update(id, () => ({ cliLog: text.slice(-16000) })),
        succeed: (id) => void update(id, () => ({ status: "done" }), false),
        fail: (error, id) => void update(id, () => ({ status: "error", error }), false),
        clear: (id) => set({ jobs: id ? get().jobs.filter((job) => job.id !== id) : [] }),
    };
});
