const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

async function fixture(naturalWidth = 97, naturalHeight = 97) {
    const width = 97, height = 97;
    const pixels = Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : (i * 73) % 256);
    const created = [];
    function canvas() {
        const target = { width, height };
        const ctx = {
            canvas: target, filter: 'none', filters: [], pixels: new Uint8ClampedArray(pixels),
            clearRect() { this.pixels.fill(0); },
            drawImage(source) {
                this.filters.push(this.filter);
                this.pixels = new Uint8ClampedArray(source.getContext ? source.getContext().pixels : pixels);
            },
            getImageData() { return { data: new Uint8ClampedArray(this.pixels) }; },
            putImageData(image) { this.pixels = new Uint8ClampedArray(image.data); },
        };
        target.getContext = () => ctx;
        target.toDataURL = () => 'data:image/png;base64,test';
        created.push(target);
        return target;
    }
    class Image {
        naturalWidth = naturalWidth;
        naturalHeight = naturalHeight;
        set src(_) { queueMicrotask(() => this.onload()); }
    }
    const context = vm.createContext({ Uint8ClampedArray, Image, DOMException, document: { createElement: canvas } });
    const source = fs.readFileSync(path.join(__dirname, '../src/lib/canvas/image-blur.ts'), 'utf8');
    const mod = new vm.SourceTextModule(stripTypeScriptTypes(source), { context });
    await mod.link(() => { throw new Error('Unexpected dependency'); });
    await mod.evaluate();
    const api = mod.namespace;
    function preview(method, amount, scale = 1) {
        const original = canvas(), target = canvas();
        api.paintBlurPreview({ canvas: original, width, height, scale }, target, { method, amount });
        return target.getContext();
    }
    return { api, preview, created, pixels };
}

test('strength is limited to 0–20 and retains two decimal places', async () => {
    const { api } = await fixture();
    assert.equal(api.clampBlurAmount(-1), 0);
    assert.equal(api.clampBlurAmount(80), 20);
    assert.equal(api.clampBlurAmount(2.267), 2.27);
    assert.equal(api.clampBlurAmount(0.01), 0.01);
});

test('zero strength preserves original pixels for every blur method', async () => {
    const { preview, pixels } = await fixture();
    for (const method of ['gaussian', 'box', 'motionH', 'motionV', 'radial']) {
        const output = preview(method, 0);
        assert.ok(Buffer.from(output.pixels).equals(Buffer.from(pixels)), method);
        assert.ok(output.filters.every(filter => filter === 'none'), method);
    }
});

test('pixel-based methods respond to fractional strengths within one integer interval', async () => {
    const { preview } = await fixture();
    for (const method of ['box', 'motionH', 'motionV', 'radial']) {
        const lower = preview(method, 2).pixels;
        const fractional = preview(method, 2.25).pixels;
        const nextFraction = preview(method, 2.26).pixels;
        assert.ok(!Buffer.from(fractional).equals(Buffer.from(lower)), method);
        assert.ok(!Buffer.from(fractional).equals(Buffer.from(nextFraction)), method);
    }
});

test('Gaussian preview keeps subpixel radii after thumbnail scaling', async () => {
    const { preview } = await fixture();
    const output = preview('gaussian', 5.25, 0.1);
    assert.ok(output.filters.includes('blur(0.525px)'));
});

test('radial strength is relative to image size and is not scaled twice for previews', async () => {
    const { preview } = await fixture();
    assert.ok(Buffer.from(preview('radial', 5.25, 0.1).pixels).equals(Buffer.from(preview('radial', 5.25, 1).pixels)));
});

test('export sends the same decimal strength to the native Gaussian filter', async () => {
    const { api, created } = await fixture();
    await api.blurImageDataUrl('data:image/png;base64,test', { method: 'gaussian', amount: 5.25 });
    assert.ok(created.some(canvas => canvas.getContext().filters.includes('blur(5.25px)')));
});

test('large previews use the requested display pixel size instead of a 400px thumbnail', async () => {
    const { api } = await fixture(4096, 2048);
    const source = await api.createBlurPreviewSource('source', { width: 1600, height: 1000 });
    assert.equal(source.width, 1600);
    assert.equal(source.height, 800);
    assert.equal(source.scale, 1600 / 4096);
    assert.equal(source.canvas.width, 1600);
});

test('preview sizing preserves small images without upsampling', async () => {
    const { api } = await fixture(320, 160);
    const source = await api.createBlurPreviewSource('source', { width: 1600, height: 1000 });
    assert.equal(source.width, 320);
    assert.equal(source.height, 160);
    assert.equal(source.scale, 1);
});

test('zero-strength export reuses the original source without canvas encoding', async () => {
    const { api, created } = await fixture();
    const source = 'data:image/jpeg;base64,original-bytes';
    for (const method of ['gaussian', 'box', 'motionH', 'motionV', 'radial']) {
        assert.equal(await api.blurImageDataUrl(source, { method, amount: 0 }), source);
    }
    assert.equal(created.length, 0);
});

test('nonzero export still processes the original image dimensions', async () => {
    const { api, created } = await fixture(4096, 2048);
    await api.blurImageDataUrl('source', { method: 'gaussian', amount: 0.25 });
    assert.equal(created[0].width, 4096);
    assert.equal(created[0].height, 2048);
    assert.ok(created.some(canvas => canvas.getContext().filters.includes('blur(0.25px)')));
});

test('canceled zero-strength export does not return a result', async () => {
    const { api } = await fixture();
    await assert.rejects(api.blurImageDataUrl('source', { method: 'gaussian', amount: 0 }, { aborted: true }), { name: 'AbortError' });
});
