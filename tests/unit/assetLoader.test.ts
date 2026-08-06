import {describe, expect, it, vi} from 'vitest';

import {
  isRuntimeRequested,
  loadPlantUmlRuntime,
  resetRuntimeLoader,
} from '../../src/runtime/assetLoader.js';
import {PlantUmlError} from '../../src/runtime/errors.js';

const ASSETS = '/plantuml-test/assets/plantuml-client-1.2026.6';

const fakeEngine = {render: () => {}, renderToString: () => {}};

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

    await expect(loading).rejects.toThrow(/Failed to load the PlantUML Graphviz runtime/);
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

/** Clears the module cache without touching the DOM, unlike `resetRuntimeLoader`. */
function resetRuntimeLoaderKeepingDom(): void {
  const scripts = injectedScripts().map((script) => script.cloneNode(true) as HTMLScriptElement);
  resetRuntimeLoader();
  scripts.forEach((script) => document.head.appendChild(script));
}
