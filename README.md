# 无限画布

在一块可以不断平移、缩放的画布上编排内容，并用 [LinkFox](https://wiki.linkfox.com/) 生成图片、视频和文本。生成结果回到画布上，可以继续连线、改提示词、再生成。

这个仓库只包含程序。LinkFox API Key、画布项目和素材都在使用者自己的浏览器里，下载后不会带上别人的密钥或作品。

## 使用前

- 需要自己的 LinkFox API Key。接口地址已经固定为 LinkFox，设置里只填密钥。
- 需要 Node.js。依赖没有放进仓库，克隆后要先安装。

## 启动

克隆后进入 `web` 目录。从 GitHub 下载压缩包时，解压目录名是 `infinite_canvas_linkfox-main`，同样进入其中的 `web`。

```bash
git clone https://github.com/xyMikky/infinite_canvas_linkfox.git
cd infinite_canvas_linkfox/web
npm install --legacy-peer-deps
npm run dev
```

`npm install` 不加后面的参数会中途退出。项目使用 `antd` 6，`@ant-design/pro-components` 声明配合 `antd` 5，npm 会因此停止安装。`--legacy-peer-deps` 只让安装继续，装上的仍是项目里的 `antd` 6，不改变画布和生成功能。

每条命令单独回车。`npm install` 结束后再执行 `npm run dev`。浏览器打开 http://localhost:3000 ，在右上角设置里填入自己的 LinkFox API Key。

用 Bun 时，在 `web` 目录执行 `bun install` 和 `bun run dev`。

用 Docker 时，在仓库根目录执行：

```bash
docker compose up -d
```

同样访问 http://localhost:3000 ，并填写自己的 LinkFox API Key。

## 画布里有什么

- 多个画布项目，节点可以拖动、缩放、连线，支持小地图、撤销和导入导出。
- 文生图、图生图、参考图编辑，以及文本和视频生成，都走 LinkFox。
- 选中节点后可以让画布助手接着改，结果插回画布。
- 本机可以接 Canvas Agent，用 Codex 或 Claude Code 通过 MCP 操作当前画布。这项需要自己安装并登录对应工具。
- 提示词和素材保存在浏览器本地。

更细的说明：

- [功能介绍](docs/content/docs/overview/features.mdx)
- [画布节点操作手册](docs/content/docs/canvas/canvas-node-manual.mdx)
- [画布快捷键](docs/content/docs/canvas/canvas-shortcuts.mdx)
- [本地 Canvas Agent](canvas-agent/README.md)

## Windows 桌面版

桌面安装包不在仓库里，需要本机打包：

```bash
cd web
npm install --legacy-peer-deps
npm run electron:pack
```

安装包在 `web/release/InfiniteCanvas-<version>-win-x64.exe`。只要目录、不装安装包时，用 `npm run electron:pack:dir`，程序在 `web/release/win-unpacked/InfiniteCanvas.exe`。

打包时会拉取 Canvas Agent 运行所需的程序。Codex 仍要装在使用那台电脑上，装好并登录后，才能在 Agent 面板里一键启动。
