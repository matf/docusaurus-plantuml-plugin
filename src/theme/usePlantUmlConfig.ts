import {useMemo} from 'react';

import useBaseUrl from '@docusaurus/useBaseUrl';
import {useAllPluginInstancesData} from '@docusaurus/useGlobalData';

import {PLUGIN_NAME} from '../constants.js';
import {
  DEFAULT_GRAPHVIZ_OPTIONS,
  DEFAULT_STDLIB_OPTIONS,
  type ResolvedPlantUmlOptions,
} from '../options.js';
import type {StdlibRuntimeManifest} from '../stdlibShared.js';

/** The standard library as the browser sees it: a URL to fetch bundles from, and an index. */
export interface StdlibRuntimeConfig {
  baseUrl: string;
  manifest: StdlibRuntimeManifest;
}

export interface PlantUmlRuntimeConfig {
  options: ResolvedPlantUmlOptions;
  /** Absolute, `baseUrl`-prefixed URL of the directory holding the runtime assets. */
  assetsBaseUrl: string;
  coreVersion: string;
  /** `null` when the standard library is switched off for this site. */
  stdlib: StdlibRuntimeConfig | null;
}

interface PlantUmlGlobalDataShape {
  options: ResolvedPlantUmlOptions;
  assetsDir: string;
  coreVersion: string;
  stdlib?: {dir: string; manifest: StdlibRuntimeManifest} | null;
}

function isGlobalData(value: unknown): value is PlantUmlGlobalDataShape {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PlantUmlGlobalDataShape>;
  return (
    typeof candidate.assetsDir === 'string' &&
    typeof candidate.coreVersion === 'string' &&
    typeof candidate.options === 'object' &&
    candidate.options !== null
  );
}

/**
 * Reads the plugin's configuration from Docusaurus global data.
 *
 * Returns `null` rather than throwing when the data is absent, so a misconfigured site shows
 * a contained error panel on the affected diagrams instead of failing to render the page.
 */
export function usePlantUmlConfig(): PlantUmlRuntimeConfig | null {
  const instances = useAllPluginInstancesData(PLUGIN_NAME, {failfast: false});
  const first = instances ? Object.values(instances).find(isGlobalData) : undefined;
  // `useBaseUrl` must be called unconditionally; the placeholder path is discarded below.
  const assetsBaseUrl = useBaseUrl(first ? first.assetsDir : '/');
  const stdlibBaseUrl = useBaseUrl(first?.stdlib ? first.stdlib.dir : '/');

  // Memoized because consumers use this object as an effect dependency. Returning a fresh
  // object on every render would restart the render effect on every state update, which
  // re-enters rendering forever.
  return useMemo(
    () =>
      first
        ? {
            options: withDefaults(first.options),
            assetsBaseUrl,
            coreVersion: first.coreVersion,
            stdlib: first.stdlib ? {baseUrl: stdlibBaseUrl, manifest: first.stdlib.manifest} : null,
          }
        : null,
    [first, assetsBaseUrl, stdlibBaseUrl],
  );
}

/**
 * Fills in the nested option groups when they are missing from global data.
 *
 * `resolveOptions` always produces them, so this only matters for data written by an older
 * version of the plugin — a stale `.docusaurus` cache surviving an upgrade, most plausibly.
 * Substituting the defaults keeps such a site rendering instead of failing on a missing key.
 */
function withDefaults(options: ResolvedPlantUmlOptions): ResolvedPlantUmlOptions {
  if (options.graphviz && options.stdlib) return options;
  return {
    ...options,
    graphviz: options.graphviz ?? DEFAULT_GRAPHVIZ_OPTIONS,
    stdlib: options.stdlib ?? DEFAULT_STDLIB_OPTIONS,
  };
}
