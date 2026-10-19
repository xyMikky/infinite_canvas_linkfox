import { FileText } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/** 提示词封面：加载失败时回退图标，避免浏览器破图图标 */
export function PromptCoverThumb({
    url,
    alt = "",
    className,
    fallbackClassName,
    iconClassName = "size-4 opacity-50",
}: {
    url?: string;
    alt?: string;
    className?: string;
    fallbackClassName?: string;
    iconClassName?: string;
}) {
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        setFailed(false);
    }, [url]);
    if (!url || failed) {
        return (
            <span className={cn("grid place-items-center", fallbackClassName || className)}>
                <FileText className={iconClassName} />
            </span>
        );
    }
    return <img src={url} alt={alt} draggable={false} className={className} loading="lazy" onError={() => setFailed(true)} />;
}
