import {useEffect, useId, useRef, useState, type ReactNode} from 'react';

import {useColorMode} from '@docusaurus/theme-common';

import {DATA_ATTR} from '../../constants.js';
import {getSharedCache} from '../../runtime/cache.js';
import {PlantUmlError} from '../../runtime/errors.js';
import {renderDiagram} from '../../runtime/renderer.js';
import type {DiagramStatus} from '../../runtime/types.js';
import {usePlantUmlConfig} from '../usePlantUmlConfig.js';
import {useZoomPan} from './useZoomPan.js';
import styles from './styles.module.css';

export interface PlantUmlDiagramProps {
  /** Raw PlantUML source, exactly as authored between the fence markers. */
  source: string;
  /** `title="..."` from the fence metastring; used as caption and accessible label. */
  title?: string;
  /** The fence language that matched, e.g. `plantuml` or `puml`. */
  language?: string;
  /**
   * Overrides the `zoom` plugin option for this diagram. `undefined` follows the option.
   * Set from the fence metastring: `zoom` or `zoom=false`.
   */
  zoom?: boolean;
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
  zoom: zoomProp,
}: PlantUmlDiagramProps): ReactNode {
  const config = usePlantUmlConfig();
  const {colorMode} = useColorMode();
  const containerRef = useRef<HTMLElement | null>(null);
  const hintId = useId();

  const themeOption = config?.options.theme ?? 'auto';
  const dark = themeOption === 'auto' ? colorMode === 'dark' : themeOption === 'dark';
  const lazy = config?.options.lazy ?? true;

  // A fence flag wins over the plugin option, which in turn wins over the built-in default.
  const interactive = zoomProp ?? config?.options.zoom ?? true;

  const [state, setState] = useState<RenderState>(INITIAL_STATE);
  const [inView, setInView] = useState(!lazy);

  // Called unconditionally, as hooks must be; it attaches nothing when not interactive.
  const zoom = useZoomPan({
    enabled: interactive && state.status === 'ready',
    resetKey: `${source}|${dark ? 'dark' : 'light'}`,
  });

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

  // The sanitized SVG always lives in this element, zoomable or not, so `role="img" > svg`
  // stays a stable contract for tests and for author CSS.
  const canvas = state.svg !== null && (
    <div
      className={styles.canvas}
      role="img"
      aria-label={label}
      // Sanitized above unless `sanitizeSvg: false` was explicitly opted into.
      dangerouslySetInnerHTML={{__html: state.svg}}
    />
  );

  return (
    <figure
      ref={containerRef}
      className={styles.figure}
      aria-busy={busy || undefined}
      {...{
        [DATA_ATTR.diagram]: language ?? 'plantuml',
        [DATA_ATTR.status]: state.status,
        [DATA_ATTR.theme]: dark ? 'dark' : 'light',
        ...(interactive ? {[DATA_ATTR.interactive]: 'true'} : {}),
        ...(zoom.maximized ? {[DATA_ATTR.maximized]: 'true'} : {}),
      }}
    >
      {state.status === 'ready' && state.svg !== null && !interactive && canvas}

      {state.status === 'ready' && state.svg !== null && interactive && (
        <div
          ref={zoom.stageRef}
          className={zoom.maximized ? `${styles.stage} ${styles.maximized}` : styles.stage}
        >
          <div
            ref={zoom.viewportRef}
            className={styles.viewport}
            tabIndex={0}
            aria-describedby={hintId}
            aria-keyshortcuts="Plus Minus 0 ArrowUp ArrowDown ArrowLeft ArrowRight"
            onKeyDown={zoom.onKeyDown}
            // React renders the initial value so the element is findable by this attribute from the
            // first paint — it is the selector tests and author CSS use. The hook then owns the value.
            // React never rewrites an unchanged attribute, so the two do not fight.
            {...{[DATA_ATTR.zoom]: '1'}}
          >
            {/*
             * The transform layer sits outside the `role="img"` element on purpose: that
             * element uses `dangerouslySetInnerHTML`, so it cannot have React children, and
             * `role="img"` makes its whole subtree opaque to assistive technology.
             */}
            <div ref={zoom.layerRef} className={styles.layer}>
              {canvas}
            </div>
          </div>

          {/*
           * `role="group"`, not `role="toolbar"`: a toolbar owes readers arrow-key navigation
           * between its buttons, and the arrow keys already pan the diagram.
           */}
          <div className={styles.toolbar} role="group" aria-label={`${label} zoom controls`}>
            <button
              type="button"
              className={styles.toolbarButton}
              aria-label="Zoom out"
              onClick={zoom.zoomOut}
            >
              <span aria-hidden="true">−</span>
            </button>
            <button
              type="button"
              className={styles.toolbarButton}
              aria-label="Zoom in"
              onClick={zoom.zoomIn}
            >
              <span aria-hidden="true">+</span>
            </button>
            <button
              type="button"
              className={styles.toolbarButton}
              aria-label="Reset zoom"
              onClick={zoom.reset}
            >
              <span aria-hidden="true">⟲</span>
            </button>
            <button
              type="button"
              className={styles.toolbarButton}
              aria-label="Maximize diagram"
              aria-pressed={zoom.maximized}
              onClick={zoom.toggleMaximize}
            >
              <span aria-hidden="true">{zoom.maximized ? '✕' : '⛶'}</span>
            </button>
            {/* Hidden from assistive tech: a live percentage would announce on every tick. */}
            <span ref={zoom.readoutRef} className={styles.readout} aria-hidden="true">
              100%
            </span>
          </div>
        </div>
      )}

      {state.status === 'ready' && state.svg !== null && interactive && (
        <p id={hintId} className={styles.visuallyHidden}>
          Zoomable diagram. Use the zoom controls, or press plus and minus to zoom, the arrow keys
          to pan, and zero to reset.
        </p>
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
