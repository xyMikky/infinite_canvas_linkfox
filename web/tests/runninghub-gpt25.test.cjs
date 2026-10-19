const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const read = file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
const models = vm.runInNewContext(stripTypeScriptTypes(read('services/api/runninghub-models.ts')).replace(/export /g, '') + ';RUNNINGHUB_MODELS');
const source = read('services/api/runninghub-image.ts');
const build = vm.runInNewContext(stripTypeScriptTypes(source.slice(source.indexOf('function mapAspectRatio'), source.indexOf('export type RunninghubImageRefs'))).replace(/export /g, '') + ';buildImagePayload', {
    findRunninghubImageParams: endpoint => models.find(m => m.name === endpoint)?.params || [],
    unpackQualityValue: value => { const [resolution, quality] = value.split('|'); return { resolution, quality }; },
    withSystemPrompt: (_, prompt) => prompt,
    isMidjourneyImageEndpoint: () => false,
});

for (const variant of ['flare', 'sunburst']) {
    test(`${variant}: stable text and economy edit keep separate parameters`, () => {
        const textEndpoint = `rhart-image-g-2.5-official-token/${variant}/text-to-image`;
        assert.ok(models.find(m => m.name === textEndpoint));
        const text = build(textEndpoint, '产品摄影', { size: '1:1', quality: '2k|high' }, []);
        assert.equal(text.quality, 'high');
        assert.equal(text.background, 'auto');
        assert.equal(text.imageUrls, undefined);
        const editEndpoint = `rhart-image-g-2.5/${variant}/image-to-image`;
        assert.equal(models.find(m => m.name === editEndpoint)?.maxImages, 10);
        const edit = build(editEndpoint, '修改颜色', { size: '1:1', quality: '1k|high' }, ['https://example.test/ref.png']);
        assert.equal(edit.imageUrls[0], 'https://example.test/ref.png');
        assert.equal(edit.quality, undefined);
        assert.equal(edit.background, undefined);
    });
    test(`${variant}: stable edit sends references, quality, resolution and transparent background`, () => {
        const endpoint = `rhart-image-g-2.5-official-token/${variant}/edit`;
        assert.equal(models.find(m => m.name === endpoint)?.maxImages, 16);
        const refs = Array.from({ length: 16 }, (_, i) => `https://example.test/${i}.png`);
        const payload = build(endpoint, '修改产品颜色', { size: '3:2', quality: '4k|max', background: 'transparent' }, refs);
        assert.deepEqual(JSON.parse(JSON.stringify(payload)), { prompt: '修改产品颜色', aspectRatio: '3:2', resolution: '4k', quality: 'max', background: 'transparent', outputFormat: 'png', imageUrls: refs });
    });
    test(`${variant}: economy text uses its own endpoint and does not send stable-only fields`, () => {
        const endpoint = `rhart-image-g-2.5/${variant}/text-to-image`;
        assert.ok(models.find(m => m.name === endpoint));
        const payload = build(endpoint, '产品摄影', { size: '16:9', quality: '2k|high', background: 'transparent' }, []);
        assert.deepEqual(JSON.parse(JSON.stringify(payload)), { prompt: '产品摄影', aspectRatio: '16:9', resolution: '2k' });
    });
}
