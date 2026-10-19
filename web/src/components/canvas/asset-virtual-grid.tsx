import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Asset } from "@/stores/use-asset-store";

// 两列按原图比例计算行高，只挂载视口附近的行。
export function AssetVirtualGrid({ items, children }: { items: Asset[]; children: (asset: Asset) => ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    const [viewport, setViewport] = useState({ width: 260, top: 0, bottom: 700 });
    useEffect(() => {
        const element = ref.current!;
        let scroll = element.parentElement!;
        while (scroll.parentElement && !/auto|scroll/.test(getComputedStyle(scroll).overflowY)) scroll = scroll.parentElement;
        let frame = 0;
        const measure = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const rect = element.getBoundingClientRect();
                const parent = scroll.getBoundingClientRect();
                setViewport({ width: element.clientWidth, top: parent.top - rect.top - 300, bottom: parent.bottom - rect.top + 300 });
            });
        };
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        observer.observe(scroll);
        if (scroll.firstElementChild) observer.observe(scroll.firstElementChild);
        scroll.addEventListener("scroll", measure, { passive: true });
        measure();
        return () => { cancelAnimationFrame(frame); observer.disconnect(); scroll.removeEventListener("scroll", measure); };
    }, [items]);
    const layout = useMemo(() => {
        const width = Math.max(1, (viewport.width - 8) / 2);
        let top = 0;
        const rows = [];
        for (let i = 0; i < items.length; i += 2) {
            const assets = items.slice(i, i + 2);
            const height = Math.max(...assets.map((asset) => asset.kind === "image" && asset.data.width > 0 && asset.data.height > 0 ? (width - 2) * asset.data.height / asset.data.width + 2 : width));
            rows.push({ assets, top, height });
            top += height + 8;
        }
        return { rows, height: Math.max(0, top - 8) };
    }, [items, viewport.width]);
    return <div className="px-1 pb-2 pt-1"><div ref={ref} className="relative" style={{ height: layout.height }}>
        {layout.rows.filter((row) => row.top + row.height >= viewport.top && row.top <= viewport.bottom).map((row) => <div key={row.assets[0].id} className="absolute inset-x-0 grid grid-cols-2 items-start gap-2" style={{ top: row.top }}>{row.assets.map((asset) => <div key={asset.id}>{children(asset)}</div>)}</div>)}
    </div></div>;
}
