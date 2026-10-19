import dayjs from "dayjs";

import i18n from "@/i18n";
import { fetchAgentJson, interruptCodexTurn } from "@/services/api/canvas-agent";
import { useAgentStore, type AgentPermissionMode, type AgentReasoningEffort } from "@/stores/use-agent-store";
import { acquireAgentClientId } from "@/lib/agent/agent-client-id";
import { codexTextJob, codexTextJobByThread, liveCodexTextJobs, useCodexTextJobStore } from "@/stores/use-codex-text-job-store";
import { attachmentPayloadBytes, compactText } from "@/components/agent/agent-event-formatters";

const MAX_ATTACHMENT_PAYLOAD_BYTES = 28 * 1024 * 1024;

/** 把 Codex 回复写进该线程对应的文本任务。 */
export function pushCodexTextResult(threadId: string, text: string, isDelta: boolean) {
    const job = codexTextJobByThread(threadId);
    if (!job || job.status !== "running" || !text) return;
    if (isDelta) useCodexTextJobStore.getState().appendResultText(job.id, text);
    else useCodexTextJobStore.getState().setResultText(job.id, text);
}

/** 把 Codex 思考摘要写进该线程对应的文本任务，供画布节点实时展示 */
export function pushCodexTextThinking(threadId: string, text: string) {
    const job = codexTextJobByThread(threadId);
    if (!job || !text.trim()) return;
    useCodexTextJobStore.getState().setStatusLog(job.id, text);
}

/** 入队后立刻发送，避免只靠面板订阅时漏触发导致一直停在「已排队」 */
export async function launchQueuedCodexTextJob() {
    const agent = useAgentStore.getState();
    const endpoint = agent.url.trim().replace(/\/$/, "");
    const token = agent.token.trim();
    if (!endpoint || !token || !agent.connected) return;
    const clientId = await acquireAgentClientId();
    const params = { endpoint, token, clientId, permissionMode: agent.permissionMode, model: agent.model, reasoningEffort: agent.reasoningEffort };
    await Promise.all(liveCodexTextJobs().filter((job) => job.status === "queued").map((job) => runQueuedCodexTextJob(job.id, params)));
}

export function collectCodexTextResult(threadId: string, turnId: string) {
    const parts = useAgentStore.getState().messages
        .filter((message) => message.role === "assistant" && (!threadId || message.threadId === threadId) && (!turnId || message.turnId === turnId))
        .map((message) => (message.text || "").trim())
        .filter(Boolean);
    return parts.at(-1) || parts.join("\n\n");
}

/** 发送单个画布文本/智能体任务；每条任务独占一条 Codex 线程，可与其它任务并发。 */
export async function runQueuedCodexTextJob(jobId: string, params: {
    endpoint: string;
    token: string;
    clientId: string;
    permissionMode: AgentPermissionMode;
    model: string;
    reasoningEffort: AgentReasoningEffort | "";
}) {
    const job = codexTextJob(jobId);
    if (!job || job.status !== "queued") return;
    const store = useCodexTextJobStore.getState();
    // 先认领 queued→running，避免节点直发与面板订阅并发各发一次
    const messageId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (!store.markRunning(jobId, messageId)) return;
    if (!useAgentStore.getState().connected) {
        store.fail(i18n.t("canvas.codexText.agentRequired"), jobId);
        return;
    }
    if (attachmentPayloadBytes(job.attachments) > MAX_ATTACHMENT_PAYLOAD_BYTES) {
        store.fail(i18n.t("agent.runtime.imagePayloadTooLarge"), jobId);
        return;
    }
    const userText = (job.messageText || "").trim() || i18n.t("canvas.codexText.taskLabel");
    store.setStatusLog(jobId, i18n.t("canvas.codexText.thinkingSent"));
    useAgentStore.getState().addEventLog({
        id: `${Date.now()}-${Math.random()}`,
        time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
        title: i18n.t("agent.runtime.sendTask"),
        text: `Codex Text${job.skill ? ` · Skill ${job.skill.name}` : ""} · ${compactText(job.prompt)}`,
    });
    try {
        const accepted = await fetchAgentJson<{ ok?: boolean; threadId?: string }>(params.endpoint, params.token, "/agent/codex/node-turn", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                prompt: job.prompt,
                messageText: userText,
                messageId,
                ...(job.resumeThreadId ? { resumeThreadId: job.resumeThreadId } : {}),
                clientId: params.clientId,
                permissionMode: job.permissionMode || params.permissionMode,
                model: params.model,
                effort: params.reasoningEffort,
                ...(job.skill ? { skill: job.skill } : {}),
                attachments: job.attachments.map(({ id, name, type, size, width, height, dataUrl }) => ({ id, name, type, size, width, height, dataUrl })),
            }),
        });
        if (!accepted.threadId) throw new Error(i18n.t("agent.runtime.startConversationFailed"));
        if (codexTextJob(jobId)?.status !== "running") {
            await interruptCodexTurn(params.endpoint, params.token, accepted.threadId);
            return;
        }
        useCodexTextJobStore.getState().setScope(jobId, { threadId: accepted.threadId });
    } catch (error) {
        const text = error instanceof Error ? error.message : i18n.t("agent.runtime.sendFailed");
        useCodexTextJobStore.getState().fail(text, jobId);
        useAgentStore.getState().addEventLog({
            id: `${Date.now()}-${Math.random()}`,
            time: dayjs().format("YYYY-MM-DD HH:mm:ss"),
            title: i18n.t("agent.runtime.sendFailed"),
            text,
            raw: error,
        });
    }
}
