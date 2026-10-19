#!/usr/bin/env node
import { stopCodexApp } from "./agent/codex.js";
import { startHttpServer } from "./server/http.js";
import { startMcpServer } from "./server/mcp.js";

if (process.argv[2] === "mcp") await startMcpServer();
else {
    // Agent 退出时回收 Codex app-server，避免留下孤儿进程继续持有失效凭据。
    process.on("exit", stopCodexApp);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => process.exit(0));
    startHttpServer();
}
