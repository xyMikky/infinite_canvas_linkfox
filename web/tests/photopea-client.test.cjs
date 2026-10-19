const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

async function fixture(autoReady = true, timers = { setTimeout, clearTimeout }) {
    const context = vm.createContext({ ...timers, ArrayBuffer, Error });
    const mod = new vm.SourceTextModule(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '../src/lib/canvas/photopea-client.ts'), 'utf8')), { context });
    await mod.link(() => { throw new Error('Unexpected dependency'); });
    await mod.evaluate();
    const sent = [];
    const frame = { postMessage: (script, origin) => sent.push({ script, origin }) };
    const client = mod.namespace.createPhotopeaClient(() => frame);
    const receive = data => client.receive({ source: frame, origin: 'https://www.photopea.com', data });
    const complete = () => {
        const script = sent.at(-1).script;
        const marker = script.match(/app\.echoToOE\(("[^"]+:ok")\)/)[1];
        receive(JSON.parse(marker));
        receive('done');
    };
    if (autoReady) {
        receive('done');
        await client.ready;
    }
    return { ...mod.namespace, client, frame, sent, receive, complete };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('commands wait for their own acknowledgement and execute in order', async () => {
    const f = await fixture();
    try {
        const a = f.client.run('first();');
        const b = f.client.run('second();');
        await tick();
        assert.equal(f.sent.length, 1);
        f.receive('done');
        f.client.receive({ source: {}, origin: 'https://www.photopea.com', data: 'done' });
        await tick();
        assert.equal(f.sent.length, 1, 'Unrelated done cannot release the next layer');
        f.complete();
        await a;
        await tick();
        assert.equal(f.sent.length, 2);
        assert.equal(f.sent[0].origin, 'https://www.photopea.com');
        f.complete();
        await b;
    } finally { f.client.dispose(); }
});

test('only the current frame can supply exported image bytes', async () => {
    const f = await fixture();
    try {
        const saved = f.client.run('app.activeDocument.saveToOE("png");');
        await tick();
        const bytes = new ArrayBuffer(4);
        f.client.receive({ source: {}, origin: 'https://www.photopea.com', data: new ArrayBuffer(9) });
        f.client.receive({ source: f.frame, origin: 'https://other.example', data: new ArrayBuffer(9) });
        f.receive(bytes);
        f.complete();
        assert.equal(await saved, bytes);
    } finally { f.client.dispose(); }
});

test('closing an editor rejects active and queued commands without sending more', async () => {
    const f = await fixture();
    const a = f.client.run('first();');
    const b = f.client.run('second();');
    const results = Promise.allSettled([a, b]);
    await tick();
    f.client.dispose();
    assert.deepEqual((await results).map(result => result.status), ['rejected', 'rejected']);
    assert.equal(f.sent.length, 1);
});

// Simulate the documented protocol: script completion can precede asynchronous file opening.
async function editorFixture() {
    const f = await fixture();
    const app = { documents: [], echoToOE: data => f.receive(data) };
    const sandbox = vm.createContext({ app }); // Photopea scripts have no browser document/window.
    const incoming = [];
    f.frame.postMessage = (message, origin) => {
        f.sent.push({ script: message, origin });
        if (message instanceof ArrayBuffer) incoming.push(message);
        else vm.runInContext(message, sandbox);
        f.receive('done');
    };
    return { ...f, app, incoming, constants: sandbox };
}

test('initial image uses binary transport and waits until a document exists', async () => {
    const f = await editorFixture();
    try {
        const bytes = new ArrayBuffer(4);
        let opened = false;
        const loading = f.client.openImage(bytes).then(() => { opened = true; });
        await tick();
        assert.equal(f.incoming[0], bytes);
        assert.equal(opened, false, 'An early done must not reveal an empty editor');
        f.app.documents.push({ source: 'local,1,file.psd', layers: [] });
        f.app.activeDocument = f.app.documents[0];
        f.receive('done');
        await loading;
        assert.equal(opened, true);
        assert.ok(f.sent.every(({ script }) => typeof script !== 'string' || !/document\.|window\.|MutationObserver/.test(script)));
    } finally { f.client.dispose(); }
});

test('layer import sends binary and duplicates into the original document', async () => {
    const f = await editorFixture();
    try {
        const doc = { source: 'local,1,original.png', layers: [] };
        f.app.documents.push(doc);
        f.app.activeDocument = doc;
        const bytes = new ArrayBuffer(4);
        const loading = f.client.openLayer(bytes, '新的图层');
        await tick();
        assert.equal(f.incoming[0], bytes);
        assert.ok(f.sent.every(({ script }) => typeof script !== 'string' || !script.includes('app.open(')));
        const imported = { source: 'local,2,input.png', activeLayer: {
            name: 'Background',
            duplicate(target) { assert.equal(target, doc); doc.layers.push({ name: this.name }); },
        }, close() { f.app.documents.splice(f.app.documents.indexOf(imported), 1); } };
        f.app.documents.push(imported);
        f.app.activeDocument = imported;
        f.constants.ElementPlacement = { PLACEATBEGINNING: 0 };
        f.constants.SaveOptions = { DONOTSAVECHANGES: 0 };
        await loading;
        assert.equal(doc.layers[0].name, '新的图层');
        assert.equal(f.app.activeDocument, doc);
        assert.equal(f.app.documents.length, 1);
    } finally { f.client.dispose(); }
});

test('import without a document reports a useful error without running app.open', async () => {
    const f = await editorFixture();
    try {
        f.app.open = () => { throw new Error('Must not open without a target'); };
        await assert.rejects(f.client.openLayer(new ArrayBuffer(4), 'New'), /no-document/);
        assert.equal(f.incoming.length, 0);
    } finally { f.client.dispose(); }
});

test('closing during frame boot cancels readiness and sends no image', async () => {
    const f = await fixture(false);
    const ready = assert.rejects(f.client.ready, /photopea-closed/);
    const loading = assert.rejects(f.client.openImage(new ArrayBuffer(4)), /photopea-closed/);
    f.client.dispose();
    f.receive('done');
    await Promise.all([ready, loading]);
    assert.equal(f.sent.length, 0);
});

test('boot and command timeouts report distinct causes and stop queued messages', async () => {
    const callbacks = [];
    const timers = { setTimeout: callback => callbacks.push(callback), clearTimeout: () => {} };
    const boot = await fixture(false, timers);
    const failedBoot = assert.rejects(boot.client.ready, /photopea-load-timeout/);
    callbacks.at(-1)();
    await failedBoot;
    boot.receive('done');
    assert.equal(boot.sent.length, 0);

    const editor = await fixture(true, timers);
    const failedCommand = assert.rejects(editor.client.run('unresponsive();'), /photopea-command-timeout/);
    const queued = assert.rejects(editor.client.run('next();'), /photopea-command-timeout/);
    await tick();
    callbacks.at(-1)();
    await Promise.all([failedCommand, queued]);
    assert.equal(editor.sent.length, 1);
});

test('closing during asynchronous image decoding prevents further probes or layer edits', async () => {
    const f = await editorFixture();
    const loading = assert.rejects(f.client.openImage(new ArrayBuffer(4)), /photopea-closed/);
    await tick();
    const sentBeforeClose = f.sent.length;
    f.client.dispose();
    f.app.documents.push({ source: 'local,1,file.psd' });
    f.receive('done');
    await loading;
    assert.equal(f.sent.length, sentBeforeClose);
});

test('a script error is reported and does not block the next layer', async () => {
    const f = await fixture();
    try {
        const failed = f.client.run('app.open("missing");');
        const failure = assert.rejects(failed, /no-document/);
        const next = f.client.run('next();');
        await tick();
        const marker = JSON.parse(f.sent[0].script.match(/app\.echoToOE\(("[^"]+:ok")\)/)[1]);
        f.receive(marker.replace(/:ok$/, ':error:no-document'));
        f.receive('done');
        await failure;
        await tick();
        f.complete();
        await next;
    } finally { f.client.dispose(); }
});

test('sidebar imports are consumed only by the registered editor and stale cleanup cannot detach a new one', async () => {
    const context = vm.createContext({});
    const mod = new vm.SourceTextModule(stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '../src/stores/canvas/use-photopea-layer-store.ts'), 'utf8')), { context });
    const { create } = require('../node_modules/zustand');
    await mod.link(() => new vm.SyntheticModule(['create'], function () { this.setExport('create', create); }, { context }));
    await mod.evaluate();
    const store = mod.namespace.usePhotopeaLayerStore;
    const image = { url: 'blob:old', storageKey: 'image:original', title: '原图' };
    assert.equal(store.getState().tryImport(image), false);
    const received = [];
    const oldCleanup = store.getState().register(() => { throw new Error('Stale editor'); });
    const cleanup = store.getState().register(pick => received.push(pick));
    oldCleanup();
    assert.equal(store.getState().tryImport(image), true);
    assert.equal(received[0], image);
    cleanup();
    assert.equal(store.getState().tryImport(image), false);
});

test('script exceptions reject immediately while the connection remains usable', async () => {
    const f = await editorFixture();
    f.app.documents.push({});
    try {
        await assert.rejects(f.client.run('throw new Error("unsupported");'), /script-failed/);
        await f.client.run('app.echoToOE("still alive");');
    } finally { f.client.dispose(); }
});
