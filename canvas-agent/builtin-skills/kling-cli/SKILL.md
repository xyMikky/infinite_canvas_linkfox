---
name: kling-cli
description: 使用 Infinite Canvas 内置的可灵中国站 CLI 生成图片或视频、查询任务与账户。当用户明确要求用可灵/Kling 生图、生视频、查询可灵任务或账户时使用。
---

# 可灵 CLI

使用 PATH 中的 `kling` 命令。它与 Infinite Canvas「可灵 AI 中国站」渠道共用 OAuth 登录态；不要安装 Node、npm、额外 CLI 或第三方 Skill。

## 工作流

1. 首次调用先执行 `kling who_am_i --quiet`，只依据返回的 `availableModels` / `available_models` 选择工具、模型和参数。
2. 未登录时，提示用户先在 Infinite Canvas 渠道设置中点击「一键授权」；不要自行读取或修改 `~/.kling/.credentials`。
3. 根据能力执行以下一个命令，并始终显式传 `--model`：
   - 文生图：`kling text_to_image --model <model> [已声明参数] "<prompt>" --quiet`
   - 参考图生图：`kling image_to_image --image <path> --model <model> [已声明参数] "<prompt>" --quiet`
   - 文生视频：`kling text_to_video --model <model> [已声明参数] "<prompt>" --quiet`
   - 图生视频：`kling image_to_video --image <path> --model <model> [已声明参数] "<prompt>" --quiet`
4. 从提交结果读取真实 `generationId` / `generation_id`，再执行 `kling query_tasks <generationId> --quiet`；未完成时可以按合理间隔继续查询。
5. 只把服务端返回的实际结果交付给用户，不编造模型名、参数、任务状态、余额或资源地址。

## 约束

- 只发送 `who_am_i` 为所选模型声明的参数；值必须符合 `allowedValues` / `allowed_values`。
- 多张参考图重复使用 `--image <path>`，不要把凭据或 token 放进命令行、日志、文件或回复。
- 失败后报告原任务 ID 和错误；禁止自动重投，避免重复消耗灵感值。
- 用户停止本地查询时，不要声称远端任务已撤销或灵感值会退还。
- 不执行 `npm install`、`npx skills add`，不下载或替换内置可灵 CLI。
