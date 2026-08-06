/**
 * The public surface of `@plantuml/core@1.2026.x`, verified against the installed package.
 *
 * `plantuml.js` exports exactly two functions. Both take an optional trailing options
 * object whose only recognized member is `dark`; see `docs/architecture.md` for how this
 * was established and `tests/e2e/engine-contract.spec.ts` for the regression guard.
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
}

export type DiagramStatus = 'idle' | 'loading' | 'rendering' | 'ready' | 'error';
