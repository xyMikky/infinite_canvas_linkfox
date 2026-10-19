const { execFile } = require("node:child_process");

const RULE_PREFIX = "Infinite Canvas LAN";

function ruleName(port) {
    return `${RULE_PREFIX} (TCP ${port})`;
}

function runNetsh(args) {
    return new Promise((resolve, reject) => {
        execFile("netsh", args, { windowsHide: true }, (error, stdout, stderr) => {
            if (error) reject(new Error(String(stderr || stdout || error.message).trim()));
            else resolve(String(stdout || ""));
        });
    });
}

async function hasFirewallRule(port) {
    if (process.platform !== "win32") return true;
    try {
        const output = await runNetsh(["advfirewall", "firewall", "show", "rule", `name=${ruleName(port)}`]);
        return output.includes(ruleName(port));
    } catch {
        return false;
    }
}

/** 开启局域网共享时尝试放行入站 TCP；失败时返回错误供 UI 提示手动放行。 */
async function ensureLanFirewallRule(port) {
    if (process.platform !== "win32") return { ok: true };
    try {
        if (await hasFirewallRule(port)) return { ok: true };
        await runNetsh([
            "advfirewall",
            "firewall",
            "add",
            "rule",
            `name=${ruleName(port)}`,
            "dir=in",
            "action=allow",
            "protocol=TCP",
            `localport=${port}`,
            "profile=private,public,domain",
        ]);
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

async function removeLanFirewallRule(port) {
    if (process.platform !== "win32") return { ok: true };
    try {
        if (!(await hasFirewallRule(port))) return { ok: true };
        await runNetsh(["advfirewall", "firewall", "delete", "rule", `name=${ruleName(port)}`]);
        return { ok: true };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

module.exports = { ensureLanFirewallRule, removeLanFirewallRule };
