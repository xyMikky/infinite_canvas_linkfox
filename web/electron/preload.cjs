const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
    isDesktop: true,
    // Electron 32+ 移除了 File.path，取绝对路径必须走 webUtils
    getPathForFile: (file) => {
        try {
            return webUtils.getPathForFile(file) || "";
        } catch {
            return "";
        }
    },
    selectDirectory: () => ipcRenderer.invoke("desktop:select-directory"),
    getDefaultCanvasDataDir: () => ipcRenderer.invoke("desktop:default-canvas-data-dir"),
    getUserDataDir: () => ipcRenderer.invoke("desktop:user-data-dir"),
    setIoPaths: (inputPath, outputPath) => ipcRenderer.invoke("desktop:set-io-paths", inputPath, outputPath),
    getLanShare: () => ipcRenderer.invoke("desktop:get-lan-share"),
    setLanShare: (enabled) => ipcRenderer.invoke("desktop:set-lan-share", enabled),
    getDirectorySize: (dirPath, maxBytes) => ipcRenderer.invoke("desktop:dir-size", dirPath, maxBytes),
    copyDirectory: (src, dest) => ipcRenderer.invoke("desktop:copy-dir", src, dest),
    deleteDirectory: (dirPath, allowedRoot) => ipcRenderer.invoke("desktop:delete-dir", dirPath, allowedRoot),
    readFile: (filePath) => ipcRenderer.invoke("desktop:read-file", filePath),
    listDirectory: (dirPath) => ipcRenderer.invoke("desktop:list-directory", dirPath),
});
