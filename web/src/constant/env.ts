import changelogRaw from "../../../CHANGELOG.md?raw";
import versionRaw from "../../../VERSION?raw";

import { parseChangelog } from "@/lib/release";

export const APP_VERSION = versionRaw.trim() || "dev";
export const APP_RELEASES = parseChangelog(changelogRaw);
export const APP_GITHUB_REPO = (import.meta.env.VITE_GITHUB_REPO as string | undefined)?.trim() || "xyMikky/infinite";
export const APP_RELEASES_PAGE = `https://github.com/${APP_GITHUB_REPO}/releases/latest`;

export const DOCS_URL = import.meta.env.VITE_DOC_URL || "https://docs.canvas.best";

// Official plugin registry URL: CI publishes to plugins-dist for jsDelivr delivery; an environment variable may override it for self-hosting.
export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL || "https://cdn.jsdelivr.net/gh/basketikun/infinite-canvas@plugins-dist/official-plugins.json";
