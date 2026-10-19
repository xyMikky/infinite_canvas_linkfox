const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8');
const constants = source.slice(source.indexOf('const MIME ='), source.indexOf('let mainWindow =')).replace('const DESKTOP_UI_PORT = 17370;', 'const DESKTOP_UI_PORT = 0;');
const serverCode = source.slice(source.indexOf('function startStaticServer('), source.indexOf('async function createWindow('));
function loadServer(failRead = false) {
    const missing = Object.assign(new Error('resource disappeared after stat'), { code: 'ENOENT' });
    const shouldFail = file => failRead && path.basename(file) === 'vanishing.js';
    return vm.runInNewContext(`${constants}\n${serverCode}\nstartStaticServer`, {
        http, path,
        fs: { ...fs, createReadStream: file => shouldFail(file) ? new Readable({ read() { this.destroy(missing); } }) : fs.createReadStream(file) },
        fsp: { readFile: file => shouldFail(file) ? Promise.reject(missing) : fs.promises.readFile(file) },
        attachRoomWebSocket() {}, handleRhFileProxy: () => false,
    });
}
function fixture() {
    const directory = path.resolve(__dirname, '../../tmp/desktop-static-tests');
    fs.mkdirSync(directory, { recursive: true });
    const root = fs.mkdtempSync(path.join(directory, 'dist-'));
    fs.mkdirSync(path.join(root, 'assets'));
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><div>canvas</div>');
    fs.writeFileSync(path.join(root, 'assets/current.js'), 'export const current = true;');
    fs.writeFileSync(path.join(root, 'assets/vanishing.js'), 'test');
    return root;
}
function request(server, pathname) {
    return new Promise((resolve, reject) => {
        const req = http.get({ hostname: '127.0.0.1', port: server.address().port, path: pathname }, res => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
            res.on('error', reject);
        });
        req.on('error', reject);
    });
}
async function withServer(run, failRead = false) {
    const root = fixture();
    const { server } = await loadServer(failRead)(root, '127.0.0.1');
    try { return await run(server, root); }
    finally { await new Promise(resolve => server.close(resolve)); }
}

if (process.argv.includes('--read-failure-child')) {
    withServer(async server => {
        assert.equal((await request(server, '/assets/vanishing.js')).status, 404);
        assert.equal((await request(server, '/canvas')).status, 200);
        console.log('read failure handled; server still available');
    }, true).catch(error => { console.error(error); process.exitCode = 1; });
} else {
    test('canvas routes serve an uncached entry page after an upgrade', () => withServer(async server => {
        const response = await request(server, '/canvas/project-id');
        assert.equal(response.status, 200);
        assert.match(response.headers['content-type'], /text\/html/);
        assert.equal(response.headers['cache-control'], 'no-store');
        assert.match(response.body, /canvas/);
    }));
    test('current scripts retain their JavaScript body and MIME type', () => withServer(async server => {
        const response = await request(server, '/assets/current.js?v=1');
        assert.equal(response.status, 200);
        assert.match(response.headers['content-type'], /javascript/);
        assert.equal(response.body, 'export const current = true;');
    }));
    test('an obsolete script returns 404 instead of the HTML entry page', () => withServer(async server => {
        const response = await request(server, '/assets/old-version.js');
        assert.equal(response.status, 404);
        assert.doesNotMatch(response.body, /<!doctype/);
    }));
    test('resource read failure does not crash the main process or stop later requests', () => {
        const output = execFileSync(process.execPath, [__filename, '--read-failure-child'], { encoding: 'utf8', timeout: 5000 });
        assert.match(output, /server still available/);
    });
    test('a request cannot read a sibling of the frontend directory', () => withServer(async (server, root) => {
        const sibling = `${root}-other`;
        fs.mkdirSync(sibling);
        fs.writeFileSync(path.join(sibling, 'private.js'), 'private contents');
        const response = await request(server, `/%2e%2e/${path.basename(sibling)}/private.js`);
        assert.equal(response.status, 404);
        assert.doesNotMatch(response.body, /private contents/);
    }));
}
