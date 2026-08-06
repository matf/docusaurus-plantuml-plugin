import {useEffect, useRef, useState, type ReactNode} from 'react';

import {useColorMode} from '@docusaurus/theme-common';

import {DATA_ATTR} from '../../constants.js';
import {getSharedCache} from '../../runtime/cache.js';
import {PlantUmlError} from '../../runtime/errors.js';
import {renderDiagram} from '../../runtime/renderer.js';
import type {DiagramStatus} from '../../runtime/types.js';
import {usePlantUmlConfig} from '../usePlantUmlConfig.js';
import styles from './styles.module.css';

export interface PlantUmlDiagramProps {
  /** Raw PlantUML source, exactly as authored between the fence markers. */
  source: string;
  /** `title="..."` from the fence metastring; used as caption and accessible label. */
  title?: string;
  /** The fence language that matched, e.g. `plantuml` or `puml`. */
  language?: string;
}

const DEFAULT_LABEL = 'PlantUML diagram';

/** Margin large enough that a diagram is usually ready by the time it is scrolled into view. */
const LAZY_ROOT_MARGIN = '300px';

interface RenderState {
  status: DiagramStatus;
  svg: string | null;
  error: string | null;
}

const INITIAL_STATE: RenderState = {status: 'idle', svg: null, error: null};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function messageFor(error: unknown): string {
  if (error instanceof PlantUmlError) return error.message;
  if (error instanceof Error) return error.message;
  return 'The diagram could not be rendered.';
}

/**
 * Renders one PlantUML diagram in the browser.
 *
 * Nothing happens during server-side rendering: the markup emitted on the server is the
 * same deferred placeholder the client renders first, so hydration never mismatches.
 */
export default function PlantUmlDiagram({
  source,
  title,
  language,
}: PlantUmlDiagramProps): ReactNode {
  const config = usePlantUmlConfig();
  const {colorMode} = useColorMode();
  const containerRef = useRef<HTMLElement | null>(null);

  const themeOption = config?.options.theme ?? 'auto';
  const dark = themeOption === 'auto' ? colorMode === 'dark' : themeOption === 'dark';
  const lazy = config?.options.lazy ?? true;

  const [state, setState] = useState<RenderState>(INITIAL_STATE);
  const [inView, setInView] = useState(!lazy);

  useEffect(() => {
    if (!lazy || inView) return undefined;
    const element = containerRef.current;
    if (!element) return undefined;

    // jsdom and older browsers have no IntersectionObserver; rendering immediately is the
    // correct fallback, since a missing observer must not mean a permanently blank diagram.
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      {rootMargin: LAZY_ROOT_MARGIN},
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [lazy, inView]);

  useEffect(() => {
    if (!inView) return undefined;
    if (!config) {
      setState({
        status: 'error',
        svg: null,
        error:
          'PlantUML plugin data is missing. Add the plugin to the `plugins` array in your ' +
          'Docusaurus configuration and restart the build.',
      });
      return undefined;
    }

    const controller = new AbortController();
    const {options} = config;

    // The signal is the single guard against both stale results and post-unmount updates:
    // the cleanup aborts it, and every state write checks it first. Identical states are
    // dropped so a repeated phase report cannot cause a pointless re-render.
    const commit = (next: RenderState) => {
      if (controller.signal.aborted) return;
      setState((previous) =>
        previous.status === next.status &&
        previous.svg === next.svg &&
        previous.error === next.error
          ? previous
          : next,
      );
    };

    void renderDiagram({
      source,
      dark,
      sanitize: options.sanitizeSvg,
      timeoutMs: options.renderTimeoutMs,
      assetsBaseUrl: config.assetsBaseUrl,
      coreVersion: config.coreVersion,
      cache: getSharedCache(options.cache, options.cacheMaxEntries),
      signal: controller.signal,
      onPhase: (phase) => commit({status: phase, svg: null, error: null}),
    })
      .then((svg) => commit({status: 'ready', svg, error: null}))
      .catch((error: unknown) => {
        if (error instanceof PlantUmlError && error.kind === 'aborted') return;
        commit({status: 'error', svg: null, error: messageFor(error)});
      });

    return () => controller.abort();
    // Depends on the individual values rather than the `config` object, so that an
    // unmemoized config from a future refactor cannot restart rendering on every render.
  }, [
    inView,
    source,
    dark,
    config,
    config?.assetsBaseUrl,
    config?.coreVersion,
    config?.options.sanitizeSvg,
    config?.options.renderTimeoutMs,
    config?.options.cache,
    config?.options.cacheMaxEntries,
  ]);

  const label = title ?? DEFAULT_LABEL;
  const busy = state.status === 'loading' || state.status === 'rendering';

  return (
    <figure
      ref={containerRef}
      className={styles.figure}
      aria-busy={busy || undefined}
      {...{
        [DATA_ATTR.diagram]: language ?? 'plantuml',
        [DATA_ATTR.status]: state.status,
        [DATA_ATTR.theme]: dark ? 'dark' : 'light',
      }}
    >
      {state.status === 'ready' && state.svg !== null && (
        <div
          className={styles.canvas}
          role="img"
          aria-label={label}
          // Sanitized above unless `sanitizeSvg: false` was explicitly opted into.
          dangerouslySetInnerHTML={{__html: state.svg}}
        />
      )}

      {state.status !== 'ready' && state.status !== 'error' && (
        // `aria-busy` on the figure already conveys progress; announcing every phase change
        // would make a page with several diagrams unusable with a screen reader.
        <div className={styles.placeholder}>
          <span className={styles.spinner} aria-hidden="true" />
          <span>
            {state.status === 'loading' ? 'Loading PlantUML runtime…' : null}
            {state.status === 'rendering' ? `Rendering ${label}…` : null}
            {state.status === 'idle' ? `${label} (waiting to render)` : null}
          </span>
        </div>
      )}

      {state.status === 'error' && (
        <div className={styles.error} role="alert">
          <p className={styles.errorHeading}>
            <span className={styles.errorIcon} aria-hidden="true">
              ⚠
            </span>
            <span>Error: PlantUML diagram could not be rendered</span>
          </p>
          <pre className={styles.errorMessage}>{state.error}</pre>
          {config?.options.showSourceOnError !== false && (
            <details className={styles.errorDetails}>
              <summary>Show diagram source</summary>
              <pre className={styles.source}>{source}</pre>
            </details>
          )}
        </div>
      )}

      {title !== undefined && <figcaption className={styles.caption}>{title}</figcaption>}

      {/*
       * Rendering happens in the browser, so readers without JavaScript get the source.
       * `dangerouslySetInnerHTML` keeps React from trying to hydrate the noscript body,
       * which browsers expose as inert text rather than as elements.
       */}
      <noscript
        dangerouslySetInnerHTML={{
          __html: `<pre class="${styles.source ?? ''}">${escapeHtml(source)}</pre>`,
        }}
      />
    </figure>
  );
}
