const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

// Only curve math runs here; node-specific port routing is covered by manual canvas checks.
exports.loadGeometry = async function (file = 'web/src/lib/canvas/canvas-connection-geometry.ts') {
    const RBush = (await import('../node_modules/rbush/index.js')).default;
    const context = vm.createContext({ console, Math, Map, Set, WeakMap });
    const source = stripTypeScriptTypes(fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8'));
    const module = new vm.SourceTextModule(source, { context });
    await module.link(async name => {
        const match = source.match(new RegExp('import\\s*\\{([^}]+)\\}\\s*from\\s*["\\\']' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\\\']'));
        const names = name === 'rbush' ? ['default'] : match[1].split(',').map(item => item.trim()).filter(Boolean);
        return new vm.SyntheticModule(names, function () {
            for (const key of names) this.setExport(key, name === 'rbush' ? RBush : key === 'CanvasNodeType' ? { Group: 'group' } : () => { throw new Error(`Unexpected port call: ${key}`); });
        }, { context });
    });
    await module.evaluate();
    return module.namespace;
};

exports.makeCurves = function (count) {
    return Array.from({ length: count }, (_, index) => {
        const column = Math.floor(index / 2) % 20;
        const row = Math.floor(index / 40);
        const x = column * 700;
        const y = row * 500;
        return { id: `edge-${String(index).padStart(4, '0')}`, endpoints: {
            startX: x, startY: y + (index % 2 ? 180 : 0), endX: x + 400, endY: y + (index % 2 ? 0 : 140),
            curvature: 140, mind: true,
        } };
    });
};
