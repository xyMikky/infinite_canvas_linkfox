import { useMemo, useState } from "react";
import { App, Button, Input, Modal, Typography } from "antd";
import copyToClipboard from "copy-to-clipboard";
import { Copy, Share2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { applyDesktopLanShare } from "@/lib/canvas/lan-share";
import { isPreferredLanShareUrl, pickPrimaryShareUrl, sortLanShareUrls } from "@/lib/canvas/room/share-url-utils";
import { useConfigStore } from "@/stores/use-config-store";

type CanvasShareModalProps = {
    open: boolean;
    sharing: boolean;
    shareUrls: string[];
    sharePath: string;
    onlineCount: number;
    onClose: () => void;
    onStart: () => Promise<void>;
    onStop: () => Promise<void>;
};

export function CanvasShareModal({ open, sharing, shareUrls, sharePath, onlineCount, onClose, onStart, onStop }: CanvasShareModalProps) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const lanShareEnabled = useConfigStore((state) => state.config.lanShareEnabled);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const [starting, setStarting] = useState(false);
    const [stopping, setStopping] = useState(false);

    const sortedUrls = useMemo(() => sortLanShareUrls(shareUrls), [shareUrls]);
    const primaryUrl = useMemo(() => pickPrimaryShareUrl(shareUrls, sharePath), [sharePath, shareUrls]);
    const showLanHint = sharing && sortedUrls.length > 0 && !isPreferredLanShareUrl(primaryUrl);

    const copyUrl = (url: string) => {
        copyToClipboard(url);
        message.success(t("canvas.roomShare.linkCopied"));
    };

    const enableLanAndShare = async () => {
        setStarting(true);
        try {
            const info = await applyDesktopLanShare(true);
            if (info) {
                updateConfig("lanShareEnabled", true);
                if (!info.ok && info.error) {
                    message.error(info.error);
                    return;
                }
            } else {
                message.info(t("canvas.roomShare.webOnlyHint"));
            }
            await onStart();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.roomShare.startFailed"));
        } finally {
            setStarting(false);
        }
    };

    const handleStart = async () => {
        if (!lanShareEnabled && window.desktopAPI?.setLanShare) {
            await enableLanAndShare();
            return;
        }
        setStarting(true);
        try {
            await onStart();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.roomShare.startFailed"));
        } finally {
            setStarting(false);
        }
    };

    const handleStop = async () => {
        setStopping(true);
        try {
            await onStop();
            onClose();
        } finally {
            setStopping(false);
        }
    };

    return (
        <Modal
            open={open}
            title={t("canvas.roomShare.title")}
            onCancel={onClose}
            width={640}
            footer={
                sharing
                    ? [
                          <Button key="stop" danger loading={stopping} onClick={() => void handleStop()}>
                              {t("canvas.roomShare.stop")}
                          </Button>,
                          <Button key="copy" type="primary" onClick={() => copyUrl(primaryUrl)}>
                              {t("canvas.roomShare.copyLink")}
                          </Button>,
                      ]
                    : [
                          <Button key="cancel" onClick={onClose}>
                              {t("common.cancel")}
                          </Button>,
                          <Button key="start" type="primary" loading={starting} onClick={() => void handleStart()}>
                              {lanShareEnabled || !window.desktopAPI?.setLanShare ? t("canvas.roomShare.start") : t("canvas.roomShare.enableLanAndStart")}
                          </Button>,
                      ]
            }
        >
            <Typography.Paragraph type="secondary" className="!mb-4 text-sm">
                {t("canvas.roomShare.description")}
            </Typography.Paragraph>
            {sharing ? (
                <div className="space-y-3">
                    <div className="text-sm">{t("canvas.roomShare.online", { count: onlineCount })}</div>
                    {showLanHint ? (
                        <Typography.Paragraph type="warning" className="!mb-0 text-xs">
                            {t("canvas.roomShare.preferLanHint")}
                        </Typography.Paragraph>
                    ) : null}
                    <div className="space-y-2">
                        <div className="text-xs text-stone-500">{sortedUrls.length > 1 ? t("canvas.roomShare.recommendedFirst") : t("canvas.roomShare.shareLink")}</div>
                        {(sortedUrls.length ? sortedUrls : [primaryUrl]).map((url, index) => (
                            <div key={url} className="flex items-start gap-2">
                                <Input.TextArea
                                    readOnly
                                    value={url}
                                    autoSize={{ minRows: 2, maxRows: 4 }}
                                    className="!text-xs !leading-relaxed"
                                    style={{ wordBreak: "break-all" }}
                                />
                                <Button
                                    type="text"
                                    className="!mt-1 shrink-0"
                                    icon={<Copy className="size-4" />}
                                    title={index === 0 ? t("canvas.roomShare.copyLink") : t("common.copy")}
                                    onClick={() => copyUrl(url)}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="text-sm text-stone-600 dark:text-stone-400">{t("canvas.roomShare.idleHint")}</div>
            )}
        </Modal>
    );
}

export function CanvasShareToolbarButton({
    sharing,
    onlineCount,
    onClick,
}: {
    sharing: boolean;
    onlineCount: number;
    onClick: () => void;
}) {
    const { t } = useTranslation();
    return (
        <Button
            type="text"
            className="!h-8 !rounded-lg !px-2"
            icon={<Share2 className="size-4" />}
            onClick={onClick}
            title={sharing ? t("canvas.roomShare.online", { count: onlineCount }) : t("canvas.roomShare.title")}
        >
            <span className="relative inline-flex items-center gap-1">
                {t("canvas.roomShare.button")}
                {sharing ? <span className="size-2 rounded-full bg-emerald-500" /> : null}
            </span>
        </Button>
    );
}
