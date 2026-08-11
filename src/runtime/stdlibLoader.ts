import {findStdlibIncludes, type StdlibRuntimeManifest} from '../stdlibShared.js';
import {loadClassicScript, onRuntimeReset} from './assetLoader.js';
import {PlantUmlError} from './errors.js';

/**
 * Makes the standard library namespaces a diagram includes available to the engine before it
 * is asked to render.
 *
 * `@plantuml/core` resolves `!include <c4/…>` against `window.PLANTUML_STDLIB`, and when a
 * namespace is missing it appends a `<script src="c4.min.js">` of its own. That `src` is
 * relative, so it resolves against the *page* — `/docs/architecture/c4.min.js` on a docs site,
 * which is nothing. There is no base-URL hook to redirect it, and pre-populating
 * `window.PLANTUML_STDLIB` does not stop it: the engine looks at its own script bookkeeping
 * first and only consults the global once the script it wanted has loaded.
 *
 * So this module does both halves of the job. It loads the bundle from the plugin's assets
 * directory, where the URL is correct, and then writes the entry the engine's loader
 * (`ED3` in `plantuml.js`) checks — `window.__pl_script_state['c4.min.js']` — so the engine
 * finds the work already done and never issues the request that would 404.
 *
 * See `docs/adr/0005-stdlib-bundles.md`.
 */

/** The engine's own script-state bookkeeping, keyed by the `src` it would have requested. */
interface EngineScriptState {
  state: 'loading' | 'loaded' | 'error';
  ok: (() => void)[];
  err: ((message: string) => void)[];
}

interface EngineWindow {
  __pl_script_state?: Record<string, EngineScriptState>;
}

export interface StdlibRuntime {
  /** Absolute, `baseUrl`-prefixed URL of the directory holding the namespace bundles. */
  baseUrl: string;
  manifest: StdlibRuntimeManifest;
}

/** One in-flight or settled load per bundle URL, shared by every diagram on the page. */
const loaded = new Map<string, Promise<void>>();

onRuntimeReset(() => loaded.clear());

function bundleFileName(namespace: string): string {
  return `${namespace}.min.js`;
}

function joinUrl(base: string, file: string): string {
  return `${base.replace(/\/+$/, '')}/${file}`;
}

/**
 * Tells the engine the namespace bundle is already in the document.
 *
 * The key is the bare file name because that is exactly the `src` the engine would have set,
 * and its bookkeeping is keyed by that string rather than by the resolved URL.
 */
function markLoadedForEngine(namespace: string): void {
  const engineWindow = window as EngineWindow;
  const state = (engineWindow.__pl_script_state ??= Object.create(null) as Record<
    string,
    EngineScriptState
  >);
  state[bundleFileName(namespace)] = {state: 'loaded', ok: [], err: []};
}

/**
 * The namespaces a source needs, in load order, including what those namespaces need in turn.
 *
 * Dependencies come from the manifest rather than from parsing the library sources in the
 * browser: `k8s` includes `<c4/…>` from its own `Common.puml`, and the engine would ask for
 * it mid-render, far too late to fetch anything. Example-only dependencies are pulled in
 * solely when the diagram includes something from `_examples_/` — C4's examples reference
 * `office`, and charging every C4 diagram 160 KB for that would be absurd.
 *
 * A dependency the site does not provide is skipped rather than raised: it may well sit
 * behind an `!if` the diagram never takes, and failing here would break diagrams that work.
 */
export function collectStdlibNamespaces(source: string, manifest: StdlibRuntimeManifest): string[] {
  const references = findStdlibIncludes(source);
  const ordered: string[] = [];
  const seen = new Set<string>();

  const visit = (namespace: string, withExamples: boolean, direct: boolean) => {
    const entry = manifest.namespaces[namespace];
    if (!entry) {
      if (!direct) return;
      throw new PlantUmlError(
        'stdlib',
        `This diagram includes <${namespace}/…>, but the '${namespace}' standard library ` +
          "namespace is not available on this site. Add it to the plugin's " +
          `\`stdlib.include\` option and point \`stdlib.source\` at a plantuml-stdlib ` +
          'checkout that contains it.',
      );
    }
    if (seen.has(namespace)) return;
    seen.add(namespace);
    for (const dependency of entry.dependencies) visit(dependency, false, false);
    if (withExamples) {
      for (const dependency of entry.exampleDependencies) visit(dependency, false, false);
    }
    ordered.push(namespace);
  };

  for (const reference of references) {
    visit(reference.namespace, reference.fromExamples, true);
  }
  return ordered;
}

export interface LoadStdlibOptions {
  source: string;
  stdlib: StdlibRuntime | null;
  timeoutMs: number;
}

/**
 * Loads whatever the source needs from the standard library. Resolves immediately when it
 * needs nothing, which is the common case and must stay free.
 */
export async function loadStdlibForSource({
  source,
  stdlib,
  timeoutMs,
}: LoadStdlibOptions): Promise<void> {
  const references = findStdlibIncludes(source);
  if (references.length === 0) return;

  if (!stdlib) {
    const names = [...new Set(references.map((reference) => reference.namespace))];
    throw new PlantUmlError(
      'stdlib',
      `This diagram includes ${names.map((name) => `<${name}/…>`).join(', ')} from the ` +
        'PlantUML standard library, which is switched off for this site (`stdlib: false`).',
    );
  }

  const namespaces = collectStdlibNamespaces(source, stdlib.manifest);
  await Promise.all(
    namespaces.map(async (namespace) => {
      const url = joinUrl(stdlib.baseUrl, bundleFileName(namespace));
      let pending = loaded.get(url);
      if (!pending) {
        pending = loadClassicScript(url, timeoutMs, `standard library namespace '${namespace}'`)
          .then(() => markLoadedForEngine(namespace))
          .catch((error: unknown) => {
            // Clearing the entry lets a later diagram retry rather than inherit the failure.
            loaded.delete(url);
            throw error;
          });
        loaded.set(url, pending);
      }
      await pending;
    }),
  );
}

/** Whether a namespace bundle has been requested on this page. For tests and diagnostics. */
export function isStdlibNamespaceRequested(url: string): boolean {
  return loaded.has(url);
}
