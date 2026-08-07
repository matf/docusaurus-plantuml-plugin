import {expect, test} from '@playwright/test';

import {monitor, revealLazyDiagrams, waitForDiagrams} from './helpers.js';

const BASE_URL = process.env['PLANTUML_E2E_BASE_URL'] as string;
const ORIGIN = new URL(BASE_URL).origin;

const diagram = '[data-plantuml-diagram]';

/**
 * Clipboard reads need an explicit grant in Chromium. Writes do not, but granting both keeps
 * the assertion honest: the test checks what actually landed on the clipboard rather than
 * trusting the button's own feedback.
 */
test.use({permissions: ['clipboard-read', 'clipboard-write']});

test.describe('diagram source view', () => {
  test('reveals the PlantUML source from the toolbar', async ({page}) => {
    const seen = monitor(page, ORIGIN);
    await page.goto('docs/plantuml');
    await waitForDiagrams(page, 1);

    const figure = page.locator(diagram).first();
    const toggle = figure.getByRole('button', {name: 'Show diagram source'});
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(figure.locator('pre')).toHaveCount(0);

    await toggle.click();

    await expect(figure).toHaveAttribute('data-plantuml-source-open', 'true');
    await expect(figure.locator('pre')).toContainText('@startuml');
    await expect(figure.locator('pre')).toContainText('POST /sessions');
    // The control describes what it will do next, not what it just did.
    await expect(figure.getByRole('button', {name: 'Hide diagram source'})).toBeVisible();

    expect(seen.pageErrors).toEqual([]);
  });

  test('closes again, leaving no trace on the figure', async ({page}) => {
    await page.goto('docs/plantuml');
    await waitForDiagrams(page, 1);

    const figure = page.locator(diagram).first();
    await figure.getByRole('button', {name: 'Show diagram source'}).click();
    await expect(figure).toHaveAttribute('data-plantuml-source-open', 'true');

    await figure.getByRole('button', {name: 'Hide diagram source'}).click();

    await expect(figure).not.toHaveAttribute('data-plantuml-source-open', 'true');
    await expect(figure.locator('pre')).toHaveCount(0);
  });

  test('copies the source to the clipboard', async ({page}) => {
    await page.goto('docs/plantuml');
    await waitForDiagrams(page, 1);

    const figure = page.locator(diagram).first();
    await figure.getByRole('button', {name: 'Show diagram source'}).click();
    await figure.getByRole('button', {name: /Copy .* source to clipboard/}).click();

    await expect(figure.getByRole('status')).toHaveText('Copied to clipboard');

    // What matters is the clipboard's contents, not the message claiming success.
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('@startuml');
    expect(clipboard).toContain('POST /sessions');
    expect(clipboard).toContain('@enduml');
  });

  test('copies DOT source for a Graphviz diagram', async ({page}) => {
    await page.goto('docs/graphviz-only');
    await waitForDiagrams(page, 1);

    const figure = page.locator(diagram).first();
    await figure.getByRole('button', {name: 'Show diagram source'}).click();
    await expect(figure.locator('pre')).toContainText('digraph');

    await figure.getByRole('button', {name: /Copy Graphviz source to clipboard/}).click();
    await expect(figure.getByRole('status')).toHaveText('Copied to clipboard');

    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('request -> handler -> response');
    // The authored source, never the rendered SVG.
    expect(clipboard).not.toContain('<svg');
  });

  test('honours showSource=false on a fence', async ({page}) => {
    await page.goto('docs/graphviz');
    await revealLazyDiagrams(page);
    await waitForDiagrams(page, 11);

    const optedOut = page.locator(diagram, {
      has: page.locator('figcaption', {hasText: 'No source control'}),
    });
    await expect(optedOut.getByRole('button', {name: /diagram source/})).toHaveCount(0);
    // …while its neighbour still has one, so this is the fence flag and not a broken page.
    const optedIn = page.locator(diagram, {
      has: page.locator('figcaption', {hasText: 'Open the source of this one'}),
    });
    await expect(optedIn.getByRole('button', {name: 'Show diagram source'})).toBeVisible();
  });

  test('survives zooming, and is not clipped by the viewport', async ({page}) => {
    await page.goto('docs/zoom');
    await waitForDiagrams(page, 1);

    const figure = page.locator(diagram).first();
    await figure.getByRole('button', {name: 'Show diagram source'}).click();
    const pre = figure.locator('pre');
    await expect(pre).toBeVisible();

    await figure.getByRole('button', {name: 'Zoom in'}).click();
    await expect(figure.locator('[data-plantuml-zoom]')).toHaveAttribute(
      'data-plantuml-zoom',
      '1.25',
    );

    // The panel is a sibling of the zoom stage, so scaling the diagram must not touch it.
    await expect(pre).toBeVisible();
    await expect(pre).toContainText('@startuml');
  });

  test('keeps the source panel out of the role="img" subtree', async ({page}) => {
    // `role="img"` makes its whole subtree opaque to assistive technology, so a panel in
    // there would be unreachable for screen-reader users.
    await page.goto('docs/plantuml');
    await waitForDiagrams(page, 1);

    const figure = page.locator(diagram).first();
    await figure.getByRole('button', {name: 'Show diagram source'}).click();

    await expect(figure.locator('div[role="img"] pre')).toHaveCount(0);
    await expect(figure.locator('div[role="img"] button')).toHaveCount(0);
  });
});
