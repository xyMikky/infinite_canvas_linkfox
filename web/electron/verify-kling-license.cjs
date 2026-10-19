if (process.env.KLING_CLI_REDISTRIBUTION_AUTHORIZED !== "1") {
    console.error(
        "发布已阻断：当前安装包包含 @klingai/cli-cn。取得可灵对预装、捆绑和再分发的书面授权后，设置 KLING_CLI_REDISTRIBUTION_AUTHORIZED=1 再生成公开安装包。",
    );
    process.exit(1);
}
