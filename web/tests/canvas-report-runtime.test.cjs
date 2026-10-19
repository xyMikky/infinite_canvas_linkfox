const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { transformSync } = require('esbuild');

const webDir = path.resolve(__dirname, '..');
const reactDir = path.dirname(require.resolve('react/package.json'));
async function getRuntimeOptions(mode) {
    let options;
    const context = vm.createContext({ URL });
    const source = fs.readFileSync(path.join(webDir, 'canvas-report-plugin.ts'), 'utf8');
    const mod = new vm.SourceTextModule(stripTypeScriptTypes(source), { context });
    await mod.link(specifier => {
        const values = specifier === 'node:path' ? { resolve: path.resolve } : { build: async config => {
            options = config;
            return { output: [{ type: 'chunk', isEntry: true, code: 'test runtime' }] };
        } };
        return new vm.SyntheticModule(Object.keys(values), function () {
            for (const [key, value] of Object.entries(values)) this.setExport(key, value);
        }, { context });
    });
    await mod.evaluate();
    const plugin = mod.namespace.canvasReportRuntime(webDir);
    plugin.configResolved({ mode, base: '/' });
    await plugin.generateBundle.call({ emitFile() {} });
    return options;
}

for (const mode of ['development', 'production']) {
    test(`${mode} host produces JSX executable with the bundled production React runtime`, async () => {
        const options = await getRuntimeOptions(mode);
        // 只转译最小 JSX 行为样例，不执行项目构建。Vite 开发环境默认 jsxDev=true。
        const result = transformSync('module.exports = <section>报告已打开</section>', {
            loader: 'jsx', format: 'cjs', jsx: options.esbuild.jsx,
            jsxDev: options.esbuild.jsxDev ?? mode !== 'production',
        });
        const module = { exports: {} };
        vm.runInNewContext(result.code, { module, require(name) {
            assert.ok(['react/jsx-runtime', 'react/jsx-dev-runtime'].includes(name));
            return require(path.join(reactDir, 'cjs', name.split('/')[1].replace('jsx', 'react-jsx') + '.production.js'));
        } });
        assert.equal(module.exports.type, 'section');
        assert.equal(module.exports.props.children, '报告已打开');
        assert.equal(options.mode, mode, '不得修改宿主服务的 mode');
    });
}
