import {useMemo} from 'react';

import useBaseUrl from '@docusaurus/useBaseUrl';
import {useAllPluginInstancesData} from '@docusaurus/useGlobalData';

import {PLUGIN_NAME} from '../constants.js';
import type {ResolvedPlantUmlOptions} from '../options.js';

export interface PlantUmlRuntimeConfig {
  options: ResolvedPlantUmlOptions;
  /** Absolute, `baseUrl`-prefixed URL of the directory holding the runtime assets. */
  assetsBaseUrl: string;
  coreVersion: string;
}

interface PlantUmlGlobalDataShape {
  options: ResolvedPlantUmlOptions;
  assetsDir: string;
  coreVersion: string;
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

  // Memoized because consumers use this object as an effect dependency. Returning a fresh
  // object on every render would restart the render effect on every state update, which
  // re-enters rendering forever.
  return useMemo(
    () => (first ? {options: first.options, assetsBaseUrl, coreVersion: first.coreVersion} : null),
    [first, assetsBaseUrl],
  );
}
