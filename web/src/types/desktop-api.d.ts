export type LanShareInfo = {
    ok: boolean;
    enabled: boolean;
    port: number;
    urls: string[];
    error?: string;
    firewallOk?: boolean;
    firewallError?: string;
};

export type DesktopAPI = {
    isDesktop: true;
    getPathForFile: (file: File) => string;
    selectDirectory: () => Promise<string>;
    getDefaultCanvasDataDir: () => Promise<string>;
    getUserDataDir: () => Promise<string>;
    setIoPaths: (inputPath: string, outputPath: string) => Promise<{ ok: boolean }>;
    getLanShare: () => Promise<LanShareInfo>;
    setLanShare: (enabled: boolean) => Promise<LanShareInfo>;
    getDirectorySize: (dirPath: string, maxBytes?: number) => Promise<number>;
    copyDirectory: (src: string, dest: string) => Promise<{ ok: boolean; error?: string }>;
    deleteDirectory: (dirPath: string, allowedRoot: string) => Promise<{ ok: boolean; error?: string }>;
    readFile: (filePath: string) => Promise<{ ok: boolean; dataBase64?: string; bytes?: number; error?: string }>;
    listDirectory: (dirPath: string) => Promise<{ ok: boolean; entries?: Array<{ path: string; size: number }>; error?: string }>;
};

declare global {
    interface Window {
        desktopAPI?: DesktopAPI;
    }
}

export {};
