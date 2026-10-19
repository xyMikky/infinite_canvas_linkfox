import { loadFolderPreviewSources, releaseFolderPreviewSourcesMemory, type FolderPreviewSource } from "@/lib/canvas/folder-preview-cache";
import { toArrayBuffer } from "@/lib/canvas/folder-preview-sw";

export type HtmlProjectMaterializeResult = {
    iframeSrc?: string;
    srcDoc?: string;
    revoke: () => void;
    assetCount: number;
};

function normalizePath(path: string) {
    return path.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/{2,}/g, "/");
}

function dirname(path: string) {
    const normalized = normalizePath(path);
    const idx = normalized.lastIndexOf("/");
    return idx === -1 ? "" : normalized.slice(0, idx);
}

/** 相对路径或站点根绝对路径 /foo → 文件夹内路径 */
function resolveProjectPath(fromFile: string, relative: string): string | null {
    const raw = relative.trim();
    if (!raw || /^(https?:|data:|blob:|javascript:|mailto:|#)/i.test(raw)) return null;
    const cleaned = raw.split("?")[0].split("#")[0];
    if (!cleaned) return null;
    // 站点根绝对路径：在本地 HTTP 预览里等价于项目根文件
    if (cleaned.startsWith("/") && !cleaned.startsWith("//")) return normalizePath(cleaned.slice(1));

    const base = dirname(fromFile);
    const joined = base ? `${base}/${cleaned}` : cleaned;
    const stack: string[] = [];
    for (const part of normalizePath(joined).split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") stack.pop();
        else stack.push(part);
    }
    return stack.join("/");
}

function mimeForName(name: string) {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    const map: Record<string, string> = {
        html: "text/html;charset=utf-8",
        htm: "text/html;charset=utf-8",
        css: "text/css;charset=utf-8",
        js: "text/javascript;charset=utf-8",
        mjs: "text/javascript;charset=utf-8",
        cjs: "text/javascript;charset=utf-8",
        json: "application/json;charset=utf-8",
        svg: "image/svg+xml",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        ico: "image/x-icon",
        woff: "font/woff",
        woff2: "font/woff2",
        ttf: "font/ttf",
        otf: "font/otf",
        md: "text/markdown;charset=utf-8",
        markdown: "text/markdown;charset=utf-8",
        txt: "text/plain;charset=utf-8",
        csv: "text/csv;charset=utf-8",
        tsv: "text/tab-separated-values;charset=utf-8",
        xml: "application/xml;charset=utf-8",
        wasm: "application/wasm",
        map: "application/json;charset=utf-8",
        geojson: "application/geo+json;charset=utf-8",
    };
    return map[ext] || "application/octet-stream";
}

function decodeText(data: ArrayBuffer | ArrayBufferView | number[]) {
    return new TextDecoder("utf-8", { fatal: false }).decode(toArrayBuffer(data));
}

function isJsAsset(name: string) {
    return /\.(js|mjs|cjs)$/i.test(name);
}

function isCssAsset(name: string) {
    return /\.css$/i.test(name);
}

function rewriteCssUrls(css: string, fromPath: string, urlOf: (path: string) => string | undefined) {
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, _q, raw: string) => {
        const resolved = resolveProjectPath(fromPath, raw);
        const mapped = resolved ? urlOf(resolved) : undefined;
        return mapped ? `url("${mapped}")` : full;
    });
}

function rewriteJsModules(code: string, fromPath: string, urlOf: (path: string) => string | undefined) {
    let next = code.replace(
        /((?:import|export)\s*[^'";]*?from\s+|import\s*\(\s*)(['"])(\.[^'"]+|\/[^'"]+)\2/g,
        (full, prefix: string, quote: string, rel: string) => {
            const resolved = resolveProjectPath(fromPath, rel);
            const mapped = resolved ? urlOf(resolved) : undefined;
            return mapped ? `${prefix}${quote}${mapped}${quote}` : full;
        },
    );
    // new URL('./x', import.meta.url) / new URL('/x', import.meta.url)
    next = next.replace(/new\s+URL\s*\(\s*(['"])(\.[^'"]+|\/[^'"]+)\1\s*,\s*import\.meta\.url\s*\)/g, (full, quote: string, rel: string) => {
        const resolved = resolveProjectPath(fromPath, rel);
        const mapped = resolved ? urlOf(resolved) : undefined;
        return mapped ? `new URL(${quote}${mapped}${quote})` : full;
    });
    return next;
}

function rewriteHtmlAssets(html: string, fromPath: string, urlOf: (path: string) => string | undefined) {
    const replaceAttr = (source: string, attr: string) =>
        source.replace(new RegExp(`(\\s${attr}\\s*=\\s*)(['"])([^'"]+)\\2`, "gi"), (full, prefix: string, quote: string, raw: string) => {
            if (attr.toLowerCase() === "href" && raw.trim().startsWith("#")) return full;
            const resolved = resolveProjectPath(fromPath, raw);
            const mapped = resolved ? urlOf(resolved) : undefined;
            return mapped ? `${prefix}${quote}${mapped}${quote}` : full;
        });

    let next = html;
    for (const attr of ["src", "href", "poster", "data-src"]) next = replaceAttr(next, attr);
    next = next.replace(/(\ssrcset\s*=\s*)(['"])([^'"]+)\2/gi, (full, prefix: string, quote: string, value: string) => {
        const rewritten = value
            .split(",")
            .map((part) => {
                const trimmed = part.trim();
                if (!trimmed) return trimmed;
                const [url, ...rest] = trimmed.split(/\s+/);
                const resolved = resolveProjectPath(fromPath, url);
                const mapped = resolved ? urlOf(resolved) : undefined;
                return mapped ? [mapped, ...rest].join(" ") : trimmed;
            })
            .join(", ");
        return `${prefix}${quote}${rewritten}${quote}`;
    });
    next = next.replace(/(\sstyle\s*=\s*)(['"])([\s\S]*?)\2/gi, (full, prefix: string, quote: string, style: string) => {
        return `${prefix}${quote}${rewriteCssUrls(style, fromPath, urlOf)}${quote}`;
    });
    return next;
}

function buildBootstrap(fileMap: Record<string, string>, baseFile: string) {
    return `<script>(function(){
var FILES=${JSON.stringify(fileMap)};
var BASE=${JSON.stringify(normalizePath(baseFile))};
function dir(p){var i=p.lastIndexOf("/");return i<0?"":p.slice(0,i)}
function norm(p){return String(p||"").replace(/\\\\/g,"/").replace(/^\\.\\//,"").replace(/\\/{2,}/g,"/")}
function resolve(input){
  if(input==null) return null;
  var raw=String(input);
  if(/^(https?:|data:|blob:|javascript:|mailto:|#)/i.test(raw)) return null;
  // 已是映射后的 blob
  for(var k in FILES){ if(FILES[k]===raw) return raw; }
  var clean=raw.split("?")[0].split("#")[0];
  if(!clean) return null;
  var path;
  if(clean.charAt(0)==="/"&&clean.charAt(1)!=="/") path=norm(clean.slice(1));
  else {
    var base=dir(BASE);
    var joined=base?base+"/"+clean:clean;
    var stack=[];
    joined=norm(joined).split("/");
    for(var i=0;i<joined.length;i++){
      var part=joined[i];
      if(!part||part===".") continue;
      if(part==="..") stack.pop();
      else stack.push(part);
    }
    path=stack.join("/");
  }
  return FILES[path]||FILES[decodeURIComponent(path)]||null;
}
var ofetch=window.fetch.bind(window);
window.fetch=function(input,init){
  var raw=typeof input==="string"?input:(input&&input.url);
  var mapped=resolve(raw);
  if(mapped) return ofetch(mapped,init);
  return ofetch(input,init);
};
var XO=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(method,url){
  var mapped=typeof url==="string"?resolve(url):null;
  var args=Array.prototype.slice.call(arguments);
  if(mapped) args[1]=mapped;
  return XO.apply(this,args);
};
var OrigURL=window.URL;
function PatchedURL(url,base){
  if(typeof url==="string"){
    var mapped=resolve(url);
    if(mapped) return new OrigURL(mapped);
    if(base!=null && /^(blob:|about:)/i.test(String(base))){
      mapped=resolve(url);
      if(mapped) return new OrigURL(mapped);
    }
  }
  return new OrigURL(url,base);
}
PatchedURL.prototype=OrigURL.prototype;
PatchedURL.createObjectURL=OrigURL.createObjectURL.bind(OrigURL);
PatchedURL.revokeObjectURL=OrigURL.revokeObjectURL.bind(OrigURL);
if(OrigURL.canParse) PatchedURL.canParse=OrigURL.canParse.bind(OrigURL);
window.URL=PatchedURL;
})();</script>`;
}

function indexSources(sources: FolderPreviewSource[]) {
    const byPath = new Map<string, FolderPreviewSource>();
    for (const source of sources) {
        byPath.set(normalizePath(source.path), {
            ...source,
            data: toArrayBuffer(source.data),
            path: normalizePath(source.path),
        });
    }
    return byPath;
}

/**
 * 用 blob URL 映射整个文件夹，改写 HTML/CSS/JS 中的相对路径与根绝对路径（/vendor/...）。
 * 不依赖 Service Worker，避免拦截失败导致只有壳没有数据。
 * 不另建长时 blob 缓存：卸载时立即 revoke，避免与文件夹源缓存叠成双份占用。
 */
export async function materializeHtmlProject(folderNodeId: string, htmlPath: string, fallbackHtml = "", htmlOverride?: string): Promise<HtmlProjectMaterializeResult> {
    const sources = await loadFolderPreviewSources(folderNodeId);
    const byPath = indexSources(sources);
    // 物化只用本地拷贝；立刻释放源文件内存，避免与后续 blob 叠成双份
    releaseFolderPreviewSourcesMemory(folderNodeId);
    const normalizedHtmlPath = normalizePath(htmlPath);
    const htmlSource = byPath.get(normalizedHtmlPath);
    const htmlText = htmlOverride ?? (htmlSource ? decodeText(htmlSource.data) : fallbackHtml);

    if (!htmlText) {
        return { assetCount: 0, revoke: () => undefined };
    }

    if (!htmlSource) {
        byPath.set(normalizedHtmlPath, {
            path: normalizedHtmlPath,
            name: normalizedHtmlPath.split("/").pop() || "index.html",
            data: toArrayBuffer(new TextEncoder().encode(htmlText)),
        });
    }

    const createdUrls: string[] = [];
    const pathToUrl = new Map<string, string>();
    const remember = (path: string, url: string) => {
        pathToUrl.set(normalizePath(path), url);
        createdUrls.push(url);
    };
    const urlOf = (path: string) => pathToUrl.get(normalizePath(path));

    // 1) 非 JS/CSS
    for (const [path, source] of byPath) {
        if (isJsAsset(source.name) || isCssAsset(source.name)) continue;
        if (path === normalizedHtmlPath) continue;
        remember(path, URL.createObjectURL(new Blob([source.data], { type: mimeForName(source.name) })));
    }

    // 2) CSS
    for (const [path, source] of byPath) {
        if (!isCssAsset(source.name)) continue;
        const rewritten = rewriteCssUrls(decodeText(source.data), path, urlOf);
        remember(path, URL.createObjectURL(new Blob([rewritten], { type: mimeForName(source.name) })));
    }

    // 3) JS 两遍，保证互相 import
    const jsPaths: string[] = [];
    for (const [path, source] of byPath) {
        if (!isJsAsset(source.name)) continue;
        jsPaths.push(path);
        remember(path, URL.createObjectURL(new Blob([source.data], { type: mimeForName(source.name) })));
    }
    for (const path of jsPaths) {
        const source = byPath.get(path);
        if (!source) continue;
        const rewritten = rewriteJsModules(decodeText(source.data), path, urlOf);
        const url = URL.createObjectURL(new Blob([rewritten], { type: mimeForName(source.name) }));
        const previous = pathToUrl.get(path);
        if (previous) URL.revokeObjectURL(previous);
        pathToUrl.set(path, url);
        createdUrls.push(url);
    }

    const fileMap = Object.fromEntries(pathToUrl.entries());
    const bootstrap = buildBootstrap(fileMap, normalizedHtmlPath || "index.html");
    let doc = rewriteHtmlAssets(htmlText, normalizedHtmlPath || "index.html", urlOf);

    if (/<head[^>]*>/i.test(doc)) doc = doc.replace(/<head[^>]*>/i, (m) => `${m}${bootstrap}`);
    else if (/<html[^>]*>/i.test(doc)) doc = doc.replace(/<html[^>]*>/i, (m) => `${m}<head>${bootstrap}</head>`);
    else doc = `<!doctype html><html><head>${bootstrap}</head><body>${doc}</body></html>`;

    const pageUrl = URL.createObjectURL(new Blob([doc], { type: "text/html;charset=utf-8" }));
    createdUrls.push(pageUrl);

    return {
        iframeSrc: pageUrl,
        assetCount: pathToUrl.size,
        revoke: () => {
            for (const url of createdUrls) URL.revokeObjectURL(url);
        },
    };
}
