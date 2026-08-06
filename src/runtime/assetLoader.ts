import {PLANTUML_MODULE_FILENAME, VIZ_SCRIPT_FILENAME} from '../constants.js';
import {PlantUmlError} from './errors.js';
import type {PlantUmlCoreModule, VizGlobal, VizInstance} from './types.js';

/**
 * Loads the browser runtimes, each at most once per page session.
 *
 * There are two, and they are loaded independently:
 *
 * - `viz-global.js` (~1.4 MB) is a classic script that installs Graphviz on `window.Viz`. It
 *   is what renders DOT fences, and PlantUML also needs it for its own layout.
 * - `plantuml.js` (~6.8 MB) is an ES module that renders PlantUML fences. It requires
 *   `window.Viz` to already exist, so it builds on the first.
 *
 * The split matters: a page with only DOT diagrams must never pay for the 6.8 MB PlantUML
 * engine. Both files are served from the Docusaurus origin under `baseUrl`, never from a CDN.
 */

const SCRIPT_MARKER = 'data-plantuml-runtime';

export interface LoadRuntimeOptions {
  /** Absolute, `baseUrl`-prefixed directory URL containing the two runtime files. */
  assetsBaseUrl: string;
  /** Give up if the runtime has not loaded within this many milliseconds. */
  timeoutMs: number;
  /**
   * Seam for tests: the real implementation is a bundler-ignored dynamic import, which
   * cannot run under a Node test runner.
   */
  importModule?: (url: string) => Promise<unknown>;
}

let cachedRuntime: Promise<PlantUmlCoreModule> | null = null;
let cachedViz: Promise<VizInstance> | null = null;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function joinUrl(base: string, file: string): string {
  return `${base.replace(/\/+$/, '')}/${file}`;
}

function defaultImportModule(url: string): Promise<unknown> {
  // webpackIgnore keeps this a real runtime import of a copied asset instead of letting
  // webpack try to bundle the 6.8 MB engine into the site's JavaScript.
  return import(/* webpackIgnore: true */ url);
}

/**
 * Injects `viz-global.js` as a classic script, reusing an existing tag.
 *
 * Client-side navigation re-mounts diagram components but does not reload the document, so
 * the marker attribute is what keeps a second `<script>` from ever being appended.
 */
function loadVizGlobal(url: string, timeoutMs: number): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[${SCRIPT_MARKER}]`);
  if (existing) {
    if (existing.dataset.plantumlRuntimeState === 'loaded') return Promise.resolve();
    if (existing.dataset.plantumlRuntimeState === 'error') {
      return Promise.reject(
        new PlantUmlError('load', `Failed to load the Graphviz runtime from ${url}.`),
      );
    }
    return waitForScript(existing, url, timeoutMs);
  }

  const script = document.createElement('script');
  script.setAttribute(SCRIPT_MARKER, '');
  script.dataset.plantumlRuntimeState = 'loading';
  script.async = false;
  script.src = url;
  const promise = waitForScript(script, url, timeoutMs);
  document.head.appendChild(script);
  return promise;
}

function waitForScript(script: HTMLScriptElement, url: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
      fn();
    };
    const onLoad = () => {
      script.dataset.plantumlRuntimeState = 'loaded';
      finish(resolve);
    };
    const onError = () => {
      script.dataset.plantumlRuntimeState = 'error';
      finish(() =>
        reject(
          new PlantUmlError(
            'load',
            `Failed to load the Graphviz runtime from ${url}. ` +
              'Check that the asset is served under your Docusaurus baseUrl with a JavaScript MIME type.',
          ),
        ),
      );
    };
    const timer = setTimeout(() => {
      finish(() =>
        reject(new PlantUmlError('load', `Timed out after ${timeoutMs} ms loading ${url}.`)),
      );
    }, timeoutMs);

    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
  });
}

function assertCoreModule(value: unknown, url: string): PlantUmlCoreModule {
  const candidate = value as Partial<PlantUmlCoreModule> | null;
  if (
    !candidate ||
    typeof candidate.render !== 'function' ||
    typeof candidate.renderToString !== 'function'
  ) {
    throw new PlantUmlError(
      'load',
      `The module at ${url} does not export the expected PlantUML render functions. ` +
        'This usually means a proxy or service worker returned the wrong file.',
    );
  }
  return candidate as PlantUmlCoreModule;
}

/**
 * Checks that the loaded script really installed the Viz.js API this plugin renders DOT with.
 *
 * `viz-global.js` reaches the browser via `@plantuml/core`, which ships it for PlantUML's own
 * layout rather than for this plugin's benefit. Asserting the shape here means a future
 * `@plantuml/core` that changed engines fails with a message naming the cause, instead of a
 * `TypeError` on `Viz.instance` several frames away. See `docs/adr/0004-graphviz-engine-reuse.md`.
 */
function assertVizGlobal(url: string): VizGlobal {
  const candidate = (globalThis as {Viz?: Partial<VizGlobal>}).Viz;
  if (
    !candidate ||
    typeof candidate.instance !== 'function' ||
    !Array.isArray(candidate.engines) ||
    typeof candidate.graphvizVersion !== 'string'
  ) {
    throw new PlantUmlError(
      'load',
      `The script at ${url} did not install the expected Graphviz (Viz.js) API on window.Viz. ` +
        'This usually means a proxy or service worker returned the wrong file, or that the ' +
        'installed @plantuml/core no longer bundles Viz.js.',
    );
  }
  return candidate as VizGlobal;
}

/**
 * Resolves a ready-to-use Graphviz instance, loading `viz-global.js` on first use.
 *
 * One instance serves every DOT diagram on the page: Viz.js documents that an instance renders
 * multiple graphs, and a 200-render soak with syntax errors interleaved left it fully healthy,
 * so there is no reason to pay the instantiation cost per diagram.
 */
export function loadVizRuntime(options: LoadRuntimeOptions): Promise<VizInstance> {
  if (!isBrowser()) {
    return Promise.reject(
      new PlantUmlError(
        'load',
        'The Graphviz runtime cannot be loaded during server-side rendering.',
      ),
    );
  }
  if (cachedViz) return cachedViz;

  const vizUrl = joinUrl(options.assetsBaseUrl, VIZ_SCRIPT_FILENAME);
  const viz = loadVizGlobal(vizUrl, options.timeoutMs)
    .then(() => assertVizGlobal(vizUrl).instance())
    .catch((error: unknown) => {
      // Clearing the cache lets a later diagram retry rather than inherit a permanent failure.
      cachedViz = null;
      throw error instanceof PlantUmlError
        ? error
        : new PlantUmlError('load', `Failed to initialize the Graphviz engine from ${vizUrl}.`, {
            cause: error,
          });
    });

  cachedViz = viz;
  return viz;
}

/**
 * Resolves the PlantUML engine, loading it on first use.
 *
 * Concurrent callers share one in-flight promise; a failed load clears the cache so a later
 * diagram can retry rather than inheriting a permanent failure.
 */
export function loadPlantUmlRuntime(options: LoadRuntimeOptions): Promise<PlantUmlCoreModule> {
  if (!isBrowser()) {
    return Promise.reject(
      new PlantUmlError(
        'load',
        'The PlantUML runtime cannot be loaded during server-side rendering.',
      ),
    );
  }
  if (cachedRuntime) return cachedRuntime;

  const {assetsBaseUrl, timeoutMs, importModule = defaultImportModule} = options;
  const vizUrl = joinUrl(assetsBaseUrl, VIZ_SCRIPT_FILENAME);
  const moduleUrl = joinUrl(assetsBaseUrl, PLANTUML_MODULE_FILENAME);

  const runtime = loadVizGlobal(vizUrl, timeoutMs)
    .then(() => importModule(moduleUrl))
    .then((module) => assertCoreModule(module, moduleUrl))
    .catch((error: unknown) => {
      cachedRuntime = null;
      throw error instanceof PlantUmlError
        ? error
        : new PlantUmlError('load', `Failed to load the PlantUML engine from ${moduleUrl}.`, {
            cause: error,
          });
    });

  cachedRuntime = runtime;
  return runtime;
}

/** Whether the PlantUML runtime has been requested on this page. For tests and diagnostics. */
export function isRuntimeRequested(): boolean {
  return cachedRuntime !== null;
}

/** Whether the Graphviz runtime has been requested on this page. For tests and diagnostics. */
export function isVizRuntimeRequested(): boolean {
  return cachedViz !== null;
}

/** Test-only: forgets both cached runtimes and removes the injected script tag. */
export function resetRuntimeLoader(): void {
  cachedRuntime = null;
  cachedViz = null;
  if (typeof document !== 'undefined') {
    document.querySelectorAll(`script[${SCRIPT_MARKER}]`).forEach((node) => node.remove());
  }
}
