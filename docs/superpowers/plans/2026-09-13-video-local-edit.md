# 视频局部编辑实施计划

> 执行方式：subagent-driven-development。用户本轮的执行摘要、Must Have 与验收条件为已批准规格；按任务执行并复核接口。当前目录没有 Git 仓库，直接在现有工作区追加，不创建或删除用户文件副本。

**目标：** 视频节点选择时间与多个矩形关键帧，经 24fps 移动裁切预处理、视频编辑工作台生成后，按原帧率贴回并保留原音频与可恢复原件。

**架构：** `video-local-edit.ts` 管理纯选段/插值/FFmpeg 参数；`video-local-edit-media.ts` 管理独立可终止 FFmpeg worker、读取/校验/存储。弹窗只编辑选区；工作台元数据持有目标节点 ID，生成时捕获项目与预处理版本，成功后比较原件再提交。

**技术：** React、现有画布主题、原生 range、现有 @ffmpeg/ffmpeg + @ffmpeg/core、既有媒体存储、RunningHub 视频编辑 API。

## 约束与决定

- 整数时长保留原起止点（1.3–4.3 秒保持不变）；只有非整数时长向外取整并封顶片长（1.3–3.8 秒仍处理为 1–4 秒）。当前 O3 输入最少 3 秒、最多 15 秒，不足 3 秒或非整数片尾冻结末帧补齐，贴回严格截到实际处理区间与原片尾。
- 矩形使用归一化坐标，关键帧时间为原视频绝对秒；相邻关键帧线性插值，首尾保持最近选区，不自动跟踪。
- 输入是按这些框连续取样的移动裁切视频；模型不需要额外的专用掩罩接口，提示词明确保持局部视频构图与时序。
- 生成结果必须实际为 24fps，接受 N×24 或 N×24+1；后一种去除第 0 帧作为切入对齐帧，再恢复原帧率，不变速压缩多余帧。
- 前后与区域外使用原画面，最终使用无损视频编码防止区域外二次损失；音频复制原轨，容器不兼容时从原音轨转码。
- `baseStorageKey` 指向本轮当前底片，`originalStorageKey` 和 `restoreOriginal` 保留第一次编辑前的文件与信息；再次框选保留前次修改。失败/取消/目标已换片/项目恢复不得覆盖。追加生成不得并发争抢同一节点，每轮 runId 校验防止旧任务影响新任务。
- 当前只接受偶数宽高、方形像素、8 位 yuv420p SDR 原片；其它像素格式、HDR、非直角旋转明确拒绝，避免区域外被转换降质。直角旋转按实际显示方向处理。无损输出文件可能变大。
- 不运行浏览器自动化、整体构建或打包。验证纯规则与实际 FFmpeg 生成的合成测试片；真实付费 AI 生成留用户验收。

## 接口

`VideoEditKeyframe = { time: number; x: number; y: number; width: number; height: number }`。
`VideoLocalEditSelection = { start: number; end: number; keyframes: VideoEditKeyframe[] }`。
`expandVideoEditRange(start, end, duration)` 返回 `{ start, end, duration, generationSeconds, frameCount }`。
`interpolateVideoEditRect(keyframes, time)` 返回归一化矩形。
弹窗 `CanvasVideoLocalEditDialog({ node, open, onClose, onConfirm, onRestore })`；`onConfirm(selection, signal, onProgress): Promise<void>`；自身负责取消 controller，关闭立即中止；不直接写画布。

## 任务

- [x] 1. 核心规则及媒体处理：新增上述两个 lib 文件与 `web/tests/video-local-edit.test.cjs`。验证 1.3–3.8→1–4、三关键帧插值、121→120、非法输出拒绝，以实际带音频 30fps/29.97fps 测试片验证时长、帧数、区域外与前后保真。
- [x] 2. 编辑界面：新增 `canvas-video-local-edit-dialog.tsx`。可寻帧、播放、增删关键帧、拖动画/移动/缩放矩形；展示原选段和整数外扩、24fps 输入帧数；提供取消和恢复原片。鼠标操作与布局留用户手测。
- [x] 3. 模型接入：修复既有 RunningHub 视频编辑端点未接收 videoUrl 的通路，只适配明确编辑端点；视频编辑时长按输入；模型素材与工作台显示视频槽位。自定义脚本路径因不传视频而明确拒绝。
- [x] 4. 画布与工作台：元数据增加预处理计划与原片引用；视频工具栏新增局部编辑，保存预处理创建/复用相连视频工作台，生成分支走局部视频生成与原片合成，比较后写回；用户可恢复原片。
- [x] 5. 接口与失败分支已复核，验证和用户待测步骤记入 pending-test，VERSION、package 和 CHANGELOG 同步至 1.6.243。

## 执行记录

- 已检查现有图片局部编辑、视频素材读取、FFmpeg、生成 scope 与 RunningHub 请求；现有视频编辑端点错误地被仅多模态素材规则拦截，需要任务 3 修复。
- 原件保护与 HMR/project scope 沿用现有持久化规则；本任务不修改历史数据迁移。
- 21 项不重复的行为测试通过：6 项核心规则、5 项生成/恢复归属、6 项模型输入、1 项真实 bundled WASM、3 项本机 FFmpeg 像素/音频/旋转测试。本机 FFmpeg 8 使用 `-display_rotation` 创建旋转测试素材；页面 WASM core 5.1.4 的 ffprobe 成功写 JSON 也返回 -1，已通过清除旧 probe 文件、检查新 JSON 与实际解码帧数处理，不能只按返回值判定成功。
- 未做浏览器自动验收、整体构建、打包或付费 AI 请求；实际模型时长上限、24fps 输出与交互效果待手测。TODO 无本轮对应旧项，无需迁移。
- v1.6.244 按用户补充保留整数时长的小数端点；以原片区间内首帧的序号对齐预处理/贴回。16 项不重复定向测试（7 项纯规则、8 项本机 FFmpeg、1 项 WASM）通过，特别验证第一张有效生成帧不会被小数秒补帧舍入跳过；版本与待测文档已同步。
