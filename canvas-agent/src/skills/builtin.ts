import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUILTIN_ROOT = fileURLToPath(new URL("../../builtin-skills", import.meta.url));
const MARKER_FILE = ".builtin-skills.json";

/**
 * 把随包分发的内置 Skill 同步到站点工作空间 `.agents/skills`。
 * 规则：从未安装过则安装；用户删除过不复活；官方内容更新且用户未改动过才覆盖升级。
 */
export function syncBuiltinSkills(workspacePath: string, builtinRoot = BUILTIN_ROOT) {
    let names: string[];
    try {
        names = fs.readdirSync(builtinRoot).filter((name) => fs.statSync(path.join(builtinRoot, name)).isDirectory());
    } catch {
        return;
    }
    if (!names.length) return;
    const skillsRoot = path.join(workspacePath, ".agents", "skills");
    const markerPath = path.join(skillsRoot, MARKER_FILE);
    const marker = readMarker(markerPath);
    let changed = false;
    for (const name of names) {
        const source = path.join(builtinRoot, name);
        const target = path.join(skillsRoot, name);
        const bundledHash = hashDirectory(source);
        const installedHash = marker[name];
        if (!fs.existsSync(target)) {
            if (installedHash) continue;
            copyDirectory(source, target);
            marker[name] = bundledHash;
            changed = true;
        } else if (installedHash && installedHash !== bundledHash && hashDirectory(target) === installedHash) {
            fs.rmSync(target, { recursive: true, force: true });
            copyDirectory(source, target);
            marker[name] = bundledHash;
            changed = true;
        }
    }
    if (changed) fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
}

function readMarker(markerPath: string): Record<string, string> {
    try {
        const parsed = JSON.parse(fs.readFileSync(markerPath, "utf8")) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "string")) as Record<string, string>;
        }
    } catch {
        // 标记缺失或损坏时按从未安装处理
    }
    return {};
}

/** 目录内容指纹：相对路径 + 文件内容，换行统一后参与摘要，避免 Git 换行差异误判用户改动。 */
function hashDirectory(root: string) {
    const hash = crypto.createHash("sha256");
    for (const relative of listFiles(root, "")) {
        hash.update(relative.replaceAll(path.sep, "/"));
        hash.update("\0");
        hash.update(fs.readFileSync(path.join(root, relative), "utf8").replaceAll("\r\n", "\n"));
        hash.update("\0");
    }
    return hash.digest("hex");
}

function listFiles(root: string, prefix: string): string[] {
    const entries = fs.readdirSync(path.join(root, prefix), { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const relative = prefix ? path.join(prefix, entry.name) : entry.name;
        if (entry.isDirectory()) files.push(...listFiles(root, relative));
        else if (entry.isFile()) files.push(relative);
    }
    return files.sort();
}

function copyDirectory(source: string, target: string) {
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(source, target, { recursive: true });
}
