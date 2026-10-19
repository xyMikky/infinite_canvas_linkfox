/** 只管理浏览器 Animation，不接管页面定时器、视频或 WebGL。 */
export function createHtmlMotionController(getAnimations: () => Animation[]) {
    const owned = new Map<Animation, { rate: number; appliedRate: number; pausedByUs: boolean; ready: Promise<Animation> | null }>();
    function update(paused: boolean, speed: number) {
        const current = new Set(getAnimations());
        for (const animation of owned.keys()) if (!current.has(animation)) owned.delete(animation);
        for (const animation of current) {
            let state = owned.get(animation);
            if (!state) {
                state = { rate: animation.playbackRate, appliedRate: animation.playbackRate, pausedByUs: false, ready: null };
                owned.set(animation, state);
            }
            if (!state.ready && animation.playbackRate !== state.appliedRate) state.rate = animation.playbackRate;
            const target = state.rate * speed;
            if (state.appliedRate !== target || (!state.ready && animation.playbackRate !== target)) {
                animation.updatePlaybackRate(target);
                state.appliedRate = target;
                // 浏览器在 ready 完成后才更新 playbackRate；等待中不能误认成页面改速。
                const ready = animation.ready;
                const tracked = state;
                tracked.ready = ready || null;
                const settled = () => { if (tracked.ready === ready) tracked.ready = null; };
                void ready?.then(settled, settled);
            }
            if (paused && animation.playState === "running") {
                state.pausedByUs = true;
                animation.pause();
            } else if (!paused && state.pausedByUs) {
                state.pausedByUs = false;
                if (animation.playState === "paused") animation.play();
            }
        }
    }
    return {
        update,
        dispose() {
            for (const [animation, state] of owned) {
                if (state.ready || animation.playbackRate === state.appliedRate) animation.updatePlaybackRate(state.rate);
                if (state.pausedByUs && animation.playState === "paused") animation.play();
            }
            owned.clear();
        },
    };
}
