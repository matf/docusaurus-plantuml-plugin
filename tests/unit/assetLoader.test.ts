import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  isRuntimeRequested,
  isVizRuntimeRequested,
  loadPlantUmlRuntime,
  loadVizRuntime,
  resetRuntimeLoader,
} from '../../src/runtime/assetLoader.js';
import {PlantUmlError} from '../../src/runtime/errors.js';

const ASSETS = '/plantuml-test/assets/plantuml-client-1.2026.6';

const fakeEngine = {render: () => {}, renderToString: () => {}};

/** Minimal stand-in for the `window.Viz` that `viz-global.js` installs. */
function installFakeViz(overrides: Record<string, unknown> = {}): {
  instance: ReturnType<typeof vi.fn>;
} {
  const vizInstance = {
    render: vi.fn(),
    engines: ['dot', 'neato'],
    graphvizVersion: '14.1.1',
  };
  const viz = {
    instance: vi.fn().mockResolvedValue(vizInstance),
    engines: ['dot', 'neato'],
    formats: ['svg'],
    graphvizVersion: '14.1.1',
    ...overrides,
  };
  vi.stubGlobal('Viz', viz);
  return viz;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function injectedScripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll('script[data-plantuml-runtime]'));
}

/** jsdom never fetches script sources, so tests decide when the script "loads". */
async function settleScript(event: 'load' | 'error'): Promise<void> {
  await vi.waitFor(() => expect(injectedScripts()).toHaveLength(1));
  injectedScripts()[0]!.dispatchEvent(new Event(event));
}

describe('runtime asset loading', () => {
  it('injects viz-global.js as a classic script under the configured baseUrl', async () => {
    const importModule = vi.fn().mockResolvedValue(fakeEngine);
    const loading = loadPlantUmlRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000, importModule});

    await settleScript('load');
    await loading;

    const [script] = injectedScripts();
    expect(script?.src).toContain(`${ASSETS}/viz-global.js`);
    expect(script?.async).toBe(false);
    expect(script?.getAttribute('type')).toBeNull();
    expect(importModule).toHaveBeenCalledWith(`${ASSETS}/plantuml.js`);
  });

  it('waits for the classic script before importing the module', async () => {
    const importModule = vi.fn().mockResolvedValue(fakeEngine);
    void loadPlantUmlRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000, importModule});

    await vi.waitFor(() => expect(injectedScripts()).toHaveLength(1));
    expect(importModule).not.toHaveBeenCalled();

    injectedScripts()[0]!.dispatchEvent(new Event('load'));
    await vi.waitFor(() => expect(importModule).toHaveBeenCalledTimes(1));
  });

  it('tolerates a trailing slash on the assets URL', async () => {
    const importModule = vi.fn().mockResolvedValue(fakeEngine);
    const loading = loadPlantUmlRuntime({
      assetsBaseUrl: `${ASSETS}/`,
      timeoutMs: 1_000,
      importModule,
    });
    await settleScript('load');
    await loading;
    expect(importModule).toHaveBeenCalledWith(`${ASSETS}/plantuml.js`);
  });

  it('is a singleton: repeated calls reuse one script tag and one import', async () => {
    const importModule = vi.fn().mockResolvedValue(fakeEngine);
    const first = loadPlantUmlRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000, importModule});
    await settleScript('load');
    await first;

    const second = await loadPlantUmlRuntime({
      assetsBaseUrl: ASSETS,
      timeoutMs: 1_000,
      importModule,
    });

    expect(second).toBe(await first);
    expect(injectedScripts()).toHaveLength(1);
    expect(importModule).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent load attempts from several diagrams', async () => {
    const importModule = vi.fn().mockResolvedValue(fakeEngine);
    const attempts = Array.from({length: 4}, () =>
      loadPlantUmlRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000, importModule}),
    );

    await settleScript('load');
    const engines = await Promise.all(attempts);

    expect(injectedScripts()).toHaveLength(1);
    expect(importModule).toHaveBeenCalledTimes(1);
    expect(new Set(engines).size).toBe(1);
  });

  it('does not add a second script tag after client-side navigation', async () => {
    const importModule = vi.fn().mockResolvedValue(fakeEngine);
    const first = loadPlantUmlRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000, importModule});
    await settleScript('load');
    await first;

    // A new page mounts new diagram components, but the document is never reloaded.
    await loadPlantUmlRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000, importModule});
    await loadPlantUmlRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000, importModule});

    expect(injectedScripts()).toHaveLength(1);
  });

  it('reuses an existing script tag left over from an earlier page', async () => {
    const importModule = vi.fn().mockResolvedValue(fakeEngine);
    const first = loadPlantUmlRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000, importModule});
    await settleScript('load');
    await first;

    // Forget the cached module, as a hot reload would, but leave the DOM untouched.
    const script = injectedScripts()[0]!;
    resetRuntimeLoaderKeepingDom();
    expect(document.querySelectorAll('script[data-plantuml-runtime]')).toHaveLength(1);

    const again = loadPlantUmlRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000, importModule});
    await expect(again).resolves.toBe(fakeEngine);
    expect(script.dataset['plantumlRuntimeState']).toBe('loaded');
    expect(injectedScripts()).toHaveLength(1);
  });

  it('reports whether the runtime has been requested at all', async () => {
    expect(isRuntimeRequested()).toBe(false);
    const loading = loadPlantUmlRuntime({
      assetsBaseUrl: ASSETS,
      timeoutMs: 1_000,
      importModule: vi.fn().mockResolvedValue(fakeEngine),
    });
    expect(isRuntimeRequested()).toBe(true);
    await settleScript('load');
    await loading;
  });
});

describe('runtime load failures', () => {
  it('surfaces a script load error with the URL and a hint', async () => {
    const loading = loadPlantUmlRuntime({
      assetsBaseUrl: ASSETS,
      timeoutMs: 1_000,
      importModule: vi.fn(),
    });
    await settleScript('error');

    await expect(loading).rejects.toThrow(/Failed to load the Graphviz runtime/);
    await expect(loading).rejects.toThrow(/viz-global\.js/);
    await expect(loading).rejects.toThrow(/baseUrl/);
  });

  it('classifies load failures so the UI can explain them', async () => {
    const loading = loadPlantUmlRuntime({
      assetsBaseUrl: ASSETS,
      timeoutMs: 1_000,
      importModule: vi.fn(),
    });
    await settleScript('error');
    await expect(loading).rejects.toMatchObject({kind: 'load'});
  });

  it('allows a retry after a failure instead of caching it forever', async () => {
    const importModule = vi.fn().mockResolvedValue(fakeEngine);

    const failing = loadPlantUmlRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000, importModule});
    await settleScript('error');
    await expect(failing).rejects.toBeInstanceOf(PlantUmlError);
    expect(isRuntimeRequested()).toBe(false);

    // The failed script tag must not poison the retry.
    resetRuntimeLoader();

    const retry = loadPlantUmlRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000, importModule});
    await settleScript('load');
    await expect(retry).resolves.toBe(fakeEngine);
  });

  it('times out when the script never loads', async () => {
    vi.useFakeTimers();
    try {
      const loading = loadPlantUmlRuntime({
        assetsBaseUrl: ASSETS,
        timeoutMs: 100,
        importModule: vi.fn(),
      });
      const assertion = expect(loading).rejects.toThrow(/Timed out after 100 ms/);
      await vi.advanceTimersByTimeAsync(150);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates a failing dynamic import as a load error', async () => {
    const importModule = vi.fn().mockRejectedValue(new Error('network down'));
    const loading = loadPlantUmlRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000, importModule});
    await settleScript('load');

    await expect(loading).rejects.toThrow(/Failed to load the PlantUML engine/);
    await expect(loading).rejects.toMatchObject({kind: 'load'});
  });

  it('rejects a module that does not export the expected functions', async () => {
    const importModule = vi.fn().mockResolvedValue({notWhatWeExpected: true});
    const loading = loadPlantUmlRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000, importModule});
    await settleScript('load');

    await expect(loading).rejects.toThrow(/does not export the expected PlantUML render functions/);
  });
});

describe('the Graphviz runtime', () => {
  it('loads viz-global.js and resolves an engine instance', async () => {
    const viz = installFakeViz();
    const loading = loadVizRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000});

    await settleScript('load');
    const instance = await loading;

    expect(injectedScripts()[0]?.src).toContain(`${ASSETS}/viz-global.js`);
    expect(viz.instance).toHaveBeenCalledTimes(1);
    expect(instance.engines).toContain('dot');
  });

  it('never downloads the 6.8 MB PlantUML engine for a DOT-only page', async () => {
    // The whole point of splitting the loader: a site that uses only Graphviz must not pay
    // for PlantUML. One injected script, and no dynamic import at all.
    installFakeViz();
    const loading = loadVizRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000});
    await settleScript('load');
    await loading;

    expect(injectedScripts()).toHaveLength(1);
    expect(isVizRuntimeRequested()).toBe(true);
    expect(isRuntimeRequested()).toBe(false);
  });

  it('shares one instance across concurrent callers', async () => {
    const viz = installFakeViz();
    const first = loadVizRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000});
    const second = loadVizRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000});
    await settleScript('load');

    expect(await first).toBe(await second);
    expect(viz.instance).toHaveBeenCalledTimes(1);
    expect(injectedScripts()).toHaveLength(1);
  });

  it('rejects a script that did not install the expected Viz API', async () => {
    // The §8.1 mitigation: `viz-global.js` arrives via @plantuml/core, so a future release
    // that changed engines must fail with a message naming the cause.
    installFakeViz({instance: undefined});
    const loading = loadVizRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000});
    await settleScript('load');

    await expect(loading).rejects.toThrow(/did not install the expected Graphviz \(Viz\.js\) API/);
    await expect(loading).rejects.toMatchObject({kind: 'load'});
  });

  it('rejects when window.Viz is missing entirely', async () => {
    vi.stubGlobal('Viz', undefined);
    const loading = loadVizRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000});
    await settleScript('load');

    await expect(loading).rejects.toThrow(/did not install the expected Graphviz/);
  });

  it('lets a later diagram retry after a failed load', async () => {
    installFakeViz();
    const failing = loadVizRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000});
    await settleScript('error');
    await expect(failing).rejects.toThrow(/Failed to load the Graphviz runtime/);
    expect(isVizRuntimeRequested()).toBe(false);

    // No reset in between: a diagram further down the page must get a real second attempt,
    // which means the dead script tag is replaced rather than reused.
    const retry = loadVizRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000});
    await settleScript('load');
    await expect(retry).resolves.toMatchObject({graphvizVersion: '14.1.1'});
  });

  it('surfaces a rejecting Viz.instance() as a load error', async () => {
    installFakeViz({instance: vi.fn().mockRejectedValue(new Error('wasm refused to compile'))});
    const loading = loadVizRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000});
    await settleScript('load');

    await expect(loading).rejects.toThrow(/Failed to initialize the Graphviz engine/);
    await expect(loading).rejects.toMatchObject({kind: 'load'});
  });

  it('reuses the one script tag when both engines are used on a page', async () => {
    const viz = installFakeViz();
    const importModule = vi.fn().mockResolvedValue(fakeEngine);
    const graphviz = loadVizRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000});
    const plantuml = loadPlantUmlRuntime({assetsBaseUrl: ASSETS, timeoutMs: 1_000, importModule});

    await settleScript('load');
    await Promise.all([graphviz, plantuml]);

    expect(injectedScripts()).toHaveLength(1);
    expect(viz.instance).toHaveBeenCalledTimes(1);
    expect(importModule).toHaveBeenCalledTimes(1);
  });
});

/** Clears the module cache without touching the DOM, unlike `resetRuntimeLoader`. */
function resetRuntimeLoaderKeepingDom(): void {
  const scripts = injectedScripts().map((script) => script.cloneNode(true) as HTMLScriptElement);
  resetRuntimeLoader();
  scripts.forEach((script) => document.head.appendChild(script));
}
