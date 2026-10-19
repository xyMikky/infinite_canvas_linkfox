const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

async function load(name, globals = {}) {
    const source = fs.readFileSync(path.join(__dirname, '../src/lib/canvas', name + '.ts'), 'utf8');
    const mod = new vm.SourceTextModule(stripTypeScriptTypes(source), { context: vm.createContext(globals) });
    await mod.link(() => { throw new Error('Unexpected runtime dependency'); });
    await mod.evaluate();
    return mod.namespace;
}

test('default selection and payload preserve an exact square on portrait and landscape images', async () => {
    const selection = await load('local-edit-selection');
    for (const image of [{ width: 1688, height: 938 }, { width: 1536, height: 2752 }]) {
        const crop = selection.defaultCropForRatio(image);
        const payload = selection.createLocalEditPayload('painted', crop, image, '1:1');
        assert.equal(payload.selection.w, payload.selection.h);
        assert.equal(payload.forceRatio, '1:1');
        assert.equal(payload.paintedDataUrl, 'painted');
        assert.equal(Math.round(payload.selectionNorm.x * image.width), payload.selection.x);
        assert.equal(Math.round(payload.selectionNorm.height * image.height), payload.selection.h);
    }
});

test('all preset resize handles keep the selection inside the original image', async () => {
    const selection = await load('local-edit-selection');
    const image = { width: 1688, height: 938 };
    for (const preset of selection.LOCAL_EDIT_RATIO_PRESETS) {
        const crop = selection.defaultCropForRatio(image, preset);
        const ratio = selection.resolveRatio(preset, image);
        for (const handle of ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw']) {
            for (const delta of [-2, 0.1, 2]) {
                const next = selection.resizeCrop(crop, delta, -delta, handle, ratio, image);
                assert.ok(next.x >= 0 && next.y >= 0, preset + handle);
                assert.ok(next.x + next.width <= 1.000001 && next.y + next.height <= 1.000001, preset + handle);
                assert.ok(next.width > 0 && next.height > 0, preset + handle);
                if (ratio) assert.ok(Math.abs(next.width * image.width / (next.height * image.height) - ratio) < 0.00001, preset + handle);
            }
        }
    }
});

test('auto and original keep their existing generation ratio semantics', async () => {
    const selection = await load('local-edit-selection');
    assert.equal(selection.forceRatioFromPreset('auto'), 'Auto');
    assert.equal(selection.forceRatioFromPreset('original'), 'Auto');
    assert.equal(selection.forceRatioFromPreset('9:16'), '9:16');
});

async function exportFixture() {
    const commands = [];
    const context = {
        drawImage: image => commands.push(['draw', image.id]),
        save: () => commands.push(['save']), restore: () => commands.push(['restore']),
        beginPath: () => commands.push(['begin']), rect: (...rect) => commands.push(['rect', ...rect]),
        clip: () => commands.push(['clip']),
    };
    const output = { getContext: () => context, toDataURL: () => 'snapshot' };
    const api = await load('image-paint-export', { document: { createElement: () => output } });
    return { api, commands, output, source: { id: 'original', width: 100, height: 80 }, paint: { id: 'paint' } };
}

test('local edits clip only the paint overlay, preserving the full original image', async () => {
    const { api, commands, output, source, paint } = await exportFixture();
    const result = api.composePaintedCanvas(source, paint, { x: 0.2, y: 0.25, width: 0.4, height: 0.5 });
    assert.equal(result, 'snapshot');
    assert.equal(output.width, 100);
    assert.equal(output.height, 80);
    assert.deepEqual(commands, [['draw', 'original'], ['save'], ['begin'], ['rect', 20, 20, 40, 40], ['clip'], ['draw', 'paint'], ['restore']]);
});

test('ordinary annotations continue exporting the entire paint layer without a selection', async () => {
    const { api, commands, source, paint } = await exportFixture();
    assert.equal(api.composePaintedCanvas(source, paint), 'snapshot');
    assert.deepEqual(commands.filter(item => item[0] === 'draw'), [['draw', 'original'], ['draw', 'paint']]);
    assert.ok(!commands.some(item => item[0] === 'clip'));
});
