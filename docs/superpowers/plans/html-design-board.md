# HTML UI 设计画板

用户已确认按实时预览、文案编辑、设备尺寸和动效体验的方向实现。基于已有 HTML 智能预览增加画板工具，不拆解 DOM 为画布节点。

- [x] 在浏览器预览入口集中管理 HTML 单文件和文件夹资源的生命周期，纯文案更新复用 iframe；结构或脚本变化重新加载。
- [x] 增加 UI 画板开关，提供选择 / 文案 / 交互、桌面 / 平板 / 手机、暂停 / 重播 / 速度；页面使用真实设备视口，外层仅等比适应节点。
- [x] 用唯一 `data-ui-text` 标记静态文案（允许文字及换行 br）；原生 DOMParser 修改源 HTML，保存至节点 content，保留脚本、样式及资源路径。失焦提交、Escape 取消，提供文案撤销 / 重做；外部未标记 HTML 仍可预览和交互。
- [x] 写回绑定项目、节点、文件路径和发起源码，拒绝过期编辑；预览辅助属性不进入源文件，文件夹源缓存不能覆盖节点已编辑正文。原始磁盘文件不自动覆盖，导出源文件包含当前修改。
- [x] 标准浏览器动画暂停 / 变速保留页面原有暂停状态，可见性变化触发标准动画暂停。任意 JS 定时器、WebGL 和视频不声称支持统一控制；整页重新播放明确会重置临时交互状态。Activity 休眠恢复和更多画板的运行范围优化继续列 TODO。
- [x] 更新 Agent 的 UI HTML 生成约定，提供可直接拖入的演示文件。9 项隔离行为测试通过，不运行构建、语法检查或浏览器自动验收。同步版本与待测、TODO。
- [x] 审查补齐 iframe 文档来源校验：跳转后停止编辑与回写，重播返回原页面；普通段落以 br 保留编辑换行，撤销区分源码排版换行与实际换行，取消不改原子节点，未编辑字段不被重新格式化。

主要文件：`browser-preview.tsx`（浏览器加载）、`html-design-board.tsx`（画板工具）、`html-design-source.ts`（文案源数据）、`html-design-runtime.ts`（文字事件与动效）；智能预览节点仅接入入口。源文件仍通过已有导出和 Agent 输入链读取。

API 依据：[原生纯文本编辑与粘贴](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/contenteditable)；[动画变速需要等待 ready 后读回速率](https://developer.mozilla.org/en-US/docs/Web/API/Animation/updatePlaybackRate)。测试模拟 Animation 接口，真实 DOM 文案编辑、页面动效及文件导出效果转入 pending-test 手动确认。
