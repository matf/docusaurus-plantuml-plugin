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

/**
 * `data-*` attribute names, kept in one place because tests and docs depend on them.
 *
 * The `data-plantuml-*` prefix is historical: it predates Graphviz support and is applied to
 * every diagram this plugin renders, whatever the engine. Renaming it would break author CSS
 * for no functional gain, so {@link DATA_ATTR.engine} was added alongside it instead —
 * that is the attribute to select on when the two engines need different styling.
 */
export const DATA_ATTR = {
  diagram: 'data-plantuml-diagram',
  /** `"plantuml"` or `"graphviz"` — which engine produced this figure. */
  engine: 'data-diagram-engine',
  /** Graphviz layout engine (`dot`, `neato`, …). Absent on PlantUML figures. */
  layout: 'data-diagram-layout',
  status: 'data-plantuml-status',
  theme: 'data-plantuml-theme',
  /** `"true"` on the figure when the diagram is zoomable. */
  interactive: 'data-plantuml-interactive',
  /**
   * Current scale, on the viewport rather than the figure. Keeping it off the figure means
   * the imperative zoom writes can never race React's attribute diffing.
   */
  zoom: 'data-plantuml-zoom',
  /** `"true"` on the figure while the diagram fills the browser viewport. */
  maximized: 'data-plantuml-maximized',
  /** `"true"` on the figure while the source panel is open. */
  sourceOpen: 'data-plantuml-source-open',
  /** `"true"` on the figure while the minimap is open. */
  minimapOpen: 'data-plantuml-minimap-open',
  /** `"true"` on the figure while the search bar is open. */
  searchOpen: 'data-plantuml-search-open',
  /** On every `<text>` element in the rendered SVG that matches the search query. */
  searchMatch: 'data-plantuml-search-match',
  /** On the one match the search is currently focused on; always also a `searchMatch`. */
  searchCurrent: 'data-plantuml-search-current',
} as const;
