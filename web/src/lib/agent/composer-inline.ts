import type { AgentAttachment } from "@/stores/use-agent-store";

/** 对话输入中的内联文件标记，顺序即发送顺序 */
export const AGENT_FILE_PATTERN = /@\[file:([^\]]+)\]/g;

export function composerFileToken(id: string) {
    return `@[file:${id}]`;
}

export function stripComposerFileTokens(prompt: string) {
    return prompt.replace(AGENT_FILE_PATTERN, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

export function mentionedComposerFileIds(prompt: string) {
    const ids: string[] = [];
    const pattern = new RegExp(AGENT_FILE_PATTERN.source, "g");
    for (const match of prompt.matchAll(pattern)) {
        if (match[1] && !ids.includes(match[1])) ids.push(match[1]);
    }
    return ids;
}

/** 按 prompt 中出现顺序取出附件；未出现在文中的附件排在末尾 */
export function orderedAttachmentsFromPrompt(prompt: string, attachments: AgentAttachment[]) {
    const byId = new Map(attachments.map((item) => [item.id, item]));
    const ordered: AgentAttachment[] = [];
    const seen = new Set<string>();
    const pattern = new RegExp(AGENT_FILE_PATTERN.source, "g");
    for (const match of prompt.matchAll(pattern)) {
        const id = match[1];
        if (!id || seen.has(id)) continue;
        const hit = byId.get(id);
        if (!hit) continue;
        ordered.push(hit);
        seen.add(id);
    }
    for (const item of attachments) {
        if (seen.has(item.id)) continue;
        ordered.push(item);
        seen.add(item.id);
    }
    return ordered;
}

export function removeComposerFileToken(prompt: string, id: string) {
    return prompt
        .split(composerFileToken(id))
        .join(" ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
}

export function appendComposerText(prompt: string, text: string) {
    const body = text.trim();
    if (!body) return prompt;
    const base = prompt.replace(/\s+$/g, "");
    if (!base.trim() && !/@\[file:/.test(base)) return body;
    return `${base}\n\n${body}`;
}

export function appendComposerFile(prompt: string, id: string) {
    const token = composerFileToken(id);
    const base = prompt.replace(/\s+$/g, "");
    if (!base) return `${token} `;
    return `${base} ${token} `;
}

export function pruneAttachmentsToPrompt(prompt: string, attachments: AgentAttachment[]) {
    const used = new Set(mentionedComposerFileIds(prompt));
    return attachments.filter((item) => used.has(item.id));
}

export type ComposerPromptToken = { type: "text"; value: string } | { type: "file"; id: string };

export function parseComposerPromptTokens(value: string): ComposerPromptToken[] {
    const tokens: ComposerPromptToken[] = [];
    let lastIndex = 0;
    const pattern = new RegExp(AGENT_FILE_PATTERN.source, "g");
    for (const match of value.matchAll(pattern)) {
        if (match.index === undefined) continue;
        if (match.index > lastIndex) tokens.push({ type: "text", value: value.slice(lastIndex, match.index) });
        tokens.push({ type: "file", id: match[1] });
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < value.length) tokens.push({ type: "text", value: value.slice(lastIndex) });
    return tokens;
}
