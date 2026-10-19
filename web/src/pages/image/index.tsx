import { BookOpen, CheckSquare, ClipboardPaste, Download, FolderPlus, History, ImagePlus, LoaderCircle, PenLine, Plus, SlidersHorizontal, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { App, Button, Checkbox, Drawer, Empty, Image, Input, Modal, Tag, Tooltip, Typography } from "antd";
import localforage from "localforage";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { canvasThemes } from "@/lib/canvas-theme";
import { createZip } from "@/lib/zip";
import { isFilledReference, isTopLevelDirectoryFile, isWorkbenchImageFile, planReferenceBatch, plainReference, readDroppedReferences, runWithConcurrency, sortImageFiles } from "@/lib/image-workbench-batch";
import { closedGenerationError, modelOptionLabel, resolveModelRequestConfig, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { nanoid } from "nanoid";
import { formatBytes, formatDuration, getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { deleteStoredImages, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { useAssetStore } from "@/stores/use-asset-store";
import { useImageWorkbenchStore, type GeneratedImage, type GenerationResult } from "@/stores/use-image-workbench-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import type { ReferenceImage } from "@/types/image";
import i18n from "@/i18n";

type GenerationLog = {
    id: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    imageCount: number;
    size: string;
    quality: string;
    status: "success" | "failed";
    images: GeneratedImage[];
    thumbnails: string[];
};

type GenerationLogConfig = Pick<AiConfig, "model" | "imageModel" | "quality" | "size" | "count">;

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

const LOG_STORE_KEY = "infinite-canvas:image_generation_logs";
const RESULT_ACTION_BUTTON_CLASS = "min-w-0 px-1.5 [&_.ant-btn-icon]:shrink-0 [&>span:last-child]:min-w-0 [&>span:last-child]:truncate";
const logStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });

export default function ImagePage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const folderTargetIdRef = useRef<string | null>(null);
    const fileTargetIdRef = useRef<string | null>(null);
    const dragDepthRef = useRef(0);
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAsset = useAssetStore((state) => state.addAsset);
    // 会话状态放全局 store：切换路由后进行中的任务与结果不丢失
    const prompt = useImageWorkbenchStore((state) => state.prompt);
    const references = useImageWorkbenchStore((state) => state.references);
    const results = useImageWorkbenchStore((state) => state.results);
    const running = useImageWorkbenchStore((state) => state.running);
    const startedAt = useImageWorkbenchStore((state) => state.startedAt);
    const previewLogId = useImageWorkbenchStore((state) => state.previewLogId);
    const { setPrompt, setReferences, setResults, setRunning, setStartedAt, setPreviewLogId } = useImageWorkbenchStore.getState();
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [logsOpen, setLogsOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [isReferenceDragActive, setIsReferenceDragActive] = useState(false);
    const [resultGallery, setResultGallery] = useState(false);
    const [selectedResultIds, setSelectedResultIds] = useState<string[]>([]);
    const [autoRunToken, setAutoRunToken] = useState(0);
    const imageCommand = useWorkbenchAgentStore((state) => state.imageCommand);
    const clearImageCommand = useWorkbenchAgentStore((state) => state.clearImageCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const agentTaskIdRef = useRef<string | undefined>(undefined);

    const model = effectiveConfig.imageModel || effectiveConfig.model;
    const canGenerate = Boolean(prompt.trim());
    const hasFolderReference = references.some((item) => item.batchImages?.length);
    const generationCount = hasFolderReference ? 1 : Math.max(1, Math.min(10, Number(config.count) || 1));
    const batchPlan = planReferenceBatch(references);
    const batchMismatch = batchPlan.mismatch.length
        ? batchPlan.mismatch.map((item) => `${t("imageWorkbench.referenceSlot", { index: item.index + 1 })} ${item.count}`).join("，")
        : "";
    const folderImageCount = !hasFolderReference ? undefined : batchPlan.mismatch.length ? null : batchPlan.tasks.length;

    useEffect(() => {
        if (!running || !startedAt) return;
        // 切回页面时立即恢复计时显示，不等第一个 tick
        setElapsedMs(performance.now() - startedAt);
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        void refreshLogs();
    }, []);

    const addReferences = async (files?: FileList | null) => {
        const targetId = fileTargetIdRef.current;
        fileTargetIdRef.current = null;
        const imageFiles = Array.from(files || []).filter((file) => isWorkbenchImageFile(file));
        const nextReferences = await Promise.all(imageFiles.map(referenceFromFile));
        if (!nextReferences.length || !targetId) return;
        setReferences((value) => placeImagesInSlot(value, targetId, nextReferences));
    };

    const referenceFromFile = async (file: File): Promise<ReferenceImage> => {
        const image = await uploadImage(file);
        return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
    };

    const addFolderReference = async (files?: FileList | null) => {
        const targetId = folderTargetIdRef.current;
        folderTargetIdRef.current = null;
        const images = sortImageFiles(Array.from(files || []).filter((file) => isTopLevelDirectoryFile(file) && isWorkbenchImageFile(file)));
        if (!images.length) {
            message.warning(t("imageWorkbench.batchEmptyFolder"));
            return;
        }
        const batchImages = await Promise.all(images.map(referenceFromFile));
        const folderName = images[0].webkitRelativePath.split(/[/\\]/)[0] || images[0].name;
        const slot: ReferenceImage = { ...batchImages[0], id: targetId || nanoid(), name: folderName, batchImages };
        setReferences((value) => {
            const slots = value.length ? value : [{ id: slot.id, name: "", type: "", dataUrl: "" }];
            return targetId ? slots.map((item) => (item.id === targetId ? slot : item)) : [...slots, slot];
        });
    };

    const openFolderPicker = (targetId: string | null) => {
        folderTargetIdRef.current = targetId;
        folderInputRef.current?.click();
    };

    const openFilePicker = (targetId: string) => {
        fileTargetIdRef.current = targetId;
        fileInputRef.current?.click();
    };

    const fillReferenceSlotFromDrop = async (targetId: string, transfer: DataTransfer) => {
        const dropped = await readDroppedReferences(transfer);
        const folder = dropped.folders.find((item) => item.files.length);
        if (folder) {
            const batchImages = await Promise.all(folder.files.map(referenceFromFile));
            const slot: ReferenceImage = { ...batchImages[0], id: targetId, name: folder.name, batchImages };
            const fixed = await Promise.all(dropped.fixed.map(referenceFromFile));
            setReferences((value) => placeImagesInSlot(value, targetId, [slot, ...fixed]));
            return;
        }
        const fixed = await Promise.all(dropped.fixed.map(referenceFromFile));
        if (!fixed.length) {
            if (dropped.folders.length) message.warning(t("imageWorkbench.batchEmptyFolder"));
            return;
        }
        setReferences((value) => placeImagesInSlot(value, targetId, fixed));
    };

    const addReferencesFromClipboard = async (targetId: string) => {
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error(t("imageWorkbench.clipboardEmpty"));
                return;
            }
            const nextReferences = await Promise.all(
                blobs.map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => placeImagesInSlot(value, targetId, nextReferences));
            message.success(t("imageWorkbench.clipboardAdded", { count: nextReferences.length }));
        } catch {
            message.error(t("imageWorkbench.clipboardEmpty"));
        }
    };

    const addReferenceSlot = () => {
        setReferences((value) => [...(value.length ? value : [{ id: nanoid(), name: "", type: "", dataUrl: "" }]), { id: nanoid(), name: "", type: "", dataUrl: "" }]);
    };

    const generate = async () => {
        const agentTaskId = agentTaskIdRef.current;
        agentTaskIdRef.current = undefined;
        const text = prompt.trim();
        if (!text) {
            message.error(t("imageWorkbench.promptRequired"));
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.promptRequired") });
            return;
        }
        const blockedGeneration = closedGenerationError(model);
        if (blockedGeneration) {
            message.warning(blockedGeneration.message);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: blockedGeneration.message });
            return;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("workbench.configFirst"));
            openConfigDialog(true);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.configIncomplete") });
            return;
        }

        const snapshot = buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.invalidParams") });
            return;
        }
        if (references.some((item) => item.batchImages?.length)) {
            if (batchMismatch) {
                message.error(t("imageWorkbench.batchCountMismatch", { detail: batchMismatch }));
                if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: t("imageWorkbench.batchCountMismatch", { detail: batchMismatch }) });
                return;
            }
            await runReferenceBatch(batchPlan.tasks, snapshot, agentTaskId);
            return;
        }

        setElapsedMs(0);
        setRunning(true);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLogId("");
        setResults(Array.from({ length: generationCount }, () => ({ id: nanoid(), status: "pending" })));
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);

        const useLinkfoxBatch = resolveModelRequestConfig(snapshot.config, snapshot.config.model).apiFormat === "linkfox";
        let successImages: GeneratedImage[] = [];
        let failCount = 0;
        let error: string | undefined;

        if (useLinkfoxBatch) {
            // One LinkFox task with outputNum=N (native batch) instead of N×count=1.
            try {
                const batchConfig = { ...snapshot.config, count: String(generationCount) };
                const batch = snapshot.references.length
                    ? await requestEdit(batchConfig, snapshot.text, snapshot.references)
                    : await requestGeneration(batchConfig, snapshot.text);
                const settled = await Promise.all(
                    Array.from({ length: generationCount }, async (_, index) => {
                        const image = batch[index];
                        if (!image) {
                            setResults((value) => updateResultAt(value, index, { status: "failed", error: t("imageWorkbench.missingResult") }));
                            return null;
                        }
                        const meta = await readImageMeta(image.dataUrl);
                        const nextImage = {
                            id: image.id,
                            dataUrl: image.dataUrl,
                            durationMs: performance.now() - batchStartedAt,
                            width: meta.width,
                            height: meta.height,
                            bytes: getDataUrlByteSize(image.dataUrl),
                        };
                        setResults((value) => updateResultAt(value, index, { status: "success", image: nextImage }));
                        return nextImage;
                    }),
                );
                successImages = settled.filter((item): item is GeneratedImage => Boolean(item));
                failCount = generationCount - successImages.length;
                if (!successImages.length) error = t("workbench.generationFailed");
            } catch (err) {
                failCount = generationCount;
                error = err instanceof Error ? err.message : t("workbench.generationFailed");
                setResults(Array.from({ length: generationCount }, () => ({ id: nanoid(), status: "failed" as const, error })));
            }
        } else {
            const settled: Array<GeneratedImage | undefined> = [];
            await runWithConcurrency(generationCount, useImageWorkbenchStore.getState().concurrency, async (index) => {
                try {
                    settled[index] = await runGenerationSlot(index, snapshot);
                } catch (err) {
                    error = err instanceof Error ? err.message : t("workbench.generationFailed");
                }
            });
            successImages = settled.filter((item): item is GeneratedImage => Boolean(item));
            failCount = generationCount - successImages.length;
        }

        const successCount = successImages.length;
        if (agentTaskId) updateAgentTask(agentTaskId, { status: successCount ? "succeeded" : "failed", successCount, failCount, error: successCount ? undefined : error });

        try {
            const logImages = await Promise.all(
                successImages.map(async (image) => {
                    const stored = await uploadImage(image.dataUrl);
                    return { ...image, dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType };
                }),
            );
            saveLog(
                buildLog({
                    prompt: text,
                    model,
                    config: { ...snapshot.config, count: String(generationCount) },
                    references: snapshot.references,
                    durationMs: performance.now() - batchStartedAt,
                    successCount,
                    failCount,
                    status: successCount ? "success" : "failed",
                    images: logImages,
                }),
            );
            successCount ? message.success(t("imageWorkbench.generated")) : message.error(error || t("workbench.generationFailed"));
        } finally {
            setRunning(false);
        }
    };

    // Handle image-generation commands from the Agent panel by setting the prompt and optionally starting generation.
    useEffect(() => {
        if (!imageCommand || imageCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = imageCommand.nonce;
        clearImageCommand();
        if (typeof imageCommand.prompt === "string") setPrompt(imageCommand.prompt);
        if (imageCommand.run && running) {
            if (imageCommand.taskId) updateAgentTask(imageCommand.taskId, { status: "failed", error: t("imageWorkbench.busy") });
            return;
        }
        if (imageCommand.run) {
            agentTaskIdRef.current = imageCommand.taskId;
            setAutoRunToken((value) => value + 1);
        }
    }, [imageCommand, clearImageCommand, running, updateAgentTask]);

    useEffect(() => {
        if (!autoRunToken) return;
        void generate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunToken]);

    const downloadImage = (image: GeneratedImage, index: number) => {
        saveAs(image.dataUrl, `image-${index + 1}.png`);
    };

    const exportSelectedResults = async () => {
        const chosen = results.filter((result) => selectedResultIds.includes(result.id) && result.image);
        if (!chosen.length) {
            message.warning(t("imageWorkbench.exportEmpty"));
            return;
        }
        const files = await Promise.all(
            chosen.map(async (result, index) => {
                const response = await fetch(result.image!.dataUrl);
                const task = (result.taskIndex ?? 0) + 1;
                return { name: `task-${task}-${index + 1}-${result.id.slice(0, 6)}.png`, data: await response.blob() };
            }),
        );
        saveAs(await createZip(files), `image-results-${files.length}.zip`);
        message.success(t("imageWorkbench.exported", { count: files.length }));
    };

    const toggleResultSelected = (id: string) => {
        setSelectedResultIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
    };

    const selectAllResults = () => {
        const ids = results.filter((result) => result.status === "success" && result.image).map((result) => result.id);
        setSelectedResultIds((current) => (current.length === ids.length ? [] : ids));
    };

    const addResultToReferences = async (image: GeneratedImage, index: number) => {
        const stored = await uploadImage(image.dataUrl);
        setReferences((value) => [...value, { id: nanoid(), name: `result-${index + 1}.png`, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
        message.success(t("imageWorkbench.addedReference"));
    };

    const saveResultToAssets = async (image: GeneratedImage, index: number) => {
        const stored = await uploadImage(image.dataUrl);
        addAsset({
            kind: "image",
            title: t("imageWorkbench.resultTitle", { count: index + 1 }),
            coverUrl: stored.url,
            tags: [],
            source: t("imageWorkbench.source"),
            data: { dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType },
            metadata: { source: "image-page", prompt },
        });
        message.success(t("common.addedToAssets"));
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }]);
        } else {
            message.warning(t("imageWorkbench.unsupportedAsset"));
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        setPrompt("");
        setReferences([]);
        setResults([]);
        setElapsedMs(0);
        setStartedAt(0);
        setSelectedLogIds([]);
        setPreviewLogId("");
    };

    const deleteSelectedLogs = () => {
        const imageKeys = logs.filter((log) => selectedLogIds.includes(log.id)).flatMap((log) => log.images.map((image) => image.storageKey).filter((key): key is string => Boolean(key)));
        void Promise.all([deleteStoredImages(imageKeys), ...selectedLogIds.map((id) => logStore.removeItem(id))]).then(refreshLogs);
        if (previewLogId && selectedLogIds.includes(previewLogId)) {
            setPreviewLogId("");
            setResults([]);
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
    };

    const saveLog = (log: GenerationLog) => {
        void logStore.setItem(log.id, serializeLog(log)).then(refreshLogs);
    };

    const refreshLogs = async () => setLogs(await readStoredLogs());

    const previewGenerationLog = async (log: GenerationLog) => {
        setPreviewLogId(log.id);
        setLogsOpen(false);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        if (log.config.imageModel || log.model) updateConfig("imageModel", log.config.imageModel || log.model);
        if (log.config.quality) updateConfig("quality", log.config.quality);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.count) updateConfig("count", log.config.count);
        setResults(log.images.map((image) => ({ id: image.id, status: "success", image })));
    };

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error(t("imageWorkbench.promptRequired"));
            return null;
        }
        const blockedGeneration = closedGenerationError(model);
        if (blockedGeneration) {
            message.warning(blockedGeneration.message);
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning(t("workbench.configFirst"));
            openConfigDialog(true);
            return null;
        }
        return { text, config: { ...effectiveConfig, model, count: "1" }, references: references.filter(isFilledReference).map(plainReference) };
    };

    const runGenerationSlot = async (index: number, snapshot: { text: string; config: AiConfig; references: ReferenceImage[] }) => {
        const itemStartedAt = performance.now();
        try {
            const result = snapshot.references.length ? await requestEdit(snapshot.config, snapshot.text, snapshot.references) : await requestGeneration(snapshot.config, snapshot.text);
            const image = result[0];
            if (!image) throw new Error(t("imageWorkbench.missingResult"));
            const meta = await readImageMeta(image.dataUrl);
            const nextImage = { id: image.id, dataUrl: image.dataUrl, durationMs: performance.now() - itemStartedAt, width: meta.width, height: meta.height, bytes: getDataUrlByteSize(image.dataUrl) };
            setResults((value) => updateResultAt(value, index, { status: "success", image: nextImage }));
            return nextImage;
        } catch (error) {
            setResults((value) => updateResultAt(value, index, { status: "failed", error: error instanceof Error ? error.message : t("workbench.generationFailed") }));
            throw error;
        }
    };

    const runReferenceBatch = async (tasks: ReturnType<typeof planReferenceBatch>["tasks"], snapshot: { text: string; config: AiConfig; references: ReferenceImage[] }, agentTaskId?: string) => {
        const useLinkfoxBatch = resolveModelRequestConfig(snapshot.config, snapshot.config.model).apiFormat === "linkfox";
        setElapsedMs(0);
        setRunning(true);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLogId("");
        setResults(
            tasks.flatMap((task, taskIndex) =>
                Array.from({ length: generationCount }, () => ({
                    id: nanoid(),
                    status: "pending" as const,
                    taskIndex,
                    taskLabel: task.label,
                    references: task.references,
                })),
            ),
        );
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);
        const successImages: GeneratedImage[] = [];
        let failCount = 0;
        let error: string | undefined;
        const taskConcurrency = useImageWorkbenchStore.getState().concurrency;
        await runWithConcurrency(tasks.length, taskConcurrency, async (taskIndex) => {
            const task = tasks[taskIndex];
            const offset = taskIndex * generationCount;
            try {
                if (useLinkfoxBatch) {
                    const batchConfig = { ...snapshot.config, count: String(generationCount) };
                    const batch = task.references.length ? await requestEdit(batchConfig, snapshot.text, task.references) : await requestGeneration(batchConfig, snapshot.text);
                    for (let index = 0; index < generationCount; index += 1) {
                        const image = batch[index];
                        if (!image) {
                            failCount += 1;
                            error = t("imageWorkbench.missingResult");
                            setResults((value) => updateResultAt(value, offset + index, { status: "failed", error }));
                            continue;
                        }
                        const meta = await readImageMeta(image.dataUrl);
                        const nextImage = { id: image.id, dataUrl: image.dataUrl, durationMs: performance.now() - batchStartedAt, width: meta.width, height: meta.height, bytes: getDataUrlByteSize(image.dataUrl) };
                        setResults((value) => updateResultAt(value, offset + index, { status: "success", image: nextImage }));
                        successImages.push(nextImage);
                    }
                } else {
                    for (let index = 0; index < generationCount; index += 1) {
                        try {
                            successImages.push(await runGenerationSlot(offset + index, { ...snapshot, references: task.references, config: { ...snapshot.config, count: "1" } }));
                        } catch (err) {
                            failCount += 1;
                            error = err instanceof Error ? err.message : t("workbench.generationFailed");
                        }
                    }
                }
            } catch (err) {
                error = err instanceof Error ? err.message : t("workbench.generationFailed");
                failCount += generationCount;
                setResults((value) => value.map((item, itemIndex) => (itemIndex >= offset && itemIndex < offset + generationCount ? { ...item, status: "failed", error } : item)));
            }
        });
        const successCount = successImages.length;
        if (agentTaskId) updateAgentTask(agentTaskId, { status: successCount ? "succeeded" : "failed", successCount, failCount, error: successCount ? undefined : error });
        try {
            const logImages = await Promise.all(
                successImages.map(async (image) => {
                    const stored = await uploadImage(image.dataUrl);
                    return { ...image, dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType };
                }),
            );
            saveLog(
                buildLog({
                    prompt: snapshot.text,
                    model,
                    config: { ...snapshot.config, count: String(generationCount) },
                    references: tasks[0]?.references || [],
                    durationMs: performance.now() - batchStartedAt,
                    successCount,
                    failCount,
                    status: successCount ? "success" : "failed",
                    images: logImages,
                }),
            );
            successCount ? message.success(t("imageWorkbench.generated")) : message.error(error || t("workbench.generationFailed"));
        } finally {
            setRunning(false);
        }
    };

    const retryResult = async (index: number) => {
        const current = useImageWorkbenchStore.getState().results[index];
        const snapshot = buildRequestSnapshot();
        if (!snapshot) return;
        const taskReferences = current?.references?.length ? current.references : snapshot.references;
        setPreviewLogId("");
        setResults((value) => updateResultAt(value, index, { status: "pending", error: undefined, image: undefined }));
        const retryStartedAt = performance.now();
        try {
            const image = await runGenerationSlot(index, { ...snapshot, references: taskReferences, config: { ...snapshot.config, count: "1" } });
            const stored = await uploadImage(image.dataUrl);
            const logImage = { ...image, dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType };
            setResults((value) => updateResultAt(value, index, { image: { ...image, dataUrl: stored.url, storageKey: stored.storageKey } }));
            saveLog(
                buildLog({
                    prompt: snapshot.text,
                    model,
                    config: { ...snapshot.config, count: "1" },
                    references: taskReferences,
                    durationMs: performance.now() - retryStartedAt,
                    successCount: 1,
                    failCount: 0,
                    status: "success",
                    images: [logImage],
                }),
            );
            message.success(t("workbench.retrySuccess"));
        } catch {
            // runGenerationSlot has already marked the result as failed.
        }
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
            <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[300px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[320px_minmax(0,1fr)]">
                <aside className="thin-scrollbar hidden min-h-0 overflow-y-auto rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:block">
                    <LogPanel
                        logs={logs}
                        selectedLogIds={selectedLogIds}
                        activeLogId={previewLogId}
                        onSelectedLogIdsChange={setSelectedLogIds}
                        onCreateSession={createSession}
                        onDeleteSelected={() => setDeleteConfirmOpen(true)}
                        onPreviewLog={(log) => void previewGenerationLog(log)}
                    />
                </aside>

                <section className="grid gap-3 lg:min-h-0 lg:overflow-hidden xl:grid-cols-[420px_minmax(0,1fr)]">
                    <div className="thin-scrollbar flex flex-col rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto">
                        <div>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h1 className="text-2xl font-semibold text-stone-950 dark:text-stone-100">{t("imageWorkbench.title")}</h1>
                                </div>
                                <div className="flex shrink-0 gap-2 lg:hidden">
                                    <Button icon={<History className="size-4" />} onClick={() => setLogsOpen(true)}>
                                        {t("workbench.logs")}
                                    </Button>
                                    <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                        {t("workbench.settings")}
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 space-y-5">
                            <div>
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">{t("workbench.prompt")}</span>
                                    <div className="flex gap-2">
                                        <Button size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                            {t("workbench.viewPrompts")}
                                        </Button>
                                        <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                            {t("workbench.viewAssets")}
                                        </Button>
                                    </div>
                                </div>
                                <Input.TextArea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} placeholder={t("imageWorkbench.promptPlaceholder")} />
                            </div>

                            <div className="min-w-0">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className="text-base font-semibold">{t("imageWorkbench.references")}</span>
                                    <Button size="small" type="text" icon={<Plus className="size-3.5" />} onClick={addReferenceSlot}>
                                        {t("imageWorkbench.addReferenceSlot")}
                                    </Button>
                                </div>
                                <div className="space-y-3">
                                    {(references.length ? references : [{ id: "image-reference-placeholder", name: "", type: "", dataUrl: "" }]).map((item, index) => (
                                        <div key={item.id} className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                            <div className="mb-2 flex items-center justify-between gap-2">
                                                <span className="text-sm font-semibold">{t("imageWorkbench.referenceSlot", { index: index + 1 })}</span>
                                                <button type="button" className="rounded p-1 text-stone-400 hover:bg-black/5 hover:text-stone-700 dark:hover:bg-white/10 dark:hover:text-stone-200" onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))} aria-label={t("imageWorkbench.removeSlot")}>
                                                    <Trash2 className="size-3.5" />
                                                </button>
                                            </div>
                                            <div
                                                className={`rounded-lg border border-dashed p-2 ${isReferenceDragActive ? "border-stone-900 bg-stone-100/80 dark:border-stone-100 dark:bg-stone-900/80" : "border-stone-300 dark:border-stone-700"}`}
                                                onDragEnter={(event) => {
                                                    event.preventDefault();
                                                    dragDepthRef.current += 1;
                                                    if (event.dataTransfer.types.includes("Files")) setIsReferenceDragActive(true);
                                                }}
                                                onDragOver={(event) => {
                                                    event.preventDefault();
                                                    event.dataTransfer.dropEffect = "copy";
                                                }}
                                                onDragLeave={(event) => {
                                                    event.preventDefault();
                                                    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                                                    if (!dragDepthRef.current) setIsReferenceDragActive(false);
                                                }}
                                                onDrop={(event) => {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    dragDepthRef.current = 0;
                                                    setIsReferenceDragActive(false);
                                                    void fillReferenceSlotFromDrop(item.id, event.dataTransfer);
                                                }}
                                            >
                                                {item.batchImages?.length ? (
                                                    <Image.PreviewGroup>
                                                        <div className="grid grid-cols-4 gap-2">
                                                            {item.batchImages.map((image) => (
                                                                <div key={image.id} className="group/thumb relative min-w-0">
                                                                    <Image src={image.dataUrl} alt={image.name} className="aspect-square w-full rounded-md object-cover" />
                                                                    <button
                                                                        type="button"
                                                                        className="absolute right-1 top-1 z-10 flex size-5 items-center justify-center rounded bg-black/70 text-white"
                                                                        aria-label={t("imageWorkbench.removeFolderImage")}
                                                                        onMouseDown={(event) => event.stopPropagation()}
                                                                        onClick={(event) => {
                                                                            event.preventDefault();
                                                                            event.stopPropagation();
                                                                            setReferences((value) =>
                                                                                value.map((slot) => {
                                                                                    if (slot.id !== item.id || !slot.batchImages) return slot;
                                                                                    const batchImages = slot.batchImages.filter((entry) => entry.id !== image.id);
                                                                                    if (!batchImages.length) return { id: slot.id, name: "", type: "", dataUrl: "" };
                                                                                    return { ...batchImages[0], id: slot.id, name: slot.name, batchImages };
                                                                                }),
                                                                            );
                                                                        }}
                                                                    >
                                                                        <Trash2 className="size-3" />
                                                                    </button>
                                                                    <div className="mt-1 truncate text-[10px] text-stone-500" title={image.name}>{image.name}</div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </Image.PreviewGroup>
                                                ) : item.dataUrl ? (
                                                    <img src={item.dataUrl} alt={item.name} className="size-16 rounded-md object-cover" />
                                                ) : (
                                                    <div className="flex h-16 items-center justify-center text-stone-400">
                                                        <ImagePlus className="size-5" />
                                                    </div>
                                                )}
                                                <div className="mt-2 min-w-0">
                                                    <div className="truncate text-xs text-stone-500">{item.batchImages?.length ? `${item.name} · ${t("imageWorkbench.folderCount", { count: item.batchImages.length })}` : item.name || t("imageWorkbench.slotEmpty")}</div>
                                                    <div className="mt-2 flex flex-wrap gap-1">
                                                        <Button size="small" type="text" icon={<Upload className="size-3.5" />} onClick={() => openFilePicker(item.id)}>{t("workbench.upload")}</Button>
                                                        <Button size="small" type="text" icon={<FolderPlus className="size-3.5" />} onClick={() => openFolderPicker(item.id)}>{t("imageWorkbench.folder")}</Button>
                                                        <Button size="small" type="text" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard(item.id)}>{t("workbench.clipboard")}</Button>
                                                        {item.batchImages?.length ? <Button size="small" type="text" onClick={() => setReferences((value) => value.map((ref) => (ref.id === item.id ? { ...plainReference(ref), id: ref.id } : ref)))}>{t("imageWorkbench.useFixed")}</Button> : null}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    <button type="button" className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-stone-300 py-2 text-sm text-stone-500 hover:bg-black/5 dark:border-stone-700 dark:hover:bg-white/10" onClick={addReferenceSlot}>
                                        <Plus className="size-4" />
                                        {t("imageWorkbench.addReferenceSlot")}
                                    </button>
                                </div>
                                {references.some((item) => item.batchImages?.length) ? (
                                    <div className="mt-2 max-h-36 overflow-y-auto rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-600 dark:border-stone-800 dark:text-stone-300">
                                        <div className="mb-1 font-medium">{t("imageWorkbench.batchPreview")}</div>
                                        {batchMismatch ? <div className="text-red-500">{t("imageWorkbench.batchCountMismatch", { detail: batchMismatch })}</div> : batchPlan.tasks.slice(0, 8).map((task, index) => <div key={`${index}-${task.label}`} className="truncate">{t("imageWorkbench.batchTask", { index: index + 1 })} · {task.label}</div>)}
                                        {!batchMismatch && batchPlan.tasks.length > 8 ? <div className="text-stone-500">{t("imageWorkbench.batchMore", { count: batchPlan.tasks.length - 8 })}</div> : null}
                                    </div>
                                ) : null}
                            </div>

                            <div className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-900 sm:hidden">
                                <span className="truncate text-stone-500 dark:text-stone-400">
                                    {modelOptionLabel(effectiveConfig, model)} · {effectiveConfig.size} · {effectiveConfig.quality}
                                </span>
                                <Button size="small" type="text" icon={<SlidersHorizontal className="size-4" />} onClick={() => setSettingsOpen(true)}>
                                    {t("workbench.adjust")}
                                </Button>
                            </div>

                            <div className="hidden gap-4 sm:grid sm:grid-cols-2">
                                <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} folderImageCount={folderImageCount} />
                            </div>
                        </div>

                        <div className="mt-auto pt-6">
                            <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canGenerate || running || Boolean(batchMismatch)} onClick={() => void generate()}>
                                {t("workbench.generate")}
                            </Button>
                        </div>
                    </div>

                    <div className="thin-scrollbar rounded-lg border border-stone-200 bg-card p-4 shadow-sm dark:border-stone-800 lg:min-h-0 lg:overflow-y-auto lg:p-5">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <h2 className="text-xl font-semibold">{t("workbench.results")}</h2>
                            <div className="flex flex-wrap items-center gap-2">
                                {running ? <Tag className="m-0 px-2 py-1">{t("workbench.waiting", { time: formatDuration(elapsedMs) })}</Tag> : null}
                                {results.some((result) => result.status === "success" && result.image) ? (
                                    <>
                                        <Button size="small" type="text" onClick={() => setResultGallery((value) => !value)}>
                                            {resultGallery ? t("imageWorkbench.cardView") : t("imageWorkbench.galleryView")}
                                        </Button>
                                        {resultGallery ? (
                                            <>
                                                <Button size="small" type="text" onClick={selectAllResults}>
                                                    {t("imageWorkbench.selectAll")}
                                                </Button>
                                                <Button size="small" type="text" icon={<Download className="size-3.5" />} disabled={!selectedResultIds.length} onClick={() => void exportSelectedResults()}>
                                                    {t("imageWorkbench.exportSelected", { count: selectedResultIds.length })}
                                                </Button>
                                            </>
                                        ) : null}
                                    </>
                                ) : null}
                            </div>
                        </div>
                        {results.length ? (
                            resultGallery ? (
                                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                                    {results.map((result, index) => (
                                        <GalleryResultTile
                                            key={result.id}
                                            result={result}
                                            index={index}
                                            selected={selectedResultIds.includes(result.id)}
                                            onToggle={() => result.image && toggleResultSelected(result.id)}
                                            onRetry={() => retryResult(index)}
                                        />
                                    ))}
                                </div>
                            ) : (
                            <div className="space-y-6">
                                {groupResults(results).map((group) => (
                                    <div key={group.key} className="space-y-3">
                                        {group.label ? <div className="truncate text-sm font-medium">{t("imageWorkbench.batchTask", { index: group.taskIndex + 1 })} · <span className="font-normal text-stone-500">{group.label}</span></div> : null}
                                        <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                                            {group.items.map(({ result, index }) =>
                                                result.status === "success" && result.image ? (
                                                    <ResultImageCard key={result.id} image={result.image} index={index} onEdit={addResultToReferences} onDownload={downloadImage} onSaveAsset={saveResultToAssets} />
                                                ) : result.status === "failed" ? (
                                                    <FailedImageCard key={result.id} error={result.error || t("workbench.generationFailed")} onRetry={() => retryResult(index)} />
                                                ) : (
                                                    <PendingImageCard key={result.id} />
                                                ),
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            )
                        ) : (
                            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-stone-300 text-center dark:border-stone-700 lg:min-h-[560px]">
                                <ImagePlus className="mb-4 size-11 text-stone-400" />
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("imageWorkbench.empty")} />
                            </div>
                        )}
                    </div>
                </section>
            </main>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <input
                ref={folderInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                webkitdirectory=""
                onChange={(event) => {
                    void addFolderReference(event.target.files);
                    event.target.value = "";
                }}
            />
            <Drawer title={t("workbench.logs")} placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)}>
                <LogPanel
                    logs={logs}
                    selectedLogIds={selectedLogIds}
                    activeLogId={previewLogId}
                    onSelectedLogIdsChange={setSelectedLogIds}
                    onCreateSession={createSession}
                    onDeleteSelected={() => setDeleteConfirmOpen(true)}
                    onPreviewLog={(log) => void previewGenerationLog(log)}
                />
            </Drawer>
            <Drawer title={t("workbench.settings")} placement="bottom" size="82vh" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="grid grid-cols-2 gap-3 pb-4">
                    <GenerationSettings config={effectiveConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} folderImageCount={folderImageCount} />
                </div>
            </Drawer>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal title={t("workbench.deleteLogs")} open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("workbench.deleteLogsConfirm", { count: selectedLogIds.length })}
            </Modal>
        </div>
    );
}

function GenerationSettings({ config, model, updateConfig, openConfigDialog, folderImageCount }: { config: AiConfig; model: string; updateConfig: UpdateAiConfig; openConfigDialog: (shouldPromptContinue?: boolean) => void; folderImageCount?: number | null }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const concurrency = useImageWorkbenchStore((state) => state.concurrency);
    const setConcurrency = useImageWorkbenchStore((state) => state.setConcurrency);
    const { t } = useTranslation();
    // schema 只读 config.model；需覆盖为当前 imageModel，否则会按全局文生模型显示固定参数
    const panelConfig = { ...config, model, imageModel: model };

    return (
        <>
            <label className="col-span-2 block min-w-0 sm:col-span-1">
                <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">{t("workbench.model")}</span>
                <ModelPicker config={config} value={model} onChange={(value) => updateConfig("imageModel", value)} capability="image" fullWidth onMissingConfig={() => openConfigDialog(false)} />
            </label>
            <div className="col-span-2">
                <ImageSettingsPanel
                    config={panelConfig}
                    onConfigChange={(key, value) => updateConfig(key, value)}
                    onModelParamChange={(key, value) => updateConfig("modelParams", { ...(config.modelParams || {}), [key]: value })}
                    theme={theme}
                    showTitle={false}
                    showCount
                    folderImageCount={folderImageCount}
                    concurrency={concurrency}
                    onConcurrencyChange={setConcurrency}
                    className="space-y-4"
                    maxCount={10}
                />
            </div>
        </>
    );
}

function GalleryResultTile({ result, index, selected, onToggle, onRetry }: { result: GenerationResult; index: number; selected: boolean; onToggle: () => void; onRetry: () => void }) {
    const { t } = useTranslation();
    const image = result.status === "success" ? result.image : undefined;
    return (
        <button type="button" className={`relative aspect-square overflow-hidden rounded-md border text-left ${selected ? "border-stone-950 ring-2 ring-stone-950 dark:border-stone-100 dark:ring-stone-100" : "border-stone-200 dark:border-stone-800"}`} onClick={() => (image ? onToggle() : result.status === "failed" ? onRetry() : undefined)}>
            {image ? <img src={image.dataUrl} alt={t("imageWorkbench.resultAlt", { count: index + 1 })} className="size-full object-cover" /> : <div className="flex size-full items-center justify-center bg-stone-50 text-[10px] text-stone-500 dark:bg-stone-900">{result.status === "failed" ? t("workbench.failed") : t("workbench.generating")}</div>}
            {image ? <span className={`absolute left-1 top-1 flex size-4 items-center justify-center rounded border text-[10px] ${selected ? "border-stone-950 bg-stone-950 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-950" : "border-white/80 bg-black/40 text-transparent"}`}>{selected ? "✓" : ""}</span> : null}
        </button>
    );
}

function ResultImageCard({
    image,
    index,
    onEdit,
    onDownload,
    onSaveAsset,
}: {
    image: GeneratedImage;
    index: number;
    onEdit: (image: GeneratedImage, index: number) => void;
    onDownload: (image: GeneratedImage, index: number) => void;
    onSaveAsset: (image: GeneratedImage, index: number) => void;
}) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <Image src={image.dataUrl} alt={t("imageWorkbench.resultAlt", { count: index + 1 })} className="aspect-square object-cover" />
            <div className="space-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <span>
                        {image.width}x{image.height}
                    </span>
                    <span>{formatBytes(image.bytes)}</span>
                    <span>{formatDuration(image.durationMs)}</span>
                </div>
                <div className="grid min-w-0 grid-cols-3 gap-2">
                    <Tooltip title={t("common.addToAssets")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => void onSaveAsset(image, index)}>
                            {t("common.addToAssets")}
                        </Button>
                    </Tooltip>
                    <Tooltip title={t("imageWorkbench.addReference")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<PenLine className="size-3.5" />} onClick={() => void onEdit(image, index)}>
                            {t("imageWorkbench.addReference")}
                        </Button>
                    </Tooltip>
                    <Tooltip title={t("common.download")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<Download className="size-3.5" />} onClick={() => onDownload(image, index)}>
                            {t("common.download")}
                        </Button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

function PendingImageCard() {
    const { t } = useTranslation();
    return (
        <div className="relative aspect-square overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: "radial-gradient(circle, rgba(120,113,108,0.35) 1.4px, transparent 1.6px)",
                    backgroundSize: "16px 16px",
                }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <LoaderCircle className="size-6 animate-spin" />
                <span>{t("workbench.generating")}</span>
            </div>
        </div>
    );
}

function FailedImageCard({ error, onRetry }: { error: string; onRetry: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <div className="flex aspect-square flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium text-red-600 dark:text-red-300">{t("workbench.failed")}</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
            <div className="flex justify-end border-t border-red-200 p-3 dark:border-red-950">
                <Button size="small" danger onClick={onRetry}>
                    {t("workbench.retry")}
                </Button>
            </div>
        </div>
    );
}

function placeImagesInSlot(value: ReferenceImage[], targetId: string, images: ReferenceImage[]) {
    if (!images.length) return value;
    const slots = value.length ? value : [{ id: targetId, name: "", type: "", dataUrl: "" }];
    const index = slots.findIndex((slot) => slot.id === targetId);
    const at = index >= 0 ? index : slots.length;
    const [first, ...rest] = images;
    const next = index >= 0 ? slots.map((slot) => (slot.id === targetId ? { ...first, id: targetId } : slot)) : [...slots, { ...first, id: targetId }];
    next.splice(at + 1, 0, ...rest);
    return next;
}

function groupResults(results: GenerationResult[]) {
    const groups: Array<{ key: string; taskIndex: number; label: string; items: Array<{ result: GenerationResult; index: number }> }> = [];
    results.forEach((result, index) => {
        const taskIndex = result.taskIndex ?? -1;
        const key = String(taskIndex);
        const current = groups.find((group) => group.key === key);
        if (current) current.items.push({ result, index });
        else groups.push({ key, taskIndex, label: result.taskLabel || "", items: [{ result, index }] });
    });
    return groups;
}

function updateResultAt(results: GenerationResult[], index: number, next: Partial<GenerationResult>) {
    return results.map((item, itemIndex) => (itemIndex === index ? { ...item, ...next } : item));
}

function LogPanel({
    logs,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onCreateSession,
    onDeleteSelected,
    onPreviewLog,
}: {
    logs: GenerationLog[];
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: () => void;
    onPreviewLog: (log: GenerationLog) => void;
}) {
    const { t } = useTranslation();
    const allSelected = Boolean(logs.length) && selectedLogIds.length === logs.length;
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id));

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-base font-semibold">{t("workbench.logs")}</h2>
                </div>
                <Tag className="m-0">{logs.length}</Tag>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>
                    {t("workbench.new")}
                </Button>
                <Button size="small" icon={<CheckSquare className="size-3.5" />} disabled={!logs.length} onClick={toggleAll}>
                    {allSelected ? t("common.cancel") : t("workbench.selectAll")}
                </Button>
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedLogIds.length} onClick={onDeleteSelected}>
                    {t("common.delete")}
                </Button>
            </div>
            <div className="space-y-3">
                {logs.map((log) => (
                    <LogCard
                        key={log.id}
                        log={log}
                        selected={selectedLogIds.includes(log.id)}
                        active={activeLogId === log.id}
                        onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))}
                        onClick={() => onPreviewLog(log)}
                    />
                ))}
                {!logs.length ? <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-sm text-stone-500 dark:border-stone-700">{t("workbench.noLogs")}</div> : null}
            </div>
        </>
    );
}

function LogCard({ log, selected, active, onSelectedChange, onClick }: { log: GenerationLog; selected: boolean; active: boolean; onSelectedChange: (checked: boolean) => void; onClick: () => void }) {
    const { t } = useTranslation();
    const thumbnails = (log.thumbnails || []).filter(Boolean).slice(0, 4);

    return (
        <button
            type="button"
            className={`block w-full rounded-lg border p-2 text-left transition ${active ? "border-stone-900 bg-blue-50 dark:border-stone-100 dark:bg-blue-950/20" : "border-stone-200 bg-background hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-900"}`}
            onClick={onClick}
        >
            <div className="grid grid-cols-[minmax(128px,1fr)_auto] gap-2">
                <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2">
                    <Checkbox className="mt-0.5" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelectedChange(event.target.checked)} />
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold leading-5">{log.title}</div>
                        {thumbnails.length ? (
                            <div className="mt-2 flex gap-1 overflow-hidden">
                                {thumbnails.map((image, index) => (
                                    <img key={`${log.id}-${index}`} src={image} alt="" className="size-8 shrink-0 rounded-md object-cover" />
                                ))}
                            </div>
                        ) : null}
                    </div>
                </div>
                <div className="grid justify-items-end gap-2">
                    <div className="flex gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="blue">
                            {t("workbench.successCount", { count: log.successCount ?? log.imageCount })}
                        </Tag>
                        {log.failCount ? (
                            <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="red">
                                {t("workbench.failCount", { count: log.failCount })}
                            </Tag>
                        ) : null}
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{t("workbench.itemCount", { count: log.imageCount })}</Tag>
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none" color="green">
                            {formatDuration(log.durationMs)}
                        </Tag>
                    </div>
                    <div className="flex justify-end">
                        <Tag className="m-0 flex h-6 items-center rounded-md px-1.5 text-xs leading-none">{log.time}</Tag>
                    </div>
                </div>
            </div>
        </button>
    );
}

async function readStoredLogs() {
    if (typeof window === "undefined") return [];
    try {
        const values: GenerationLog[] = [];
        await logStore.iterate<GenerationLog, void>((value) => {
            values.push(value);
        });
        const logs = await Promise.all(values.map(normalizeLog));
        return logs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const references = await Promise.all(
        (log.references || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const images = await Promise.all(
        (log.images || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || i18n.t("workbench.untitled"),
        prompt: log.prompt || log.title || "",
        time: log.time || new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model: log.model || config.imageModel || "",
        config,
        references,
        durationMs: log.durationMs || 0,
        successCount: log.successCount ?? log.imageCount ?? 0,
        failCount: log.failCount || 0,
        imageCount: log.imageCount || log.successCount || 0,
        size: log.size || config.size || "",
        quality: log.quality || config.quality || "",
        status: log.status || "success",
        images,
        thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        images: log.images.map((image) => ({ ...image, dataUrl: image.storageKey ? "" : image.dataUrl })),
        thumbnails: [],
    };
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        imageModel: log.config?.imageModel || log.model || "",
        quality: log.config?.quality || log.quality || "",
        size: log.config?.size || log.size || "",
        count: log.config?.count || String(log.imageCount || log.successCount || 1),
    };
}

function buildLog({
    prompt,
    model,
    config,
    references,
    durationMs,
    successCount,
    failCount,
    status,
    images,
}: {
    prompt: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    status: GenerationLog["status"];
    images: GeneratedImage[];
}): GenerationLog {
    const logConfig = {
        model: config.model,
        imageModel: config.imageModel,
        quality: config.quality,
        size: config.size,
        count: config.count,
    };
    return {
        id: nanoid(),
        createdAt: Date.now(),
        title: prompt.slice(0, 12) || i18n.t("workbench.untitled"),
        prompt,
        time: new Date().toLocaleString(i18n.resolvedLanguage, { hour12: false }),
        model,
        config: logConfig,
        references,
        durationMs,
        successCount,
        failCount,
        imageCount: Number(logConfig.count) || successCount,
        size: logConfig.size,
        quality: logConfig.quality,
        status,
        images,
        thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
    };
}
