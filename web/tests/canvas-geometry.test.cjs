const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadGeometry, makeCurves } = require('./canvas-geometry-loader.cjs');

test('crossing bridges remain on the same curve independent of input order', async () => {
    const geometry = await loadGeometry();
    for (const count of [200, 500, 1000]) {
        const curves = makeCurves(count);
        const hops = geometry.findMindEdgeHops(curves);
        assert.equal(hops.size, count / 2);
        for (const [id, values] of hops) {
            assert.equal(Number(id.slice(5)) % 2, 1);
            assert.equal(values.length, 1);
            assert.ok(values[0].t > 0.5 && values[0].t < 0.6);
        }
        const reversed = geometry.findMindEdgeHops([...curves].reverse());
        assert.equal(JSON.stringify([...hops].sort()), JSON.stringify([...reversed].sort()));
    }
});

test('curve bounds include offscreen endpoints and bowed control points', async () => {
    const geometry = await loadGeometry();
    const cases = [
        { startX: -1000, startY: 200, endX: 2000, endY: 200, curvature: 500 },
        { startX: 0, startY: 0, endX: 300, endY: 0, curvature: 150, mind: true, bow: 800 },
        { startX: 0, startY: 0, endX: 300, endY: 200, curvature: 300, xing: true, startNormal: { x: -1, y: 0 }, endNormal: { x: 0, y: 1 } },
    ];
    for (const endpoints of cases) {
        const bounds = geometry.getConnectionCurveBounds(endpoints);
        for (let step = 0; step <= 100; step++) {
            const point = geometry.pointOnConnectionBezier(endpoints, step / 100);
            assert.ok(point.x >= bounds.minX - 1e-6 && point.x <= bounds.maxX + 1e-6);
            assert.ok(point.y >= bounds.minY - 1e-6 && point.y <= bounds.maxY + 1e-6);
        }
    }
});

test('unchanged disjoint curves reuse samples across animation frames', async () => {
    const geometry = await loadGeometry();
    let geometryReads = 0;
    const curves = makeCurves(200).filter((_, index) => index % 2 === 0).map(item => ({ ...item, endpoints: new Proxy(item.endpoints, {
        get(target, key) { if (key === 'startX') geometryReads++; return target[key]; },
    }) }));
    geometry.findMindEdgeHops(curves);
    assert.ok(geometryReads > curves.length);
    geometryReads = 0;
    geometry.findMindEdgeHops(curves);
    assert.equal(geometryReads, 0);
});

test('moving a curve invalidates its samples and restoring it restores the bridge', async () => {
    const geometry = await loadGeometry();
    const curves = makeCurves(2);
    assert.equal(geometry.findMindEdgeHops(curves).size, 1);
    const moved = [{ ...curves[0], endpoints: { ...curves[0].endpoints, startY: 1000, endY: 1200 } }, curves[1]];
    assert.equal(geometry.findMindEdgeHops(moved).size, 0);
    assert.equal(geometry.findMindEdgeHops(curves).size, 1);
});
