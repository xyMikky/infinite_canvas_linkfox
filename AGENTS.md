# AGENTS.md

本文档用于约束本项目中的 AI / 自动化开发行为。开发时优先遵循本文件，其次遵循用户当前消息。

## 基本原则

- 先读现有代码，再动手修改，优先沿用项目已有结构和写法。
- 写代码保持最少行数，能简单实现就不要引入复杂抽象。
- 标准格式、协议、解析、压缩、加密、日期等通用能力优先使用成熟稳定的库，不要手写底层实现，除非用户明确要求或项目已有实现必须沿用。
- 不要为了“兼容更多场景”写大量分支，只实现当前明确需要的功能。
- 项目尚未上线，不需要兼容旧数据；本地存储结构调整时直接按新设计修改，不写旧字段兼容或数据迁移兜底，除非用户明确要求。
- 每次写完代码，不需要检查语法，不需要执行构建，也不要用浏览器 CDP / 自动化点页面验收；用户会自己测，不行会再说。
- 不要改无关文件，不要顺手重构。
- 如果工作区已有用户改动，不要回滚，不要覆盖；只在必要范围内追加修改。

## 反复提醒沉淀

- 如果开发过程中总是遇到某个问题，或者用户反复提醒同一个注意事项，需要把该注意事项补充到本文件。
- 补充时写成明确、可执行的规则，避免只写模糊描述。
- 新规则应放到最相关的章节；找不到合适章节时放到“项目注意事项”。

## 前端规范

- `data-canvas-no-zoom` 只用于禁止画布滚轮缩放穿透，**不得**当作画布快捷键/粘贴的忽略区；快捷键与 Ctrl+V 粘贴的忽略选择器只用输入框、`contenteditable` 与 `data-canvas-shortcuts-ignore`（如 Agent 面板）。HTML/智能预览等内容区可以有 `data-canvas-no-zoom`，但选中它们后仍须能向画布粘贴。
- 前端使用 Vite、React、React Router、TypeScript、Ant Design、Tailwind、Zustand。
- 编写 Ant Design 相关代码时，参考 https://ant.design/llms-full.txt 理解组件 API、示例和设计规范，并优先结合项目当前 antd 版本与既有写法。
- 外部服务请求统一放在 `web/src/services/api/`，由浏览器前端直连，不假设存在项目后端。
- 全局或跨页面状态优先放在 `web/src/stores/`。
- 已经放在全局 store 或全局 hook 中的状态/动作，组件需要时直接使用对应 store/hook，不要为了“纯组件”层层透传 props；避免一个组件传递过多参数。
- 全局组件、全局常量、全局配置等全局性质的内容不要作为 props 或参数层层传递；哪里需要就在哪里直接从对应全局入口获取。
- 多个页面重复出现的 UI 副作用动作，例如复制文本并提示、下载并提示、统一确认弹窗，优先抽成 `web/src/hooks/` 下的全局 hook；不要放进 store，除非它确实是需要共享/订阅的状态。
- 路由页面放在 `web/src/pages/`，页面布局放在 `web/src/layouts/`，路由配置放在 `web/src/router.tsx`。
- 画布页面放在 `web/src/pages/canvas/`，画布组件放在 `web/src/components/canvas/`，画布状态放在 `web/src/stores/canvas/`，画布工具函数放在 `web/src/lib/canvas/`。
- 画布预览能力：PDF / 音视频 / HTML / 图片依赖浏览器原生能力，统一走 `web/src/lib/canvas/browser-preview.ts` 与 `web/src/components/canvas/browser-preview.tsx`；Markdown / Excel / CSV / 文本由应用解析后自绘。不要在业务节点里再散落一套 PDF object URL 或视频拖拽/点击判定；PPT/Office/模型等浏览器无法预览的格式不要假装已支持内容预览。
- 规划模式的 Plan 输出、侧栏预览和导入画布须使用同一份 Markdown；直接复用现有 Markdown 渲染器，不得自动转成 Canvas TSX 卡片、流程图，或用聊天里的其他 TSX 源码覆盖 Plan 正文。
- Canvas TSX 展开必须识别 `data-canvas-live` 交互容器（含容器自身），不能只按 Recharts/SVG 图形数量判断；不得继续剥壳或拆小带交互 ref 的容器。SDK 悬停提示通过页面浮层按视口坐标定位，避免被活片段裁剪或受画布缩放影响。
- Canvas TSX 展开片段闲置时显示局部快照，禁止所有片段常驻可见的整份报告渲染树；交互树休眠须保留组件状态，快照补齐按队列执行。普通悬停不得触发项目保存或撤销记录，SVG 快照的 id 与引用须和活组件分离。
- 开发端热更新后，画布视图绑定与进行中的生成请求须通过 `import.meta.hot.data` 保留同一状态对象；旧异步回调与新模块必须看到同一绑定，解绑时校验视图实例。禁止模块重载后把仍打开的画布误判为后台项目，造成导入只落盘、刷新才显示。
- 节点拖动的逐帧辅助线更新须限制在辅助线组件内，禁止因此重渲染整张画布页面；`liveDrag` 只修改本次移动节点的 DOM，结束时清除其临时位移。同一组坐标的连线重绘须复用几何结果，容器尺寸按变化测量，不能每帧读取布局。
- 缩放/平移逐帧更新禁止在节点层祖先写继承的 CSS 自定义属性（会让整棵节点树重算样式），只改需要变化的元素自身属性且数值未变不写；视口剔除重算与平移预挂载批次禁止放进 `startTransition`，否则每帧新更新会反复打断渲染，攒到停手一次挂满造成长时间卡顿。
- 大画布重预览只在首次进入视口后保留挂载，离屏使用 Activity 暂停 React 副作用并保留状态；选中、拖动中的组成员和打开面板的节点不得休眠。连线裁剪须包含贝塞尔控制点与星小驰实时端点，不能只看两端节点是否可见；曲线缓存不可忽略导图相邻扇出、判断出口和数据组端口的依赖。
- Canvas TSX 展开尺寸必须按独立片段的实际排版测量，保留原预览继承的字体、行高与精确布局宽度；节点边界包含内容和必要留白，活片段裁剪坐标不得先取整，禁止靠用户手动扩大节点补救裁切。
- 页面按目录组织，例如 `web/src/pages/image/index.tsx`；页面里只有一个主业务组件时直接写在对应页面入口中，不要单独拆 `Manager` 组件再传一堆 props。
- 不要新增只做简单转发的组件，例如只 `return <X>{children}</X>` 或只换个名字透传 props；直接在使用处使用真实组件或把逻辑写进当前文件。
- 页面私有 hook 放在对应页面目录下，例如 `admin/assets/use-admin-assets.ts`；只有多个页面真实复用的 hook 才放到外层 `hooks/`。
- 管理后台页面私有组件放到各自页面目录的 `components/` 下，例如 `admin/assets/components/`、`admin/prompts/components/`；不要为了单页面使用放到 `admin/components/` 共享目录。
- 管理后台主题、背景、卡片阴影、表格配色等统一在 `web/src/lib/app-theme.ts`、`AppProviders` 或必要的全局 CSS 作用域中配置；页面私有组件不要自己写 `dark ? ...` 主题分支。
- Ant Design 的 Dropdown、Menu、Select、Cascader、TreeSelect 等弹层背景、悬停态和选中态颜色统一通过 `web/src/lib/app-theme.ts` 的全局 Alias Token 与组件 Token 配置；不要在业务组件内为单个弹层覆盖颜色。
- 组件优先使用函数组件和现有 hooks，不新增大型状态管理方案。
- UI 图标优先使用 `lucide-react` 或项目已经使用的 Ant Design 图标。
- 页面文案保持中文。
- 引用翻译时须核对中英文资源中的完整键路径，不能因其它分组存在同名键就认为有效（如 `workbench.retry` 不等于 `common.retry`）；不得在页面上显示原始翻译键。
- 不要在组件里堆太多无关逻辑；复杂逻辑优先抽成同目录工具函数或小组件。
- 样式优先由组件自己管理；组件私有样式优先使用 Tailwind className 或少量内联 style，不要为单个组件新增大量全局 CSS。
- 全局 CSS 只放基础变量、全局重置、跨页面通用样式和少量第三方组件必要覆盖；不要在 `globals.css` 堆页面私有样式。
- 代码尽量短小直接，少拆不必要组件，少做多层 props 传递，避免为了抽象堆出更多代码。
- 前端业务数据需要浏览器本地持久化时，默认使用 `localforage`；`localStorage` 只用于极小的简单配置，不要用来保存业务列表、生成记录、图片、base64 或大 JSON。

## 画布 UI 规范

- 标注编辑器所有绘制工具（含马赛克、形状、文字）右键统一临时使用普通圆形擦除笔刷，松开恢复原工具；不得仅支持第一个画笔，也不得按当前形状或马赛克方式擦除。
- 做 canvas 前端 UI 时必须遵循当前画布主题。
- 优先使用 `canvasThemes`、`useThemeStore` 或 Ant Design `ConfigProvider` token。
- 不要硬编码黑白、stone、slate 等颜色导致浅色/深色主题不一致。
- 新增画布按钮、弹窗、浮层时，尽量复用已有工具栏、节点面板、Modal 的视觉风格。
- 图片编辑弹窗新增比例或选项时，须同步调整弹窗可用高度、按钮高度和侧栏间距，常规桌面视口应完整展示全部设置与底部操作；不得仅隐藏滚动条或裁切内容，小屏仍须保证所有操作可达。
- 画布顶部工具栏和状态信息优先采用极简扁平风格：无边框、无阴影、无胶囊背景，融入整体背景，弱化按钮感，仅保留轻微 hover 反馈，保持简洁现代、低视觉重量。
- 左侧画布面板等列表里的节点/元素缩略图容器，非图片类型（文本、配置、视频、音频等）不要使用 `theme.node.fill`（`#e7e5df`/`#292524`）这类灰色背景，图标直接无背景展示，尽量不要给多余底色，保持干净。
- 画布内的操作按钮（如面板里的「添加」「导出」「选择」等）默认用扁平无底色样式：透明背景、仅 `hover:bg-black/5 dark:hover:bg-white/10` 轻微反馈，靠图标+文字表达，不要用 `theme.toolbar.activeBg`（`#e7e5df`/`#3a3631`）或 `theme.node.fill` 之类的灰色作为按钮填充底色。灰色 `activeBg` 只允许用于「选中态」等需要表达状态的高亮，不要当普通装饰底色。
- 图片节点尺寸逻辑要尊重原始比例，除非功能明确要求自由变形。
- 画布上传、裁剪、导入等异步操作须在第一个 await 前绑定发起项目，结果经 `createCanvasGenerationScope` 写回原项目；切项目后不得使用当前页面 refs 写结果或更改选区。项目恢复须取消失效回调，撤销快照也必须校验项目归属。
- 批量生成、多图展示、助手面板等画布交互要尽量简洁，不要占用过多画布空间。
- 工作台高度须容纳当前模型的全部素材行、参数、重点提示词入口和生成动作，调整入口布局时同步更新默认高度与按模型适配的高度，禁止用节点内部纵向滚动补救空间不足；提示词正文仍在下方独立面板编辑与滚动，不参与节点高度计算。
- 当前 3D 能力只支持文生模型和图生模型，不支持编辑已有模型；模型节点须遵守 `hidePanel`，禁止因选中模型而强制显示通用生成/编辑框。文字和图片生成模型保留在生成工作台入口。

## 文档规范

- README 保持简洁，只放项目介绍、核心功能、快速开始和文档入口。
- `docs/index.md` 放给 AI 使用的文档索引，不要再放到 `docs/content/docs/` 内容目录里。
- 详细功能介绍写到 `docs/content/docs/overview/features.mdx`。
- 后续待办写到 `docs/content/docs/progress/todo.mdx`。
- 已实现但还需要用户测试确认的事项写到 `docs/content/docs/progress/pending-test.mdx`。
- `docs/content/docs/progress/pending-test.mdx` 用来记录这个版本实际做了哪些可测试变更；`CHANGELOG.md` 的 `Unreleased` 只保留对这些变更的版本级归纳，避免逐条照搬实现细节。
- 每次重大改动（新增/调整/删除功能、接口或工具，影响用户可感知行为）完成后，自动把 patch 版本号 +1（同步更新根目录 `VERSION` 与 `web/package.json`，如 v1.0.5 → v1.0.6，无需用户提醒），并把本次变更以 `[新增]` / `[调整]` / `[修复]` / `[优化]` 前缀、一句中文归纳，直接记入 `CHANGELOG.md` 该新版本号的段落（`Unreleased` 保留为空标题备用）；纯内部重构、格式化、纯文档改动不升版不记录。
- 每次 todo 事项完成后，先从 `docs/content/docs/progress/todo.mdx` 移到 `docs/content/docs/progress/pending-test.mdx`，不要直接写进正式功能说明；用户确认测试通过后再更新 `docs/content/docs/overview/features.mdx`。
- 每次任务完成前，都要根据实际变更检查并更新 `docs/content/docs/progress/todo.mdx` 和 `docs/content/docs/progress/pending-test.mdx`；如果功能或待办没有变化，也要确认无需修改。
- 文档不要写过期日期；除非用户明确要求记录具体时间。

## 发版本流程

- 日常改动已按「文档规范」自动小步升版并记录 CHANGELOG；发正式版本时若 `Unreleased` 还有残留条目，先归入当前版本号。
- 确认根目录 `VERSION` 与 `web/package.json` 一致。
- 将当前未提交的代码全部提交到 Git。
- 提交完成后，给当前提交打最新版本号对应的 tag，例如 `v0.0.5`。
- 发版本流程中不要执行编译、测试或构建，除非用户明确要求。

## 项目注意事项

- 文件夹图片完整保存须覆盖直接导入资产、拖入画布后转存资产、资产回插画布三条链路；目录条目数不代表原件已保存，浏览器端转存前须核对图片原件与记录大小，缺失不得宣称完整入库。

- 资产图片预览（含文件夹内图片）只加载当前页缩略图并预取下一页，禁止启动全库原图读取或全库缩略图生成；切页、分类、目录或搜索时取消旧预取，原图只在缓存缺失需生成缩略图或用户预览/编辑/插入时读取。

- 文件夹图片不能按文本预览上限截断二进制；资产图片原件逐文件完整保存，缩略图另存且保持原图比例。普通图片资产与文件夹内图片是两条入口，图片加载和比例改动必须同时覆盖；旧缓存缺失/截断要明确提示并允许用户重选原目录恢复，禁止以永久占位或半截图伪装加载完成。

- RunningHub 图片上传缓存禁止按 rh-0 等临时引用编号、节点 ID、文件大小或 data URL 前缀识别图片；只对读取成功的存储原件复用缓存，缺失原件后的替代内容不能沿用旧 storageKey 缓存。

- 视频局部编辑生成须在工作台右侧先创建独立占位节点，完成后将完整合成视频写入该节点；禁止覆盖输入原视频。每轮新增结果，保留此前结果，失败/取消不得遗留无提示的空框。

- 视频局部编辑须按音视频轨的实际起止跨度读取完整时长，不得仅用视频轨时长校验末尾关键帧；WASM 与本机 FFmpeg 的容器时长可能包含不同的起始偏移，不能直接混用。像素比例舍入未改变整数显示宽度时可归一化为方形像素，真正改变显示宽度的非方形像素仍须明确拦截。

- 视频局部编辑首个关键帧必须允许自由调整宽高比（拖角、重新画框、独立输入宽高），修改首框比例时同步全部后续框；后续关键帧与帧间新增框只能移动或等比缩放，不得各自改变比例。首框单次拖拽同步须以拖拽开始时的其它框为基准，避免反复变比造成累积收缩。已有不同比例的框在弹窗草稿内统一，未确认前不得回写原选区。

- 视频局部编辑定位不得要求 currentTime 与请求时间毫秒级相等；须按原生 seeking / readyState 确认完成，允许非零首帧时间戳和尾帧边界对齐。暂停定位须保留用户选中的编辑时间，0 秒显示首帧并修改 0 秒关键帧，禁止被媒体的 0.100 秒等起始时间戳或迟到事件覆盖；只有播放时跟随媒体时间推进。不要向相同时间重复写 currentTime；定位超时须保留已加载视频和未保存选区并可重新定位，不得复用清空媒体的加载失败处理。

- Photopea 开图和侧栏导入须按 `primaryImageId` / `images` 读取节点当前主图，不能只取 metadata 顶层字段；优先按 storageKey 取原始 Blob。开发端图片响应为 `application/octet-stream`，禁止仅凭 Blob.type 或 `data:image/` 前缀把可读取的图片判为失败。

- Photopea 的 postMessage 脚本仅使用官方文档接口，禁止发送 `document.querySelector`、`window`、`MutationObserver` 等浏览器页面脚本或把样式处理作为启动前提；初始图片用 ArrayBuffer 打开，`app.open` 的脚本回执不代表图片已加载，须确认新文档/图层存在后再命名、保存。启动失败须区分编辑器未响应与图片读取/打开失败；编辑中异常不得自动重载丢弃未保存图层。

- 星小驰连线根部必须与身体同色并向身体内部衔接，不能用朝外偏移或独立圆点遮接缝；活端点坐标按实际节点屏幕框换算，包含角色上下状态文字造成的位移。已有连线或正在拉线时收敛大幅旋转/跳动，保留轻微动作；连线沿用角色绘制后的同帧更新，避免再叠加独立重绘循环。

- 画布内弹窗/面板的数值滑条不要用 Ant Design `Slider`（易出现拖完后滑点仍跟随鼠标的粘连）；统一用原生 `<input type="range">`，样式可参考画笔标注弹窗。
- 预置提示词来源已彻底移除（用户多次要求）：不得重新加入任何内置/默认提示词来源；来源列表只能由用户手动添加。hydrate、「导入配置」、同步恢复等一切入口都必须经 `sanitizePromptSources` 过滤掉历史 `builtIn` 条目；hydrate 完成前不得把内存状态写回存储。
- 「允许局域网访问」仅当前进程有效：启动必须只听 `127.0.0.1`，不得从 persist、`lan-share.txt` 或「导入配置」恢复为开；会话内打开只改内存与 IPC，写回存储时必须写成关闭。
- 当前画布项目和“我的素材”主要保存在浏览器本地，不要在文档中误写成已支持云同步。
- Web 开发端（`npm run dev`）画布 projects 与相关媒体落在仓库 `data/canvas-dev/`（经 `/api/dev-local-store`，仅本机环回）；开发验收不要依赖 IndexedDB。静态预览 / Electron 打包仍走 IndexedDB。
- 通过自动化启动供用户使用的画布开发服务时，须确认进程具备外部 API 网络权限；禁止把受限沙箱中启动的后台进程当作正常联网服务。代理出现 `EACCES` 时先核对启动权限；无密钥访问渠道接口收到上游鉴权响应可用于连通检查，仅本地首页 HTTP 200 不能证明生成链路可用。
- 画布持久化读取/解析失败时禁止标记 hydrated 或写回初始空列表，须显示错误并允许重试；开发存储接口暂时不可用不得静默切换 IndexedDB，画布 IndexedDB 失败不得退到另一份 localStorage。开发端项目 JSON 必须校验后以临时文件原子替换，覆盖前保留上一份有效非空备份，禁止空值或坏文件覆盖备份；恢复数据前先备份，明确快照范围，不得把旧快照宣称为最新完整数据。
- 画布升级必须保留旧存储原件与升级快照；已有历史却主记录缺失时停止初始化，禁止退回旧 localStorage 后覆盖。开发端保存必须带读取到的版本；浏览器主记录的读取比对与提交须在同一 IndexedDB 读写事务中完成，可用时仍使用 Web Locks 协调。HTTP 局域网缺少 Web Locks 不得阻止读取，也不得直接跳过并发保护；主记录初始化、备份恢复也须原子比对，备份同名记录只允许首次写入。冲突或失败须提示并保留可导出的当前内容。素材回收站与跨窗口引用确认完成前，不得恢复按当前内存列表自动物理删除素材。
- 局域网 HTTP 也须能生成业务 ID：统一复用 `randomId` 或 `nanoid`，不得直接调用仅安全上下文可用的 `crypto.randomUUID`。
- Windows 升级必须在旧卸载器运行前完成安装目录外的用户数据备份与校验；不能依赖新版 customRemoveFiles 修复旧卸载器。新安装默认 `$INSTDIR\data`，升级保留已登记旧数据目录及固定桌面 origin；目录不可用、升级备份/恢复未完成时停止启动，禁止静默换空目录。旧版真实安装包升级验收未完成前，不得发布正式安装包或宣称已彻底解决所有版本升级问题。
- 下文「用户数据固定 `$INSTDIR\data`」仅适用于全新安装；旧版升级是明确例外，保留原登记路径。保留数据卸载时，登记路径在安装目录内的任意子目录及其父目录都必须跳过，不能只保护名为 `data` 的文件夹。画布全量写空须由明确的删除动作发起，初始化、同步或普通状态更新不得携带删除许可。
- `resolveImageUrl` / `resolveMediaUrl` 在开发端磁盘没有文件时必须回退 IndexedDB 并回写磁盘；刷新后不得把过期 `blob:` 当地址显示。上传须同时写磁盘和 IndexedDB。
- `collectImageStorageKeys` / `collectMediaStorageKeys` 必须收集所有 `storageKey` 与 `*StorageKey`（含 `localEditCroppedStorageKey`、`outpaintWorkStorageKey`），不能只认字段名 `storageKey`；否则清理未使用图片会删掉局部编辑裁剪图，工作台 `@` 列表裂图。
- 工作台 / 节点 `@` 菜单缩略图必须经 `resolveImageUrl(storageKey, 非 blob 的 fallback)`，禁止把过期 `blob:` 直接塞进 `<img src>`。
- 当前 AI API Key 存在浏览器本地，并由前端直接请求 OpenAI 兼容接口；涉及安全说明时要写清楚。
- RunningHub 国际站与中国站是两个独立渠道（`runninghub` / `runninghub-cn`），密钥与代理不得混用；RH 综合节点使用中国站，registry 全量模型使用国际站。
- Chrome 的 `AbortSignal.timeout` 报错是 `TimeoutError` / `signal timed out`，不是 `AbortError`；参考图上传与 RH 任务失败都要识别并重试，禁止把这句英文原文写到节点上。
- 可灵与即梦 CLI 均为官方工具内置：公开发布含预装 CLI 的安装包前须分别取得书面再分发授权（`KLING_CLI_REDISTRIBUTION_AUTHORIZED` / `DREAMINA_CLI_REDISTRIBUTION_AUTHORIZED`）。即梦二进制用 `npm run fetch:dreamina-cli` 拉取到 `web/electron/dreamina-cli/`。
- Docker 静态资源路径目前仍是待办项，文档中不要过度承诺生产部署已经完全验证。
- Agent 对话消息必须同时按 `threadId`、`turnId` 和 `itemId` 归属；实时事件只用于补充未物化的 turn，历史快照成为权威后不得重复合并同一条消息。
- Agent 默认轻量聊天不得注入画布预设、自动 Skill 目录、画布 MCP 或自动选区；只有手动选择的 Skill 和附件随当前消息发送。轻量与执行/规划切换须新建干净线程并保留旧历史，恢复/派生线程必须沿用其上下文模式，不得重新预热完整画布工具。
- Agent 对话正文：中文说明（即使夹杂 `->` / `→`）必须按正文换行完整显示，禁止误判为 ASCII 图而包进等宽横滑块。Cursor 用 ` ```text ` 包的中文提示词也要换行看全文；仅真正 ASCII 树状图用 ` ```ascii ` 等宽不换行。Markdown 表格分隔行（`|---|`）不得当成 ASCII 图。
- 问答、反推/改写提示词、解释图片等简单指令只在对话里回答；禁止为此调用 `canvas_generate_text` 或搭建工作台。只有用户明确要求「放到画布 / 建节点 / 生成图视频音频」才改画布。聊天已带图时不得因 `blob:` 改去画布生成。
- Agent 流式正文必须区分增量与快照：明确的 CLI/ACP token、`item.delta` 原样追加（`mergeAssistantText` 使用 delta 模式），禁止按换行数量、长度或重复词判断丢弃增量；CLI 工具/重试前的段落回执不得重复拼接，`item.text` / `result` 权威快照替换对应正文。不得把两份草稿接成 `---###推荐```text` 这种一行，也不得自动给英文 token 加空格。渲染前 `repairSmashedAgentMarkdown` 只处理几乎无换行却带标题/围栏的挤烂文本。
- Agent 导图数据组：禁止按「落在组框坐标内」自动给节点加 groupId（堆同一点时会把整张图吸进一个虚线框）；只认 `metadata.memberIds` / 已有 groupId。落盘后必须消重叠，主链节点不得与组内叶子叠成一团。
- Agent 导图长线：组内成员不得先按父题扇出再随组框二次平移；堆叠时主链枢纽与数据组分侧（下/右）；父题只连组内叶子时也应把组框视为布局目标拉到旁侧。
- Agent 导图落盘：空选区≠画布为空，续画/重画前必须 `canvas_get_state` 防重复套图；坐标只是初值（系统会消重叠/箍组框），禁止预置巨大空 group；数据组宁少勿滥且只连整框；表/多页细节进 `smart-preview`；视口保局部可读；宣称完成前须自检无重复/堆叠/蛛网。
- Agent 导图连线：布局/消重叠后必须重算端口并优先主轴对边直连（上下 bottom↔top、左右 left↔right）；禁止因轻微偏移走 L 形从反侧绕出；竖链单子题消重叠后要重新水平居中。组外主题连到组内叶子时，端口与绘制按数据组框近侧边计算并沿边向对端投影（`slideMindSideAnchor`，横进组心），不得落到叶底绕圈；旁侧数据组不得阻塞主链竖向居中。判断节点（是/否等）多条出边必须共用同一出口尖点（按子题质心定边），禁止左右尖分别甩出。普通 mind 同侧多条非判断出边须沿边扇出，不得挤在一个尖点。绘制时交叉导图边抬桥，须在描边同一条贝塞尔上算交叉；过近的交叉并成一座弧，禁止连跳挤成折角。边标签须沿法线离开描边（`connectionLabelWorld`），不得压在线上。消重叠必须包含标注节点（与主题重叠时优先只挪标注）；竖链居中后再跑一轮消重叠。消重叠时数据组框移动必须带动全部成员；禁止把其它组的成员当「组外节点」单独推挤（会把 pack 结果打散叠成一团）；布局流水线末尾必须再 `resizeDataGroupFrames`。跨组连线落盘时改挂数据组整框，避免对每个叶子拉蛛网。
- 导图成员不限于 mind-node：看板/图片/文本等普通节点（组框与 config 工作台除外）经 `mind` 边并入导图（`mindLinkKind` 一端为 mind/数据组即成立），布局、消重叠、竖链居中都必须把这些节点当流程枢纽（`mindLinkedEmbeddableIds`）；长 mind 边须经 `withMindEdgeBow` 绕开挡道节点，禁止直穿；折叠子树只沿 mind/annotation 边收集，禁止顺着普通生成连线隐藏无关节点。
- 底栏选择工具三态（选择 → 关联选择 → 移动）：指针仍悬停在该按钮上切换时，必须同步更新 hovered id / 提示文案为当前工具名，禁止一直显示「选择」。
- 关联选择（点选、框选与右键关联拖动）仅更新画布选区，不得自动把关联节点同步成 Agent 附件或读取其图片原件；右键关联拖动与关联选择工具拖动不得触发 Agent 投放，普通手动添加附件入口保留。
- 底栏须保留「思维导图」模式开关（`mindMapMode`），位置在上传与传递连线之间；逻辑已在 `project.tsx`，工具栏组件不得漏接 props / 按钮。
- 选中 mind-node 时悬停工具栏须渲染 `MindNodeHoverTools`（样式/颜色/字号），并接上 `onPatchMindMetadata` / `onUpdateMindSize`；不得只剩信息与删除。
- 画布组件恢复后须核对：`liveDrag` 拖拽跟手、分享按钮、滑块对比、关联选择三态与提示、导图四向端口/折叠（`onToggleMindCollapse` + `ConnectionHandleDot` 四向）、`stackZIndex`、菱形等 `MindShapeBorderResize`、数据组空心绿虚线框（`GroupNodeContent` 不内填标题、`DataGroupBorderDragLayer` 仅边框可拖）是否仍接到 `canvas-node`；缺一则补回，不要只留 project 侧空传参。
- 导图节点外壳（`canvas-node`）对 mind 必须 `overflow-visible` + `rounded-none border-0`，描边由 `MindContent` 自绘；禁止内容层 `overflow-hidden` / 外壳 `rounded-3xl` 裁掉胶囊左右弧。`computeMindNodeSize` 须按 CJK≈1em 估宽高；Agent `resolveMindSize` 不得用过小的 explicit 宽高压过计算值。
- 拖入文件夹时，只有根目录 `SKILL.md` 才把该节点标为 Skill（标题/紫色徽章）；深层嵌套的 Skill（如 `.agents/skills/kling-cli`）不得盖掉项目文件夹名。
- Codex 会话按 `ownerId` 隔离（每台浏览器一个，存 localStorage；桌面端固定 `host`，未登记归属的旧线程归 host）：前端所有 Agent 请求经 `fetchAgentJson` 与 SSE 自动带 `ownerId`；服务端活跃线程、对话状态、历史列表、事件推送、busy 锁都按 owner/thread 划分，不得再引入全局唯一的 `activeThreadId`、全局 busy 或向所有客户端广播线程事件。
- Cursor 历史必须可打开：会话与用户/助手正文落在 `cursor-thread-history.json`，`GET/resume` 要带回 `messages`；切会话不得把目标线程的本地缓存清掉。历史时间：`createdAt` 大于 `1e12` 按毫秒，否则按秒，禁止 `new Date(ms * 1000)` 把 Cursor 的 `Date.now()` 显示成年份 5 万。
- Cursor 空草稿不得落盘、不得进历史列表；SSE `hello` 已有 ready 线程时禁止再 `threads/reset`；`reset`/`new` 复用当前无消息线程。列表 hydrate 时清掉已落盘的空未命名，禁止把内存里每条空会话再写回文件。
- Cursor 连接初始化必须读取自己的会话状态，不能将共享 SSE hello 中的 Codex 会话当作 Cursor 已就绪；一键启动重试即使地址与 token 未变也须重建握手。握手须有超时和可重试错误，切换引擎或断开后不得应用旧连接的异步结果。
- Cursor CLI 的首个 stream-json 在内部初始化后才输出，禁止用固定 20 秒无 stdout 直接误杀；启动等待和回复空闲等待须分别计时，思考/工具事件视为进展，结束时清除计时。未收到鉴权错误时，不得把启动超时归因为 API Key。隔离 HOME 仍会触发 CLI 内置技能同步，不能仅凭 status 登录成功宣称实际对话已验证。
- 用户提问只显示一条：本地占位、SSE `chat_message`、历史快照必须按 `clientMessageId` / 同回合 `synthetic:user` / 未绑定 turn 的相同正文合并，禁止回合结束后再在回复下面插一条同样的输入。
- Cursor 编辑原提问后点发送必须能重发：Cursor 没有 Codex fork，应 `threads/reset` 开新空会话再送出编辑后的正文和附件，禁止直接 `return false` 且不提示。
- 不要用浏览器 CDP、锁定标签或自动点页面做验收；改完交给用户手动测。也不要关闭用户已经打开的浏览器窗口或标签页。
- Windows 安装时只选一个文件夹：程序在 `$INSTDIR`，用户数据固定 `$INSTDIR\data`（写 `data-dir.txt` 与 `.infinite-canvas-userdata`），不要再单独做「选择数据目录」页。卸载清数据优先删 `$INSTDIR\data`；旧版若 data-dir 指向自有文件夹，只删应用子项，禁止误清无关文件与盘符根。选「保留数据」或升级时必须用 `customRemoveFiles` 逐项删除安装文件并跳过 `data`，禁止依赖默认的 `RMDir /r $INSTDIR`（否则会把 data 一起删掉）；也不要把 `data` Rename 到 `$PLUGINSDIR`（跨盘必败）。整夹删除还须有 userdata 标记（`$INSTDIR\data` 除外），并拒绝系统目录与盘符下第一层目录（如 `D:\za`）；NSIS 卸载专用 `un.*` 函数必须包在 `!ifdef BUILD_UNINSTALLER` 内，helper 函数须保存/恢复用到的寄存器。
- Windows Input/Output 目录：不再单独设置，固定为画布数据目录下的 `input` / `output`。同步到 Agent 时仍写入 `io-paths.txt`（安装目录 / userData / `~/.infinite-canvas`）及目录内 `.infinite-canvas-io-dir` 标记；卸载可选清理仅针对「已登记且含该标记」的路径，默认否；无标记、盘符根、盘符下第一层文件夹与系统目录一律不删。
- 新版 Electron（32+）已移除 `File.path`：渲染进程要拿拖入文件绝对路径必须走 preload 暴露的 `webUtils.getPathForFile`（已有 `desktopAPI.getPathForFile`，统一经 `fileLocalPath` 使用），不要再直接读 `file.path`。
- 不要把业务源码写进 `node_modules`。`https-proxy-agent/dist/agent.js` 曾被写成 Skill 节点源码，Vite 加载配置时会报 `Unexpected token '{'`。Electron / Vite 中间件的系统代理不要 `require("https-proxy-agent")`，使用 `electron/system-proxy.cjs` 内的 CJS Agent。
- Agent 启动报依赖缺失时，不能仅凭 npm install 成功判断修复；须确认启动模块可加载。若依赖目录仍不完整，在独立目录按锁文件安装，备份原 node_modules 后替换，不修改业务源码绕过缺失依赖。
- 不要把依赖产物、许可证文本、antd/babel 路径列表、PNG、JSON 抓取结果、Amazon 评论 JSON、micromark README、tape 测试或其它无关文本写进 `canvas-agent/src`、`web/src` 或 `web/electron/*.cjs`。`codex.ts` / `codex-client.ts` / `http.ts`、`globals.css`、若干 store/节点文件、以及 `web/electron/local-agent-host.cjs` 曾被写坏，tsc 会报几千个 `Identifier expected`，Vite 会拒绝编译。`canvas-agent/src/**/*.ts` 不得写入 NUL、UTF-16 或 `dist` 编译结果；tsx 会报 Unexpected `"\x00"` 并以退出码 1 立刻结束，一键启动只显示「启动失败」。
- 安装包 Node 运行时打在 `resources/canvas-agent/node.exe`。`resolveNodeBinary` 必须先查这个路径，不要只找 `electron/runtime/node.exe` 或依赖系统 PATH 里的 node。
- 桌面前端产物放在 `resources/dist`，与 `getDistRoot` 保持一致；静态资源须读取成功后再发送响应，异步读取失败不得冒泡成主进程异常，缺失 JS/CSS 不得回退为 HTML。升级启动只可刷新 HTTP 资源缓存，禁止通过清除 IndexedDB、localStorage 或变更 origin 解决白屏。打包核验须用实际 Electron 运行时经本机 HTTP 请求入口 HTML 及其引用的 JS/CSS，不能仅凭 ASAR 清单或解压哈希宣称启动可用。
- electron-builder 打 `cursor-cli` 时必须再单独 extraResources 拷 `electron/cursor-cli/node_modules`（`filter: ["**/*"]`），不能只拷目录根；默认会丢掉 `tree-sitter`，安装包里 Cursor 会报 `Cannot find module 'tree-sitter'`。
- Windows 打包出现同一文件重复复制或 `EBUSY` 时，先检查源目录枚举是否返回重复路径；若存在重复，在独立临时目录按路径去重复制后打包，保留源 CLI 与依赖目录，不得修改 `node_modules` 中的打包器实现来绕过问题。
- 桌面「一键启动」不得因未检测到 Codex 而禁用；安装包不捆绑 `@openai/codex-*` 原生包，应调用本机 Codex CLI / 桌面版二进制。失效会话（`no rollout found` / `thread not loaded`）要清掉并开新线程，不要反复 500。
