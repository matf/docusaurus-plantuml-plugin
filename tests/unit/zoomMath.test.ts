import {describe, expect, it} from 'vitest';

import {
  clamp,
  clampTransform,
  fitScale,
  formatPercent,
  formatZoom,
  IDENTITY,
  isIdentity,
  MAX_SCALE,
  MIN_SCALE,
  normalizeWheelDelta,
  panBy,
  SCALE_STEP,
  toCssTransform,
  wheelZoomFactor,
  zoomAbout,
  type Bounds,
  type Transform,
} from '../../src/theme/PlantUmlDiagram/zoomMath.js';

/** Where a content point lands in viewport coordinates under a transform. */
function project(transform: Transform, contentX: number, contentY: number) {
  return {
    x: contentX * transform.k + transform.x,
    y: contentY * transform.k + transform.y,
  };
}

/** The content point currently under a viewport point. */
function unproject(transform: Transform, viewportX: number, viewportY: number) {
  return {
    x: (viewportX - transform.x) / transform.k,
    y: (viewportY - transform.y) / transform.k,
  };
}

describe('zoomAbout', () => {
  it('keeps the content under the focal point fixed', () => {
    const before: Transform = {k: 1.4, x: -30, y: 12};
    const focal = {x: 220, y: 140};
    const content = unproject(before, focal.x, focal.y);

    const after = zoomAbout(before, 1.6, focal.x, focal.y);
    const landed = project(after, content.x, content.y);

    expect(landed.x).toBeCloseTo(focal.x, 9);
    expect(landed.y).toBeCloseTo(focal.y, 9);
  });

  it('keeps the focal point fixed even when the zoom clamps at the maximum', () => {
    // The requested factor and the achieved ratio differ here; using the requested one
    // would drift the diagram on every further wheel tick at the limit.
    const before: Transform = {k: MAX_SCALE - 0.5, x: -400, y: -260};
    const focal = {x: 310, y: 190};
    const content = unproject(before, focal.x, focal.y);

    const after = zoomAbout(before, 4, focal.x, focal.y);
    const landed = project(after, content.x, content.y);

    expect(after.k).toBe(MAX_SCALE);
    expect(landed.x).toBeCloseTo(focal.x, 9);
    expect(landed.y).toBeCloseTo(focal.y, 9);
  });

  it('keeps the focal point fixed when the zoom clamps at the minimum', () => {
    const before: Transform = {k: MIN_SCALE + 0.1, x: 20, y: 8};
    const focal = {x: 90, y: 70};
    const content = unproject(before, focal.x, focal.y);

    const after = zoomAbout(before, 0.05, focal.x, focal.y);
    const landed = project(after, content.x, content.y);

    expect(after.k).toBe(MIN_SCALE);
    expect(landed.x).toBeCloseTo(focal.x, 9);
    expect(landed.y).toBeCloseTo(focal.y, 9);
  });

  it('does not move at all when already at the limit', () => {
    const atMax: Transform = {k: MAX_SCALE, x: -100, y: -50};
    expect(zoomAbout(atMax, 2, 50, 50)).toEqual(atMax);
  });

  it('respects custom limits', () => {
    expect(zoomAbout(IDENTITY, 10, 0, 0, 0.5, 2).k).toBe(2);
    expect(zoomAbout(IDENTITY, 0.01, 0, 0, 0.5, 2).k).toBe(0.5);
  });

  it('leaves a left-aligned diagram in place when anchored at the top-left', () => {
    // What the toolbar buttons do. A diagram that fits its viewport sits at the origin, so
    // anchoring there must grow it into the empty space to its right and below rather than
    // pushing it off the top and left edges.
    const anchored = zoomAbout(IDENTITY, SCALE_STEP, 0, 0);
    expect(anchored).toEqual({k: SCALE_STEP, x: 0, y: 0});

    const twice = zoomAbout(anchored, SCALE_STEP, 0, 0);
    expect(twice.x).toBe(0);
    expect(twice.y).toBe(0);
  });

  it('pushes a left-aligned diagram off-screen when anchored at the centre', () => {
    // The behaviour this replaced, pinned so the regression is recognisable.
    const centred = zoomAbout(IDENTITY, SCALE_STEP, 400, 300);
    expect(centred.x).toBeLessThan(0);
    expect(centred.y).toBeLessThan(0);
  });

  it('keeps the top-left of the visible area fixed when already panned', () => {
    const panned: Transform = {k: 2, x: -300, y: -150};
    const zoomed = zoomAbout(panned, 1.25, 0, 0);
    // The content under viewport (0,0) is unchanged.
    expect(unproject(zoomed, 0, 0).x).toBeCloseTo(unproject(panned, 0, 0).x, 9);
    expect(unproject(zoomed, 0, 0).y).toBeCloseTo(unproject(panned, 0, 0).y, 9);
  });

  it('returns to exactly 1 after equal zoom in and out', () => {
    const zoomedIn = zoomAbout(IDENTITY, SCALE_STEP, 100, 100);
    const back = zoomAbout(zoomedIn, 1 / SCALE_STEP, 100, 100);

    expect(back.k).toBeCloseTo(1, 9);
    expect(isIdentity(back)).toBe(true);
  });
});

describe('panBy', () => {
  it('translates without touching the scale', () => {
    expect(panBy({k: 2, x: 10, y: -5}, 15, 25)).toEqual({k: 2, x: 25, y: 20});
  });

  it('is reversible', () => {
    expect(panBy(panBy(IDENTITY, 40, -20), -40, 20)).toEqual(IDENTITY);
  });
});

describe('clampTransform', () => {
  const bounds: Bounds = {
    viewportWidth: 400,
    viewportHeight: 300,
    contentWidth: 400,
    contentHeight: 300,
  };

  it('left-aligns content that fits, whatever pan was requested', () => {
    const clamped = clampTransform({k: 1, x: 120, y: 80}, bounds);
    expect(clamped).toEqual({k: 1, x: 0, y: 0});
  });

  it('left-aligns content smaller than the viewport', () => {
    expect(clampTransform({k: 0.5, x: -50, y: -50}, bounds)).toEqual({k: 0.5, x: 0, y: 0});
  });

  it('never lets an edge come inside the viewport', () => {
    // At 2x the content is 800x600 inside a 400x300 viewport, so translation must stay
    // within [-400, 0] horizontally and [-300, 0] vertically.
    expect(clampTransform({k: 2, x: 100, y: 100}, bounds)).toEqual({k: 2, x: 0, y: 0});
    expect(clampTransform({k: 2, x: -9999, y: -9999}, bounds)).toEqual({k: 2, x: -400, y: -300});
  });

  it('leaves a translation that is already within bounds alone', () => {
    expect(clampTransform({k: 2, x: -200, y: -150}, bounds)).toEqual({k: 2, x: -200, y: -150});
  });

  it('clamps the axes independently for wide, short content', () => {
    const wide: Bounds = {
      viewportWidth: 400,
      viewportHeight: 300,
      contentWidth: 1600,
      contentHeight: 100,
    };
    // Horizontally pannable, vertically pinned, in the same call.
    expect(clampTransform({k: 1, x: -500, y: -40}, wide)).toEqual({k: 1, x: -500, y: 0});
    expect(clampTransform({k: 1, x: -5000, y: 40}, wide)).toEqual({k: 1, x: -1200, y: 0});
  });

  it('pins everything when the content has not been measured yet', () => {
    const unmeasured: Bounds = {
      viewportWidth: 0,
      viewportHeight: 0,
      contentWidth: 0,
      contentHeight: 0,
    };
    expect(clampTransform({k: 3, x: 40, y: 40}, unmeasured)).toEqual({k: 3, x: 0, y: 0});
  });
});

describe('normalizeWheelDelta', () => {
  it('passes pixel deltas through unchanged', () => {
    expect(normalizeWheelDelta(120, 0)).toBe(120);
    expect(normalizeWheelDelta(-53, 0)).toBe(-53);
  });

  it('scales line deltas, which is what Firefox reports for a mouse wheel', () => {
    expect(normalizeWheelDelta(3, 1)).toBe(48);
    expect(normalizeWheelDelta(-3, 1)).toBe(-48);
  });

  it('scales page deltas', () => {
    expect(normalizeWheelDelta(1, 2)).toBe(400);
  });
});

describe('wheelZoomFactor', () => {
  it('zooms in when scrolling up and out when scrolling down', () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
  });

  it('is neutral for a zero delta', () => {
    expect(wheelZoomFactor(0)).toBe(1);
  });

  it('is symmetric, so a scroll up then down returns to the original scale', () => {
    expect(wheelZoomFactor(-100) * wheelZoomFactor(100)).toBeCloseTo(1, 9);
  });
});

describe('fitScale', () => {
  const viewport = {viewportWidth: 400, viewportHeight: 300};

  it('shrinks content that is too wide', () => {
    expect(fitScale({...viewport, contentWidth: 800, contentHeight: 300})).toBeCloseTo(0.5, 9);
  });

  it('shrinks content that is too tall', () => {
    expect(fitScale({...viewport, contentWidth: 400, contentHeight: 900})).toBeCloseTo(1 / 3, 9);
  });

  it('uses the more constraining axis', () => {
    expect(fitScale({...viewport, contentWidth: 800, contentHeight: 1200})).toBeCloseTo(0.25, 9);
  });

  it('magnifies small content to fill the viewport, since the output is vector', () => {
    expect(fitScale({...viewport, contentWidth: 100, contentHeight: 50})).toBeCloseTo(4, 9);
  });

  it('never magnifies beyond the maximum scale', () => {
    expect(fitScale({...viewport, contentWidth: 1, contentHeight: 1})).toBe(MAX_SCALE);
    expect(fitScale({...viewport, contentWidth: 10, contentHeight: 10}, 2)).toBe(2);
  });

  it('falls back to 1 when nothing has been measured', () => {
    expect(fitScale({...viewport, contentWidth: 0, contentHeight: 0})).toBe(1);
  });
});

describe('formatting', () => {
  it('renders a CSS transform', () => {
    expect(toCssTransform({k: 1.25, x: -40, y: 12})).toBe('translate(-40px, 12px) scale(1.25)');
  });

  it('drops floating-point noise from the CSS transform', () => {
    expect(toCssTransform({k: 1.0000000001, x: 1e-9, y: -1e-9})).toBe(
      'translate(0px, 0px) scale(1)',
    );
  });

  it('formats the machine-readable zoom level', () => {
    expect(formatZoom(1)).toBe('1');
    expect(formatZoom(2.5)).toBe('2.5');
    expect(formatZoom(1.2500001)).toBe('1.25');
    expect(formatZoom(0.9999999)).toBe('1');
  });

  it('formats the human-readable readout', () => {
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(0.25)).toBe('25%');
    expect(formatPercent(2.504)).toBe('250%');
  });

  it('recognizes the identity transform', () => {
    expect(isIdentity(IDENTITY)).toBe(true);
    expect(isIdentity({k: 1, x: 0.0000001, y: 0})).toBe(true);
    expect(isIdentity({k: 1.25, x: 0, y: 0})).toBe(false);
    expect(isIdentity({k: 1, x: 5, y: 0})).toBe(false);
  });
});

describe('clamp', () => {
  it('bounds a value on both sides', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });
});
