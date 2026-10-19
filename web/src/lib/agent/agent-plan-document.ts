import type { AgentChatItem } from "@/stores/use-agent-store";

export type AgentPlanAnswer = { question: string; answer: string };
export type AgentPlanDocument = {
    id: string;
    threadId: string;
    turnId: string;
    title: string;
    markdown: string;
    answers: AgentPlanAnswer[];
    collapsed: boolean;
    width: number;
    executed: boolean;
};

export const AGENT_PLAN_CAPTURE_ID = "agent-plan-document";
export const AGENT_PLAN_DEFAULT_WIDTH = 460;
export const AGENT_PLAN_COLLAPSED_WIDTH = 0;
const PLAN_WIDTH_MIN = 320;
const PLAN_WIDTH_MAX = 640;

export function clampPlanDocumentWidth(width: number) {
    return Math.min(PLAN_WIDTH_MAX, Math.max(PLAN_WIDTH_MIN, Math.round(width)));
}

export function planDocumentPreviewSource(doc: AgentPlanDocument) {
    if (doc.markdown.trim()) return doc.markdown;
    if (!doc.answers.length) return "";
    return [
        `# ${doc.title || "规划书"}`,
        "## 已确认需求",
        ...doc.answers.map(({ question, answer }) => [`### ${question || "补充说明"}`, answer].join("\n\n")),
    ].join("\n\n");
}

export function userInputAnswersFromMessages(messages: AgentChatItem[]): AgentPlanAnswer[] {
    const answers: AgentPlanAnswer[] = [];
    for (const item of messages) {
        const detail = item.detail && typeof item.detail === "object" ? item.detail as { kind?: unknown; entries?: unknown } : null;
        if (detail?.kind !== "userInput" || !Array.isArray(detail.entries)) continue;
        for (const entry of detail.entries) {
            if (!entry || typeof entry !== "object") continue;
            const row = entry as { question?: unknown; answer?: unknown };
            const question = String(row.question || "").trim();
            const answer = String(row.answer || "").trim();
            if (question || answer) answers.push({ question, answer });
        }
    }
    return answers;
}

export function latestAssistantMarkdown(messages: AgentChatItem[]) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const item = messages[index];
        if (item.role !== "assistant") continue;
        const text = item.text.trim();
        if (text) return text;
    }
    return "";
}

export function planItemMarkdown(messages: AgentChatItem[]) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const item = messages[index];
        const kind = item.detail && typeof item.detail === "object" ? (item.detail as { kind?: unknown }).kind : undefined;
        if (kind !== "plan") continue;
        const text = item.text.trim();
        if (text) return text;
    }
    return "";
}

export function todoPlanMarkdown(messages: AgentChatItem[], turnId?: string) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const item = messages[index];
        const detail = item.detail && typeof item.detail === "object" ? item.detail as { kind?: unknown; explanation?: unknown; tasks?: unknown } : null;
        if (detail?.kind !== "todo") continue;
        if (turnId && item.turnId && item.turnId !== turnId) continue;
        const explanation = String(detail.explanation || "").trim();
        const tasks = Array.isArray(detail.tasks) ? detail.tasks : [];
        const lines: string[] = [];
        if (explanation) lines.push(explanation);
        const steps = tasks.flatMap((task) => {
            if (!task || typeof task !== "object") return [];
            const step = String((task as { step?: unknown }).step || "").trim();
            return step ? [`- ${step}`] : [];
        });
        if (steps.length) {
            if (lines.length) lines.push("");
            lines.push("## 步骤", ...steps);
        }
        if (lines.length) return lines.join("\n");
    }
    return "";
}

export function isPlanExecuteMessage(text: string) {
    const value = text.trim();
    return value.startsWith("开始执行。") || value.startsWith("Start building.");
}

export function planWasExecuted(messages: AgentChatItem[]) {
    return messages.some((item) => item.role === "user" && isPlanExecuteMessage(item.text));
}

export function buildAgentPlanDocument(input: {
    id?: string;
    threadId: string;
    turnId: string;
    markdown?: string;
    messages: AgentChatItem[];
    collapsed?: boolean;
    width?: number;
    executed?: boolean;
}): AgentPlanDocument | null {
    const answers = userInputAnswersFromMessages(input.messages);
    const markdown = (input.markdown || planItemMarkdown(input.messages) || todoPlanMarkdown(input.messages, input.turnId) || (answers.length ? "" : latestAssistantMarkdown(input.messages))).trim();
    if (!markdown && !answers.length) return null;
    const title = firstHeading(markdown) || "规划书";
    const storedWidth = typeof window === "undefined" ? AGENT_PLAN_DEFAULT_WIDTH : Number(localStorage.getItem("canvas-agent-plan-width")) || AGENT_PLAN_DEFAULT_WIDTH;
    return {
        id: input.id || `plan-${input.threadId}-${input.turnId || Date.now()}`,
        threadId: input.threadId,
        turnId: input.turnId,
        title,
        markdown,
        answers,
        collapsed: Boolean(input.collapsed),
        width: clampPlanDocumentWidth(input.width || storedWidth),
        executed: Boolean(input.executed || planWasExecuted(input.messages)),
    };
}

function firstHeading(markdown: string) {
    const match = markdown.match(/^\s{0,3}#{1,3}\s+(.+)$/m);
    return match?.[1]?.replace(/[#*_`]/g, "").trim() || "";
}
