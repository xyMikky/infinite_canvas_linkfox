const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

async function model() {
    const context = vm.createContext({});
    const source = fs.readFileSync(path.join(__dirname, '../src/lib/library-groups.ts'), 'utf8');
    const mod = new vm.SourceTextModule(stripTypeScriptTypes(source), { context });
    await mod.link(() => new vm.SyntheticModule(['default'], function () { this.setExport('default', { t: key => key }); }, { context }));
    await mod.evaluate();
    return mod.namespace;
}

test('creates independent groups, trims names and keeps source records untouched', async () => {
    const m = await model();
    const original = m.emptyLibraryGroups();
    const next = m.applyLibraryGroupAction(original, 'assets', { type: 'create', id: 'a', name: ' 产品图 ' });
    assert.equal(next.assets.groups[0]?.name, '产品图');
    assert.equal(original.assets.groups.length, 0);
    assert.equal(next.prompts, original.prompts);
});

test('rejects empty and duplicate names, while another library may reuse a name', async () => {
    const m = await model();
    const data = m.applyLibraryGroupAction(m.emptyLibraryGroups(), 'assets', { type: 'create', id: 'a', name: 'Product' });
    assert.throws(() => m.applyLibraryGroupAction(data, 'assets', { type: 'create', id: 'b', name: ' product ' }), /duplicate/);
    assert.throws(() => m.applyLibraryGroupAction(data, 'assets', { type: 'create', id: 'b', name: '  ' }), /nameRequired/);
    assert.equal(m.applyLibraryGroupAction(data, 'prompts', { type: 'create', id: 'b', name: 'Product' }).prompts.groups.length, 1);
});

test('batch moves and renames preserve membership, removing a group returns items to ungrouped', async () => {
    const m = await model();
    let data = m.applyLibraryGroupAction(m.emptyLibraryGroups(), 'assets', { type: 'create', id: 'a', name: '素材' });
    data = m.applyLibraryGroupAction(data, 'assets', { type: 'move', keys: ['img1', 'img2'], groupId: 'a' });
    data = m.applyLibraryGroupAction(data, 'assets', { type: 'rename', id: 'a', name: '产品' });
    assert.equal(data.assets.members.img1, 'a');
    assert.equal(m.matchesLibraryGroup(data.assets, 'img2', 'a'), true);
    data = m.applyLibraryGroupAction(data, 'assets', { type: 'remove', id: 'a' });
    assert.equal(Object.keys(data.assets.members).length, 0);
    assert.equal(m.matchesLibraryGroup(data.assets, 'img1', ''), true);
});

test('moving to a missing group or renaming a deleted group fails without orphaning items', async () => {
    const m = await model();
    const data = m.emptyLibraryGroups();
    assert.throws(() => m.applyLibraryGroupAction(data, 'assets', { type: 'move', keys: ['img'], groupId: 'gone' }), /missing/);
    assert.throws(() => m.applyLibraryGroupAction(data, 'assets', { type: 'rename', id: 'gone', name: 'new' }), /missing/);
    assert.equal(Object.keys(data.assets.members).length, 0);
});

test('prompt identities include source, and returning one prompt to ungrouped preserves others', async () => {
    const m = await model();
    const local = m.promptGroupKey({ sourceId: 'local', id: 'same' });
    const remote = m.promptGroupKey({ sourceId: 'remote', id: 'same' });
    assert.notEqual(local, remote);
    let data = m.applyLibraryGroupAction(m.emptyLibraryGroups(), 'prompts', { type: 'create', id: 'a', name: '常用' });
    data = m.applyLibraryGroupAction(data, 'prompts', { type: 'move', keys: [local, remote], groupId: 'a' });
    data = m.applyLibraryGroupAction(data, 'prompts', { type: 'move', keys: [local], groupId: '' });
    assert.equal(m.matchesLibraryGroup(data.prompts, local, ''), true);
    assert.equal(m.matchesLibraryGroup(data.prompts, remote, 'a'), true);
    assert.equal(m.matchesLibraryGroup(data.prompts, remote, 'all'), true);
});

test('missing storage starts empty; invalid stored data is rejected instead of silently cleared', async () => {
    const m = await model();
    assert.equal(m.readLibraryGroups(null).assets.groups.length, 0);
    assert.throws(() => m.readLibraryGroups({ assets: [], prompts: [] }), /readFailed/);
    const broken = m.emptyLibraryGroups();
    broken.assets.members.img = 'missing';
    assert.throws(() => m.readLibraryGroups(broken), /readFailed/);
});

test('numbered source IDs follow content instead of transferring a group when the source is reordered', async () => {
    const m = await model();
    const before = m.promptGroupKey({ sourceId: 'feed', id: 'feed-0001', title: '产品图', prompt: '白底产品图' });
    const reordered = m.promptGroupKey({ sourceId: 'feed', id: 'feed-0012', title: '产品图', prompt: '白底产品图' });
    const inserted = m.promptGroupKey({ sourceId: 'feed', id: 'feed-0001', title: '新内容', prompt: '人像' });
    assert.equal(before, reordered);
    assert.notEqual(before, inserted);
});

test('numbered prompts with the same text but different covers or references remain independently grouped', async () => {
    const m = await model();
    const base = { sourceId: 'feed', id: 'feed-0001', title: '产品图', prompt: '白底产品图' };
    const first = m.promptGroupKey({ ...base, coverUrl: 'https://example.com/one.png' });
    const second = m.promptGroupKey({ ...base, id: 'feed-0002', coverUrl: 'https://example.com/two.png' });
    const reference = m.promptGroupKey({ ...base, coverUrl: 'https://example.com/one.png', referenceImageUrls: ['https://example.com/reference.png'] });
    assert.notEqual(first, second);
    assert.notEqual(first, reference);
    let data = m.applyLibraryGroupAction(m.emptyLibraryGroups(), 'prompts', { type: 'create', id: 'a', name: '一组' });
    data = m.applyLibraryGroupAction(data, 'prompts', { type: 'move', keys: [first], groupId: 'a' });
    assert.equal(m.matchesLibraryGroup(data.prompts, second, ''), true);
});
