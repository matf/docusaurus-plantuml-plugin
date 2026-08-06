import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
} from 'react';

import {
  clampTransform,
  fitScale,
  formatPercent,
  formatZoom,
  IDENTITY,
  MAX_SCALE,
  MIN_SCALE,
  normalizeWheelDelta,
  panBy,
  PAN_STEP,
  SCALE_STEP,
  toCssTransform,
  wheelZoomFactor,
  zoomAbout,
  type Bounds,
  type Transform,
} from './zoomMath.js';

/**
 * Zoom, pan and fullscreen for one diagram.
 *
 * The hook holds no React state at all. The transform lives in a ref and is written straight
 * to the DOM, so panning never re-renders the component — and, more usefully, "no state update
 * after unmount" becomes structurally true rather than something a guard has to enforce.
 */

/** Distance the pointer must travel before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD_PX = 3;

/** Fraction of the viewport a Shift+arrow press pans. */
const PAGE_PAN_RATIO = 0.9;

export interface ZoomPanHandle {
  viewportRef: MutableRefObject<HTMLDivElement | null>;
  layerRef: MutableRefObject<HTMLDivElement | null>;
  readoutRef: MutableRefObject<HTMLSpanElement | null>;
  stageRef: MutableRefObject<HTMLDivElement | null>;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  toggleFullscreen: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  /** Whether this browser can fullscreen an element, so the button can be hidden if not. */
  fullscreenSupported: boolean;
}

export interface UseZoomPanParams {
  enabled: boolean;
  /**
   * Changing this resets the view. Pass something that identifies the rendered picture, so a
   * new diagram or a colour-mode switch starts from a clean 100% view.
   */
  resetKey: string;
}

interface FullscreenCapableElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

interface FullscreenCapableDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

function supportsFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as FullscreenCapableDocument;
  return Boolean(
    doc.fullscreenEnabled ||
    typeof (document.documentElement as FullscreenCapableElement).webkitRequestFullscreen ===
      'function',
  );
}

function currentFullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null;
  const doc = document as FullscreenCapableDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

export function useZoomPan({enabled, resetKey}: UseZoomPanParams): ZoomPanHandle {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const readoutRef = useRef<HTMLSpanElement | null>(null);

  const transformRef = useRef<Transform>(IDENTITY);
  /** The view to restore when leaving fullscreen. */
  const beforeFullscreenRef = useRef<Transform | null>(null);
  const frameRef = useRef<number | null>(null);

  /**
   * Layout sizes, never `getBoundingClientRect()`: the layer's rect includes the transform we
   * are about to change, which would feed back into the next measurement.
   */
  const measure = useCallback((): Bounds => {
    const viewport = viewportRef.current;
    const layer = layerRef.current;
    return {
      viewportWidth: viewport?.clientWidth ?? 0,
      viewportHeight: viewport?.clientHeight ?? 0,
      contentWidth: layer?.offsetWidth ?? 0,
      contentHeight: layer?.offsetHeight ?? 0,
    };
  }, []);

  const write = useCallback((next: Transform) => {
    transformRef.current = next;
    const layer = layerRef.current;
    const viewport = viewportRef.current;
    if (layer) layer.style.transform = toCssTransform(next);
    if (viewport) viewport.dataset['plantumlZoom'] = formatZoom(next.k);
    const readout = readoutRef.current;
    if (readout) readout.textContent = formatPercent(next.k);
  }, []);

  const apply = useCallback(
    (next: Transform) => {
      write(clampTransform(next, measure()));
    },
    [measure, write],
  );

  const reset = useCallback(() => {
    apply(IDENTITY);
  }, [apply]);

  /** Zooms about the middle of the viewport, which is what buttons and keys should do. */
  const zoomByStep = useCallback(
    (factor: number) => {
      const viewport = viewportRef.current;
      const focalX = (viewport?.clientWidth ?? 0) / 2;
      const focalY = (viewport?.clientHeight ?? 0) / 2;
      apply(zoomAbout(transformRef.current, factor, focalX, focalY));
    },
    [apply],
  );

  const zoomIn = useCallback(() => zoomByStep(SCALE_STEP), [zoomByStep]);
  const zoomOut = useCallback(() => zoomByStep(1 / SCALE_STEP), [zoomByStep]);

  const toggleFullscreen = useCallback(() => {
    const stage = stageRef.current as FullscreenCapableElement | null;
    if (!stage) return;

    const doc = document as FullscreenCapableDocument;
    if (currentFullscreenElement()) {
      void (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
      return;
    }
    beforeFullscreenRef.current = transformRef.current;
    void (stage.requestFullscreen?.() ?? stage.webkitRequestFullscreen?.());
  }, []);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!enabled) return;
      // Leave Ctrl+0, Cmd+Arrow and friends to the browser.
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const viewport = viewportRef.current;
      const pageX = (viewport?.clientWidth ?? 0) * PAGE_PAN_RATIO;
      const pageY = (viewport?.clientHeight ?? 0) * PAGE_PAN_RATIO;
      const stepX = event.shiftKey ? pageX : PAN_STEP;
      const stepY = event.shiftKey ? pageY : PAN_STEP;

      switch (event.key) {
        case '+':
        case '=':
          zoomIn();
          break;
        case '-':
        case '_':
          zoomOut();
          break;
        case '0':
          reset();
          break;
        case 'ArrowLeft':
          apply(panBy(transformRef.current, stepX, 0));
          break;
        case 'ArrowRight':
          apply(panBy(transformRef.current, -stepX, 0));
          break;
        case 'ArrowUp':
          apply(panBy(transformRef.current, 0, stepY));
          break;
        case 'ArrowDown':
          apply(panBy(transformRef.current, 0, -stepY));
          break;
        default:
          // Not ours: let the key through, so Tab still escapes the diagram.
          return;
      }
      event.preventDefault();
    },
    [apply, enabled, reset, zoomIn, zoomOut],
  );

  // Everything imperative lives in this one effect, so one cleanup removes all of it.
  useEffect(() => {
    if (!enabled) return undefined;
    const viewport = viewportRef.current;
    if (!viewport) return undefined;

    // The layer node is replaced whenever the rendered SVG changes; start from a clean view.
    write(IDENTITY);

    let dragging = false;
    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let startTransform = IDENTITY;
    let pendingX = 0;
    let pendingY = 0;
    let suppressClick = false;

    const setContinuous = (on: boolean) => {
      const layer = layerRef.current;
      if (layer) layer.dataset['plantumlContinuous'] = on ? 'true' : 'false';
    };

    const onWheel = (event: WheelEvent) => {
      // Plain wheel must keep scrolling the page. Only Ctrl zooms — Cmd is the browser's own
      // page zoom on macOS, and trackpad pinch already arrives here as Ctrl+wheel.
      if (!event.ctrlKey) return;
      event.preventDefault();

      const rect = viewport.getBoundingClientRect();
      const factor = wheelZoomFactor(normalizeWheelDelta(event.deltaY, event.deltaMode));
      setContinuous(true);
      apply(
        zoomAbout(
          transformRef.current,
          factor,
          event.clientX - rect.left,
          event.clientY - rect.top,
        ),
      );
    };

    const flushPan = () => {
      frameRef.current = null;
      apply(panBy(startTransform, pendingX, pendingY));
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      // Deliberately no preventDefault: it would kill focus and text selection, and links
      // inside a diagram must still be clickable.
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startTransform = transformRef.current;
      pendingX = 0;
      pendingY = 0;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      pendingX = event.clientX - startX;
      pendingY = event.clientY - startY;

      if (!dragging) {
        if (Math.hypot(pendingX, pendingY) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        suppressClick = true;
        viewport.dataset['plantumlDragging'] = 'true';
        setContinuous(true);
        try {
          viewport.setPointerCapture(pointerId);
        } catch {
          // Capture is unavailable in some environments; dragging still works without it.
        }
      }

      event.preventDefault();
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(flushPan);
      }
    };

    const endDrag = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
        flushPan();
      }
      try {
        if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
      } catch {
        // Nothing to release.
      }
      pointerId = null;
      dragging = false;
      delete viewport.dataset['plantumlDragging'];
      setContinuous(false);
    };

    // A drag that ends over a link must not activate it.
    const onClickCapture = (event: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    const onFullscreenChange = () => {
      const stage = stageRef.current;
      const isFullscreen = stage !== null && currentFullscreenElement() === stage;
      if (isFullscreen) {
        // Fill the screen: the viewport is much larger now, so refit rather than keep a
        // transform that was computed for a column-width box.
        apply({...IDENTITY, k: fitScale(measure())});
      } else {
        apply(beforeFullscreenRef.current ?? IDENTITY);
        beforeFullscreenRef.current = null;
      }
    };

    viewport.addEventListener('wheel', onWheel, {passive: false});
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);
    viewport.addEventListener('lostpointercapture', endDrag);
    viewport.addEventListener('click', onClickCapture, true);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);

    // Re-clamp when the column width changes (window resize, sidebar collapse), so a panned
    // diagram cannot end up stranded outside a narrower viewport.
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => apply(transformRef.current));
    observer?.observe(viewport);

    return () => {
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('pointerdown', onPointerDown);
      viewport.removeEventListener('pointermove', onPointerMove);
      viewport.removeEventListener('pointerup', endDrag);
      viewport.removeEventListener('pointercancel', endDrag);
      viewport.removeEventListener('lostpointercapture', endDrag);
      viewport.removeEventListener('click', onClickCapture, true);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
      observer?.disconnect();
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (pointerId !== null) {
        try {
          if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
        } catch {
          // Already gone.
        }
      }
    };
    // `resetKey` is a dependency so a re-render of the same node with new content re-arms
    // the listeners against a clean view.
  }, [apply, enabled, measure, resetKey, write]);

  /**
   * A cache hit resolves before any phase is reported, so a colour-mode toggle can go
   * `ready -> ready` without ever unmounting the layer. The effect above would not re-run in
   * that case, which is why the reset is also driven directly by `resetKey`.
   */
  useEffect(() => {
    if (!enabled) return;
    write(IDENTITY);
  }, [enabled, resetKey, write]);

  return {
    stageRef,
    viewportRef,
    layerRef,
    readoutRef,
    zoomIn,
    zoomOut,
    reset,
    toggleFullscreen,
    onKeyDown,
    fullscreenSupported: supportsFullscreen(),
  };
}

export {MAX_SCALE, MIN_SCALE};
