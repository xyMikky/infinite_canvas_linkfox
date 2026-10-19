const DIAGRAM_LINE =
    /(?:->|→|—{2,}|[-─]{3,}\s*\||\|\s*->|└>?\s*|├|│)/;
const TABLE_SEPARATOR = /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;
const SMASHED_MARKDOWN = /###|```|---|\|---\||BODY\s*&\s*SCENE|CAMERA\s*FOCUS|\bIDENTITY\b/;

/** 含中文且无树形箱线：按正文处理，禁止进等宽横滑块 */
function isChineseProseLine(line: string) {
    const trimmed = line.trim();
    if (!/[\u4e00-\u9fff]/.test(trimmed)) return false;
    if (/[└├│]/.test(trimmed)) return false;
    if (/^\s{2,}\S/.test(line) && /\|/.test(trimmed) && !/[。！？；]/.test(trimmed)) return false;
    return true;
}

function isMarkdownTableSeparator(line: string) {
    return TABLE_SEPARATOR.test(line.trim());
}

function isDiagramLine(line: string) {
    if (isMarkdownTableSeparator(line)) return false;
    if (!DIAGRAM_LINE.test(line)) return false;
    if (isChineseProseLine(line)) return false;
    return true;
}

function isDiagramContinuation(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (isDiagramLine(line)) return true;
    if (/^\s+\|/.test(line)) return true;
    // 含中文的普通说明不要并进 ASCII 流程图，否则会变成等宽不换行块并出现横向滚动条
    if (/[\u4e00-\u9fff]/.test(trimmed)) return false;
    if (trimmed.length <= 36 && !/[。！？.!?]/.test(trimmed) && !/^#{1,6}\s/.test(trimmed) && !/^[-*+]\s/.test(trimmed)) return true;
    return false;
}

const PROSE_TEXT_LANG = /^(?:text|plaintext|txt|plain)?$/i;

/** 仅真正的 ASCII/箱线图才包 ```ascii（等宽不换行）；```text 里的中文提示词必须换行 */
function shouldFenceAsAsciiDiagram(block: string[]) {
    const content = block.filter((line) => line.trim());
    if (!content.length || !content.some(isDiagramLine)) return false;
    if (content.some(isChineseProseLine)) return false;
    if (content.some((line) => /[└├│]/.test(line))) return true;
    if (content.some((line) => /\|/.test(line))) return true;
    return content.length >= 2;
}

/** 把 ASCII/箭头树状流程段落包进 ```ascii，避免 Streamdown 按普通段落折行。 */
export function wrapAsciiDiagramBlocks(markdown: string) {
    const lines = markdown.split("\n");
    const out: string[] = [];
    let i = 0;
    let inFence = false;
    while (i < lines.length) {
        if (/^```/.test(lines[i])) {
            inFence = !inFence;
            out.push(lines[i]);
            i += 1;
            continue;
        }
        if (inFence || !isDiagramLine(lines[i])) {
            out.push(lines[i]);
            i += 1;
            continue;
        }
        const block: string[] = [];
        block.push(lines[i]);
        i += 1;
        while (i < lines.length && isDiagramContinuation(lines[i])) {
            block.push(lines[i]);
            i += 1;
        }
        if (shouldFenceAsAsciiDiagram(block)) {
            out.push("```ascii", ...block, "```");
        } else {
            out.push(...block);
        }
    }
    return out.join("\n");
}

/** Cursor 常用 ```text 包整段提示词；有中文就改成可换行围栏，避免左右滑看不到。 */
export function rewriteProseTextFences(markdown: string) {
    const lines = markdown.split("\n");
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
        const open = lines[i].match(/^```([\w-]*)\s*$/);
        if (!open) {
            out.push(lines[i]);
            i += 1;
            continue;
        }
        const lang = open[1] || "";
        const body: string[] = [];
        i += 1;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) {
            body.push(lines[i]);
            i += 1;
        }
        const nextLang = PROSE_TEXT_LANG.test(lang)
            ? shouldFenceAsAsciiDiagram(body) ? "ascii" : body.some(isChineseProseLine) ? "prompt" : lang
            : lang;
        out.push(nextLang ? `\`\`\`${nextLang}` : "```");
        out.push(...body);
        if (i < lines.length && /^```\s*$/.test(lines[i])) {
            out.push(lines[i]);
            i += 1;
        }
    }
    return out.join("\n");
}

export function isAsciiDiagramText(text: string) {
    const lines = text.split("\n").filter((line) => line.trim());
    if (!lines.length) return false;
    return shouldFenceAsAsciiDiagram(lines);
}

/** 流式拼接丢了换行时，把挤成一行的标题/围栏/分段拆开，否则 Streamdown 会整段当正文。 */
export function repairSmashedAgentMarkdown(markdown: string) {
    const text = markdown.replace(/\r\n/g, "\n");
    if ((text.match(/\n/g) || []).length >= 4 || !SMASHED_MARKDOWN.test(text)) return text;
    let out = text
        .replace(/```(\w+)/g, "\n```$1\n")
        .replace(/([^\n])(#{1,6}(?=[^\s#]|\s|$))/g, "$1\n$2")
        .replace(/([^\n|])(---+)(?!\|)/g, "$1\n$2\n")
        .replace(/([^\n])([A-Z][A-Z0-9]{2,}(?:\s*[&/]\s*[A-Z][A-Z0-9]{2,}|\s+[A-Z][A-Z0-9]{2,})+)/g, "$1\n$2\n")
        .replace(/([^\n])(\|[^\n]{2,}\|)/g, "$1\n$2")
        .replace(/([^\n])(\*\*[^*]{1,20}\*\*)/g, "$1\n$2\n")
        .replace(/^(#{1,6})([^\s#])/gm, "$1 $2")
        .replace(/\n{3,}/g, "\n\n");
    if (((out.match(/```/g) || []).length) % 2 === 1) {
        const lastOpen = out.lastIndexOf("```");
        const rel = out.slice(lastOpen + 3).search(/\n(?:\*\*|#{1,6}\s|\|[\u4e00-\u9fffA-Z])/);
        out = rel >= 0 ? `${out.slice(0, lastOpen + 3 + rel)}\n\`\`\`${out.slice(lastOpen + 3 + rel)}` : `${out}\n\`\`\``;
    }
    return out.replace(/\n{3,}/g, "\n\n");
}

export function prepareAgentMarkdown(markdown: string) {
    return wrapAsciiDiagramBlocks(rewriteProseTextFences(repairSmashedAgentMarkdown(markdown)));
}
