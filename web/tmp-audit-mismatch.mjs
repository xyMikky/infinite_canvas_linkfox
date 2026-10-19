import fs from "fs";
import path from "path";

const ROOT = "F:/infinite-canvas-main";
const SRC = path.join(ROOT, "web/src");
const AGENT = path.join(ROOT, "canvas-agent/src");
const ELECTRON = path.join(ROOT, "web/electron");

const MARKERS = ["accountId", "amzn1.account", "Amazon Customer", "www.amazon.com", "ue_csm", "aPageStart"];
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".cjs", ".mjs"]);

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const name of fs.readdirSync(dir)) {
        if (name === "node_modules" || name === "dist" || name === "release") continue;
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        if (st.isDirectory()) walk(p, out);
        else out.push(p);
    }
    return out;
}

function isBad(text, file) {
    const head = text.slice(0, 800);
    if (text.slice(0, 200).includes("\u0000")) return "nul";
    if (MARKERS.some((m) => head.includes(m))) return "amazon";
    const t = head.trimStart().toLowerCase();
    if (t.startsWith("<!doctype") || t.startsWith("<html")) return "html";
    if (CODE_EXT.has(path.extname(file)) && head.trimStart().startsWith("{") && (head.includes("accountId") || head.includes("reviewerID"))) return "json";
    return "";
}

const files = [...walk(SRC), ...walk(AGENT), ...walk(ELECTRON)];
const bad = [];
for (const f of files) {
    let buf;
    try {
        buf = fs.readFileSync(f);
    } catch {
        continue;
    }
    // utf-16/32 BOM
    if (buf[0] === 0xff && buf[1] === 0xfe) bad.push(["utf16le", f]);
    else if (buf[0] === 0xfe && buf[1] === 0xff) bad.push(["utf16be", f]);
    else if (buf[0] === 0 && buf[1] === 0 && buf[2] === 0xfe && buf[3] === 0xff) bad.push(["utf32be", f]);
    const text = buf.toString("utf8");
    const why = isBad(text, f);
    if (why) bad.push([why, f]);
}
console.log("still-bad", bad.length);
for (const [why, f] of bad) console.log(why, f.replace(ROOT + path.sep, ""));

// missing exports: parse import { x } from relative project files
const importRe = /import\s+(?:type\s+)?(?:\{([^}]+)\}|([A-Za-z0-9_*]+))\s+from\s+["'](@\/[^"']+)["']/g;
const missing = [];
for (const f of files) {
    if (!f.endsWith(".ts") && !f.endsWith(".tsx")) continue;
    const text = fs.readFileSync(f, "utf8");
    let m;
    const re = new RegExp(importRe.source, "g");
    while ((m = re.exec(text))) {
        const names = (m[1] || "")
            .split(",")
            .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
            .filter((s) => s && s !== "type");
        const spec = m[3];
        if (!spec.startsWith("@/")) continue;
        const rel = spec.slice(2);
        const base = path.join(SRC, rel);
        const candidates = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"].map((ext) => (ext.startsWith(".") || ext.startsWith("/") ? base + ext : base));
        const target = candidates.find((c) => fs.existsSync(c));
        if (!target || fs.statSync(target).isDirectory()) continue;
        const src = fs.readFileSync(target, "utf8");
        for (const name of names) {
            if (!name) continue;
            const ok =
                src.includes(`export function ${name}`) ||
                src.includes(`export const ${name}`) ||
                src.includes(`export type ${name}`) ||
                src.includes(`export interface ${name}`) ||
                src.includes(`export class ${name}`) ||
                src.includes(`export { ${name}`) ||
                src.includes(`export {${name}`) ||
                new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`).test(src) ||
                new RegExp(`export\\s+(type|interface|const|class|enum)\\s+${name}\\b`).test(src) ||
                new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`).test(src);
            if (!ok) missing.push(`${path.relative(SRC, f)} -> ${spec} :: ${name}`);
        }
    }
}
console.log("\nmissing-exports", missing.length);
for (const line of missing.slice(0, 80)) console.log(line);
