/** 从 Cursor CLI / ACP 的 message、content、result 里抽出助手正文。 */
export function extractAssistantText(value: unknown): string {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
        return value.map(extractAssistantText).filter((part) => part.length > 0).reduce((all, part) => joinContentParts(all, part), "");
    }
    if (!value || typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.thinking === "string") return record.thinking;
    if (record.content !== undefined) return extractAssistantText(record.content);
    if (record.message !== undefined) return extractAssistantText(record.message);
    if (record.result !== undefined) return extractAssistantText(record.result);
    return "";
}

/** 合并流式增量：认前缀延伸和重叠，有换行的完整快照优先，禁止把另一份草稿接到后面。 */
export function mergeAssistantText(current: string, incoming: string, kind: "snapshot" | "delta" = "snapshot") {
    if (kind === "delta") return current + incoming;
    if (!incoming) return current;
    if (!current) return incoming;
    if (incoming === current) return current;
    if (incoming.startsWith(current)) return incoming;
    if (current.startsWith(incoming)) return current;
    if (incoming.length >= 48 && incoming.length < current.length && current.includes(incoming)) return current;
    if (current.length >= 48 && current.length < incoming.length && incoming.includes(current)) return incoming;
    const overlap = suffixPrefixOverlap(current, incoming);
    if (overlap) return current + incoming.slice(overlap);
    const currentLines = lineCount(current);
    const incomingLines = lineCount(incoming);
    if (incomingLines !== currentLines) return incomingLines > currentLines ? incoming : current;
    if (incoming.length <= 24) return joinTokenParts(current, incoming);
    return incoming.length >= current.length ? incoming : current;
}

function joinContentParts(left: string, right: string) {
    if (!left) return right;
    if (!right) return left;
    if (right.startsWith(left)) return right;
    if (left.startsWith(right)) return left;
    if (/\s$/.test(left) || /^\s/.test(right)) return left + right;
    if (isBlockPiece(right) || isBlockPiece(left) || left.includes("\n") || right.includes("\n") || /[。！？.!?]$/.test(left.trim())) {
        return `${left.replace(/\n+$/, "")}\n${right}`;
    }
    return joinTokenParts(left, right);
}

function joinTokenParts(left: string, right: string) {
    if (!left) return right;
    if (!right) return left;
    if (/\s$/.test(left) || /^\s/.test(right)) return left + right;
    if (isBlockPiece(right) || isBlockPiece(left) || /```\w*$/.test(left.trim())) return `${left}\n${right}`;
    if (/^#{1,6}$/.test(left.trim())) return `${left} ${right}`;
    if (/[A-Za-z0-9]$/.test(left) && /[A-Za-z0-9]/.test(right[0] || "")) return `${left} ${right}`;
    return left + right;
}

function isBlockPiece(text: string) {
    const trimmed = text.trim();
    return /^```/.test(trimmed)
        || /^#{1,6}(?:\s|$)/.test(trimmed)
        || /^#{1,6}$/.test(trimmed)
        || /^-{3,}$/.test(trimmed)
        || /^[A-Z][A-Z0-9]{1,}(?:\s*[&/]\s*[A-Z][A-Z0-9]{1,})*$/.test(trimmed);
}

function suffixPrefixOverlap(left: string, right: string) {
    const max = Math.min(left.length, right.length, 80);
    for (let size = max; size >= 8; size -= 1) {
        if (left.endsWith(right.slice(0, size))) return size;
    }
    return 0;
}

function lineCount(text: string) {
    return (text.match(/\n/g) || []).length;
}
