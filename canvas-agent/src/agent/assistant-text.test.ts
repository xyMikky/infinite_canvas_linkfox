import assert from "node:assert/strict";
import test from "node:test";
import { mergeAssistantText } from "./assistant-text.js";

test("已标记的增量保留换行、重复字词和长片段，不猜测快照", () => {
    const pieces = ["优化：\n\n> 高端", "产品", "摄影", "\n\n", "哈哈", "哈哈", "super", "market", "，采用柔和侧光和简洁背景，完整保留产品结构、色彩、标签与品牌文字。"];
    let text = "";
    for (let index = 0; index < pieces.length; index++) {
        text = mergeAssistantText(text, pieces[index], "delta");
        assert.equal(text, pieces.slice(0, index + 1).join(""));
    }
});
