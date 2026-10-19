import assert from "node:assert/strict";
import test from "node:test";
import { watchCursorOutput } from "./cursor-output-watchdog.js";

test("Cursor 冷启动超过 20 秒不会被误杀，60 秒仍无输出才报启动超时", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const failures: string[] = [];
    const watchdog = watchCursorOutput((phase) => failures.push(phase));
    t.mock.timers.tick(25000);
    assert.deepEqual(failures, []);
    t.mock.timers.tick(35000);
    assert.deepEqual(failures, ["startup"]);
    watchdog.stop();
});

test("首个事件后独立等待回复，思考和工具活动会延长空闲期限", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const failures: string[] = [];
    const watchdog = watchCursorOutput((phase) => failures.push(phase));
    t.mock.timers.tick(50000);
    watchdog.activity();
    t.mock.timers.tick(70000);
    watchdog.activity();
    t.mock.timers.tick(70000);
    assert.deepEqual(failures, []);
    t.mock.timers.tick(5000);
    assert.deepEqual(failures, ["response"]);
});

test("回复完成或进程结束后不再触发超时", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const failures: string[] = [];
    const watchdog = watchCursorOutput((phase) => failures.push(phase));
    watchdog.activity();
    watchdog.stop();
    t.mock.timers.tick(120000);
    assert.deepEqual(failures, []);
});
