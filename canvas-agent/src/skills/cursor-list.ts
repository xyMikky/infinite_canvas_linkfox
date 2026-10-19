import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import matter from "gray-matter";

export type CursorSkillSummary = {
    name: string;
    description: string;
    path: string;
    scope: "repo" | "user";
};

const SKIP_DIRS = new Set(["node_modules", ".git", ".hg", ".svn"]);
const MAX_DEPTH = 8;

/** 按 Cursor 官方目录扫描 SKILL.md，只读列出画布 Agent 工作区会发现的 Skill。 */
export function listCursorSkills(workspacePath: string): { skills: CursorSkillSummary[]; errors: string[] } {
    const home = os.homedir();
    const roots: Array<{ dir: string; scope: "repo" | "user" }> = [
        { dir: path.join(workspacePath, ".agents", "skills"), scope: "repo" },
        { dir: path.join(workspacePath, ".cursor", "skills"), scope: "repo" },
        { dir: path.join(home, ".agents", "skills"), scope: "user" },
        { dir: path.join(home, ".cursor", "skills"), scope: "user" },
    ];
    const seen = new Set<string>();
    const skills: CursorSkillSummary[] = [];
    const errors: string[] = [];
    for (const root of roots) collectSkillFiles(root.dir, root.scope, 0, skills, errors, seen);
    skills.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
    return { skills, errors };
}

function collectSkillFiles(dir: string, scope: "repo" | "user", depth: number, skills: CursorSkillSummary[], errors: string[], seen: Set<string>) {
    if (depth > MAX_DEPTH || !existsSync(dir)) return;
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
        errors.push(`${dir}：${error instanceof Error ? error.message : String(error)}`);
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
            collectSkillFiles(full, scope, depth + 1, skills, errors, seen);
            continue;
        }
        if (!entry.isFile() || entry.name.toLowerCase() !== "skill.md") continue;
        const resolved = path.resolve(full);
        if (seen.has(resolved)) continue;
        seen.add(resolved);
        try {
            skills.push(readSkillSummary(resolved, scope));
        } catch (error) {
            errors.push(`${resolved}：${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

function readSkillSummary(filePath: string, scope: "repo" | "user"): CursorSkillSummary {
    const parsed = matter(readFileSync(filePath, "utf8"));
    const folderName = path.basename(path.dirname(filePath));
    const rawName = typeof parsed.data.name === "string" ? parsed.data.name.trim() : "";
    const rawDescription = typeof parsed.data.description === "string" ? parsed.data.description.replace(/\s+/g, " ").trim() : "";
    return {
        name: rawName || folderName,
        description: rawDescription,
        path: filePath,
        scope,
    };
}
