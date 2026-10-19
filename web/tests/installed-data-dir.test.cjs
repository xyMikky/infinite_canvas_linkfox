const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { applyInstalledDataDir } = require('../electron/installed-data-dir.cjs');
const testRoot = path.resolve(__dirname, '../../data/protection-tests');
fs.mkdirSync(testRoot, { recursive: true });
function fixture() {
    const root = fs.mkdtempSync(path.join(testRoot, 'startup-'));
    const install = path.join(root, 'install'); const profile = path.join(root, 'profile');
    fs.mkdirSync(install); fs.mkdirSync(path.join(profile, 'IndexedDB'), { recursive: true });
    const paths = { exe: path.join(install, 'InfiniteCanvas.exe'), userData: profile };
    return { root, install, profile, app: { isPackaged: true, getPath: key => paths[key], setPath: (key, value) => { paths[key] = value; } } };
}
test('missing registered directory stops startup and never creates a new empty source', () => {
    const { install, app, profile } = fixture();
    const missing = path.join(install, 'missing-data');
    fs.writeFileSync(path.join(install, 'data-dir.txt'), missing);
    assert.throws(() => applyInstalledDataDir(app, []));
    assert.equal(fs.existsSync(missing), false);
    assert.equal(app.getPath('userData'), profile);
});
test('old default profile is retained when no directory pointer exists', () => {
    const { install, app, profile } = fixture();
    applyInstalledDataDir(app, []);
    assert.equal(app.getPath('userData'), profile);
    assert.equal(fs.existsSync(path.join(install, 'data')), false);
});
test('ambiguous existing profiles stop startup instead of choosing an empty fallback', () => {
    const { install, app } = fixture();
    fs.mkdirSync(path.join(install, 'data', 'IndexedDB'), { recursive: true });
    assert.throws(() => applyInstalledDataDir(app, []));
});
test('interrupted upgrade blocks new startup until recovery is marked complete', () => {
    const { install, app, root, profile } = fixture();
    const backups = path.join(root, 'backups'); fs.mkdirSync(backups);
    const hash = createHash('sha256').update(path.resolve(install).toLowerCase()).digest('hex');
    const guard = path.join(backups, `pending-${hash}.json`);
    fs.writeFileSync(guard, JSON.stringify({ completed: false }));
    assert.throws(() => applyInstalledDataDir(app, [backups]));
    assert.equal(fs.existsSync(path.join(install, 'data')), false);
    fs.writeFileSync(guard, JSON.stringify({ completed: true }));
    applyInstalledDataDir(app, [backups]);
    assert.equal(app.getPath('userData'), profile);
});
test('unwritable registered directory never falls back to another profile', () => {
    const { install, app, profile } = fixture();
    const original = fs.accessSync;
    fs.writeFileSync(path.join(install, 'data-dir.txt'), profile);
    fs.accessSync = () => { throw new Error('access denied'); };
    try { assert.throws(() => applyInstalledDataDir(app, [])); }
    finally { fs.accessSync = original; }
    assert.equal(app.getPath('userData'), profile);
    assert.equal(fs.existsSync(path.join(install, 'data')), false);
});
