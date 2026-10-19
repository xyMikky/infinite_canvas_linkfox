import { useEffect, useRef, useState } from "react";
import { Switch } from "antd";
import { Check, Eye, FileText, ImageIcon, Loader2, LocateFixed, MessagesSquare, Play, X } from "lucide-react";

import { XingXiaochiAvatar } from "@/components/canvas/xing-xiaochi-avatar";
import { XingXiaochiLive } from "@/components/canvas/xing-xiaochi-live";
import { xingLiveSizeForNode } from "@/lib/canvas/xing-xiaochi-ports";
import type { XingAgentMood } from "@/lib/canvas/xing-xiaochi-ports";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { getVerticalResultPlacement } from "@/lib/canvas/canvas-batch-layout";
import { imageMetadata } from "@/lib/canvas/canvas-node-factory";
import { CanvasConfigComposer } from "@/components/canvas/canvas-config-composer";
import { buildComposerGenerationContext, buildNodeGenerationInputs, pickMentionedSkill, type NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import { applyCodexAgentFilesToCanvas, applyCodexAgentRunDirToCanvas, buildCodexAgentExecutionPrompt, buildCodexAgentSystemPrompt, codexAgentFallbackFiles, parseCodexAgentOutput } from "@/lib/canvas/codex-agent-output";
import { interruptCodexTurn, listAgentWorkspaceDir, readAgentWorkspaceFile } from "@/services/api/canvas-agent";
import { buildCodexImageSystemPrompt, CODEX_IMAGE_NODE_TYPE, resolveExpectedCodexCount, useCodexImageJobStore, type CodexImageJobRequest } from "@/stores/use-codex-image-job-store";
import { codexTextJob, useCodexTextJobStore, waitForCodexTextJob } from "@/stores/use-codex-text-job-store";
import { launchQueuedCodexTextJob } from "@/components/agent/codex-text-job-runner";
import { collectUpstreamCodexSkill, CODEX_SKILL_NODE_TYPE, readCodexSkillRef } from "@/components/canvas/nodes/codex-skill-node";
import { FOLDER_NODE_TYPE } from "@/components/canvas/nodes/folder-node";
import { SMART_PREVIEW_NODE_TYPE } from "@/components/canvas/nodes/smart-preview-node";
import { folderDiskPathPromptBlock, resolveFolderDiskPathFromNode } from "@/lib/canvas/folder-disk-path";
import { folderInputSummary, resolveFolderSourceNode } from "@/lib/canvas/folder-input-resolve";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { useAgentStore, type AgentAttachment, type AgentReasoningEffort } from "@/stores/use-agent-store";
import { uploadImage } from "@/services/image-storage";
import type { CanvasNodeDefinition, CanvasNodeContext } from "@/types/canvas-plugin";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { CanvasNodeType } from "@/types/canvas";
import { nanoid } from "nanoid";

const SIZE_OPTIONS = [
    { value: "auto", label: "auto" },
    { value: "1024x1024", label: "1:1 · 1024" },
    { value: "1536x1024", label: "3:2 · 1536×1024" },
    { value: "1024x1536", label: "2:3 · 1024×1536" },
];

const FALLBACK_EFFORTS: AgentReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

type CodexNodeMode = "agent" | "image";

function metaString(metadata: CanvasNodeMetadata | undefined, key: keyof CanvasNodeMetadata, fallback = "") {
    const value = metadata?.[key];
    return typeof value === "string" ? value : fallback;
}

/** 未标记模式的老节点按生图处理，新建节点默认智能体 */
function readCodexMode(metadata: CanvasNodeMetadata | undefined): CodexNodeMode {
    return metadata?.codexMode === "agent" ? "agent" : "image";
}

function settleCodexJobOnNode(ctx: CanvasNodeContext, job: CodexImageJobRequest, mode: "done" | "error", fallbackError: string) {
    if (mode === "error") {
        settleCodexPlaceholders(ctx.applyOps, job.placeholderNodeIds || [], job.importedCount, "error", job.error || fallbackError);
        ctx.updateMetadata({
            codexPhase: "idle",
            thinkingLog: job.thinking || job.error || fallbackError,
            errorDetails: job.error || fallbackError,
        });
        return;
    }
    settleCodexPlaceholders(ctx.applyOps, job.placeholderNodeIds || [], job.importedCount, "remove");
    ctx.updateMetadata({
        codexPhase: "idle",
        thinkingLog: job.thinking,
        errorDetails: "",
    });
}

function CodexImageContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { t } = useTranslation();
    const phase = ctx.node.metadata?.codexPhase || "idle";
    const error = metaString(ctx.node.metadata, "errorDetails");
    const agentMode = readCodexMode(ctx.node.metadata) === "agent";
    const job = useCodexImageJobStore((state) => state.jobs.find((item) => item.nodeId === ctx.node.id) || null);
    const textJob = useCodexTextJobStore((state) => state.jobs.find((item) => item.sourceNodeId === ctx.node.id) || null);
    const textRunning = textJob?.status === "queued" || textJob?.status === "running";
    const clearJob = useCodexImageJobStore((state) => state.clear);
    // job 已结束时不再看 phase，避免面板关闭后仍卡在「生图中」
    const running = job?.status === "queued" || job?.status === "running" || textRunning || (phase === "running" && !job && !textJob);
    // Codex 节点始终保持控制外观，结果图另建 image 节点并连线（不再把本节点变成图片）

    // 面板关闭时也要收尾；并清理无 job 却残留 running 的状态
    useEffect(() => {
        if (job) {
            if (job.status === "done" || job.status === "error") {
                settleCodexJobOnNode(ctx, job, job.status === "done" ? "done" : "error", t("canvas.codexImage.failed"));
                clearJob(job.id);
            }
            return;
        }
        if (phase !== "running" || textRunning) return;
        const timer = window.setTimeout(() => {
            if ((ctx.node.metadata?.codexPhase || "idle") !== "running") return;
            ctx.updateMetadata({ codexPhase: "idle" });
        }, 0);
        return () => window.clearTimeout(timer);
    }, [job?.id, job?.status, job?.error, job?.thinking, job?.importedCount, phase, textRunning, clearJob, ctx, t]);

    // 旧默认大方框 → 收成形象比例
    useEffect(() => {
        if ((ctx.node.width === 360 && ctx.node.height === 280) || (ctx.node.width === 148 && ctx.node.height === 172) || (ctx.node.width === 132 && ctx.node.height === 158)) {
            ctx.updateNode({ width: 128, height: 128 });
        }
    }, [ctx]);

    const mood: XingAgentMood = error
        ? "error"
        : job?.status === "done" || textJob?.status === "done"
          ? "success"
          : job?.status === "queued" || textJob?.status === "queued"
            ? "queued"
            : running
              ? "running"
              : "idle";

    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-transparent text-center">
            <div
                className="relative grid place-items-center"
                style={
                    ctx.isSelected
                        ? { filter: `drop-shadow(0 0 12px ${ctx.theme.node.selected}) drop-shadow(0 0 2px ${ctx.theme.node.selected})` }
                        : undefined
                }
            >
                <XingXiaochiLive nodeId={ctx.node.id} size={xingLiveSizeForNode(ctx.node)} mood={mood} followPointer />
            </div>
{running ? (
                <div className="text-[11px] opacity-70" style={{ color: ctx.theme.node.muted }}>
                    {t(agentMode ? "canvas.codexAgent.running" : "canvas.codexImage.generating")}
                </div>
            ) : null}
            {error ? <div className="max-w-[9rem] text-[11px] text-red-400">{error}</div> : null}
        </div>
    );
}

function CodexImagePanel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const { t } = useTranslation();
    const connected = useAgentStore((state) => state.connected);
    const models = useAgentStore((state) => state.models);
    const model = useAgentStore((state) => state.model);
    const reasoningEffort = useAgentStore((state) => state.reasoningEffort || "none");
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const job = useCodexImageJobStore((state) => state.jobs.find((item) => item.nodeId === ctx.node.id) || null);
    const queue = useCodexImageJobStore((state) => state.queue);
    const clearJob = useCodexImageJobStore((state) => state.clear);
    const failJob = useCodexImageJobStore((state) => state.fail);

    const [prompt, setPrompt] = useState(metaString(ctx.node.metadata, "prompt"));
    const [size, setSize] = useState(metaString(ctx.node.metadata, "size", "auto") || "auto");
    const [count, setCount] = useState(() => {
        const value = ctx.node.metadata?.count;
        return value == null || value < 1 ? "auto" : String(Math.min(4, value));
    });
    const [mode, setMode] = useState<CodexNodeMode>(readCodexMode(ctx.node.metadata));
    const [exec, setExec] = useState(ctx.node.metadata?.codexExec !== false);
    const [excludedInputs, setExcludedInputs] = useState<string[]>(ctx.node.metadata?.codexExcludedInputIds || []);
    const [continueTask, setContinueTask] = useState(Boolean(ctx.node.metadata?.codexAgentResult?.threadId));
    const [submissionStage, setSubmissionStage] = useState("");
    const submittingRef = useRef(false);
    const canceledRef = useRef(false);
    const result = ctx.node.metadata?.codexAgentResult;
    const agentMode = mode === "agent";
    const endpoint = useAgentStore((state) => state.url.trim().replace(/\/$/, ""));
    const token = useAgentStore((state) => state.token);
    const workspacePath = useAgentStore((state) => state.workspacePath);
    const textJob = useCodexTextJobStore((state) => state.jobs.find((item) => item.sourceNodeId === ctx.node.id) || null);
    const textRunning = textJob?.status === "queued" || textJob?.status === "running";
    const taskThreadId = job?.threadId || textJob?.threadId || metaString(ctx.node.metadata, "codexThreadId");
    const currentModel = models.find((item) => item.model === model) || models[0];
    const effortOptions = currentModel?.supportedReasoningEfforts?.length
        ? currentModel.supportedReasoningEfforts.map((item) => item.reasoningEffort)
        : FALLBACK_EFFORTS;
    const upstreamAttachments = collectUpstreamAttachments(ctx);
    const availableInputs = [...new Map(buildCodexComposerInputs(ctx, { detailedFolders: agentMode }).map((input) => [input.nodeId, input])).values()];
    const composerInputs = agentMode ? availableInputs.filter((input) => !excludedInputs.includes(input.nodeId) && input.skill?.enabled !== false && input.type !== "video" && input.type !== "audio") : availableInputs;
    const selectedSkill = pickMentionedSkill(prompt, composerInputs) || composerInputs.find((input) => input.skill)?.skill;
    const upstreamSkill = collectUpstreamCodexSkill(ctx.getUpstream()) || collectConnectedCodexSkill(ctx);
    const upstreamSkillNode =
        ctx.getUpstream().find((node) => node.type === CODEX_SKILL_NODE_TYPE && node.metadata?.skillName && node.metadata?.skillPath)
        || collectConnectedSkillNode(ctx);
    const localRefs = (ctx.node.metadata?.references || []).filter(Boolean);
    const running = Boolean(submissionStage) || job?.status === "queued" || job?.status === "running" || textRunning || ctx.node.metadata?.codexPhase === "running";
    const errorText = job?.status === "error" ? job.error : ctx.node.metadata?.errorDetails;
    // 节点任务独占 Codex 线程，不再受主对话状态影响
    const statusText = !connected
        ? t("canvas.codexImage.agentRequired")
        : job?.status === "queued" || textJob?.status === "queued"
            ? t("canvas.codexImage.statusQueued")
            : running
                ? submissionStage || t("canvas.codexImage.statusRunning")
                : errorText || (agentMode && result ? `已完成 · ${result.count} 个文件` : t("canvas.codexImage.agentReady"));
    const statusIsError = Boolean(errorText) || !connected;
    // Codex 的思考摘要只有一行行加粗标题，去掉 ** 直接按纯文本展示
    const thinkingText = ((agentMode ? textJob?.statusLog : job?.cliLog) || metaString(ctx.node.metadata, "thinkingLog")).replace(/\*\*/g, "").trim();

    // 仅在 Agent 真正断开时复位；会话初始化中不要误报「请先连接」
    useEffect(() => {
        if (!running || connected) return;
        if (job) {
            failJob(t("canvas.codexImage.agentRequired"), job.id);
            return;
        }
        if (textJob) {
            useCodexTextJobStore.getState().fail(t("canvas.codexImage.agentRequired"), textJob.id);
            return;
        }
        ctx.updateMetadata({
            codexPhase: "idle",
            errorDetails: t("canvas.codexImage.agentRequired"),
            thinkingLog: t("canvas.codexImage.thinkingNotStarted"),
        });
    }, [connected, running, job?.id, textJob?.id]);

    const resolvedCount = count === "auto" || !count ? 0 : Math.max(1, Math.min(4, Number(count) || 1));
    // 点空白处关面板时 blur 不一定触发；输入即时落盘 + 卸载再落一次，避免重开丢字
    const draftRef = useRef({ prompt, size, count: resolvedCount, mode, exec });
    draftRef.current = { prompt, size, count: resolvedCount, mode, exec };
    const updateMetadataRef = useRef(ctx.updateMetadata);
    updateMetadataRef.current = ctx.updateMetadata;

    const persistParams = (patch?: Partial<{ prompt: string; size: string; count: number; mode: CodexNodeMode; exec: boolean }>) => {
        const next = { ...draftRef.current, ...patch };
        draftRef.current = next;
        updateMetadataRef.current({
            prompt: next.prompt,
            size: next.size,
            count: next.count,
            codexMode: next.mode,
            codexExec: next.exec,
        });
    };

    useEffect(() => {
        return () => {
            const draft = draftRef.current;
            updateMetadataRef.current({
                prompt: draft.prompt,
                size: draft.size,
                count: draft.count,
                codexMode: draft.mode,
                codexExec: draft.exec,
            });
        };
    }, []);

    useEffect(() => {
        if (!job) return;
        if (job.status === "running" || job.status === "queued") {
            ctx.updateMetadata({
                prompt,
                size,
                count: resolvedCount,
                codexPhase: "running",
                thinkingLog: job.thinking || t("canvas.codexImage.thinkingQueued"),
                errorDetails: "",
                ...(job.threadId ? { codexThreadId: job.threadId } : {}),
            });
        }
        // done / error 由 Content 收尾（面板关闭时也能复位）
    }, [job?.status, job?.thinking, job?.error, job?.threadId, resolvedCount]);

    // 智能体任务的线程也记到节点上，方便随时切回该会话
    useEffect(() => {
        if (textJob?.threadId) ctx.updateMetadata({ codexThreadId: textJob.threadId });
    }, [textJob?.threadId]);

    const onEffortChange = (value: string) => {
        const effort = value as AgentReasoningEffort;
        localStorage.setItem("canvas-agent-reasoning-effort", effort);
        setAgentState({ reasoningEffort: effort });
    };

    const onCancel = () => {
        canceledRef.current = true;
        if (job) {
            settleCodexPlaceholders(ctx.applyOps, job.placeholderNodeIds || [], job.importedCount, "error", t("canvas.codexImage.canceled"));
            failJob(t("canvas.codexImage.canceled"), job.id);
        }
        if (textJob) useCodexTextJobStore.getState().fail(t("canvas.codexImage.canceled"), textJob.id);
        const activeThreadId = job?.threadId || textJob?.threadId;
        if (activeThreadId) void interruptCodexTurn(endpoint, token, activeThreadId).catch(() => undefined);
        ctx.updateMetadata({
            codexPhase: "idle",
            errorDetails: t("canvas.codexImage.canceled"),
            thinkingLog: t("canvas.codexImage.thinkingNotStarted"),
        });
        if (job) clearJob(job.id);
    };

    const onGenerate = async () => {
        const rawPrompt = prompt.trim();
        if (!rawPrompt) return;
        if (!connected) {
            ctx.updateMetadata({
                codexPhase: "idle",
                errorDetails: t("canvas.codexImage.agentRequired"),
                thinkingLog: t("canvas.codexImage.thinkingNotStarted"),
            });
            useAgentStore.getState().openPanel({ tab: "chat" });
            return;
        }
        // 只挡本节点自己正在跑的任务；其它节点各自独占线程，可并发
        if (running) {
            ctx.updateMetadata({ errorDetails: t("canvas.codexImage.agentBusy") });
            return;
        }
        persistParams();
        const hasMentions = /@\[node:[^\]]+\]/.test(rawPrompt);
        const resolved = hasMentions ? buildComposerGenerationContext(composerInputs, rawPrompt) : null;
        const userPrompt = resolved?.prompt.trim() || rawPrompt;
        const mentionAttachments = resolved ? await referenceImagesToAttachments(resolved.referenceImages) : upstreamAttachments;
        const attachments = await buildAttachments(ctx, localRefs, mentionAttachments);
        const skill = pickMentionedSkill(rawPrompt, composerInputs) || upstreamSkill;
        const expectedCount = resolveExpectedCodexCount(userPrompt, resolvedCount);
        // 强制张数：立刻占位；auto：等 Codex 输出 COUNT: N 后再占位
        const placeholderNodeIds = expectedCount >= 1
            ? createCodexLoadingPlaceholders(ctx.applyOps, {
                id: ctx.node.id,
                position: ctx.node.position,
                width: ctx.node.width,
                height: ctx.node.height,
                references: localRefs,
            }, expectedCount, userPrompt)
            : [];
        const fullPrompt = buildCodexImageSystemPrompt({
            nodeId: ctx.node.id,
            size,
            count: resolvedCount,
            expectedCount,
            userPrompt,
            hasReferences: attachments.length > 0,
        });
        ctx.updateMetadata({
            codexPhase: "running",
            thinkingLog: t("canvas.codexImage.thinkingQueued"),
            errorDetails: "",
            prompt: rawPrompt,
            size,
            count: resolvedCount,
        });
        queue({
            nodeId: ctx.node.id,
            prompt: fullPrompt,
            size,
            quality: "medium",
            count: resolvedCount,
            expectedCount,
            placeholderNodeIds,
            attachments,
            ...(skill ? { skill } : {}),
        });
        // 打开右侧 Agent 并切到对话页（不要停在连接设置）
        useAgentStore.getState().openPanel({ tab: "chat" });
    };

    const onModeChange = (next: CodexNodeMode) => {
        if (next === mode) return;
        setMode(next);
        persistParams({ mode: next });
    };

    const onPromptChange = (value: string) => {
        setPrompt(value);
        persistParams({ prompt: value });
    };

    const onRunAgent = async () => {
        const rawPrompt = prompt.trim();
        if (!rawPrompt || submittingRef.current || running) return;
        if (!connected) {
            ctx.updateMetadata({
                codexPhase: "idle",
                errorDetails: t("canvas.codexImage.agentRequired"),
                thinkingLog: t("canvas.codexImage.thinkingNotStarted"),
            });
            useAgentStore.getState().openPanel({ tab: "chat" });
            return;
        }
        persistParams();
        submittingRef.current = true;
        canceledRef.current = false;
        setSubmissionStage("正在准备资料…");
        ctx.updateMetadata({ thinkingLog: "正在准备资料…", errorDetails: "" });
        let jobId = "";
        try {
            // 智能体模式始终注入上游正文（Excel/文本/文件夹），@ 只负责换成可读标签
            const resolved = buildComposerGenerationContext(composerInputs, rawPrompt);
            const referenceAttachments = await referenceImagesToAttachments(resolved.referenceImages);
            if (referenceAttachments.length !== resolved.referenceImages.length) throw new Error("部分参考图无法读取，请重新添加后执行");
            const attachments = await buildAttachments(ctx, localRefs, referenceAttachments, true);
            if (canceledRef.current) return;
            const skill = selectedSkill;
            const previousOutputs = (result?.nodeIds || []).map((id) => ctx.getNode(id)).filter((node): node is CanvasNodeData => Boolean(node));
            const source = {
                id: ctx.node.id,
                position: { ...ctx.node.position, y: Math.max(ctx.node.position.y, ...previousOutputs.map((node) => node.position.y + node.height + 40)) },
                width: ctx.node.width,
                height: ctx.node.height,
            };
            const referenceCanvasNodeIds = [...new Set(attachments.map((item) => item.canvasNodeId).filter(Boolean))] as string[];
            const runDir = exec && workspacePath ? codexRunDir(workspacePath) : "";
            if (exec && !runDir) {
                ctx.updateMetadata({ errorDetails: t("canvas.codexAgent.workspaceRequired") });
                return;
            }
            const title = rawPrompt.slice(0, 24) || t("canvas.codexAgent.resultTitle");
            ctx.updateMetadata({
                codexPhase: "running",
                thinkingLog: t("canvas.codexImage.thinkingQueued"),
                errorDetails: "",
                prompt: rawPrompt,
            });
            jobId = useCodexTextJobStore.getState().queue({
                sourceNodeId: ctx.node.id,
                ...(continueTask && result?.threadId ? { resumeThreadId: result.threadId } : {}),
                prompt: runDir
                    ? buildCodexAgentExecutionPrompt({
                        nodeId: ctx.node.id,
                        userPrompt: resolved.prompt.trim() || rawPrompt,
                        hasReferences: attachments.length > 0,
                        outputDir: runDir,
                        referenceCanvasNodeIds,
                        ...(skill ? { skillName: skill.name } : {}),
                    })
                    : buildCodexAgentSystemPrompt({
                        nodeId: ctx.node.id,
                        userPrompt: resolved.prompt.trim() || rawPrompt,
                        hasReferences: attachments.length > 0,
                        ...(skill ? { skillName: skill.name } : {}),
                    }),
                messageText: rawPrompt.slice(0, 500),
                attachments,
                ...(skill ? { skill } : {}),
                ...(runDir ? { permissionMode: "full" as const } : {}),
            });
            // 入队后立刻发送，避免只靠面板订阅时漏触发导致一直停在「已排队」
            setSubmissionStage("正在执行任务…");
            void launchQueuedCodexTextJob();
            // 联网执行会真的跑抓取和脚本，15 分钟不够
            const text = await waitForCodexTextJob(jobId, runDir ? { timeoutMs: 60 * 60 * 1000 } : undefined);
            if (canceledRef.current) return;
            setSubmissionStage("正在整理产物…");
            // 任务清空前留存思考摘要，面板重开仍能看到本轮思考
            const thinking = codexTextJob(jobId)?.statusLog?.trim() || "";
            const completedThreadId = codexTextJob(jobId)?.threadId || "";
            const runFiles = runDir ? await collectCodexRunFiles(endpoint, token, runDir) : [];
            if (canceledRef.current) return;
            const runResult = runFiles.length
                ? await applyCodexAgentRunDirToCanvas({ applyOps: ctx.applyOps, source, files: runFiles, title })
                : await applyCodexAgentFilesToCanvas({
                    applyOps: ctx.applyOps,
                    source,
                    files: parseCodexAgentOutput(text).length ? parseCodexAgentOutput(text) : codexAgentFallbackFiles(text),
                    title,
                });
            ctx.updateMetadata({
                codexPhase: "idle",
                errorDetails: runResult.count ? "" : t("canvas.codexAgent.emptyResult"),
                thinkingLog: thinking || (runResult.count ? t("canvas.codexAgent.done", { count: runResult.count }) : text.slice(-4000)),
                codexThreadId: completedThreadId,
                ...(runResult.count ? { codexAgentResult: { nodeIds: runResult.nodeIds, previewNodeId: runResult.previewNodeId, count: runResult.count, threadId: completedThreadId } } : {}),
            });
            if (runResult.count) {
                setContinueTask(true);
                if (draftRef.current.prompt === rawPrompt) onPromptChange("");
            }
        } catch (error) {
            ctx.updateMetadata({
                codexPhase: "idle",
                errorDetails: error instanceof Error ? error.message : t("canvas.codexAgent.failed"),
            });
        } finally {
            if (jobId) useCodexTextJobStore.getState().clear(jobId);
            submittingRef.current = false;
            setSubmissionStage("");
        }
    };

    const fieldStyle = {
        background: ctx.theme.node.fill,
        color: ctx.theme.node.text,
        borderColor: ctx.theme.node.stroke,
    } as const;

    return (
        <div
            data-canvas-no-zoom
            data-canvas-shortcuts-ignore
            className="thin-scrollbar max-h-[70vh] w-full overflow-y-auto rounded-[22px] border p-4 shadow-xl backdrop-blur"
            style={{ background: ctx.theme.node.panel, borderColor: ctx.theme.node.stroke, color: ctx.theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                    <XingXiaochiAvatar size={22} />
                    {t(agentMode ? "canvas.codexAgent.panelTitle" : "canvas.codexImage.panelTitle")}
                    {agentMode ? null : (
                        <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: ctx.theme.toolbar.activeBg, color: ctx.theme.node.muted }}>
                            gpt-image-2
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-0.5 rounded-full p-0.5">
                        {(["agent", "image"] as const).map((item) => (
                            <button
                                key={item}
                                type="button"
                                disabled={running}
                                className="rounded-full px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-50"
                                style={item === mode ? { background: ctx.theme.toolbar.activeBg, color: ctx.theme.node.text } : { color: ctx.theme.node.muted }}
                                onClick={() => onModeChange(item)}
                            >
                                {t(`canvas.codexAgent.mode.${item}`)}
                            </button>
                        ))}
                    </div>
                    <button type="button" aria-label={t("canvas.createMenu.close")} className="rounded-lg p-1.5 opacity-60 hover:opacity-100" onClick={onClose}>
                        <X className="size-4" />
                    </button>
                </div>
            </div>

            {!agentMode && upstreamSkill ? (
                <div className="mb-3 rounded-xl border px-3 py-2 text-xs leading-5" style={{ borderColor: ctx.theme.node.stroke, color: ctx.theme.node.text, background: ctx.theme.node.fill }}>
                    <div className="font-medium">{t("canvas.codexImage.boundSkill", { name: upstreamSkillNode?.metadata?.skillDisplayName || upstreamSkill.name })}</div>
                    {upstreamSkillNode?.metadata?.skillEnabled === false ? (
                        <div className="mt-1 text-amber-400">{t("canvas.codexSkill.disabledHint")}</div>
                    ) : (
                        <div className="mt-1 opacity-70">{t(agentMode ? "canvas.codexAgent.boundSkillHint" : "canvas.codexImage.boundSkillHint")}</div>
                    )}
                </div>
            ) : null}

            <CanvasConfigComposer
                embedded
                className="mb-3"
                value={prompt}
                inputs={composerInputs}
                onChange={onPromptChange}
                onBlur={() => persistParams()}
                placeholder={agentMode && continueTask && result?.threadId ? "继续修改结果，例如：第二页换成暖色，保留其他内容…" : t(agentMode ? "canvas.codexAgent.promptPlaceholder" : "canvas.codexImage.promptPlaceholder")}
            />

            {agentMode && availableInputs.length > 0 ? (
                <div className="mb-3 text-xs" style={{ color: ctx.theme.node.muted }}>
                    <div className="mb-1.5 flex items-center justify-between">
                        <span>本次资料 · {composerInputs.filter((input) => input.type !== "skill" || input.skill?.path === selectedSkill?.path).length} 项</span>
                        <span className="text-[10px]">取消勾选可排除，保留连线</span>
                    </div>
                    <div className="thin-scrollbar flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                        {availableInputs.map((input) => {
                            const included = composerInputs.some((item) => item.nodeId === input.nodeId);
                            const used = included && (input.type !== "skill" || input.skill?.path === selectedSkill?.path);
                            return (
                                <div key={input.nodeId} className="flex min-w-0 max-w-full items-center gap-1 rounded-md border px-1.5 py-1" style={{ borderColor: ctx.theme.node.stroke, opacity: included ? 1 : 0.55 }}>
                                    <input
                                        type="checkbox"
                                        checked={included}
                                        disabled={running || input.skill?.enabled === false || input.type === "video" || input.type === "audio"}
                                        aria-label={`使用 ${input.title}`}
                                        onChange={() => {
                                            const next = included ? [...excludedInputs, input.nodeId] : excludedInputs.filter((id) => id !== input.nodeId);
                                            setExcludedInputs(next);
                                            ctx.updateMetadata({ codexExcludedInputIds: next });
                                        }}
                                    />
                                    <button type="button" className="max-w-48 truncate text-left hover:underline" title={input.title} onClick={() => ctx.emit("node:preview", input.nodeId)}>{input.title}</button>
                                    <span className="shrink-0 text-[10px]">{input.type === "video" || input.type === "audio" ? "暂不支持" : used ? "将使用" : included ? "可 @ 选用" : "未使用"}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : null}

            {agentMode && localRefs.length > 0 ? (
                <div className="mb-3 flex flex-wrap gap-2 text-xs" style={{ color: ctx.theme.node.muted }}>
                    {localRefs.map((src, index) => (
                        <span key={`${index}-${src.slice(0, 32)}`} className="inline-flex items-center gap-1">
                            <ImageIcon className="size-3.5" />本地参考图 {index + 1}
                            <button type="button" disabled={running} aria-label={`移除本地参考图 ${index + 1}`} className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40" onClick={() => ctx.updateMetadata({ references: localRefs.filter((_, i) => i !== index) })}><X className="size-3" /></button>
                        </span>
                    ))}
                </div>
            ) : null}

            {agentMode && result ? (
                <div className="mb-3 border-t pt-3 text-xs" style={{ borderColor: ctx.theme.node.stroke, color: ctx.theme.node.muted }}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5"><Check className="size-3.5" />最近产物 · {result.count} 个文件</span>
                        <label className="inline-flex items-center gap-1.5">
                            <input type="checkbox" checked={continueTask} disabled={running || !result.threadId} onChange={(event) => setContinueTask(event.target.checked)} />
                            沿用任务上下文
                        </label>
                    </div>
                    {result.nodeIds.filter((id) => id !== result.previewNodeId || result.nodeIds.length === 1).map((id) => {
                        const node = ctx.getNode(id);
                        return (
                            <div key={id} className="flex items-center gap-2 py-1">
                                <FileText className="size-4 shrink-0" />
                                <span className="min-w-0 flex-1 truncate" style={{ color: ctx.theme.node.text }}>{node?.title || "产物节点已移除"}</span>
                                <button type="button" disabled={!ctx.getNode(result.previewNodeId)} className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40" onClick={() => ctx.emit("node:preview", result.previewNodeId)}><Eye className="size-3.5" />预览</button>
                                <button type="button" disabled={!node} className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40" onClick={() => ctx.emit("node:focus", id)}><LocateFixed className="size-3.5" />定位</button>
                            </div>
                        );
                    })}
                    <p className="mb-0 mt-1 text-[10px]">{continueTask ? "输入修改要求即可继续；每轮产物单独保留。此前会话已读取的资料仍在上下文中。" : "下次执行将新建任务；需要的旧产物请连接为资料。"}</p>
                </div>
            ) : null}

            <div className="mb-3 grid grid-cols-3 gap-2">
                {agentMode ? null : (
                    <label className="grid gap-1 text-xs" style={{ color: ctx.theme.node.muted }}>
                        {t("canvas.codexImage.size")}
                        <select
                            value={size}
                            onChange={(event) => {
                                const next = event.target.value;
                                setSize(next);
                                persistParams({ size: next });
                            }}
                            className="h-9 rounded-lg border px-2 text-sm"
                            style={fieldStyle}
                        >
                            {SIZE_OPTIONS.map((item) => (
                                <option key={item.value} value={item.value}>
                                    {item.label}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                <label className="grid gap-1 text-xs" style={{ color: ctx.theme.node.muted }}>
                    {t("canvas.codexImage.effort")}
                    <select value={reasoningEffort || "none"} onChange={(event) => onEffortChange(event.target.value)} className="h-9 rounded-lg border px-2 text-sm" style={fieldStyle}>
                        {effortOptions.map((effort) => (
                            <option key={effort} value={effort}>
                                {t(`agent.composer.effort.${effort}`)}
                            </option>
                        ))}
                    </select>
                </label>
                {agentMode ? (
                    <div className="col-span-2 self-end pb-1 text-[11px] leading-4" style={{ color: ctx.theme.node.muted }}>
                        <div className="flex items-center justify-between gap-3">
                            <span style={{ color: ctx.theme.node.text }}>{t("canvas.codexAgent.execLabel")}</span>
                            <div className="flex items-center gap-2">
                                <span className={exec ? "opacity-50" : ""}>{t("canvas.codexAgent.execSandbox")}</span>
                                <Switch
                                    size="small"
                                    checked={exec}
                                    disabled={running}
                                    style={exec ? { background: "#22c55e" } : undefined}
                                    onChange={(checked) => {
                                        setExec(checked);
                                        persistParams({ exec: checked });
                                    }}
                                />
                                <span className={exec ? "" : "opacity-50"}>{t("canvas.codexAgent.execNetwork")}</span>
                            </div>
                        </div>
                        <div className="mt-1 truncate">{t(exec ? "canvas.codexAgent.execHint" : "canvas.codexAgent.execSandboxHint")}</div>
                    </div>
                ) : (
                    <label className="grid gap-1 text-xs" style={{ color: ctx.theme.node.muted }}>
                        {t("canvas.codexImage.count")}
                        <select
                            value={count}
                            onChange={(event) => {
                                const next = event.target.value;
                                setCount(next);
                                const nextCount = next === "auto" || !next ? 0 : Math.max(1, Math.min(4, Number(next) || 1));
                                persistParams({ count: nextCount });
                            }}
                            className="h-9 rounded-lg border px-2 text-sm"
                            style={fieldStyle}
                        >
                            <option value="auto">{t("canvas.codexImage.countAuto")}</option>
                            {[1, 2, 3, 4].map((value) => (
                                <option key={value} value={String(value)}>
                                    {value}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
            </div>

            {/* 智能体模式不展示思考过程（仅底部状态行）；生图模式保留 CLI 进度 */}
            {thinkingText ? (
                <details open={running} className="mb-3 text-xs">
                    <summary className="cursor-pointer list-none py-1" style={{ color: ctx.theme.node.muted }}>
                        {agentMode ? "执行进展" : t("canvas.codexImage.thinking")}
                    </summary>
                    <div className="thin-scrollbar mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words leading-5" style={{ color: ctx.theme.node.muted }}>
                        {thinkingText}
                    </div>
                </details>
            ) : null}

            <div className="flex items-center justify-between gap-3">
                <div className="text-xs" style={{ color: statusIsError ? "#f87171" : running ? "#fb923c" : ctx.theme.node.muted }}>
                    {statusText}
                </div>
                <div className="flex items-center gap-2">
                    {taskThreadId ? (
                        <button
                            type="button"
                            className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm transition hover:bg-black/5 dark:hover:bg-white/10"
                            style={{ color: ctx.theme.node.muted }}
                            onClick={() => {
                                setAgentState({ requestedThreadId: taskThreadId });
                                useAgentStore.getState().openPanel({ tab: "chat" });
                            }}
                        >
                            <MessagesSquare className="size-4" />
                            {t("canvas.codexAgent.viewSession")}
                        </button>
                    ) : null}
                    {running ? (
                        <button type="button" disabled={submissionStage === "正在整理产物…" || (textJob?.status === "running" && !textJob.turnId)} className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40" style={{ color: ctx.theme.node.text }} onClick={onCancel}>
                            {t("canvas.codexImage.cancel")}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        disabled={running || !prompt.trim()}
                        className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold disabled:opacity-40"
                        style={{ background: running ? ctx.theme.node.fill : "#ea580c", color: running ? ctx.theme.node.text : "#fff" }}
                        onClick={() => void (agentMode ? onRunAgent() : onGenerate())}
                    >
                        {running ? <Loader2 className="size-4 animate-spin" /> : agentMode ? <Play className="size-4" /> : <ImageIcon className="size-4" />}
                        {running
                            ? t(agentMode ? "canvas.codexAgent.running" : "canvas.codexImage.generating")
                            : agentMode ? errorText ? "重试任务" : continueTask && result?.threadId ? "继续修改" : "开始执行" : t("canvas.codexImage.generate")}
                    </button>
                </div>
            </div>
        </div>
    );
}

function buildCodexComposerInputs(ctx: CanvasNodeContext, options?: { detailedFolders?: boolean }): NodeGenerationInput[] {
    const nodes = ctx.getNodes();
    const connections = ctx.getConnections();
    const resources = buildNodeGenerationInputs(ctx.node.id, nodes, connections).filter((input) => input.type !== "folder");
    const skillNodes = collectConnectedNodes(ctx, (node) => Boolean(readCodexSkillRef(node)));
    // 直连文件夹，或经智能预览透传的上游文件夹
    const folderHosts = collectConnectedNodes(
        ctx,
        (node) => node.type === FOLDER_NODE_TYPE || node.type === SMART_PREVIEW_NODE_TYPE,
    );
    const installedSkills = useAgentSkillStore.getState().skills;
    const skills = skillNodes.map((node): NodeGenerationInput => {
        const skill = readCodexSkillRef(node)!;
        const displayName = String(node.metadata?.skillDisplayName || skill.name).trim() || skill.name;
        return {
            nodeId: node.id,
            type: "skill",
            title: displayName,
            text: String(node.metadata?.skillDescription || "").trim() || displayName,
            skill: {
                name: skill.name,
                path: skill.path,
                displayName,
                enabled: node.metadata?.skillEnabled !== false,
            },
        };
    });
    const folders = folderHosts.flatMap((host): NodeGenerationInput[] => {
        const folder = resolveFolderSourceNode(host, nodes, connections);
        if (!folder) return [];
        const summary = folderInputSummary(folder);
        const diskPath = resolveFolderDiskPathFromNode(folder);
        const skillDesc = String(folder.metadata?.folderSkillDescription || "").trim();
        const fileList = (folder.metadata?.folderEntries || []).filter((entry) => entry.kind === "file").slice(0, 80);
        const detail = folderDiskPathPromptBlock({
            folderName: summary.folderName,
            diskPath,
            entryCount: summary.entryCount,
            skillDescription: skillDesc,
            fileList: options?.detailedFolders && fileList.length ? `文件列表：\n${fileList.map((entry) => `- ${entry.path}`).join("\n")}` : "",
        });
        if (summary.isSkillFolder) {
            const matched = installedSkills.find((item) => item.name === summary.folderName || item.interface?.displayName === summary.folderName || item.name === summary.skillName);
            if (matched) {
                const displayName = matched.interface?.displayName || matched.name || summary.folderName;
                const installedDesc = matched.interface?.shortDescription || matched.shortDescription || matched.description || "";
                const contextText = folderDiskPathPromptBlock({
                    folderName: summary.folderName,
                    diskPath,
                    entryCount: summary.entryCount,
                    skillDescription: skillDesc || installedDesc || displayName,
                    extra: detail,
                });
                return [
                    {
                        nodeId: host.id,
                        type: "skill",
                        title: displayName,
                        text: contextText,
                        skill: {
                            name: matched.name,
                            path: matched.path,
                            displayName,
                            enabled: matched.enabled,
                        },
                    },
                ];
            }
            return [
                {
                    nodeId: host.id,
                    type: "folder",
                    title: summary.folderName,
                    text: folderDiskPathPromptBlock({
                        folderName: summary.folderName,
                        diskPath,
                        entryCount: summary.entryCount,
                        skillDescription: skillDesc,
                        extra: [`Skill 文件夹（尚未写入 Codex Skills，以下为画布节点内容）`, detail].filter(Boolean).join("\n"),
                    }),
                },
            ];
        }
        return [
            {
                nodeId: host.id,
                type: "folder",
                title: summary.folderName,
                text: folderDiskPathPromptBlock({
                    folderName: summary.folderName,
                    diskPath,
                    entryCount: summary.entryCount,
                    extra: detail,
                }),
            },
        ];
    });
    return [...skills, ...folders, ...resources];
}

/** 联网执行档的产物目录：每轮独立，避免上一轮文件混进来 */
function codexRunDir(workspacePath: string) {
    const sep = workspacePath.includes("\\") ? "\\" : "/";
    return `${workspacePath.replace(/[\\/]$/, "")}${sep}codex-runs${sep}${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
}

/** 把 Codex 写到产物目录的文件读回浏览器，供挂成文件夹节点 */
async function collectCodexRunFiles(endpoint: string, token: string, runDir: string) {
    if (!runDir) return [];
    const sep = runDir.includes("\\") ? "\\" : "/";
    // 优先走 Agent HTTP；旧版 Agent 没有这两个接口时会 404，再走桌面直读
    let entries = endpoint && token
        ? await listAgentWorkspaceDir(endpoint, token, runDir).then((data) => data.entries || []).catch(() => [])
        : [];
    if (!entries.length) entries = await listCodexRunDirViaDesktop(runDir);
    const files: Array<{ path: string; file: File }> = [];
    for (const entry of entries.slice(0, 50)) {
        const abs = `${runDir}${sep}${entry.path.split("/").join(sep)}`;
        const blob = endpoint && token
            ? await readAgentWorkspaceFile(endpoint, token, abs).catch(() => null)
            : null;
        const file = blob
            ? new File([blob], entry.path.split("/").pop() || entry.path)
            : await readCodexRunFileViaDesktop(abs, entry.path.split("/").pop() || entry.path);
        if (file) files.push({ path: entry.path, file });
    }
    return files;
}

async function listCodexRunDirViaDesktop(runDir: string) {
    const desktop = window.desktopAPI;
    if (!desktop?.listDirectory) return [];
    const result = await desktop.listDirectory(runDir).catch(() => null);
    return result?.ok ? result.entries || [] : [];
}

async function readCodexRunFileViaDesktop(absPath: string, name: string) {
    const desktop = window.desktopAPI;
    if (!desktop?.readFile) return null;
    const result = await desktop.readFile(absPath).catch(() => null);
    if (!result?.ok || !result.dataBase64) return null;
    const binary = atob(result.dataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], name);
}

/** @deprecated 保留给旧调用；新逻辑请直接用 folderDiskPathPromptBlock */
function folderDetailText(folder: CanvasNodeData, extra: string) {
    const diskPath = resolveFolderDiskPathFromNode(folder);
    const files = (folder.metadata?.folderEntries || []).filter((entry) => entry.kind === "file").slice(0, 80);
    const fileList = files.length ? `文件列表：\n${files.map((entry) => `- ${entry.path}`).join("\n")}` : "";
    return folderDiskPathPromptBlock({
        folderName: String(folder.metadata?.folderName || folder.title || "").trim() || folder.id,
        diskPath,
        entryCount: folder.metadata?.folderEntryCount ?? folder.metadata?.folderEntries?.length ?? 0,
        extra: [extra, fileList].filter(Boolean).join("\n"),
    });
}

function collectConnectedNodes(ctx: CanvasNodeContext, predicate: (node: CanvasNodeData) => boolean) {
    const nodeId = ctx.node.id;
    const nodes = ctx.getNodes();
    const byId = new Map<string, CanvasNodeData>();
    for (const node of [...ctx.getUpstream(), ...ctx.getDownstream()]) {
        if (predicate(node)) byId.set(node.id, node);
    }
    for (const connection of ctx.getConnections()) {
        if (connection.toNodeId !== nodeId && connection.fromNodeId !== nodeId) continue;
        const otherId = connection.toNodeId === nodeId ? connection.fromNodeId : connection.toNodeId;
        const node = ctx.getNode(otherId) || nodes.find((item) => item.id === otherId);
        if (node && predicate(node)) byId.set(node.id, node);
    }
    return [...byId.values()];
}

function collectConnectedSkillNode(ctx: CanvasNodeContext) {
    return collectConnectedNodes(ctx, (node) => Boolean(readCodexSkillRef(node)))[0] || null;
}

function collectConnectedCodexSkill(ctx: CanvasNodeContext) {
    const node = collectConnectedSkillNode(ctx);
    if (node) return readCodexSkillRef(node);
    const installedSkills = useAgentSkillStore.getState().skills;
    for (const host of collectConnectedNodes(ctx, (item) => item.type === FOLDER_NODE_TYPE || item.type === SMART_PREVIEW_NODE_TYPE)) {
        const folder = resolveFolderSourceNode(host, ctx.getNodes(), ctx.getConnections());
        if (!folder) continue;
        const summary = folderInputSummary(folder);
        const folderName = summary.folderName;
        const isSkillFolder = summary.isSkillFolder;
        if (!isSkillFolder || !folderName) continue;
        const matched = installedSkills.find(
            (item) => item.name === folderName || item.name === summary.skillName || item.interface?.displayName === folderName,
        );
        if (matched) return { name: matched.name, path: matched.path };
    }
    return null;
}

async function referenceImagesToAttachments(images: { id: string; name: string; type: string; dataUrl: string; storageKey?: string }[]): Promise<AgentAttachment[]> {
    const result: AgentAttachment[] = [];
    for (const [index, image] of images.entries()) {
        const dataUrl = image.dataUrl?.startsWith("data:") ? image.dataUrl : await ensureDataUrl(image.dataUrl);
        if (!dataUrl) continue;
        result.push({
            id: `mention-${image.id}-${index}`,
            name: image.name || `ref-${index + 1}.png`,
            type: image.type || "image/png",
            size: 0,
            width: 0,
            height: 0,
            url: image.dataUrl || dataUrl,
            dataUrl,
            canvasNodeId: image.id,
        });
    }
    return result;
}

function collectUpstreamAttachments(ctx: CanvasNodeContext): AgentAttachment[] {
    return ctx
        .getUpstream()
        .filter((node) => {
            const content = node.metadata?.content;
            if (node.type === "image" && content) return true;
            if (node.type === CODEX_IMAGE_NODE_TYPE && content) return true;
            return typeof content === "string" && (content.startsWith("blob:") || content.startsWith("data:image"));
        })
        .flatMap((node, index) => {
            const src = node.metadata?.content;
            if (!src || typeof src !== "string") return [];
            return [
                {
                    id: `upstream-${node.id}-${index}`,
                    name: node.title || `ref-${index + 1}.png`,
                    type: node.metadata?.mimeType || "image/png",
                    size: node.metadata?.bytes || 0,
                    width: node.metadata?.naturalWidth || 0,
                    height: node.metadata?.naturalHeight || 0,
                    url: src,
                    dataUrl: src.startsWith("data:") ? src : "",
                    canvasNodeId: node.id,
                } satisfies AgentAttachment,
            ];
        });
}

async function buildAttachments(ctx: CanvasNodeContext, localRefs: string[], upstream: AgentAttachment[], requireAll = false) {
    const fromLocal: AgentAttachment[] = [];
    for (const [index, src] of localRefs.entries()) {
        try {
            const uploaded = src.startsWith("blob:") || src.startsWith("data:") ? await uploadImage(src) : null;
            const dataUrl = src.startsWith("data:") ? src : uploaded ? await blobToDataUrl(await (await fetch(uploaded.url)).blob()) : "";
            fromLocal.push({
                id: nanoid(),
                name: `ref-${index + 1}.png`,
                type: uploaded?.mimeType || "image/png",
                size: uploaded?.bytes || 0,
                width: uploaded?.width || 0,
                height: uploaded?.height || 0,
                url: uploaded?.url || src,
                dataUrl: dataUrl || (await ensureDataUrl(src)),
            });
        } catch {
            if (requireAll) throw new Error(`本地参考图 ${index + 1} 无法读取，请重新添加`);
            // skip unreadable reference
        }
    }
    const merged = [...fromLocal];
    for (const item of upstream) {
        if (!requireAll && merged.length >= 4) break;
        const dataUrl = item.dataUrl || (await ensureDataUrl(item.url));
        if (!dataUrl) continue;
        merged.push({ ...item, dataUrl });
    }
    if (requireAll && merged.some((item) => !item.dataUrl)) throw new Error("部分参考图无法读取，请重新添加后执行");
    return merged;
}

async function ensureDataUrl(src: string) {
    if (!src) return "";
    if (src.startsWith("data:")) return src;
    try {
        const blob = await (await fetch(src)).blob();
        return blobToDataUrl(blob);
    } catch {
        return "";
    }
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

const PLACEHOLDER_GAP_Y = 18;

/** 判断张数后立刻创建「生成中」占位图节点并连线，返回节点 id 列表 */
export function createCodexLoadingPlaceholders(
    ctxApplyOps: (ops: Parameters<CanvasNodeContext["applyOps"]>[0]) => unknown,
    sourceNode: { id: string; position: { x: number; y: number }; width: number; height: number; references?: string[] },
    count: number,
    prompt: string,
) {
    const n = Math.min(4, Math.max(1, count));
    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const ids = Array.from({ length: n }, () => `image-${nanoid()}`);
    const references = (sourceNode.references || []).filter(Boolean);
    const parentCenterY = sourceNode.position.y + sourceNode.height / 2;
    const parentRightX = sourceNode.position.x + sourceNode.width;
    const ops: Parameters<CanvasNodeContext["applyOps"]>[0] = [
        {
            type: "update_node",
            id: sourceNode.id,
            metadata: {
                content: "",
                storageKey: "",
                status: "success",
                codexPhase: "running",
                errorDetails: "",
            },
        },
    ];
    ids.forEach((id, index) => {
        const position = getVerticalResultPlacement(index, n, spec.height, parentCenterY, parentRightX, PLACEHOLDER_GAP_Y);
        ops.push({
            type: "add_node",
            id,
            nodeType: "image",
            title: prompt.slice(0, 24) || `星小驰 ${index + 1}`,
            position,
            width: spec.width,
            height: spec.height,
            metadata: {
                content: "",
                prompt,
                status: "loading",
                ...(references.length ? { references } : {}),
            },
        });
        ops.push({
            type: "connect_nodes",
            id: `conn-${nanoid()}`,
            fromNodeId: sourceNode.id,
            toNodeId: id,
        });
    });
    ctxApplyOps(ops);
    return ids;
}

/** 将未填完的占位节点标为失败 / 删除多余空占位 */
export function settleCodexPlaceholders(
    ctxApplyOps: (ops: Parameters<CanvasNodeContext["applyOps"]>[0]) => unknown,
    placeholderNodeIds: string[],
    filledCount: number,
    mode: "error" | "remove",
    errorMessage?: string,
) {
    const leftover = placeholderNodeIds.slice(Math.max(0, filledCount));
    if (!leftover.length) return ctxApplyOps([]);
    if (mode === "remove") {
        return ctxApplyOps([{ type: "delete_node", ids: leftover }]);
    }
    return ctxApplyOps(
        leftover.map((id) => ({
            type: "update_node" as const,
            id,
            metadata: { status: "error", errorDetails: errorMessage || "生成失败" },
        })),
    );
}

/**
 * 优先填入预先创建的「生成中」占位节点；占位不够时再在右侧追加结果节点。
 */
export function applyCodexGeneratedImagesAsResultNodes(
    ctxApplyOps: (ops: Parameters<CanvasNodeContext["applyOps"]>[0]) => unknown,
    sourceNode: { id: string; position: { x: number; y: number }; width: number; height: number; references?: string[] },
    images: Array<{ upload: { url: string; storageKey: string; width: number; height: number; bytes: number; mimeType: string }; name?: string }>,
    thinking: string,
    options?: { startIndex?: number; placeholderNodeIds?: string[] },
) {
    if (!images.length) return ctxApplyOps([]);
    const startIndex = Math.max(0, options?.startIndex || 0);
    const placeholders = options?.placeholderNodeIds || [];
    const references = (sourceNode.references || []).filter(Boolean);
    const ops: Parameters<CanvasNodeContext["applyOps"]>[0] = [
        {
            type: "update_node",
            id: sourceNode.id,
            metadata: {
                content: "",
                storageKey: "",
                status: "success",
                thinkingLog: thinking,
                errorDetails: "",
            },
        },
    ];
    images.forEach((image, index) => {
        const size = fitNodeSize(image.upload.width, image.upload.height);
        const slot = startIndex + index;
        const placeholderId = placeholders[slot];
        const meta = {
            ...imageMetadata(image.upload),
            prompt: "",
            status: "success" as const,
            errorDetails: "",
            ...(references.length ? { references } : {}),
        };
        if (placeholderId) {
            ops.push({
                type: "update_node",
                id: placeholderId,
                patch: { ...size, title: image.name || `星小驰 ${slot + 1}` },
                metadata: meta,
            });
            return;
        }
        const id = `image-${nanoid()}`;
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
        const parentCenterY = sourceNode.position.y + sourceNode.height / 2;
        const parentRightX = sourceNode.position.x + sourceNode.width;
        const total = Math.max(placeholders.length, startIndex + images.length);
        ops.push({
            type: "add_node",
            id,
            nodeType: "image",
            title: image.name || `星小驰 ${slot + 1}`,
            position: getVerticalResultPlacement(slot, total, size.height || spec.height, parentCenterY, parentRightX, PLACEHOLDER_GAP_Y),
            ...size,
            metadata: meta,
        });
        ops.push({
            type: "connect_nodes",
            id: `conn-${nanoid()}`,
            fromNodeId: sourceNode.id,
            toNodeId: id,
        });
    });
    return ctxApplyOps(ops);
}

/** @deprecated 使用 applyCodexGeneratedImagesAsResultNodes */
export function applyCodexGeneratedImageToNode(ctxApplyOps: (ops: Parameters<CanvasNodeContext["applyOps"]>[0]) => unknown, nodeId: string, image: { url: string; storageKey: string; width: number; height: number; bytes: number; mimeType: string }, thinking: string) {
    return applyCodexGeneratedImagesAsResultNodes(ctxApplyOps, { id: nodeId, position: { x: 0, y: 0 }, width: 360, height: 280 }, [{ upload: image }], thinking);
}

export function getCodexImageNodeDefinition(): CanvasNodeDefinition {
    return {
        type: CODEX_IMAGE_NODE_TYPE,
        title: "星小驰",
        description: "星小驰智能体串联工作流，或用 gpt-image-2 生图",
        icon: <XingXiaochiAvatar size={20} />,
        // 从底栏拖入/点击添加，不出现在双击创建菜单
        showInCreateMenu: false,
        bareShell: true,
        transparentBackground: true,
        keepAspectRatio: () => true,
        defaultSize: { width: 128, height: 128 },
        defaultMetadata: {
            content: "",
            prompt: "",
            codexMode: "agent",
            codexExec: true,
            size: "auto",
            quality: "medium",
            count: 0,
            status: "idle",
            references: [],
            codexPhase: "idle",
            thinkingLog: "",
        },
        minimapColor: "#E23B4C",
        autoOpenPanel: true,
        panelWidth: 640,
        // 控制节点本身不提供图片资源；结果在下游 image 节点
        resource: () => null,
        Content: CodexImageContent,
        Panel: CodexImagePanel,
    };
}
