import type { AgentPermissionMode } from "@/stores/use-agent-store";
import { create } from "zustand";

import i18n from "@/i18n";
import { randomId } from "@/lib/utils";
import type { AgentAttachment } from "@/stores/use-agent-store";
import { CODEX_CHANNEL_ID, CODEX_CLI_MODEL_NAME, CODEX_TEXT_MODEL_VALUE, isCodexCliTextModel } from "@/stores/use-config-store";

export { CODEX_CHANNEL_ID, CODEX_CLI_MODEL_NAME, CODEX_TEXT_MODEL_VALUE, isCodexCliTextModel };

export type CodexTextJobRequest = {
    id: string;
    /** 画布配置/文本节点 id，便于事件日志溯源 */
    sourceNodeId: string;
    /** 本任务独占的 Codex 线程；可继续同一任务，节点之间不共享上下文 */
    threadId: string;
    /** 继续修改时恢复本节点的上轮线程；新任务不传。 */
    resumeThreadId?: string;
    turnId: string;
    prompt: string;
    /** 对话气泡展示文案；缺省回退到 taskLabel */
    messageText?: string;
    attachments: AgentAttachment[];
    /** 画布上游 Skill 节点注入；发给 /agent/codex/turn */
    skill?: { name: string; path: string };
    /** 本任务覆盖全局权限（如智能体联网执行） */
    permissionMode?: AgentPermissionMode;
    status: "queued" | "running" | "done" | "error";
    statusLog: string;
    resultText: string;
    error?: string;
    messageId?: string;
};

type CodexTextJobStore = {
    /** 并发任务列表；每个节点一次运行一条，互不干扰 */
    jobs: CodexTextJobRequest[];
    queue: (input: Omit<CodexTextJobRequest, "id" | "threadId" | "turnId" | "status" | "statusLog" | "resultText" | "error" | "messageId">) => string;
    /** 仅当仍为 queued 时认领成功；用于防止节点直发 + 面板订阅双触发 */
    markRunning: (id: string, messageId: string) => boolean;
    /** 记录任务所属 Codex 线程与 turn，事件按此归属 */
    setScope: (id: string, patch: { threadId?: string; turnId?: string }) => void;
    setStatusLog: (id: string, text: string) => void;
    appendStatusLog: (id: string, chunk: string) => void;
    setResultText: (id: string, text: string) => void;
    appendResultText: (id: string, chunk: string) => void;
    succeed: (id: string, text: string) => void;
    fail: (error: string, id: string) => void;
    clear: (id?: string) => void;
};

function isCodexTextJobLive(status: CodexTextJobRequest["status"]) {
    return status === "queued" || status === "running";
}

/** 按 id 读取任务。 */
export function codexTextJob(id: string): CodexTextJobRequest | null {
    return useCodexTextJobStore.getState().jobs.find((job) => job.id === id) || null;
}

/** 按 Codex 线程读取运行中的任务，用于把 SSE 事件归属到发起它的节点。 */
export function codexTextJobByThread(threadId: string): CodexTextJobRequest | null {
    if (!threadId) return null;
    return useCodexTextJobStore.getState().jobs.find((job) => job.threadId === threadId && isCodexTextJobLive(job.status)) || null;
}

/** 当前排队或运行中的全部任务。 */
export function liveCodexTextJobs(): CodexTextJobRequest[] {
    return useCodexTextJobStore.getState().jobs.filter((job) => isCodexTextJobLive(job.status));
}

export function buildCodexTextSystemPrompt(input: { sourceNodeId: string; userPrompt: string; hasReferences: boolean }) {
    return [
        "【系统设定 · Infinite Canvas Codex 文本生成】",
        `你被绑定到画布文本生成任务（sourceNodeId=${input.sourceNodeId}）。`,
        "本任务唯一目标：根据用户提示词生成文本结果。",
        input.hasReferences ? "若有参考图附件，请结合图片内容理解任务（例如反推提示词、描述画面）。" : "当前无参考图，仅根据文本提示完成。",
        "禁止：调用 image_gen / 生图、修改仓库、画布 MCP 写入、网页搜索、执行无关命令。",
        "输出要求：直接给出最终文本正文；不要解释过程；不要输出 COUNT / SAVED / NONE 等协议行；不要包代码围栏，除非用户明确要求代码。",
        "用户提示词：",
        input.userPrompt.trim(),
    ].join("\n");
}

export function waitForCodexTextJob(id: string, options?: { signal?: AbortSignal; onDelta?: (text: string) => void; timeoutMs?: number }) {
    return new Promise<string>((resolve, reject) => {
        const onAbort = () => {
            unsub();
            reject(new DOMException("Aborted", "AbortError"));
        };
        if (options?.signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        options?.signal?.addEventListener("abort", onAbort, { once: true });
        if (options?.timeoutMs) {
            window.setTimeout(() => {
                unsub();
                reject(new Error(i18n.t("canvas.codexText.timeout")));
            }, options.timeoutMs);
        }
        const unsub = useCodexTextJobStore.subscribe((state) => {
            const job = state.jobs.find((item) => item.id === id);
            if (!job) return;
            if (job.resultText) options?.onDelta?.(job.resultText);
            if (job.status === "done") {
                options?.signal?.removeEventListener("abort", onAbort);
                unsub();
                resolve(job.resultText.trim());
                return;
            }
            if (job.status === "error") {
                options?.signal?.removeEventListener("abort", onAbort);
                unsub();
                reject(new Error(job.error || "Codex text generation failed"));
            }
        });
    });
}

export const useCodexTextJobStore = create<CodexTextJobStore>((set, get) => {
    /** 只改动目标任务，其余任务对象保持同一引用，避免无关节点重渲染。 */
    const update = (id: string, patch: (job: CodexTextJobRequest) => Partial<CodexTextJobRequest> | null, liveOnly = true) => {
        const jobs = get().jobs;
        const current = jobs.find((job) => job.id === id);
        if (!current || (liveOnly && !isCodexTextJobLive(current.status))) return false;
        const value = patch(current);
        if (!value) return false;
        set({ jobs: jobs.map((job) => job.id === id ? { ...job, ...value } : job) });
        return true;
    };
    return {
        jobs: [],
        queue: (input) => {
            const id = randomId();
            const job: CodexTextJobRequest = { ...input, id, threadId: "", turnId: "", status: "queued", statusLog: "", resultText: "" };
            // 同一节点只保留最新一条任务，避免节点匹配到上一轮的残留
            set({ jobs: [...get().jobs.filter((item) => item.sourceNodeId !== job.sourceNodeId).slice(-16), job] });
            return id;
        },
        markRunning: (id, messageId) => {
            const current = codexTextJob(id);
            if (!current || current.status !== "queued") return false;
            return update(id, () => ({ status: "running", messageId }));
        },
        setScope: (id, patch) => void update(id, () => patch),
        setStatusLog: (id, text) => void update(id, () => ({ statusLog: text.slice(-8000) })),
        appendStatusLog: (id, chunk) => {
            const line = chunk.trim();
            if (!line) return;
            update(id, (job) => job.statusLog.includes(line)
                ? null
                : { statusLog: `${job.statusLog}${job.statusLog ? "\n" : ""}${line}`.slice(-8000) });
        },
        setResultText: (id, text) => void update(id, (job) => job.status === "running" ? { resultText: text } : null),
        appendResultText: (id, chunk) => void update(id, (job) => job.status === "running" && chunk ? { resultText: `${job.resultText}${chunk}` } : null),
        succeed: (id, text) => void update(id, () => ({ status: "done", resultText: text, error: undefined }), false),
        fail: (error, id) => void update(id, () => ({ status: "error", error }), false),
        clear: (id) => set({ jobs: id ? get().jobs.filter((job) => job.id !== id) : [] }),
    };
});
