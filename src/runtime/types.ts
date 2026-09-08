/**
 * The public surface of `@plantuml/core@1.2026.x`, verified against the installed package.
 *
 * `plantuml.js` exports exactly two functions. Both take an optional trailing options object
 * whose recognized members are `dark` and `maxSvgSize`; see `docs/architecture.md` for how
 * this was established and `tests/e2e/engine-contract.spec.ts` for the regression guard.
 */
export interface PlantUmlCoreModule {
  render(lines: string[], targetId: string, options?: PlantUmlRenderOptions): void;
  renderToString(
    lines: string[],
    onSuccess: (svg: string) => void,
    onError: (message: unknown) => void,
    options?: PlantUmlRenderOptions,
  ): void;
}

export interface PlantUmlRenderOptions {
  dark?: boolean;
  /**
   * Ceiling, in PlantUML points, on the laid-out diagram's width and height.
   *
   * Added in `@plantuml/core@1.2026.8`; `src/assets.ts` refuses to build against anything
   * older, because an engine that does not know the option ignores it silently. `0` disables
   * the check; a *negative* value is treated by the engine as unspecified and falls back to
   * its own 8192 default, which is why `options.maxSvgSize` rejects negatives outright.
   */
  maxSvgSize?: number;
}

export type DiagramStatus = 'idle' | 'loading' | 'rendering' | 'ready' | 'error';

/** Which engine renders a given fence. */
export type DiagramEngine = 'plantuml' | 'graphviz';

/**
 * The subset of Viz.js 3.x this plugin uses, verified against the `viz-global.js` that
 * `@plantuml/core` ships (Viz.js 3.24.0 / Graphviz 14.1.1).
 *
 * `render` is deliberately preferred over `renderString`: it reports invalid DOT as a result
 * object carrying Graphviz's own diagnostics — including the line number — instead of throwing
 * a bare `Error`.
 */
export interface VizGlobal {
  instance(): Promise<VizInstance>;
  readonly engines: string[];
  readonly formats: string[];
  readonly graphvizVersion: string;
}

export interface VizInstance {
  render(input: string, options?: VizRenderOptions): VizRenderResult;
  readonly engines: string[];
  readonly graphvizVersion: string;
}

export interface VizRenderOptions {
  format?: string;
  engine?: string;
  graphAttributes?: Record<string, string | number | boolean>;
  nodeAttributes?: Record<string, string | number | boolean>;
  edgeAttributes?: Record<string, string | number | boolean>;
}

export interface VizRenderError {
  level?: 'error' | 'warning';
  message: string;
}

export type VizRenderResult =
  | {status: 'success'; output: string; errors: VizRenderError[]}
  | {status: 'failure'; output: undefined; errors: VizRenderError[]};
