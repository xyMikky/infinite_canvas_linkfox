const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');
const { IDBFactory } = require('fake-indexeddb');
const KEY = 'infinite-canvas:canvas_store';
const raw = title => JSON.stringify({ state: { projects: [{ id: 'old', title, nodes: [], connections: [] }] }, version: 0 });

function database() {
    const indexedDB = new IDBFactory();
    const db = { indexedDB, abortWrites: false };
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...args) => {
        const request = open(...args);
        request.addEventListener('success', () => {
            const connection = request.result;
            const transaction = connection.transaction.bind(connection);
            connection.transaction = (...options) => {
                const tx = transaction(...options);
                if (db.abortWrites && options[1] === 'readwrite') {
                    const store = tx.objectStore('app_state');
                    const put = store.put.bind(store);
                    store.put = (...args) => {
                        const write = put(...args);
                        write.addEventListener('success', () => tx.abort(), { once: true });
                        return write;
                    };
                }
                return tx;
            };
        });
        return request;
    };
    const ready = new Promise((resolve, reject) => {
        const request = indexedDB.open('infinite-canvas');
        request.onupgradeneeded = () => request.result.createObjectStore('app_state');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    async function run(mode, action) {
        const connection = await ready;
        return new Promise((resolve, reject) => {
            const tx = connection.transaction('app_state', mode);
            const request = action(tx.objectStore('app_state'));
            tx.oncomplete = () => resolve(request.result ?? null);
            tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
        });
    }
    return Object.assign(db, {
        ready: () => ready,
        config: key => ({ name: 'infinite-canvas', storeName: 'app_state' })[key],
        getItem: key => run('readonly', store => store.get(key)),
        setItem: (key, value) => run('readwrite', store => store.put(value, key)).then(() => value),
        removeItem: key => run('readwrite', store => store.delete(key)),
        keys: () => run('readonly', store => store.getAllKeys()),
    });
}

async function client(db, legacy = new Map()) {
    const context = vm.createContext({
        indexedDB: db.indexedDB, navigator: {},
        crypto: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) },
        window: { localStorage: { getItem: key => legacy.get(key) ?? null } },
    });
    const external = {
        localforage: { default: { INDEXEDDB: 'idb', createInstance: () => db } },
        nanoid: { nanoid: () => webcrypto.randomUUID() },
        '@/lib/utils': { randomId: () => webcrypto.randomUUID() },
        '@/constant/env': { APP_VERSION: 'lan-test' },
        '@/services/dev-local-store': { DEV_CANVAS_STORE_KEY: KEY, ensureDevLocalStore: async () => false },
    };
    const modules = new Map();
    async function load(name) {
        if (modules.has(name)) return modules.get(name);
        if (external[name]) {
            const exports = external[name];
            const module = new vm.SyntheticModule(Object.keys(exports), function () {
                for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
            }, { context });
            modules.set(name, module);
            return module;
        }
        const source = fs.readFileSync(path.join(__dirname, '..', name.replace('@/', 'src/') + '.ts'), 'utf8');
        const module = new vm.SourceTextModule(stripTypeScriptTypes(source), { context, identifier: name });
        modules.set(name, module);
        await module.link(load);
        return module;
    }
    const module = await load('@/services/canvas-persistence');
    await module.evaluate();
    return module.namespace;
}

test('LAN HTTP reads and saves without Web Locks or crypto.randomUUID', async () => {
    const db = database();
    const storage = await client(db);
    assert.equal(await storage.readCanvasIndexedDb(), null);
    await storage.writeCanvasIndexedDb(raw('first'));
    await storage.writeCanvasIndexedDb(raw('edited'));
    assert.equal(await db.getItem(KEY), raw('edited'));
    assert.ok((await db.keys()).some(key => key.includes('history-')));
});

test('simultaneous LAN tabs cannot both replace the same baseline', async () => {
    const db = database(); await db.setItem(KEY, raw('start'));
    const a = await client(db); const b = await client(db);
    await Promise.all([a.readCanvasIndexedDb(), b.readCanvasIndexedDb()]);
    const results = await Promise.allSettled([a.writeCanvasIndexedDb(raw('a')), b.writeCanvasIndexedDb(raw('b'))]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = results.find(result => result.status === 'rejected');
    assert.match(rejected.reason.message, /其他窗口/);
    assert.equal(await db.getItem(KEY), raw(results[0].status === 'fulfilled' ? 'a' : 'b'));
    assert.equal((await db.getItem('infinite-canvas:canvas_backup:upgrade-lan-test')).raw, raw('start'));
});

test('LAN migration preserves the original and restores backups without randomUUID', async () => {
    const db = database(); const legacy = new Map([[KEY, raw('legacy')]]);
    const storage = await client(db, legacy);
    assert.equal(await storage.readCanvasIndexedDb(), raw('legacy'));
    assert.equal(legacy.get(KEY), raw('legacy'));
    await storage.writeCanvasIndexedDb(raw('newer'));
    await storage.restoreCanvasBackup('legacy-localstorage');
    const projects = JSON.parse(await db.getItem(KEY)).state.projects;
    assert.equal(projects.length, 2);
    assert.notEqual(projects[0].id, 'old');
    assert.equal(projects[1].title, 'newer');
    assert.ok((await db.keys()).some(key => key.startsWith('infinite-canvas:canvas_original:')));
});

test('LAN missing main record with backups never silently reinitializes', async () => {
    const db = database(); await db.setItem(KEY, raw('safe'));
    const storage = await client(db);
    await storage.readCanvasIndexedDb();
    await db.removeItem(KEY);
    await assert.rejects(storage.readCanvasIndexedDb(), /主记录缺失/);
    await assert.rejects(storage.writeCanvasIndexedDb(raw('unexpected')), /尚未读取/);
    assert.equal(await db.getItem(KEY), null);
});

test('LAN rejects accidental empty overwrite and permits explicit delete', async () => {
    const db = database(); await db.setItem(KEY, raw('safe'));
    const storage = await client(db);
    await storage.readCanvasIndexedDb();
    const empty = JSON.stringify({ state: { projects: [] }, version: 0 });
    await assert.rejects(storage.writeCanvasIndexedDb(empty), /未明确执行删除/);
    assert.equal(await db.getItem(KEY), raw('safe'));
    await storage.writeCanvasIndexedDb(empty, true);
    assert.equal(await db.getItem(KEY), empty);
});

test('aborted IndexedDB commit leaves the baseline retryable and original untouched', async () => {
    const db = database(); await db.setItem(KEY, raw('safe'));
    const storage = await client(db);
    await storage.readCanvasIndexedDb();
    // Avoid aborting checkpoint creation: this test targets the primary record commit.
    await storage.writeCanvasIndexedDb(raw('checkpoint'));
    db.abortWrites = true;
    await assert.rejects(storage.writeCanvasIndexedDb(raw('pending')));
    assert.equal(await db.getItem(KEY), raw('checkpoint'));
    db.abortWrites = false;
    await storage.writeCanvasIndexedDb(raw('pending'));
    assert.equal(await db.getItem(KEY), raw('pending'));
});

test('restoring a LAN backup cannot overwrite a save completed by another tab', async () => {
    const db = database(); await db.setItem(KEY, raw('start'));
    const restoring = await client(db); const editing = await client(db);
    await restoring.readCanvasIndexedDb(); await editing.readCanvasIndexedDb();
    let release; const paused = new Promise(resolve => { release = resolve; });
    let reached; const waiting = new Promise(resolve => { reached = resolve; });
    const setItem = db.setItem;
    db.setItem = async (key, value) => {
        if (key.startsWith('infinite-canvas:canvas_original:')) { reached(); await paused; }
        return setItem(key, value);
    };
    const restore = restoring.restoreCanvasBackup('upgrade-lan-test');
    const rejected = assert.rejects(restore, /其他窗口/);
    await waiting;
    await editing.writeCanvasIndexedDb(raw('newer'));
    release(); await rejected;
    assert.equal(await db.getItem(KEY), raw('newer'));
});
