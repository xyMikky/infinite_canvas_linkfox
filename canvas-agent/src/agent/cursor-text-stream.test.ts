import assert from "node:assert/strict";
import test from "node:test";
import { CursorTextStream } from "./cursor-text-stream.js";

const assistant = (text: string, extra: Record<string, unknown> = { timestamp_ms: 1 }) => ({ type: "assistant", message: { content: [{ type: "text", text }] }, ...extra });

test("多行提示词逐片段增长，不等最终 result 才补全文", () => {
    const stream = new CursorTextStream();
    const pieces = ["一致性。\n\n优化：\n\n> 高端", "产品摄影", "，保留包装", "和品牌文字", "\n\n", "柔和光线", "哈哈", "哈哈", "super", "market"];
    pieces.forEach((piece, index) => assert.equal(stream.push(assistant(piece)), pieces.slice(0, index).join("")));
    const full = pieces.join("");
    assert.equal(stream.push(assistant(full, {})), full);
    assert.equal(stream.push({ type: "result", result: full }), full);
});

test("工具调用前的段落回执不重复拼接，后续增量继续增长", () => {
    const stream = new CursorTextStream();
    stream.push(assistant("先查看\n"));
    stream.push(assistant("图片。"));
    assert.equal(stream.push(assistant("先查看\n图片。", { timestamp_ms: 2, model_call_id: "call-1" })), "先查看\n图片。");
    stream.push({ type: "tool_call", subtype: "started" });
    stream.push(assistant("建议：\n"));
    assert.equal(stream.push(assistant("优化灯光")), "先查看\n图片。建议：\n");
    assert.equal(stream.push(assistant("建议：\n优化灯光", {})), "先查看\n图片。建议：\n优化灯光");
});

test("重试回执与合法重复短 token 可以区分", () => {
    const stream = new CursorTextStream();
    stream.push(assistant("哈"));
    stream.push(assistant("哈"));
    stream.push(assistant("哈哈"));
    assert.equal(stream.push({ type: "retry", subtype: "started" }), "哈哈");
    stream.push(assistant("继续"));
    assert.equal(stream.finish(), "哈哈继续");
    assert.equal(stream.finish(), "哈哈继续");
});

test("最终修订快照覆盖正文，不把两份草稿接起来", () => {
    const stream = new CursorTextStream();
    stream.push(assistant("初稿"));
    assert.equal(stream.push({ type: "result", result: "最终稿\n第二段" }), "最终稿\n第二段");
    assert.equal(stream.finish(), "最终稿\n第二段");
});
