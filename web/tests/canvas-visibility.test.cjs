const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

async function loadVisibility() {
    const context = vm.createContext({ Set });
    const source = fs.readFileSync(path.join(__dirname, '../src/lib/canvas/canvas-node-visibility.ts'), 'utf8');
    const module = new vm.SourceTextModule(stripTypeScriptTypes(source), { context });
    await module.link(() => new vm.SyntheticModule(['getNodeDefinition'], function () {
        this.setExport('getNodeDefinition', type => ({ keepContentMounted: () => type === 'preview' }));
    }, { context }));
    await module.evaluate();
    return module.namespace.resolveCanvasNodeVisibility;
}
const empty = () => ({ visibleIds: new Set(), selectedIds: new Set(), hiddenIds: new Set(), retainedIds: new Set(), panelId: null });

test('unvisited previews outside the viewport are not mounted on large canvases', async () => {
    const resolve = await loadVisibility();
    for (const count of [200, 500, 1000]) {
        const nodes = Array.from({ length: count }, (_, index) => ({ id: String(index), type: 'preview' }));
        const plan = resolve(nodes, { ...empty(), visibleIds: new Set(['0', '1']) });
        assert.equal(plan.renderNodes.length, 2);
        assert.equal(plan.retainedIds.size, 2);
        assert.equal(plan.activeIds.size, 2);
    }
});

test('visited previews sleep outside the viewport and wake without changing their identity', async () => {
    const resolve = await loadVisibility();
    const nodes = [{ id: 'preview', type: 'preview' }, { id: 'text', type: 'text' }];
    const first = resolve(nodes, { ...empty(), visibleIds: new Set(['preview', 'text']) });
    const sleeping = resolve(nodes, { ...empty(), retainedIds: first.retainedIds });
    assert.equal(sleeping.renderNodes.length, 1);
    assert.equal(sleeping.renderNodes[0], nodes[0]);
    assert.equal(sleeping.activeIds.size, 0);
    const awake = resolve(nodes, { ...empty(), retainedIds: sleeping.retainedIds, visibleIds: new Set(['preview']) });
    assert.equal(awake.renderNodes[0], nodes[0]);
    assert.equal(awake.activeIds.has('preview'), true);
});

test('selected nodes and an open panel stay active, while collapsed or removed nodes are released', async () => {
    const resolve = await loadVisibility();
    const nodes = ['selected', 'panel', 'collapsed'].map(id => ({ id, type: 'preview' }));
    const plan = resolve(nodes, { ...empty(), selectedIds: new Set(['selected', 'collapsed']), panelId: 'panel', hiddenIds: new Set(['collapsed']), retainedIds: new Set(['collapsed', 'removed']) });
    assert.deepEqual([...plan.activeIds].sort(), ['panel', 'selected']);
    assert.equal(plan.retainedIds.has('removed'), false);
    assert.equal(plan.retainedIds.has('collapsed'), false);
});
