const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const source = fs.readFileSync(path.join(__dirname, '../src/components/agent/local-agent-panel.tsx'), 'utf8').replaceAll('\r\n', '\n');
const start = source.indexOf('    useEffect(() => {\n        if (!clientReady');
const end = source.indexOf('\n    }, [', start);
const effect = source.slice(start + '    useEffect(() => '.length, end) + '\n    }';
const turn = () => new Promise(resolve => setImmediate(resolve));
const conversation = (threadId = '', status = 'idle') => ({ revision: 1, conversationId: threadId, threadId, status, mcpStatuses: {} });

function fixture(cursor = conversation(), provider = 'cursor') {
    const state = { agentProvider: provider, enabled: true, connected: false, messages: [], pendingApprovals: [], conversation: conversation(), activeThreadId: '', silentConnect: false };
    const calls = [], errors = [], sources = [], timers = new Map();
    let timerId = 0, attempts = 0;
    const noop = () => {};
    const ref = value => ({ current: value });
    const context = {
        URL, AbortSignal, Error, console, clientReady: true, enabled: true, token: 'fixture-token', endpoint: 'http://127.0.0.1:17371',
        agentProvider: provider, connectionAttempt: 0, permissionMode: 'request', headless: true,
        localStorage: { setItem: noop }, searchParams: new URLSearchParams(),
        document: { visibilityState: 'hidden', hasFocus: () => false },
        window: { setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } },
        useAgentStore: { getState: () => state }, setAgentState: patch => Object.assign(state, patch),
        useAgentSkillStore: { getState: () => ({ reset: noop }) }, useConfigStore: { getState: () => ({ config: {} }) },
        currentProvider: () => state.agentProvider, agentOwnerId: () => 'host',
        resolveAgentEndpointForPage: value => value,
        setConnectionAttempt: update => { attempts = update(attempts); },
        clientIdRef: ref('fixture-client'), connectedRef: ref(false), errorLoggedRef: ref(false),
        liveTurnKeysRef: ref(new Set()), canvasContextRef: ref(null), pendingToolRef: ref(null), loadThreadsSequenceRef: ref(0),
        parseEventData: event => JSON.parse(event.data), AGENT_PROTOCOL_VERSION: 8,
        rt: key => key, addEventLog: (...args) => errors.push(args), message: { error: noop, success: noop },
        shouldApplyEngineEvent: id => provider === 'cursor' ? Boolean(id?.startsWith('cursor:')) : !id?.startsWith('cursor:'),
        applyConversationState: next => Object.assign(state, { conversation: next, activeThreadId: next.threadId }),
        cursorInitFailedConversation: error => ({ ...conversation('', 'failed'), error: error.message }),
        applyWorkspaceChange: patch => Object.assign(state, patch), isConnectionErrorMessage: () => false,
        bindPendingTurnMessages: messages => messages,
        persistAgentIoDirs: async () => ({}), postState: noop, activateAgentClient: noop,
        agentEnginePath: (provider, suffix) => `/agent/${provider}${suffix}`,
        fetchAgentJson: async (_endpoint, _token, route) => {
            calls.push(route);
            if (cursor instanceof Error) throw cursor;
            return { ok: true, conversation: route.endsWith('/threads/reset') ? conversation('cursor:new', 'ready') : cursor };
        },
        EventSource: class {
            listeners = new Map(); closed = false;
            constructor(url) { this.url = url; sources.push(this); }
            addEventListener(name, callback) { this.listeners.set(name, callback); }
            close() { this.closed = true; }
            emit(name, data) { this.listeners.get(name)?.({ data: JSON.stringify(data) }); }
        },
    };
    vm.createContext(context);
    const cleanup = vm.runInContext(stripTypeScriptTypes(`(function () ${effect})()`), context);
    return { state, calls, errors, sources, timers, context, cleanup, get attempts() { return attempts; } };
}

const codexHello = { protocolVersion: 8, conversation: conversation('old-codex', 'ready'), workspace: { activeThreadId: 'old-codex' }, codex: { busy: false, threadId: 'old-codex' } };

test('Cursor creates its own draft when the shared hello contains an old ready Codex thread', async () => {
    const f = fixture();
    try {
        f.sources[0].emit('hello', codexHello);
        await turn();
        assert.deepEqual(f.calls, ['/agent/cursor/workspace', '/agent/cursor/threads/reset']);
        assert.equal(f.state.activeThreadId, 'cursor:new');
        assert.equal(f.state.connected, true);
        assert.equal(f.state.conversation.status, 'ready');
    } finally { f.cleanup(); }
});

test('Cursor reconnect reuses its ready thread even when Codex is busy', async () => {
    const f = fixture(conversation('cursor:existing', 'ready'));
    try {
        f.sources[0].emit('hello', { ...codexHello, codex: { busy: true, threadId: 'old-codex', turnId: 'other-turn' } });
        await turn();
        assert.equal(f.state.activeThreadId, 'cursor:existing');
        assert.equal(f.state.waiting, false);
        assert.deepEqual(f.calls, ['/agent/cursor/workspace']);
    } finally { f.cleanup(); }
});

test('a missing hello times out and releases the connection for retry', () => {
    const f = fixture();
    try {
        assert.ok(f.timers.size > 0, 'connection needs a handshake deadline');
        [...f.timers.values()][0]();
        assert.equal(f.state.enabled, false);
        assert.equal(f.state.connected, false);
        assert.equal(f.sources[0].closed, true);
        assert.ok(f.state.connectError);
        assert.equal(f.state.bootstrapStatus, null);
    } finally { f.cleanup(); }
});

test('Cursor state lookup failure becomes a visible connection error', async () => {
    const f = fixture(new Error('local Agent unavailable'));
    try {
        f.sources[0].emit('hello', codexHello);
        await turn();
        assert.equal(f.state.enabled, false);
        assert.match(f.state.connectError, /local Agent unavailable/);
    } finally { f.cleanup(); }
});

test('late handshake after disconnect cannot create a draft or overwrite state', async () => {
    const f = fixture();
    let resolve;
    f.context.fetchAgentJson = () => new Promise(done => { resolve = done; });
    f.sources[0].emit('hello', codexHello);
    await turn();
    f.cleanup();
    resolve?.({ conversation: conversation() });
    await turn();
    assert.equal(f.state.connected, false);
    assert.equal(f.state.activeThreadId, '');
});

test('one-click retry with unchanged address and token requests a new SSE connection', async () => {
    const f = fixture();
    try {
        const begin = source.indexOf('    const toggleAgentConnection = async');
        const finish = source.indexOf('\n    const startDirectAgent = ', begin);
        vm.runInContext(stripTypeScriptTypes(source.slice(begin, finish) + '\nglobalThis.toggle = toggleAgentConnection;'), f.context);
        await f.context.toggle({ forceUrl: f.context.endpoint, forceToken: f.context.token, silent: true });
        assert.equal(f.attempts, 1);
        assert.match(source.slice(end, source.indexOf(']);', end) + 3), /connectionAttempt/);
        assert.match(source.slice(end, source.indexOf(']);', end) + 3), /agentProvider/);
    } finally { f.cleanup(); }
});

test('Codex still restores its own active turn directly from hello', async () => {
    const f = fixture(conversation(), 'codex');
    try {
        f.sources[0].emit('hello', { ...codexHello, codex: { busy: true, threadId: 'old-codex', turnId: 'active-turn' } });
        await turn();
        assert.equal(f.state.connected, true);
        assert.equal(f.state.waiting, true);
        assert.equal(f.state.activeThreadId, 'old-codex');
        assert.equal(f.state.activeTurnId, 'active-turn');
        assert.deepEqual(f.calls, []);
        assert.equal(f.timers.size, 0);
    } finally { f.cleanup(); }
});

test('switching engines discards an unfinished Cursor draft response', async () => {
    const f = fixture();
    let resolve;
    const fetch = f.context.fetchAgentJson;
    f.context.fetchAgentJson = (...args) => args[2].endsWith('/threads/reset') ? new Promise(done => { resolve = done; }) : fetch(...args);
    try {
        f.sources[0].emit('hello', codexHello);
        await turn();
        f.state.agentProvider = 'codex';
        f.state.activeThreadId = 'codex-current';
        resolve({ conversation: conversation('cursor:late', 'ready') });
        await turn();
        assert.equal(f.state.activeThreadId, 'codex-current');
    } finally { f.cleanup(); }
});
