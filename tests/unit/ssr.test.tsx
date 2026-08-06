// @vitest-environment node
import {renderToString} from 'react-dom/server';
import {describe, expect, it} from 'vitest';

import Code from '../../src/theme/MDXComponents/Code/index.js';
import PlantUmlDiagram from '../../src/theme/PlantUmlDiagram/index.js';
import {loadPlantUmlRuntime} from '../../src/runtime/assetLoader.js';
import {sanitizeSvgMarkup} from '../../src/runtime/sanitize.js';

/**
 * Server-side rendering happens in a plain Node process with no `window` or `document`.
 * Anything here that touches a browser global would break `docusaurus build`, so these
 * tests deliberately run in the `node` environment rather than jsdom.
 */

const SOURCE = '@startuml\nAlice -> Bob : Hello\n@enduml';

describe('server-side rendering', () => {
  it('has no browser globals available, as in a real Docusaurus build', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('renders the diagram component to the deferred placeholder without touching the DOM', () => {
    const html = renderToString(<PlantUmlDiagram source={SOURCE} title="Order flow" />);

    expect(html).toContain('data-plantuml-status="idle"');
    expect(html).toContain('data-plantuml-theme="light"');
    expect(html).toContain('data-plantuml-diagram="plantuml"');
    // No diagram is generated during static-site generation.
    expect(html).not.toContain('<svg');
  });

  it('emits the caption and the no-JavaScript fallback on the server', () => {
    const html = renderToString(<PlantUmlDiagram source={SOURCE} title="Order flow" />);

    expect(html).toContain('Order flow');
    expect(html).toContain('<noscript>');
    expect(html).toContain('@startuml');
  });

  it('escapes the source in the noscript fallback', () => {
    const html = renderToString(<PlantUmlDiagram source={'A -> B : <img onerror="x">'} />);

    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;img');
  });

  it('renders a PlantUML fence through the Code wrapper without a browser', () => {
    const html = renderToString(<Code className="language-plantuml">{`${SOURCE}\n`}</Code>);
    expect(html).toContain('data-plantuml-status="idle"');
  });

  it('delegates ordinary code blocks on the server too', () => {
    const html = renderToString(<Code className="language-ts">{'const x = 1;\n'}</Code>);
    expect(html).toContain('original-code');
    expect(html).not.toContain('data-plantuml-diagram');
  });

  it('refuses to load the PlantUML runtime during SSR', async () => {
    await expect(
      loadPlantUmlRuntime({assetsBaseUrl: '/assets/plantuml', timeoutMs: 1_000}),
    ).rejects.toThrow(/cannot be loaded during server-side rendering/);
  });

  it('refuses to sanitize during SSR rather than silently returning unsafe markup', () => {
    expect(() => sanitizeSvgMarkup('<svg xmlns="http://www.w3.org/2000/svg"/>')).toThrow(
      /requires a browser environment/,
    );
  });
});

describe('server-side rendering with zoom enabled', () => {
  it('emits the deferred placeholder and no interactive controls', () => {
    // Zoom is on by default, and none of its browser APIs may be touched during SSG.
    const html = renderToString(<PlantUmlDiagram source={SOURCE} />);

    expect(html).toContain('data-plantuml-status="idle"');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('tabindex');
    expect(html).not.toContain('data-plantuml-zoom');
    expect(html).not.toContain('<svg');
  });

  it('renders a zoom-disabled diagram identically on the server', () => {
    const html = renderToString(<PlantUmlDiagram source={SOURCE} zoom={false} />);
    expect(html).toContain('data-plantuml-status="idle"');
    expect(html).not.toContain('data-plantuml-interactive');
  });
});
