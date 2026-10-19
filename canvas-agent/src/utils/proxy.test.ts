import assert from "node:assert/strict";
import test from "node:test";

import { applySystemProxyEnv, mergeNoProxy, normalizeProxyUrl, parseMacScutilProxy, parseWindowsProxyServer } from "./proxy.js";

test("normalizeProxyUrl 补 http 协议", () => {
    assert.equal(normalizeProxyUrl("127.0.0.1:7897"), "http://127.0.0.1:7897");
    assert.equal(normalizeProxyUrl("http://127.0.0.1:7890"), "http://127.0.0.1:7890");
    assert.equal(normalizeProxyUrl(""), "");
});

test("parseWindowsProxyServer 优先 https/http", () => {
    assert.equal(parseWindowsProxyServer("127.0.0.1:7897"), "http://127.0.0.1:7897");
    assert.equal(parseWindowsProxyServer("https=127.0.0.1:7897;http=127.0.0.1:7890"), "http://127.0.0.1:7897");
});

test("parseMacScutilProxy 读取开启的 HTTPS 代理", () => {
    const out = ["HTTPSEnable : 1", "HTTPSProxy : 127.0.0.1", "HTTPSPort : 7897", "HTTPEnable : 0"].join("\n");
    assert.equal(parseMacScutilProxy(out), "http://127.0.0.1:7897");
});

test("mergeNoProxy 补本机回环地址", () => {
    assert.equal(mergeNoProxy(""), "localhost,127.0.0.1,::1");
    assert.equal(mergeNoProxy("localhost,example.com"), "localhost,example.com,127.0.0.1,::1");
});

test("applySystemProxyEnv 保留已有代理并补 NO_PROXY", () => {
    const next = applySystemProxyEnv({ HTTPS_PROXY: "http://127.0.0.1:10808", FOO: "1" });
    assert.equal(next.HTTPS_PROXY, "http://127.0.0.1:10808");
    assert.equal(next.HTTP_PROXY, "http://127.0.0.1:10808");
    assert.equal(next.NO_PROXY, "localhost,127.0.0.1,::1");
    assert.equal(next.FOO, "1");
});
