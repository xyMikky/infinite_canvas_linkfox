const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

async function fixture(hot = true) {
    const hotData = {};
    const projects = [{ id: 'a', nodes: [], connections: [] }, { id: 'b', nodes: [], connections: [] }];
    const updates = [];
    const context = vm.createContext({ AbortController });
    const store = { getState: () => ({ projects, updateProject(id, patch) {
        Object.assign(projects.find(project => project.id === id), patch);
        updates.push(id);
    } }) };
    const source = fs.readFileSync(path.join(__dirname, '../src/lib/canvas/canvas-generation-runtime.ts'), 'utf8');
    const reload = async () => {
        const mod = new vm.SourceTextModule(stripTypeScriptTypes(source), {
            context, initializeImportMeta(meta) { if (hot) meta.hot = { data: hotData }; },
        });
        await mod.link(() => new vm.SyntheticModule(['useCanvasStore'], function () { this.setExport('useCanvasStore', store); }, { context }));
        await mod.evaluate();
        return mod.namespace;
    };
    const view = (projectId) => {
        const state = { nodes: [], connections: [], running: null };
        return {
            projectId, state,
            setNodes: updater => { state.nodes = typeof updater === 'function' ? updater(state.nodes) : updater; },
            setConnections: updater => { state.connections = typeof updater === 'function' ? updater(state.connections) : updater; },
            setRunningNodeId: updater => { state.running = typeof updater === 'function' ? updater(state.running) : updater; },
        };
    };
    return { reload, view, projects, updates };
}

test('hot replacement keeps the mounted canvas active so an imported preview appears immediately', async () => {
    const f = await fixture();
    const before = await f.reload();
    const view = f.view('a');
    before.bindCanvasGenerationView(view);
    const after = await f.reload();
    const scope = after.createCanvasGenerationScope('a', [], []);
    assert.equal(scope.isActive(), true);
    scope.setNodes(nodes => [...nodes, { id: 'imported-canvas-tsx', type: 'smart-preview' }]);
    assert.equal(view.state.nodes[0].id, 'imported-canvas-tsx');
    assert.equal(f.updates.length, 0, '当前页面应直接显示，不能仅写入磁盘等待刷新');
});

test('an import started before hot replacement writes to the newly bound view', async () => {
    const f = await fixture();
    const oldRuntime = await f.reload();
    const oldView = f.view('a');
    const dispose = oldRuntime.bindCanvasGenerationView(oldView);
    const scope = oldRuntime.createCanvasGenerationScope('a', [], []);
    const nextRuntime = await f.reload();
    const nextView = f.view('a');
    nextRuntime.bindCanvasGenerationView(nextView);
    dispose();
    scope.setNodes(nodes => [...nodes, { id: 'late-import' }]);
    assert.equal(nextView.state.nodes[0]?.id, 'late-import');
    assert.equal(oldView.state.nodes.length, 0);
});

test('switching projects still sends late imports to the original project only', async () => {
    const f = await fixture();
    const oldRuntime = await f.reload();
    oldRuntime.bindCanvasGenerationView(f.view('a'));
    const scope = oldRuntime.createCanvasGenerationScope('a', [], []);
    const nextRuntime = await f.reload();
    const current = f.view('b');
    nextRuntime.bindCanvasGenerationView(current);
    assert.equal(scope.isActive(), false);
    scope.setNodes(nodes => [...nodes, { id: 'original-import' }]);
    assert.equal(f.projects[0].nodes[0].id, 'original-import');
    assert.equal(current.state.nodes.length, 0);
});

test('hot replacement retains running requests and final cleanup detaches the current view', async () => {
    const f = await fixture();
    const before = await f.reload();
    const dispose = before.bindCanvasGenerationView(f.view('a'));
    const controller = before.startCanvasGenerationRequest('a', 'result', 'origin');
    const after = await f.reload();
    assert.equal(after.hasLiveCanvasGeneration('a'), true);
    after.stopCanvasGenerationByRunningId('origin');
    assert.equal(controller.signal.aborted, true);
    assert.equal(before.hasLiveCanvasGeneration('a'), false);
    dispose();
    assert.equal(after.createCanvasGenerationScope('a', [], []).isActive(), false);
});

test('without HMR, imports update the active canvas and persist after it is closed', async () => {
    const f = await fixture(false);
    const runtime = await f.reload();
    const view = f.view('a');
    const dispose = runtime.bindCanvasGenerationView(view);
    const scope = runtime.createCanvasGenerationScope('a', [], []);
    scope.setNodes(nodes => [...nodes, { id: 'visible-import' }]);
    assert.equal(view.state.nodes[0].id, 'visible-import');
    scope.setConnections([{ id: 'connection' }]);
    assert.equal(view.state.connections[0].id, 'connection');
    dispose();
    scope.setNodes(nodes => [...nodes, { id: 'background-import' }]);
    assert.equal(f.projects[0].nodes[0].id, 'background-import');
    assert.equal(view.state.nodes.length, 1);
});

test('preview import success messages resolve in both supported locales', async () => {
    for (const locale of ['zh-CN', 'en-US']) {
        const file = path.join(__dirname, `../src/i18n/locales/${locale}.ts`);
        const mod = new vm.SourceTextModule(stripTypeScriptTypes(fs.readFileSync(file, 'utf8')));
        await mod.link(() => { throw new Error('Unexpected locale import'); });
        await mod.evaluate();
        const messages = mod.namespace.default.canvas.projectPage;
        assert.match(messages.vectorPreviewDropped, /\{\{count\}\}/);
        assert.ok(messages.vectorPreviewTruncated.length > 0);
    }
});
