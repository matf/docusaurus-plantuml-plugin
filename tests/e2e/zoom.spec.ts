import {expect, test, type Locator, type Page} from '@playwright/test';

import {monitor, waitForDiagrams} from './helpers.js';

const ORIGIN = new URL(process.env['PLANTUML_E2E_BASE_URL'] as string).origin;

const zoomable = '[data-plantuml-interactive="true"]';
const viewportSelector = '[data-plantuml-zoom]';

/** The zoom level currently written to the viewport. */
async function zoomLevel(page: Page): Promise<number> {
  return Number(await page.locator(viewportSelector).first().getAttribute('data-plantuml-zoom'));
}

function layerOf(figure: Locator): Locator {
  return figure.locator('[data-plantuml-zoom] > div').first();
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Measures in the page rather than with `locator.boundingBox()`, which clips the result to the
 * visible area — a zoomed layer inside an `overflow: clip` viewport would be reported at
 * viewport size instead of its true transformed size.
 */
async function rectOf(locator: Locator): Promise<Rect> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
  });
}

/** Whether two boxes share any area at all — the whole question this fixed. */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * The rendered diagram, as the README documents it. Scoped rather than a bare `svg` because
 * the toolbar's control icons are SVG too — a loose selector would match those as well.
 */
const DIAGRAM_SVG = 'div[role="img"] > svg';

test.describe('zoom and pan', () => {
  test('gives zoomable diagrams a labelled control group and leaves opted-out ones alone', async ({
    page,
  }) => {
    const seen = monitor(page, ORIGIN);
    await page.goto('docs/zoom');
    await waitForDiagrams(page, 2);

    const figures = page.locator('[data-plantuml-diagram]');
    await expect(figures).toHaveCount(2);

    const wide = figures.nth(0);
    await expect(wide).toHaveAttribute('data-plantuml-interactive', 'true');
    await expect(wide.locator('div[role="img"] > svg')).toHaveCount(1);
    const group = wide.getByRole('group', {name: /zoom controls/});
    await expect(group).toBeVisible();
    // Search, zoom out, zoom in, reset, maximize, the minimap toggle and the source toggle.
    // Fit is absent here on purpose — it exists only in the maximized view, where it can
    // fill a screen.
    await expect(group.getByRole('button')).toHaveCount(7);
    await expect(group.getByRole('button', {name: 'Fit diagram to screen'})).toHaveCount(0);
    await expect(group.getByRole('button', {name: 'Maximize diagram'})).toBeVisible();
    // In the toolbar, not in a row of its own beneath the picture.
    await expect(group.getByRole('button', {name: 'Show minimap'})).toBeVisible();
    await expect(group.getByRole('button', {name: 'Show diagram source'})).toBeVisible();

    // Every control is drawn, not typed. `⛶` U+26F6 had no glyph on a stock Linux desktop,
    // so the maximize button used to render as a tofu box for a whole platform's readers.
    // See issue #21. Asserted against the real build because this is a rendering bug.
    await expect(group.locator('button > svg')).toHaveCount(7);
    for (const name of [
      'Search diagram',
      'Zoom out',
      'Zoom in',
      'Reset zoom',
      'Maximize diagram',
      'Show minimap',
    ]) {
      const button = group.getByRole('button', {name});
      await expect(button.locator('svg')).toHaveCount(1);
      // Nothing left that a missing font could fail to draw.
      expect(((await button.textContent()) ?? '').trim()).toBe('');
    }

    // `zoom=false` on the fence removes all of it.
    const optedOut = figures.nth(1);
    await expect(optedOut).not.toHaveAttribute('data-plantuml-interactive', 'true');
    await expect(optedOut.locator(viewportSelector)).toHaveCount(0);
    await expect(optedOut.getByRole('group', {name: /zoom controls/})).toHaveCount(0);
    await expect(optedOut.locator('div[role="img"] > svg')).toHaveCount(1);

    expect(seen.pageErrors).toEqual([]);
    expect(seen.hydrationWarnings).toEqual([]);
  });

  test('keeps every control out of the role="img" subtree', async ({page}) => {
    await page.goto('docs/zoom');
    await waitForDiagrams(page, 2);

    // Anything inside role="img" is invisible to assistive technology.
    await expect(page.locator('[role="img"] button')).toHaveCount(0);
  });

  test('puts every control in a row above the diagram, covering nothing at 100%', async ({
    page,
  }) => {
    await page.goto('docs/zoom');
    await waitForDiagrams(page, 2);

    const figure = page.locator(zoomable).first();
    // 100% is the view a reader arrives at, and the only one this promises anything about.
    expect(await zoomLevel(page)).toBe(1);

    const picture = await rectOf(figure.locator(DIAGRAM_SVG));
    const toolbar = await rectOf(figure.getByRole('group', {name: /zoom controls/}));

    // The defect: the controls used to be painted over the picture's corners, which on a
    // sequence diagram is its first participant and on a graph its leftmost node.
    expect(overlaps(toolbar, picture), 'the toolbar covers the diagram').toBe(false);
    // A row specifically: wholly above the picture, not merely beside it.
    expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(picture.y + 1);

    // Nothing else is left down there to cover the diagram — the minimap toggle rides in the
    // toolbar, so there is no second bar under the picture.
    const toggle = await rectOf(figure.getByRole('button', {name: 'Show minimap'}));
    expect(overlaps(toggle, picture), 'the minimap toggle covers the diagram').toBe(false);
    expect(toggle.y + toggle.height).toBeLessThanOrEqual(picture.y + 1);

    // The search bar opens beside the toolbar, inside the same row.
    await figure.getByRole('button', {name: 'Search diagram'}).click();
    const searchBar = await rectOf(figure.getByRole('search'));
    expect(overlaps(searchBar, picture), 'the search bar covers the diagram').toBe(false);
    await page.keyboard.press('Escape');
  });

  test('keeps the control row on screen and clear of the diagram while maximized', async ({
    page,
  }) => {
    await page.goto('docs/zoom');
    await waitForDiagrams(page, 2);

    const figure = page.locator(zoomable).first();
    await figure.getByRole('button', {name: 'Maximize diagram'}).click();
    await expect(figure).toHaveAttribute('data-plantuml-maximized', 'true');

    const screenSize = page.viewportSize();
    const toolbar = await rectOf(figure.getByRole('group', {name: /zoom controls/}));

    // The overlay is `inset: 0`, so the diagram row has to *give up* the control row's height
    // rather than take the whole screen.
    expect(toolbar.y).toBeGreaterThanOrEqual(-1);
    expect(toolbar.y + toolbar.height).toBeLessThanOrEqual((screenSize?.height ?? 0) + 1);

    // And the fitted picture sits below it, not under it. Polled, not read once: maximizing
    // eases the fit transform over 150ms, so the geometry settles after the attribute does.
    await expect.poll(async () => overlaps(toolbar, await rectOf(layerOf(figure)))).toBe(false);

    await page.keyboard.press('Escape');
  });

  test('zooming magnifies the diagram without changing the page layout', async ({page}) => {
    await page.goto('docs/zoom');
    await waitForDiagrams(page, 2);

    const figure = page.locator(zoomable).first();
    const layer = layerOf(figure);
    const figureBefore = await rectOf(figure);
    const layerBefore = await rectOf(layer);

    const zoomIn = figure.getByRole('button', {name: 'Zoom in'});
    await zoomIn.click();
    await zoomIn.click();
    await zoomIn.click();

    await expect.poll(() => zoomLevel(page)).toBeGreaterThan(1.9);

    // Polled, not read once: discrete zoom steps ease over 150ms, so the geometry settles
    // after the attribute does.
    await expect
      .poll(async () => (await rectOf(layer)).width)
      .toBeGreaterThan(layerBefore.width * 1.5);

    // A CSS transform must not reflow the document: the figure keeps its height.
    const figureAfter = await rectOf(figure);
    expect(Math.abs(figureAfter.height - figureBefore.height)).toBeLessThanOrEqual(1);
  });

  test('reset restores the original view', async ({page}) => {
    await page.goto('docs/zoom');
    await waitForDiagrams(page, 2);

    const figure = page.locator(zoomable).first();
    const before = await rectOf(layerOf(figure));

    await figure.getByRole('button', {name: 'Zoom in'}).click();
    await expect.poll(() => zoomLevel(page)).toBeGreaterThan(1);

    await figure.getByRole('button', {name: 'Reset zoom'}).click();
    await expect.poll(() => zoomLevel(page)).toBe(1);

    await expect
      .poll(async () => Math.abs((await rectOf(layerOf(figure))).width - before.width))
      .toBeLessThanOrEqual(1);
  });

  test('fit fills the maximized screen with the whole diagram', async ({page}) => {
    await page.goto('docs/zoom');
    await waitForDiagrams(page, 2);

    const figure = page.locator(zoomable).first();
    await figure.getByRole('button', {name: 'Maximize diagram'}).click();
    await expect(figure).toHaveAttribute('data-plantuml-maximized', 'true');

    // Wander off the fitted opening view, then Fit must find the way back.
    const zoomIn = figure.getByRole('button', {name: 'Zoom in'});
    for (let i = 0; i < 5; i += 1) await zoomIn.click();

    await figure.getByRole('button', {name: 'Fit diagram to screen'}).click();

    // Polled: discrete zoom steps ease over 150ms, so the geometry settles after the click.
    // Fitted means contained — and *filling* the screen: at the fit scale one axis runs
    // edge to edge, which is what separates this from a mere reset.
    const viewport = page.locator(viewportSelector).first();
    await expect
      .poll(async () => {
        const layer = await rectOf(layerOf(figure));
        const box = await rectOf(viewport);
        const contained = layer.width <= box.width + 1 && layer.height <= box.height + 1;
        const fills = layer.width >= box.width - 2 || layer.height >= box.height - 2;
        return contained && fills;
      })
      .toBe(true);

    await page.keyboard.press('Escape');
  });

  test('a plain wheel scrolls the page instead of zooming', async ({page}) => {
    await page.goto('docs/zoom');
    await waitForDiagrams(page, 2);

    const viewport = page.locator(viewportSelector).first();
    await viewport.hover();
    await page.mouse.wheel(0, 400);

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect(await zoomLevel(page)).toBe(1);
  });

  test('ctrl + wheel zooms without scrolling the page', async ({page}) => {
    await page.goto('docs/zoom');
    await waitForDiagrams(page, 2);
    await page.evaluate(() => window.scrollTo(0, 0));

    const viewport = page.locator(viewportSelector).first();
    await viewport.hover();
    // `hover()` scrolls the element into view, so the baseline is taken after it.
    const scrollBefore = await page.evaluate(() => window.scrollY);

    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -400);
    await page.keyboard.up('Control');

    await expect.poll(() => zoomLevel(page)).toBeGreaterThan(1);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  });

  test('zooming keeps the content under the cursor in place', async ({page}) => {
    await page.goto('docs/zoom');
    await waitForDiagrams(page, 2);
    await page.evaluate(() => window.scrollTo(0, 0));

    // Track a real node in the diagram and zoom about its own centre: that point is exactly
    // what focal-point zooming promises to hold still.
    const target = page.locator(`${zoomable} svg text`).first();
    await target.scrollIntoViewIfNeeded();
    const before = await rectOf(target);
    const focal = {x: before.x + before.width / 2, y: before.y + before.height / 2};

    await page.mouse.move(focal.x, focal.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    await expect.poll(() => zoomLevel(page)).toBeGreaterThan(1);

    const after = await rectOf(target);
    // The focal point is preserved, so a node near it barely moves.
    const drift = Math.hypot(
      after.x + after.width / 2 - focal.x,
      after.y + after.height / 2 - focal.y,
    );
    expect(drift).toBeLessThan(24);
  });

  test('dragging pans, and the diagram can never be lost off-screen', async ({page}) => {
    await page.goto('docs/zoom');
    await waitForDiagrams(page, 2);

    const figure = page.locator(zoomable).first();
    const zoomIn = figure.getByRole('button', {name: 'Zoom in'});
    for (let i = 0; i < 5; i += 1) await zoomIn.click();
    await expect.poll(() => zoomLevel(page)).toBeGreaterThan(2);

    const viewport = page.locator(viewportSelector).first();
    const box = await rectOf(viewport);
    const layer = layerOf(figure);
    const before = await rectOf(layer);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2, {steps: 10});
    await page.mouse.up();

    const after = await rectOf(layer);
    expect(after.x).toBeLessThan(before.x);

    // Drag far past the edge; the clamp must keep the left edge at or left of the viewport.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 3000, box.y + box.height / 2, {steps: 15});
    await page.mouse.up();

    const clamped = await rectOf(layer);
    expect(clamped.x).toBeLessThanOrEqual(box.x + 1);
  });

  test('is operable from the keyboard', async ({page}) => {
    await page.goto('docs/zoom');
    await waitForDiagrams(page, 2);

    const viewport = page.locator(viewportSelector).first();
    await viewport.focus();
    await expect(viewport).toBeFocused();

    await page.keyboard.press('+');
    await page.keyboard.press('+');
    await expect.poll(() => zoomLevel(page)).toBeGreaterThan(1);

    const layer = layerOf(page.locator(zoomable).first());
    const beforePan = await rectOf(layer);
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await rectOf(layer)).x).toBeLessThan(beforePan.x);

    await page.keyboard.press('0');
    await expect.poll(() => zoomLevel(page)).toBe(1);
  });

  test('resets when the colour mode changes', async ({page}) => {
    await page.goto('docs/zoom');
    await waitForDiagrams(page, 2);

    const figure = page.locator(zoomable).first();
    await figure.getByRole('button', {name: 'Zoom in'}).click();
    await figure.getByRole('button', {name: 'Zoom in'}).click();
    await expect.poll(() => zoomLevel(page)).toBeGreaterThan(1);

    await page.getByRole('button', {name: /switch between dark and light mode/i}).click();
    await expect(figure).toHaveAttribute('data-plantuml-theme', 'dark');
    await expect(figure).toHaveAttribute('data-plantuml-status', 'ready');

    await expect.poll(() => zoomLevel(page)).toBe(1);
  });

  test('leaves one-finger scrolling and browser pinch to the page on touch devices', async ({
    page,
  }) => {
    await page.goto('docs/zoom');
    await waitForDiagrams(page, 2);

    const touchAction = await page
      .locator(viewportSelector)
      .first()
      .evaluate((element) => getComputedStyle(element).touchAction);

    // Anything narrower here would make a full-width diagram a mobile scroll trap.
    expect(touchAction).toBe('pan-y pinch-zoom');
  });

  test('maximizing covers the page opaquely and does not use the Fullscreen API', async ({
    page,
  }) => {
    await page.goto('docs/zoom');
    await waitForDiagrams(page, 2);

    const figure = page.locator(zoomable).first();
    await figure.getByRole('button', {name: 'Maximize diagram'}).click();

    await expect(figure).toHaveAttribute('data-plantuml-maximized', 'true');

    // The Fullscreen API is deliberately unused: Firefox takes the whole browser window
    // fullscreen with it, and its backdrop lets the page show through.
    expect(await page.evaluate(() => document.fullscreenElement !== null)).toBe(false);

    // The overlay covers the viewport and is fully opaque.
    const stage = page.locator(`${zoomable} [class*="maximized"]`).first();
    const box = await rectOf(stage);
    const viewportSize = page.viewportSize();
    expect(box.width).toBeGreaterThanOrEqual((viewportSize?.width ?? 0) - 1);
    expect(box.height).toBeGreaterThanOrEqual((viewportSize?.height ?? 0) - 1);

    // Opaque in *both* colour modes. Infima's `--ifm-background-color` is `#0000` in light
    // mode, so a transparent overlay passes a dark-mode-only check and still lets the page
    // show through for most readers.
    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      const background = await stage.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(background, `${theme} mode overlay background`).not.toBe('transparent');
      // `rgb(...)` is opaque by definition; only `rgba(...)` carries an alpha channel.
      const parts = /^rgba?\(([^)]+)\)$/.exec(background)?.[1]?.split(',') ?? [];
      const alpha = parts.length === 4 ? Number(parts[3]) : 1;
      expect(alpha, `${theme} mode overlay opacity (${background})`).toBe(1);
    }

    // Page scrolling is locked while the overlay is up.
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');

    // Escape closes it and restores scrolling.
    await page.keyboard.press('Escape');
    await expect(figure).not.toHaveAttribute('data-plantuml-maximized', 'true');
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).overflow))
      .not.toBe('hidden');
  });

  test('button zoom keeps the diagram anchored at the top-left, including maximized', async ({
    page,
  }) => {
    await page.goto('docs/zoom');
    await waitForDiagrams(page, 2);

    const figure = page.locator(zoomable).first();
    await figure.getByRole('button', {name: 'Maximize diagram'}).click();
    await expect(figure).toHaveAttribute('data-plantuml-maximized', 'true');

    const layer = layerOf(figure);
    const before = await rectOf(layer);
    // Relative to whatever the opening fit landed on, not an absolute level: the maximized
    // viewport is the screen *minus the two control rows*, so a diagram taller than that
    // opens below 100% and three steps from there need not clear any particular number.
    const opening = await zoomLevel(page);

    const zoomIn = figure.getByRole('button', {name: 'Zoom in'});
    await zoomIn.click();
    await zoomIn.click();
    await zoomIn.click();
    await expect.poll(() => zoomLevel(page)).toBeGreaterThan(opening * 1.9);
    await expect.poll(async () => (await rectOf(layer)).width).toBeGreaterThan(before.width * 1.5);

    const after = await rectOf(layer);
    // The whole point: the diagram grows down and right into the empty space rather than
    // being pushed off the top and left edges, which is what centre-anchored zoom did.
    expect(Math.abs(after.x - before.x), 'left edge must not move').toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y), 'top edge must not move').toBeLessThanOrEqual(1);

    await page.keyboard.press('Escape');
  });

  test('search highlights matches and steps through them', async ({page}) => {
    await page.goto('docs/zoom');
    await waitForDiagrams(page, 2);

    const figure = page.locator(zoomable).first();

    // Search whatever the first label actually says, so the test needs no fixture change.
    const needle = (await figure.locator('svg text').first().textContent()) ?? '';
    expect(needle.trim()).not.toBe('');

    await figure.getByRole('button', {name: 'Search diagram'}).click();
    await expect(figure).toHaveAttribute('data-plantuml-search-open', 'true');

    const input = figure.getByRole('textbox', {name: 'Search diagram text'});
    await expect(input).toBeFocused();
    await input.fill(needle.trim());

    const matches = figure.locator('[data-plantuml-search-match]');
    await expect(matches.first()).toBeVisible();
    const total = await matches.count();
    await expect(figure.locator('[data-plantuml-search-current]')).toHaveCount(1);
    await expect(figure.getByRole('status')).toHaveText(`1/${total}`);

    // Enter steps; the current marker stays unique.
    await input.press('Enter');
    await expect(figure.locator('[data-plantuml-search-current]')).toHaveCount(1);
    await expect(figure.getByRole('status')).toHaveText(`${total > 1 ? 2 : 1}/${total}`);

    // Escape closes the bar and sweeps every highlight out of the SVG.
    await input.press('Escape');
    await expect(figure).not.toHaveAttribute('data-plantuml-search-open', 'true');
    await expect(figure.locator('[data-plantuml-search-match]')).toHaveCount(0);
    await expect(figure.locator('[data-plantuml-search-current]')).toHaveCount(0);
  });

  test('the minimap pans the diagram and closes from its own button', async ({page}) => {
    await page.goto('docs/zoom');
    await waitForDiagrams(page, 2);

    const figure = page.locator(zoomable).first();
    await figure.getByRole('button', {name: 'Show minimap'}).click();
    await expect(figure).toHaveAttribute('data-plantuml-minimap-open', 'true');

    const map = figure.locator('[data-plantuml-minimap]');
    await expect(map).toBeVisible();
    // The map carries a scaled copy of the diagram, hidden from assistive technology.
    await expect(map.locator('div[aria-hidden="true"] svg').first()).toBeVisible();

    // Zoom in so only part of the diagram is visible; the map is what brings the rest back.
    const zoomIn = figure.getByRole('button', {name: 'Zoom in'});
    for (let i = 0; i < 4; i += 1) await zoomIn.click();
    await expect.poll(() => zoomLevel(page)).toBeGreaterThan(2);

    // Button zoom anchors top-left, so the view sits at the top-left; pressing near the
    // bottom-right of the map must pan the layer up and left. `click` with a position
    // rather than raw mouse coordinates: the map lives at the bottom of the stage, which
    // can be below the fold, and a raw mouse press outside the window lands on nothing.
    const canvas = map.locator('div[aria-hidden="true"]').first();
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('minimap canvas has no box');
    const layer = layerOf(figure);
    const before = await rectOf(layer);

    await canvas.click({position: {x: box.width - 6, y: box.height - 6}});

    await expect.poll(async () => (await rectOf(layer)).x).toBeLessThan(before.x);

    await figure.getByRole('button', {name: 'Close minimap'}).click();
    await expect(map).toHaveCount(0);
    await expect(figure).not.toHaveAttribute('data-plantuml-minimap-open', 'true');
  });

  test('does not interfere with ordinary diagram pages', async ({page}) => {
    const seen = monitor(page, ORIGIN);
    await page.goto('docs/multiple-diagrams');
    await waitForDiagrams(page, 3);

    const figures = page.locator('[data-plantuml-diagram]');
    await expect(figures).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await expect(figures.nth(index)).toHaveAttribute('data-plantuml-status', 'ready');
      // Still exactly one svg per figure: the toolbar uses text glyphs, not icons.
      await expect(figures.nth(index).locator(DIAGRAM_SVG)).toHaveCount(1);
    }

    expect(seen.pageErrors).toEqual([]);
    expect(seen.externalRequests).toEqual([]);
  });
});
