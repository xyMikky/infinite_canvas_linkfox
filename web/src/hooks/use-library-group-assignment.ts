import { useCallback } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";
import { ALL_LIBRARY_GROUPS, type LibraryScope } from "@/lib/library-groups";
import { useLibraryGroupStore } from "@/stores/use-library-group-store";

/** 内容已独立保存；分类失败只提示重新归类，不能让重试保存生成重复内容。 */
export function useLibraryGroupAssignment(scope: LibraryScope) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    return useCallback(async (keys: string[], groupId?: string) => {
        if (groupId === undefined || groupId === ALL_LIBRARY_GROUPS) return;
        try {
            const store = useLibraryGroupStore.getState();
            await store.moveItems(scope, keys, groupId);
            if (useLibraryGroupStore.getState().selected[scope] !== ALL_LIBRARY_GROUPS) store.select(scope, groupId);
        }
        catch {
            useLibraryGroupStore.getState().select(scope, ALL_LIBRARY_GROUPS);
            message.warning(t("libraryGroups.contentSaved"));
        }
    }, [message, scope, t]);
}
