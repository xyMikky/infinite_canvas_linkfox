import React, { type ComponentType } from "react";
import { transform } from "sucrase";

import { cursorCanvasApi } from "@/lib/canvas/cursor-canvas-sdk";

const ALLOWED_MODULE = "infinite-canvas";
/** 旧产物用的历史模块名，继续兼容渲染 */
const LEGACY_MODULE = "cursor/canvas";
const canvasModule = new Proxy({ ...cursorCanvasApi, __esModule: true, default: cursorCanvasApi }, {
    get: (target, prop, receiver) => prop in target ? Reflect.get(target, prop, receiver) : Reflect.get(cursorCanvasApi, prop),
});
// 给源码中带 React 事件的 DOM 加标记，展开时保留事件所属的活组件。
const canvasReact = {
    ...React,
    createElement: new Proxy(React.createElement, {
        apply(target, thisArg, [type, props, ...children]) {
            const interactive = typeof type === "string" && props && Object.entries(props).some(([key, value]) => /^on[A-Z]/.test(key) && typeof value === "function");
            return Reflect.apply(target, thisArg, [type, interactive ? { ...props, "data-canvas-live": true } : props, ...children]);
        },
    }),
};
// 只缓存转译后的工厂；每次预览独立执行模块，避免不同节点共享模块级变量。
const factoryCache = new Map<string, Function>();
const MAX_CACHED_SOURCES = 12;
const MAX_CACHED_SOURCE_LENGTH = 500_000;

export type CompileCanvasResult =
    | { ok: true; Component: ComponentType }
    | { ok: false; error: string };

// 仅为格式约束，同文档执行不构成安全沙箱。
function assertSupportedSource(source: string) {
    if (/\bfetch\s*\(/.test(source)) throw new Error("禁止使用 fetch()");
    if (/\bimport\s*\(/.test(source)) throw new Error("禁止动态 import()");
    if (/\brequire\s*\(/.test(source)) throw new Error("禁止使用 require()");
}

function requireCanvasModule(name: string) {
    if (name !== ALLOWED_MODULE && name !== LEGACY_MODULE) throw new Error(`仅允许从 "${ALLOWED_MODULE}" 导入，收到: ${name}`);
    return canvasModule;
}

export function compileCursorCanvasSource(source: string): CompileCanvasResult {
    try {
        const trimmed = source.trim();
        if (!trimmed) return { ok: false, error: "空的 .canvas.tsx" };
        let factory = factoryCache.get(trimmed);
        if (factory) factoryCache.delete(trimmed);
        else {
            assertSupportedSource(trimmed);
            const { code } = transform(trimmed, {
                transforms: ["typescript", "jsx", "imports"],
                production: true,
                jsxRuntime: "classic",
            });
            factory = new Function("React", "require", "exports", "module", `${code}\n;return exports.default;`);
        }
        if (trimmed.length <= MAX_CACHED_SOURCE_LENGTH) {
            factoryCache.set(trimmed, factory);
            if (factoryCache.size > MAX_CACHED_SOURCES) factoryCache.delete(factoryCache.keys().next().value!);
        }
        const module = { exports: {} as { default?: ComponentType } };
        const exports = module.exports;
        const Component = factory(canvasReact, requireCanvasModule, exports, module) as ComponentType | undefined;
        if (typeof Component !== "function") {
            return { ok: false, error: "缺少 default export 组件" };
        }
        return { ok: true, Component };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: message };
    }
}
