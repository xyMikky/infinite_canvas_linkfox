const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const std = 'kling-video-o3-std/video-edit';
const pro = 'kling-video-o3-pro/video-edit';
const seedance = 'bytedance/seedance-2.0-global-fast/multimodal-video';
const modelOptionName = value => value.split('::').at(-1);
const decodeChannelModel = value => value.includes('::') ? { channelId: value.split('::')[0], model: modelOptionName(value) } : null;
const channel = { id: 'runninghub', apiFormat: 'runninghub', baseUrl: '/api/runninghub', apiKey: 'fixture-key', models: [std, pro].map(name => ({ name })) };
const config = (model = std) => ({ channels: [channel], model: `runninghub::${model}`, videoModel: `runninghub::${model}`, apiFormat: 'runninghub', baseUrl: channel.baseUrl, apiKey: channel.apiKey, videoSeconds: '5', videoGenerateAudio: 'true', systemPrompt: '', size: '16:9', modelParams: {} });
const video = { id: 'clip', name: 'clip.mp4', type: 'video/mp4', url: 'https://example.com/clip.mp4', durationMs: 3000 };
const reference = index => ({ id: `image-${index}`, url: `https://example.com/image-${index}.png`, name: `image-${index}.png` });

async function fixture() {
    const calls = [];
    const timers = { setTimeout: callback => setTimeout(callback, 0), clearTimeout };
    const context = vm.createContext({ URL, ...timers, window: timers, AbortController });
    const modules = new Map();
    const store = {
        modelOptionName, decodeChannelModel,
        resolveModelScript: value => value.testScript,
        resolveModelRequestConfig(value, model) {
            const decoded = decodeChannelModel(model);
            const selected = value.channels.find(item => decoded ? item.id === decoded.channelId : item.models.some(entry => entry.name === model)) || value.channels[0];
            return { ...value, ...selected, model: modelOptionName(model) };
        },
        isKlingModel: () => false, isDreaminaModel: () => false, resolveChannelModel: () => undefined,
    };
    const stubs = {
        '@/stores/use-config-store': store,
        '@/i18n': { default: { t: key => key } },
        '@/services/api/kling-cli': { klingArgumentsForTool: () => [] },
        '@/services/file-storage': { getMediaBlob: async () => null },
        '@/services/image-storage': { getImageBlob: async () => null, imageToDataUrl: async () => '' },
        axios: { default: { isCancel: () => false, isAxiosError: () => false, async post(url, payload) {
            calls.push({ url, payload: JSON.parse(JSON.stringify(payload)) });
            return { data: url.endsWith('/query') ? { status: 'SUCCESS', results: [{ url: 'https://example.com/result.mp4' }] } : { taskId: 'fixture-task', status: 'RUNNING' } };
        } } },
    };
    function moduleFor(name, parent) {
        const key = name.startsWith('.') ? path.resolve(path.dirname(parent.identifier), name + '.ts') : name;
        if (modules.has(key)) return modules.get(key);
        const stub = stubs[key];
        const filename = key.startsWith('@/') ? path.join(__dirname, '../src', key.slice(2) + '.ts') : key;
        const mod = stub ? new vm.SyntheticModule(Object.keys(stub), function () { for (const [name, value] of Object.entries(stub)) this.setExport(name, value); }, { context })
            : new vm.SourceTextModule(stripTypeScriptTypes(fs.readFileSync(filename, 'utf8')), { context, identifier: filename });
        modules.set(key, mod);
        return mod;
    }
    return { calls, async load(name) {
        const mod = moduleFor(name);
        if (mod.status === 'unlinked') await mod.link(moduleFor);
        if (mod.status !== 'evaluated') await mod.evaluate();
        return mod.namespace;
    } };
}

test('O3 edits send one video and all four images without generation duration or aspect controls', async () => {
    for (const endpoint of [std, pro]) {
        const f = await fixture();
        const api = await f.load('@/services/api/runninghub-video');
        const result = await api.requestRunninghubVideo({ ...config(endpoint), videoSeconds: '3', videoGenerateAudio: 'false' }, '替换衣服', [1, 2, 3, 4].map(reference), [video]);
        assert.equal(result.url, 'https://example.com/result.mp4');
        assert.deepEqual(f.calls[0], { url: `/api/runninghub/${endpoint}`, payload: { prompt: '替换衣服', videoUrl: video.url, imageUrls: [1, 2, 3, 4].map(index => reference(index).url), keepOriginalSound: false } });
    }
});

test('video edits reject missing or extra videos, excess images and audio before submitting', async () => {
    const f = await fixture();
    const api = await f.load('@/services/api/runninghub-video');
    for (const [images, videos, audios] of [[[], [], []], [[], [video, video], []], [[1, 2, 3, 4, 5].map(reference), [video], []], [[], [video], [{ id: 'audio', url: 'https://example.com/audio.mp3' }]]]) {
        await assert.rejects(api.requestRunninghubVideo(config(), '编辑', images, videos, audios));
    }
    assert.equal(f.calls.length, 0);
});

test('ordinary Kling generation still refuses video and audio references', async () => {
    const f = await fixture();
    const api = await f.load('@/services/api/runninghub-video');
    await assert.rejects(api.requestRunninghubVideo(config('kling-video-o3-std/text-to-video'), '编辑', [], [video]));
    assert.equal(f.calls.length, 0);
});

test('edits without images preserve input length and unreadable images never disappear from a paid request', async () => {
    const f = await fixture();
    const api = await f.load('@/services/api/runninghub-video');
    await api.requestRunninghubVideo({ ...config(), videoSeconds: '15' }, '编辑', [], [{ ...video, durationMs: 15000 }]);
    assert.deepEqual(f.calls[0].payload, { prompt: '编辑', videoUrl: video.url, keepOriginalSound: true });
    const count = f.calls.length;
    await assert.rejects(api.requestRunninghubVideo(config(), '编辑', [{ id: 'missing', storageKey: 'missing' }], [video]), /参考图读取失败/);
    assert.equal(f.calls.length, count);
});

test('local edit config preserves channel and exact prepared duration while disabling generated sound', async () => {
    const f = await fixture();
    const api = await f.load('@/lib/canvas/video-local-edit-model');
    for (const seconds of [3, 8, 15]) {
        const source = config();
        const result = api.resolveVideoLocalEditConfig(source, seconds);
        assert.equal(result.model, source.model);
        assert.equal(result.videoSeconds, String(seconds));
        assert.equal(result.videoGenerateAudio, 'false');
        assert.equal(source.videoGenerateAudio, 'true');
    }
    for (const seconds of [0, 1, 2, 3.5, 16, NaN]) assert.throws(() => api.resolveVideoLocalEditConfig(config(), seconds), /3.*15|整数/);
    assert.throws(() => api.resolveVideoLocalEditConfig(config('kling-video-o3-std/text-to-video'), 3), /视频编辑/);
    assert.throws(() => api.resolveVideoLocalEditConfig({ ...config(), channels: [{ ...channel, apiFormat: 'openai' }] }, 3), /RunningHub/);
    assert.throws(() => api.resolveVideoLocalEditConfig({ ...config(), model: `missing::${std}` }, 3), /渠道/);
    assert.throws(() => api.resolveVideoLocalEditConfig({ ...config(), testScript: 'custom request' }, 3), /脚本/);
});

test('video editing workbenches require one video and allow at most four optional images without audio', async () => {
    const f = await fixture();
    const api = await f.load('@/lib/canvas/model-input-spec');
    for (const endpoint of [std, pro]) {
        assert.deepEqual(JSON.parse(JSON.stringify(api.resolveModelInputSpec(config(endpoint), 'video'))), { prompt: true, images: { min: 0, max: 4 }, videos: { min: 1, max: 1 } });
    }
});

test('local editing defaults to Seedance Fast and sends prepared video plus images through multimodal API', async () => {
    const f = await fixture();
    const models = await f.load('@/lib/canvas/video-local-edit-model');
    assert.equal(models.LOCAL_VIDEO_EDIT_MODEL, `runninghub::${seedance}`);
    assert.equal(models.isVideoLocalEditModel(`runninghub::${seedance}`), true);
    assert.equal(models.isRunninghubVideoEditModel(seedance), false);
    assert.equal(models.isVideoLocalEditModel('bytedance/seedance-2.0-global-fast/text-to-video'), false);
    const resolved = models.resolveVideoLocalEditConfig({ ...config(seedance), vquality: "1080" }, 15);
    assert.equal(resolved.size, 'adaptive');
    assert.equal(resolved.videoSeconds, '15');
    const api = await f.load('@/services/api/runninghub-video');
    await api.requestRunninghubVideo(resolved, '编辑局部视频', [reference(1)], [{ ...video, durationMs: 15000 }]);
    const { url, payload } = f.calls[0];
    assert.equal(url, `/api/runninghub/${seedance}`);
    assert.deepEqual(payload.videoUrls, [video.url]);
    assert.deepEqual(payload.imageUrls, [reference(1).url]);
    assert.equal(payload.duration, '15');
    assert.equal(payload.ratio, 'adaptive');
    assert.equal(payload.resolution, '1080p');
    assert.equal(payload.generateAudio, false);
    assert.equal(payload.videoUrl, undefined);
    assert.equal(payload.keepOriginalSound, undefined);
});
