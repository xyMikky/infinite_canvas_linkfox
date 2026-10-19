const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

function fixture() {
    const layout = fs.readFileSync(path.join(__dirname, '../src/lib/canvas/canvas-batch-layout.ts'), 'utf8').replace(/export /g, '');
    const project = fs.readFileSync(path.join(__dirname, '../src/pages/canvas/project.tsx'), 'utf8');
    const callbacks = project.slice(project.indexOf('    const claimResultColumnAnchor ='), project.indexOf('    const stopGenerationByRunningId ='));
    return vm.runInNewContext(stripTypeScriptTypes(`
        ${layout}
        const resultStackRightRef = { current: new Map() };
        const useCallback = (fn) => fn;
        ${callbacks}
        ({ claim: claimResultColumnAnchor, settle: ensureResultStackCursor,
           place: getVerticalResultPlacement, cursor: resultStackRightRef.current });
    `));
}

test('first result column keeps 96px from the workbench', () => {
    const f = fixture();
    const anchor = f.claim('source', 360, 640);
    assert.equal(f.place(0, 1, 400, 200, anchor).x, 456);
});

test('appended columns keep 48px from the actual previous right edge', () => {
    const f = fixture();
    const anchor = f.claim('source', 360, 640, [1096, 1096, 1096]);
    assert.equal(f.place(0, 3, 400, 200, anchor).x, 1144);
});

test('concurrent reservations remain separate before nodes have rendered', () => {
    const f = fixture();
    const first = f.place(0, 1, 400, 200, f.claim('source', 360, 640));
    const second = f.place(0, 1, 400, 200, f.claim('source', 360, 640));
    assert.equal(second.x - first.x - 640, 48);
});

test('settling a smaller placeholder releases its unused reserved width', () => {
    const f = fixture();
    const first = f.place(0, 1, 240, 200, f.claim('source', 360, 340));
    f.settle('source', first.x + 200, first.x + 340);
    const second = f.place(0, 1, 240, 200, f.claim('source', 360, 200, [first.x + 200]));
    assert.equal(second.x - first.x - 200, 48);
});

test('settling an earlier column does not release a later reservation', () => {
    const f = fixture();
    const first = f.place(0, 1, 240, 200, f.claim('source', 360, 340));
    const second = f.place(0, 1, 240, 200, f.claim('source', 360, 340));
    f.settle('source', first.x + 200, first.x + 340);
    assert.equal(f.cursor.get('source'), second.x + 340);
});

test('far stale cursors do not keep opening empty columns', () => {
    const f = fixture();
    f.cursor.set('source', 10000);
    assert.equal(f.place(0, 1, 240, 200, f.claim('source', 360, 640, [1096])).x, 1144);
});

test('rows within a result column retain their 18px vertical gap', () => {
    const f = fixture();
    const first = f.place(0, 3, 400, 200, 360);
    const second = f.place(1, 3, 400, 200, 360);
    assert.equal(second.y - first.y - 400, 18);
});
