import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

import {useLocation} from '@docusaurus/router';
import {useColorMode} from '@docusaurus/theme-common';

import {DATA_ATTR} from '../../constants.js';
import {getSharedCache} from '../../runtime/cache.js';
import {PlantUmlError} from '../../runtime/errors.js';
import {renderGraphvizDiagram} from '../../runtime/graphvizRenderer.js';
import {renderDiagram} from '../../runtime/renderer.js';
import type {DiagramEngine, DiagramStatus} from '../../runtime/types.js';
import {usePlantUmlConfig} from '../usePlantUmlConfig.js';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  FitIcon,
  MaximizeIcon,
  MinimapIcon,
  ResetZoomIcon,
  SearchIcon,
  SourceIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from './icons.js';
import {parseDiagramHash} from './deeplink.js';
import Minimap from './Minimap.js';
import {useDiagramDeeplink} from './useDiagramDeeplink.js';
import {useDiagramLinks} from './useDiagramLinks.js';
import {useDiagramSearch} from './useDiagramSearch.js';
import {useZoomPan} from './useZoomPan.js';
import styles from './styles.module.css';

export interface PlantUmlDiagramProps {
  /** Raw diagram source, exactly as authored between the fence markers. */
  source: string;
  /** `title="..."` from the fence metastring; used as caption and accessible label. */
  title?: string;
  /** The fence language that matched, e.g. `plantuml`, `puml`, `dot`. */
  language?: string;
  /** Which engine renders this fence. Defaults to `plantuml`. */
  engine?: DiagramEngine;
  /**
   * Graphviz layout engine from the fence metastring (`engine=neato`). Ignored for PlantUML,
   * and ignored entirely when `graphviz.allowEngineOverride` is off.
   */
  layout?: string;
  /**
   * Overrides the `zoom` plugin option for this diagram. `undefined` follows the option.
   * Set from the fence metastring: `zoom` or `zoom=false`.
   */
  zoom?: boolean;
  /**
   * Overrides the `showSource` plugin option for this diagram. `undefined` follows the option.
   * Set from the fence metastring: `showSource` or `showSource=false`.
   */
  showSource?: boolean;
}

/**
 * Human-readable engine names, used in labels, progress text and error headings so that a
 * reader is told which engine is involved rather than being shown a generic failure.
 */
const ENGINE_LABEL: Record<DiagramEngine, string> = {
  plantuml: 'PlantUML',
  graphviz: 'Graphviz',
};

/** Margin large enough that a diagram is usually ready by the time it is scrolled into view. */
const LAZY_ROOT_MARGIN = '300px';

/** How long the copy result stays on screen before the control goes quiet again. */
const COPY_FEEDBACK_MS = 2_000;

type CopyState = 'idle' | 'copied' | 'failed';

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
 * Renders one diagram in the browser, with either engine.
 *
 * The component is deliberately engine-agnostic: its job is states, ARIA, zoom and error
 * presentation, none of which differs between PlantUML and Graphviz. Only the render call and
 * the wording around it branch. (The name is historical — it predates Graphviz support.)
 *
 * Nothing happens during server-side rendering: the markup emitted on the server is the
 * same deferred placeholder the client renders first, so hydration never mismatches.
 */
export default function PlantUmlDiagram({
  source,
  title,
  language,
  engine = 'plantuml',
  layout,
  zoom: zoomProp,
  showSource: showSourceProp,
}: PlantUmlDiagramProps): ReactNode {
  const config = usePlantUmlConfig();
  const {colorMode} = useColorMode();
  // The router, not `window.location`: `<Link>` navigations are `history.pushState` calls
  // that fire no DOM event, so only the router sees every way the hash can change.
  const routerLocation = useLocation();
  const containerRef = useRef<HTMLElement | null>(null);
  const hintId = useId();
  const sourcePanelId = useId();

  const themeOption = config?.options.theme ?? 'auto';
  const dark = themeOption === 'auto' ? colorMode === 'dark' : themeOption === 'dark';
  const lazy = config?.options.lazy ?? true;
  const engineName = ENGINE_LABEL[engine];

  const graphvizOptions = config?.options.graphviz;
  // A fence may only pick a layout engine when the site allows it; otherwise the configured
  // default wins silently, exactly as it would if the fence had said nothing.
  const resolvedLayout =
    (graphvizOptions?.allowEngineOverride ? layout : undefined) ?? graphvizOptions?.engine ?? 'dot';

  // Graphviz output does not depend on the colour mode — it adapts through CSS instead — so a
  // colour-mode toggle must not re-run the render effect for a DOT diagram.
  const renderDark = engine === 'graphviz' ? false : dark;

  // A fence flag wins over the plugin option, which in turn wins over the built-in default.
  const interactive = zoomProp ?? config?.options.zoom ?? true;
  const sourceAvailable = showSourceProp ?? config?.options.showSource ?? true;

  const [state, setState] = useState<RenderState>(INITIAL_STATE);
  // A diagram deep link must be able to reach a diagram below the fold, so a `#graph?…`
  // hash defeats lazy rendering. The router's server-side location has no hash, and the
  // first paint is the placeholder either way, so hydration cannot mismatch.
  const [inView, setInView] = useState(
    () => !lazy || parseDiagramHash(routerLocation.hash) !== null,
  );
  const [sourceOpen, setSourceOpen] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // A pending "Copied" message must not fire into an unmounted component.
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  /**
   * Copies the source, and says whether it worked.
   *
   * `navigator.clipboard` is undefined outside a secure context, which a documentation site
   * served over plain HTTP genuinely is. Reporting that plainly is better than a control that
   * silently does nothing — the panel is open, so the reader can still select the text.
   */
  const copySource = useCallback(() => {
    const settle = (next: Exclude<CopyState, 'idle'>) => {
      setCopyState(next);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopyState('idle'), COPY_FEEDBACK_MS);
    };
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (typeof clipboard?.writeText !== 'function') {
      settle('failed');
      return;
    }
    void clipboard.writeText(source).then(
      () => settle('copied'),
      () => settle('failed'),
    );
  }, [source]);

  // A diagram whose source changed is a different diagram: an open panel would otherwise keep
  // showing the old text's copy result, and the reader would have no idea it was stale.
  useEffect(() => {
    setCopyState('idle');
  }, [source]);

  // Called unconditionally, as hooks must be; it attaches nothing when not interactive.
  const zoom = useZoomPan({
    enabled: interactive && state.status === 'ready',
    // Keyed on what can change the picture. `renderDark`, not `dark`: a Graphviz diagram is
    // not re-rendered on a colour-mode toggle, so resetting the reader's zoom would be a
    // gratuitous jump.
    resetKey: `${source}|${engine}|${resolvedLayout}|${renderDark ? 'dark' : 'light'}`,
  });

  const search = useDiagramSearch({
    enabled: interactive && state.status === 'ready',
    zoom,
    svg: state.svg,
  });

  useDiagramDeeplink({
    ready: state.status === 'ready' && state.svg !== null,
    svg: state.svg,
    interactive,
    zoom,
    containerRef,
  });

  useDiagramLinks({
    ready: state.status === 'ready' && state.svg !== null,
    svg: state.svg,
    engine,
    source,
    containerRef,
  });

  // A hash arriving *after* mount must defeat lazy rendering too — a deep link followed
  // from another diagram on the same page may point below the fold. Driven by the router
  // location rather than `hashchange`, which `<Link>` navigations never fire.
  useEffect(() => {
    if (!inView && parseDiagramHash(routerLocation.hash) !== null) setInView(true);
  }, [inView, routerLocation.hash]);

  const searchToggleRef = useRef<HTMLButtonElement | null>(null);

  // Escape and the ✕ hand focus back to the toggle, so the keyboard is not left stranded on
  // a control that just left the page.
  const closeSearch = useCallback(() => {
    search.close();
    searchToggleRef.current?.focus();
  }, [search]);

  const onSearchKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (event.shiftKey) search.previous();
        else search.next();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        // Escape in the search closes the search. Without this, the document-level listener
        // would also un-maximize the diagram in the same keystroke.
        event.stopPropagation();
        closeSearch();
      }
    },
    [closeSearch, search],
  );

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
          'Diagram plugin data is missing. Add the plugin to the `plugins` array in your ' +
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

    const shared = {
      source,
      sanitize: options.sanitizeSvg,
      timeoutMs: options.renderTimeoutMs,
      assetsBaseUrl: config.assetsBaseUrl,
      coreVersion: config.coreVersion,
      cache: getSharedCache(options.cache, options.cacheMaxEntries),
      signal: controller.signal,
      onPhase: (phase: 'loading' | 'rendering') => commit({status: phase, svg: null, error: null}),
    };

    const pending =
      engine === 'graphviz'
        ? renderGraphvizDiagram({
            ...shared,
            layout: resolvedLayout,
            transparentBackground: options.graphviz.transparentBackground,
            maxSourceBytes: options.graphviz.maxSourceBytes,
          })
        : renderDiagram({...shared, dark: renderDark, stdlib: config.stdlib});

    void pending
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
    renderDark,
    engine,
    resolvedLayout,
    config,
    config?.assetsBaseUrl,
    config?.coreVersion,
    config?.stdlib,
    config?.options.sanitizeSvg,
    config?.options.renderTimeoutMs,
    config?.options.cache,
    config?.options.cacheMaxEntries,
    config?.options.graphviz.transparentBackground,
    config?.options.graphviz.maxSourceBytes,
  ]);

  const label = title ?? `${engineName} diagram`;
  const busy = state.status === 'loading' || state.status === 'rendering';

  /**
   * One wrapper object per SVG string, not a fresh literal in the JSX: React 19 compares
   * `dangerouslySetInnerHTML` by the wrapper's identity, not by `__html`, so an inline
   * literal makes every re-render of the figure re-parse the whole SVG subtree — visibly
   * so once anything marks the rendered elements, as the search's highlights do.
   */
  const svgHtml = useMemo(() => (state.svg === null ? null : {__html: state.svg}), [state.svg]);

  // The sanitized SVG always lives in this element, zoomable or not, so `role="img" > svg`
  // stays a stable contract for tests and for author CSS.
  const canvas = state.svg !== null && svgHtml !== null && (
    <div
      className={
        !interactive && sourceOpen ? `${styles.canvas} ${styles.hiddenView}` : styles.canvas
      }
      role="img"
      aria-label={label}
      // Sanitized above unless `sanitizeSvg: false` was explicitly opted into.
      dangerouslySetInnerHTML={svgHtml}
    />
  );

  const copyControl = sourceAvailable && sourceOpen && state.status === 'ready' && (
    <button
      type="button"
      className={`${styles.toolbarButton} ${styles.toolbarTextButton}`}
      aria-label={`Copy ${engineName} source to clipboard`}
      onClick={copySource}
    >
      Copy
    </button>
  );

  const sourceToggle = sourceAvailable && (
    <button
      type="button"
      className={styles.toolbarButton}
      aria-label={sourceOpen ? 'Hide diagram source' : 'Show diagram source'}
      aria-expanded={sourceOpen}
      aria-controls={sourcePanelId}
      onClick={() => setSourceOpen((open) => !open)}
    >
      <SourceIcon />
    </button>
  );

  /**
   * The source *replaces the diagram in its own frame* rather than appearing beneath it.
   *
   * Below the diagram it had two failure modes that the frame removes by construction: a
   * diagram taller than the window pushed the panel off-screen, so the control looked broken;
   * and while maximized the panel was painted behind the `position: fixed` overlay, so it was
   * invisible however far you scrolled. Living in the same box as the picture, it is visible
   * exactly when and where the picture was.
   */
  const sourceView = sourceAvailable && sourceOpen && state.status === 'ready' && (
    <div className={styles.sourceView} id={sourcePanelId}>
      {/*
       * A label and the copy result, with no rule beneath them: the diagram view has no header
       * chrome, so giving the source view a bordered bar made the two look like different kinds
       * of thing. The copy control itself lives in the toolbar, beside zoom and the view switch,
       * where every other control on a diagram already is.
       */}
      <div className={styles.sourceViewBar}>
        <span className={styles.sourceViewTitle}>{engineName} source</span>
        {/*
         * `role="status"` rather than a changing button label: a reader using a screen reader
         * hears the outcome once, and the button keeps the same accessible name throughout.
         */}
        <span className={styles.copyStatus} role="status">
          {copyState === 'copied' ? 'Copied to clipboard' : null}
          {copyState === 'failed' ? 'Could not copy — select the text instead' : null}
        </span>
      </div>
      <pre className={styles.sourceCode}>{source}</pre>
    </div>
  );

  return (
    <figure
      ref={containerRef}
      className={styles.figure}
      aria-busy={busy || undefined}
      {...{
        [DATA_ATTR.diagram]: language ?? engine,
        [DATA_ATTR.engine]: engine,
        ...(engine === 'graphviz' ? {[DATA_ATTR.layout]: resolvedLayout} : {}),
        [DATA_ATTR.status]: state.status,
        [DATA_ATTR.theme]: dark ? 'dark' : 'light',
        ...(interactive ? {[DATA_ATTR.interactive]: 'true'} : {}),
        ...(zoom.maximized ? {[DATA_ATTR.maximized]: 'true'} : {}),
        ...(sourceOpen ? {[DATA_ATTR.sourceOpen]: 'true'} : {}),
        ...(minimapOpen ? {[DATA_ATTR.minimapOpen]: 'true'} : {}),
        ...(search.open ? {[DATA_ATTR.searchOpen]: 'true'} : {}),
      }}
    >
      {/*
       * The canvas collapses with `display: none` rather than being unmounted, so
       * `figure > div[role="img"]` stays the figure's first child — the shape the pre-zoom
       * markup has always had, which both suites pin. Collapsing rather than hiding is right
       * here: with no zoom frame there is no box height to preserve, and the source should
       * take the diagram's place rather than appear below it.
       */}
      {state.status === 'ready' && state.svg !== null && !interactive && canvas}

      {state.status === 'ready' && state.svg !== null && !interactive && sourceView}

      {/*
       * With zoom off there is no stage to hang controls on, so the source toggle gets its own
       * row *after* the canvas — which keeps `figure > div[role="img"]` as the first child, the
       * shape the pre-zoom markup has always had.
       *
       * The label says `source controls`, not just `controls`: a diagram titled "…, no zoom"
       * would otherwise be given the accessible name "…, no zoom controls", which reads as —
       * and matches selectors for — the zoom control group it explicitly is not.
       */}
      {state.status === 'ready' && state.svg !== null && !interactive && sourceAvailable && (
        <div className={styles.plainToolbar} role="group" aria-label={`${label} source controls`}>
          {sourceToggle}
          {copyControl}
        </div>
      )}

      {state.status === 'ready' && state.svg !== null && interactive && (
        <div
          ref={zoom.stageRef}
          className={zoom.maximized ? `${styles.stage} ${styles.maximized}` : styles.stage}
        >
          {/*
           * The controls have a row of their own above the picture, rather than floating over
           * its top-right corner. At 100% — the view every reader arrives at — that corner is
           * where a sequence diagram draws its first participant and a graph its leftmost node,
           * so the toolbar covered the diagram exactly where it was most worth reading.
           *
           * The row comes first in the DOM as well as on screen, so tab order follows what the
           * reader sees. Within it, one flex row holds the search bar and the toolbar, so the
           * bar opens beside the controls without either needing to know the other's width.
           */}
          <div className={styles.controls}>
            {search.open && !sourceOpen && (
              <div className={styles.searchBar} role="search" aria-label={`${label} search`}>
                <input
                  ref={search.inputRef}
                  type="text"
                  className={styles.searchInput}
                  placeholder="Search diagram"
                  aria-label="Search diagram text"
                  value={search.query}
                  onChange={(event) => search.setQuery(event.target.value)}
                  onKeyDown={onSearchKeyDown}
                />
                {/*
                 * `role="status"` so a reader hears where they landed after Enter, without a
                 * live region that would announce every keystroke's recount as well — status
                 * is polite, so it only speaks when the reader is idle.
                 */}
                <span className={styles.searchCount} role="status">
                  {search.matchCount === 0
                    ? '0/0'
                    : `${search.currentIndex + 1}/${search.matchCount}`}
                </span>
                <button
                  type="button"
                  className={styles.toolbarButton}
                  aria-label="Previous match"
                  onClick={search.previous}
                >
                  <ChevronUpIcon />
                </button>
                <button
                  type="button"
                  className={styles.toolbarButton}
                  aria-label="Next match"
                  onClick={search.next}
                >
                  <ChevronDownIcon />
                </button>
                <button
                  type="button"
                  className={styles.toolbarButton}
                  aria-label="Close search"
                  onClick={closeSearch}
                >
                  <CloseIcon />
                </button>
              </div>
            )}

            {/*
             * `role="group"`, not `role="toolbar"`: a toolbar owes readers arrow-key navigation
             * between its buttons, and the arrow keys already pan the diagram.
             */}
            {/*
             * The zoom controls are hidden while the source is shown: they would act on a picture
             * nobody can see. Maximize stays — it is what sizes the frame the source is read in,
             * and removing it while maximized would strand the reader with no way back but Escape.
             */}
            <div className={styles.toolbar} role="group" aria-label={`${label} zoom controls`}>
              {!sourceOpen && (
                <button
                  ref={searchToggleRef}
                  type="button"
                  className={styles.toolbarButton}
                  aria-label="Search diagram"
                  aria-expanded={search.open}
                  onClick={search.toggle}
                >
                  <SearchIcon />
                </button>
              )}
              {!sourceOpen && (
                <button
                  type="button"
                  className={styles.toolbarButton}
                  aria-label="Zoom out"
                  onClick={zoom.zoomOut}
                >
                  <ZoomOutIcon />
                </button>
              )}
              {!sourceOpen && (
                <button
                  type="button"
                  className={styles.toolbarButton}
                  aria-label="Zoom in"
                  onClick={zoom.zoomIn}
                >
                  <ZoomInIcon />
                </button>
              )}
              {!sourceOpen && (
                <button
                  type="button"
                  className={styles.toolbarButton}
                  aria-label="Reset zoom"
                  onClick={zoom.reset}
                >
                  <ResetZoomIcon />
                </button>
              )}
              {/*
               * Fit exists only while maximized: there it fills the screen with the diagram,
               * while inline the frame already grows with the picture, so a fit would land
               * on 100% and duplicate Reset.
               */}
              {!sourceOpen && zoom.maximized && (
                <button
                  type="button"
                  className={styles.toolbarButton}
                  aria-label="Fit diagram to screen"
                  onClick={zoom.fit}
                >
                  <FitIcon />
                </button>
              )}
              <button
                type="button"
                className={styles.toolbarButton}
                aria-label="Maximize diagram"
                aria-pressed={zoom.maximized}
                onClick={zoom.toggleMaximize}
              >
                {zoom.maximized ? <CloseIcon /> : <MaximizeIcon />}
              </button>
              {sourceToggle}
              {copyControl}
              {/* Hidden from assistive tech: a live percentage would announce on every tick. */}
              <span
                ref={zoom.readoutRef}
                className={sourceOpen ? `${styles.readout} ${styles.hiddenView}` : styles.readout}
                aria-hidden="true"
              >
                100%
              </span>
            </div>
          </div>

          {/*
           * The viewport and the source view share one grid cell, so the source lands exactly
           * where the picture was, at exactly its size. The viewport is hidden with
           * `visibility`, not `display`, so it keeps contributing its height — the frame does
           * not resize when you flip — and the zoom hook's `clientWidth`/`clientHeight`
           * measurements stay valid for when you flip back.
           */}
          <div className={styles.stageBody}>
            <div
              ref={zoom.viewportRef}
              className={
                sourceOpen ? `${styles.viewport} ${styles.invisibleView}` : styles.viewport
              }
              tabIndex={sourceOpen ? -1 : 0}
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
             * The map is the one control still allowed over the picture: the reader opened it,
             * and it lives inside the diagram row so it is anchored to the picture it mirrors.
             * It disappears with that picture when the source view is flipped on — a map of an
             * invisible diagram would pan nothing anyone can see.
             */}
            {!sourceOpen && minimapOpen && (
              <Minimap svg={state.svg} zoom={zoom} onClose={() => setMinimapOpen(false)} />
            )}
            {sourceView}
          </div>

          {/*
           * The bottom row, mirroring the controls at the top: the minimap toggle, sitting
           * under the picture rather than over its bottom-left corner.
           */}
          {!sourceOpen && (
            <div className={styles.minimapBar}>
              <button
                type="button"
                className={styles.toolbarButton}
                aria-label={minimapOpen ? 'Hide minimap' : 'Show minimap'}
                aria-expanded={minimapOpen}
                onClick={() => setMinimapOpen((open) => !open)}
              >
                <MinimapIcon />
              </button>
            </div>
          )}
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
            {state.status === 'loading' ? `Loading ${engineName} runtime…` : null}
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
            <span>Error: {engineName} diagram could not be rendered</span>
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
