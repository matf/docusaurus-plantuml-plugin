/**
 * Identifiers shared by the Node-side plugin and the browser-side theme components.
 *
 * `PLUGIN_NAME` is the Docusaurus plugin name and therefore the key used for global data,
 * so it must stay stable and identical on both sides of the SSR boundary. It is deliberately
 * independent of the npm package name so that renaming the package cannot break global-data
 * lookups in already-built sites.
 */
export const PLUGIN_ID = 'plantuml-client';

/** Docusaurus' own default plugin instance id, mirrored to avoid a runtime import. */
export const DEFAULT_PLUGIN_ID = 'default';

export const PLUGIN_NAME = `docusaurus-plugin-${PLUGIN_ID}`;

/** Directory (relative to `baseUrl`) that the PlantUML runtime assets are emitted into. */
export function assetsDirForVersion(coreVersion: string): string {
  return `assets/${PLUGIN_ID}-${coreVersion}`;
}

export const VIZ_SCRIPT_FILENAME = 'viz-global.js';
export const PLANTUML_MODULE_FILENAME = 'plantuml.js';

/** `data-*` attribute names, kept in one place because tests and docs depend on them. */
export const DATA_ATTR = {
  diagram: 'data-plantuml-diagram',
  status: 'data-plantuml-status',
  theme: 'data-plantuml-theme',
} as const;
