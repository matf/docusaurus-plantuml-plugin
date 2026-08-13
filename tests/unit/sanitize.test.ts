import {describe, expect, it} from 'vitest';

import {PlantUmlError} from '../../src/runtime/errors.js';
import {sanitizeSvgMarkup} from '../../src/runtime/sanitize.js';

/** Parses sanitized output so assertions inspect the DOM rather than string fragments. */
function parse(svg: string): Document {
  return new DOMParser().parseFromString(svg, 'image/svg+xml');
}

describe('SVG sanitization removes executable content', () => {
  it('strips <script> elements', () => {
    const clean = sanitizeSvgMarkup(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10"/></svg>',
    );
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toContain('alert(1)');
    expect(clean).toMatch(/<rect/);
  });

  it('strips scripts hidden inside nested groups', () => {
    const clean = sanitizeSvgMarkup(
      '<svg xmlns="http://www.w3.org/2000/svg"><g><g><script>steal()</script></g></g></svg>',
    );
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toContain('steal()');
  });

  it.each([
    ['onload', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>'],
    ['onclick', '<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="alert(1)"/></svg>'],
    ['onerror', '<svg xmlns="http://www.w3.org/2000/svg"><image onerror="alert(1)"/></svg>'],
    [
      'onmouseover',
      '<svg xmlns="http://www.w3.org/2000/svg"><text onmouseover="alert(1)">hi</text></svg>',
    ],
  ])('strips the %s event-handler attribute', (handler, malicious) => {
    const clean = sanitizeSvgMarkup(malicious);
    expect(clean.toLowerCase()).not.toContain(handler);
    expect(clean).not.toContain('alert(1)');
  });

  it('strips javascript: URLs from links', () => {
    const clean = sanitizeSvgMarkup(
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text>click</text></a></svg>',
    );
    expect(clean.toLowerCase()).not.toContain('javascript:');
    expect(clean).not.toContain('alert(1)');
  });

  it('strips javascript: URLs from xlink:href', () => {
    const clean = sanitizeSvgMarkup(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
        '<a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
    );
    expect(clean.toLowerCase()).not.toContain('javascript:');
  });

  it('removes foreignObject, which can host arbitrary HTML', () => {
    const clean = sanitizeSvgMarkup(
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml">' +
        '<img src="x" onerror="alert(1)"/></body></foreignObject><rect/></svg>',
    );
    expect(clean.toLowerCase()).not.toContain('foreignobject');
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('alert(1)');
  });

  it.each(['iframe', 'object', 'embed'])('removes <%s>', (tag) => {
    const clean = sanitizeSvgMarkup(
      `<svg xmlns="http://www.w3.org/2000/svg"><${tag} src="https://evil.test"></${tag}><rect/></svg>`,
    );
    expect(clean.toLowerCase()).not.toContain(`<${tag}`);
    expect(clean).not.toContain('evil.test');
  });

  it('removes animation-based script execution', () => {
    const clean = sanitizeSvgMarkup(
      '<svg xmlns="http://www.w3.org/2000/svg"><a><animate attributeName="href" values="javascript:alert(1)"/>' +
        '<text>go</text></a></svg>',
    );
    expect(clean.toLowerCase()).not.toContain('javascript:');
  });

  it('rejects input that contains no SVG root rather than blanking the diagram', () => {
    expect(() => sanitizeSvgMarkup('<script>alert(1)</script>')).toThrow(PlantUmlError);
    expect(() => sanitizeSvgMarkup('')).toThrow(/no usable <svg> root/);
    expect(() => sanitizeSvgMarkup('just text')).toThrow(/no usable <svg> root/);
  });
});

describe('SVG sanitization preserves legitimate PlantUML output', () => {
  const realistic =
    '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 242 288" width="242" height="288">' +
    '<defs><linearGradient id="grad"><stop offset="0" stop-color="#fff"/></linearGradient>' +
    '<marker id="arrow" markerWidth="10"><path d="M0,0 L10,5 L0,10"/></marker></defs>' +
    '<g class="message" data-entity-1="part1" data-source-line="4" id="msg1">' +
    '<rect x="7" y="131" width="98.92" height="64.00" rx="2.50" fill="#F1F1F1" stroke="#181818"/>' +
    '<text x="5" y="17" font-size="12" fill="#000000" xml:space="preserve" style="white-space: pre" ' +
    'font-family="sans-serif">Sign in</text>' +
    '<line x1="0" y1="0" x2="10" y2="10" stroke-dasharray="2,2" marker-end="url(#arrow)"/>' +
    '<a href="https://example.com/docs"><text>docs</text></a>' +
    '<ellipse cx="5" cy="5" rx="3" ry="2"/><polygon points="0,0 5,5 10,0"/>' +
    '</g></svg>';

  it('keeps the SVG root with its viewBox and dimensions', () => {
    const doc = parse(sanitizeSvgMarkup(realistic));
    const svg = doc.documentElement;
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 242 288');
    expect(svg.getAttribute('width')).toBe('242');
    expect(svg.getAttribute('height')).toBe('288');
  });

  it('keeps geometry, text and styling', () => {
    const doc = parse(sanitizeSvgMarkup(realistic));
    expect(doc.querySelector('rect')?.getAttribute('fill')).toBe('#F1F1F1');
    expect(doc.querySelector('text')?.textContent).toBe('Sign in');
    expect(doc.querySelector('text')?.getAttribute('style')).toContain('white-space');
    expect(doc.querySelector('line')?.getAttribute('stroke-dasharray')).toBe('2,2');
    expect(doc.querySelector('ellipse')).not.toBeNull();
    expect(doc.querySelector('polygon')).not.toBeNull();
  });

  it('keeps gradients and markers referenced by url(#id)', () => {
    const doc = parse(sanitizeSvgMarkup(realistic));
    expect(doc.querySelector('lineargradient, linearGradient')).not.toBeNull();
    expect(doc.querySelector('marker')).not.toBeNull();
    expect(doc.querySelector('line')?.getAttribute('marker-end')).toBe('url(#arrow)');
  });

  it('keeps data-* attributes PlantUML uses to map SVG back to source lines', () => {
    const doc = parse(sanitizeSvgMarkup(realistic));
    const group = doc.querySelector('g.message');
    expect(group?.getAttribute('data-source-line')).toBe('4');
    expect(group?.getAttribute('data-entity-1')).toBe('part1');
  });

  it('keeps safe hyperlinks', () => {
    const clean = sanitizeSvgMarkup(realistic);
    expect(clean).toContain('https://example.com/docs');
  });

  it('keeps accessibility attributes', () => {
    const clean = sanitizeSvgMarkup(
      '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Order flow">' +
        '<title>Order flow</title><desc>A sequence diagram</desc><rect/></svg>',
    );
    expect(clean).toContain('aria-label="Order flow"');
    expect(clean).toContain('<title>');
    expect(clean).toContain('<desc>');
  });

  it('is idempotent, so a cached sanitized diagram survives re-sanitization', () => {
    const once = sanitizeSvgMarkup(realistic);
    expect(sanitizeSvgMarkup(once)).toBe(once);
  });
});

describe('plantuml hyperlinks and deeplink anchors', () => {
  // PlantUML's `[[url]]` on components and notes emits `<a href="…" target="_top">` around
  // the element's shapes; the deeplink feature additionally rides its target IDs in
  // hash-only hrefs. These pin that all of it survives sanitization.
  const wrap = (inner: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${inner}</svg>`;

  it('keeps a PlantUML-shaped link, including its target', () => {
    const clean = sanitizeSvgMarkup(
      wrap('<a href="https://example.com/reactions" target="_top"><rect/><text>C</text></a>'),
    );
    const anchor = parse(clean).querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://example.com/reactions');
    // `target` is not in DOMPurify's SVG profile and is allowed explicitly: PlantUML puts
    // `_top` on every link it renders, and rewriting where links open is not this
    // sanitizer's business.
    expect(anchor?.getAttribute('target')).toBe('_top');
  });

  it('keeps a hash-only self-anchor, which is how deeplink IDs travel', () => {
    const clean = sanitizeSvgMarkup(
      wrap('<a href="#graph?highlight-node=REACTION-1234" target="_top"><text>N</text></a>'),
    );
    expect(parse(clean).querySelector('a')?.getAttribute('href')).toBe(
      '#graph?highlight-node=REACTION-1234',
    );
  });

  it('keeps element ids, which the deeplink matcher resolves first', () => {
    const clean = sanitizeSvgMarkup(
      wrap(
        '<g id="MESSAGE-MY-GREAT-COMMAND" class="node"><title>archive</title><text>t</text></g>',
      ),
    );
    const group = parse(clean).querySelector('g');
    expect(group?.getAttribute('id')).toBe('MESSAGE-MY-GREAT-COMMAND');
    expect(group?.getAttribute('class')).toBe('node');
    expect(group?.querySelector('title')?.textContent).toBe('archive');
  });

  it('still strips a javascript: URL even with a target attribute present', () => {
    const clean = sanitizeSvgMarkup(
      wrap('<a href="javascript:alert(1)" target="_top"><text>x</text></a>'),
    );
    expect(clean).not.toMatch(/javascript:/i);
  });
});

describe('graphviz hyperlinks', () => {
  // DOT's `URL=`/`href=` node and edge attributes emit real <a> elements into the SVG, and
  // diagram source is untrusted by this plugin's threat model. These pin the guarantee.
  const wrap = (inner: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${inner}</svg>`;

  it('keeps an ordinary link a diagram author wrote', () => {
    const clean = sanitizeSvgMarkup(
      wrap('<a xlink:href="https://example.com/docs"><ellipse/></a>'),
    );
    expect(clean).toContain('example.com/docs');
    expect(clean).toContain('<ellipse');
  });

  it('keeps a relative link', () => {
    expect(sanitizeSvgMarkup(wrap('<a xlink:href="/docs/intro"><ellipse/></a>'))).toContain(
      '/docs/intro',
    );
  });

  it('strips a javascript: URL from xlink:href', () => {
    const clean = sanitizeSvgMarkup(wrap('<a xlink:href="javascript:alert(1)"><ellipse/></a>'));
    expect(clean).not.toMatch(/javascript:/i);
  });

  it('strips a javascript: URL from a plain href', () => {
    const clean = sanitizeSvgMarkup(wrap('<a href="javascript:alert(1)"><ellipse/></a>'));
    expect(clean).not.toMatch(/javascript:/i);
  });

  it('strips a javascript: URL obfuscated with entities and whitespace', () => {
    const clean = sanitizeSvgMarkup(
      wrap('<a xlink:href="  java&#115;cript:alert(1)"><ellipse/></a>'),
    );
    expect(clean).not.toMatch(/javascript:/i);
  });

  it('strips an event handler Graphviz would never emit', () => {
    const clean = sanitizeSvgMarkup(wrap('<ellipse onclick="alert(1)" stroke="black"/>'));
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).toContain('stroke="black"');
  });

  it('preserves the colour attributes the dark-mode CSS selects on', () => {
    // The stylesheet retargets `stroke="black"`/`fill="black"` at currentColor; sanitization
    // must not rewrite or drop those attributes or the adaptation silently stops working.
    const clean = sanitizeSvgMarkup(
      wrap('<polygon fill="black" stroke="black" points="0,0 1,1"/><text>a</text>'),
    );
    expect(clean).toContain('fill="black"');
    expect(clean).toContain('stroke="black"');
    expect(clean).toMatch(/<text[^>]*>a<\/text>/);
  });
});
