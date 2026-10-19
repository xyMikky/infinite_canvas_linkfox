import { useEffect, useRef, useState } from "react";
import { Image } from "antd";
import type { ImageAsset } from "@/stores/use-asset-store";
import { readAssetThumbnail } from "@/services/asset-thumbnail";
import { resolveImageUrl } from "@/services/image-storage";

export function AssetImage({ asset, original = false }: { asset: ImageAsset; original?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    const [url, setUrl] = useState("");
    const [error, setError] = useState(false);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        let objectUrl = "";
        let started = false;
        setUrl("");
        setError(false);
        const load = async () => {
            if (started) return;
            started = true;
            try {
                const value = original ? await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl) : await readAssetThumbnail(asset, controller.signal);
                if (controller.signal.aborted) return;
                if (!value) throw new Error("图片无法读取");
                if (typeof value === "string") setUrl(value);
                else { objectUrl = URL.createObjectURL(value); setUrl(objectUrl); }
            } catch { if (!controller.signal.aborted) setError(true); }
        };
        const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) void load(); }, { rootMargin: "160px" });
        if (original) void load();
        else if (ref.current) observer.observe(ref.current);
        return () => { controller.abort(); observer.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [asset.id, asset.updatedAt, asset.data.storageKey, asset.data.dataUrl, original, retry]);
    return <div ref={ref} className="relative w-full" style={{ aspectRatio: `${asset.data.width || 1} / ${asset.data.height || 1}` }}>
        {url ? original ? <Image src={url} alt={asset.title} width="100%" className="rounded-lg" /> : <img src={url} alt={asset.title} draggable={false} decoding="async" className="block h-full w-full object-contain" /> : <span className="absolute inset-0 grid place-items-center text-xs opacity-50" onClick={error ? (event) => { event.stopPropagation(); setRetry((value) => value + 1); } : undefined}>{error ? "加载失败，点击重试" : "加载中"}</span>}
    </div>;
}
