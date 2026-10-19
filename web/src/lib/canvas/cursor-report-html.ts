/** Cursor Canvas 风格单文件 HTML 报告：暗色 token + 扁平组件类名（无渐变/阴影） */

export const CURSOR_REPORT_CSS = `
:root {
  --cr-fg: #E4E4E4EB;
  --cr-fg-2: #E4E4E48D;
  --cr-fg-3: #E4E4E45E;
  --cr-bg: #181818;
  --cr-chrome: #141414;
  --cr-fill: #E4E4E411;
  --cr-fill-2: #E4E4E41E;
  --cr-stroke: #E4E4E433;
  --cr-stroke-2: #E4E4E41F;
  --cr-accent: #E8C030E0;
  --cr-link: #87c3ff;
  --cr-success: #3FA266;
  --cr-danger: #FC6B83;
  --cr-warning: #F1B467;
  --cr-info: #7BAFE9;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: var(--cr-bg);
  color: var(--cr-fg);
  font: 14px/20px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.cr-page { max-width: 920px; margin: 0 auto; padding: 28px 24px 48px; }
.cr-stack { display: flex; flex-direction: column; gap: 16px; }
.cr-stack-sm { gap: 8px; }
.cr-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.cr-grid { display: grid; gap: 16px; }
.cr-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.cr-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.cr-grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.cr-h1 { margin: 0; font-size: 24px; line-height: 30px; font-weight: 590; color: #fff; }
.cr-h1.accent { color: var(--cr-accent); }
.cr-h2 { margin: 0; font-size: 18px; line-height: 24px; font-weight: 590; color: var(--cr-accent); }
.cr-h3 { margin: 0; font-size: 16px; line-height: 22px; font-weight: 590; color: var(--cr-fg); }
.cr-meta { font-size: 12px; line-height: 16px; color: var(--cr-fg-2); }
.cr-text { margin: 0; color: var(--cr-fg); }
.cr-text-2 { margin: 0; color: var(--cr-fg-2); }
.cr-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 6px;
  background: var(--cr-fill-2); border: 1px solid var(--cr-stroke-2);
  font-size: 12px; line-height: 16px; color: var(--cr-fg);
}
.cr-pill.active { background: var(--cr-fill); border-color: var(--cr-stroke); }
.cr-stat { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.cr-stat-value { font-size: 28px; line-height: 34px; font-weight: 590; color: #fff; letter-spacing: -0.02em; }
.cr-stat-value.success { color: var(--cr-success); }
.cr-stat-value.danger { color: var(--cr-danger); }
.cr-stat-value.warning { color: var(--cr-warning); }
.cr-stat-value.info { color: var(--cr-info); }
.cr-stat-value.accent { color: var(--cr-accent); }
.cr-stat-label { font-size: 12px; line-height: 16px; color: var(--cr-fg-2); }
.cr-callout {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 12px 14px; border-radius: 8px;
  border: 1px solid var(--cr-stroke); background: var(--cr-fill);
}
.cr-callout-title { font-weight: 590; margin: 0 0 4px; color: var(--cr-fg); }
.cr-callout-body { margin: 0; color: var(--cr-fg-2); font-size: 13px; line-height: 18px; }
.cr-card {
  border: 1px solid var(--cr-stroke); border-radius: 8px; background: transparent; overflow: hidden;
}
.cr-card-header {
  display: flex; align-items: center; justify-content: space-between;
  min-height: 28px; padding: 6px 12px;
  font-size: 12px; color: var(--cr-fg-2); border-bottom: 1px solid var(--cr-stroke-2);
}
.cr-card-body { padding: 12px; }
.cr-divider { height: 1px; background: var(--cr-stroke-2); border: 0; margin: 4px 0; }
.cr-hbar { display: flex; flex-direction: column; gap: 8px; }
.cr-hbar-row { display: grid; grid-template-columns: minmax(72px, 140px) 1fr auto; gap: 10px; align-items: center; }
.cr-hbar-label { font-size: 12px; color: var(--cr-fg-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cr-hbar-track { height: 8px; border-radius: 4px; background: var(--cr-fill-2); overflow: hidden; }
.cr-hbar-fill { height: 100%; border-radius: 4px; background: var(--cr-accent); }
.cr-hbar-value { font-size: 12px; color: var(--cr-fg); font-variant-numeric: tabular-nums; }
.cr-usage {
  display: flex; height: 10px; border-radius: 5px; overflow: hidden; background: var(--cr-fill-2);
}
.cr-usage > span { display: block; height: 100%; }
`.trim();

export const CURSOR_REPORT_STYLE_GUIDE = [
    "画布报告 HTML 约定（与智能预览内容区风格一致）：",
    "1. 单文件：内联 CSS（可调用画布提供的 .cr-* 类名语义）+ 可选内联 SVG/少量 JS；禁止外链字体包以外的构建依赖。",
    "2. 暗色底 #181818，主文字近白，次要文字半透明灰，强调色用金色/琥珀（KPI 大数字、H2），禁止渐变、box-shadow、emoji 装饰。",
    "3. 结构建议：.cr-page > .cr-stack；标题 .cr-h1；元信息 .cr-meta；指标条 .cr-pill；KPI 用 .cr-grid-4 + .cr-stat；结论用 .cr-callout；横向条用 .cr-hbar；占比用 SVG 环图。",
    "4. 完整页面可用 wrap：外层 html/body 已设暗色时可只写 .cr-page 内部；否则自行包含 <!DOCTYPE html> 与上述 token。",
].join("\n");

/** 将内容区 HTML 包成可离线打开的完整 Cursor 风格报告页 */
export function wrapCursorReportHtml(bodyInnerHtml: string, title = "Report") {
    const inner = bodyInnerHtml.trim();
    const looksFull = /^<!DOCTYPE/i.test(inner) || /<html[\s>]/i.test(inner);
    if (looksFull) return inner;
    const body = /class=["'][^"']*\bcr-page\b/.test(inner) ? inner : `<div class="cr-page"><div class="cr-stack">${inner}</div></div>`;
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${CURSOR_REPORT_CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}

function escapeHtml(value: string) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
