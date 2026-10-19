const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createDevLocalStoreMiddleware } = require('../electron/dev-local-store.cjs');

test('media supports metadata-only HEAD, partial playback and full editing reads', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-media-test-'));
    const handler = createDevLocalStoreMiddleware({ rootDir: root });
    const server = http.createServer((req, res) => handler(req, res, () => res.end()));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); fs.rmSync(root, { recursive: true, force: true }); });
    const data = Buffer.from('0123456789');
    fs.writeFileSync(path.join(root, 'blobs', Buffer.from('video:test').toString('base64url')), data);
    const url = `http://127.0.0.1:${server.address().port}/api/dev-local-store/blob/video%3Atest`;
    const head = await fetch(url, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), '10');
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const partial = await fetch(url, { headers: { Range: 'bytes=3-6' } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 3-6/10');
    assert.equal(await partial.text(), '3456');
    assert.equal(await (await fetch(url)).text(), data.toString());
    assert.equal((await fetch(url + '-missing', { method: 'HEAD' })).status, 404);
});
