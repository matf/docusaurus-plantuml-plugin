import {PLUGIN_NAME} from './constants.js';

/** Cache backing store for rendered SVG output. */
export type CacheMode = 'none' | 'memory' | 'session';

/** Which PlantUML colour scheme to render. `auto` follows the Docusaurus colour mode. */
export type DiagramTheme = 'auto' | 'light' | 'dark';

/**
 * Graphviz layout engines available in the bundled build.
 *
 * Taken from `Viz.engines` of the `viz-global.js` that `@plantuml/core` ships. The loader
 * re-checks the requested engine against the live list at render time, so this array only has
 * to be good enough to reject typos in `docusaurus.config.*` at build time.
 */
export const GRAPHVIZ_ENGINES = [
  'circo',
  'dot',
  'fdp',
  'neato',
  'nop',
  'nop1',
  'nop2',
  'osage',
  'patchwork',
  'sfdp',
  'twopi',
] as const;

export type GraphvizEngine = (typeof GRAPHVIZ_ENGINES)[number];

/** Graphviz/DOT options, nested so the two engines cannot collide in the option namespace. */
export interface GraphvizOptions {
  /** Intercept DOT fences at all. Set to `false` to leave `dot` code blocks as code blocks. */
  enabled?: boolean;
  /** Fenced-code languages treated as Graphviz DOT. Matched case-insensitively. */
  languages?: string[];
  /** Default layout engine used when a fence does not name one. */
  engine?: GraphvizEngine;
  /** Allow a fence to select a different layout engine with `engine=neato`. */
  allowEngineOverride?: boolean;
  /**
   * Refuse to render sources larger than this many UTF-8 bytes.
   *
   * Graphviz renders synchronously, so an enormous graph blocks the main thread; the guard
   * turns a frozen tab into an explanatory panel. See `docs/adr/0004-graphviz-engine-reuse.md`.
   */
  maxSourceBytes?: number;
  /**
   * Render on a transparent background instead of Graphviz's opaque white, so diagrams sit on
   * the page background in both colour modes.
   */
  transparentBackground?: boolean;
}

/** Graphviz options after validation, with every default applied. */
export type ResolvedGraphvizOptions = Required<Omit<GraphvizOptions, 'languages'>> & {
  /** Normalized to lower case; matching is case-insensitive. */
  languages: string[];
};

/**
 * Options accepted by the plugin in `docusaurus.config.*`.
 *
 * Every field is optional; see {@link DEFAULT_OPTIONS} for the defaults.
 */
export interface PlantUmlPluginOptions {
  /** Fenced-code languages treated as PlantUML. Matched case-insensitively. */
  languages?: string[];
  /** Diagram colour scheme. `auto` follows the Docusaurus light/dark colour mode. */
  theme?: DiagramTheme;
  /** Render a diagram only once it scrolls near the viewport. */
  lazy?: boolean;
  /** Where to cache rendered SVG output. */
  cache?: CacheMode;
  /** Sanitize rendered SVG before inserting it into the page. Disable at your own risk. */
  sanitizeSvg?: boolean;
  /** Include the PlantUML source in a `<details>` block when rendering fails. */
  showSourceOnError?: boolean;
  /** Abort a single render after this many milliseconds. */
  renderTimeoutMs?: number;
  /** Maximum number of cached SVG entries kept per browsing session. */
  cacheMaxEntries?: number;
  /**
   * Let readers zoom and pan rendered diagrams, with a small control toolbar.
   * Override for a single fence with `zoom` or `zoom=false` in its metastring.
   */
  zoom?: boolean;
  /** Graphviz/DOT diagram support. See {@link GraphvizOptions}. */
  graphviz?: GraphvizOptions;
  /** Docusaurus plugin instance id, used when the plugin is registered more than once. */
  id?: string;
}

/** Plugin options after validation, with every default applied. */
export type ResolvedPlantUmlOptions = Required<
  Omit<PlantUmlPluginOptions, 'id' | 'languages' | 'graphviz'>
> & {
  /** Normalized to lower case; matching is case-insensitive. */
  languages: string[];
  graphviz: ResolvedGraphvizOptions;
};

export const DEFAULT_GRAPHVIZ_OPTIONS: ResolvedGraphvizOptions = {
  enabled: true,
  languages: ['dot', 'graphviz', 'gv'],
  engine: 'dot',
  allowEngineOverride: true,
  maxSourceBytes: 100_000,
  transparentBackground: true,
};

export const DEFAULT_OPTIONS: ResolvedPlantUmlOptions = {
  languages: ['plantuml', 'puml'],
  theme: 'auto',
  lazy: true,
  cache: 'memory',
  sanitizeSvg: true,
  showSourceOnError: true,
  renderTimeoutMs: 20_000,
  cacheMaxEntries: 50,
  zoom: true,
  graphviz: DEFAULT_GRAPHVIZ_OPTIONS,
};

const CACHE_MODES: readonly CacheMode[] = ['none', 'memory', 'session'];
const THEMES: readonly DiagramTheme[] = ['auto', 'light', 'dark'];

const MIN_RENDER_TIMEOUT_MS = 100;
const MAX_RENDER_TIMEOUT_MS = 600_000;

/** Thrown for invalid plugin options so Docusaurus fails the build with a useful message. */
export class PlantUmlOptionsError extends Error {
  constructor(message: string) {
    super(`[${PLUGIN_NAME}] ${message}`);
    this.name = 'PlantUmlOptionsError';
  }
}

function fail(message: string): never {
  throw new PlantUmlOptionsError(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function quoteList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

function validateBoolean(value: unknown, key: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    fail(`options.${key} must be a boolean, received ${JSON.stringify(value)}.`);
  }
  return value;
}

/** Shared by `options.languages` and `options.graphviz.languages`; `key` names the one in play. */
function validateLanguages(value: unknown, key: string, fallback: readonly string[]): string[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value)) {
    fail(`options.${key} must be an array of strings, received ${JSON.stringify(value)}.`);
  }
  if (value.length === 0) {
    fail(`options.${key} must contain at least one language.`);
  }
  const normalized = value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      fail(
        `options.${key}[${index}] must be a non-empty string, received ${JSON.stringify(entry)}.`,
      );
    }
    return entry.trim().toLowerCase();
  });
  const duplicates = normalized.filter((entry, index) => normalized.indexOf(entry) !== index);
  if (duplicates.length > 0) {
    fail(`options.${key} contains duplicate entries: ${quoteList([...new Set(duplicates)])}.`);
  }
  return normalized;
}

function validateMaxSourceBytes(value: unknown): number {
  if (value === undefined) return DEFAULT_GRAPHVIZ_OPTIONS.maxSourceBytes;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    fail(
      'options.graphviz.maxSourceBytes must be a positive integer, ' +
        `received ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

/**
 * Validates the nested `graphviz` group.
 *
 * Unknown keys are rejected here too: a typo nested one level deep is exactly as silent — and
 * exactly as confusing — as a typo at the top level.
 */
function validateGraphviz(value: unknown): ResolvedGraphvizOptions {
  if (value === undefined) {
    return {...DEFAULT_GRAPHVIZ_OPTIONS, languages: [...DEFAULT_GRAPHVIZ_OPTIONS.languages]};
  }
  if (!isPlainObject(value)) {
    fail(`options.graphviz must be an object, received ${JSON.stringify(value)}.`);
  }

  const allowedKeys = [
    'enabled',
    'languages',
    'engine',
    'allowEngineOverride',
    'maxSourceBytes',
    'transparentBackground',
  ];
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) {
    fail(
      `Unknown option${unknownKeys.length > 1 ? 's' : ''} ` +
        `${quoteList(unknownKeys.map((key) => `graphviz.${key}`))}. ` +
        `Supported options: ${quoteList(allowedKeys.map((key) => `graphviz.${key}`))}.`,
    );
  }

  const {engine} = value;
  if (engine !== undefined && !GRAPHVIZ_ENGINES.includes(engine as GraphvizEngine)) {
    fail(
      `options.graphviz.engine must be one of ${quoteList(GRAPHVIZ_ENGINES)}, ` +
        `received ${JSON.stringify(engine)}.`,
    );
  }

  return {
    enabled: validateBoolean(value.enabled, 'graphviz.enabled', DEFAULT_GRAPHVIZ_OPTIONS.enabled),
    languages: validateLanguages(
      value.languages,
      'graphviz.languages',
      DEFAULT_GRAPHVIZ_OPTIONS.languages,
    ),
    engine: (engine as GraphvizEngine | undefined) ?? DEFAULT_GRAPHVIZ_OPTIONS.engine,
    allowEngineOverride: validateBoolean(
      value.allowEngineOverride,
      'graphviz.allowEngineOverride',
      DEFAULT_GRAPHVIZ_OPTIONS.allowEngineOverride,
    ),
    maxSourceBytes: validateMaxSourceBytes(value.maxSourceBytes),
    transparentBackground: validateBoolean(
      value.transparentBackground,
      'graphviz.transparentBackground',
      DEFAULT_GRAPHVIZ_OPTIONS.transparentBackground,
    ),
  };
}

function validateRenderTimeout(value: unknown): number {
  if (value === undefined) return DEFAULT_OPTIONS.renderTimeoutMs;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`options.renderTimeoutMs must be a finite number, received ${JSON.stringify(value)}.`);
  }
  if (!Number.isInteger(value)) {
    fail(`options.renderTimeoutMs must be an integer, received ${value}.`);
  }
  if (value < MIN_RENDER_TIMEOUT_MS || value > MAX_RENDER_TIMEOUT_MS) {
    fail(
      `options.renderTimeoutMs must be between ${MIN_RENDER_TIMEOUT_MS} and ` +
        `${MAX_RENDER_TIMEOUT_MS} milliseconds, received ${value}.`,
    );
  }
  return value;
}

function validateCacheMaxEntries(value: unknown): number {
  if (value === undefined) return DEFAULT_OPTIONS.cacheMaxEntries;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    fail(`options.cacheMaxEntries must be a positive integer, received ${JSON.stringify(value)}.`);
  }
  return value;
}

/**
 * Validates raw plugin options and applies defaults.
 *
 * Unknown keys are rejected rather than ignored: a typo in `docusaurus.config.ts` would
 * otherwise silently disable the option the author meant to set.
 */
export function resolveOptions(rawOptions: unknown): ResolvedPlantUmlOptions {
  if (rawOptions === undefined || rawOptions === null) {
    return {
      ...DEFAULT_OPTIONS,
      languages: [...DEFAULT_OPTIONS.languages],
      graphviz: {...DEFAULT_GRAPHVIZ_OPTIONS, languages: [...DEFAULT_GRAPHVIZ_OPTIONS.languages]},
    };
  }
  if (!isPlainObject(rawOptions)) {
    fail(`options must be an object, received ${JSON.stringify(rawOptions)}.`);
  }

  const allowedKeys = new Set([
    'languages',
    'theme',
    'lazy',
    'cache',
    'sanitizeSvg',
    'showSourceOnError',
    'renderTimeoutMs',
    'cacheMaxEntries',
    'zoom',
    'graphviz',
    // Docusaurus injects `id` for multi-instance plugins.
    'id',
  ]);
  const unknownKeys = Object.keys(rawOptions).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    fail(
      `Unknown option${unknownKeys.length > 1 ? 's' : ''} ${quoteList(unknownKeys)}. ` +
        `Supported options: ${quoteList([...allowedKeys].filter((key) => key !== 'id'))}.`,
    );
  }

  const {theme, cache} = rawOptions;
  if (theme !== undefined && !THEMES.includes(theme as DiagramTheme)) {
    fail(`options.theme must be one of ${quoteList(THEMES)}, received ${JSON.stringify(theme)}.`);
  }
  if (cache !== undefined && !CACHE_MODES.includes(cache as CacheMode)) {
    fail(
      `options.cache must be one of ${quoteList(CACHE_MODES)}, received ${JSON.stringify(cache)}.`,
    );
  }

  const languages = validateLanguages(rawOptions.languages, 'languages', DEFAULT_OPTIONS.languages);
  const graphviz = validateGraphviz(rawOptions.graphviz);

  // A fence has exactly one language, so a language claimed by both engines would make the
  // rendered output depend on the order the wrapper happens to check them in. Reject it.
  if (graphviz.enabled) {
    const claimedTwice = graphviz.languages.filter((entry) => languages.includes(entry));
    if (claimedTwice.length > 0) {
      fail(
        `options.graphviz.languages and options.languages both claim ` +
          `${quoteList(claimedTwice)}. A fence language can only belong to one engine.`,
      );
    }
  }

  return {
    languages,
    graphviz,
    theme: (theme as DiagramTheme | undefined) ?? DEFAULT_OPTIONS.theme,
    lazy: validateBoolean(rawOptions.lazy, 'lazy', DEFAULT_OPTIONS.lazy),
    cache: (cache as CacheMode | undefined) ?? DEFAULT_OPTIONS.cache,
    sanitizeSvg: validateBoolean(
      rawOptions.sanitizeSvg,
      'sanitizeSvg',
      DEFAULT_OPTIONS.sanitizeSvg,
    ),
    showSourceOnError: validateBoolean(
      rawOptions.showSourceOnError,
      'showSourceOnError',
      DEFAULT_OPTIONS.showSourceOnError,
    ),
    renderTimeoutMs: validateRenderTimeout(rawOptions.renderTimeoutMs),
    cacheMaxEntries: validateCacheMaxEntries(rawOptions.cacheMaxEntries),
    zoom: validateBoolean(rawOptions.zoom, 'zoom', DEFAULT_OPTIONS.zoom),
  };
}
