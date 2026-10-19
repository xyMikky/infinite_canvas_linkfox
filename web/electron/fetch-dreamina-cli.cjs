const fs = require("node:fs");
const fsp = require("node:fs/promises");
const https = require("node:https");
const path = require("node:path");

const DOWNLOAD_BASE = "https://lf3-static.bytednsdoc.com/obj/eden-cn/psj_hupthlyk/ljhwZthlaukjlkulzlp/dreamina_cli_beta";
const VERSION_URL = "https://lf3-static.bytednsdoc.com/obj/eden-cn/psj_hupthlyk/ljhwZthlaukjlkulzlp/version.json";
const OUT_DIR = path.join(__dirname, "dreamina-cli");

function download(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https
            .get(url, (response) => {
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

async function main() {
    await fsp.mkdir(OUT_DIR, { recursive: true });
    const binaryName = process.platform === "win32" ? "dreamina.exe" : "dreamina";
    const remoteName = process.platform === "win32" ? "dreamina_cli_windows_amd64.exe" : process.platform === "darwin" ? `dreamina_cli_darwin_${process.arch === "arm64" ? "arm64" : "amd64"}` : `dreamina_cli_linux_${process.arch === "arm64" ? "arm64" : "amd64"}`;
    const binaryPath = path.join(OUT_DIR, binaryName);
    const skillPath = path.join(OUT_DIR, "SKILL.md");
    const versionPath = path.join(OUT_DIR, "version.json");
    if (!fs.existsSync(binaryPath) || process.argv.includes("--force")) {
        console.log(`[dreamina] 下载 ${remoteName}`);
        await download(`${DOWNLOAD_BASE}/${remoteName}`, binaryPath);
        if (process.platform !== "win32") await fsp.chmod(binaryPath, 0o755);
    } else {
        console.log(`[dreamina] 已存在 ${binaryPath}`);
    }
    console.log("[dreamina] 下载 SKILL.md / version.json");
    await download(`${DOWNLOAD_BASE}/SKILL.md`, skillPath);
    await download(VERSION_URL, versionPath);
    console.log("[dreamina] 完成");
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
