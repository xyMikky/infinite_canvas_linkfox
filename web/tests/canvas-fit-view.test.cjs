const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

async function fit(nodes, area) {
    const source = fs.readFileSync(path.join(__dirname, '../src/lib/canvas/canvas-viewport-coords.ts'), 'utf8');
    const mod = new vm.SourceTextModule(stripTypeScriptTypes(source));
    await mod.link(() => { throw new Error('Unexpected dependency'); });
    await mod.evaluate();
    return mod.namespace.fitNodesViewport(nodes, area);
}
const node = (x, y, width, height) => ({ position: { x, y }, width, height });
const area = { x: 328, y: 72, width: 904, height: 552 };

function assertContained(nodes, viewport, bounds) {
    for (const item of nodes) {
        const left = viewport.x + item.position.x * viewport.k;
        const top = viewport.y + item.position.y * viewport.k;
        assert.ok(left >= bounds.x - 1e-7 && top >= bounds.y - 1e-7);
        assert.ok(left + item.width * viewport.k <= bounds.x + bounds.width + 1e-7);
        assert.ok(top + item.height * viewport.k <= bounds.y + bounds.height + 1e-7);
    }
}

test('all node edges fit the available area, including negative coordinates and distant nodes', async () => {
    const nodes = [node(-4200, -3100, 900, 600), node(6400, 4700, 1800, 1400)];
    const viewport = await fit(nodes, area);
    assertContained(nodes, viewport, area);
    assert.ok(viewport.k > 0 && viewport.k <= 1);
});

test('very wide and very tall canvases can fit below five percent', async () => {
    for (const nodes of [[node(0, 0, 100000, 500)], [node(0, -50000, 500, 200000)]]) {
        const viewport = await fit(nodes, area);
        assert.ok(viewport.k < 0.05);
        assertContained(nodes, viewport, area);
    }
});

test('a small node is centered without enlarging beyond its natural scale', async () => {
    const nodes = [node(-300, 900, 340, 240)];
    const viewport = await fit(nodes, area);
    assert.equal(viewport.k, 1);
    assert.equal(viewport.x + (-300 + 170), area.x + area.width / 2);
    assert.equal(viewport.y + (900 + 120), area.y + area.height / 2);
    assertContained(nodes, viewport, area);
});

test('empty canvas centers the origin at 100 percent', async () => {
    assert.deepEqual(await fit([], area), { x: area.x + area.width / 2, y: area.y + area.height / 2, k: 1 });
});
