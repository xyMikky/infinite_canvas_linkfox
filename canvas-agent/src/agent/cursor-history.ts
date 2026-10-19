import fs from "node:fs";
import path from "node:path";

import { CONFIG_DIR } from "../config.js";

export type CursorHistoryMessage = {
    id: string;
    itemId: string;
    clientMessageId?: string;
    threadId: string;
    turnId: string;
    role: "user" | "assistant" | "tool" | "error";
    title?: string;
    text: string;
};

export type CursorHistoryThread = {
    id: string;
    ownerId: string;
    preview: string;
    cwd?: string;
    sessionId?: string;
    createdAt: number;
    updatedAt: number;
    messages: CursorHistoryMessage[];
};

type CursorHistoryFile = { version: 1; threads: CursorHistoryThread[] };

export const CURSOR_HISTORY_FILE = path.join(CONFIG_DIR, "cursor-thread-history.json");
const MAX_THREADS = 80;
const MAX_MESSAGES = 200;

function emptyFile(): CursorHistoryFile {
    return { version: 1, threads: [] };
}

function loadFile(): CursorHistoryFile {
    try {
        const raw = JSON.parse(fs.readFileSync(CURSOR_HISTORY_FILE, "utf8")) as CursorHistoryFile;
        return { version: 1, threads: Array.isArray(raw.threads) ? raw.threads : [] };
    } catch {
        return emptyFile();
    }
}

function saveFile(data: CursorHistoryFile) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CURSOR_HISTORY_FILE, `${JSON.stringify({ version: 1, threads: data.threads.slice(-MAX_THREADS) })}\n`);
}

export function listAllCursorHistoryThreads() {
    return loadFile().threads;
}

export function listCursorHistoryThreads(ownerId: string) {
    return loadFile().threads.filter((item) => item.ownerId === ownerId).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function readCursorHistoryThread(threadId: string, ownerId?: string) {
    const thread = loadFile().threads.find((item) => item.id === threadId);
    if (!thread || (ownerId && thread.ownerId !== ownerId)) return null;
    return thread;
}

export function upsertCursorHistoryThread(thread: Omit<CursorHistoryThread, "messages"> & { messages?: CursorHistoryMessage[] }) {
    const data = loadFile();
    const index = data.threads.findIndex((item) => item.id === thread.id);
    const previous = index >= 0 ? data.threads[index] : undefined;
    const next: CursorHistoryThread = {
        id: thread.id,
        ownerId: thread.ownerId,
        preview: thread.preview || previous?.preview || "",
        cwd: thread.cwd || previous?.cwd,
        sessionId: thread.sessionId || previous?.sessionId || "",
        createdAt: thread.createdAt || previous?.createdAt || Date.now(),
        updatedAt: thread.updatedAt || Date.now(),
        messages: thread.messages || previous?.messages || [],
    };
    if (index >= 0) data.threads[index] = next;
    else data.threads.push(next);
    saveFile(data);
    return next;
}

export function recordCursorHistoryMessage(threadId: string, message: CursorHistoryMessage) {
    const data = loadFile();
    const index = data.threads.findIndex((item) => item.id === threadId);
    if (index < 0) return;
    const thread = data.threads[index];
    const existing = thread.messages.findIndex((item) => item.id === message.id
        || (item.itemId === message.itemId && item.turnId === message.turnId && item.role === message.role)
        || (message.role === "user" && item.role === "user" && (!item.turnId || item.turnId === message.turnId)
            && ((message.clientMessageId && item.clientMessageId === message.clientMessageId) || item.text === message.text)));
    const messages = [...thread.messages];
    if (existing >= 0) messages[existing] = { ...messages[existing], ...message };
    else messages.push(message);
    data.threads[index] = { ...thread, updatedAt: Date.now(), messages: messages.slice(-MAX_MESSAGES) };
    saveFile(data);
}

export function deleteCursorHistoryThread(threadId: string, ownerId: string) {
    const data = loadFile();
    const next = data.threads.filter((item) => !(item.id === threadId && item.ownerId === ownerId));
    if (next.length === data.threads.length) return false;
    saveFile({ version: 1, threads: next });
    return true;
}
