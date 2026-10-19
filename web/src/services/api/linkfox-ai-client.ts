import axios from "axios";

import i18n from "@/i18n";
import { getImageBlob } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import type { LinkfoxRequestConfig } from "./linkfox-client";

const text = (key: string) => i18n.t(`linkfoxAi.${key}`);
const BASE_URL = import.meta.env.DEV || window.desktopAPI ? "/api/linkfox-v3" : "https://ai-api.linkfox.com";
const extensions: Record<string, string> = { "image/jpeg": ".jpg", "image/webp": ".webp", "video/webm": ".webm", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/mp4": ".m4a" };

/** 任务编号是 int64。先把 16 位及以上整数收成字符串，避免 JSON.parse 丢精度后被当成无效 ID。 */
function parseLinkfoxJson(payload: unknown) {
    if (typeof payload !== "string" || !payload.trim()) return payload;
    try {
        return JSON.parse(payload.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"'));
    } catch {
        return payload;
    }
}

export function linkfoxTaskId(value: unknown): string {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
    if (!value || typeof value !== "object") return "";
    const record = value as { id?: unknown; taskId?: unknown; data?: unknown };
    return linkfoxTaskId(record.id) || linkfoxTaskId(record.taskId) || linkfoxTaskId(record.data);
}

export function linkfoxTaskStatus(value: unknown) {
    const status = Number(value);
    return Number.isFinite(status) ? status : NaN;
}

export async function requestLinkfoxAi<T>(config: LinkfoxRequestConfig, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const { data } = await axios.post<{ code: number | string; msg?: string; data: T }>(`${BASE_URL}${path}`, body, {
        headers: { Authorization: `Bearer ${config.apiKey.trim()}` },
        signal,
        timeout: 120_000,
        transformResponse: [parseLinkfoxJson],
    });
    if (String(data.code) !== "200" || data.data == null) throw new Error(data.msg || text("requestFailed"));
    return data.data;
}

export async function resolveLinkfoxAiReferenceUrl(config: LinkfoxRequestConfig, ref: ReferenceImage | ReferenceVideo | ReferenceAudio, signal?: AbortSignal) {
    const isImage = "dataUrl" in ref;
    const stored = ref.storageKey ? await (isImage ? getImageBlob(ref.storageKey) : getMediaBlob(ref.storageKey)) : null;
    const url = (isImage ? ref.dataUrl : ref.url) || ref.url || "";
    if (!stored && !url) throw new Error(text("referenceMissing"));
    if (!stored && /^https?:\/\//i.test(url) && new URL(url).origin !== window.location.origin) return url;
    const blob = stored || (await axios.get<Blob>(url, { responseType: "blob", signal, timeout: 60_000 })).data;
    if (!blob.size) throw new Error(text("referenceMissing"));
    const extension = ref.name.match(/\.[a-z0-9]{2,5}$/i)?.[0] || extensions[ref.type] || extensions[blob.type] || (isImage ? ".png" : ref.type.startsWith("audio/") ? ".mp3" : ".mp4");
    const fileName = `reference${extension}`;
    const upload = await requestLinkfoxAi<{ viewUrl: string; policy: { url: string; signature: string; policy: string; key: string; OSSAccessKeyId: string } }>(config, "/image/v1/generateUploadUrl", { fileName }, signal);
    const form = new FormData();
    const { url: uploadUrl, ...fields } = upload.policy;
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    form.append("success_action_status", "201");
    form.append("file", blob, fileName);
    await axios.post(uploadUrl, form, { signal, timeout: 180_000 });
    return upload.viewUrl;
}
