import {expect, test} from '@playwright/test';

import {monitor, waitForDiagrams} from './helpers.js';

const ORIGIN = new URL(process.env['PLANTUML_E2E_BASE_URL'] as string).origin;

const FOCUSED = '[data-plantuml-focused-node]';

/**
 * The links fixture page has two diagrams: a PlantUML component diagram addressed through
 * aliases (`MESSAGE_MY_GREAT_COMMAND`, an aliased note, a multiline label `Archive\n12345`),
 * and a Graphviz diagram with an explicit node id (`GRAPH-HANDLER-9`), a self-anchor
 * (`SELF-NODE-3`) and an external link.
 *
 * PlantUML `[[…]]` hyperlinks are deliberately absent from the fixture: the bundled engine
 * renders their text but emits no `<a>` elements, so there is nothing to click. Graphviz
 * links are the clickable ones.
 */
test.describe('diagram links and deep links', () => {
  test('renders Graphviz author links as real, sanitized anchors', async ({page}) => {
    const seen = monitor(page, ORIGIN);
    await page.goto('docs/links');
    await waitForDiagrams(page, 2);

    const graphviz = page.locator('[data-plantuml-diagram]').nth(1);
    // `URL=` became real anchors: one external, one self-anchor carrying a deeplink.
    const external = graphviz.locator('svg a').filter({hasText: 'attrs docs'});
    await expect(external).toHaveCount(1);
    const self = graphviz.locator('svg a').filter({hasText: 'self link'});
    await expect(self).toHaveCount(1);

    expect(seen.pageErrors).toEqual([]);
  });

  test('arriving with a hash resolves a PlantUML alias, scrolls and snaps to 100%', async ({
    page,
  }) => {
    await page.goto('docs/links#graph?highlight-node=MESSAGE_MY_GREAT_COMMAND');
    await waitForDiagrams(page, 2);

    const focused = page.locator(FOCUSED);
    await expect(focused).toHaveCount(1);
    // The alias resolved to the entity group whose label is the visible text.
    await expect(focused).toHaveText(/Command handler/);
    await expect(focused).toHaveAttribute('data-qualified-name', 'MESSAGE_MY_GREAT_COMMAND');

    const figure = page.locator('[data-plantuml-diagram]').first();
    await expect(figure).toBeInViewport();
    await expect(figure.locator('[data-plantuml-zoom]')).toHaveAttribute('data-plantuml-zoom', '1');
  });

  test('resolves an aliased note, which makes notes navigable', async ({page}) => {
    await page.goto('docs/links#graph?highlight-node=REACTIONNOTE1');
    await waitForDiagrams(page, 2);

    const focused = page.locator(FOCUSED);
    await expect(focused).toHaveCount(1);
    await expect(focused).toHaveText(/REACTION-NOTE-1/);
  });

  test('resolves a Graphviz node by its explicit id', async ({page}) => {
    await page.goto('docs/links#graph?highlight-node=GRAPH-HANDLER-9');
    await waitForDiagrams(page, 2);

    const focused = page.locator(FOCUSED);
    await expect(focused).toHaveCount(1);
    await expect(focused).toHaveAttribute('id', 'GRAPH-HANDLER-9');
  });

  test('resolves note text by substring, so unannotated text stays reachable', async ({page}) => {
    await page.goto('docs/links#graph?highlight-node=REACTION-NOTE-1');
    await waitForDiagrams(page, 2);

    await expect(page.locator(FOCUSED)).toHaveText(/REACTION-NOTE-1/);
  });

  test('resolves a multiline label through an encoded newline', async ({page}) => {
    await page.goto('docs/links#graph?highlight-node=Archive%0A12345');
    await waitForDiagrams(page, 2);

    const focused = page.locator(FOCUSED);
    await expect(focused).toHaveCount(2);
    await expect(focused.nth(0)).toHaveText(/Archive/);
    await expect(focused.nth(1)).toHaveText(/12345/);
  });

  test('clicking a self-anchor mints the node permalink and highlights it', async ({page}) => {
    await page.goto('docs/links');
    await waitForDiagrams(page, 2);
    expect(page.url()).not.toContain('highlight-node');

    await page
      .locator('[data-plantuml-diagram]')
      .nth(1)
      .locator('svg a')
      .filter({hasText: 'self link'})
      .click();

    await expect.poll(() => page.url()).toContain('#graph?highlight-node=SELF-NODE-3');
    await expect(page.locator(FOCUSED)).toHaveCount(1);
    await expect(page.locator(FOCUSED)).toHaveText(/self link/);
  });

  test('a changed hash moves the highlight without a reload', async ({page}) => {
    await page.goto('docs/links#graph?highlight-node=MESSAGE_MY_GREAT_COMMAND');
    await waitForDiagrams(page, 2);
    await expect(page.locator(FOCUSED)).toHaveText(/Command handler/);

    await page.evaluate(() => {
      window.location.hash = '#graph?highlight-node=GRAPH-HANDLER-9';
    });

    await expect(page.locator(FOCUSED)).toHaveAttribute('id', 'GRAPH-HANDLER-9');
    await expect(page.locator(FOCUSED)).toHaveCount(1);

    await page.evaluate(() => {
      window.location.hash = '#unrelated';
    });
    await expect(page.locator(FOCUSED)).toHaveCount(0);
  });
});
