let active = false;

/** 双指缩放进行中。此期间节点拖动和拉伸必须让路，只改变视口。 */
export function isCanvasTouchPinchActive() {
    return active;
}

export function setCanvasTouchPinchActive(next: boolean) {
    active = next;
}
