import {expect, test} from '@playwright/test';

/**
 * Guards the assumptions this plugin makes about `@plantuml/core`'s public API.
 *
 * These are the facts that justify using the string-returning API instead of the
 * DOM-oriented `render()` plus a MutationObserver. If a future engine release changes them,
 * this test fails loudly rather than the plugin silently rendering every diagram in the
 * wrong colour scheme.
 */

interface EngineProbe {
  exports: string[];
  renderArity: number;
  renderToStringArity: number;
  lightColors: string;
  darkColors: string;
  darkDiffersFromLight: boolean;
  explicitLightMatchesDefault: boolean;
  invalidResolvesSuccessfully: boolean;
  invalidText: string;
}

test('the installed @plantuml/core still matches the adapter contract', async ({page}) => {
  await page.goto('docs/plantuml');
  // Rendering the page already loads the runtime from the site's own assets directory.
  await page.waitForSelector('[data-plantuml-status="ready"]', {timeout: 90_000});

  const assetsDir = await page.evaluate(() => {
    const script = document.querySelector<HTMLScriptElement>('script[data-plantuml-runtime]');
    return script ? script.src.replace(/\/viz-global\.js$/, '') : null;
  });
  expect(assetsDir, 'the runtime script tag identifies the assets directory').not.toBeNull();

  const probe: EngineProbe = await page.evaluate(async (dir) => {
    const engine = (await import(`${dir}/plantuml.js`)) as {
      render: (...args: unknown[]) => void;
      renderToString: (...args: unknown[]) => void;
    };

    const call = (source: string, options?: unknown) =>
      new Promise<{ok: boolean; svg?: string; err?: string}>((resolve) => {
        const args: unknown[] = [
          source.split('\n'),
          (svg: string) => resolve({ok: true, svg}),
          (err: unknown) => resolve({ok: false, err: String(err)}),
        ];
        if (options !== undefined) args.push(options);
        engine.renderToString(...args);
        setTimeout(() => resolve({ok: false, err: 'timeout'}), 30_000);
      });

    const colors = (svg: string) =>
      [...new Set(svg.match(/#[0-9A-Fa-f]{6}/g) ?? [])].sort().join(',');

    const sequence = '@startuml\nAlice -> Bob : Hello\nreturn ok\n@enduml';
    const light = await call(sequence);
    const dark = await call(sequence, {dark: true});
    const explicitLight = await call(sequence, {dark: false});
    const invalid = await call('@startuml\nthis is definitely not valid ###\nAlice ->\n@enduml');

    const invalidDoc = invalid.svg
      ? new DOMParser().parseFromString(invalid.svg, 'image/svg+xml')
      : null;

    return {
      exports: Object.keys(engine).sort(),
      renderArity: engine.render.length,
      renderToStringArity: engine.renderToString.length,
      lightColors: colors(light.svg ?? ''),
      darkColors: colors(dark.svg ?? ''),
      darkDiffersFromLight: light.svg !== dark.svg,
      explicitLightMatchesDefault: explicitLight.svg === light.svg,
      invalidResolvesSuccessfully: invalid.ok,
      invalidText: invalidDoc
        ? Array.from(invalidDoc.querySelectorAll('text'))
            .map((node) => node.textContent ?? '')
            .join('\n')
        : '',
    };
  }, assetsDir);

  expect(probe.exports).toEqual(['render', 'renderToString']);

  // renderToString(lines, onSuccess, onError, options) — the options argument is why the
  // adapter never needs a temporary DOM element or a MutationObserver.
  expect(probe.renderToStringArity).toBe(4);
  expect(probe.renderArity).toBe(3);

  // The `dark` option is honoured by the string API.
  expect(probe.darkDiffersFromLight).toBe(true);
  expect(probe.lightColors).not.toBe(probe.darkColors);
  expect(probe.explicitLightMatchesDefault).toBe(true);

  // Invalid PlantUML is delivered through the *success* callback as an error picture, which
  // is why the renderer inspects the SVG text instead of trusting onError alone.
  expect(probe.invalidResolvesSuccessfully).toBe(true);
  expect(probe.invalidText).toContain('Syntax Error?');
  expect(probe.invalidText).toContain('(Assumed diagram type:');
});
