import {describe, expect, it, vi} from 'vitest';

import {createDiagramCache} from '../../src/runtime/cache.js';
import {renderDiagram} from '../../src/runtime/renderer.js';
import type {PlantUmlCoreModule} from '../../src/runtime/types.js';

const SOURCE = '@startuml\nAlice -> Bob : Hello\n@enduml';
const ASSETS = '/plantuml-test/assets/plantuml-client-1.2026.6';

function svgFor(label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>${label}</text></svg>`;
}

/** A stand-in engine whose behaviour each test controls. */
function fakeEngine(
  behaviour: (lines: string[], dark: boolean) => {svg?: string; error?: unknown},
): PlantUmlCoreModule & {calls: Array<{lines: string[]; dark: boolean}>} {
  const calls: Array<{lines: string[]; dark: boolean}> = [];
  return {
    calls,
    render: () => {},
    renderToString: (lines, onSuccess, onError, options) => {
      const dark = options?.dark === true;
      calls.push({lines, dark});
      const outcome = behaviour(lines, dark);
      // The real engine always calls back asynchronously.
      setTimeout(() => {
        if (outcome.error !== undefined) onError(outcome.error);
        else onSuccess(outcome.svg as string);
      }, 0);
    },
  };
}

/** Wires a fake engine in through the loader's documented import seam. */
function withEngine(engine: PlantUmlCoreModule) {
  const importModule = vi.fn().mockResolvedValue(engine);
  // jsdom does not fetch scripts, so the injected tag has to be resolved by hand.
  queueMicrotask(function settle() {
    const script = document.querySelector('script[data-plantuml-runtime]');
    if (script) script.dispatchEvent(new Event('load'));
    else queueMicrotask(settle);
  });
  return importModule;
}

function request(overrides: Partial<Parameters<typeof renderDiagram>[0]> = {}) {
  return {
    source: SOURCE,
    dark: false,
    sanitize: true,
    timeoutMs: 5_000,
    assetsBaseUrl: ASSETS,
    coreVersion: '1.2026.6',
    cache: createDiagramCache('memory', 50),
    ...overrides,
  };
}

describe('rendering a diagram', () => {
  it('returns sanitized SVG for valid source', async () => {
    const engine = fakeEngine(() => ({svg: svgFor('Hello')}));
    const svg = await renderDiagram(request({importModule: withEngine(engine)}));
    expect(svg).toContain('<text>Hello</text>');
    expect(engine.calls).toHaveLength(1);
  });

  it('splits the source into lines the way the engine expects', async () => {
    const engine = fakeEngine(() => ({svg: svgFor('ok')}));
    await renderDiagram(
      request({source: '@startuml\r\nA -> B\r@enduml', importModule: withEngine(engine)}),
    );
    expect(engine.calls[0]?.lines).toEqual(['@startuml', 'A -> B', '@enduml']);
  });

  it('passes the dark flag through to the engine', async () => {
    const engine = fakeEngine(() => ({svg: svgFor('dark')}));
    await renderDiagram(request({dark: true, importModule: withEngine(engine)}));
    expect(engine.calls[0]?.dark).toBe(true);
  });

  it('reports the loading and rendering phases in order', async () => {
    const phases: string[] = [];
    await renderDiagram(
      request({
        importModule: withEngine(fakeEngine(() => ({svg: svgFor('ok')}))),
        onPhase: (phase) => phases.push(phase),
      }),
    );
    expect(phases).toEqual(['loading', 'rendering']);
  });

  it('strips executable content from engine output before returning it', async () => {
    const engine = fakeEngine(() => ({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect/></svg>',
    }));
    const svg = await renderDiagram(request({importModule: withEngine(engine)}));
    expect(svg).not.toContain('onload');
    expect(svg).not.toMatch(/<script/i);
    expect(svg).toContain('<rect');
  });

  it('returns raw engine output when sanitization is explicitly disabled', async () => {
    const raw = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>';
    const engine = fakeEngine(() => ({svg: raw}));
    const svg = await renderDiagram(request({sanitize: false, importModule: withEngine(engine)}));
    expect(svg).toBe(raw);
  });
});

describe('caching behaviour', () => {
  it('serves a repeated render from the cache without touching the engine', async () => {
    const engine = fakeEngine(() => ({svg: svgFor('cached')}));
    const cache = createDiagramCache('memory', 50);

    const first = await renderDiagram(request({cache, importModule: withEngine(engine)}));
    const second = await renderDiagram(request({cache, importModule: withEngine(engine)}));

    expect(second).toBe(first);
    expect(engine.calls).toHaveLength(1);
  });

  it('renders separately for light and dark, and never crosses the two', async () => {
    const engine = fakeEngine((_lines, dark) => ({svg: svgFor(dark ? 'dark' : 'light')}));
    const cache = createDiagramCache('memory', 50);

    const light = await renderDiagram(request({cache, importModule: withEngine(engine)}));
    const dark = await renderDiagram(
      request({cache, dark: true, importModule: withEngine(engine)}),
    );
    const lightAgain = await renderDiagram(request({cache, importModule: withEngine(engine)}));

    expect(light).toContain('light');
    expect(dark).toContain('dark');
    expect(lightAgain).toBe(light);
    expect(engine.calls).toHaveLength(2);
  });

  it('does not reuse results across engine versions', async () => {
    const engine = fakeEngine(() => ({svg: svgFor('v')}));
    const cache = createDiagramCache('memory', 50);

    await renderDiagram(request({cache, importModule: withEngine(engine)}));
    await renderDiagram(
      request({cache, coreVersion: '1.2027.0', importModule: withEngine(engine)}),
    );

    expect(engine.calls).toHaveLength(2);
  });

  it('re-renders every time when caching is disabled', async () => {
    const engine = fakeEngine(() => ({svg: svgFor('x')}));
    const cache = createDiagramCache('none', 50);

    await renderDiagram(request({cache, importModule: withEngine(engine)}));
    await renderDiagram(request({cache, importModule: withEngine(engine)}));

    expect(engine.calls).toHaveLength(2);
  });
});

describe('failure handling', () => {
  it('rejects with the engine message when the error callback fires', async () => {
    const engine = fakeEngine(() => ({error: 'java.lang.IndexOutOfBoundsException'}));
    await expect(renderDiagram(request({importModule: withEngine(engine)}))).rejects.toMatchObject({
      kind: 'engine',
      message: 'java.lang.IndexOutOfBoundsException',
    });
  });

  it('rejects when the engine throws synchronously', async () => {
    const engine: PlantUmlCoreModule = {
      render: () => {},
      renderToString: () => {
        throw new Error('engine exploded');
      },
    };
    await expect(renderDiagram(request({importModule: withEngine(engine)}))).rejects.toMatchObject({
      kind: 'engine',
      message: 'engine exploded',
    });
  });

  it('treats a successfully returned error picture as a diagram error', async () => {
    // This is the important one: PlantUML reports invalid input through onSuccess.
    const engine = fakeEngine(() => ({
      svg:
        '<svg xmlns="http://www.w3.org/2000/svg">' +
        '<text>[From textarea (line 2) ]</text>' +
        '<text>this is definitely not valid ###</text>' +
        '<text> Syntax Error? (Assumed diagram type: sequence)</text></svg>',
    }));

    await expect(renderDiagram(request({importModule: withEngine(engine)}))).rejects.toMatchObject({
      kind: 'diagram',
    });
    await expect(renderDiagram(request({importModule: withEngine(engine)}))).rejects.toThrow(
      /Syntax Error\?/,
    );
  });

  it('never caches a failed render', async () => {
    let attempt = 0;
    const engine = fakeEngine(() => {
      attempt += 1;
      return attempt === 1 ? {error: 'transient'} : {svg: svgFor('recovered')};
    });
    const cache = createDiagramCache('memory', 50);
    const importModule = vi.fn().mockResolvedValue(engine);
    withEngine(engine);

    await expect(renderDiagram(request({cache, importModule}))).rejects.toThrow('transient');
    expect(await renderDiagram(request({cache, importModule}))).toContain('recovered');
  });

  it('lets a later diagram render after one fails', async () => {
    const engine = fakeEngine((lines) =>
      lines.join('\n').includes('BROKEN') ? {error: 'bad'} : {svg: svgFor('fine')},
    );
    const importModule = vi.fn().mockResolvedValue(engine);
    withEngine(engine);

    const failing = renderDiagram(request({source: 'BROKEN', importModule}));
    const following = renderDiagram(request({source: SOURCE, importModule}));

    await expect(failing).rejects.toThrow('bad');
    expect(await following).toContain('fine');
  });

  it('rejects when the diagram is aborted mid-render', async () => {
    const controller = new AbortController();
    const engine: PlantUmlCoreModule = {
      render: () => {},
      renderToString: () => {
        // Never calls back; the component unmounts instead.
        controller.abort();
      },
    };

    await expect(
      renderDiagram(request({signal: controller.signal, importModule: withEngine(engine)})),
    ).rejects.toMatchObject({kind: 'aborted'});
  });

  it('times out a render that never calls back', async () => {
    const engine: PlantUmlCoreModule = {render: () => {}, renderToString: () => {}};
    await expect(
      renderDiagram(request({timeoutMs: 100, importModule: withEngine(engine)})),
    ).rejects.toMatchObject({kind: 'timeout'});
  });
});
