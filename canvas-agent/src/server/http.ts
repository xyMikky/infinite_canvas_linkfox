import { spawn } from "node:child_process";
import { readdir, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";

import { runClaudeTurn } from "../agent/claude.js";
import { threadContextMode, withSelectedSkill } from "../agent/chat-mode.js";
import { writeAttachmentFiles } from "../agent/codex.js";
import {
    activateCursorThread,
    createCursorThread,
    cursorConversation,
    deleteCursorThread,
    resetCursorThread,
    getCursorCliStatus,
    getCursorThread,
    getCursorThreadMessages,
    interruptCursorTurn,
    listCursorThreads,
    resolveCursorApproval,
    resolveCursorUserInput,
    runCursorTurn,
} from "../agent/cursor.js";
import { archiveCodexThread, CodexSkillLookupError, configureCodexSkill, forkCodexThread, generateCodexSkillDraft, hideCodexTurn, interruptCodexTurn, isRecoverableThreadError, listCodexModels, listCodexSkills, listCodexThreads, readCodexThread, resolveCodexApproval, resolveCodexSkill, resolveCodexUserInput, resumeCodexThread, runCodexTurn, setCodexAppEmit, startCodexNodeThread, startCodexThread, summarizeCodexThread } from "../agent/codex.js";
import type { CodexReasoningEffort, CodexSkillSelector } from "../agent/codex-protocol.js";
import type { AgentAttachment, AgentCollaborationMode, AgentPermissionMode } from "../agent/types.js";
import { AGENT_PROTOCOL_VERSION, CanvasSession, HOST_OWNER_ID } from "../canvas/session.js";
import { DEFAULT_PORT, ensureSiteWorkspace, loadConfig, saveConfig, updateSiteWorkspace, type CanvasAgentConfig } from "../config.js";
import { logger } from "../utils/logger.js";
import { requestIdText } from "../utils/value.js";
import { checkVersions } from "../version-check.js";
import { listCursorSkills } from "../skills/cursor-list.js";
import { SkillStore, SkillStoreError } from "../skills/store.js";

/** 启动仅监听本机的 Canvas Agent HTTP 服务。 */
export function startHttpServer() {
    const config = loadConfig(true);
    const port = Number(process.env.PORT) || Number(new URL(config.url).port) || DEFAULT_PORT;
    config.url = `http://127.0.0.1:${port}`;
    saveConfig(config);

    const initialWorkspace = ensureSiteWorkspace(config);
    const session = new CanvasSession(initialWorkspace.activeThreadId || "", initialWorkspace.threadOwners || {});
    const skillStore = new SkillStore(initialWorkspace.workspacePath);
    /** 从请求中读取浏览器身份；旧客户端与桌面端都归主人。 */
    const ownerIdOf = (req: Request) => String(req.query.ownerId || (req.body as Record<string, unknown> | undefined)?.ownerId || "") || HOST_OWNER_ID;
    /** 读取指定所有者当前的活跃线程。 */
    const activeThreadFor = (ownerId: string) => {
        const workspace = ensureSiteWorkspace(config);
        return (ownerId === HOST_OWNER_ID ? workspace.activeThreadId : workspace.guestThreads?.[ownerId]) || "";
    };
    /** 面向单个所有者的工作空间视图，不暴露其他访客的线程映射。 */
    const ownerWorkspaceView = (ownerId: string) => {
        const { guestThreads: _guests, threadOwners: _owners, ...workspace } = ensureSiteWorkspace(config);
        return { ...workspace, activeThreadId: activeThreadFor(ownerId) || undefined };
    };
    /** 持久化线程归属，用于历史列表过滤和事件定向。 */
    const recordThreadOwner = (threadId: string, ownerId: string) => {
        if (!threadId || !ownerId) return;
        const owners = ensureSiteWorkspace(config).threadOwners || {};
        session.setThreadOwner(threadId, ownerId);
        if (owners[threadId] === ownerId) return;
        updateSiteWorkspace(config, { threadOwners: { ...owners, [threadId]: ownerId } });
    };
    /** 未登记的线程默认归主人；禁止访客抢占他人会话。进程内登记优先补上尚未落盘的节点线程。 */
    const threadOwnerOf = (threadId: string) =>
        (ensureSiteWorkspace(config).threadOwners || {})[threadId]
        || session.recordedThreadOwner(threadId)
        || HOST_OWNER_ID;
    const assertThreadOwner = (ownerId: string, threadId: string) => {
        if (!threadId) return;
        if (threadOwnerOf(threadId) === ownerId) return;
        const error = new Error("无权访问该会话") as Error & { statusCode?: number };
        error.statusCode = 403;
        throw error;
    };
    /** 将 Agent 事件广播到所属线程的浏览器或全部网页。 */
    const emit = (type: string, payload: unknown) => {
        const value = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : { value: payload };
        if (type === "skills_changed" || type === "codex_auth_expired") {
            session.emitAll(type, value);
            return;
        }
        if (type === "agent_bootstrap" && value.phase === "preheat") {
            if (value.type === "mcp.startup") session.updateConversationMcp(String(value.name || ""), startupStatus(value.status), String(value.error || "") || null, String(value.failureReason || "") || null);
            if (value.type === "mcp.complete") session.completeConversationMcpInventory(mcpInventory(value.services));
        }
        const threadId = String(value.threadId || value.thread_id || "");
        const turnId = String(value.turnId || value.turn_id || "");
        const data = {
            ...value,
            ...(threadId ? { threadId, thread_id: threadId } : {}),
            ...(turnId ? { turnId, turn_id: turnId } : {}),
        };
        session.trackCodexEvent(type, data);
        threadId ? session.emitThread(type, threadId, data) : session.emitAll(type, data);
    };
    setCodexAppEmit(emit);
    /** 保存并向所属浏览器广播其活跃线程。 */
    const setActiveThread = (ownerId: string, activeThreadId: string, payload: Record<string, unknown> = {}, preserveConversation = false) => {
        const previousThreadId = activeThreadFor(ownerId);
        if (ownerId === HOST_OWNER_ID) {
            updateSiteWorkspace(config, { activeThreadId: activeThreadId || undefined });
        } else {
            const guestThreads = { ...(ensureSiteWorkspace(config).guestThreads || {}) };
            activeThreadId ? guestThreads[ownerId] = activeThreadId : delete guestThreads[ownerId];
            updateSiteWorkspace(config, { guestThreads });
        }
        if (activeThreadId) recordThreadOwner(activeThreadId, ownerId);
        if (!preserveConversation) session.activateConversation(ownerId, activeThreadId, String(payload.sourceClientId || "") || undefined);
        if (previousThreadId && previousThreadId !== activeThreadId && !session.threadBusy(previousThreadId)) session.clearThreadReplay(previousThreadId);
        session.emitOwner(ownerId, "workspace_changed", { ...payload, threadId: activeThreadId, activeThreadId, conversation: session.conversationSnapshot(ownerId) });
        return ownerWorkspaceView(ownerId);
    };
    const draftThreadStarts = new Map<string, ReturnType<typeof startCodexThread>>();
    const skillDraftThreads = new Map<string, { sourceThreadId: string; threadId: string }>();
    const prepareDraftThread = (ownerId: string, clientId: string, permission: AgentPermissionMode, mode: AgentCollaborationMode = "chat") => {
        const pending = draftThreadStarts.get(ownerId);
        if (pending) return pending;
        const workspace = ensureSiteWorkspace(config);
        let prepared!: ReturnType<typeof startCodexThread>;
        prepared = (async () => {
            emit("agent_bootstrap", { type: "codex.preparing", sourceClientId: clientId });
            try {
                // 必须用根 emit：若把 ownedEmit 传进 getCodexApp，会永久绑死第一个访客，后续访客回复全丢
                const thread = await startCodexThread(emit, workspace.workspacePath, permission, mode !== "chat", mode);
                if (draftThreadStarts.get(ownerId) !== prepared) return thread;
                const threadId = String((thread as Record<string, unknown>).id || "");
                if (threadId) {
                    recordThreadOwner(threadId, ownerId);
                    session.completeConversationPreparation(ownerId, threadId, mode !== "chat");
                    if (!activeThreadFor(ownerId)) {
                        setActiveThread(ownerId, threadId, { emptyThread: true, draftThread: true, sourceClientId: clientId }, true);
                    }
                }
                return thread;
            } catch (error) {
                if (draftThreadStarts.get(ownerId) === prepared) {
                    const text = error instanceof Error ? error.message : String(error);
                    session.failConversationPreparation(ownerId, text);
                    emit("agent_bootstrap", { type: "codex.prepare_failed", sourceClientId: clientId, error: text });
                }
                throw error;
            } finally {
                if (draftThreadStarts.get(ownerId) === prepared) draftThreadStarts.delete(ownerId);
            }
        })();
        draftThreadStarts.set(ownerId, prepared);
        return prepared;
    };
    /** 恢复已有线程并等待完整 MCP 清单，供启动恢复和手动切换共用。 */
    const prepareExistingThread = async (ownerId: string, threadId: string, clientId = "", permission: AgentPermissionMode = "request") => {
        assertThreadOwner(ownerId, threadId);
        const workspace = ensureSiteWorkspace(config);
        session.beginConversation(ownerId, { conversationId: threadId, threadId, sourceClientId: clientId || undefined });
        recordThreadOwner(threadId, ownerId);
        emit("agent_bootstrap", { type: "codex.preparing", threadId, sourceClientId: clientId || undefined });
        try {
            const result = await resumeCodexThread(emit, threadId, workspace.workspacePath, permission, true);
            session.completeConversationPreparation(ownerId, threadId, threadContextMode(threadId) !== "chat");
            return result;
        } catch (error) {
            if (!isRecoverableThreadError(error)) throw error;
            session.beginConversation(ownerId, { sourceClientId: clientId || undefined });
            setActiveThread(ownerId, "", { emptyThread: true, draftThread: true, sourceClientId: clientId }, true);
            const thread = await prepareDraftThread(ownerId, clientId, permission);
            return { thread, messages: [], settledTurnIds: [], hiddenTurnIds: [], historyReady: true };
        }
    };
    const failPreparedConversation = (ownerId: string, error: unknown, threadId: string, clientId = "") => {
        const text = error instanceof Error ? error.message : String(error);
        session.failConversationPreparation(ownerId, text);
        emit("agent_bootstrap", { type: "codex.prepare_failed", threadId, sourceClientId: clientId || undefined, error: text });
    };
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "30mb" }));
    app.use((req, res, next) => {
        if (!logger.enabled) return next();
        const startedAt = Date.now();
        const url = requestUrl(req, config);
        res.on("finish", () => {
            if (req.method === "OPTIONS" || (res.statusCode < 400 && ["/health", "/canvas/state", "/canvas/activate"].includes(url.pathname))) return;
            logger.debug(`HTTP ${req.method} ${url.pathname}`, { status: res.statusCode, durationMs: Date.now() - startedAt });
        });
        next();
    });
    app.use((req, res, next) => {
        const url = requestUrl(req, config);
        if (!setCors(req, res, url, config)) return void res.status(403).json({ ok: false, error: "origin not allowed" });
        if (req.method === "OPTIONS") return void res.json({});
        next();
    });
    app.get("/health", (_req, res) => res.json(session.health()));
    app.get("/config", (_req, res) => res.json({ ok: true, protocolVersion: AGENT_PROTOCOL_VERSION, url: config.url, hasToken: true }));
    app.use((req, res, next) => {
        if (validToken(req, requestUrl(req, config), config.token)) return next();
        res.status(401).json({ ok: false, error: "invalid token" });
    });
    app.get("/events", (req, res) => {
        const ownerId = ownerIdOf(req);
        session.openEvents(requestUrl(req, config), res, ownerId, activeThreadFor(ownerId));
    });
    app.post("/canvas/state", (req, res) => {
        session.updateState(req.body, String(req.query.clientId || "") || undefined);
        res.json({ ok: true });
    });
    app.post("/canvas/activate", (req, res) => {
        session.activateClient(String(req.query.clientId || ""));
        res.json({ ok: true });
    });
    app.post("/canvas/result", (req, res) => {
        const ok = session.resolveResult(String(req.query.clientId || ""), req.body);
        res.status(ok ? 200 : 409).json({ ok });
    });
    app.get("/agent/attachments/:attachmentId", route(async (req, res) => {
        const attachment = session.getTurnAttachment(String(req.query.clientId || ""), routeParam(req.params.attachmentId));
        const data = attachment.dataUrl.split(",", 2)[1];
        if (!data) throw new Error("图片附件内容无效");
        res.setHeader("Cache-Control", "no-store");
        res.type(attachment.type).send(Buffer.from(data, "base64"));
    }));
    app.post("/agent/local-file/reveal", route(async (req, res) => {
        const filePath = String(req.body?.path || "");
        if (!path.isAbsolute(filePath)) return res.status(400).json({ ok: false, error: "文件路径必须是绝对路径" });
        const file = await stat(filePath);
        await revealLocalFile(filePath, file.isDirectory());
        res.json({ ok: true });
    }));
    app.post("/agent/local-image", route(async (req, res) => {
        const filePath = String(req.body?.path || "");
        if (!path.isAbsolute(filePath) || !/\.(?:avif|gif|jpe?g|png|webp)$/i.test(filePath)) return res.status(400).json({ ok: false, error: "图片路径无效" });
        const file = await stat(filePath);
        if (!file.isFile()) return res.status(400).json({ ok: false, error: "图片文件无效" });
        res.setHeader("Cache-Control", "no-store");
        res.type(path.extname(filePath)).send(await readFile(filePath));
    }));
    /** 列出 Codex 工作空间内某个目录的文件，供画布把智能体产物挂成文件夹节点 */
    app.post("/agent/workspace-dir", route(async (req, res) => {
        const dir = resolveInsideWorkspace(ensureSiteWorkspace(config).workspacePath, String(req.body?.path || ""));
        if (!dir) return res.status(400).json({ ok: false, error: "目录必须位于 Codex 工作空间内" });
        const target = await stat(dir).catch(() => null);
        if (!target?.isDirectory()) return res.json({ ok: true, entries: [] });
        res.json({ ok: true, entries: await listWorkspaceFiles(dir) });
    }));
    /** 读取 Codex 工作空间内的单个产物文件 */
    app.post("/agent/workspace-file", route(async (req, res) => {
        const filePath = resolveInsideWorkspace(ensureSiteWorkspace(config).workspacePath, String(req.body?.path || ""));
        if (!filePath) return res.status(400).json({ ok: false, error: "文件必须位于 Codex 工作空间内" });
        const file = await stat(filePath).catch(() => null);
        if (!file?.isFile()) return res.status(400).json({ ok: false, error: "文件不存在" });
        res.setHeader("Cache-Control", "no-store");
        res.type("application/octet-stream").send(await readFile(filePath));
    }));
    app.post("/api/tools", route(async (req, res) => {
        const threadId = String(req.body?.threadId || "");
        const ownerId = threadId || req.body?.ownerId || req.query.ownerId ? ownerIdOf(req) : "";
        if (threadId) assertThreadOwner(ownerId, threadId);
        res.json({ ok: true, result: await session.callTool(req.body?.name, req.body?.input || {}, threadId, ownerId) });
    }));
    app.get("/agent/codex/workspace", (req, res) => {
        const ownerId = ownerIdOf(req);
        res.json({ ok: true, workspace: ownerWorkspaceView(ownerId), conversation: session.conversationSnapshot(ownerId, activeThreadFor(ownerId)) });
    });
    app.post("/agent/codex/paths", route(async (req, res) => {
        const workspace = updateSiteWorkspace(config, {
            inputPath: req.body?.inputPath === undefined ? undefined : String(req.body.inputPath || ""),
            outputPath: req.body?.outputPath === undefined ? undefined : String(req.body.outputPath || ""),
        });
        res.json({ ok: true, workspace });
    }));
    app.get("/agent/codex/models", route(async (_req, res) => res.json({ ok: true, ...(await listCodexModels(emit)) })));
    app.get("/agent/codex/skills", route(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const result = await listCodexSkills(emit, workspace.workspacePath, String(req.query.forceReload || "") === "1");
        res.json({ ok: true, data: result.skills.map((skill) => ({ ...skill, managed: skillStore.isManagedPath(skill.path) })), errors: result.errors });
    }));
    app.post("/agent/codex/skills/draft", codexMutation(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const ownerId = ownerIdOf(req);
        const source = String(req.body?.source || "");
        if (source !== "conversation" && source !== "canvas") return res.status(400).json({ ok: false, error: "Skill 草稿来源无效" });
        const clientId = String(req.body?.clientId || "");
        if (!clientId || !session.hasClient(clientId)) return res.status(409).json({ ok: false, error: "发起提炼的网页已断开，请重新连接后再试" });
        const model = String(req.body?.model || "") || undefined;
        const effort = reasoningEffort(req.body?.effort);
        const activeThreadId = activeThreadFor(ownerId);
        // 提炼期间把所有者当前线程标记为忙，阻止其在同一会话并发发送
        let markedThreadId = "";
        const onThread = (threadId: string) => {
            session.setThreadOwner(threadId, ownerId);
            skillDraftThreads.set(ownerId, { sourceThreadId: activeThreadId, threadId });
        };
        try {
            if (source === "conversation") {
                const threadId = String(req.body?.threadId || "");
                if (!threadId) return res.status(409).json({ ok: false, error: "当前没有可提炼的对话" });
                if (threadId !== activeThreadId) return res.status(409).json({ ok: false, error: "当前对话已在其他页面切换，请同步后重试" });
                const history = await readCodexThread(emit, threadId, workspace.workspacePath);
                if (!history.messages.some((message) => message.role === "user" && message.turnId)) return res.status(409).json({ ok: false, error: "当前对话还没有可提炼的已完成内容" });
                markedThreadId = threadId;
                session.beginThreadTurn(threadId, ownerId, clientId, { preserveReplay: true });
                const data = await generateCodexSkillDraft(emit, workspace.workspacePath, { source, threadId, model, effort, onThread });
                if (!session.hasClient(clientId)) return res.status(409).json({ ok: false, error: "发起提炼的网页已断开，请重新连接后再试" });
                return res.json({ ok: true, data });
            }
            const snapshot = session.canvasStateForClient(clientId);
            if (!snapshot || (snapshot as Record<string, unknown>).hasCanvas === false) return res.status(409).json({ ok: false, error: "当前页面没有可提炼的画布" });
            if (activeThreadId) {
                markedThreadId = activeThreadId;
                session.beginThreadTurn(activeThreadId, ownerId, clientId, { preserveReplay: true });
            }
            const data = await generateCodexSkillDraft(emit, workspace.workspacePath, { source, snapshot, model, effort, onThread });
            if (!session.hasClient(clientId)) return res.status(409).json({ ok: false, error: "发起提炼的网页已断开，请重新连接后再试" });
            return res.json({ ok: true, data });
        } finally {
            skillDraftThreads.delete(ownerId);
            if (markedThreadId) session.endThreadTurn(markedThreadId);
        }
    }));
    app.post("/agent/codex/skills/import", codexMutation(async (req, res) => {
        const data = await skillStore.importFolder(req.body?.sourcePath);
        session.emitAll("skills_changed", { forceReload: true });
        res.status(201).json({ ok: true, data });
    }));
    app.get("/agent/codex/skills/:name", route(async (req, res) => {
        res.json({ ok: true, data: await skillStore.get(routeParam(req.params.name)) });
    }));
    app.post("/agent/codex/skills", codexMutation(async (req, res) => {
        const data = await skillStore.create(req.body);
        session.emitAll("skills_changed", { forceReload: true });
        res.status(201).json({ ok: true, data });
    }));
    app.post("/agent/codex/skills/:name/enabled", codexMutation(async (req, res) => {
        if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ ok: false, error: "Skill 启用状态无效" });
        const workspace = ensureSiteWorkspace(config);
        const selector = skillSelector(req.body);
        if (selector.name !== routeParam(req.params.name)) return res.status(400).json({ ok: false, error: "Skill 选择无效" });
        const data = await configureCodexSkill(emit, workspace.workspacePath, selector, req.body.enabled);
        session.emitAll("skills_changed", { forceReload: true });
        res.json({ ok: true, data });
    }));
    app.post("/agent/codex/skills/:name/delete", codexMutation(async (req, res) => {
        await skillStore.delete(routeParam(req.params.name), String(req.body?.expectedRevision || ""));
        session.emitAll("skills_changed", { forceReload: true });
        res.json({ ok: true });
    }));
    app.post("/agent/codex/skills/:name", codexMutation(async (req, res) => {
        const data = await skillStore.update(routeParam(req.params.name), req.body);
        session.emitAll("skills_changed", { forceReload: true });
        res.json({ ok: true, data });
    }));
    app.get("/agent/codex/threads", route(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const ownerId = ownerIdOf(req);
        const result = await listCodexThreads(emit, { cwd: workspace.workspacePath, searchTerm: String(req.query.searchTerm || "") });
        const owners = workspace.threadOwners || {};
        const data = result.data.filter((thread) => (owners[thread.id] || HOST_OWNER_ID) === ownerId);
        res.json({ ok: true, workspace: ownerWorkspaceView(ownerId), conversation: session.conversationSnapshot(ownerId, activeThreadFor(ownerId)), ...result, data });
    }));
    // 轻量/画布上下文不能在同一条历史中混用；切换时保留旧线程并建立干净线程。
    app.post("/agent/codex/context", codexMutation(async (req, res) => {
        const ownerId = ownerIdOf(req);
        const clientId = String(req.body?.clientId || "");
        const mode = collaborationMode(req.body?.collaborationMode);
        const active = activeThreadFor(ownerId);
        if (!active || threadContextMode(active) !== (mode === "chat" ? "chat" : "default")) {
            session.beginConversation(ownerId, { sourceClientId: clientId });
            setActiveThread(ownerId, "", { emptyThread: true, draftThread: true, sourceClientId: clientId }, true);
            await prepareDraftThread(ownerId, clientId, permissionMode(req.body?.permissionMode), mode);
        } else if (session.conversationSnapshot(ownerId, active).status === "idle") {
            await prepareExistingThread(ownerId, active, clientId, permissionMode(req.body?.permissionMode));
        }
        res.json({ ok: true, workspace: ownerWorkspaceView(ownerId), conversation: session.conversationSnapshot(ownerId) });
    }));
    app.post("/agent/cursor/context", route(async (req, res) => {
        const ownerId = ownerIdOf(req);
        const mode = collaborationMode(req.body?.collaborationMode);
        const current = cursorConversation(ownerId);
        if (current.status === "running") return res.status(409).json({ ok: false, error: "请等待当前回答结束后再切换模式" });
        if (!current.threadId || threadContextMode(current.threadId) !== (mode === "chat" ? "chat" : "default")) {
            const thread = resetCursorThread(ownerId, ensureSiteWorkspace(config).workspacePath, mode);
            recordThreadOwner(thread.id, ownerId);
        }
        const conversation = cursorConversation(ownerId);
        session.emitOwner(ownerId, "conversation_changed", conversation);
        res.json({ ok: true, workspace: ownerWorkspaceView(ownerId), conversation });
    }));
    app.post("/agent/codex/threads/new", codexMutation(async (req, res) => {
        const ownerId = ownerIdOf(req);
        const clientId = String(req.body?.clientId || "");
        // 已在预热中则复用同一任务，避免二次 beginConversation 清掉 MCP 清单导致永远 preparing
        if (!draftThreadStarts.has(ownerId)) {
            session.beginConversation(ownerId, { sourceClientId: clientId });
            setActiveThread(ownerId, "", { emptyThread: true, draftThread: true, sourceClientId: clientId }, true);
        }
        const thread = await prepareDraftThread(ownerId, clientId, permissionMode(req.body?.permissionMode), collaborationMode(req.body?.collaborationMode));
        res.json({ ok: true, workspace: ownerWorkspaceView(ownerId), conversation: session.conversationSnapshot(ownerId), thread: summarizeCodexThread(thread), messages: [] });
    }));
    app.post("/agent/codex/threads/reset", codexMutation(async (req, res) => {
        const ownerId = ownerIdOf(req);
        const clientId = String(req.body?.clientId || "");
        if (!draftThreadStarts.has(ownerId)) {
            session.beginConversation(ownerId, { sourceClientId: clientId });
            setActiveThread(ownerId, "", { emptyThread: true, draftThread: true, sourceClientId: clientId }, true);
        }
        await prepareDraftThread(ownerId, clientId, permissionMode(req.body?.permissionMode), collaborationMode(req.body?.collaborationMode));
        res.json({ ok: true, workspace: ownerWorkspaceView(ownerId), conversation: session.conversationSnapshot(ownerId) });
    }));
    app.get("/agent/codex/threads/:threadId", route(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const ownerId = ownerIdOf(req);
        const threadId = routeParam(req.params.threadId);
        assertThreadOwner(ownerId, threadId);
        try {
            res.json({ ok: true, workspace: ownerWorkspaceView(ownerId), conversation: session.conversationSnapshot(ownerId, activeThreadFor(ownerId)), ...(await readCodexThread(emit, threadId, workspace.workspacePath)) });
        } catch (error) {
            if (!isRecoverableThreadError(error)) throw error;
            if (activeThreadFor(ownerId) === threadId) setActiveThread(ownerId, "", { emptyThread: true }, true);
            res.json({ ok: true, workspace: ownerWorkspaceView(ownerId), conversation: session.conversationSnapshot(ownerId), thread: { id: threadId }, messages: [], settledTurnIds: [], hiddenTurnIds: [], historyReady: true, stale: true });
        }
    }));
    app.post("/agent/codex/history/ack", (req, res) => {
        const ownerId = ownerIdOf(req);
        const threadId = String(req.body?.threadId || "");
        const turnIds = Array.isArray(req.body?.turnIds) ? req.body.turnIds.map(String) : [];
        try {
            assertThreadOwner(ownerId, threadId);
        } catch (error) {
            const status = (error as { statusCode?: number }).statusCode || 403;
            return res.status(status).json({ ok: false, error: error instanceof Error ? error.message : "无权访问该会话" });
        }
        session.acknowledgeCodexHistory(threadId, turnIds);
        res.json({ ok: true });
    });
    app.post("/agent/codex/threads/:threadId/resume", codexMutation(async (req, res) => {
        const ownerId = ownerIdOf(req);
        const threadId = routeParam(req.params.threadId);
        const clientId = String(req.body?.clientId || "");
        try {
            const result = await prepareExistingThread(ownerId, threadId, clientId, permissionMode(req.body?.permissionMode));
            const resumedThreadId = String((result.thread as { id?: string }).id || threadId);
            const nextWorkspace = setActiveThread(ownerId, resumedThreadId, { sourceClientId: clientId }, true);
            res.json({ ok: true, contextMode: threadContextMode(resumedThreadId), workspace: nextWorkspace, conversation: session.conversationSnapshot(ownerId), ...result });
        } catch (error) {
            failPreparedConversation(ownerId, error, threadId, clientId);
            throw error;
        }
    }));
    app.post("/agent/codex/threads/:threadId/delete", codexMutation(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const ownerId = ownerIdOf(req);
        const threadId = routeParam(req.params.threadId);
        assertThreadOwner(ownerId, threadId);
        await archiveCodexThread(emit, threadId, workspace.workspacePath);
        const owners = { ...(ensureSiteWorkspace(config).threadOwners || {}) };
        if (owners[threadId]) {
            delete owners[threadId];
            updateSiteWorkspace(config, { threadOwners: owners });
        }
        const activeThreadId = activeThreadFor(ownerId);
        const nextWorkspace = setActiveThread(ownerId, activeThreadId === threadId ? "" : activeThreadId, { sourceClientId: String(req.body?.clientId || "") });
        res.json({ ok: true, workspace: nextWorkspace, conversation: session.conversationSnapshot(ownerId) });
    }));
    app.post("/agent/codex/threads/:threadId/turns/:turnId/delete", codexMutation(async (req, res) => {
        const ownerId = ownerIdOf(req);
        const threadId = routeParam(req.params.threadId);
        const turnId = routeParam(req.params.turnId);
        if (!turnId) return res.status(400).json({ ok: false, error: "缺少 turnId" });
        assertThreadOwner(ownerId, threadId);
        const result = await hideCodexTurn(threadId, turnId);
        res.json({ ok: true, ...result });
    }));
    /** 编辑重发：fork 出只含 lastTurnId 及之前历史的新线程，模型不会再看到被裁掉的回合。 */
    app.post("/agent/codex/threads/:threadId/fork", codexMutation(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const ownerId = ownerIdOf(req);
        const threadId = routeParam(req.params.threadId);
        const lastTurnId = String(req.body?.lastTurnId || "").trim();
        const clientId = String(req.body?.clientId || "");
        const permission = permissionMode(req.body?.permissionMode);
        if (!threadId) return res.status(400).json({ ok: false, error: "缺少 threadId" });
        assertThreadOwner(ownerId, threadId);
        if (session.threadBusy(threadId)) return res.status(409).json({ ok: false, code: "CONVERSATION_BUSY", error: "源会话正在运行，请稍后再编辑重发" });
        session.beginConversation(ownerId, { sourceClientId: clientId || undefined });
        emit("agent_bootstrap", { type: "codex.preparing", threadId, sourceClientId: clientId || undefined });
        try {
            const result = await forkCodexThread(emit, threadId, {
                cwd: workspace.workspacePath,
                permissionMode: permission,
                lastTurnId,
                preheat: true,
            });
            const nextThreadId = String((result.thread as { id?: string }).id || "");
            if (!nextThreadId) throw new Error("Codex fork 未返回 thread id");
            recordThreadOwner(nextThreadId, ownerId);
            session.completeConversationPreparation(ownerId, nextThreadId, threadContextMode(nextThreadId) !== "chat");
            const nextWorkspace = setActiveThread(ownerId, nextThreadId, {
                emptyThread: !lastTurnId,
                sourceClientId: clientId,
            }, true);
            res.json({
                ok: true,
                workspace: nextWorkspace,
                conversation: session.conversationSnapshot(ownerId),
                thread: summarizeCodexThread(result.thread),
                messages: result.messages,
                settledTurnIds: result.settledTurnIds,
                hiddenTurnIds: result.hiddenTurnIds,
                historyReady: result.historyReady,
            });
        } catch (error) {
            failPreparedConversation(ownerId, error, threadId, clientId);
            throw error;
        }
    }));
    app.post("/agent/codex/turn", codexMutation(async (req, res) => {
        const attachments = Array.isArray(req.body?.attachments) ? (req.body.attachments as AgentAttachment[]) : [];
        const workspace = ensureSiteWorkspace(config);
        const ownerId = ownerIdOf(req);
        const prompt = String(req.body?.prompt || "");
        if (!prompt.trim()) return res.status(400).json({ ok: false, error: "请输入任务内容" });
        const clientId = String(req.body?.clientId || "");
        if (!clientId || !session.hasClient(clientId)) return res.status(409).json({ ok: false, error: "发起任务的网页已断开，请重新连接后再试" });
        const requestedThreadId = String(req.body?.threadId || "");
        const activeThreadId = activeThreadFor(ownerId);
        if (activeThreadId) assertThreadOwner(ownerId, activeThreadId);
        const conversation = session.conversationSnapshot(ownerId, activeThreadId);
        const requestedConversationId = String(req.body?.conversationId || "");
        const expectedRevision = Number(req.body?.expectedRevision || 0);
        if (requestedThreadId !== activeThreadId || conversation.threadId !== activeThreadId || (requestedConversationId && requestedConversationId !== conversation.conversationId) || (expectedRevision && expectedRevision !== conversation.revision)) {
            return res.status(409).json({ ok: false, code: "CONVERSATION_STALE", error: "当前会话已切换，已同步最新状态，请确认后重试", state: conversation });
        }
        if (!activeThreadId || !["ready", "warning"].includes(conversation.status)) {
            // 客户端已空闲但服务端仍标 running（例如换线程后 finish 对不上）时先自愈，避免发送永久 409
            if (conversation.status === "running" && activeThreadId && !session.threadBusy(activeThreadId)) {
                session.finishConversationRun(ownerId, activeThreadId);
            } else {
                return res.status(409).json({ ok: false, code: "CONVERSATION_NOT_READY", error: "Codex 对话仍在初始化，请等待 MCP 加载完成", state: session.conversationSnapshot(ownerId, activeThreadId) });
            }
        }
        const model = String(req.body?.model || "") || undefined;
        const effort = reasoningEffort(req.body?.effort);
        const mode = collaborationMode(req.body?.collaborationMode);
        if (threadContextMode(activeThreadId) !== (mode === "chat" ? "chat" : "default")) return res.status(409).json({ ok: false, error: "会话模式已变化，请切换模式或新建对话后重试" });
        const skill = req.body?.skill === undefined ? undefined : await resolveCodexSkill(emit, workspace.workspacePath, skillSelector(req.body.skill), true);
        const messageId = String(req.body?.messageId || Date.now());
        const messageText = String(req.body?.messageText || prompt || `发送了 ${attachments.length} 张图片`);
        let threadId = activeThreadId;
        logger.info("Codex turn accepted", { threadId: req.body?.threadId, ownerId, model: model || "default", reasoningEffort: effort || "default", promptLength: prompt.length, attachmentCount: attachments.length });
        recordThreadOwner(threadId, ownerId);
        session.bindClient(threadId, clientId);
        session.markConversationRunning(ownerId, threadId);
        session.beginThreadTurn(threadId, ownerId, clientId);
        try {
            let turnId = "";
            const attachmentRefs = session.setTurnAttachments(clientId, attachments);
            session.emitThread("chat_message", threadId, {
                sourceClientId: clientId,
                message: { id: `${threadId}:pending:synthetic:user`, itemId: "synthetic:user", clientMessageId: messageId, threadId, turnId: "", role: "user", text: messageText },
            });
            let chatTurnId = "";
            /** 将包装层日志和兜底错误固定广播到当前 turn。 */
            const lifecycleEmit = (type: string, payload: unknown) => {
                const value = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : { value: payload };
                const eventThreadId = String(value.threadId || value.thread_id || threadId);
                const eventTurnId = String(value.turnId || value.turn_id || turnId);
                const sourceClientId = String(value.sourceClientId || clientId);
                session.emitThread(type, eventThreadId, {
                    ...value,
                    threadId: eventThreadId,
                    thread_id: eventThreadId,
                    ...(eventTurnId ? { turnId: eventTurnId, turn_id: eventTurnId } : {}),
                    ...(sourceClientId ? { sourceClientId } : {}),
                });
            };
            void runCodexTurn(mode === "chat" ? withSelectedSkill(prompt, skill) : withAttachmentContext(prompt, attachmentRefs), lifecycleEmit, attachments, {
                threadId,
                cwd: workspace.workspacePath,
                permissionMode: permissionMode(req.body?.permissionMode),
                collaborationMode: mode,
                model,
                effort,
                ...(skill && mode !== "chat" ? { skill: { name: skill.name, path: skill.path } } : {}),
                messageText,
                appEmit: emit,
                onStart: () => session.bindClient(threadId, clientId),
                onThread: (actualThreadId) => {
                    const threadChanged = actualThreadId !== threadId;
                    if (threadChanged) {
                        const previousThreadId = threadId;
                        threadId = actualThreadId;
                        session.retargetThreadTurn(previousThreadId, threadId);
                        recordThreadOwner(threadId, ownerId);
                        if (ownerId === HOST_OWNER_ID) {
                            updateSiteWorkspace(config, { activeThreadId: threadId });
                        } else {
                            const guestThreads = { ...(ensureSiteWorkspace(config).guestThreads || {}) };
                            guestThreads[ownerId] = threadId;
                            updateSiteWorkspace(config, { guestThreads });
                        }
                        session.retargetConversationThread(ownerId, threadId, clientId);
                        if (previousThreadId && previousThreadId !== threadId && !session.threadBusy(previousThreadId)) session.clearThreadReplay(previousThreadId);
                        session.emitOwner(ownerId, "workspace_changed", {
                            emptyThread: true,
                            threadId,
                            activeThreadId: threadId,
                            sourceClientId: clientId,
                            conversation: session.conversationSnapshot(ownerId),
                        });
                    }
                    session.markConversationRunning(ownerId, threadId);
                    if (threadChanged) {
                        session.emitThread("chat_message", threadId, {
                            sourceClientId: clientId,
                            message: { id: `${threadId}:pending:synthetic:user`, itemId: "synthetic:user", clientMessageId: messageId, threadId, turnId: "", role: "user", text: messageText },
                        });
                    }
                },
                onTurn: (actualTurnId) => {
                    turnId = actualTurnId;
                    if (chatTurnId !== turnId) {
                        chatTurnId = turnId;
                        session.emitThread("chat_message", threadId, {
                            turnId,
                            sourceClientId: clientId,
                            message: { id: `${threadId}:${turnId}:synthetic:user`, itemId: "synthetic:user", clientMessageId: messageId, threadId, turnId, role: "user", text: messageText },
                        });
                    }
                    logger.info("Codex turn started", { threadId, turnId, model: model || "default", reasoningEffort: effort || "default" });
                    session.updateThreadTurn(threadId, turnId);
                },
                onFinish: () => {
                    logger.info("Codex turn finished", { threadId, turnId });
                    session.clearTurnAttachments(clientId);
                    session.releaseClient(threadId);
                    session.endThreadTurn(threadId);
                    session.finishConversationRun(ownerId, threadId);
                },
            });
            res.json({ ok: true, threadId });
        } catch (error) {
            session.releaseClient(threadId);
            session.endThreadTurn(threadId);
            session.finishConversationRun(ownerId, threadId);
            throw error;
        }
    }));

    /** 画布节点任务独占线程；继续修改可恢复原线程，与主对话及其它节点隔离。 */
    app.post("/agent/codex/node-turn", route(async (req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const prompt = String(req.body?.prompt || "");
        if (!prompt.trim()) return res.status(400).json({ ok: false, error: "请输入任务内容" });
        const clientId = String(req.body?.clientId || "");
        if (!clientId || !session.hasClient(clientId)) return res.status(409).json({ ok: false, error: "发起任务的网页已断开，请重新连接后再试" });
        const attachments = Array.isArray(req.body?.attachments) ? (req.body.attachments as AgentAttachment[]) : [];
        const model = String(req.body?.model || "") || undefined;
        const effort = reasoningEffort(req.body?.effort);
        const permission = permissionMode(req.body?.permissionMode);
        const skill = req.body?.skill === undefined ? undefined : await resolveCodexSkill(emit, workspace.workspacePath, skillSelector(req.body.skill), true);
        const messageId = String(req.body?.messageId || Date.now());
        const messageText = String(req.body?.messageText || prompt);
        const ownerId = ownerIdOf(req);
        const resumeThreadId = String(req.body?.resumeThreadId || "");
        if (resumeThreadId) {
            assertThreadOwner(ownerId, resumeThreadId);
            if (session.threadBusy(resumeThreadId)) return res.status(409).json({ ok: false, error: "此任务仍在执行，请结束后继续修改" });
            session.beginThreadTurn(resumeThreadId, ownerId, clientId);
        }
        let threadId: string;
        try {
            threadId = await startCodexNodeThread(emit, workspace.workspacePath, permission, resumeThreadId);
        } catch (error) {
            if (resumeThreadId) session.endThreadTurn(resumeThreadId);
            if (resumeThreadId && isRecoverableThreadError(error)) {
                return res.status(409).json({ ok: false, error: "原任务会话已失效，请选择新任务并重新引用需要修改的产物" });
            }
            throw error;
        }
        if (!threadId) {
            if (resumeThreadId) session.endThreadTurn(resumeThreadId);
            return res.status(500).json({ ok: false, error: "创建 Codex 节点线程失败" });
        }
        // 与主对话一致：落盘 threadOwners，否则「查看会话」resume 会按缺省 host 误判无权
        recordThreadOwner(threadId, ownerId);
        session.beginThreadTurn(threadId, ownerId, clientId);
        session.bindClient(threadId, clientId);
        let turnId = "";
        logger.info("Codex node turn accepted", { threadId, ownerId, model: model || "default", reasoningEffort: effort || "default", promptLength: prompt.length, attachmentCount: attachments.length });
        /** 节点任务的日志和兜底错误固定广播到自己的线程。 */
        const lifecycleEmit = (type: string, payload: unknown) => {
            const value = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : { value: payload };
            const eventTurnId = String(value.turnId || value.turn_id || turnId);
            session.emitThread(type, threadId, {
                ...value,
                threadId,
                thread_id: threadId,
                ...(eventTurnId ? { turnId: eventTurnId, turn_id: eventTurnId } : {}),
                sourceClientId: clientId,
            });
        };
        void runCodexTurn(prompt, lifecycleEmit, attachments, {
            threadId,
            isolated: true,
            cwd: workspace.workspacePath,
            permissionMode: permission,
            model,
            effort,
            ...(skill ? { skill: { name: skill.name, path: skill.path } } : {}),
            messageText,
            appEmit: emit,
            onTurn: (actualTurnId) => {
                turnId = actualTurnId;
                logger.info("Codex node turn started", { threadId, turnId });
                session.updateThreadTurn(threadId, turnId);
                session.emitThread("chat_message", threadId, {
                    turnId,
                    sourceClientId: clientId,
                    message: { id: `${threadId}:${turnId}:synthetic:user`, itemId: "synthetic:user", clientMessageId: messageId, threadId, turnId, role: "user", text: messageText },
                });
            },
            onFinish: () => {
                session.releaseClient(threadId);
                session.endThreadTurn(threadId);
                logger.info("Codex node turn finished", { threadId, turnId });
            },
        });
        res.json({ ok: true, threadId });
    }));

    /** 按浏览器身份串行化 Codex 写操作；不同访客之间互不阻塞。 */
    function codexMutation(handler: (req: Request, res: Response) => unknown | Promise<unknown>) {
        return route(async (req, res) => {
            const ownerId = ownerIdOf(req);
            if (!session.beginCodexMutation(ownerId, activeThreadFor(ownerId))) {
                return res.status(409).json({ ok: false, code: "CONVERSATION_BUSY", error: "Codex 正在运行或正在切换会话，请稍后重试", state: session.conversationSnapshot(ownerId, activeThreadFor(ownerId)) });
            }
            try {
                return await handler(req, res);
            } finally {
                session.endCodexMutation(ownerId);
            }
        });
    }
    app.post("/agent/codex/approval", route(async (req, res) => {
        const decision = String(req.body?.decision || "");
        if (!["accept", "acceptForSession", "decline", "cancel"].includes(decision)) return res.status(400).json({ ok: false, error: "无效的审批决定" });
        const ok = await resolveCodexApproval(requestIdText(req.body?.requestId), decision);
        res.status(ok ? 200 : 409).json({ ok, ...(ok ? {} : { error: "审批请求已失效" }) });
    }));
    app.post("/agent/codex/user-input", route(async (req, res) => {
        const answers = userInputAnswers(req.body?.answers);
        if (!answers) return res.status(400).json({ ok: false, error: "无效的问答结果" });
        const ok = await resolveCodexUserInput(requestIdText(req.body?.requestId), answers);
        res.status(ok ? 200 : 409).json({ ok, ...(ok ? {} : { error: "问答请求已失效" }) });
    }));
    app.post("/agent/codex/interrupt", route(async (req, res) => {
        const ownerId = ownerIdOf(req);
        const requested = String(req.body?.threadId || "");
        const draft = skillDraftThreads.get(ownerId);
        const threadId = draft && (!requested || requested === draft.sourceThreadId) ? draft.threadId : requested || activeThreadFor(ownerId);
        if (!threadId) return res.status(400).json({ ok: false, error: "缺少可停止的会话" });
        assertThreadOwner(ownerId, threadId);
        const ok = await interruptCodexTurn(threadId);
        res.status(ok ? 200 : 409).json({ ok, ...(ok ? {} : { error: "当前没有可停止的任务" }) });
    }));
    app.get("/agent/cursor/status", route(async (_req, res) => res.json({ ok: true, ...(await getCursorCliStatus()) })));
    app.get("/agent/cursor/workspace", (req, res) => {
        const ownerId = ownerIdOf(req);
        res.json({ ok: true, workspace: ownerWorkspaceView(ownerId), conversation: cursorConversation(ownerId) });
    });
    app.get("/agent/cursor/skills", route(async (_req, res) => {
        const workspace = ensureSiteWorkspace(config);
        const result = listCursorSkills(workspace.workspacePath);
        res.json({ ok: true, data: result.skills, errors: result.errors });
    }));
    app.get("/agent/cursor/threads", (req, res) => {
        const ownerId = ownerIdOf(req);
        res.json({
            ok: true,
            workspace: ownerWorkspaceView(ownerId),
            conversation: cursorConversation(ownerId),
            data: listCursorThreads(ownerId),
        });
    });
    app.get("/agent/cursor/threads/:threadId", route(async (req, res) => {
        const ownerId = ownerIdOf(req);
        const threadId = routeParam(req.params.threadId);
        const thread = getCursorThread(threadId);
        if (!thread || thread.ownerId !== ownerId) return res.status(404).json({ ok: false, error: "会话不存在" });
        const messages = getCursorThreadMessages(threadId, ownerId);
        res.json({
            ok: true,
            workspace: ownerWorkspaceView(ownerId),
            conversation: cursorConversation(ownerId),
            thread: { id: thread.id, preview: thread.preview, createdAt: thread.createdAt, updatedAt: thread.updatedAt },
            messages,
            settledTurnIds: [...new Set(messages.map((item) => item.turnId).filter(Boolean))],
            historyReady: true,
        });
    }));
    app.post("/agent/cursor/threads/new", route(async (req, res) => {
        const ownerId = ownerIdOf(req);
        const workspace = ensureSiteWorkspace(config);
        const thread = resetCursorThread(ownerId, workspace.workspacePath, collaborationMode(req.body?.collaborationMode));
        recordThreadOwner(thread.id, ownerId);
        const conversation = cursorConversation(ownerId);
        session.emitOwner(ownerId, "conversation_changed", conversation);
        res.json({ ok: true, workspace: ownerWorkspaceView(ownerId), conversation, thread: { id: thread.id, preview: thread.preview } });
    }));
    app.post("/agent/cursor/threads/reset", route(async (req, res) => {
        const ownerId = ownerIdOf(req);
        const workspace = ensureSiteWorkspace(config);
        const thread = resetCursorThread(ownerId, workspace.workspacePath, collaborationMode(req.body?.collaborationMode));
        recordThreadOwner(thread.id, ownerId);
        const conversation = cursorConversation(ownerId);
        session.emitOwner(ownerId, "conversation_changed", conversation);
        res.json({ ok: true, workspace: ownerWorkspaceView(ownerId), conversation, thread: { id: thread.id, preview: thread.preview } });
    }));
    app.post("/agent/cursor/threads/:threadId/resume", route(async (req, res) => {
        const ownerId = ownerIdOf(req);
        const threadId = routeParam(req.params.threadId);
        const thread = activateCursorThread(ownerId, threadId);
        if (!thread) return res.status(404).json({ ok: false, error: "会话不存在" });
        recordThreadOwner(thread.id, ownerId);
        const conversation = cursorConversation(ownerId);
        const messages = getCursorThreadMessages(threadId, ownerId);
        session.emitOwner(ownerId, "conversation_changed", conversation);
        res.json({
            ok: true,
            contextMode: threadContextMode(threadId),
            workspace: ownerWorkspaceView(ownerId),
            conversation,
            thread: { id: thread.id, preview: thread.preview },
            messages,
            settledTurnIds: [...new Set(messages.map((item) => item.turnId).filter(Boolean))],
            historyReady: true,
        });
    }));
    app.post("/agent/cursor/threads/:threadId/delete", route(async (req, res) => {
        const ownerId = ownerIdOf(req);
        const threadId = routeParam(req.params.threadId);
        if (!deleteCursorThread(ownerId, threadId)) return res.status(404).json({ ok: false, error: "会话不存在" });
        res.json({ ok: true, workspace: ownerWorkspaceView(ownerId), conversation: cursorConversation(ownerId) });
    }));
    app.post("/agent/cursor/turn", route(async (req, res) => {
        const ownerId = ownerIdOf(req);
        const prompt = String(req.body?.prompt || "");
        if (!prompt.trim()) return res.status(400).json({ ok: false, error: "请输入任务内容" });
        const clientId = String(req.body?.clientId || "");
        if (!clientId || !session.hasClient(clientId, ownerId)) return res.status(409).json({ ok: false, error: "发起任务的网页已断开，请重新连接后再试" });
        const workspace = ensureSiteWorkspace(config);
        const requested = String(req.body?.threadId || cursorConversation(ownerId).threadId);
        const existing = requested ? getCursorThread(requested) : null;
        if (requested && (!existing || existing.ownerId !== ownerId)) return res.status(404).json({ ok: false, error: "会话不存在" });
        const mode = collaborationMode(req.body?.collaborationMode);
        const threadId = existing && existing.ownerId === ownerId ? existing.id : createCursorThread(ownerId, workspace.workspacePath, mode).id;
        let selectedSkill;
        if (req.body?.skill !== undefined) {
            const selector = skillSelector(req.body.skill);
            selectedSkill = listCursorSkills(workspace.workspacePath).skills.find((item) => item.name === selector.name && path.resolve(item.path) === path.resolve(selector.path));
            if (!selectedSkill) return res.status(400).json({ ok: false, error: "找不到指定 Skill，请刷新列表后重试" });
        }
        if (!session.tryBeginThreadTurn(threadId, ownerId, clientId)) return res.status(409).json({ ok: false, code: "CONVERSATION_BUSY", error: "Cursor 正在运行，请稍后再试" });
        let imageFiles: string[] = [];
        const clearImages = () => { void Promise.all(imageFiles.map((file) => unlink(file).catch(() => undefined))); };
        try {
            imageFiles = await writeAttachmentFiles(Array.isArray(req.body?.attachments) ? req.body.attachments : []);
            const input = imageFiles.length ? `${prompt}\n\n用户手动附加的图片：\n${imageFiles.map((file) => `@${JSON.stringify(file)}`).join("\n")}` : prompt;
            recordThreadOwner(threadId, ownerId);
            logger.info("Cursor turn accepted", { threadId, ownerId, promptLength: prompt.length });
            session.markConversationRunning(ownerId, threadId);
            const result = await runCursorTurn(withSelectedSkill(input, selectedSkill), emit, {
                ownerId,
                clientId,
                threadId,
                cwd: workspace.workspacePath,
                permissionMode: permissionMode(req.body?.permissionMode),
                collaborationMode: mode,
                messageText: String(req.body?.messageText || prompt),
                messageId: String(req.body?.messageId || ""),
                apiKey: String(req.body?.apiKey || process.env.CURSOR_API_KEY || ""),
                onFinish: (finishedThreadId) => {
                    clearImages();
                    session.endThreadTurn(finishedThreadId);
                    session.finishConversationRun(ownerId, finishedThreadId);
                },
            });
            res.json({ ok: true, threadId: result.threadId, conversation: cursorConversation(ownerId) });
        } catch (error) {
            clearImages();
            session.endThreadTurn(threadId);
            session.finishConversationRun(ownerId, threadId);
            throw error;
        }
    }));
    app.post("/agent/cursor/user-input", route(async (req, res) => {
        const answers = userInputAnswers(req.body?.answers);
        if (!answers) return res.status(400).json({ ok: false, error: "无效的问答结果" });
        const ok = resolveCursorUserInput(requestIdText(req.body?.requestId), answers);
        res.status(ok ? 200 : 409).json({ ok, ...(ok ? {} : { error: "问答请求已失效" }) });
    }));
    app.post("/agent/cursor/approval", route(async (req, res) => {
        const decision = String(req.body?.decision || "");
        if (!["accept", "acceptForSession", "decline", "cancel"].includes(decision)) return res.status(400).json({ ok: false, error: "无效的审批决定" });
        const ok = resolveCursorApproval(requestIdText(req.body?.requestId), decision);
        res.status(ok ? 200 : 409).json({ ok, ...(ok ? {} : { error: "审批请求已失效" }) });
    }));
    app.post("/agent/cursor/interrupt", (req, res) => {
        const ownerId = ownerIdOf(req);
        const threadId = String(req.body?.threadId || cursorConversation(ownerId).threadId);
        const thread = threadId ? getCursorThread(threadId) : null;
        if (!thread || thread.ownerId !== ownerId) return res.status(404).json({ ok: false, error: "会话不存在" });
        const ok = interruptCursorTurn(threadId);
        res.status(ok ? 200 : 409).json({ ok, ...(ok ? {} : { error: "当前没有可停止的任务" }) });
    });
    app.post("/agent/claude/turn", (req, res) => {
        runClaudeTurn(String(req.body?.prompt || ""), emit);
        res.json({ ok: true });
    });
    app.use((_req, res) => res.status(404).json({ ok: false, error: "not found" }));
    app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
        logger.error("HTTP request failed", { method: req.method, path: req.path, error });
        if (error instanceof SkillStoreError || error instanceof CodexSkillLookupError) return void res.status(error.statusCode).json({ ok: false, error: error.message });
        const status = Number((error as Error & { statusCode?: number }).statusCode);
        if (status >= 400 && status < 600) return void res.status(status).json({ ok: false, error: error.message });
        res.status(500).json({ ok: false, error: error.message });
    });

    app.listen(port, "127.0.0.1", () => {
        console.log("Infinite Canvas Agent");
        checkVersions();
        console.log(`Local URL: ${config.url}`);
        console.log(`Connect token: ${config.token}`);
        console.log("Codex MCP is not installed by this command.");
        console.log("Optional MCP add: codex mcp add infinite-canvas -- npx -y @basketikun/canvas-agent mcp");
        console.log("Remove manually added MCP: codex mcp remove infinite-canvas");
        if (logger.enabled) console.log(`Debug log: ${logger.filePath}`);
        logger.info("Canvas Agent started", { url: config.url, workspace: ensureSiteWorkspace(config).workspacePath, debugLog: logger.filePath });
        // 等浏览器告知引擎与模式再准备会话，避免轻量聊天先预热上次的完整画布 MCP。
    });
}

/** 将异步 Express 路由异常交给统一错误处理中间件。 */
function route(handler: (req: Request, res: Response) => Promise<unknown>) {
    return (req: Request, res: Response, next: NextFunction) => void handler(req, res).catch(next);
}

/** 从 Express 路由参数中读取单个字符串。 */
function routeParam(value: string | string[]) {
    return Array.isArray(value) ? value[0] || "" : value;
}

function permissionMode(value: unknown): AgentPermissionMode {
    return value === "automatic" || value === "full" ? value : "request";
}

function collaborationMode(value: unknown): AgentCollaborationMode {
    return value === "plan" || value === "default" ? value : "chat";
}

function userInputAnswers(value: unknown): Record<string, string[]> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const answers: Record<string, string[]> = {};
    for (const [id, item] of Object.entries(value as Record<string, unknown>)) {
        if (!id.trim()) return null;
        const values = Array.isArray(item) ? item : typeof item === "string" ? [item] : null;
        if (!values || values.some((entry) => typeof entry !== "string" || !entry.trim())) return null;
        answers[id] = values.map((entry) => String(entry));
    }
    return Object.keys(answers).length ? answers : null;
}

function reasoningEffort(value: unknown): CodexReasoningEffort | undefined {
    return value === "none" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max" || value === "ultra" ? value : undefined;
}

/** 把请求路径限制在 Codex 工作空间内，越界返回空串 */
function resolveInsideWorkspace(workspacePath: string, target: string) {
    if (!target || !path.isAbsolute(target)) return "";
    const root = path.resolve(workspacePath);
    const resolved = path.resolve(target);
    const relative = path.relative(root, resolved);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? resolved : "";
}

/** 递归列出产物目录里的文件，路径相对目录本身 */
async function listWorkspaceFiles(dir: string, prefix = "", depth = 0): Promise<Array<{ path: string; size: number }>> {
    if (depth > 4) return [];
    const items = await readdir(dir, { withFileTypes: true });
    const files: Array<{ path: string; size: number }> = [];
    for (const item of items) {
        if (item.name.startsWith(".") || files.length >= 200) continue;
        const relative = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.isDirectory()) {
            files.push(...await listWorkspaceFiles(path.join(dir, item.name), relative, depth + 1));
            continue;
        }
        const info = await stat(path.join(dir, item.name)).catch(() => null);
        if (info?.isFile()) files.push({ path: relative, size: info.size });
    }
    return files;
}

function startupStatus(value: unknown): "starting" | "ready" | "failed" | "cancelled" {
    return value === "starting" || value === "ready" || value === "failed" ? value : "cancelled";
}

function mcpInventory(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const server = item as Record<string, unknown>;
        const name = String(server.name || "");
        return name ? [{ name, authStatus: String(server.authStatus || "") || undefined }] : [];
    });
}

/** 读取浏览器提交的 Skill 选择器；真实路径随后必须通过原生列表校验。 */
function skillSelector(value: unknown): CodexSkillSelector {
    const selector = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const name = typeof selector.name === "string" ? selector.name : "";
    const skillPath = typeof selector.path === "string" ? selector.path : "";
    if (!name || !skillPath) throw new CodexSkillLookupError("Skill 选择无效", 400);
    return { name, path: skillPath };
}

/** 使用当前操作系统的文件管理器定位本地文件。 */
function revealLocalFile(filePath: string, isDirectory: boolean) {
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
    const args = process.platform === "darwin"
        ? ["-R", filePath]
        : process.platform === "win32"
            ? [isDirectory ? filePath : `/select,${filePath}`]
            : [isDirectory ? filePath : path.dirname(filePath)];
    return new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { detached: true, stdio: "ignore" });
        child.once("spawn", () => {
            child.unref();
            resolve();
        });
        child.once("error", reject);
    });
}

/** 结合服务配置解析当前请求 URL。 */
function requestUrl(req: Request, config: CanvasAgentConfig) {
    return new URL(req.originalUrl || req.url || "/", config.url);
}

/** 设置跨域响应头并记录通过 token 授权的来源。 */
function setCors(req: Request, res: Response, url: URL, config: CanvasAgentConfig) {
    const origin = req.headers.origin;
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type,x-canvas-agent-token");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    if (!origin || req.method === "OPTIONS" || url.pathname === "/health" || url.pathname === "/config") return true;
    config.origins ||= [];
    if (validToken(req, url, config.token) && !config.origins.includes(origin)) {
        config.origins.push(origin);
        saveConfig(config);
    }
    res.setHeader("Vary", "Origin");
    return config.origins.includes(origin);
}

/** 校验请求查询参数或请求头中的连接 token。 */
function validToken(req: Request, url: URL, token: string) {
    const header = req.headers["x-canvas-agent-token"];
    return url.searchParams.get("token") === token || header === token || (Array.isArray(header) && header.includes(token));
}

/** 向 Agent 提示词追加本轮图片附件引用说明。 */
function withAttachmentContext(prompt: string, attachments: Array<{ id: string; name: string; canvasNodeId?: string }>) {
    if (!attachments.length) return prompt;
    const onCanvas = attachments.filter((item) => item.canvasNodeId);
    const uploadOnly = attachments.filter((item) => !item.canvasNodeId);
    const lines: string[] = ["本轮可用图片（顺序与图片输入一致）："];
    attachments.forEach((item, index) => {
        if (item.canvasNodeId) {
            lines.push(`${index + 1}. 已在画布 · canvasNodeId=${item.canvasNodeId} · name=${JSON.stringify(item.name)} · attachmentId=${item.id}`);
        } else {
            lines.push(`${index + 1}. 仅聊天附件 · attachmentId=${item.id} · name=${JSON.stringify(item.name)}`);
        }
    });
    lines.push("");
    if (onCanvas.length) {
        lines.push(`【禁止复制】以下图片已是画布节点，生图时直接把它们的 canvasNodeId 传给 canvas_generate_image.referenceNodeIds：${onCanvas.map((item) => item.canvasNodeId).join(", ")}`);
        lines.push("禁止再对这些节点调用 canvas_create_attachment_nodes（会在画布上复制出重复图片）。");
    }
    if (uploadOnly.length) {
        lines.push(`【仅这些】聊天上传、画布上尚无节点的附件才用 canvas_create_attachment_nodes：${uploadOnly.map((item) => item.id).join(", ")}，再用返回的节点 ID 作为 referenceNodeIds。`);
    } else {
        lines.push("本轮没有需要新建的聊天附件节点。");
    }
    return `${prompt}\n\n${lines.join("\n")}`;
}
