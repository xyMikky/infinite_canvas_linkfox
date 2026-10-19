const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1sAAAAASUVORK5CYII=', 'base64');
const root = path.join(__dirname, '../src');

async function fixture({ stored = true, response } = {}) {
    const storageReads = [], requests = [];
    class FileReader {
        readAsDataURL(blob) {
            blob.arrayBuffer().then(buffer => {
                this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;
                this.onload();
            });
        }
    }
    const context = vm.createContext({ Blob, FileReader, URL, fetch: async url => {
        requests.push(url);
        return response || new Response(png, { headers: { 'Content-Type': 'image/png' } });
    } });
    const mocks = {
        localforage: { default: { createInstance: () => ({ getItem: async () => null }) } },
        nanoid: { nanoid: () => 'unused' },
        '@/i18n': { default: { t: key => key } },
        '@/lib/canvas/room/room-media-context': { resolveRoomMediaUrl: () => null, syncRoomMediaIfActive: () => {} },
        '@/services/dev-local-store': {
            ensureDevLocalStore: async () => true,
            // The development middleware serves existing files as application/octet-stream.
            getDevLocalBlob: async key => {
                storageReads.push(key);
                return stored ? new Response(png, { headers: { 'Content-Type': 'application/octet-stream' } }).blob() : null;
            },
            setDevLocalBlob: async () => {}, deleteDevLocalBlob: async () => {}, listDevLocalBlobs: async () => [],
        },
    };
    const modules = new Map();
    async function load(file) {
        if (modules.has(file)) return modules.get(file);
        const mod = new vm.SourceTextModule(stripTypeScriptTypes(fs.readFileSync(path.join(root, file), 'utf8')), { context });
        modules.set(file, mod);
        await mod.link(name => {
            if (mocks[name]) return new vm.SyntheticModule(Object.keys(mocks[name]), function () {
                for (const [key, value] of Object.entries(mocks[name])) this.setExport(key, value);
            }, { context });
            if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
            throw new Error(`Unexpected dependency: ${name}`);
        });
        return mod;
    }
    const helper = await load('lib/canvas/photopea-image.ts');
    await helper.evaluate();
    const images = await load('lib/image-utils.ts');
    await images.evaluate();
    return { ...helper.namespace, ...images.namespace, storageReads, requests };
}

test('PS opens original PNG bytes from disk even when the response MIME is generic', async () => {
    const f = await fixture();
    const blob = await f.readPhotopeaImageBlob({ storageKey: 'image:disk', url: 'blob:expired' });
    assert.equal(blob.type, 'application/octet-stream');
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), png);
    assert.equal(await f.readFileAsDataUrl(blob), `data:application/octet-stream;base64,${png.toString('base64')}`);
    assert.deepEqual(f.storageReads, ['image:disk']);
    assert.deepEqual(f.requests, [], 'Read the original bytes without fetching a stale URL or round-tripping base64');
});

test('PS uses the displayed primary batch image instead of stale top-level metadata', async () => {
    const f = await fixture();
    const selected = { id: 'selected', content: 'blob:current', storageKey: 'image:selected' };
    const node = { title: 'Batch', metadata: { content: 'blob:old', storageKey: 'image:old', primaryImageId: 'selected', images: [{ id: 'other', storageKey: 'image:other' }, selected] } };
    const source = f.photopeaNodeImageSource(node);
    assert.equal(source.storageKey, 'image:selected');
    assert.equal(source.url, 'blob:current');
    await f.readPhotopeaImageBlob(source);
    assert.deepEqual(f.storageReads, ['image:selected']);
    assert.equal(f.photopeaNodeImageSource({ metadata: { images: [selected] } }).storageKey, 'image:selected', 'Batch-only nodes work without top-level fields');
    assert.equal(f.photopeaNodeImageSource({ metadata: { storageKey: 'image:single' } }).storageKey, 'image:single');
});

test('a missing stored file does not cause PS to fetch an expired blob URL', async () => {
    const f = await fixture({ stored: false });
    await assert.rejects(f.readPhotopeaImageBlob({ storageKey: 'image:missing', url: 'blob:expired' }), /photopea-image-read/);
    assert.deepEqual(f.requests, []);
});

test('an available durable URL can supply an image when the stored copy is missing', async () => {
    const f = await fixture({ stored: false });
    const blob = await f.readPhotopeaImageBlob({ storageKey: 'image:missing', url: 'https://example.test/image.png' });
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), png);
    assert.deepEqual(f.requests, ['https://example.test/image.png']);
});

test('failed HTTP responses and empty data are rejected before reaching PS', async () => {
    for (const response of [new Response('Not Found', { status: 404 }), new Response('')]) {
        const f = await fixture({ stored: false, response });
        await assert.rejects(f.readPhotopeaImageBlob({ url: 'https://example.test/missing.png' }), /photopea-image-read/);
    }
});

test('PS retry and close labels resolve in both shipped locales', async () => {
    for (const [locale, retry, close] of [['zh-CN', '重试', '关闭'], ['en-US', 'Retry', 'Close']]) {
        const mod = new vm.SourceTextModule(stripTypeScriptTypes(fs.readFileSync(path.join(root, `i18n/locales/${locale}.ts`), 'utf8')));
        await mod.link(() => { throw new Error('Unexpected dependency'); });
        await mod.evaluate();
        assert.equal(mod.namespace.default.common.retry, retry);
        assert.equal(mod.namespace.default.common.close, close);
    }
});
