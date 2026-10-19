if (process.env.DREAMINA_CLI_REDISTRIBUTION_AUTHORIZED !== "1") {
    console.error(
        "发布已阻断：当前安装包包含即梦（Dreamina）CLI。取得字节/即梦对预装、捆绑和再分发的书面授权后，设置 DREAMINA_CLI_REDISTRIBUTION_AUTHORIZED=1 再生成公开安装包。",
    );
    process.exit(1);
}
