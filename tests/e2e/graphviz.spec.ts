import {expect, test} from '@playwright/test';

import {countRequests, monitor, revealLazyDiagrams, waitForDiagrams} from './helpers.js';

const BASE_URL = process.env['PLANTUML_E2E_BASE_URL'] as string;
const ORIGIN = new URL(BASE_URL).origin;

const diagram = '[data-plantuml-diagram]';
const graphviz = '[data-diagram-engine="graphviz"]';

/** `docs/graphviz` carries eight DOT fences and one PlantUML fence. */
const DOT_DIAGRAMS = 8;
const TOTAL_DIAGRAMS = DOT_DIAGRAMS + 1;

test.describe('client-side Graphviz rendering', () => {
  test('renders DOT fences as real SVG, entirely from the site origin', async ({page}) => {
    const seen = monitor(page, ORIGIN);
    await page.goto('docs/graphviz');
    await revealLazyDiagrams(page);
    await waitForDiagrams(page, TOTAL_DIAGRAMS);

    const figure = page.locator(`${graphviz}`).first();
    await expect(figure).toHaveAttribute('data-plantuml-status', 'ready');
    await expect(figure).toHaveAttribute('data-diagram-layout', 'dot');

    const svg = figure.locator('div[role="img"] > svg');
    await expect(svg).toHaveCount(1);

    const text = await svg.textContent();
    for (const label of ['src', 'build', 'test', 'deploy', 'fix']) {
      expect(text).toContain(label);
    }

    // The whole promise of the plugin: no CDN, no rendering service, nothing off-origin.
    expect(seen.forbiddenRequests, 'no external Graphviz/CDN requests').toEqual([]);
    expect(seen.externalRequests, 'every request stays on the site origin').toEqual([]);
    expect(seen.pageErrors).toEqual([]);
    expect(seen.hydrationWarnings, 'production build hydrates cleanly').toEqual([]);
  });

  test('never downloads the PlantUML engine for a page with only DOT diagrams', async ({page}) => {
    // The loader split is what makes Graphviz cheap: `viz-global.js` is ~1.4 MB, while
    // `plantuml.js` is ~6.8 MB and has no business being fetched for a DOT-only page.
    const seen = monitor(page, ORIGIN);
    await page.goto('docs/graphviz-only');
    await waitForDiagrams(page, 1);

    await expect(page.locator(graphviz).first()).toHaveAttribute('data-plantuml-status', 'ready');
    expect(countRequests(seen.runtimeRequests, 'viz-global.js')).toBe(1);
    expect(
      countRequests(seen.runtimeRequests, 'plantuml.js'),
      'a DOT-only page must not pay for the PlantUML engine',
    ).toBe(0);
  });

  test('downloads each engine once when a page mixes both', async ({page}) => {
    const seen = monitor(page, ORIGIN);
    await page.goto('docs/graphviz');
    await revealLazyDiagrams(page);
    await waitForDiagrams(page, TOTAL_DIAGRAMS);

    expect(countRequests(seen.runtimeRequests, 'viz-global.js')).toBe(1);
    expect(countRequests(seen.runtimeRequests, 'plantuml.js')).toBe(1);
  });

  test('honours a layout engine chosen on the fence', async ({page}) => {
    await page.goto('docs/graphviz');
    await revealLazyDiagrams(page);
    await waitForDiagrams(page, TOTAL_DIAGRAMS);

    await expect(page.locator('[data-diagram-layout="neato"]')).toHaveCount(1);
    await expect(page.locator('[data-diagram-layout="circo"]')).toHaveCount(1);

    // Different engines really do lay the graph out differently, not merely label it so.
    const neato = page.locator('[data-diagram-layout="neato"] div[role="img"] > svg');
    await expect(neato).toHaveCount(1);
    await expect(neato).toHaveAttribute('viewBox', /.+/);
  });

  test('leaves ordinary code blocks alone on a page full of DOT', async ({page}) => {
    await page.goto('docs/graphviz');
    await revealLazyDiagrams(page);
    await waitForDiagrams(page, TOTAL_DIAGRAMS);

    await expect(page.locator('pre[class*="language-dot"]')).toHaveCount(0);
    await expect(page.locator('pre[class*="language-json"]')).toHaveCount(1);
    await expect(page.getByText('is not a diagram')).toBeVisible();
  });

  test('renders both engines on one page, each marked with its own engine', async ({page}) => {
    await page.goto('docs/graphviz');
    await revealLazyDiagrams(page);
    await waitForDiagrams(page, TOTAL_DIAGRAMS);

    await expect(page.locator(graphviz)).toHaveCount(DOT_DIAGRAMS);
    await expect(page.locator('[data-diagram-engine="plantuml"]')).toHaveCount(1);

    const plantuml = page.locator('[data-diagram-engine="plantuml"]').first();
    await expect(plantuml).toHaveAttribute('data-plantuml-status', 'ready');
    expect(await plantuml.locator('div[role="img"] > svg').textContent()).toContain('Alice');
  });

  test('shows the Graphviz diagnostic, line number and all, for invalid DOT', async ({page}) => {
    await page.goto('docs/graphviz');
    await revealLazyDiagrams(page);
    await waitForDiagrams(page, TOTAL_DIAGRAMS);

    const broken = page.locator(`${diagram}[data-plantuml-status="error"]`);
    await expect(broken).toHaveCount(1);

    const alert = broken.locator('[role="alert"]');
    await expect(alert).toContainText('Error: Graphviz diagram could not be rendered');
    // The structured-error payoff: PlantUML can only offer a generic failure here.
    await expect(alert).toContainText(/syntax error in line \d+/);
    await expect(alert).toContainText('Show diagram source');

    // One broken diagram must not stop the rest of the page from rendering.
    await expect(page.locator(`${diagram}[data-plantuml-status="ready"]`)).toHaveCount(
      TOTAL_DIAGRAMS - 1,
    );
  });

  test('adapts default colours to the colour mode without re-rendering', async ({page}) => {
    await page.goto('docs/graphviz');
    await revealLazyDiagrams(page);
    await waitForDiagrams(page, TOTAL_DIAGRAMS);

    const figure = page.locator(graphviz).first();
    const strokeOf = () =>
      figure
        .locator('div[role="img"] svg [stroke="black"]')
        .first()
        .evaluate((node) => getComputedStyle(node).stroke);

    const lightStroke = await strokeOf();

    await page.getByRole('button', {name: /switch between dark and light mode/i}).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const darkStroke = await strokeOf();

    // The `currentColor` rules make the diagram follow the page's text colour...
    expect(darkStroke).not.toBe(lightStroke);
    // ...and the diagram is never laid out a second time to achieve it.
    await expect(figure).toHaveAttribute('data-plantuml-status', 'ready');
  });

  test('leaves colours the DOT source set exactly as authored', async ({page}) => {
    await page.goto('docs/graphviz');
    await revealLazyDiagrams(page);
    await waitForDiagrams(page, TOTAL_DIAGRAMS);

    const authored = page.locator('[data-plantuml-diagram]', {
      has: page.locator('figcaption', {hasText: 'Authored colours survive the colour mode'}),
    });

    const redStroke = () =>
      authored
        .locator('svg [stroke="red"]')
        .first()
        .evaluate((node) => getComputedStyle(node).stroke);

    expect(await redStroke()).toBe('rgb(255, 0, 0)');

    await page.getByRole('button', {name: /switch between dark and light mode/i}).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Colours set in the diagram source always win, in both modes.
    expect(await redStroke()).toBe('rgb(255, 0, 0)');
  });

  test('strips a javascript: URL while keeping a real link', async ({page}) => {
    await page.goto('docs/graphviz');
    await revealLazyDiagrams(page);
    await waitForDiagrams(page, TOTAL_DIAGRAMS);

    const hrefs = await page
      .locator(`${graphviz} svg a`)
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('href') ?? node.getAttribute('xlink:href') ?? ''),
      );

    // DOT's `URL=` attribute really does become a working link...
    expect(hrefs.some((href) => href.includes('graphviz.org'))).toBe(true);
    // ...and sanitization is what keeps that from being an injection point. The example page
    // carries a node with `URL="javascript:alert(1)"` precisely so this is not vacuous.
    expect(hrefs.some((href) => /^\s*javascript:/i.test(href))).toBe(false);
    // The node itself still renders; only its link was removed.
    expect(await page.locator(`${graphviz} svg`).first().isVisible()).toBe(true);
    await expect(page.getByText('sanitized away')).toBeAttached();
  });

  test('zooms a DOT diagram with the same controls as a PlantUML one', async ({page}) => {
    await page.goto('docs/graphviz');
    await revealLazyDiagrams(page);
    await waitForDiagrams(page, TOTAL_DIAGRAMS);

    const wide = page.locator('[data-plantuml-diagram]', {
      has: page.locator('figcaption', {hasText: 'A wider graph worth zooming into'}),
    });
    const viewport = wide.locator('[data-plantuml-zoom]');
    await expect(viewport).toHaveAttribute('data-plantuml-zoom', '1');

    await wide.getByRole('button', {name: 'Zoom in'}).click();
    await expect(viewport).toHaveAttribute('data-plantuml-zoom', '1.25');

    await wide.getByRole('button', {name: 'Reset zoom'}).click();
    await expect(viewport).toHaveAttribute('data-plantuml-zoom', '1');
  });

  test('honours zoom=false on a DOT fence', async ({page}) => {
    await page.goto('docs/graphviz');
    await revealLazyDiagrams(page);
    await waitForDiagrams(page, TOTAL_DIAGRAMS);

    const plain = page.locator('[data-plantuml-diagram]', {
      has: page.locator('figcaption', {hasText: 'No zoom controls'}),
    });
    await expect(plain).not.toHaveAttribute('data-plantuml-interactive', 'true');
    await expect(plain.locator('[data-plantuml-zoom]')).toHaveCount(0);
    // The canvas is a direct child of the figure, exactly as for a non-zoomable PlantUML one.
    await expect(plain.locator('> div[role="img"]')).toHaveCount(1);
  });

  test('survives a client-side navigation without re-downloading the engine', async ({page}) => {
    const seen = monitor(page, ORIGIN);
    await page.goto('docs/graphviz-only');
    await waitForDiagrams(page, 1);

    await page
      .getByRole('navigation', {name: 'Docs sidebar'})
      .getByRole('link', {name: 'Graphviz (DOT)', exact: true})
      .click();
    await revealLazyDiagrams(page);
    await waitForDiagrams(page, TOTAL_DIAGRAMS);

    await expect(page.locator(graphviz).first()).toHaveAttribute('data-plantuml-status', 'ready');
    // One script tag, one download, however many times the reader navigates.
    expect(countRequests(seen.runtimeRequests, 'viz-global.js')).toBe(1);
    expect(await page.locator('script[data-plantuml-runtime]').count()).toBe(1);
  });
});
