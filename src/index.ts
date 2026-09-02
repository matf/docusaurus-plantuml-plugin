import path from 'node:path';
import {fileURLToPath} from 'node:url';

import type {
  ConfigureWebpackUtils,
  LoadContext,
  Plugin,
  PluginOptions as DocusaurusPluginOptions,
} from '@docusaurus/types';
import CopyWebpackPlugin from 'copy-webpack-plugin';
import type {WebpackPluginInstance} from 'webpack';

import {locatePlantUmlCore} from './assets.js';
import {
  assetsDirForVersion,
  DEFAULT_PLUGIN_ID,
  PLANTUML_MODULE_FILENAME,
  PLUGIN_NAME,
} from './constants.js';
import {resolvePatchedEngine} from './enginePatch.js';
import {
  resolveOptions,
  type PlantUmlPluginOptions,
  type ResolvedPlantUmlOptions,
} from './options.js';
import {resolveStdlibAssets, type StdlibRuntimeManifest} from './stdlib.js';

export type {
  CacheMode,
  DiagramTheme,
  PlantUmlPluginOptions,
  ResolvedPlantUmlOptions,
  StdlibOptions,
  ResolvedStdlibOptions,
} from './options.js';
export {DEFAULT_OPTIONS, PlantUmlOptionsError, resolveOptions} from './options.js';
export {PLUGIN_ID, PLUGIN_NAME} from './constants.js';
export type {StdlibRuntimeManifest} from './stdlib.js';

/** Shape of the data this plugin publishes to the browser through Docusaurus global data. */
export interface PlantUmlGlobalData {
  options: ResolvedPlantUmlOptions;
  /** `baseUrl`-relative directory holding `viz-global.js` and `plantuml.js`. */
  assetsDir: string;
  /** Installed `@plantuml/core` version; part of the cache key. */
  coreVersion: string;
  /**
   * `baseUrl`-relative directory holding the standard library bundles, and what is in it.
   * `null` when the standard library is switched off.
   */
  stdlib: {dir: string; manifest: StdlibRuntimeManifest} | null;
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** One copy pattern per runtime file, shared by the webpack and Rspack code paths. */
interface CopyPattern {
  from: string;
  to: string;
  info: {minimized: true};
}

/**
 * Rspack ships its own copy plugin instead of accepting `copy-webpack-plugin`. Docusaurus
 * types `currentBundler.instance` as `typeof webpack` for both bundlers, so the Rspack-only
 * export has to be reached through a narrow structural type rather than a cast to `any`.
 */
interface RspackNamespace {
  CopyRspackPlugin?: new (options: {patterns: CopyPattern[]}) => WebpackPluginInstance;
}

/**
 * Selects the copy plugin for the bundler in use.
 *
 * `currentBundler` only exists from Docusaurus 3.6, where Rspack support was added. On 3.5.x
 * it is `undefined` and webpack is the only bundler, so an absent value is not an error.
 */
export function createCopyPlugin(
  currentBundler: ConfigureWebpackUtils['currentBundler'] | undefined,
  patterns: CopyPattern[],
): WebpackPluginInstance {
  if (currentBundler?.name === 'rspack') {
    const {CopyRspackPlugin} = currentBundler.instance as unknown as RspackNamespace;
    if (!CopyRspackPlugin) {
      throw new Error(
        `[${PLUGIN_NAME}] The Rspack bundler is active but 'CopyRspackPlugin' is unavailable, ` +
          'so the PlantUML runtime assets cannot be emitted. Upgrade @docusaurus/faster, or ' +
          'disable `future.v4` to use the webpack bundler.',
      );
    }
    return new CopyRspackPlugin({patterns});
  }
  return new CopyWebpackPlugin({patterns});
}

export default function plantumlPlugin(
  context: LoadContext,
  options: PlantUmlPluginOptions = {},
): Plugin<void> {
  // Docusaurus already ran `validateOptions`, but the plugin function is also callable
  // directly (and from JS configs that skip validation), so normalize defensively.
  const resolved = resolveOptions(options);
  const core = locatePlantUmlCore();
  const assetsDir = assetsDirForVersion(core.version);

  const stdlib = resolveStdlibAssets({
    options: resolved.stdlib,
    currentDir,
    siteDir: context.siteDir,
    cacheDir: context.generatedFilesDir,
  });
  // The revision is part of the directory name, not just of the cache key: refreshing the
  // standard library without moving the URL would leave readers on a cached bundle from
  // before the refresh, and the mismatch would surface as an unresolved include.
  const stdlibDir = stdlib ? `${assetsDir}/stdlib-${stdlib.manifest.revision}` : null;

  return {
    name: PLUGIN_NAME,

    getThemePath() {
      return path.join(currentDir, 'theme');
    },

    contentLoaded({actions}) {
      const globalData: PlantUmlGlobalData = {
        options: resolved,
        assetsDir,
        coreVersion: core.version,
        stdlib: stdlib && stdlibDir ? {dir: stdlibDir, manifest: stdlib.manifest} : null,
      };
      actions.setGlobalData(globalData);
    },

    configureWebpack(_config, isServer, utils) {
      // The PlantUML runtime is browser-only; emitting it from the server compilation
      // would duplicate ~8 MB into the SSR bundle output for no benefit.
      if (isServer) {
        return {};
      }
      // The engine is patched to raise its 4096-point diagram ceiling, so what is emitted is
      // a generated file rather than the vendored one. It happens here rather than in the
      // plugin factory so that `swizzle`, `write-translations` and the server compilation do
      // not each pay to read and rewrite 7 MB for output they never emit.
      const engine = resolvePatchedEngine({
        vendoredPath: path.join(core.packageDir, PLANTUML_MODULE_FILENAME),
        coreVersion: core.version,
        siteDir: context.siteDir,
        cacheDir: context.generatedFilesDir,
      });
      const patterns: CopyPattern[] = core.files.map((absolutePath) => ({
        from: path.basename(absolutePath) === PLANTUML_MODULE_FILENAME ? engine : absolutePath,
        to: `${assetsDir}/[name][ext]`,
        // These files are already minified upstream; re-processing 8 MB is wasted work.
        info: {minimized: true},
      }));
      if (stdlib && stdlibDir) {
        patterns.push(
          ...stdlib.files.map((absolutePath) => ({
            from: absolutePath,
            to: `${stdlibDir}/[name][ext]`,
            info: {minimized: true} as const,
          })),
        );
      }
      // Optional chaining, not laziness: `currentBundler` is absent on Docusaurus 3.5.x.
      return {plugins: [createCopyPlugin(utils?.currentBundler, patterns)]};
    },
  };
}

/**
 * Docusaurus option validation hook. Runs before the plugin function so configuration
 * mistakes fail the build immediately with an actionable message.
 *
 * Docusaurus relies on the returned options carrying a plugin instance `id`; it normally
 * comes from the Joi helper's default, so opting out of Joi means supplying it here.
 */
export function validateOptions({
  options,
}: {
  options: PlantUmlPluginOptions & Partial<DocusaurusPluginOptions>;
}): PlantUmlPluginOptions & DocusaurusPluginOptions {
  resolveOptions(options);
  return {...options, id: options.id ?? DEFAULT_PLUGIN_ID};
}
