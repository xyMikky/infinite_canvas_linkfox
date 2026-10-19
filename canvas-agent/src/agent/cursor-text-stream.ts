import { extractAssistantText, mergeAssistantText } from "./assistant-text.js";

/** --stream-partial-output 同时发送 token 与段落回执，回执不可再次当 token 拼接。 */
export class CursorTextStream {
    private text = "";
    private segment = "";
    private pending: string | undefined;

    push(event: Record<string, unknown>) {
        const boundary = event.type === "result" || event.type === "retry" || event.type === "interaction_query"
            || (event.type === "tool_call" && event.subtype === "started");
        // CLI 的重试/交互回执没有独立类型，保留一个片段至下一事件确认，避免吞掉合法重复 token。
        if (!(boundary && this.pending === this.segment)) this.flush();
        this.pending = undefined;
        if (event.type === "assistant") {
            const message = event.message as { content?: unknown[] } | undefined;
            const incoming = Array.isArray(message?.content)
                ? message.content.map(extractAssistantText).join("") : extractAssistantText(event.message || event);
            if (event.model_call_id || event.timestamp_ms === undefined) {
                this.text = this.text.slice(0, this.text.length - this.segment.length) + incoming;
                this.segment = incoming;
            } else this.pending = incoming;
        }
        if (event.type === "result" && !event.is_error && event.result !== undefined) this.text = extractAssistantText(event.result);
        if (boundary) this.segment = "";
        return this.text;
    }

    finish() {
        this.flush();
        return this.text;
    }

    private flush() {
        if (this.pending === undefined) return;
        this.text = mergeAssistantText(this.text, this.pending, "delta");
        this.segment += this.pending;
        this.pending = undefined;
    }
}
