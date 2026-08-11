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

/**
 * Measures in the page rather than with `locator.boundingBox()`, which clips the result to the
 * visible area — a zoomed layer inside an `overflow: clip` viewport would be reported at
 * viewport size instead of its true transformed size.
 */
async function rectOf(locator: Locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
  });
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
    // Zoom out, zoom in, reset, maximize, and the source toggle.
    await expect(group.getByRole('button')).toHaveCount(5);
    await expect(group.getByRole('button', {name: 'Maximize diagram'})).toBeVisible();
    await expect(group.getByRole('button', {name: 'Show diagram source'})).toBeVisible();

    // Every control is drawn, not typed. `⛶` U+26F6 had no glyph on a stock Linux desktop,
    // so the maximize button used to render as a tofu box for a whole platform's readers.
    // See issue #21. Asserted against the real build because this is a rendering bug.
    await expect(group.locator('button > svg')).toHaveCount(5);
    for (const name of ['Zoom out', 'Zoom in', 'Reset zoom', 'Maximize diagram']) {
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

    const zoomIn = figure.getByRole('button', {name: 'Zoom in'});
    await zoomIn.click();
    await zoomIn.click();
    await zoomIn.click();
    await expect.poll(() => zoomLevel(page)).toBeGreaterThan(1.9);
    await expect.poll(async () => (await rectOf(layer)).width).toBeGreaterThan(before.width * 1.5);

    const after = await rectOf(layer);
    // The whole point: the diagram grows down and right into the empty space rather than
    // being pushed off the top and left edges, which is what centre-anchored zoom did.
    expect(Math.abs(after.x - before.x), 'left edge must not move').toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y), 'top edge must not move').toBeLessThanOrEqual(1);

    await page.keyboard.press('Escape');
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
