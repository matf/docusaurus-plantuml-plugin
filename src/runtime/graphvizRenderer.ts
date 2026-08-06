import {loadVizRuntime, type LoadRuntimeOptions} from './assetLoader.js';
import {computeGraphvizCacheKey, type DiagramCache} from './cache.js';
import {formatGraphvizErrors, PlantUmlError} from './errors.js';
import {sanitizeSvgMarkup} from './sanitize.js';
import type {VizInstance} from './types.js';

export interface RenderGraphvizRequest {
  source: string;
  /** Graphviz layout engine to lay the graph out with. */
  layout: string;
  sanitize: boolean;
  transparentBackground: boolean;
  /** Refuse sources larger than this many UTF-8 bytes rather than freeze the main thread. */
  maxSourceBytes: number;
  timeoutMs: number;
  assetsBaseUrl: string;
  coreVersion: string;
  cache: DiagramCache;
  signal?: AbortSignal;
  /** Reports which long-running phase is in progress, so the UI can show an accurate state. */
  onPhase?: (phase: 'loading' | 'rendering') => void;
}

function utf8ByteLength(value: string): number {
  // `TextEncoder` is universal in browsers and in jsdom; the fallback keeps this honest in
  // any exotic host that lacks it, at the cost of counting code units instead of bytes.
  if (typeof TextEncoder === 'undefined') return value.length;
  return new TextEncoder().encode(value).length;
}

function abortedError(): PlantUmlError {
  return new PlantUmlError('aborted', 'Render aborted.');
}

/**
 * Runs one Graphviz layout.
 *
 * Deliberately **not** routed through `runtime/queue.ts`. That queue exists because the
 * PlantUML engine keeps in-flight state in module globals, so overlapping renders corrupt
 * each other. Viz.js has no such defect: `render` is synchronous and has returned before
 * anything else can observe the engine, so serializing would add latency and buy nothing.
 */
function renderWithViz(
  viz: VizInstance,
  source: string,
  layout: string,
  transparentBackground: boolean,
): string {
  // Checked against the live engine rather than only against the compile-time list, so a
  // fence naming an engine this build lacks fails with the available set spelled out.
  if (!viz.engines.includes(layout)) {
    throw new PlantUmlError(
      'config',
      `Unknown Graphviz layout engine '${layout}'. This build supports: ` +
        `${viz.engines.join(', ')}.`,
    );
  }

  let result;
  try {
    result = viz.render(source, {
      format: 'svg',
      engine: layout,
      // Graphviz paints an opaque white rectangle over the whole canvas unless told not to,
      // which would show as a white slab on a dark page. `transparent` omits it entirely.
      ...(transparentBackground ? {graphAttributes: {bgcolor: 'transparent'}} : {}),
    });
  } catch (error) {
    // `render` reports invalid DOT in its result rather than by throwing, so reaching here
    // means the engine itself broke — a different failure with a different explanation.
    throw new PlantUmlError('engine', 'The Graphviz engine failed while laying out this diagram.', {
      cause: error,
    });
  }

  if (result.status !== 'success') {
    throw new PlantUmlError('syntax', formatGraphvizErrors(result.errors));
  }
  return result.output;
}

/**
 * Renders one Graphviz diagram to sanitized SVG.
 *
 * Cache hits return before the engine is even loaded, which is what keeps a page of repeated
 * diagrams from downloading 1.4 MB it does not need.
 */
export async function renderGraphvizDiagram(request: RenderGraphvizRequest): Promise<string> {
  const {
    source,
    layout,
    sanitize,
    transparentBackground,
    maxSourceBytes,
    timeoutMs,
    cache,
    coreVersion,
    signal,
    onPhase,
  } = request;

  if (signal?.aborted) throw abortedError();

  const cacheKey = computeGraphvizCacheKey({
    source,
    layout,
    sanitized: sanitize,
    transparentBackground,
    coreVersion,
  });
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Checked before loading the engine: refusing a 5 MB graph should not first cost a 1.4 MB
  // download. Graphviz lays out synchronously, so an oversized source freezes the tab rather
  // than merely taking a while — an explanatory panel is the better failure.
  const bytes = utf8ByteLength(source);
  if (bytes > maxSourceBytes) {
    throw new PlantUmlError(
      'too-large',
      `This diagram's source is ${bytes} bytes, above the ${maxSourceBytes}-byte limit. ` +
        'Graphviz lays out synchronously, so rendering it would freeze the page. Raise ' +
        '`graphviz.maxSourceBytes` if this diagram is genuinely meant to be this large.',
    );
  }

  onPhase?.('loading');
  const viz = await loadVizRuntime({
    assetsBaseUrl: request.assetsBaseUrl,
    timeoutMs,
  } satisfies LoadRuntimeOptions);

  // Loading is shared work that a caller-side abort cannot cancel, so the signal is re-checked
  // afterwards: an unmounted diagram must not go on to lay out a graph nobody will see.
  if (signal?.aborted) throw abortedError();

  onPhase?.('rendering');
  const raw = renderWithViz(viz, source, layout, transparentBackground);
  const svg = sanitize ? sanitizeSvgMarkup(raw) : raw;

  cache.set(cacheKey, svg);
  return svg;
}
