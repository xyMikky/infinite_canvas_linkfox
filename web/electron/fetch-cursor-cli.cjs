const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { getPinterestAgent } = require("./system-proxy.cjs");

function requestOptions(headers) {
    return { agent: getPinterestAgent() || undefined, headers };
}

const OUT_DIR = path.join(__dirname, "cursor-cli");
const INSTALL_SCRIPT_URL = process.platform === "win32" ? "https://cursor.com/install?win32=true" : "https://cursor.com/install";

function requestText(url) {
    return new Promise((resolve, reject) => {
        https
            .get(url, requestOptions({ "User-Agent": "curl/8.0", Accept: "*/*" }), (response) => {
                if ((response.statusCode || 500) >= 300 && response.headers.location) {
                    requestText(response.headers.location).then(resolve, reject);
                    response.resume();
                    return;
                }
                if ((response.statusCode || 500) >= 400) {
                    reject(new Error(`读取失败 ${response.statusCode}: ${url}`));
                    response.resume();
                    return;
                }
                const chunks = [];
                response.on("data", (chunk) => chunks.push(chunk));
                response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
            })
            .on("error", reject);
    });
}

function download(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https
            .get(url, requestOptions({ "User-Agent": "curl/8.0", Accept: "*/*" }), (response) => {
                if ((response.statusCode || 500) >= 300 && response.headers.location) {
                    file.close();
                    fs.unlink(dest, () => {});
                    download(response.headers.location, dest).then(resolve, reject);
                    response.resume();
                    return;
                }
                if ((response.statusCode || 500) >= 400) {
                    file.close();
                    fs.unlink(dest, () => {});
                    reject(new Error(`下载失败 ${response.statusCode}: ${url}`));
                    response.resume();
                    return;
                }
                response.pipe(file);
                file.on("finish", () => file.close(() => resolve(dest)));
            })
            .on("error", (error) => {
                file.close();
                fs.unlink(dest, () => {});
                reject(error);
            });
    });
}

function parseInstallMeta(script) {
    const urlMatch = script.match(/https:\/\/downloads\.cursor\.com\/lab\/[A-Za-z0-9._-]+\//);
    const versionMatch = script.match(/(\d{4}\.\d{2}\.\d{2}-[A-Za-z0-9]+)/);
    const downloadUrl = urlMatch?.[0] || "";
    const version = versionMatch?.[1] || "";
    if (!downloadUrl || !version) throw new Error("无法从官方安装脚本解析 Cursor CLI 版本");
    return { downloadUrl, version };
}

function packageOs() {
    if (process.platform === "win32") return "windows";
    if (process.platform === "darwin") return "darwin";
    return "linux";
}

function packageArch() {
    return process.arch === "arm64" ? "arm64" : "x64";
}

function emptyDir(dir) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
        if (name === ".gitkeep") continue;
        fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    }
}

function findPackageRoot(dir) {
    const names = fs.readdirSync(dir);
    if (names.some((name) => /^cursor-agent(\.exe|\.cmd|\.ps1)?$/i.test(name) || /^agent(\.exe|\.cmd|\.ps1)?$/i.test(name))) {
        return dir;
    }
    const nested = path.join(dir, "dist-package");
    if (fs.existsSync(nested)) return nested;
    for (const name of names) {
        const child = path.join(dir, name);
        if (!fs.statSync(child).isDirectory()) continue;
        const found = findPackageRoot(child);
        if (found) return found;
    }
    return "";
}

function copyDirContents(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
        const from = path.join(src, name);
        const to = path.join(dest, name);
        if (fs.statSync(from).isDirectory()) copyDirContents(from, to);
        else fs.copyFileSync(from, to);
    }
}

async function main() {
    const force = process.argv.includes("--force");
    const primaryNames = process.platform === "win32"
        ? ["cursor-agent.cmd", "cursor-agent.exe", "cursor-agent.ps1"]
        : ["cursor-agent"];
    const existing = primaryNames.map((name) => path.join(OUT_DIR, name)).find((item) => fs.existsSync(item));
    if (existing && !force) {
        console.log(`[cursor-cli] 已存在 ${existing}`);
        return;
    }

    const script = await requestText(INSTALL_SCRIPT_URL);
    const { downloadUrl, version } = parseInstallMeta(script);
    const osName = packageOs();
    const arch = packageArch();
    const archiveName = osName === "windows" ? "agent-cli-package.zip" : "agent-cli-package.tar.gz";
    const packageUrl = `${downloadUrl}${osName}/${arch}/${archiveName}`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-cli-"));
    const archivePath = path.join(tempDir, archiveName);

    console.log(`[cursor-cli] 下载 ${packageUrl}`);
    await download(packageUrl, archivePath);
    execFileSync("tar", ["-xf", archivePath, "-C", tempDir], { windowsHide: true });

    const packageRoot = findPackageRoot(tempDir);
    if (!packageRoot) throw new Error("压缩包内未找到 cursor-agent");

    await fsp.mkdir(OUT_DIR, { recursive: true });
    emptyDir(OUT_DIR);
    copyDirContents(packageRoot, OUT_DIR);

    const bundled = primaryNames.map((name) => path.join(OUT_DIR, name)).find((item) => fs.existsSync(item));
    if (!bundled) throw new Error(`解压后未找到 ${primaryNames.join(" / ")}`);
    if (process.platform === "win32") {
        const cmd = path.join(OUT_DIR, "cursor-agent.cmd");
        const exe = path.join(OUT_DIR, "cursor-agent.exe");
        if (fs.existsSync(cmd) && !fs.existsSync(path.join(OUT_DIR, "agent.cmd"))) fs.copyFileSync(cmd, path.join(OUT_DIR, "agent.cmd"));
        if (fs.existsSync(exe) && !fs.existsSync(path.join(OUT_DIR, "agent.exe"))) fs.copyFileSync(exe, path.join(OUT_DIR, "agent.exe"));
        const ps1 = path.join(OUT_DIR, "cursor-agent.ps1");
        if (fs.existsSync(ps1) && !fs.existsSync(path.join(OUT_DIR, "agent.ps1"))) fs.copyFileSync(ps1, path.join(OUT_DIR, "agent.ps1"));
    } else {
        const alias = path.join(OUT_DIR, "agent");
        if (!fs.existsSync(alias)) fs.copyFileSync(bundled, alias);
        await fsp.chmod(bundled, 0o755);
        await fsp.chmod(alias, 0o755);
    }
    await fsp.writeFile(path.join(OUT_DIR, "version.txt"), `${version}\n${packageUrl}\n`, "utf8");
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log(`[cursor-cli] 完成 ${bundled}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
