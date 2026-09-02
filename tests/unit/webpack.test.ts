import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {afterAll, describe, expect, it, vi} from 'vitest';

import type {ConfigureWebpackUtils} from '@docusaurus/types';

import plantumlPlugin, {createCopyPlugin} from '../../src/index.js';
import {locatePlantUmlCore} from '../../src/assets.js';

/**
 * A real directory, because `configureWebpack` writes the patched engine into the site's
 * generated-files directory before it can name it in a copy pattern.
 */
const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plantuml-webpack-'));

afterAll(() => {
  fs.rmSync(siteDir, {recursive: true, force: true});
});

const context = {
  siteDir,
  generatedFilesDir: path.join(siteDir, '.docusaurus'),
  siteConfig: {baseUrl: '/plantuml-test/'},
} as never;

const webpackBundler = {name: 'webpack' as const, instance: {} as never};

/** Only `currentBundler` is read by this plugin; the loader helpers are never called. */
const utils: ConfigureWebpackUtils = {
  currentBundler: webpackBundler,
  getStyleLoaders: () => [],
  getJSLoader: () => ({}),
};

describe('runtime asset emission', () => {
  it('resolves the installed @plantuml/core package and its two runtime files', () => {
    const core = locatePlantUmlCore();
    expect(core.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(core.files).toHaveLength(2);
    expect(core.files[0]).toMatch(/viz-global\.js$/);
    expect(core.files[1]).toMatch(/plantuml\.js$/);
  });

  it('emits nothing into the server compilation', () => {
    const plugin = plantumlPlugin(context, {});
    const result = plugin.configureWebpack?.({}, true, utils, undefined);
    expect(result).toEqual({});
  });

  it('copies both runtime files into a version-namespaced directory for the client', () => {
    const plugin = plantumlPlugin(context, {stdlib: false});
    const result = plugin.configureWebpack?.({}, false, utils, undefined) as {
      plugins: Array<{patterns?: unknown}>;
    };

    expect(result.plugins).toHaveLength(1);
    const copyPlugin = result.plugins[0] as {patterns: Array<{from: string; to: string}>};
    expect(copyPlugin.patterns).toHaveLength(2);
    for (const pattern of copyPlugin.patterns) {
      expect(pattern.to).toMatch(/^assets\/plantuml-client-\d+\.\d+\.\d+-max32768\/\[name]\[ext]$/);
    }
    expect(copyPlugin.patterns.map((p) => p.from.split('/').pop())).toEqual([
      'viz-global.js',
      'plantuml.js',
    ]);
  });

  it('serves the patched engine, not the vendored one', () => {
    const plugin = plantumlPlugin(context, {stdlib: false});
    const result = plugin.configureWebpack?.({}, false, utils, undefined) as {
      plugins: Array<{patterns?: unknown}>;
    };
    const copyPlugin = result.plugins[0] as {patterns: Array<{from: string}>};
    const [viz, engine] = copyPlugin.patterns;

    // Only the engine is rewritten; Graphviz is copied straight out of node_modules.
    expect(viz?.from).toContain(`${path.sep}node_modules${path.sep}`);
    expect(engine?.from.startsWith(path.join(siteDir, '.docusaurus'))).toBe(true);
    expect(fs.readFileSync(engine?.from as string, 'utf8')).toContain(' (max 32768)');
  });

  it('emits every vendored standard library bundle beside the runtime', () => {
    const plugin = plantumlPlugin(context, {});
    const result = plugin.configureWebpack?.({}, false, utils, undefined) as {
      plugins: Array<{patterns?: unknown}>;
    };
    const copyPlugin = result.plugins[0] as {patterns: Array<{from: string; to: string}>};
    const stdlibPatterns = copyPlugin.patterns.filter((pattern) =>
      pattern.from.includes(`${path.sep}assets${path.sep}stdlib${path.sep}`),
    );

    expect(stdlibPatterns.length).toBeGreaterThan(0);
    expect(stdlibPatterns.map((pattern) => path.basename(pattern.from))).toContain('c4.min.js');
    // The directory carries the standard library revision so a refresh cannot be served
    // from a cache populated before it.
    for (const pattern of stdlibPatterns) {
      expect(pattern.to).toMatch(
        /^assets\/plantuml-client-\d+\.\d+\.\d+-max32768\/stdlib-[0-9a-f]{12}\/\[name]\[ext]$/,
      );
    }
  });
});

describe('bundler selection', () => {
  const patterns = [
    {from: '/a/viz-global.js', to: 'assets/x/[name][ext]', info: {minimized: true as const}},
  ];

  it('uses copy-webpack-plugin for the webpack bundler', () => {
    const plugin = createCopyPlugin(webpackBundler, patterns);
    expect(plugin.constructor.name).toBe('CopyPlugin');
  });

  it('uses CopyRspackPlugin when Rspack is the active bundler', () => {
    const CopyRspackPlugin = vi.fn();
    const plugin = createCopyPlugin(
      {name: 'rspack', instance: {CopyRspackPlugin} as never},
      patterns,
    );
    expect(CopyRspackPlugin).toHaveBeenCalledWith({patterns});
    expect(plugin).toBeInstanceOf(CopyRspackPlugin);
  });

  it('falls back to copy-webpack-plugin on Docusaurus 3.5.x, which has no currentBundler', () => {
    // `currentBundler` was introduced in Docusaurus 3.6 alongside Rspack support. On the
    // oldest supported release it is undefined, and webpack is the only bundler there.
    const plugin = createCopyPlugin(undefined, patterns);
    expect(plugin.constructor.name).toBe('CopyPlugin');
  });

  it('fails with an actionable message when Rspack lacks its copy plugin', () => {
    expect(() => createCopyPlugin({name: 'rspack', instance: {} as never}, patterns)).toThrow(
      /CopyRspackPlugin' is unavailable/,
    );
  });
});
