const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

async function fixture() {
    const context = vm.createContext({});
    const load = name => new vm.SourceTextModule(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '../src/lib/agent', name), 'utf8')), { context });
    const document = load('agent-plan-document.ts');
    await document.link(() => { throw new Error('Unexpected dependency'); });
    await document.evaluate();
    const ops = [];
    const importer = load('import-plan-to-canvas.ts');
    await importer.link(name => {
        if (name.endsWith('/agent-plan-document')) return document;
        const values = name.endsWith('/use-agent-store')
            ? { useAgentStore: { getState: () => ({ canvasContext: { snapshot: { viewport: { x: 0, y: 0, k: 1 } }, applyOps: next => ops.push(...next) } }) } }
            : { buildAddSmartPreviewNodeOp: input => input };
        return new vm.SyntheticModule(Object.keys(values), function () {
            for (const [key, value] of Object.entries(values)) this.setExport(key, value);
        }, { context });
    });
    await importer.evaluate();
    return { ...document.namespace, ...importer.namespace, ops };
}

const markdown = '# 改进预览\n\n## 实施步骤\n\n1. 保留 **重点** 与 [说明](https://example.com)\n   - 嵌套步骤\n2. 验收\n\n- [ ] 完成预览\n\n| 项目 | 结果 |\n| --- | --- |\n| Markdown | 原样保留 |\n\n> 不要改写内容\n\n```tsx\nconst value = "示例";\n```';

test('plan preview preserves Markdown structure instead of compiling a different document', async () => {
    const f = await fixture();
    const doc = f.buildAgentPlanDocument({ threadId: 't', turnId: '1', markdown, messages: [] });
    assert.equal(f.planDocumentPreviewSource(doc), markdown);
});

test('unrelated Canvas TSX in chat cannot replace the plan title or preview', async () => {
    const f = await fixture();
    const doc = f.buildAgentPlanDocument({ threadId: 't', turnId: '1', markdown, messages: [
        { role: 'assistant', text: 'import { H1 } from "infinite-canvas";\nexport default function Report() { return <H1>别的报告</H1>; }' },
    ] });
    assert.equal(doc.title, '改进预览');
    assert.equal(f.planDocumentPreviewSource(doc), markdown);
});

test('confirmed answers still have a readable Markdown preview before the plan is written', async () => {
    const f = await fixture();
    const doc = f.buildAgentPlanDocument({ threadId: 't', turnId: '1', messages: [
        { role: 'user', text: '', detail: { kind: 'userInput', entries: [{ question: '使用什么格式？', answer: 'Markdown\n保留列表' }] } },
    ] });
    const preview = f.planDocumentPreviewSource(doc);
    assert.match(preview, /^# 规划书\n/);
    assert.match(preview, /使用什么格式？/);
    assert.match(preview, /Markdown\n保留列表/);
    assert.doesNotMatch(preview, /export default|infinite-canvas/);
});

test('import uses the same Markdown in an md node and ignores empty plans', async () => {
    const f = await fixture();
    const doc = f.buildAgentPlanDocument({ threadId: 't', turnId: '1', markdown, messages: [] });
    assert.equal(f.importPlanDocumentToCanvas(doc), 'ok');
    assert.equal(f.ops[0].metadata.smartPreviewKind, 'markdown');
    assert.equal(f.ops[0].metadata.smartPreviewPath, '改进预览.md');
    assert.equal(f.ops[0].metadata.content, markdown);
    assert.equal(f.importPlanDocumentToCanvas({ ...doc, markdown: '', answers: [] }), 'empty');
    assert.equal(f.ops.length, 1);
});
