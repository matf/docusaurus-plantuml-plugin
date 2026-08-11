import {expect, test} from '@playwright/test';

import {countRequests, monitor, waitForDiagrams} from './helpers.js';

const BASE_URL = process.env['PLANTUML_E2E_BASE_URL'] as string;
const ORIGIN = new URL(BASE_URL).origin;
const BASE_PATH = new URL(BASE_URL).pathname; // '/plantuml-test/'

const diagram = '[data-plantuml-diagram]';

/**
 * The rendered diagram, as the README documents it. Scoped rather than a bare `svg` because
 * the toolbar's control icons are SVG too — a loose selector would match those as well.
 */
const DIAGRAM_SVG = 'div[role="img"] > svg';

test.describe('client-side PlantUML rendering', () => {
  test('renders a real SVG with the expected diagram labels', async ({page}) => {
    const seen = monitor(page, ORIGIN);
    await page.goto('docs/plantuml');

    const figure = page.locator(diagram).first();
    await expect(figure).toHaveAttribute('data-plantuml-status', 'ready');

    // The SVG must live inside the accessible container, not loose in the page.
    const svg = figure.locator('div[role="img"] > svg');
    await expect(svg).toHaveCount(1);

    const text = await svg.textContent();
    for (const label of ['User', 'Browser', 'API', 'Sign in', 'POST /sessions', 'Access token']) {
      expect(text).toContain(label);
    }

    await expect(figure.locator('figcaption')).toHaveText('Authentication sequence');
    await expect(figure.locator('div[role="img"]')).toHaveAttribute(
      'aria-label',
      'Authentication sequence',
    );

    expect(seen.forbiddenRequests, 'no external PlantUML/CDN requests').toEqual([]);
    expect(seen.externalRequests, 'every request stays on the site origin').toEqual([]);
    expect(seen.pageErrors).toEqual([]);
    expect(seen.hydrationWarnings, 'production build hydrates cleanly').toEqual([]);
  });

  test('replaces PlantUML fences and leaves ordinary code blocks untouched', async ({page}) => {
    await page.goto('docs/mixed-content');
    await waitForDiagrams(page, 1);

    // No PlantUML fence survives as a highlighted code block. Docusaurus puts the fence
    // language class on the <pre>, so that is what must be absent.
    await expect(page.locator('pre[class*="language-plantuml"]')).toHaveCount(0);
    await expect(page.locator('pre[class*="language-puml"]')).toHaveCount(0);

    // The uppercase ```PlantUML fence is still recognized.
    await expect(page.locator(diagram)).toHaveCount(1);
    await expect(page.locator(diagram).first()).toHaveAttribute('data-plantuml-status', 'ready');

    // ...while the TypeScript and bash blocks remain ordinary code blocks.
    await expect(page.locator('pre[class*="language-ts"]')).toHaveCount(1);
    await expect(page.locator('pre[class*="language-bash"]')).toHaveCount(1);
    await expect(page.getByText('handleSignIn')).toBeVisible();
  });

  test('renders several diagrams on one page, including a Graphviz layout', async ({page}) => {
    const seen = monitor(page, ORIGIN);
    await page.goto('docs/multiple-diagrams');
    await waitForDiagrams(page, 3);

    const figures = page.locator(diagram);
    await expect(figures).toHaveCount(3);

    for (let index = 0; index < 3; index += 1) {
      await expect(figures.nth(index)).toHaveAttribute('data-plantuml-status', 'ready');
      await expect(figures.nth(index).locator(DIAGRAM_SVG)).toHaveCount(1);
    }

    // The class diagram exercises the bundled Graphviz engine rather than sequence layout.
    const classDiagram = figures.nth(1);
    const classText = await classDiagram.locator(DIAGRAM_SVG).textContent();
    expect(classText).toContain('OrderService');
    expect(classText).toContain('OrderRepository');
    expect(classText).toContain('Clock');

    // One page, one engine load.
    expect(countRequests(seen.runtimeRequests, 'viz-global.js')).toBe(1);
    expect(countRequests(seen.runtimeRequests, 'plantuml.js')).toBe(1);
    await expect(page.locator('script[data-plantuml-runtime]')).toHaveCount(1);
  });

  test('renders diagrams authored in MDX, including the puml alias', async ({page}) => {
    await page.goto('docs/plantuml-mdx');
    await waitForDiagrams(page, 2);

    const figures = page.locator(diagram);
    await expect(figures).toHaveCount(2);
    await expect(figures.nth(0)).toHaveAttribute('data-plantuml-diagram', 'plantuml');
    await expect(figures.nth(1)).toHaveAttribute('data-plantuml-diagram', 'puml');
    await expect(figures.nth(1).locator(DIAGRAM_SVG)).toHaveCount(1);
    expect(await figures.nth(1).locator(DIAGRAM_SVG).textContent()).toContain('puml alias in MDX');
  });

  test('renders diagrams in blog posts', async ({page}) => {
    await page.goto('blog/2026/01/15/diagrams-in-blog');
    await waitForDiagrams(page, 1);
    await expect(page.locator(diagram).first()).toHaveAttribute('data-plantuml-status', 'ready');
  });

  test('contains an invalid diagram in an error panel without breaking the page', async ({
    page,
  }) => {
    const seen = monitor(page, ORIGIN);
    await page.goto('docs/invalid-diagram');
    await waitForDiagrams(page, 2);

    const figures = page.locator(diagram);
    const broken = figures.nth(0);
    await expect(broken).toHaveAttribute('data-plantuml-status', 'error');

    const alert = broken.locator('[role="alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Error: PlantUML diagram could not be rendered');
    await expect(alert).toContainText('Syntax Error?');
    // The failure is announced in text, not only by colour.
    await expect(broken.locator('details summary')).toHaveText('Show diagram source');
    await expect(broken.locator('details pre')).toContainText('this is definitely not valid');
    await expect(broken.locator(DIAGRAM_SVG)).toHaveCount(0);

    // A failed render must not wedge the queue: the next diagram still renders.
    await expect(figures.nth(1)).toHaveAttribute('data-plantuml-status', 'ready');
    await expect(figures.nth(1).locator(DIAGRAM_SVG)).toHaveCount(1);

    expect(seen.pageErrors, 'a bad diagram must not crash the page').toEqual([]);
  });

  test('serves every runtime asset from the configured baseUrl', async ({page}) => {
    const seen = monitor(page, ORIGIN);
    await page.goto('docs/plantuml');
    await waitForDiagrams(page, 1);

    expect(seen.runtimeRequests.length).toBeGreaterThan(0);
    for (const url of seen.runtimeRequests) {
      expect(url.startsWith(`${ORIGIN}${BASE_PATH}`), `${url} must be under ${BASE_PATH}`).toBe(
        true,
      );
      // Version-namespaced so an engine upgrade cannot be served from a stale cache.
      expect(url).toMatch(/\/assets\/plantuml-client-\d+\.\d+\.\d+\//);
    }
  });

  test('does not load the PlantUML runtime on a page without diagrams', async ({page}) => {
    const seen = monitor(page, ORIGIN);
    await page.goto('docs/ordinary-code');
    await page.waitForLoadState('networkidle');

    await expect(page.locator(diagram)).toHaveCount(0);
    await expect(page.locator('script[data-plantuml-runtime]')).toHaveCount(0);
    expect(seen.runtimeRequests).toEqual([]);

    // The ordinary code blocks are still rendered as code blocks.
    await expect(page.locator('pre[class*="language-ts"]')).toHaveCount(1);
    await expect(page.locator('pre[class*="language-js"]')).toHaveCount(1);
    await expect(page.locator('pre[class*="language-text"]')).toHaveCount(1);
  });

  test('re-renders in the matching theme when dark mode is toggled', async ({page}) => {
    await page.goto('docs/plantuml');
    await waitForDiagrams(page, 1);

    const figure = page.locator(diagram).first();
    await expect(figure).toHaveAttribute('data-plantuml-theme', 'light');
    const lightSvg = await figure.locator(DIAGRAM_SVG).innerHTML();

    await page.getByRole('button', {name: /switch between dark and light mode/i}).click();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(figure).toHaveAttribute('data-plantuml-theme', 'dark');
    await expect(figure).toHaveAttribute('data-plantuml-status', 'ready');

    const darkSvg = await figure.locator(DIAGRAM_SVG).innerHTML();
    expect(darkSvg, 'the dark diagram must not be the cached light one').not.toBe(lightSvg);

    // Switching back must restore the light diagram, not leave the dark one in place.
    await page.getByRole('button', {name: /switch between dark and light mode/i}).click();
    await expect(figure).toHaveAttribute('data-plantuml-theme', 'light');
    await expect(figure).toHaveAttribute('data-plantuml-status', 'ready');
    expect(await figure.locator(DIAGRAM_SVG).innerHTML()).toBe(lightSvg);
  });

  test('still renders after client-side navigation away and back', async ({page}) => {
    const seen = monitor(page, ORIGIN);
    await page.goto('./');

    await expect(page.locator(diagram)).toHaveCount(0);

    await page.getByRole('link', {name: 'Sequence diagram'}).click();
    await waitForDiagrams(page, 1);
    await expect(page.locator(diagram).first()).toHaveAttribute('data-plantuml-status', 'ready');

    await page.goBack();
    await expect(page.locator(diagram)).toHaveCount(0);

    await page.goForward();
    await waitForDiagrams(page, 1);
    await expect(page.locator(diagram).first()).toHaveAttribute('data-plantuml-status', 'ready');
    await expect(page.locator(diagram).first().locator(DIAGRAM_SVG)).toHaveCount(1);

    // Client-side navigation must not append a second runtime script tag.
    await expect(page.locator('script[data-plantuml-runtime]')).toHaveCount(1);
    expect(countRequests(seen.runtimeRequests, 'viz-global.js')).toBe(1);
    expect(seen.pageErrors).toEqual([]);
  });

  test('emits an accessible, JavaScript-free fallback in the served HTML', async ({request}) => {
    const response = await request.get('docs/plantuml');
    const html = await response.text();

    // Server-rendered markup is the deferred placeholder, never a diagram.
    expect(html).toContain('data-plantuml-status="idle"');
    expect(html).toContain('<noscript>');
    expect(html).toContain('@startuml');
    expect(html).not.toContain('<svg xmlns="http://www.w3.org/2000/svg" version="1.1"');
  });
});
