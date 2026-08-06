import {defineConfig} from 'tsup';

/**
 * `tsc` emits the ESM build (including the Docusaurus theme components, which must stay
 * as individual unbundled files so `@theme/...` aliases resolve). tsup only adds the
 * CommonJS build of the Node-side plugin entry, for `docusaurus.config.js` consumers.
 */
export default defineConfig({
  entry: {index: 'src/index.ts'},
  format: ['cjs'],
  outDir: 'dist',
  platform: 'node',
  target: 'node20',
  dts: true,
  clean: false,
  splitting: false,
  sourcemap: false,
  treeshake: false,
  // `src/assets.ts` uses `import.meta.url`, which needs a CJS shim in the require build.
  shims: true,
  external: ['copy-webpack-plugin', '@plantuml/core', '@docusaurus/core', '@docusaurus/types'],
  outExtension: () => ({js: '.cjs', dts: '.d.cts'}),
});
