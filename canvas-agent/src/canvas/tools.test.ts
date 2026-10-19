import assert from "node:assert/strict";
import test from "node:test";

import { defaultNodePosition, viewportWorldCenter } from "./tools.js";

test("viewportWorldCenter follows current viewport pan/zoom", () => {
    const state = {
        viewport: { x: 600, y: 400, k: 1 },
        viewportSize: { width: 1200, height: 800 },
        nodes: [{ id: "far", type: "text", position: { x: 5000, y: 0 }, width: 320, height: 240 }],
    };
    assert.deepEqual(viewportWorldCenter(state), { x: 0, y: 0 });
});

test("defaultNodePosition centers node box in viewport", () => {
    const state = {
        viewport: { x: 500, y: 300, k: 2 },
        viewportSize: { width: 1000, height: 600 },
        nodes: [],
    };
    assert.deepEqual(defaultNodePosition(state, 200, 100), { x: 50, y: 50 });
});
