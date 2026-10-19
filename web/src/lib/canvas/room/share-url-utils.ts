/** 客户端排序/过滤分享链接，与服务端 lan-share-urls.cjs 规则一致 */
function lanAddressRank(address: string) {
    if (address.startsWith("192.168.")) return 0;
    if (address.startsWith("10.")) return 1;
    if (address.startsWith("172.")) return 2;
    return 3;
}

function isUnreachableShareAddress(address: string) {
    if (!address || address.startsWith("127.")) return true;
    if (address.startsWith("169.254.")) return true;
    if (/^172\.(17|18|19|2[0-9]|30|31)\./.test(address)) return true;
    return false;
}

function hostFromShareUrl(url: string) {
    try {
        return new URL(url).hostname;
    } catch {
        return url.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
    }
}

export function sortLanShareUrls(urls: string[]) {
    const unique = [...new Set(urls.filter(Boolean))];
    return unique
        .filter((url) => !isUnreachableShareAddress(hostFromShareUrl(url)))
        .sort((a, b) => lanAddressRank(hostFromShareUrl(a)) - lanAddressRank(hostFromShareUrl(b)) || a.localeCompare(b));
}

export function pickPrimaryShareUrl(urls: string[], sharePath: string) {
    const sorted = sortLanShareUrls(urls);
    if (sorted.length) return sorted[0];
    if (typeof window !== "undefined") return `${window.location.origin}${sharePath}`;
    return sharePath;
}

export function isPreferredLanShareUrl(url: string) {
    const host = hostFromShareUrl(url);
    return host.startsWith("192.168.") || host.startsWith("10.");
}
