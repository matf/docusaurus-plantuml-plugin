import {loadPlantUmlRuntime, type LoadRuntimeOptions} from './assetLoader.js';
import {computeCacheKey, type DiagramCache} from './cache.js';
import {describeEngineError, detectDiagramError, PlantUmlError} from './errors.js';
import {enqueueRender} from './queue.js';
import {sanitizeSvgMarkup} from './sanitize.js';
import {loadStdlibForSource, type StdlibRuntime} from './stdlibLoader.js';
import type {PlantUmlCoreModule} from './types.js';

export interface RenderDiagramRequest {
  source: string;
  dark: boolean;
  sanitize: boolean;
  timeoutMs: number;
  assetsBaseUrl: string;
  coreVersion: string;
  /** Standard library assets for this site, or `null` when the feature is switched off. */
  stdlib: StdlibRuntime | null;
  cache: DiagramCache;
  signal?: AbortSignal;
  /** Reports which long-running phase is in progress, so the UI can show an accurate state. */
  onPhase?: (phase: 'loading' | 'rendering') => void;
  /** Test seam mirroring {@link LoadRuntimeOptions.importModule}. */
  importModule?: LoadRuntimeOptions['importModule'];
}

/**
 * `renderToString` takes its options as a *fourth* argument, after the two callbacks.
 * This was verified against the installed `@plantuml/core` rather than assumed: the
 * function's arity is 4 and `{dark: true}` produces different fill colours from `{dark:
 * false}`, which itself is byte-identical to omitting the argument.
 */
function renderWithEngine(
  engine: PlantUmlCoreModule,
  source: string,
  dark: boolean,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const lines = source.split(/\r\n|\r|\n/);
    try {
      engine.renderToString(
        lines,
        (svg) => {
          if (settled) return;
          settled = true;
          resolve(svg);
        },
        (raw) => {
          if (settled) return;
          settled = true;
          reject(new PlantUmlError('engine', describeEngineError(raw)));
        },
        {dark},
      );
    } catch (error) {
      if (settled) return;
      settled = true;
      reject(new PlantUmlError('engine', describeEngineError(error), {cause: error}));
    }
  });
}

/**
 * Renders one diagram to sanitized SVG.
 *
 * Cache hits skip the queue entirely; everything else is serialized behind
 * {@link enqueueRender} because the engine cannot render two diagrams at once.
 */
export async function renderDiagram(request: RenderDiagramRequest): Promise<string> {
  const {source, dark, sanitize, timeoutMs, cache, coreVersion, stdlib, signal, onPhase} = request;

  const cacheKey = computeCacheKey({
    source,
    dark,
    sanitized: sanitize,
    coreVersion,
    stdlibRevision: stdlib?.manifest.revision ?? null,
  });
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Loading happens outside the queue: it is shared, idempotent work, and holding the
  // single render slot for an 8 MB download would stall every other diagram on the page.
  //
  // The standard library loads alongside the engine rather than after it. The two are
  // independent downloads, and the engine cannot be asked for a diagram whose includes are
  // not resolvable yet — by the time it looks, the namespaces have to be in place already.
  onPhase?.('loading');
  const [engine] = await Promise.all([
    loadPlantUmlRuntime({
      assetsBaseUrl: request.assetsBaseUrl,
      timeoutMs,
      importModule: request.importModule,
    }),
    loadStdlibForSource({source, stdlib, timeoutMs}),
  ]);

  onPhase?.('rendering');
  const svg = await enqueueRender(
    async () => {
      const raw = await renderWithEngine(engine, source, dark);

      // Invalid PlantUML is reported as a successfully rendered "error picture", not through
      // the error callback, so a rendered SVG still has to be inspected before it is trusted.
      const diagramError = detectDiagramError(raw);
      if (diagramError !== null) {
        throw new PlantUmlError('diagram', diagramError);
      }

      return sanitize ? sanitizeSvgMarkup(raw) : raw;
    },
    {timeoutMs, signal},
  );

  cache.set(cacheKey, svg);
  return svg;
}
