type PlanHandoffHandler = () => void | Promise<void>;
type PlanPreviewHandler = (markdown: string, threadId?: string, turnId?: string) => void;

let handler: PlanHandoffHandler | null = null;
let previewHandler: PlanPreviewHandler | null = null;

export function registerPlanHandoff(next: PlanHandoffHandler | null) {
    handler = next;
}

export function requestPlanHandoff() {
    return handler?.();
}

export function registerPlanPreview(next: PlanPreviewHandler | null) {
    previewHandler = next;
}

export function requestPlanPreview(markdown: string, threadId?: string, turnId?: string) {
    previewHandler?.(markdown, threadId, turnId);
}
