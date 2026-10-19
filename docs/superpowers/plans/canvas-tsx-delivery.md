# Canvas TSX 阅读与交付

目标：将整份 Canvas TSX 文档交付为可双击打开的交互报告，保留 SDK 图表、文档状态和引用素材。

- 共用现有编译器和 SDK，将宿主状态适配从 SDK 主题上下文拆开，交付运行时不依赖画布 store。
- 新增阅读界面：目录、章节定位与演示、主题切换、加载与运行错误反馈。只保留一份交互树，切换章节不重建文档。
- Vite 开发中按需提供独立 IIFE 运行时，生产构建同步输出；导出 HTML 内嵌运行时、源码、状态与素材，无 CDN 依赖。
- 报告在无同源权限的 sandbox iframe 中运行，禁止网络请求；宿主只处理来自当前 iframe 的明确状态消息。源码仍在现有画布预览中执行，主预览/拆分测量的隔离另列待办。
- 全文节点及展开后的数据组提供同一交付入口。展开后的内容独立修改，不反向合并到原始源码，入口明确提示。
- 缺失素材、编译/渲染失败阻止导出；提供 HTML 及附源码、状态、素材清单的 ZIP。仅打包已发现的媒体引用，动态分支需在交付前检查。
- 用隔离 Node 行为测试验证包的内容转义、资源路径与失败行为；不执行构建、语法检查或浏览器自动验收。更新版本、CHANGELOG、待测与剩余 TODO。

实现情况：已接入节点/数据组的「阅读与交付」、独立 SDK 状态适配、运行时产出、单树阅读/演示、素材收集与失败拦截、HTML/ZIP 打包。v1.6.213 补齐开发宿主下的生产 JSX 配置和 React 启动前的错误保护，共 15 项 Node 行为测试通过；实际离线运行与交互验证移入 pending-test，主节点执行隔离和未访问动态资源覆盖保留在 TODO。

接口参考：[Vite JavaScript API](https://vite.dev/guide/api-javascript.html)；[iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox)。开发运行时与 Vite 服务使用相同 mode，单独定义运行时的 React production 常量；交付文档保留 sandbox 且不开放 allow-same-origin。
