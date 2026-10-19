const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { unzipSync, zipSync } = require('fflate');
const { create } = require('zustand');

const root = path.join(__dirname, '../src');
async function loadReport(overrides = {}) {
    const folderReads = [];
    const requests = [];
    class FileReader {
        readAsDataURL(blob) {
            blob.arrayBuffer().then(buffer => {
                this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
                this.onload();
            });
        }
    }
    const context = vm.createContext({
        Blob, FileReader, AbortSignal, structuredClone, URL,
        fetch: async (url, options) => {
            requests.push({ url, options });
            return overrides.fetch ? overrides.fetch(url, options) : fetch(url, options);
        },
    });
    const mocks = {
        '@/services/image-storage': { getImageBlob: async () => overrides.image || null },
        '@/services/file-storage': { getMediaBlob: async () => overrides.media || null },
        '@/lib/canvas/folder-preview-cache': {
            loadFolderPreviewSourceBuffer: async (id, file) => { folderReads.push([id, file]); return overrides.folder || null; },
            parseFolderSourceStorageKey: key => { const [, folderNodeId, ...rest] = key.split(':'); return { folderNodeId, path: rest.join(':') }; },
        },
        '@/stores/use-theme-store': { useThemeStore: { getState: () => ({ theme: 'light' }) } },
        zustand: { create },
        '@/lib/zip': { createZip: async files => {
            const entries = await Promise.all(files.map(async file => [file.name, new Uint8Array(await new Blob([file.data]).arrayBuffer())]));
            return new Blob([zipSync(Object.fromEntries(entries), { level: 0 })]);
        } },
    };
    const modules = new Map();
    async function moduleAt(file) {
        if (modules.has(file)) return modules.get(file);
        const mod = new vm.SourceTextModule(stripTypeScriptTypes(fs.readFileSync(file, 'utf8')), { context, identifier: file });
        modules.set(file, mod);
        await mod.link(async (specifier, parent) => {
            if (mocks[specifier]) return new vm.SyntheticModule(Object.keys(mocks[specifier]), function () {
                for (const [key, value] of Object.entries(mocks[specifier])) this.setExport(key, value);
            }, { context });
            const target = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(parent.identifier), specifier);
            return moduleAt(target + '.ts');
        });
        return mod;
    }
    const document = await moduleAt(path.join(root, 'lib/canvas/report/document.ts'));
    const assets = await moduleAt(path.join(root, 'lib/canvas/report/assets.ts'));
    const archive = await moduleAt(path.join(root, 'lib/canvas/report/archive.ts'));
    const store = await moduleAt(path.join(root, 'stores/canvas/use-canvas-report-store.ts'));
    for (const mod of [document, assets, archive, store]) await mod.evaluate();
    return { ...document.namespace, ...assets.namespace, ...archive.namespace, ...store.namespace, folderReads, requests };
}
const sample = () => ({
    title: '报告 <2026> "交付"', source: 'export default function Report() { return <h1>结果</h1> }', path: '项目/report.canvas.tsx',
    state: { tab: 2, filter: '全部' }, theme: 'light', assets: {},
});
const runtime = 'data:text/javascript;base64,' + Buffer.from('window.reportLoaded=true').toString('base64');

async function startBootstrap(channel = 'test-channel') {
    const api = await loadReport();
    const html = api.createReportDocument(sample(), runtime, channel);
    const match = html.match(/<script src="(data:text\/javascript;charset=utf-8,[^"]+)"/);
    assert.ok(match, '启动保护必须先于运行时脚本加载');
    const listeners = new Map();
    const root = { textContent: '正在打开报告…', setAttribute() {} };
    const script = {};
    const messages = [];
    let timer;
    const window = {
        parent: { postMessage: value => messages.push(value) },
        addEventListener(type, listener) { listeners.set(type, listener); },
        removeEventListener(type) { listeners.delete(type); },
    };
    const document = { getElementById(id) {
        return id === 'root' ? root : id === 'canvas-report-runtime' ? script : { textContent: JSON.stringify({ channel }) };
    } };
    vm.runInNewContext(decodeURIComponent(match[1].slice(match[1].indexOf(',') + 1)), {
        window, document, setTimeout(callback) { timer = callback; return 1; }, clearTimeout() { timer = undefined; },
    });
    return { listeners, root, script, messages, window, runTimer: () => timer?.() };
}

test('startup exceptions replace the loading placeholder and report the cause before React mounts', async () => {
    const boot = await startBootstrap();
    boot.listeners.get('error')({ target: boot.window, message: 'jsxDEV is not a function' });
    assert.match(boot.root.textContent, /jsxDEV is not a function/);
    assert.equal(boot.messages[0].ready, false);
    assert.equal(boot.messages[0].channel, 'test-channel');
    assert.equal(boot.messages[0].type, 'canvas-report-status');
});

test('runtime load failures and offline startup timeouts produce visible errors', async () => {
    const boot = await startBootstrap();
    boot.listeners.get('error')({ target: boot.script });
    assert.match(boot.root.textContent, /运行文件加载失败/);
    const offline = await startBootstrap('');
    offline.runTimer();
    assert.match(offline.root.textContent, /启动超时/);
    assert.equal(offline.messages.length, 0);
});

test('the mounted reader takes over error handling and cancels the startup watchdog', async () => {
    const boot = await startBootstrap();
    boot.root.textContent = '报告正文';
    boot.listeners.get('canvas-report-mounted')();
    boot.runTimer();
    assert.equal(boot.root.textContent, '报告正文');
    assert.equal(boot.listeners.has('error'), false);
    assert.equal(boot.listeners.has('unhandledrejection'), false);
});

test('delivery preserves source and state without allowing script or attribute breakout', async () => {
    const api = await loadReport();
    const report = sample();
    report.source += '\n// </script><script>alert(1)</script>';
    report.state.text = '</script><img src=x onerror=alert(1)>';
    const doc = api.createReportDocument(report, runtime, 'session-1');
    const data = JSON.parse(doc.match(/type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(data.source, report.source);
    assert.deepEqual(data.state, report.state);
    assert.equal(data.channel, 'session-1');
    assert.ok(!doc.includes('<script>alert(1)'));
    const html = api.createReportDeliveryHtml(report, runtime);
    assert.match(html, /sandbox="allow-scripts"/);
    assert.ok(!html.includes('allow-same-origin'));
    assert.ok(!html.includes('<img src=x'));
    assert.match(doc, /connect-src 'none'/);
    assert.throws(() => api.createReportDocument(report, 'https://cdn.example/runtime.js'), /内嵌/);
});

test('relative assets normalize safely, including encoded paths and folder traversal', async () => {
    const api = await loadReport();
    assert.equal(api.reportAssetKey('../images/a%20b.png?v=2#tile', '项目/reports/main.canvas.tsx'), '项目/images/a b.png');
    assert.equal(api.reportAssetKey('/images/a.svg#icon', '项目/a.canvas.tsx'), 'images/a.svg');
    for (const value of ['../../../a.png', '/%2e%2e/a.png', '/%2e%2e%2fa.png', '/..\\a.png']) {
        assert.throws(() => api.reportAssetKey(value, '项目/a.canvas.tsx'), /根目录/);
    }
    assert.equal(api.reportAssetKey('https://example.com/a.png?token=1', ''), 'https://example.com/a.png?token=1');
});

test('asset discovery includes unused literal branches but excludes code modules and data URLs', async () => {
    const api = await loadReport();
    const refs = api.collectReportAssetReferences('import { H1 } from "infinite-canvas"; const images = ["./a.png", "./b.webp"]; const style = "url(./font.woff2)"; <img src="./a.png"/>; <img src="data:image/png;base64,abcd"/>;');
    assert.deepEqual([...refs].sort(), ['./a.png', './b.webp', './font.woff2']);
});

test('stored images and relative folder files become durable data URLs', async () => {
    const api = await loadReport({ image: new Blob(['image'], { type: 'image/png' }), folder: new TextEncoder().encode('<svg/>').buffer });
    const signal = new AbortController().signal;
    assert.match((await api.loadReportAsset('image:123', '', '', signal)).dataUrl, /^data:image\/png;base64,/);
    const asset = await api.loadReportAsset('../image.svg', 'folder/report/main.canvas.tsx', 'folder-node', signal);
    assert.equal(asset.key, 'folder/image.svg');
    assert.match(asset.dataUrl, /^data:image\/svg\+xml;base64,/);
    assert.deepEqual(api.folderReads, [['folder-node', 'folder/image.svg']]);
});

test('missing, non-media and aborted assets fail instead of silently exporting broken links', async () => {
    const api = await loadReport({ fetch: async () => new Response('<html>denied</html>', { headers: { 'Content-Type': 'text/html' } }) });
    await assert.rejects(api.loadReportAsset('image:missing', '', '', new AbortController().signal), /找不到素材/);
    await assert.rejects(api.loadReportAsset('https://example.com/file', '', '', new AbortController().signal), /仅嵌入/);
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(api.loadReportAsset('image:123', '', '', aborted.signal), /abort/i);
});

test('remote downloads omit credentials and oversized responses are rejected before reading', async () => {
    const api = await loadReport({ fetch: async () => new Response('', { headers: { 'Content-Length': String(21 * 1024 * 1024) } }) });
    await assert.rejects(api.loadReportAsset('https://example.com/image.png', '', '', new AbortController().signal), /20 MB/);
    assert.equal(api.requests[0].options.credentials, 'omit');
    assert.equal(api.requests[0].options.referrerPolicy, 'no-referrer');
});

test('archive contains the runnable document, editable source, state and actual asset bytes', async () => {
    const api = await loadReport();
    const report = sample();
    report.assets['项目/images/icon.svg'] = 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64');
    const blob = await api.createReportArchive(report, runtime, new AbortController().signal);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const text = file => Buffer.from(files[file]).toString('utf8');
    assert.match(text('打开报告.html'), /sandbox="allow-scripts"/);
    assert.equal(text('source/项目/report.canvas.tsx'), report.source);
    assert.equal(text('source/项目/images/icon.svg'), '<svg/>');
    assert.deepEqual(JSON.parse(text('文档状态.json')), report.state);
    assert.deepEqual(JSON.parse(text('素材清单.json')), [{ reference: '项目/images/icon.svg', file: 'source/项目/images/icon.svg' }]);
});

test('archive rejects missing materialization and cancels without delivering a partial ZIP', async () => {
    const api = await loadReport();
    const report = sample(); report.assets['a.png'] = 'https://example.com/a.png';
    await assert.rejects(api.createReportArchive(report, runtime, new AbortController().signal), /先内嵌/);
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(api.createReportArchive(sample(), runtime, aborted.signal), /abort/i);
});

test('opening a report freezes its own source and state without changing canvas metadata', async () => {
    const { useCanvasReportStore } = await loadReport();
    const node = { id: 'source', title: '报告', metadata: { smartPreviewPath: 'demo.canvas.tsx', content: 'old source', canvasTsxState: { 'demo.canvas.tsx': { tab: 1 } } } };
    useCanvasReportStore.getState().open(node);
    const session = useCanvasReportStore.getState().session;
    node.metadata.content = 'new source'; node.metadata.canvasTsxState['demo.canvas.tsx'].tab = 2;
    assert.equal(session.report.source, 'old source');
    assert.equal(session.report.state.tab, 1);
    session.report.state.tab = 3;
    assert.equal(node.metadata.canvasTsxState['demo.canvas.tsx'].tab, 2);
});

test('exploded group delivery uses original source and marks independent fragment edits explicitly', async () => {
    const { useCanvasReportStore } = await loadReport();
    useCanvasReportStore.getState().open({ id: 'group', title: '数据组', metadata: { content: '', canvasExplodedSource: 'original', canvasExplodedPath: 'original.canvas.tsx', proxyFolderNodeId: 'folder' } });
    const session = useCanvasReportStore.getState().session;
    assert.equal(session.report.source, 'original');
    assert.equal(session.report.path, 'original.canvas.tsx');
    assert.equal(session.folderId, 'folder');
    assert.equal(session.fromExploded, true);
    useCanvasReportStore.getState().close();
    assert.equal(useCanvasReportStore.getState().session, null);
});
