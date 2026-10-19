import { useCallback, useMemo, useState } from "react";
import { App } from "antd";
import { useTranslation } from "react-i18next";
import { APP_RELEASES, APP_RELEASES_PAGE, APP_VERSION } from "@/constant/env";
import { compareVersion, normalizeVersion, type ReleaseInfo } from "@/lib/release";
import { fetchLatestGithubRelease } from "@/services/api/github-releases";

function openExternalUrl(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
}

export function useVersionCheck() {
    const { t } = useTranslation();
    const currentVersion = normalizeVersion(APP_VERSION);
    const { message } = App.useApp();
    const localReleases = useMemo(() => APP_RELEASES, []);
    const [latestVersion, setLatestVersion] = useState("");
    const [releases, setReleases] = useState<ReleaseInfo[]>(localReleases);
    const [downloadUrl, setDownloadUrl] = useState(APP_RELEASES_PAGE);
    const [checking, setChecking] = useState(false);
    const [open, setOpen] = useState(false);
    const [hasNewVersion, setHasNewVersion] = useState(false);

    const checkLatestRelease = useCallback(
        async (showMessage = false) => {
            setChecking(true);
            try {
                const remote = await fetchLatestGithubRelease();
                const newer = compareVersion(remote.version, currentVersion) > 0;
                setLatestVersion(remote.version);
                setDownloadUrl(remote.downloadUrl || remote.releaseUrl);
                setHasNewVersion(newer);
                const byVersion = new Map<string, ReleaseInfo>();
                for (const item of localReleases) byVersion.set(normalizeVersion(item.version), item);
                for (const item of remote.releases?.length ? remote.releases : [remote.release]) {
                    const key = normalizeVersion(item.version);
                    if (key) byVersion.set(key, item);
                }
                setReleases([...byVersion.values()].sort((a, b) => compareVersion(b.version, a.version)));
                if (showMessage) {
                    message.success(newer ? t("version.newVersionFound", { version: remote.version }) : t("version.upToDate"));
                }
                return true;
            } catch {
                setLatestVersion("");
                setReleases(localReleases);
                setDownloadUrl(APP_RELEASES_PAGE);
                setHasNewVersion(false);
                if (showMessage) message.error(t("version.updateFailed"));
                return false;
            } finally {
                setChecking(false);
            }
        },
        [currentVersion, localReleases, message, t],
    );

    const openReleaseModal = useCallback(() => {
        setOpen(true);
        void checkLatestRelease();
    }, [checkLatestRelease]);

    const downloadUpdate = useCallback(() => {
        openExternalUrl(downloadUrl || APP_RELEASES_PAGE);
    }, [downloadUrl]);

    return {
        open,
        setOpen,
        openReleaseModal,
        latestVersion,
        releases,
        checking,
        hasNewVersion,
        checkLatestRelease,
        downloadUpdate,
    };
}
