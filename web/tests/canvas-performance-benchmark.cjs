const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
const { loadGeometry, makeCurves } = require('./canvas-geometry-loader.cjs');

(async () => {
    const current = await loadGeometry();
    const baselineFile = 'data/performance-baseline/canvas-connection-geometry.ts';
    const baseline = fs.existsSync(baselineFile) ? await loadGeometry(baselineFile) : null;
    const results = [];
    for (const count of [200, 500, 1000]) {
        const curves = makeCurves(count);
        const measure = (geometry, moving = false) => {
            for (let i = 0; i < 3; i++) geometry.findMindEdgeHops(curves);
            const times = [];
            for (let i = 0; i < 15; i++) {
                if (moving) curves[0] = { ...curves[0], endpoints: { ...curves[0].endpoints, startY: i } };
                const start = performance.now();
                geometry.findMindEdgeHops(curves);
                times.push(performance.now() - start);
            }
            return Number(times.sort((a, b) => a - b)[7].toFixed(3));
        };
        const sameBridges = !baseline || JSON.stringify([...baseline.findMindEdgeHops(curves)].sort()) === JSON.stringify([...current.findMindEdgeHops(curves)].sort());
        if (!sameBridges) throw new Error(`Bridge regression at ${count}`);
        results.push({ curves: count, beforeMs: baseline ? measure(baseline) : null, afterMs: measure(current), movingBeforeMs: baseline ? measure(baseline, true) : null, movingAfterMs: measure(current, true), sameBridges });
    }
    console.log(JSON.stringify(results, null, 2));
})();
