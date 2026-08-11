import {describe, expect, it, vi} from 'vitest';

import type {PlantUmlError} from '../../src/runtime/errors.js';
import {
  collectStdlibNamespaces,
  loadStdlibForSource,
  type StdlibRuntime,
} from '../../src/runtime/stdlibLoader.js';
import type {StdlibRuntimeManifest} from '../../src/stdlibShared.js';

const BASE_URL = '/plantuml-test/assets/plantuml-client-1.2026.6/stdlib-0123456789ab';

const MANIFEST: StdlibRuntimeManifest = {
  revision: '0123456789ab',
  namespaces: {
    c4: {dependencies: [], exampleDependencies: ['office']},
    // The real shape: `k8s/Common` includes `<c4/…>` from inside the library.
    k8s: {dependencies: ['c4'], exampleDependencies: []},
    office: {dependencies: [], exampleDependencies: []},
    // A dependency that this site does not provide, as `gcp` has on `material`.
    gcp: {dependencies: ['material'], exampleDependencies: []},
  },
};

const stdlib: StdlibRuntime = {baseUrl: BASE_URL, manifest: MANIFEST};

function injectedScripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll('script[data-plantuml-runtime]'));
}

/** jsdom never fetches script sources, so tests decide when each one "loads". */
async function settleScripts(event: 'load' | 'error' = 'load', expected = 1): Promise<void> {
  await vi.waitFor(() => expect(injectedScripts().length).toBeGreaterThanOrEqual(expected));
  for (const script of injectedScripts()) script.dispatchEvent(new Event(event));
}

function srcNames(): string[] {
  return injectedScripts().map((script) => script.src.split('/').pop() as string);
}

describe('choosing which namespaces to load', () => {
  it('returns nothing for a source with no standard library include', () => {
    expect(collectStdlibNamespaces('@startuml\nA -> B\n@enduml', MANIFEST)).toEqual([]);
  });

  it('resolves what a namespace needs before the namespace itself', () => {
    // Order matters only in that the engine must find `c4` registered; loading is concurrent,
    // and both are awaited before the render starts.
    expect(collectStdlibNamespaces('!include <k8s/Common>', MANIFEST)).toEqual(['c4', 'k8s']);
  });

  it('leaves example-only dependencies out of an ordinary include', () => {
    // Every C4 page would otherwise pay 160 KB for `office`, which its diagrams never touch.
    expect(collectStdlibNamespaces('!include <C4/C4_Container>', MANIFEST)).toEqual(['c4']);
  });

  it('pulls example dependencies in when the diagram includes an example', () => {
    expect(collectStdlibNamespaces('!include <C4/_examples_/example>', MANIFEST)).toEqual([
      'office',
      'c4',
    ]);
  });

  it('skips a dependency the site does not provide, which may sit behind an !if', () => {
    expect(collectStdlibNamespaces('!include <gcp/GCPCommon>', MANIFEST)).toEqual(['gcp']);
  });

  it('names an unavailable namespace and how to add it', () => {
    expect(() => collectStdlibNamespaces('!include <aws/Common>', MANIFEST)).toThrow(
      /'aws'.*stdlib\.include/s,
    );
    try {
      collectStdlibNamespaces('!include <aws/Common>', MANIFEST);
    } catch (error) {
      expect((error as PlantUmlError).kind).toBe('stdlib');
    }
  });
});

describe('loading namespace bundles', () => {
  it('does nothing at all for a source that needs no namespace', async () => {
    await loadStdlibForSource({source: '@startuml\nA -> B\n@enduml', stdlib, timeoutMs: 1_000});
    expect(injectedScripts()).toHaveLength(0);
  });

  it('serves the bundle from the plugin assets directory, not the page', async () => {
    const loading = loadStdlibForSource({
      source: '!include <C4/C4_Container>',
      stdlib,
      timeoutMs: 1_000,
    });
    await settleScripts();
    await loading;

    const [script] = injectedScripts();
    expect(script?.src).toContain(`${BASE_URL}/c4.min.js`);
  });

  it('tells the engine the bundle is loaded, so it never requests one of its own', async () => {
    const loading = loadStdlibForSource({source: '!include <C4/C4>', stdlib, timeoutMs: 1_000});
    await settleScripts();
    await loading;

    // The engine keys its own bookkeeping by the bare `src` it would have used, which
    // resolves against the page URL and could not exist on a docs site.
    const state = (window as unknown as {__pl_script_state: Record<string, {state: string}>})
      .__pl_script_state;
    expect(state['c4.min.js']).toEqual({state: 'loaded', ok: [], err: []});
  });

  it('loads a namespace the library itself needs', async () => {
    const loading = loadStdlibForSource({
      source: '!include <k8s/Common>',
      stdlib,
      timeoutMs: 1_000,
    });
    await settleScripts('load', 2);
    await loading;

    expect(srcNames().sort()).toEqual(['c4.min.js', 'k8s.min.js']);
  });

  it('injects one script per namespace however many diagrams ask for it', async () => {
    const first = loadStdlibForSource({source: '!include <C4/C4>', stdlib, timeoutMs: 1_000});
    await settleScripts();
    await first;

    await loadStdlibForSource({source: '!include <C4/C4_Container>', stdlib, timeoutMs: 1_000});
    expect(injectedScripts()).toHaveLength(1);
  });

  it('reports a failed bundle as a load error and allows a later retry', async () => {
    const failing = loadStdlibForSource({source: '!include <C4/C4>', stdlib, timeoutMs: 1_000});
    await settleScripts('error');
    await expect(failing).rejects.toThrow(/standard library namespace 'c4'/);

    // The failure is not cached: a second diagram gets a fresh attempt.
    const retry = loadStdlibForSource({source: '!include <C4/C4>', stdlib, timeoutMs: 1_000});
    await vi.waitFor(() => expect(injectedScripts().length).toBeGreaterThanOrEqual(1));
    injectedScripts().at(-1)?.dispatchEvent(new Event('load'));
    await expect(retry).resolves.toBeUndefined();
  });

  it('explains that the standard library is switched off, rather than 404ing', async () => {
    const failing = loadStdlibForSource({
      source: '!include <C4/C4_Container>',
      stdlib: null,
      timeoutMs: 1_000,
    });
    await expect(failing).rejects.toThrow(/switched off for this site/);
    expect(injectedScripts()).toHaveLength(0);
  });
});
