import { useMemo, useState } from "react";
import { Dropdown, Input, Tooltip } from "antd";
import { Check, LoaderCircle, Search, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { resolveAgentEndpointForPage } from "@/services/api/canvas-agent";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";

export function AgentSkillPicker() {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const connected = useAgentStore((state) => state.connected);
    const skills = useAgentSkillStore((state) => state.skills);
    const selectedSkill = useAgentSkillStore((state) => state.selectedSkill);
    const loading = useAgentSkillStore((state) => state.loading);
    const selectSkill = useAgentSkillStore((state) => state.selectSkill);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const enabled = useMemo(() => {
        const q = query.trim().toLowerCase();
        return skills.filter((skill) => {
            if (!skill.enabled) return false;
            if (!q) return true;
            const hay = `${skill.interface?.displayName || ""} ${skill.name} ${skill.interface?.shortDescription || ""} ${skill.description || ""}`.toLowerCase();
            return hay.includes(q);
        });
    }, [query, skills]);

    const label = selectedSkill
        ? selectedSkill.interface?.displayName || selectedSkill.name
        : t("agent.skills.select");

    return (
        <Tooltip title={connected ? t("agent.skills.select") : t("agent.skills.connectHint")} placement="top" open={open ? false : undefined}>
            <span className="inline-flex shrink-0">
                <Dropdown
                    trigger={["click"]}
                    placement="topLeft"
                    disabled={!connected}
                    open={open}
                    onOpenChange={(next) => {
                        setOpen(next);
                        const store = useAgentSkillStore.getState();
                        const agent = useAgentStore.getState();
                        if (next && !store.loaded && !store.loading) void store.loadSkills(resolveAgentEndpointForPage(agent.url), agent.token);
                        if (!next) setQuery("");
                    }}
                    popupRender={() => (
                        <div
                            className="w-72 overflow-hidden rounded-xl border shadow-xl"
                            style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text }}
                            onMouseDown={(event) => event.stopPropagation()}
                        >
                            <div className="border-b p-2" style={{ borderColor: theme.node.stroke }}>
                                <Input
                                    allowClear
                                    autoFocus
                                    size="small"
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    prefix={<Search className="size-3.5" />}
                                    placeholder={t("agent.skills.search")}
                                    aria-label={t("agent.skills.search")}
                                />
                            </div>
                            <div className="thin-scrollbar max-h-64 overflow-y-auto py-1">
                                {loading && !skills.length ? (
                                    <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs" style={{ color: theme.node.muted }}>
                                        <LoaderCircle className="size-3.5 animate-spin" />
                                        {t("agent.skills.loading")}
                                    </div>
                                ) : enabled.length ? (
                                    enabled.map((skill) => {
                                        const selected = selectedSkill?.name === skill.name && selectedSkill.path === skill.path;
                                        return (
                                            <button
                                                key={`${skill.name}:${skill.path}`}
                                                type="button"
                                                className="flex w-full items-start gap-2 px-3 py-2 text-left transition hover:bg-black/5 dark:hover:bg-white/10"
                                                onClick={() => {
                                                    selectSkill(selected ? null : skill);
                                                    setOpen(false);
                                                }}
                                            >
                                                <Sparkles className="mt-0.5 size-3.5 shrink-0" style={{ color: selected ? theme.node.text : theme.node.muted }} />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-xs font-medium">{skill.interface?.displayName || skill.name}</span>
                                                    <span className="mt-0.5 block line-clamp-2 text-[11px] leading-4" style={{ color: theme.node.muted }}>
                                                        {skill.interface?.shortDescription || skill.shortDescription || skill.description || t("canvas.codexSkill.skillEmpty")}
                                                    </span>
                                                </span>
                                                {selected ? <Check className="mt-0.5 size-3.5 shrink-0" /> : null}
                                            </button>
                                        );
                                    })
                                ) : (
                                    <div className="px-3 py-6 text-center text-xs" style={{ color: theme.node.muted }}>
                                        {t(skills.some((skill) => skill.enabled) ? "agent.skills.noMatch" : "agent.skills.none")}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                >
                    <button
                        type="button"
                        disabled={!connected}
                        className="flex h-9 w-9 min-w-9 shrink-0 items-center justify-center gap-0 rounded-full px-0 text-xs font-medium transition hover:bg-black/5 disabled:opacity-40 @min-[660px]:w-auto @min-[660px]:min-w-0 @min-[660px]:justify-start @min-[660px]:gap-1.5 @min-[660px]:px-2.5 dark:hover:bg-white/10"
                        style={{ color: selectedSkill ? theme.node.text : theme.node.muted }}
                        aria-label={t("agent.skills.select")}
                    >
                        <Sparkles className="size-3.5" />
                        <span className="hidden max-w-24 truncate @min-[660px]:inline">{label}</span>
                    </button>
                </Dropdown>
            </span>
        </Tooltip>
    );
}
