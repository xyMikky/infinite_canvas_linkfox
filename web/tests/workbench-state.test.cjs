const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

async function load() {
    const source = fs.readFileSync(path.join(__dirname, '../src/lib/canvas/workbench-state.ts'), 'utf8');
    const mod = new vm.SourceTextModule(stripTypeScriptTypes(source));
    await mod.link(() => { throw new Error('Unexpected runtime dependency'); });
    await mod.evaluate();
    return mod.namespace;
}
const empty = { textCount: 0, imageCount: 0, videoCount: 0, audioCount: 0 };

test('folder text counts as a usable prompt input, matching generation context', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/lib/canvas/canvas-generation-helpers.ts'), 'utf8');
    const mod = new vm.SourceTextModule(stripTypeScriptTypes(source));
    const names = ['defaultConfig', 'resolveModelForCapability', 'default', 'imageReferenceLabel', 'resolveImageUrl', 'uploadImage', 'resolveMediaUrl', 'LOCAL_EDIT_DEFAULT_RESOLUTION', 'imageMetadata', 'referenceUrl', 'CanvasNodeType'];
    await mod.link(() => new vm.SyntheticModule(names, function () { for (const name of names) this.setExport(name, {}); }));
    await mod.evaluate();
    const summary = mod.namespace.getInputSummary([
        { type: 'folder', text: '项目说明' }, { type: 'folder', text: '   ' }, { type: 'skill' }, { type: 'image' },
    ]);
    assert.deepEqual(summary, { ...empty, textCount: 1, imageCount: 1 });
    const { workbenchInputIssue } = await load();
    assert.equal(workbenchInputIssue('text', { prompt: true }, summary, false), null);
});

test('text and audio require prompt input; connected images do not substitute for it', async () => {
    const { workbenchInputIssue } = await load();
    assert.equal(workbenchInputIssue('text', { prompt: true }, { ...empty, imageCount: 1 }, false).kind, 'prompt');
    assert.equal(workbenchInputIssue('audio', { prompt: true }, empty, true), null);
    assert.equal(workbenchInputIssue('text', { prompt: true }, { ...empty, textCount: 1 }, false), null);
});
test('model-specific required image, video and audio slots must be connected', async () => {
    const { workbenchInputIssue } = await load();
    assert.deepEqual(workbenchInputIssue('model', { prompt: false, images: { min: 2, max: 4 } }, { ...empty, imageCount: 1 }, false), { kind: 'image', missing: 1 });
    assert.equal(workbenchInputIssue('model', { prompt: false, images: { min: 2, max: 4 } }, { ...empty, imageCount: 2 }, false), null);
    assert.equal(workbenchInputIssue('image', { images: { min: 1, max: 10 } }, empty, true).kind, 'image');
    assert.equal(workbenchInputIssue('video', { videos: { min: 1, max: 3 } }, empty, true).kind, 'video');
    assert.equal(workbenchInputIssue('audio', { audios: { min: 1, max: 1 } }, empty, true).kind, 'audio');
});
test('optional references allow text-only or supported media-only creation', async () => {
    const { workbenchInputIssue } = await load();
    const spec = { prompt: true, images: { min: 0, max: 10 } };
    assert.equal(workbenchInputIssue('image', spec, empty, true), null);
    assert.equal(workbenchInputIssue('image', spec, { ...empty, imageCount: 1 }, false), null);
    assert.equal(workbenchInputIssue('image', spec, { ...empty, audioCount: 1 }, false).kind, 'input');
    assert.equal(workbenchInputIssue('model', { prompt: true }, empty, false).kind, 'prompt');
});
test('concurrent round count is scoped to the workbench and deduplicates child requests', async () => {
    const { countWorkbenchRuns } = await load();
    const first = new AbortController(), second = new AbortController(), canceled = new AbortController();
    canceled.abort();
    const request = controller => ({ projectId: 'project', runningNodeId: 'workbench', controller });
    const requests = [request(first), request(first), request(second), request(canceled), { ...request(first), projectId: 'other' }, { ...request(first), runningNodeId: 'another' }];
    assert.equal(countWorkbenchRuns(requests, 'project', 'workbench'), 2);
    first.abort();
    assert.equal(countWorkbenchRuns(requests, 'project', 'workbench'), 1);
    assert.equal(countWorkbenchRuns(requests, 'missing', 'workbench'), 0);
});
