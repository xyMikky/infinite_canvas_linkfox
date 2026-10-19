import { createContext, useCallback, useContext, useState, type ContextType, type ReactNode } from "react";

import { buildTokens, canvasPaletteDark, canvasPaletteLight, categoryPaletteLight, type CanvasPalette, type CanvasTokens } from "./tokens";

export type CanvasHostTheme = CanvasTokens & {
    kind: "dark" | "light";
    tokens: CanvasTokens;
    palette: CanvasPalette;
};

const darkTheme: CanvasHostTheme = (() => {
    const tokens = buildTokens(canvasPaletteDark);
    return { ...tokens, kind: "dark" as const, tokens, palette: canvasPaletteDark };
})();

const ThemeContext = createContext<CanvasHostTheme>(darkTheme);
const lightTokens = buildTokens(canvasPaletteLight, categoryPaletteLight);
const lightTheme: CanvasHostTheme = { ...lightTokens, kind: "light", tokens: lightTokens, palette: canvasPaletteLight };
const StateContext = createContext<{
    values: Record<string, unknown>;
    update: (key: string, action: (previous: unknown) => unknown) => void;
} | null>(null);
const ActionContext = createContext<{
    type: "none" | "canvas";
    focusNode: (id: string) => void;
    previewNode: (id: string) => void;
    selectNodes: (ids: string[]) => void;
}>({ type: "none", focusNode: () => {}, previewNode: () => {}, selectNodes: () => {} });

// 无宿主依赖；离线报告与画布共用 SDK，仅注入各自的状态与动作。
export function CanvasRuntimeProvider({ children, kind, state = null, actions }: {
    children: ReactNode;
    kind: "light" | "dark";
    state?: ContextType<typeof StateContext>;
    actions?: ContextType<typeof ActionContext>;
}) {
    return <ThemeContext.Provider value={kind === "light" ? lightTheme : darkTheme}>
        <StateContext.Provider value={state}>
            {actions ? <ActionContext.Provider value={actions}>{children}</ActionContext.Provider> : children}
        </StateContext.Provider>
    </ThemeContext.Provider>;
}

export function useHostTheme(): CanvasHostTheme {
    return useContext(ThemeContext);
}

export function useCanvasState<T>(key: string, initial: T): [T, (action: T | ((prev: T) => T)) => void] {
    const state = useContext(StateContext);
    const [local, setLocal] = useState(initial);
    const setValue = useCallback((action: T | ((prev: T) => T)) => {
        if (!state) return setLocal(action);
        state.update(key, (previous) => {
            const value = previous === undefined ? local : previous as T;
            return typeof action === "function" ? (action as (prev: T) => T)(value) : action;
        });
    }, [state, key, local]);
    return [state && Object.hasOwn(state.values, key) ? state.values[key] as T : local, setValue];
}

export function useCanvasAction() {
    return useContext(ActionContext);
}

export { buildTokens, canvasPaletteDark, canvasPaletteLight };
export type { CanvasPalette, CanvasTokens };
