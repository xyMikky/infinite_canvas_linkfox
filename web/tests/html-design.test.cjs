const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

async function load(name = 'html-design-motion') {
    const source = fs.readFileSync(path.join(__dirname, '../src/lib/canvas', name + '.ts'), 'utf8');
    const mod = new vm.SourceTextModule(stripTypeScriptTypes(source), { context: vm.createContext({}) });
    await mod.link(() => { throw new Error('Unexpected dependency'); });
    await mod.evaluate();
    return mod.namespace;
}

function animation(playState = 'running', playbackRate = 1) {
    return {
        playState, playbackRate, currentTime: 42,
        pause() { this.playState = 'paused'; },
        play() { this.playState = 'running'; },
        updatePlaybackRate(value) { this.playbackRate = value; },
    };
}

test('editing pause resumes running animations but preserves a page-owned pause', async () => {
    const { createHtmlMotionController } = await load();
    const running = animation('running', 2), paused = animation('paused', 0.5);
    const control = createHtmlMotionController(() => [running, paused]);
    control.update(true, 0.5);
    assert.equal(running.playState, 'paused');
    assert.equal(running.playbackRate, 1);
    control.update(false, 1);
    assert.equal(running.playState, 'running');
    assert.equal(running.playbackRate, 2);
    assert.equal(paused.playState, 'paused');
    assert.equal(paused.playbackRate, 0.5);
});

test('new animations inherit controls, completed animations do not restart on resume', async () => {
    const { createHtmlMotionController } = await load();
    const items = [animation('finished')];
    const control = createHtmlMotionController(() => items);
    control.update(true, 0.25);
    items.push(animation());
    control.update(true, 0.25);
    assert.equal(items[1].playState, 'paused');
    assert.equal(items[1].playbackRate, 0.25);
    control.update(false, 1);
    assert.equal(items[0].playState, 'finished');
    assert.equal(items[1].playState, 'running');
});

test('disposing the preview restores only the motion overrides it owns', async () => {
    const { createHtmlMotionController } = await load();
    const items = [animation(), animation('paused'), animation('idle')];
    const control = createHtmlMotionController(() => items);
    control.update(true, 0.25);
    control.dispose();
    assert.deepEqual(items.map(x => x.playState), ['running', 'paused', 'idle']);
    assert.deepEqual(items.map(x => x.playbackRate), [1, 1, 1]);
});

test('a playback rate changed by the page is not overwritten when leaving the board', async () => {
    const { createHtmlMotionController } = await load();
    const item = animation('running', 2);
    const control = createHtmlMotionController(() => [item]);
    control.update(false, 0.5);
    item.updatePlaybackRate(3);
    control.dispose();
    assert.equal(item.playbackRate, 3);
});

test('text writes affect only the matching HTML revision and preserve unrelated node data', async () => {
    const { replaceHtmlDesignContent } = await load('html-design-source');
    const target = { id: 'ui', type: 'smart-preview', position: { x: 10, y: 20 }, metadata: { smartPreviewKind: 'html', smartPreviewPath: 'index.html', content: 'before', htmlDesignViewport: 'mobile' } };
    const other = { ...target, id: 'other' };
    const nodes = [target, other];
    const patch = { nodeId: 'ui', path: 'index.html', expected: 'before', content: 'after' };
    const result = replaceHtmlDesignContent(nodes, patch);
    assert.equal(result[0].metadata.content, 'after');
    assert.equal(result[0].metadata.htmlDesignViewport, 'mobile');
    assert.equal(result[0].position, target.position);
    assert.equal(result[1], other);
    assert.equal(target.metadata.content, 'before');
    assert.equal(replaceHtmlDesignContent(result, patch), result, 'stale source must not write twice');
    assert.equal(replaceHtmlDesignContent(nodes, { ...patch, path: 'another.html' }), nodes);
    assert.equal(replaceHtmlDesignContent(nodes, { ...patch, nodeId: 'deleted' }), nodes);
});

test('an explicit disabled UI board stays disabled when the document has text markers', async () => {
    const { isHtmlDesignBoard } = await load('html-design-source');
    assert.equal(isHtmlDesignBoard({ content: '<h1 data-ui-text="title">Title</h1>' }), true);
    assert.equal(isHtmlDesignBoard({ htmlDesignBoard: false, content: '<h1 data-ui-text="title">Title</h1>' }), false);
    assert.equal(isHtmlDesignBoard({ content: '<h1>Ordinary report</h1>' }), false);
});

test('editing is bound to the original iframe document, including same-document anchors', async () => {
    const { isHtmlDesignDocument } = await load('html-design-source');
    const src = 'blob:http://localhost:5173/original-page';
    const frame = { contentWindow: { location: { href: src + '#features' } } };
    assert.equal(isHtmlDesignDocument(frame, src), true);
    frame.contentWindow.location.href = 'blob:http://localhost:5173/linked-page';
    assert.equal(isHtmlDesignDocument(frame, src), false);
    assert.equal(isHtmlDesignDocument(frame, ''), false);
    Object.defineProperty(frame.contentWindow, 'location', { get() { throw new Error('Cross-origin access'); } });
    assert.equal(isHtmlDesignDocument(frame, src), false);
});

test('text undo distinguishes source formatting newlines from explicit visual breaks', async () => {
    const { splitHtmlText, readHtmlTextBreaks, reverseHtmlTextEdit } = await load('html-design-source');
    assert.deepEqual(Array.from(splitHtmlText('Hello\nworld', [])), ['Hello\nworld']);
    assert.deepEqual(Array.from(splitHtmlText('Hello\nworld')), ['Hello', 'world']);
    const text = '你好\nworld\n<script>';
    const breaks = readHtmlTextBreaks({ childNodes: [
        { nodeType: 3, nodeName: '#text', textContent: '你好\nworld' },
        { nodeType: 1, nodeName: 'BR', textContent: '' },
        { nodeType: 3, nodeName: '#text', textContent: '<script>' },
    ] });
    assert.deepEqual(Array.from(splitHtmlText(text, breaks)), ['你好\nworld', '<script>']);
    const undo = reverseHtmlTextEdit({ id: 'intro', before: 'Hello\nworld', after: 'New\nline', beforeBreaks: [], afterBreaks: [3] });
    assert.deepEqual(Array.from(splitHtmlText(undo.after, undo.afterBreaks)), ['Hello\nworld']);
    const redo = reverseHtmlTextEdit(undo);
    assert.deepEqual(Array.from(splitHtmlText(redo.after, redo.afterBreaks)), ['New', 'line']);
});

test('pending browser rate changes do not compound the selected speed', async () => {
    const { createHtmlMotionController } = await load();
    const item = animation();
    let resolve, requested;
    item.updatePlaybackRate = value => {
        requested = value;
        item.ready = new Promise(done => { resolve = done; });
    };
    const control = createHtmlMotionController(() => [item]);
    control.update(false, 0.5);
    item.playbackRate = requested;
    resolve();
    await Promise.resolve();
    control.update(false, 0.25);
    control.update(false, 0.25);
    assert.equal(requested, 0.25);
    control.dispose();
    assert.equal(requested, 1, 'pending overrides also restore the original speed');
});
