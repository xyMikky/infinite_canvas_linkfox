export function AssetPageControls({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (page: number) => void }) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    if (pages <= 1) return null;
    return <div className="flex shrink-0 items-center justify-center gap-3 px-2 py-2 text-xs">
        <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} className="rounded px-2 py-1 hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10">上一页</button>
        <span className="opacity-60">{page} / {pages}</span>
        <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)} className="rounded px-2 py-1 hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10">下一页</button>
    </div>;
}
