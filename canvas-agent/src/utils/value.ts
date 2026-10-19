export type JsonRecord = Record<string, unknown>;

/** 安全读取未知对象中的指定字段。 */
export function field(value: unknown, key: string) {
    return value && typeof value === "object" ? (value as JsonRecord)[key] : undefined;
}

/** 将未知异常转换为可展示的错误信息。 */
export function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

/** Codex JSON-RPC 的 requestId 可能是 0，不能当假值丢掉。 */
export function requestIdText(value: unknown) {
    return value === undefined || value === null || value === "" ? "" : String(value);
}
