import type { ReferenceImage } from "@/types/image";

import i18n from "@/i18n";

export function imageReferenceLabel(index: number) {
    return i18n.t("imageReferences.label", { index: index + 1 });
}

export function buildImageReferencePromptText(prompt: string, _references: ReferenceImage[] = []) {
    // 只发送用户提示词，不再拼接「图片1/图片2」等参考图前缀（缺 i18n 键时会把键名原样发出去）
    return prompt.trim();
}
