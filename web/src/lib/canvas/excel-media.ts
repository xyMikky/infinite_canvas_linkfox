import { unzipSync, strFromU8 } from "fflate";

export type ExcelCellImageMap = Map<string, string>; // `${sheetName}!${row}:${col}` -> dataUrl

const MAX_EMBED_BYTES = 350_000;
const MAX_IMAGES = 400;

/** 从 xlsx zip 中提取嵌入图，并映射到各工作表单元格（0-based） */
export function extractExcelCellImages(buffer: ArrayBuffer, sheetNames: string[]): ExcelCellImageMap {
    const out: ExcelCellImageMap = new Map();
    let entries: Record<string, Uint8Array>;
    try {
        entries = unzipSync(new Uint8Array(buffer));
    } catch {
        return out;
    }

    const files = normalizeZipPaths(entries);
    const mediaUrls = loadMediaUrls(files);
    if (!mediaUrls.size) return out;

    const sheetPathByName = resolveSheetPaths(files, sheetNames);
    const drawingsBySheet = new Map<string, string[]>();

    for (const [sheetName, sheetPath] of sheetPathByName) {
        const rels = files.get(relsPathFor(sheetPath));
        if (!rels) continue;
        const targets = findDrawingTargets(strFromU8(rels)).map((target) => resolveZipPath(sheetPath, target));
        if (targets.length) drawingsBySheet.set(sheetName, targets);
    }

    // 1) 各表 drawing 锚点
    for (const [sheetName, drawingPaths] of drawingsBySheet) {
        for (const drawingPath of drawingPaths) {
            applyDrawingAnchors(files, mediaUrls, sheetName, drawingPath, out);
        }
    }

    // 2) DISPIMG 单元格图
    applyCellImageDispIds(files, sheetNames, sheetPathByName, mediaUrls, out);

    // 3) 某表仍无图：用该表 drawing 引用的 media 按顺序填 A 列
    for (const sheetName of sheetNames) {
        if (sheetHasImages(out, sheetName)) continue;
        const ordered = collectDrawingMedia(files, mediaUrls, drawingsBySheet.get(sheetName) || []);
        ordered.forEach((url, index) => out.set(cellKey(sheetName, index + 1, 0), url));
    }

    // 4) 仍无图的表：复用已有图表的同坐标图片（多指标表常见）
    const donor = sheetNames.find((name) => sheetHasImages(out, name));
    if (donor) {
        const donorEntries = [...out.entries()].filter(([key]) => key.startsWith(`${donor}!`));
        for (const sheetName of sheetNames) {
            if (sheetName === donor || sheetHasImages(out, sheetName)) continue;
            for (const [key, url] of donorEntries) {
                out.set(`${sheetName}!${key.slice(donor.length + 1)}`, url);
            }
        }
    }

    // 5) 全局仍无映射：把全部 media 按文件名顺序铺到每个表的 A 列
    if (![...out.keys()].length) {
        const sorted = sortedMediaUrls(mediaUrls);
        for (const sheetName of sheetNames) {
            sorted.forEach((url, index) => out.set(cellKey(sheetName, index + 1, 0), url));
        }
    }

    return out;
}

export function cellKey(sheetName: string, row: number, col: number) {
    return `${sheetName}!${row}:${col}`;
}

function loadMediaUrls(files: Map<string, Uint8Array>) {
    const mediaUrls = new Map<string, string>();
    let imageCount = 0;
    for (const [path, data] of files) {
        if (!path.startsWith("xl/media/") || path.endsWith("/")) continue;
        if (data.byteLength > MAX_EMBED_BYTES || data.byteLength < 32) continue;
        if (imageCount >= MAX_IMAGES) break;
        const url = bytesToDataUrl(path, data);
        if (!url) continue;
        mediaUrls.set(path, url);
        const base = path.split("/").pop();
        if (base) mediaUrls.set(base, url);
        imageCount += 1;
    }
    return mediaUrls;
}

function sortedMediaUrls(mediaUrls: Map<string, string>) {
    return [...mediaUrls.entries()]
        .filter(([key]) => key.startsWith("xl/media/"))
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
        .map(([, url]) => url);
}

function applyDrawingAnchors(
    files: Map<string, Uint8Array>,
    mediaUrls: Map<string, string>,
    sheetName: string,
    drawingPath: string,
    out: ExcelCellImageMap,
) {
    const drawing = files.get(drawingPath);
    const drawingRels = files.get(relsPathFor(drawingPath));
    if (!drawing || !drawingRels) return;
    const ridToMedia = parseRelationshipTargets(strFromU8(drawingRels));
    const anchors = parseDrawingAnchors(strFromU8(drawing));
    for (const anchor of anchors) {
        const target = ridToMedia.get(anchor.embedId);
        if (!target) continue;
        const url = lookupMediaUrl(mediaUrls, drawingPath, target);
        if (!url) continue;
        out.set(cellKey(sheetName, anchor.row, anchor.col), url);
    }
}

function collectDrawingMedia(files: Map<string, Uint8Array>, mediaUrls: Map<string, string>, drawingPaths: string[]) {
    const urls: string[] = [];
    const seen = new Set<string>();
    for (const drawingPath of drawingPaths) {
        const drawingRels = files.get(relsPathFor(drawingPath));
        if (!drawingRels) continue;
        for (const target of parseRelationshipTargets(strFromU8(drawingRels)).values()) {
            if (!/media\//i.test(target) && !/^image\d+/i.test(target.split("/").pop() || "")) continue;
            const url = lookupMediaUrl(mediaUrls, drawingPath, target);
            if (!url || seen.has(url)) continue;
            seen.add(url);
            urls.push(url);
        }
    }
    return urls;
}

function lookupMediaUrl(mediaUrls: Map<string, string>, fromPath: string, target: string) {
    const candidates = [
        resolveZipPath(fromPath, target),
        resolveZipPath("xl/drawings/drawing1.xml", target.startsWith("../") ? target : `../media/${target.split("/").pop()}`),
        resolveZipPath("xl/cellimages.xml", target.includes("media/") ? target : `media/${target.split("/").pop()}`),
        target.replace(/^\/+/, ""),
        target.replace(/^\/+/, "").replace(/^xl\//, ""),
        `xl/media/${target.split("/").pop() || ""}`,
        target.split("/").pop() || "",
    ];
    for (const key of candidates) {
        if (key && mediaUrls.has(key)) return mediaUrls.get(key) || "";
    }
    const base = (target.split("/").pop() || "").toLowerCase();
    if (!base) return "";
    for (const [path, url] of mediaUrls) {
        if (path.toLowerCase().endsWith(`/${base}`) || path.toLowerCase() === base) return url;
    }
    return "";
}

function sheetHasImages(out: ExcelCellImageMap, sheetName: string) {
    const prefix = `${sheetName}!`;
    for (const key of out.keys()) {
        if (key.startsWith(prefix)) return true;
    }
    return false;
}

export function normalizeZipPaths(entries: Record<string, Uint8Array>) {
    const files = new Map<string, Uint8Array>();
    for (const [raw, data] of Object.entries(entries)) {
        files.set(raw.replace(/^\/+/, "").replace(/\\/g, "/"), data);
    }
    return files;
}

export function resolveSheetPaths(files: Map<string, Uint8Array>, sheetNames: string[]) {
    const map = new Map<string, string>();
    const workbook = files.get("xl/workbook.xml");
    const workbookRels = files.get("xl/_rels/workbook.xml.rels");
    if (!workbook || !workbookRels) {
        sheetNames.forEach((name, index) => {
            const guess = `xl/worksheets/sheet${index + 1}.xml`;
            if (files.has(guess)) map.set(name, guess);
        });
        return map;
    }

    const ridToTarget = parseRelationshipTargets(strFromU8(workbookRels));
    for (const tag of strFromU8(workbook).matchAll(/<sheet\b[^>]*>/gi)) {
        const name = attr(tag[0], "name");
        const rid = attr(tag[0], "r:id") || attr(tag[0], "r:Id");
        if (!name || !rid) continue;
        const target = ridToTarget.get(rid);
        if (!target) continue;
        map.set(name, resolveZipPath("xl/workbook.xml", target));
    }
    return map;
}

function applyCellImageDispIds(
    files: Map<string, Uint8Array>,
    sheetNames: string[],
    sheetPathByName: Map<string, string>,
    mediaUrls: Map<string, string>,
    out: ExcelCellImageMap,
) {
    const cellImages = files.get("xl/cellimages.xml");
    const cellImageRels = files.get("xl/_rels/cellimages.xml.rels");
    if (!cellImages || !cellImageRels) return;

    const ridToMedia = parseRelationshipTargets(strFromU8(cellImageRels));
    const idToUrl = new Map<string, string>();
    for (const block of strFromU8(cellImages).matchAll(/<etc:cellImage[\s\S]*?<\/etc:cellImage>|<xdr:pic[\s\S]*?<\/xdr:pic>/gi)) {
        const body = block[0];
        const name = attr(body.match(/<xdr:cNvPr\b[^>]*>/i)?.[0] || "", "name") || body.match(/\bname="(ID_[^"]+)"/i)?.[1] || "";
        const embed = body.match(/r:embed="([^"]+)"/i)?.[1];
        if (!name || !embed) continue;
        const target = ridToMedia.get(embed);
        if (!target) continue;
        const url = lookupMediaUrl(mediaUrls, "xl/cellimages.xml", target);
        if (url) idToUrl.set(name, url);
    }
    if (!idToUrl.size) return;

    for (const sheetName of sheetNames) {
        const sheetPath = sheetPathByName.get(sheetName);
        const sheetXml = sheetPath ? files.get(sheetPath) : undefined;
        if (!sheetXml) continue;
        for (const cell of strFromU8(sheetXml).matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"[^>]*>[\s\S]*?<\/c>/gi)) {
            const row = Number(cell[2]) - 1;
            const disp = cell[0].match(/DISPIMG\(\s*"([^"]+)"/i);
            if (!disp || row < 0) continue;
            const url = idToUrl.get(disp[1]);
            if (!url) continue;
            out.set(cellKey(sheetName, row, colLettersToIndex(cell[1])), url);
        }
    }
}

function parseDrawingAnchors(xml: string) {
    const anchors: Array<{ row: number; col: number; embedId: string }> = [];
    for (const block of xml.matchAll(/<xdr:(twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/xdr:\1>/gi)) {
        const body = block[0];
        const from = body.match(/<xdr:from>[\s\S]*?<\/xdr:from>/i)?.[0] || "";
        const col = Number(from.match(/<xdr:col>(\d+)<\/xdr:col>/i)?.[1]);
        const row = Number(from.match(/<xdr:row>(\d+)<\/xdr:row>/i)?.[1]);
        const embedId = body.match(/r:embed="([^"]+)"/i)?.[1];
        if (!embedId || !Number.isFinite(row) || !Number.isFinite(col)) continue;
        anchors.push({ row, col, embedId });
    }
    return anchors;
}

function parseRelationshipTargets(xml: string) {
    const map = new Map<string, string>();
    for (const match of xml.matchAll(/<Relationship\b[^>]*>/gi)) {
        const id = attr(match[0], "Id");
        const target = attr(match[0], "Target");
        if (id && target) map.set(id, target.replace(/\\/g, "/"));
    }
    return map;
}

function findDrawingTargets(xml: string) {
    const targets: string[] = [];
    for (const target of parseRelationshipTargets(xml).values()) {
        if (/drawing\d+\.xml/i.test(target)) targets.push(target);
    }
    return targets;
}

function relsPathFor(path: string) {
    const parts = path.split("/");
    const file = parts.pop() || "";
    return `${parts.join("/")}/_rels/${file}.rels`;
}

function resolveZipPath(fromPath: string, target: string) {
    const normalized = target.replace(/\\/g, "/");
    if (normalized.startsWith("/")) return normalized.replace(/^\/+/, "");
    if (normalized.startsWith("xl/")) return normalized;
    if (normalized.startsWith(".")) {
        const base = fromPath.split("/").slice(0, -1);
        for (const part of normalized.split("/")) {
            if (!part || part === ".") continue;
            if (part === "..") base.pop();
            else base.push(part);
        }
        return base.join("/");
    }
    const base = fromPath.includes("/") ? fromPath.split("/").slice(0, -1) : [];
    return [...base, ...normalized.split("/")].filter(Boolean).join("/");
}

function attr(tag: string, name: string) {
    return tag.match(new RegExp(`${name}="([^"]*)"`, "i"))?.[1] || "";
}

export function colLettersToIndex(letters: string) {
    let n = 0;
    for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return Math.max(0, n - 1);
}

function bytesToDataUrl(path: string, data: Uint8Array) {
    const mime = sniffMime(path, data);
    if (!mime) return "";
    let binary = "";
    const chunk = 0x2000;
    for (let i = 0; i < data.length; i += chunk) {
        binary += String.fromCharCode.apply(null, data.subarray(i, i + chunk) as unknown as number[]);
    }
    return `data:${mime};base64,${btoa(binary)}`;
}

function sniffMime(path: string, data: Uint8Array) {
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
    if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
    if (data.length >= 6 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return "image/gif";
    if (data.length >= 12 && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) {
        return "image/webp";
    }
    const lower = path.toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".webp")) return "image/webp";
    return "";
}
