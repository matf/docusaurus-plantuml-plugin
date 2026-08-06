import {PLANTUML_MODULE_FILENAME, VIZ_SCRIPT_FILENAME} from '../constants.js';
import {PlantUmlError} from './errors.js';
import type {PlantUmlCoreModule} from './types.js';

/**
 * Loads the PlantUML browser runtime exactly once per page session.
 *
 * `viz-global.js` is a classic script that installs the Graphviz layout engine on `window`,
 * and it must have finished executing before `plantuml.js` is imported. Both files are
 * served from the Docusaurus origin under `baseUrl`, never from a CDN.
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
        new PlantUmlError('load', `Failed to load the PlantUML Graphviz runtime from ${url}.`),
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
            `Failed to load the PlantUML Graphviz runtime from ${url}. ` +
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

/** Whether the runtime has been requested on this page. Used by tests and diagnostics. */
export function isRuntimeRequested(): boolean {
  return cachedRuntime !== null;
}

/** Test-only: forgets the cached runtime and removes the injected script tag. */
export function resetRuntimeLoader(): void {
  cachedRuntime = null;
  if (typeof document !== 'undefined') {
    document.querySelectorAll(`script[${SCRIPT_MARKER}]`).forEach((node) => node.remove());
  }
}
