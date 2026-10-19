import i18n from "@/i18n";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { closedGenerationError, modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import { isRunninghubModel3dEndpoint, requestRunninghubModel } from "./runninghub-model";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export type ModelGenerationResult = { blob: Blob; fileName: string; mimeType: string; showTextures: boolean };

export async function requestModelGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: { signal?: AbortSignal }): Promise<ModelGenerationResult> {
    throw closedGenerationError(config.model, "model") || new Error(apiText("modelGenerationUnavailable"));
    const selectedModel = (config.model || config.modelModel || "").trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    if (requestConfig.apiFormat !== "runninghub") throw new Error(apiText("runninghubModelOnly"));
    if (!isRunninghubModel3dEndpoint(modelOptionName(selectedModel))) throw new Error(apiText("runninghubModelUnsupported"));
    const result = await requestRunninghubModel(requestConfig, prompt, references, options);
    return { blob: result.blob, fileName: result.fileName, mimeType: result.mimeType, showTextures: result.showTextures };
}

export async function storeGeneratedModel(result: ModelGenerationResult): Promise<UploadedFile & { fileName: string; showTextures: boolean }> {
    const uploaded = await uploadMediaFile(result.blob, "model");
    return { ...uploaded, fileName: result.fileName, showTextures: result.showTextures, mimeType: result.mimeType || uploaded.mimeType };
}
