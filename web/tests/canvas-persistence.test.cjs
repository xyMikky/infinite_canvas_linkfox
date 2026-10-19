const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');
const { create } = require('../node_modules/zustand');
const KEY = 'infinite-canvas:canvas_store';
const raw = title => JSON.stringify({ state: { projects: [{ id: 'old', title, nodes: [{ id: 'node' }], connections: [] }] }, version: 0 });
function database() {
    const values = new Map();
    const writes = [];
    let lock = Promise.resolve();
    let transaction = Promise.resolve();
    return {
        values, writes, failRead: false, failWrite: false,
        locks: { request(_name, action) { const next = lock.then(action); lock = next.catch(() => {}); return next; } },
        updateRecord(key, update) {
            const next = transaction.then(async () => {
                const current = await this.getItem(key);
                const value = update(current);
                if (value !== current) await this.setItem(key, value);
                return value;
            });
            transaction = next.catch(() => {});
            return next;
        },
        async getItem(key) { if (this.failRead) throw new Error('read failed'); return structuredClone(values.get(key) ?? null); },
        async setItem(key, value) { if (this.failWrite) throw new Error('disk full'); writes.push(key); values.set(key, structuredClone(value)); return value; },
        async removeItem(key) { values.delete(key); },
        async keys() { return [...values.keys()]; },
        async iterate(callback) { for (const [key, value] of values) callback(structuredClone(value), key); },
    };
}
async function client(db, legacy = new Map(), loadStore = false) {
    const events = new Map();
    const document = { visibilityState: 'visible', addEventListener(name, handler) { events.set(name, handler); } };
    const context = vm.createContext({
        console: { ...console, error() {} }, crypto: webcrypto, TextEncoder, structuredClone, setTimeout, clearTimeout,
        navigator: { locks: db.locks },
        window: { localStorage: { getItem: key => legacy.get(key) ?? null }, addEventListener(name, handler) { events.set(name, handler); } },
        document,
    });
    const external = {
        localforage: { default: { INDEXEDDB: 'idb', createInstance: () => db } },
        '@/services/canvas-indexeddb': { canvasDatabase: db, updateCanvasRecord: db.updateRecord.bind(db) },
        '@/constant/env': { APP_VERSION: 'test' },
        '@/services/dev-local-store': { DEV_CANVAS_STORE_KEY: KEY, ensureDevLocalStore: async () => false, getDevLocalKv() {}, migrateCanvasStoreToDevLocalIfNeeded() {}, setDevLocalKv() {} },
        zustand: { create },
        nanoid: { nanoid: () => webcrypto.randomUUID() }, '@/i18n': { default: { t: value => value } },
        '@/lib/utils': { randomId: () => webcrypto.randomUUID() },
        '@/services/image-storage': { getImageBlobFromIndexedDb() {} }, '@/services/file-storage': { getMediaBlobFromIndexedDb() {} },
    };
    const modules = new Map();
    async function load(name) {
        if (modules.has(name)) return modules.get(name);
        if (external[name]) {
            const exports = external[name];
            const module = new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
            modules.set(name, module);
            return module;
        }
        const file = name === 'zustand/middleware' ? 'node_modules/zustand/esm/middleware.mjs' : name === '@/services/canvas-persistence' ? 'src/services/canvas-persistence.ts' : 'src/stores/canvas/use-canvas-store.ts';
        const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
        const code = file.endsWith('.ts') ? stripTypeScriptTypes(source) : source;
        const module = new vm.SourceTextModule(code, { context, identifier: name });
        modules.set(name, module);
        await module.link(load);
        return module;
    }
    const module = await load(loadStore ? '@/stores/canvas/use-canvas-store' : '@/services/canvas-persistence');
    await module.evaluate();
    await new Promise(resolve => setImmediate(resolve));
    return { ...module.namespace, events, document };
}

test('legacy localStorage is copied without deleting the old source', async () => {
    const db = database(); const legacy = new Map([[KEY, raw('legacy')]]);
    const storage = await client(db, legacy);
    assert.equal(await storage.readCanvasIndexedDb(), raw('legacy'));
    assert.equal(db.values.get(KEY), legacy.get(KEY));
    assert.ok([...db.values.keys()].some(key => key.includes('legacy-localstorage')));
});
test('existing IndexedDB wins and a different legacy copy remains recoverable', async () => {
    const db = database(); db.values.set(KEY, raw('current'));
    const storage = await client(db, new Map([[KEY, raw('older')]]));
    assert.equal(await storage.readCanvasIndexedDb(), raw('current'));
    assert.equal((await storage.readCanvasBackup('legacy-localstorage'))[0].title, 'older');
});
test('read failure and corrupted JSON never mark hydration complete or write an empty state', async () => {
    for (const corrupt of [false, true]) {
        const db = database(); db.values.set(KEY, corrupt ? '{damaged' : raw('safe')); db.failRead = !corrupt;
        const { useCanvasStore: store } = await client(db, new Map(), true);
        assert.equal(store.getState().hydrated, false);
        assert.equal(store.getState().hydrationError, true);
        store.setState({ hydrated: true }); // Even a mistaken caller cannot bypass the storage readiness guard.
        store.setState({ projects: [] });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(db.writes.includes(KEY), false);
        assert.equal(db.values.get(KEY), corrupt ? '{damaged' : raw('safe'));
    }
});
test('stale browser context cannot overwrite a newer context', async () => {
    const db = database(); db.values.set(KEY, raw('start'));
    const a = await client(db); const b = await client(db);
    await a.readCanvasIndexedDb(); await b.readCanvasIndexedDb();
    await b.writeCanvasIndexedDb(raw('newer'));
    await assert.rejects(a.writeCanvasIndexedDb(raw('stale')));
    assert.equal(db.values.get(KEY), raw('newer'));
});
test('missing main record with backups blocks empty initialization and can restore a copy', async () => {
    const db = database(); db.values.set(KEY, raw('safe'));
    const storage = await client(db);
    await storage.readCanvasIndexedDb(); db.values.delete(KEY);
    await assert.rejects(storage.readCanvasIndexedDb());
    assert.equal(db.values.has(KEY), false);
    await storage.restoreCanvasBackup('upgrade-test');
    const restored = JSON.parse(db.values.get(KEY)).state.projects;
    assert.equal(restored.length, 1); assert.notEqual(restored[0].id, 'old');
});
test('a leftover legacy copy cannot silently roll back a missing newer main record', async () => {
    const db = database(); db.values.set(KEY, raw('newer'));
    const storage = await client(db, new Map([[KEY, raw('legacy')]]));
    await storage.readCanvasIndexedDb(); db.values.delete(KEY);
    await assert.rejects(storage.readCanvasIndexedDb());
    assert.equal(db.values.has(KEY), false);
});
test('save failure is visible, keeps memory and retries without clearing old data', async () => {
    const db = database(); db.values.set(KEY, raw('safe'));
    const { useCanvasStore: store } = await client(db, new Map(), true);
    assert.equal(store.getState().hydrated, true);
    db.failWrite = true; store.getState().createProject('new');
    await store.getState().retrySave();
    assert.equal(store.getState().projects.length, 2);
    assert.equal(store.getState().savePending, true);
    assert.ok(store.getState().storageError);
    assert.equal(db.values.get(KEY), raw('safe'));
    db.failWrite = false; await store.getState().retrySave();
    assert.equal(JSON.parse(db.values.get(KEY)).state.projects.length, 2);
    assert.equal(store.getState().savePending, false);
    assert.equal(store.getState().storageError, '');
});
test('accidental empty state cannot erase projects, while explicit delete can', async () => {
    const db = database(); db.values.set(KEY, raw('safe'));
    const { useCanvasStore: store } = await client(db, new Map(), true);
    store.setState({ projects: [] });
    await store.getState().retrySave();
    assert.equal(db.values.get(KEY), raw('safe'));
    const fresh = await client(db, new Map(), true);
    fresh.useCanvasStore.getState().deleteProjects(['old']);
    await fresh.useCanvasStore.getState().retrySave();
    assert.equal(JSON.parse(db.values.get(KEY)).state.projects.length, 0);
});

test('unchanged updates keep project references and do not write storage', async () => {
    const db = database(); db.values.set(KEY, raw('safe'));
    const { useCanvasStore: store } = await client(db, new Map(), true);
    const projects = store.getState().projects;
    store.getState().updateProject('old', { nodes: projects[0].nodes, connections: projects[0].connections });
    store.getState().updateProject('missing', { nodes: [] });
    store.getState().renameProject('old', 'safe');
    store.getState().deleteProjects(['missing']);
    assert.equal(store.getState().projects, projects);
    await store.getState().retrySave();
    assert.equal(db.writes.filter(key => key === KEY).length, 0);
});

test('a burst of edits stays pending and writes only the latest complete snapshot', async () => {
    const db = database(); db.values.set(KEY, raw('safe'));
    const { useCanvasStore: store } = await client(db, new Map(), true);
    for (let index = 0; index < 40; index++) store.getState().renameProject('old', `edit-${index}`);
    assert.equal(store.getState().savePending, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(db.writes.filter(key => key === KEY).length, 0);
    await store.getState().retrySave();
    assert.equal(JSON.parse(db.values.get(KEY)).state.projects[0].title, 'edit-39');
    assert.equal(db.writes.filter(key => key === KEY).length, 1);
    assert.equal(store.getState().savePending, false);
});

test('an overlapping flush waits for the active write and includes newer edits', async () => {
    const db = database(); db.values.set(KEY, raw('safe'));
    const { useCanvasStore: store } = await client(db, new Map(), true);
    let release; const blocked = new Promise(resolve => { release = resolve; });
    const originalSet = db.setItem.bind(db);
    db.setItem = async (key, value) => { if (key === KEY) await blocked; return originalSet(key, value); };
    store.getState().renameProject('old', 'first');
    const first = store.getState().retrySave();
    await new Promise(resolve => setImmediate(resolve));
    store.getState().renameProject('old', 'latest');
    let finished = false;
    const second = store.getState().retrySave().then(() => { finished = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false);
    release(); await Promise.all([first, second]);
    assert.equal(JSON.parse(db.values.get(KEY)).state.projects[0].title, 'latest');
    assert.equal(store.getState().savePending, false);
});

test('queued edits flush automatically without waiting for editing to stop', async () => {
    const db = database(); db.values.set(KEY, raw('safe'));
    const { useCanvasStore: store } = await client(db, new Map(), true);
    store.getState().renameProject('old', 'automatic');
    await new Promise(resolve => setTimeout(resolve, 260));
    assert.equal(JSON.parse(db.values.get(KEY)).state.projects[0].title, 'automatic');
    assert.equal(store.getState().savePending, false);
});

test('leaving or hiding the page flushes queued edits immediately and preserves the unload warning', async () => {
    for (const event of ['beforeunload', 'visibilitychange']) {
        const db = database(); db.values.set(KEY, raw('safe'));
        const { useCanvasStore: store, events, document } = await client(db, new Map(), true);
        store.getState().renameProject('old', event);
        let warned = false;
        document.visibilityState = 'hidden';
        events.get(event)({ preventDefault() { warned = true; } });
        await store.getState().retrySave();
        assert.equal(JSON.parse(db.values.get(KEY)).state.projects[0].title, event);
        assert.equal(warned, event === 'beforeunload');
    }
});
