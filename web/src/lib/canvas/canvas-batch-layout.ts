/** 多图结果竖排布局（各占位独立节点，不再合并进可展开图片组）。 */

export const BATCH_IMAGE_GAP = 18;
/** @deprecated 保留给旧版横向展开网格；新生成走竖排独立节点 */
export const RESULT_STACK_GAP = BATCH_IMAGE_GAP;
export const RESULT_STACK_OFFSET_X = 96;
export const RESULT_COLUMN_GAP = 48;

export function getBatchGrid(count: number) {
    const columns = Math.min(Math.max(count, 1), 4);
    const rows = Math.ceil(Math.max(count, 1) / columns);
    const rootSlot = (rows - 1) * columns;
    return { columns, rows, rootSlot };
}

/** 副图在过滤主图后的序号 → 网格槽位与相对主图原点的偏移（旧版可展开图片组）。 */
export function getBatchSecondaryPlacement(secondaryIndex: number, count: number, nodeWidth: number, nodeHeight: number) {
    const { columns, rows, rootSlot } = getBatchGrid(count);
    const slot = secondaryIndex >= rootSlot ? secondaryIndex + 1 : secondaryIndex;
    const column = slot % columns;
    const row = Math.floor(slot / columns);
    return {
        column,
        row,
        x: column * (nodeWidth + BATCH_IMAGE_GAP),
        y: (row - rows + 1) * (nodeHeight + BATCH_IMAGE_GAP),
    };
}

/** 展开后整组在世界坐标中的包围盒（含主图）。 */
export function getBatchExpandedBounds(node: { position: { x: number; y: number }; width: number; height: number; metadata?: { images?: unknown[] } }) {
    const count = node.metadata?.images?.length || 0;
    if (count <= 1) {
        return { x: node.position.x, y: node.position.y, width: node.width, height: node.height };
    }
    const { columns, rows } = getBatchGrid(count);
    const minY = (1 - rows) * (node.height + BATCH_IMAGE_GAP);
    return {
        x: node.position.x,
        y: node.position.y + minY,
        width: columns * node.width + (columns - 1) * BATCH_IMAGE_GAP,
        height: rows * node.height + (rows - 1) * BATCH_IMAGE_GAP,
    };
}

/** 多图结果竖排：整列相对父节点垂直居中，中间一张与父节点连接点同高。 */
export function getVerticalResultPlacement(index: number, count: number, nodeHeight: number, parentCenterY: number, parentRightX: number, gap = RESULT_STACK_GAP, offsetX = RESULT_STACK_OFFSET_X) {
    const n = Math.max(1, count);
    const i = Math.max(0, Math.min(index, n - 1));
    const totalHeight = n * nodeHeight + (n - 1) * gap;
    const startY = parentCenterY - totalHeight / 2;
    return {
        x: parentRightX + offsetX,
        y: startY + i * (nodeHeight + gap),
    };
}
