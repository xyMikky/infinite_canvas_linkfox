import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { applyDesktopLanShare } from "@/lib/canvas/lan-share";
import { filterFavoriteModels, sanitizeAiConfig, useConfigStore, type AiConfig, type WebdavSyncConfig } from "@/stores/use-config-store";
import { sanitizePromptSources, usePromptSourceStore, type PromptSourceSchedule } from "@/stores/use-prompt-source-store";
import type { PromptSource } from "@/services/api/prompt-source-presets";

type AppConfigFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    config: AiConfig;
    webdav: WebdavSyncConfig;
    favoriteModels?: string[];
    promptSources: {
        sources: PromptSource[];
        schedule: PromptSourceSchedule;
    };
};

export function exportAppConfig() {
    const { config, webdav, favoriteModels } = useConfigStore.getState();
    const { sources, schedule } = usePromptSourceStore.getState();
    const data: AppConfigFile = {
        app: "infinite-canvas",
        version: 1,
        exportedAt: new Date().toISOString(),
        config: { ...config, lanShareEnabled: false },
        webdav,
        favoriteModels,
        promptSources: { sources, schedule },
    };
    saveAs(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), "infinite-canvas-config.json");
}

export async function importAppConfig(file: File) {
    let data: AppConfigFile;
    try {
        data = JSON.parse(await file.text()) as AppConfigFile;
    } catch {
        throw new Error(i18n.t("config.invalidFile"));
    }
    if (data.app !== "infinite-canvas" || data.version !== 1 || !data.config || !data.webdav || !data.promptSources) throw new Error(i18n.t("config.invalidFile"));
    const config = sanitizeAiConfig({ ...data.config, lanShareEnabled: false });
    useConfigStore.setState({
        config,
        webdav: data.webdav,
        favoriteModels: data.favoriteModels !== undefined ? filterFavoriteModels(data.favoriteModels, config.channels) : filterFavoriteModels(useConfigStore.getState().favoriteModels, config.channels),
    });
    void applyDesktopLanShare(false);
    // 旧配置文件可能还带着已移除的内置来源，导入时一并清掉
    usePromptSourceStore.setState({ sources: sanitizePromptSources(data.promptSources.sources), schedule: data.promptSources.schedule });
}
