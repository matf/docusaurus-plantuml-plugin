import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {createDiagramCache, type DiagramCache} from '../../src/runtime/cache.js';
import {PlantUmlError} from '../../src/runtime/errors.js';
import {renderGraphvizDiagram} from '../../src/runtime/graphvizRenderer.js';
import type {VizRenderResult} from '../../src/runtime/types.js';

const ASSETS = '/plantuml-test/assets/plantuml-client-1.2026.6';
const SOURCE = 'digraph {a -> b}';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><ellipse stroke="black"/></svg>';

const {loadVizRuntimeMock} = vi.hoisted(() => ({loadVizRuntimeMock: vi.fn()}));
vi.mock('../../src/runtime/assetLoader.js', () => ({loadVizRuntime: loadVizRuntimeMock}));

let renderMock: ReturnType<typeof vi.fn>;
let cache: DiagramCache;

function success(output = SVG): VizRenderResult {
  return {status: 'success', output, errors: []};
}

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    source: SOURCE,
    layout: 'dot',
    sanitize: true,
    transparentBackground: true,
    maxSourceBytes: 100_000,
    timeoutMs: 5_000,
    assetsBaseUrl: ASSETS,
    coreVersion: '1.2026.6',
    cache,
    ...overrides,
  };
}

beforeEach(() => {
  renderMock = vi.fn().mockReturnValue(success());
  loadVizRuntimeMock.mockReset();
  loadVizRuntimeMock.mockResolvedValue({
    render: renderMock,
    engines: ['dot', 'neato', 'circo'],
    graphvizVersion: '14.1.1',
  });
  cache = createDiagramCache('memory', 10);
});

afterEach(() => {
  cache.clear();
});

describe('rendering a DOT diagram', () => {
  it('lays the graph out and returns sanitized SVG', async () => {
    const svg = await renderGraphvizDiagram(baseRequest());

    expect(svg).toContain('<svg');
    expect(renderMock).toHaveBeenCalledWith(
      SOURCE,
      expect.objectContaining({format: 'svg', engine: 'dot'}),
    );
  });

  it('asks Graphviz for a transparent background so the page shows through', async () => {
    await renderGraphvizDiagram(baseRequest());

    expect(renderMock.mock.calls[0]?.[1]).toMatchObject({
      graphAttributes: {bgcolor: 'transparent'},
    });
  });

  it('leaves the background alone when the option is off', async () => {
    await renderGraphvizDiagram(baseRequest({transparentBackground: false}));

    expect(renderMock.mock.calls[0]?.[1]).not.toHaveProperty('graphAttributes');
  });

  it('honours the requested layout engine', async () => {
    await renderGraphvizDiagram(baseRequest({layout: 'neato'}));

    expect(renderMock.mock.calls[0]?.[1]).toMatchObject({engine: 'neato'});
  });

  it('reports the phases the UI shows', async () => {
    const phases: string[] = [];
    await renderGraphvizDiagram(baseRequest({onPhase: (phase: string) => phases.push(phase)}));

    expect(phases).toEqual(['loading', 'rendering']);
  });

  it('skips sanitization when the option is off', async () => {
    // `<script>` survives only because sanitizeSvg was explicitly opted out of.
    renderMock.mockReturnValue(success(`<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>`));
    const svg = await renderGraphvizDiagram(baseRequest({sanitize: false}));

    expect(svg).toContain('<script');
  });

  it('sanitizes by default, stripping script from engine output', async () => {
    renderMock.mockReturnValue(
      success(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><g/></svg>`),
    );
    const svg = await renderGraphvizDiagram(baseRequest());

    expect(svg).not.toContain('<script');
  });
});

describe('caching', () => {
  it('serves a repeat render from the cache without loading the engine', async () => {
    await renderGraphvizDiagram(baseRequest());
    loadVizRuntimeMock.mockClear();
    renderMock.mockClear();

    const svg = await renderGraphvizDiagram(baseRequest());

    expect(svg).toContain('<svg');
    // The whole point: a cache hit must not cost a 1.4 MB download.
    expect(loadVizRuntimeMock).not.toHaveBeenCalled();
    expect(renderMock).not.toHaveBeenCalled();
  });

  it('does not report phases for a cache hit', async () => {
    await renderGraphvizDiagram(baseRequest());
    const phases: string[] = [];
    await renderGraphvizDiagram(baseRequest({onPhase: (phase: string) => phases.push(phase)}));

    expect(phases).toEqual([]);
  });

  it('re-renders when the layout engine changes', async () => {
    await renderGraphvizDiagram(baseRequest());
    await renderGraphvizDiagram(baseRequest({layout: 'circo'}));

    expect(renderMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed render', async () => {
    renderMock.mockReturnValueOnce({
      status: 'failure',
      output: undefined,
      errors: [{level: 'error', message: "syntax error in line 1 near '}'"}],
    });
    await expect(renderGraphvizDiagram(baseRequest())).rejects.toThrow(/syntax error/);

    renderMock.mockReturnValue(success());
    await expect(renderGraphvizDiagram(baseRequest())).resolves.toContain('<svg');
  });
});

describe('failure modes', () => {
  it('reports invalid DOT as a syntax error carrying the engine diagnostic', async () => {
    renderMock.mockReturnValue({
      status: 'failure',
      output: undefined,
      errors: [{level: 'error', message: "syntax error in line 3 near '}'"}],
    });

    const failure = renderGraphvizDiagram(baseRequest());
    await expect(failure).rejects.toBeInstanceOf(PlantUmlError);
    await expect(failure).rejects.toMatchObject({kind: 'syntax'});
    // Graphviz names the line, unlike PlantUML's error pictures. Readers get to see it.
    await expect(failure).rejects.toThrow(/in line 3/);
  });

  it('rejects a layout engine this build does not have, naming the ones it does', async () => {
    const failure = renderGraphvizDiagram(baseRequest({layout: 'spring'}));

    await expect(failure).rejects.toMatchObject({kind: 'config'});
    await expect(failure).rejects.toThrow(/Unknown Graphviz layout engine 'spring'/);
    await expect(failure).rejects.toThrow(/dot, neato, circo/);
  });

  it('reports an engine that throws as an engine error, not a syntax error', async () => {
    renderMock.mockImplementation(() => {
      throw new Error('out of memory');
    });

    const failure = renderGraphvizDiagram(baseRequest());
    await expect(failure).rejects.toMatchObject({kind: 'engine'});
    await expect(failure).rejects.toThrow(/failed while laying out this diagram/);
  });

  it('propagates a load failure', async () => {
    loadVizRuntimeMock.mockRejectedValue(new PlantUmlError('load', 'no engine for you'));

    await expect(renderGraphvizDiagram(baseRequest())).rejects.toMatchObject({kind: 'load'});
  });

  it('raises an engine error when sanitization leaves no SVG root', async () => {
    renderMock.mockReturnValue(success('<p>not a diagram at all</p>'));

    await expect(renderGraphvizDiagram(baseRequest())).rejects.toMatchObject({kind: 'engine'});
  });
});

describe('the source-size guard', () => {
  it('refuses an oversized source before downloading the engine', async () => {
    const failure = renderGraphvizDiagram(baseRequest({maxSourceBytes: 4}));

    await expect(failure).rejects.toMatchObject({kind: 'too-large'});
    await expect(failure).rejects.toThrow(/would freeze the page/);
    // Refusing must be cheap: no 1.4 MB download to find out the answer is no.
    expect(loadVizRuntimeMock).not.toHaveBeenCalled();
  });

  it('names both the actual size and the limit', async () => {
    await expect(renderGraphvizDiagram(baseRequest({maxSourceBytes: 4}))).rejects.toThrow(
      new RegExp(`${SOURCE.length} bytes, above the 4-byte limit`),
    );
  });

  it('measures UTF-8 bytes, not code units', async () => {
    // 'ä' is one JavaScript character but two UTF-8 bytes; a limit of 1 must reject it.
    const source = 'digraph {ä}';
    await expect(
      renderGraphvizDiagram(baseRequest({source, maxSourceBytes: source.length})),
    ).rejects.toMatchObject({kind: 'too-large'});
  });

  it('allows a source exactly at the limit', async () => {
    await expect(
      renderGraphvizDiagram(baseRequest({maxSourceBytes: SOURCE.length})),
    ).resolves.toContain('<svg');
  });
});

describe('aborting', () => {
  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      renderGraphvizDiagram(baseRequest({signal: controller.signal})),
    ).rejects.toMatchObject({kind: 'aborted'});
    expect(loadVizRuntimeMock).not.toHaveBeenCalled();
  });

  it('does not lay out a graph for a diagram unmounted while the engine was loading', async () => {
    const controller = new AbortController();
    let releaseLoad: (value: unknown) => void = () => {};
    loadVizRuntimeMock.mockReturnValue(
      new Promise((resolve) => {
        releaseLoad = resolve;
      }),
    );

    const pending = renderGraphvizDiagram(baseRequest({signal: controller.signal}));
    controller.abort();
    releaseLoad({render: renderMock, engines: ['dot'], graphvizVersion: '14.1.1'});

    await expect(pending).rejects.toMatchObject({kind: 'aborted'});
    expect(renderMock).not.toHaveBeenCalled();
  });
});

describe('engine reuse', () => {
  it('lays out many diagrams through one loaded instance', async () => {
    // Viz.js documents that one instance renders multiple graphs, and a soak test confirmed it
    // stays healthy across syntax errors. Re-instantiating per diagram would be wasted work.
    for (let index = 0; index < 5; index += 1) {
      await renderGraphvizDiagram(baseRequest({source: `digraph {a -> b${index}}`}));
    }

    // All five went through the same instance's `render`. Making the loader itself a singleton
    // is the loader's job, and `assetLoader.test.ts` is where that is pinned.
    expect(renderMock).toHaveBeenCalledTimes(5);
  });

  it('keeps working after a diagram with invalid DOT', async () => {
    renderMock.mockReturnValueOnce({
      status: 'failure',
      output: undefined,
      errors: [{level: 'error', message: 'syntax error in line 1'}],
    });
    await expect(renderGraphvizDiagram(baseRequest({source: 'digraph {a ->}'}))).rejects.toThrow();

    await expect(renderGraphvizDiagram(baseRequest())).resolves.toContain('<svg');
  });
});
