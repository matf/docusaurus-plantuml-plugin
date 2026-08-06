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
import {assetsDirForVersion, DEFAULT_PLUGIN_ID, PLUGIN_NAME} from './constants.js';
import {
  resolveOptions,
  type PlantUmlPluginOptions,
  type ResolvedPlantUmlOptions,
} from './options.js';

export type {
  CacheMode,
  DiagramTheme,
  PlantUmlPluginOptions,
  ResolvedPlantUmlOptions,
} from './options.js';
export {DEFAULT_OPTIONS, PlantUmlOptionsError, resolveOptions} from './options.js';
export {PLUGIN_ID, PLUGIN_NAME} from './constants.js';

/** Shape of the data this plugin publishes to the browser through Docusaurus global data. */
export interface PlantUmlGlobalData {
  options: ResolvedPlantUmlOptions;
  /** `baseUrl`-relative directory holding `viz-global.js` and `plantuml.js`. */
  assetsDir: string;
  /** Installed `@plantuml/core` version; part of the cache key. */
  coreVersion: string;
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

export function createCopyPlugin(
  currentBundler: ConfigureWebpackUtils['currentBundler'],
  patterns: CopyPattern[],
): WebpackPluginInstance {
  if (currentBundler.name === 'rspack') {
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
  _context: LoadContext,
  options: PlantUmlPluginOptions = {},
): Plugin<void> {
  // Docusaurus already ran `validateOptions`, but the plugin function is also callable
  // directly (and from JS configs that skip validation), so normalize defensively.
  const resolved = resolveOptions(options);
  const core = locatePlantUmlCore();
  const assetsDir = assetsDirForVersion(core.version);

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
      };
      actions.setGlobalData(globalData);
    },

    configureWebpack(_config, isServer, utils) {
      // The PlantUML runtime is browser-only; emitting it from the server compilation
      // would duplicate ~8 MB into the SSR bundle output for no benefit.
      if (isServer) {
        return {};
      }
      const patterns: CopyPattern[] = core.files.map((absolutePath) => ({
        from: absolutePath,
        to: `${assetsDir}/[name][ext]`,
        // These files are already minified upstream; re-processing 8 MB is wasted work.
        info: {minimized: true},
      }));
      return {plugins: [createCopyPlugin(utils.currentBundler, patterns)]};
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
