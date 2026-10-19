const fs = require("node:fs");
const path = require("node:path");

const destDir = path.join(__dirname, "runtime");
const destName = process.platform === "win32" ? "node.exe" : "node";
const destPath = path.join(destDir, destName);

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(process.execPath, destPath);
console.log(`[copy-runtime-node] ${process.execPath} -> ${destPath}`);
