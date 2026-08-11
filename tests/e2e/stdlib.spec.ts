import {expect, test} from '@playwright/test';

import {monitor, revealLazyDiagrams, waitForDiagrams} from './helpers.js';

const BASE_URL = process.env['PLANTUML_E2E_BASE_URL'] as string;
const ORIGIN = new URL(BASE_URL).origin;

const diagram = '[data-plantuml-diagram]';

/** `docs/stdlib` carries four fences: three that must render and one that must explain. */
const TOTAL_DIAGRAMS = 4;

/**
 * The request the engine makes when it resolves a namespace itself: a bare `<ns>.min.js`
 * against the page URL. On a docs site that is `/docs/c4.min.js`, which cannot exist. Its
 * absence is the whole point of the loader, so every test here checks for it.
 */
function pageRelativeBundleRequests(requests: string[]): string[] {
  return requests.filter((url) => /\/docs\/[^/]*\.min\.js$/.test(url));
}

test.describe('PlantUML standard library', () => {
  test('renders C4 diagrams with no configuration, from the site origin only', async ({page}) => {
    const seen = monitor(page, ORIGIN);
    await page.goto('docs/stdlib');
    await revealLazyDiagrams(page);
    await waitForDiagrams(page, TOTAL_DIAGRAMS);

    const container = page.locator(diagram).first();
    await expect(container).toHaveAttribute('data-plantuml-status', 'ready');

    const svg = container.locator('div[role="img"] > svg');
    await expect(svg).toHaveCount(1);
    const text = await svg.textContent();
    // Labels that only appear once C4's macros have actually been expanded: the stereotype
    // and the technology suffix are produced by `Container()`, not written in the fence.
    expect(text).toContain('Reader');
    expect(text).toContain('«container»');
    expect(text).toContain('Browser[JavaScript]');

    expect(
      pageRelativeBundleRequests(seen.requests),
      'the engine must never resolve a namespace against the page URL',
    ).toEqual([]);
    expect(seen.forbiddenRequests, 'the standard library never comes from a CDN').toEqual([]);
    expect(seen.externalRequests, 'every request stays on the site origin').toEqual([]);
    expect(seen.pageErrors).toEqual([]);
  });

  test('accepts an include written with the .puml extension', async ({page}) => {
    await page.goto('docs/stdlib');
    await revealLazyDiagrams(page);
    await waitForDiagrams(page, TOTAL_DIAGRAMS);

    const figure = page.locator(diagram).nth(1);
    await expect(figure).toHaveAttribute('data-plantuml-status', 'ready');
    expect(await figure.locator('div[role="img"] > svg').textContent()).toContain('Reader');
  });

  test('resolves a namespace that the library itself includes', async ({page}) => {
    const seen = monitor(page, ORIGIN);
    await page.goto('docs/stdlib');
    await revealLazyDiagrams(page);
    await waitForDiagrams(page, TOTAL_DIAGRAMS);

    // `k8s/Common` includes `<c4/…>`, which the engine would ask for mid-render.
    await expect(page.locator(diagram).nth(2)).toHaveAttribute('data-plantuml-status', 'ready');
    expect(seen.requests.filter((url) => url.endsWith('/c4.min.js'))).toHaveLength(1);
    expect(seen.requests.filter((url) => url.endsWith('/k8s.min.js'))).toHaveLength(1);
    expect(pageRelativeBundleRequests(seen.requests)).toEqual([]);
  });

  test('downloads only the namespaces the page uses', async ({page}) => {
    const seen = monitor(page, ORIGIN);
    await page.goto('docs/stdlib');
    await revealLazyDiagrams(page);
    await waitForDiagrams(page, TOTAL_DIAGRAMS);

    // `office` is vendored and is an example-only dependency of C4. Charging every C4 page
    // 160 KB for a namespace its diagrams do not use would defeat the per-namespace split.
    expect(seen.requests.filter((url) => url.endsWith('/office.min.js'))).toEqual([]);
    expect(seen.requests.filter((url) => url.endsWith('/azure.min.js'))).toEqual([]);
  });

  test('names the missing namespace instead of failing inside the engine', async ({page}) => {
    await page.goto('docs/stdlib');
    await revealLazyDiagrams(page);
    await waitForDiagrams(page, TOTAL_DIAGRAMS);

    const figure = page.locator(diagram).nth(3);
    await expect(figure).toHaveAttribute('data-plantuml-status', 'error');
    const panel = await figure.textContent();
    expect(panel).toContain("'aws'");
    expect(panel).toContain('stdlib.include');
    // PlantUML's own error picture must not be what the reader sees.
    expect(panel).not.toContain('Fatal parsing error');
  });

  test('a page with no stdlib include requests no bundle at all', async ({page}) => {
    const seen = monitor(page, ORIGIN);
    await page.goto('docs/plantuml');
    await revealLazyDiagrams(page);
    await waitForDiagrams(page, 1);

    expect(seen.requests.filter((url) => /\.min\.js$/.test(url))).toEqual([]);
  });
});
