/**
 * Geometry for zooming and panning a diagram.
 *
 * Every function here is pure and DOM-free, which is what makes the interaction testable:
 * jsdom reports every element as zero-sized, so the maths cannot be verified through the
 * component. It is verified directly instead, and the component tests only check wiring.
 */

export interface Transform {
  /** Scale factor. */
  k: number;
  /** Horizontal translation in CSS pixels, applied before scaling (`transform-origin: 0 0`). */
  x: number;
  /** Vertical translation in CSS pixels. */
  y: number;
}

export interface Bounds {
  viewportWidth: number;
  viewportHeight: number;
  /** Layout size of the content at scale 1 — never a `getBoundingClientRect()` measurement. */
  contentWidth: number;
  contentHeight: number;
}

export const IDENTITY: Transform = {k: 1, x: 0, y: 0};

/** Smallest and largest scale a reader can reach, and the discrete step for buttons and keys. */
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 8;
export const SCALE_STEP = 1.25;
/** Arrow-key pan distance, in CSS pixels. */
export const PAN_STEP = 48;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Scales about a focal point expressed in viewport coordinates, keeping the content under
 * that point fixed.
 *
 * With `transform-origin: 0 0`, a content point `p` maps to `v = p * k + t`. Solving for the
 * translation that leaves `v` unchanged at the new scale gives `t' = f - (f - t) * (k'/k)`.
 *
 * The ratio is deliberately computed from the *achieved* scale rather than the requested
 * factor: at the min or max limit the two differ, and using the requested factor there would
 * drift the diagram sideways on every further wheel tick.
 */
export function zoomAbout(
  transform: Transform,
  factor: number,
  focalX: number,
  focalY: number,
  min = MIN_SCALE,
  max = MAX_SCALE,
): Transform {
  const k = clamp(transform.k * factor, min, max);
  const ratio = k / transform.k;
  return {
    k,
    x: focalX - (focalX - transform.x) * ratio,
    y: focalY - (focalY - transform.y) * ratio,
  };
}

export function panBy(transform: Transform, dx: number, dy: number): Transform {
  return {k: transform.k, x: transform.x + dx, y: transform.y + dy};
}

/**
 * Keeps the diagram reachable, in both directions, one axis at a time.
 *
 * The two ends of the range answer different questions, and are deliberately measured against
 * different things — see {@link clampAxis}. Forwards, the limit is the *empty space* beside the
 * picture: a diagram that fits can be moved through it but never out of the viewport. Content
 * that fits used to be pinned at `0` outright, which left the reader with a grab cursor that
 * moved nothing — most obviously while maximized, where a fitted diagram sits in a corner of a
 * screen with room to spare. Backwards, the limit keeps a magnified diagram from being dragged
 * until an edge comes inside the viewport.
 *
 * The axes are clamped independently, so a wide, short diagram pans horizontally while moving
 * only through the little vertical space it has.
 */
export function clampTransform(transform: Transform, bounds: Bounds): Transform {
  return {
    k: transform.k,
    x: clampAxis(transform.x, bounds.viewportWidth, bounds.contentWidth, transform.k),
    y: clampAxis(transform.y, bounds.viewportHeight, bounds.contentHeight, transform.k),
  };
}

/**
 * One axis of the clamp.
 *
 * **Forwards** (positive translation) the picture may travel exactly as far as the empty space
 * beside it, `viewport - content * k`, and no further — so it never leaves the viewport. Once
 * the content overflows there is no empty space and the limit is `0`.
 *
 * **Backwards** the content size is floored at the viewport's *before* scaling. That looks odd
 * until you zoom: focal zoom must hold the point under the pointer, and a picture narrower than
 * its frame reaches a scale where it overflows while the pointer is still asking it to travel
 * further left than a flush right edge allows. Clamping to the picture there yanks it sideways
 * mid-gesture. The floor buys that fidelity for the price of some empty space at the right
 * while zoomed, which is the trade this component has always made — it is only the *forward*
 * limit, above, that had to stop being measured this way for a fitted diagram to move at all.
 */
function clampAxis(value: number, viewport: number, content: number, k: number): number {
  const forward = Math.max(0, viewport - content * k);
  const backward = Math.min(0, viewport - Math.max(content, viewport) * k);
  return clamp(value, backward, forward);
}

/** `WheelEvent.deltaMode` constants, which jsdom does not define. */
const DELTA_PIXEL = 0;
const DELTA_LINE = 1;
const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 400;

/**
 * Normalizes wheel deltas to pixels.
 *
 * Firefox reports line-based deltas for a mouse wheel, so an un-normalized `deltaY` zooms
 * roughly sixteen times slower there than in Chromium.
 */
export function normalizeWheelDelta(deltaY: number, deltaMode: number): number {
  if (deltaMode === DELTA_PIXEL) return deltaY;
  if (deltaMode === DELTA_LINE) return deltaY * LINE_HEIGHT_PX;
  return deltaY * PAGE_HEIGHT_PX;
}

/** Converts a normalized wheel delta into a multiplicative scale factor. */
export function wheelZoomFactor(normalizedDelta: number): number {
  return Math.exp(-normalizedDelta * 0.002);
}

/**
 * Largest scale at which the whole diagram still fits inside the given viewport.
 *
 * Used when maximizing. Small diagrams are magnified rather than left stranded in
 * the middle of a large screen — the output is vector, so it stays crisp — but never beyond
 * `max`, and never below {@link MIN_SCALE}.
 */
export function fitScale(bounds: Bounds, max = MAX_SCALE): number {
  if (bounds.contentWidth <= 0 || bounds.contentHeight <= 0) return 1;
  const scale = Math.min(
    bounds.viewportWidth / bounds.contentWidth,
    bounds.viewportHeight / bounds.contentHeight,
  );
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return clamp(scale, MIN_SCALE, max);
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Scale of the minimap image: the largest scale that fits the content into the given box,
 * but never past 1 — a small diagram is shown at its own size, not blown up into a blurrier
 * copy of itself sitting next to the original.
 *
 * Returns 0 when there is nothing to draw, which callers treat as "no minimap".
 */
export function minimapScale(bounds: Bounds, maxWidth: number, maxHeight: number): number {
  if (bounds.contentWidth <= 0 || bounds.contentHeight <= 0) return 0;
  const scale = Math.min(maxWidth / bounds.contentWidth, maxHeight / bounds.contentHeight, 1);
  return Number.isFinite(scale) && scale > 0 ? scale : 0;
}

/**
 * The part of the content the viewport currently shows, in content coordinates.
 *
 * Clamped to the content box, so the minimap's viewport rectangle can never poke outside the
 * picture — not even mid-gesture, when the transform itself may be momentarily out of range.
 */
export function visibleContentRect(transform: Transform, bounds: Bounds): Rect {
  const width = Math.min(bounds.viewportWidth / transform.k, bounds.contentWidth);
  const height = Math.min(bounds.viewportHeight / transform.k, bounds.contentHeight);
  return {
    x: clamp(-transform.x / transform.k, 0, Math.max(0, bounds.contentWidth - width)),
    y: clamp(-transform.y / transform.k, 0, Math.max(0, bounds.contentHeight - height)),
    width,
    height,
  };
}

/**
 * The transform that centres the viewport on a content point, at the current scale.
 *
 * Deliberately unclamped: callers apply it through the same clamp as every gesture, which
 * pins edge cases exactly the way the end of a drag is pinned.
 */
export function centerViewportOn(
  transform: Transform,
  contentX: number,
  contentY: number,
  bounds: Bounds,
): Transform {
  return {
    k: transform.k,
    x: bounds.viewportWidth / 2 - contentX * transform.k,
    y: bounds.viewportHeight / 2 - contentY * transform.k,
  };
}

/** Rounds away floating-point noise so repeated zoom in/out returns to exactly 1. */
function tidy(value: number): number {
  return Math.abs(value) < 1e-6 ? 0 : Math.round(value * 1e6) / 1e6;
}

export function toCssTransform(transform: Transform): string {
  return `translate(${tidy(transform.x)}px, ${tidy(transform.y)}px) scale(${tidy(transform.k)})`;
}

/** Machine-readable scale for `data-plantuml-zoom`, used by tests and author CSS. */
export function formatZoom(scale: number): string {
  return String(tidy(Math.round(scale * 1000) / 1000));
}

/** Human-readable scale for the toolbar readout. */
export function formatPercent(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

export function isIdentity(transform: Transform): boolean {
  return tidy(transform.k) === 1 && tidy(transform.x) === 0 && tidy(transform.y) === 0;
}
