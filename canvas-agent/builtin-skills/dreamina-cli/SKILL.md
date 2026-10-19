---
name: dreamina-cli
description: 使用 Infinite Canvas 内置的即梦（Dreamina）CLI 登录、查积分、生成图片/视频并查询任务。当用户明确要求用即梦/Dreamina 生图、生视频、查询即梦任务或账户时使用。
---

# 即梦 CLI

使用 PATH 中的 `dreamina` 命令。它与 Infinite Canvas「即梦」渠道共用 OAuth 登录态；不要安装额外 CLI，不要读取或改写凭据文件。

## 工作流

1. 首次调用先执行 `dreamina -h`，并对将要使用的子命令执行 `dreamina <subcommand> -h`。
2. 未登录时，提示用户先在 Infinite Canvas 渠道设置中完成即梦一键授权（Device Flow）；不要自行伪造登录态。
3. 根据能力执行：
   - 文生图：`dreamina text2image --prompt="..." --model_version=<ver> --resolution_type=<1k|1.5k|2k|4k> [--ratio=...]`
   - 图生图：`dreamina image2image --images <path> --prompt="..." --model_version=<ver> --resolution_type=...`
   - 文生视频：`dreamina text2video --prompt="..." --model_version=<ver> --video_resolution=<720p|...> --duration=<s>`
   - 图生视频：`dreamina image2video --image=<path> --prompt="..." --model_version=<ver> --video_resolution=...`
4. 异步任务读取真实 `submit_id`，再用 `dreamina query_result --submit_id=<id>` 查询；可用 `--download_dir` 下载结果。
5. 仅当 `gen_status=success` 才视为成功；`fail` 时报告 `fail_reason`。

## 约束

- 模型、比例、时长、分辨率必须以当前子命令 `-h` 为准，不要硬编码过期组合。
- 生成会消耗积分；失败后禁止盲目重投。
- 若返回 `AigcComplianceConfirmationRequired`，提示用户先到即梦网页完成该模型首次确认再重试。
- 不执行 `curl ... | bash`、不覆盖内置 `dreamina` 二进制。
