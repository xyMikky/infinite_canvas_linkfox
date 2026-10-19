import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";

import { LINKFOX_BASE_URL, useConfigStore } from "@/stores/use-config-store";
import { CanvasStorageNotice } from "@/components/canvas/canvas-storage-notice";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const handledConfigParams = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        if (!apiKey) return;
        handledConfigParams.current = true;
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        updateConfig(
            "channels",
            config.channels.map((channel) => (channel.apiFormat === "linkfox" ? { ...channel, apiKey, baseUrl: LINKFOX_BASE_URL, apiFormat: "linkfox" as const } : channel)),
        );
        updateConfig("apiKey", apiKey);
        updateConfig("baseUrl", LINKFOX_BASE_URL);
        updateConfig("apiFormat", "linkfox");
        openConfigDialog(false);
        message.success(t("config.importedDirectConfig"));
    }, [config.channels, message, openConfigDialog, t, updateConfig]);

    return <>{children}<CanvasStorageNotice /></>;
}
