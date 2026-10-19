const os = require("node:os");

/** 192.168 / 10 段优先；排除 Docker / Hyper-V 等虚拟网段 */
function lanAddressRank(address) {
    if (address.startsWith("192.168.")) return 0;
    if (address.startsWith("10.")) return 1;
    if (address.startsWith("172.")) return 2;
    return 3;
}

function isVirtualInterface(name) {
    return /vEthernet|VMware|VirtualBox|Hyper-V|WSL|Loopback|TAP|TUN|VPN|Npcap|ZeroTier|Tailscale|Radmin|Hamachi|Bluetooth|Teredo|isatap|Docker/i.test(name || "");
}

/** 局域网分享通常不可达的地址（Docker 桥、链路本地等） */
function isUnreachableShareAddress(address) {
    if (!address || address.startsWith("127.")) return true;
    if (address.startsWith("169.254.")) return true;
    // Docker Desktop / Hyper-V 默认交换机等常见虚拟网段
    if (/^172\.(17|18|19|2[0-9]|30|31)\./.test(address)) return true;
    return false;
}

function listLanShareUrls(port, sharePath = "/canvas") {
    const suffix = sharePath.startsWith("/") ? sharePath : `/${sharePath}`;
    const urls = [];
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        if (isVirtualInterface(name)) continue;
        for (const info of ifaces[name] || []) {
            if ((info.family !== "IPv4" && info.family !== 4) || info.internal) continue;
            if (isUnreachableShareAddress(info.address)) continue;
            urls.push(`http://${info.address}:${port}${suffix}`);
        }
    }
    urls.sort((a, b) => {
        const hostA = a.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
        const hostB = b.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
        return lanAddressRank(hostA) - lanAddressRank(hostB) || a.localeCompare(b);
    });
    return urls;
}

module.exports = {
    lanAddressRank,
    isVirtualInterface,
    isUnreachableShareAddress,
    listLanShareUrls,
};
