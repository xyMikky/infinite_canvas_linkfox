const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createCanvasProjectStorage } = require('../electron/canvas-project-storage.cjs');
const { createDevLocalStoreMiddleware } = require('../electron/dev-local-store.cjs');
const testRoot = path.resolve(__dirname, '../../data/protection-tests');
fs.mkdirSync(testRoot, { recursive: true });
const raw = (count = 2, title = 'original') => Buffer.from(JSON.stringify({ version: 0, state: { projects: [{ id: 'project', title, nodes: Array.from({ length: count }, (_, i) => ({ id: `node-${i}`, metadata: { storageKey: 'image:kept' } })), connections: [] }] } }));
const empty = Buffer.from('{"state":{"projects":[]},"version":0}');
function fixture() {
    const root = fs.mkdtempSync(path.join(testRoot, 'disk-'));
    fs.writeFileSync(path.join(root, 'projects.json'), raw());
    return { root, file: path.join(root, 'projects.json'), store: createCanvasProjectStorage(root) };
}

test('stale window cannot overwrite a newer save; lost-response retries are idempotent', () => {
    const { store, file } = fixture();
    const first = store.read('test');
    const next = raw(3, 'newer');
    store.write(next, first.revision, 'test');
    assert.throws(() => store.write(raw(1, 'stale'), first.revision, 'test'), error => error.status === 412);
    assert.deepEqual(fs.readFileSync(file), next);
    assert.equal(store.write(next, first.revision, 'test'), store.read('test').revision);
});

test('old clients without a revision are rejected, including an empty overwrite', () => {
    const { store, file } = fixture();
    assert.throws(() => store.write(empty), error => error.status === 428);
    assert.deepEqual(fs.readFileSync(file), raw());
});

test('malformed, incomplete and future-format writes preserve the original', () => {
    const { store, file } = fixture();
    const revision = store.read('test').revision;
    for (const value of ['{', '{"version":99,"state":{"projects":[]}}', '{"state":{"projects":[{"id":"broken"}]}}']) assert.throws(() => store.write(Buffer.from(value), revision, 'test'));
    assert.deepEqual(fs.readFileSync(file), raw());
});

test('clearing projects retains the nonempty upgrade and deletion snapshots with media references', () => {
    const { store } = fixture();
    store.write(empty, store.read('test').revision, 'test', true);
    store.write(empty, store.read('test').revision, 'test', true);
    assert.deepEqual(store.backup('upgrade-test'), raw());
    assert.deepEqual(store.backup('previous'), raw());
    assert.equal(store.references('image:kept'), true);
});

test('missing or corrupt main file cannot turn into a new empty canvas', () => {
    const { store, file } = fixture();
    const revision = store.read('test').revision;
    fs.unlinkSync(file);
    assert.throws(() => store.read('test'));
    assert.throws(() => store.write(empty, revision, 'test'));
    fs.writeFileSync(file, '{damaged');
    assert.throws(() => store.read('test'));
    assert.throws(() => store.write(empty, revision, 'test'));
    assert.equal(fs.readFileSync(file, 'utf8'), '{damaged');
});
test('even a current client cannot accidentally clear every project without an explicit delete', () => {
    const { store, file } = fixture();
    assert.throws(() => store.write(empty, store.read('test').revision, 'test'));
    assert.deepEqual(fs.readFileSync(file), raw());
});

test('rename/locking failures keep the main file intact', () => {
    const { store, file } = fixture();
    const revision = store.read('test').revision;
    const rename = fs.renameSync;
    fs.renameSync = () => { throw Object.assign(new Error('locked'), { code: 'EPERM' }); };
    try { assert.throws(() => store.write(raw(4), revision, 'test')); }
    finally { fs.renameSync = rename; }
    assert.deepEqual(fs.readFileSync(file), raw());
});

test('explicit recovery adds copies, and preserves corrupt originals before recovery', () => {
    const { store, root, file } = fixture();
    store.read('test');
    store.restore('upgrade-test');
    let projects = JSON.parse(fs.readFileSync(file)).state.projects;
    assert.equal(projects.length, 2);
    assert.notEqual(projects[0].id, projects[1].id);
    fs.writeFileSync(file, '{damaged');
    store.restore('upgrade-test');
    projects = JSON.parse(fs.readFileSync(file)).state.projects;
    assert.equal(projects.length, 1);
    assert.equal(fs.readdirSync(path.join(root, 'projects-history')).some(name => name.endsWith('.original') && fs.readFileSync(path.join(root, 'projects-history', name), 'utf8') === '{damaged'), true);
});

test('one damaged history file does not hide the remaining valid recovery snapshots', () => {
    const { store, root } = fixture();
    store.read('test');
    fs.writeFileSync(path.join(root, 'projects-history', 'history-damaged.json'), '{');
    assert.ok(store.list().some(item => item.id === 'upgrade-test'));
});

test('HTTP endpoint returns revisions, rejects stale writes and simple cross-site recovery', async () => {
    const { root } = fixture();
    const middleware = createDevLocalStoreMiddleware({ rootDir: root });
    const server = http.createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const base = `http://127.0.0.1:${server.address().port}/api/dev-local-store`;
        const url = `${base}/kv/infinite-canvas%3Acanvas_store`;
        const first = await fetch(url, { headers: { 'X-Canvas-Version': 'test' } });
        assert.ok(first.headers.get('etag'));
        assert.equal((await fetch(url, { method: 'PUT', body: raw(4), headers: { 'If-Match': first.headers.get('etag') } })).status, 200);
        assert.equal((await fetch(url, { method: 'PUT', body: empty, headers: { 'If-Match': first.headers.get('etag') } })).status, 412);
        assert.equal((await fetch(url, { method: 'DELETE' })).status, 405);
        assert.equal((await fetch(`${base}/canvas-backups/upgrade-test`, { method: 'POST' })).status, 415);
        assert.equal((await fetch(`${base}/canvas-backups/upgrade-test`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' } })).status, 403);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
