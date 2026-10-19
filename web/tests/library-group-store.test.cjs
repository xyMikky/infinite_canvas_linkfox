const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { randomUUID } = require('node:crypto');
const { IDBFactory } = require('fake-indexeddb');
const { create } = require('zustand');
const KEY = 'infinite-canvas:library_groups';

function database() {
    const indexedDB = new IDBFactory();
    const db = { indexedDB, failRead: false, abortWrites: false };
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
                        const request = put(...args);
                        request.addEventListener('success', () => tx.abort(), { once: true });
                        return request;
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
            tx.onabort = () => reject(tx.error || new Error('aborted'));
        });
    }
    return Object.assign(db, {
        ready: () => ready,
        config: key => ({ name: 'infinite-canvas', storeName: 'app_state' })[key],
        getItem: key => db.failRead ? Promise.reject(new Error('read denied')) : run('readonly', store => store.get(key)),
        setItem: (key, value) => run('readwrite', store => store.put(value, key)),
    });
}

async function client(db, entry = '@/stores/use-library-group-store', prompts = []) {
    const context = vm.createContext({ indexedDB: db.indexedDB });
    const external = {
        localforage: { default: { INDEXEDDB: 'idb', createInstance: () => db } },
        zustand: { create },
        nanoid: { nanoid: randomUUID },
        '@/i18n': { default: { t: key => key } },
        '@/stores/use-prompt-source-store': { usePromptSourceStore: { getState: () => ({ sources: [] }) } },
        '@/services/api/local-prompts': { LOCAL_PROMPT_SOURCE_ID: 'local', listLocalPrompts: async () => prompts, localPromptCategory: () => '我的提示词' },
    };
    const modules = new Map();
    async function load(name, parent) {
        if (name.startsWith('.')) name = path.posix.join(path.posix.dirname(parent.identifier), name);
        if (modules.has(name)) return modules.get(name);
        if (external[name]) {
            const exports = external[name];
            const mod = new vm.SyntheticModule(Object.keys(exports), function () {
                for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
            }, { context });
            modules.set(name, mod);
            return mod;
        }
        const source = fs.readFileSync(path.join(__dirname, '..', name.replace('@/', 'src/') + '.ts'), 'utf8');
        const mod = new vm.SourceTextModule(stripTypeScriptTypes(source), { context, identifier: name });
        modules.set(name, mod);
        await mod.link(load);
        return mod;
    }
    const mod = await load(entry);
    await mod.evaluate();
    return entry.includes('use-library-group-store') ? mod.namespace.useLibraryGroupStore : mod.namespace;
}

test('writing is blocked before hydration; groups and membership survive reload', async () => {
    const db = database();
    const a = await client(db);
    await assert.rejects(a.getState().createGroup('assets', '图'), /readFailed/);
    await a.getState().hydrate();
    const id = await a.getState().createGroup('assets', '图');
    await a.getState().moveItems('assets', ['image'], id);
    const b = await client(db);
    await b.getState().hydrate();
    assert.equal(b.getState().data.assets.members.image, id);
    assert.equal(b.getState().data.assets.groups[0].name, '图');
});

test('failed reads retain stored groups, block editing and permit a successful retry', async () => {
    const db = database();
    const a = await client(db);
    await a.getState().hydrate();
    await a.getState().createGroup('assets', '原分组');
    db.failRead = true;
    const b = await client(db);
    await b.getState().hydrate();
    assert.equal(b.getState().hydrated, false);
    await assert.rejects(b.getState().createGroup('assets', '不应写入'), /readFailed/);
    db.failRead = false;
    await b.getState().hydrate();
    assert.equal(b.getState().data.assets.groups.length, 1);
    assert.equal(b.getState().error, '');
});

test('an aborted transaction does not update the visible groups or discard unrelated app records', async () => {
    const db = database();
    await db.setItem('infinite-canvas:asset_store', 'existing assets');
    const a = await client(db);
    await a.getState().hydrate();
    const id = await a.getState().createGroup('assets', '旧名称');
    db.abortWrites = true;
    await assert.rejects(a.getState().renameGroup('assets', id, '不应生效'));
    assert.equal(a.getState().data.assets.groups[0].name, '旧名称');
    assert.equal(a.getState().pending, 0);
    db.abortWrites = false;
    assert.equal((await db.getItem(KEY)).assets.groups[0].name, '旧名称');
    assert.equal(await db.getItem('infinite-canvas:asset_store'), 'existing assets');
});

test('two windows create groups concurrently without losing either library or earlier membership', async () => {
    const db = database();
    const a = await client(db), b = await client(db);
    await Promise.all([a.getState().hydrate(), b.getState().hydrate()]);
    const [assetId, promptId] = await Promise.all([a.getState().createGroup('assets', '图片'), b.getState().createGroup('prompts', '文案')]);
    await Promise.all([a.getState().moveItems('assets', ['img'], assetId), b.getState().moveItems('prompts', ['["local","p"]'], promptId)]);
    const saved = await db.getItem(KEY);
    assert.equal(saved.assets.members.img, assetId);
    assert.equal(saved.prompts.members['["local","p"]'], promptId);
});

test('a stale window cannot move items into a deleted group; deleting keeps source content', async () => {
    const db = database();
    const a = await client(db);
    await a.getState().hydrate();
    const id = await a.getState().createGroup('assets', '产品');
    await a.getState().moveItems('assets', ['img'], id);
    await db.setItem('infinite-canvas:asset_store', 'source image');
    const b = await client(db);
    await b.getState().hydrate();
    a.getState().select('assets', id);
    await a.getState().removeGroup('assets', id);
    assert.equal(a.getState().selected.assets, '');
    await assert.rejects(b.getState().moveItems('assets', ['another'], id), /missing/);
    assert.equal(Object.keys((await db.getItem(KEY)).assets.members).length, 0);
    assert.equal(await db.getItem('infinite-canvas:asset_store'), 'source image');
});

test('prompt filtering happens before pagination and combines with keyword and tags', async () => {
    const records = Array.from({ length: 35 }, (_, index) => ({ id: String(index), title: `prompt ${index}`, prompt: '内容', tags: index === 30 ? ['产品'] : [], sourceId: 'local' }));
    const api = await client(database(), '@/services/api/prompts', records);
    const library = { groups: [{ id: 'a', name: '精选' }], members: { '["local","30"]': 'a', '["local","31"]': 'a' } };
    const first = await api.fetchPrompts({ page: 1, pageSize: 1, group: { library, id: 'a' } });
    assert.equal(first.items[0].id, '30');
    assert.equal(first.total, 2);
    const second = await api.fetchPrompts({ page: 2, pageSize: 1, group: { library, id: 'a' } });
    assert.equal(second.items[0].id, '31');
    const filtered = await api.fetchPrompts({ keyword: '30', tag: ['产品'], group: { library, id: 'a' } });
    assert.equal(filtered.total, 1);
    const ungrouped = await api.fetchPrompts({ group: { library, id: '' } });
    assert.equal(ungrouped.total, 33);
});

test('repeated asset saves while grouping is pending create only one asset', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/pages/assets/index.tsx'), 'utf8');
    const body = source.slice(source.indexOf('    const saveAsset = async'), source.indexOf('    const readCoverFile = async'));
    let writes = 0, finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const guard = { current: false };
    const context = {
        assetSavingRef: guard, setAssetSaving: () => {},
        form: { validateFields: async () => ({ title: '素材', kind: 'text', content: '正文', groupId: 'a' }) },
        editingAsset: null, imageDraft: null,
        addAsset: () => { writes++; return 'saved'; },
        updateAsset: () => {}, assignGroup: () => pending,
        message: { success: () => {}, error: () => {} }, t: key => key, setIsAssetOpen: () => {},
    };
    const save = vm.runInNewContext(`${stripTypeScriptTypes(body)}\nsaveAsset`, context);
    const first = save();
    await new Promise(setImmediate);
    assert.equal(writes, 1);
    await save();
    assert.equal(writes, 1);
    finish();
    await first;
    assert.equal(guard.current, false);
});
