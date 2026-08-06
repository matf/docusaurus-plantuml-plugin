import {PLUGIN_NAME} from './constants.js';

/** Cache backing store for rendered SVG output. */
export type CacheMode = 'none' | 'memory' | 'session';

/** Which PlantUML colour scheme to render. `auto` follows the Docusaurus colour mode. */
export type DiagramTheme = 'auto' | 'light' | 'dark';

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
  /** Docusaurus plugin instance id, used when the plugin is registered more than once. */
  id?: string;
}

/** Plugin options after validation, with every default applied. */
export type ResolvedPlantUmlOptions = Required<Omit<PlantUmlPluginOptions, 'id' | 'languages'>> & {
  /** Normalized to lower case; matching is case-insensitive. */
  languages: string[];
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

function validateLanguages(value: unknown): string[] {
  if (value === undefined) return [...DEFAULT_OPTIONS.languages];
  if (!Array.isArray(value)) {
    fail(`options.languages must be an array of strings, received ${JSON.stringify(value)}.`);
  }
  if (value.length === 0) {
    fail('options.languages must contain at least one language.');
  }
  const normalized = value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      fail(
        `options.languages[${index}] must be a non-empty string, received ${JSON.stringify(entry)}.`,
      );
    }
    return entry.trim().toLowerCase();
  });
  const duplicates = normalized.filter((entry, index) => normalized.indexOf(entry) !== index);
  if (duplicates.length > 0) {
    fail(`options.languages contains duplicate entries: ${quoteList([...new Set(duplicates)])}.`);
  }
  return normalized;
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
    return {...DEFAULT_OPTIONS, languages: [...DEFAULT_OPTIONS.languages]};
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

  return {
    languages: validateLanguages(rawOptions.languages),
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
