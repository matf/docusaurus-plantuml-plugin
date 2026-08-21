import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
 * Zoom, pan and maximize for one diagram.
 *
 * The transform lives in a ref and is written straight to the DOM, so panning and zooming
 * never re-render the component. The single piece of React state is `maximized`, which changes
 * only on an explicit click or Escape — it drives markup, so it belongs in React, and at one
 * transition per user action it costs nothing.
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
  /** Fits the whole diagram inside the viewport, at whatever scale that takes to fill it. */
  fit: () => void;
  toggleMaximize: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  /** Whether the diagram currently fills the browser viewport. */
  maximized: boolean;
  /** Reads the live transform without subscribing to it. */
  getTransform: () => Transform;
  /** Applies a transform through the same clamp as every gesture. */
  applyTransform: (next: Transform) => void;
  /** Layout sizes of the viewport and content — the bounds the clamp runs against. */
  measure: () => Bounds;
  /**
   * Calls the listener after every committed transform write; returns the unsubscribe.
   *
   * This is how the minimap tracks the view: the transform is written straight to the DOM on
   * every pan frame, so anything that mirrored it through React state would re-render the
   * component once per frame.
   */
  subscribe: (listener: (transform: Transform) => void) => () => void;
}

export interface UseZoomPanParams {
  enabled: boolean;
  /**
   * Changing this resets the view. Pass something that identifies the rendered picture, so a
   * new diagram or a colour-mode switch starts from a clean 100% view.
   */
  resetKey: string;
}

export function useZoomPan({enabled, resetKey}: UseZoomPanParams): ZoomPanHandle {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const readoutRef = useRef<HTMLSpanElement | null>(null);

  const [maximized, setMaximized] = useState(false);
  const transformRef = useRef<Transform>(IDENTITY);
  const listenersRef = useRef<Set<(transform: Transform) => void>>(new Set());
  /** The view to restore when the diagram is un-maximized. */
  const beforeMaximizeRef = useRef<Transform | null>(null);
  const frameRef = useRef<number | null>(null);

  /**
   * Layout sizes, never `getBoundingClientRect()`: the layer's rect includes the transform we
   * are about to change — and, mid-easing, the transition — which would feed back into the
   * next measurement. The layer is `width: fit-content`, so its layout size *is* the rendered
   * picture's, not the full-width frame's; that is what lets fitting fill a maximized screen,
   * keeps the minimap honest about where the diagram ends, and tells the clamp how much empty
   * space a fitted diagram may be dragged into.
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
    for (const listener of listenersRef.current) listener(next);
  }, []);

  const subscribe = useCallback((listener: (transform: Transform) => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const getTransform = useCallback(() => transformRef.current, []);

  /**
   * Every gesture ends here, so the clamp is the single place that decides where a diagram may
   * sit. It is handed the measured picture: the floor that keeps focal zoom honest lives inside
   * {@link clampTransform}, applied to that end of the range only, so the other end can offer a
   * fitted diagram the real empty space beside it.
   */
  const apply = useCallback(
    (next: Transform) => {
      write(clampTransform(next, measure()));
    },
    [measure, write],
  );

  const reset = useCallback(() => {
    apply(IDENTITY);
  }, [apply]);

  /**
   * Zooms about the viewport's top-left corner.
   *
   * Not the centre: a diagram rarely fills its viewport, and one that fits opens at the origin,
   * so the empty space sits to its right and below. Zooming about the centre scales that empty
   * space too and pushes the diagram off the top and left edges — most visibly when maximized.
   * Anchoring at the top-left leaves the diagram exactly where it is and grows it into the
   * empty space, keeping it visible as long as possible.
   *
   * Wheel zoom still tracks the pointer, which is what direct manipulation should do.
   */
  const zoomByStep = useCallback(
    (factor: number) => {
      apply(zoomAbout(transformRef.current, factor, 0, 0));
    },
    [apply],
  );

  const zoomIn = useCallback(() => zoomByStep(SCALE_STEP), [zoomByStep]);
  const zoomOut = useCallback(() => zoomByStep(1 / SCALE_STEP), [zoomByStep]);

  /**
   * The fitted view maximizing opens with: the diagram scaled to fill the screen, magnified
   * or shrunk as the picture demands, capped at {@link MAX_SCALE}.
   *
   * Only offered while maximized. Inline it would duplicate Reset, because the inline frame
   * grows with the diagram — at 100% everything is already visible, so there is nothing for
   * a fit to add. Translation returns to the origin: fitting is "show me all of it from the
   * top", and the reader can drag it wherever they like from there.
   */
  const fit = useCallback(() => {
    apply({...IDENTITY, k: fitScale(measure())});
  }, [apply, measure]);

  const toggleMaximize = useCallback(() => {
    setMaximized((previous) => !previous);
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

    viewport.addEventListener('wheel', onWheel, {passive: false});
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);
    viewport.addEventListener('lostpointercapture', endDrag);
    viewport.addEventListener('click', onClickCapture, true);

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
   * The single owner of "reset the view".
   *
   * `resetKey` identifies the rendered picture, so this covers both a new diagram and a
   * colour-mode change — including the case where a cache hit resolves before any phase is
   * reported and the component goes `ready -> ready` without the layer ever unmounting.
   *
   * The listener effect deliberately does *not* also reset. Its dependencies are a superset of
   * this one's, so any re-attach for an unrelated reason — a remount, or a callback identity
   * change from a future refactor — would silently throw away a zoom the reader had chosen.
   * One owner means a reset happens when the picture changes, and at no other time.
   */
  useEffect(() => {
    if (!enabled) return;
    write(IDENTITY);
  }, [enabled, resetKey, write]);

  /**
   * Maximizing is done in the page, not with the Fullscreen API.
   *
   * `requestFullscreen()` gave two problems it cannot solve: Firefox takes the whole browser
   * window fullscreen rather than presenting the element, and the `::backdrop` is outside the
   * element so the page behind it shows through. A fixed-position overlay we own has neither
   * issue, works identically in every browser, and needs no capability detection — which also
   * restores the control on iOS Safari, where element fullscreen does not exist.
   */
  useEffect(() => {
    if (!enabled || !maximized) return undefined;

    beforeMaximizeRef.current = transformRef.current;

    // The overlay covers the viewport; scrolling the page underneath it would be confusing.
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';

    // The layout is already committed by the time an effect runs, so the viewport now
    // reports its maximized size and the diagram can be fitted to it.
    apply({...IDENTITY, k: fitScale(measure())});
    viewportRef.current?.focus();

    const onKeyDownDocument = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMaximized(false);
    };
    document.addEventListener('keydown', onKeyDownDocument);

    return () => {
      document.removeEventListener('keydown', onKeyDownDocument);
      body.style.overflow = previousOverflow;
      apply(beforeMaximizeRef.current ?? IDENTITY);
      beforeMaximizeRef.current = null;
    };
  }, [apply, enabled, maximized, measure]);

  // A diagram that is re-rendered or unmounted must not leave the page scroll-locked.
  useEffect(() => {
    if (!enabled) setMaximized(false);
  }, [enabled]);

  // One stable object per set of values: consumers hang effects off the handle (the search
  // hook, the minimap), and an object recreated every render would re-run all of them — with
  // visible consequences, such as a search that resets to its first match on any re-render.
  return useMemo(
    () => ({
      stageRef,
      viewportRef,
      layerRef,
      readoutRef,
      zoomIn,
      zoomOut,
      reset,
      fit,
      toggleMaximize,
      onKeyDown,
      maximized,
      getTransform,
      applyTransform: apply,
      measure,
      subscribe,
    }),
    [
      zoomIn,
      zoomOut,
      reset,
      fit,
      toggleMaximize,
      onKeyDown,
      maximized,
      getTransform,
      apply,
      measure,
      subscribe,
    ],
  );
}

export {MAX_SCALE, MIN_SCALE};
