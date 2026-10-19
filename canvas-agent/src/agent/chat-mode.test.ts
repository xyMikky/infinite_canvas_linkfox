import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { lightweightCodexConfig, cursorTurnPrompt, withSelectedSkill } from "./chat-mode.js";
import { CanvasSession } from "../canvas/session.js";
import { CodexAppClient } from "./codex-client.js";

test("轻量 Codex 禁用自动指令、技能、插件及已有 MCP，不改原配置", () => {
    const original = { mcp_servers: { custom: { command: "server", enabled: true } }, plugins: { custom: { enabled: true } } };
    const result = lightweightCodexConfig(original, ["/skills/demo/SKILL.md"]);
    assert.equal(result.project_doc_max_bytes, 0);
    assert.equal(result.skills.include_instructions, false);
    assert.deepEqual(result.skills.config, [{ path: "/skills/demo/SKILL.md", enabled: false }]);
    assert.equal(result.mcp_servers.custom.enabled, false);
    assert.equal(result.mcp_servers["infinite-canvas"].enabled, false);
    assert.equal(result.plugins.custom.enabled, false);
    assert.equal(original.mcp_servers.custom.enabled, true);
});

test("Cursor 轻量消息只含用户输入，执行和规划保留画布指令", () => {
    assert.equal(cursorTurnPrompt("你好", "chat"), "你好");
    assert.match(cursorTurnPrompt("你好", "default"), /Infinite Canvas/);
    assert.match(cursorTurnPrompt("你好", "plan"), /Infinite Canvas/);
});

test("只发送手动选中的 Skill，不读同目录其它文件", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "canvas-chat-skill-"));
    try {
        const file = path.join(dir, "SKILL.md");
        writeFileSync(file, "仅手动选择时使用的指令");
        writeFileSync(path.join(dir, "AGENTS.md"), "不应该发送的预设");
        assert.equal(withSelectedSkill("你好"), "你好");
        const prompt = withSelectedSkill("你好", { name: "demo", path: file });
        assert.match(prompt, /仅手动选择时使用的指令/);
        assert.doesNotMatch(prompt, /不应该发送的预设/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("轻量会话无需 MCP 即可发送，不改变其他所有者的初始化状态", () => {
    const session = new CanvasSession();
    session.beginConversation("chat-owner");
    session.beginConversation("canvas-owner");
    session.completeConversationPreparation("chat-owner", "chat-thread", false);
    assert.equal(session.conversationSnapshot("chat-owner").status, "ready");
    assert.deepEqual(session.conversationSnapshot("chat-owner").mcpStatuses, {});
    assert.equal(session.conversationSnapshot("canvas-owner").status, "preparing");
});

test("Codex 创建轻量线程发送隔离配置，并跳过 MCP 预热", async () => {
    const requests: Array<{ method: string; params: any }> = [];
    const client = Reflect.construct(CodexAppClient, [{}, () => undefined]) as CodexAppClient;
    const internal = client as any;
    internal.request = async (method: string, params: any) => {
        requests.push({ method, params });
        if (method === "config/read") return { config: { mcp_servers: { external: { command: "external-mcp" } } } };
        if (method === "skills/list") return { data: [{ skills: [{ name: "automatic", path: "/skills/automatic/SKILL.md" }] }] };
        if (method === "thread/start") return { thread: { id: "light-test", cwd: "/workspace" } };
        throw new Error(`不应预热 MCP：${method}`);
    };
    await client.startThread("/workspace", "request", true, "chat");
    const config = requests.find((item) => item.method === "thread/start")!.params.config;
    assert.equal(config.mcp_servers.external.enabled, false);
    assert.equal(config.mcp_servers["infinite-canvas"].enabled, false);
    assert.equal(config.project_doc_max_bytes, 0);
    assert.equal(config.skills.config[0].enabled, false);
});
