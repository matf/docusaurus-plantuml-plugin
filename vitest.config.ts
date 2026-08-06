import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';

const resolveLocal = (relativePath: string) =>
  fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  esbuild: {jsx: 'automatic'},
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
    css: {modules: {classNameStrategy: 'non-scoped'}},
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/types/**'],
    },
  },
  resolve: {
    // Docusaurus `@theme/*` and `@docusaurus/*` aliases only exist inside a real
    // Docusaurus webpack build, so unit tests point them at local stubs.
    alias: [
      {
        find: /^@theme-init\/MDXComponents\/Code$/,
        replacement: resolveLocal('./tests/stubs/OriginalCode.tsx'),
      },
      {
        find: /^@theme\/PlantUmlDiagram$/,
        replacement: resolveLocal('./src/theme/PlantUmlDiagram/index.tsx'),
      },
      {
        find: /^@docusaurus\/theme-common$/,
        replacement: resolveLocal('./tests/stubs/themeCommon.ts'),
      },
      {find: /^@docusaurus\/useBaseUrl$/, replacement: resolveLocal('./tests/stubs/useBaseUrl.ts')},
      {
        find: /^@docusaurus\/useGlobalData$/,
        replacement: resolveLocal('./tests/stubs/useGlobalData.ts'),
      },
      {
        find: /^@docusaurus\/useIsBrowser$/,
        replacement: resolveLocal('./tests/stubs/useIsBrowser.ts'),
      },
    ],
  },
});
