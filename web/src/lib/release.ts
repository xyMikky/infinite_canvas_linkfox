export type ReleaseInfo = {
    version: string;
    date: string;
    items: { type: string; content: string }[];
};

export function normalizeVersion(version: string) {
    return version.trim().replace(/^v/i, "");
}

/** positive => a newer than b */
export function compareVersion(a: string, b: string) {
    const parse = (v: string) => normalizeVersion(v).split(/[.+-]/).map((part) => parseInt(part, 10) || 0);
    const pa = parse(a);
    const pb = parse(b);
    const n = Math.max(pa.length, pb.length, 3);
    for (let i = 0; i < n; i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

export function parseReleaseNotes(body: string, fallback = ""): ReleaseInfo["items"] {
    const items = body
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !/^#{1,6}\s/.test(line) && !/^v?\d+\.\d+(\.\d+)?\s*$/i.test(line))
        .map((line) => {
            const typed = line.match(/^(?:[-*+]+\s+)?\[(.+?)\]\s+(.+)$/);
            if (typed) return { type: typed[1], content: typed[2] };
            const listed = line.match(/^[-*+]+\s+(.+)$/);
            return { type: "调整", content: listed?.[1] || line };
        });
    if (items.length) return items;
    const text = body.trim();
    return text ? [{ type: "调整", content: text }] : fallback ? [{ type: "调整", content: fallback }] : [];
}

export function parseChangelog(content: string): ReleaseInfo[] {
    return content
        .split(/^## /m)
        .slice(1)
        .map((block) => {
            const [title = "", ...lines] = block.trim().split("\n");
            const version = title.replace(/\s+-.*$/, "").trim();
            const date = title.match(/\s+-\s+(.+)$/)?.[1]?.trim() || "";
            return { version, date, items: parseReleaseNotes(lines.join("\n")) };
        })
        .filter((release) => release.version && !/^unreleased$/i.test(release.version) && release.items.length);
}

/** GitHub 一条 Release 可能只写本版本，也可能整份 CHANGELOG；按标题拆成多条 */
export function releasesFromGithubBody(tag: string, body: string, date: string): ReleaseInfo[] {
    const text = (body || "").trim();
    if (!text) return [];
    const sections = parseChangelog(/^##\s/m.test(text) ? text : `## ${normalizeVersion(tag)}\n${text}`);
    if (sections.length) return sections.map((item) => ({ ...item, date: item.date || date }));
    return [{ version: normalizeVersion(tag), date, items: parseReleaseNotes(text) }];
}
