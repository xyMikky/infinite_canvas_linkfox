import { APP_GITHUB_REPO } from "@/constant/env";
import { compareVersion, normalizeVersion, parseReleaseNotes, releasesFromGithubBody, type ReleaseInfo } from "@/lib/release";

export type LatestGithubRelease = {
    version: string;
    releaseUrl: string;
    downloadUrl: string;
    publishedAt: string;
    release: ReleaseInfo;
    releases: ReleaseInfo[];
};

type GithubAsset = {
    name?: string;
    browser_download_url?: string;
};

type GithubReleaseResponse = {
    tag_name?: string;
    html_url?: string;
    body?: string | null;
    published_at?: string | null;
    draft?: boolean;
    prerelease?: boolean;
    assets?: GithubAsset[];
};

function pickInstallerUrl(assets: GithubAsset[] | undefined, releaseUrl: string) {
    const list = assets || [];
    const exe =
        list.find((asset) => /InfiniteCanvas-.*-win-x64\.exe$/i.test(asset.name || "")) ||
        list.find((asset) => /\.exe$/i.test(asset.name || "") && asset.browser_download_url);
    return exe?.browser_download_url || releaseUrl;
}

function toReleaseInfos(data: GithubReleaseResponse): ReleaseInfo[] {
    const tag = data.tag_name?.trim();
    if (!tag || data.draft || data.prerelease) return [];
    return releasesFromGithubBody(tag, data.body || "", (data.published_at || "").slice(0, 10));
}

export async function fetchLatestGithubRelease(): Promise<LatestGithubRelease> {
    const response = await fetch(`https://api.github.com/repos/${APP_GITHUB_REPO}/releases?per_page=100`, {
        headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) {
        throw new Error(`GitHub releases HTTP ${response.status}`);
    }
    const list = (await response.json()) as GithubReleaseResponse[];
    const published = list.filter((item) => !item.draft && !item.prerelease && item.tag_name?.trim());
    if (!published.length) throw new Error("GitHub release missing tag");
    const latest = published[0];
    const tag = latest.tag_name!.trim();
    const version = normalizeVersion(tag);
    const releaseUrl = latest.html_url || `https://github.com/${APP_GITHUB_REPO}/releases/latest`;
    const publishedAt = (latest.published_at || "").slice(0, 10);
    const byVersion = new Map<string, ReleaseInfo>();
    for (const item of published.flatMap(toReleaseInfos)) {
        const key = normalizeVersion(item.version);
        if (key) byVersion.set(key, item);
    }
    const releases = [...byVersion.values()].sort((a, b) => compareVersion(b.version, a.version));
    return {
        version,
        releaseUrl,
        downloadUrl: pickInstallerUrl(latest.assets, releaseUrl),
        publishedAt,
        release: {
            version,
            date: publishedAt,
            items: parseReleaseNotes(latest.body || "", "前往 GitHub 下载安装包"),
        },
        releases,
    };
}
