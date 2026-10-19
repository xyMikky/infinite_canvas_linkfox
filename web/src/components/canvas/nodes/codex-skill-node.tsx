import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { expandUpstreamWithCarry } from "@/lib/canvas/canvas-resource-references";
import type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import type { CanvasNodeContext, CanvasNodeDefinition } from "@/types/canvas-plugin";
import type { AgentSkillSummary } from "@/services/api/canvas-agent";

export const CODEX_SKILL_NODE_TYPE = "codex-skill";
export const CODEX_SKILL_DRAG_MIME = "application/x-infinite-canvas-skill";
/** Chromium 对自定义 MIME 不稳定，同时写入 text/plain 兜底 */
export const CODEX_SKILL_TEXT_PREFIX = "infinite-canvas-skill:";

export type CodexSkillRef = { name: string; path: string };

export type CodexSkillDragPayload = {
    name: string;
    path: string;
    displayName?: string;
    description?: string;
    enabled?: boolean;
};

export function skillMetadataFromPayload(payload: CodexSkillDragPayload): CanvasNodeMetadata {
    return {
        skillName: payload.name,
        skillPath: payload.path,
        skillDisplayName: payload.displayName || payload.name,
        skillDescription: payload.description || "",
        skillEnabled: payload.enabled !== false,
    };
}

export function skillPayloadFromSummary(skill: AgentSkillSummary): CodexSkillDragPayload {
    return {
        name: skill.name,
        path: skill.path,
        displayName: skill.interface?.displayName || skill.name,
        description: skill.interface?.shortDescription || skill.shortDescription || skill.description || "",
        enabled: skill.enabled,
    };
}

export function encodeCodexSkillDragText(payload: CodexSkillDragPayload) {
    return `${CODEX_SKILL_TEXT_PREFIX}${JSON.stringify(payload)}`;
}

export function writeCodexSkillDataTransfer(dataTransfer: DataTransfer, payload: CodexSkillDragPayload) {
    const json = JSON.stringify(payload);
    const text = encodeCodexSkillDragText(payload);
    try {
        dataTransfer.setData(CODEX_SKILL_DRAG_MIME, json);
    } catch {
        // ignore unsupported custom types
    }
    dataTransfer.setData("application/json", json);
    dataTransfer.setData("text/plain", text);
    dataTransfer.effectAllowed = "copy";
}

export function parseCodexSkillDragPayload(raw: string | null | undefined): CodexSkillDragPayload | null {
    if (!raw?.trim()) return null;
    let text = raw.trim();
    if (text.startsWith(CODEX_SKILL_TEXT_PREFIX)) text = text.slice(CODEX_SKILL_TEXT_PREFIX.length).trim();
    try {
        const data = JSON.parse(text) as Partial<CodexSkillDragPayload>;
        if (!data.name || !data.path) return null;
        return {
            name: String(data.name),
            path: String(data.path),
            displayName: data.displayName ? String(data.displayName) : String(data.name),
            description: data.description ? String(data.description) : "",
            enabled: data.enabled !== false,
        };
    } catch {
        return null;
    }
}

export function readCodexSkillFromDataTransfer(dataTransfer: DataTransfer): CodexSkillDragPayload | null {
    return (
        parseCodexSkillDragPayload(dataTransfer.getData(CODEX_SKILL_DRAG_MIME))
        || parseCodexSkillDragPayload(dataTransfer.getData("application/json"))
        || parseCodexSkillDragPayload(dataTransfer.getData("text/plain"))
    );
}

export function readCodexSkillRef(node: CanvasNodeData | null | undefined): CodexSkillRef | null {
    if (!node || node.type !== CODEX_SKILL_NODE_TYPE) return null;
    const name = typeof node.metadata?.skillName === "string" ? node.metadata.skillName.trim() : "";
    const path = typeof node.metadata?.skillPath === "string" ? node.metadata.skillPath.trim() : "";
    if (!name || !path) return null;
    return { name, path };
}

export function collectUpstreamCodexSkills(upstream: CanvasNodeData[]): CodexSkillRef[] {
    const skills: CodexSkillRef[] = [];
    for (const node of upstream) {
        const skill = readCodexSkillRef(node);
        if (skill && !skills.some((item) => item.path === skill.path)) skills.push(skill);
    }
    return skills;
}

/** 取第一条入边对应的 codex-skill（按 connections 顺序）。 */
export function collectUpstreamCodexSkill(upstream: CanvasNodeData[]): CodexSkillRef | null {
    return collectUpstreamCodexSkills(upstream)[0] || null;
}

export function collectUpstreamCodexSkillsFromGraph(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): CodexSkillRef[] {
    return collectUpstreamCodexSkills(expandUpstreamWithCarry(nodeId, nodes, connections));
}

export function collectUpstreamCodexSkillFromGraph(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): CodexSkillRef | null {
    return collectUpstreamCodexSkillsFromGraph(nodeId, nodes, connections)[0] || null;
}

export function buildAddCodexSkillNodeOp(input: {
    skill: CodexSkillDragPayload;
    position: { x: number; y: number };
    id?: string;
}): CanvasAgentOp {
    const title = input.skill.displayName || input.skill.name;
    return {
        type: "add_node",
        id: input.id,
        nodeType: CODEX_SKILL_NODE_TYPE,
        title,
        position: input.position,
        metadata: skillMetadataFromPayload(input.skill),
    };
}

function CodexSkillContent({ ctx }: { ctx: CanvasNodeContext }) {
    const { t } = useTranslation();
    const name = (ctx.node.metadata?.skillDisplayName || ctx.node.metadata?.skillName || ctx.node.title || "").trim();
    const description = (ctx.node.metadata?.skillDescription || "").trim();
    const enabled = ctx.node.metadata?.skillEnabled !== false;
    const skillId = (ctx.node.metadata?.skillName || "").trim();

    return (
        <div className="flex h-full w-full flex-col justify-center gap-2 px-4 py-3" style={{ color: ctx.theme.node.muted }}>
            <div className="flex items-center gap-2">
                <span className="grid size-9 place-items-center rounded-xl" style={{ background: ctx.theme.toolbar.activeBg, color: "#a78bfa" }}>
                    <Sparkles className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold" style={{ color: ctx.theme.node.text }}>
                        {name || t("canvas.codexSkill.title")}
                    </div>
                    <div className="truncate text-[11px]" style={{ color: ctx.theme.node.faint }}>
                        {skillId ? `$${skillId}` : t("canvas.codexSkill.empty")}
                    </div>
                </div>
            </div>
            {description ? (
                <div className="line-clamp-3 text-xs leading-5">{description}</div>
            ) : (
                <div className="text-xs leading-5 opacity-80">{t("canvas.codexSkill.hint")}</div>
            )}
            {!enabled ? <div className="text-[11px] text-amber-400">{t("canvas.codexSkill.disabledHint")}</div> : null}
        </div>
    );
}

export function getCodexSkillNodeDefinition(): CanvasNodeDefinition {
    return {
        type: CODEX_SKILL_NODE_TYPE,
        title: "Codex Skill",
        description: "Connect to Codex CLI nodes to auto-load this skill",
        icon: <Sparkles className="size-5" />,
        defaultSize: { width: 260, height: 140 },
        defaultMetadata: {
            skillName: "",
            skillPath: "",
            skillDisplayName: "",
            skillDescription: "",
            skillEnabled: true,
        },
        minimapColor: "#a78bfa",
        showInCreateMenu: false,
        hidePanel: true,
        resource: () => null,
        Content: CodexSkillContent,
    };
}
