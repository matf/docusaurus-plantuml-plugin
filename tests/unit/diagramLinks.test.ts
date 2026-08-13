import {describe, expect, it} from 'vitest';

import {
  attachDiagramLinks,
  detachDiagramLinks,
  extractSourceLinks,
  isSafeLinkHref,
} from '../../src/theme/PlantUmlDiagram/diagramLinks.js';

describe('isSafeLinkHref', () => {
  it('accepts web, site-relative and hash targets', () => {
    expect(isSafeLinkHref('https://example.com/x')).toBe(true);
    expect(isSafeLinkHref('http://example.com')).toBe(true);
    expect(isSafeLinkHref('/docs/orders')).toBe(true);
    expect(isSafeLinkHref('./sibling')).toBe(true);
    expect(isSafeLinkHref('../up')).toBe(true);
    expect(isSafeLinkHref('#graph?highlight-node=X')).toBe(true);
  });

  it('rejects every other explicit scheme', () => {
    expect(isSafeLinkHref('javascript:alert(1)')).toBe(false);
    expect(isSafeLinkHref('data:text/html,x')).toBe(false);
    expect(isSafeLinkHref('vbscript:x')).toBe(false);
    expect(isSafeLinkHref('file:///etc/passwd')).toBe(false);
  });

  it('rejects bare words, which resolve unpredictably', () => {
    expect(isSafeLinkHref('orders')).toBe(false);
  });
});

describe('extractSourceLinks', () => {
  it('extracts the href with its line index', () => {
    const links = extractSourceLinks(
      '@startuml\ncomponent "X" as C [[/docs/orders#graph?highlight-node=D1]]\n@enduml',
    );
    expect(links).toEqual([
      {
        line: 1,
        text: 'component "X" as C [[/docs/orders#graph?highlight-node=D1]]',
        href: '/docs/orders#graph?highlight-node=D1',
      },
    ]);
  });

  it('strips labels and tooltips from the href', () => {
    expect(extractSourceLinks('a [[/docs/x a label]]')[0]?.href).toBe('/docs/x');
    expect(extractSourceLinks('a [[/docs/x{a tooltip}]]')[0]?.href).toBe('/docs/x');
  });

  it('skips note lines, whose links are body text the engine renders itself', () => {
    expect(extractSourceLinks('note right of X : see [[/docs/x]]')).toEqual([]);
    expect(extractSourceLinks('rnote over X : [[/docs/x]]')).toEqual([]);
  });

  it('skips unsafe hrefs', () => {
    expect(extractSourceLinks('component A [[javascript:alert(1)]]')).toEqual([]);
  });

  it('takes at most one link per line, since lines are the correlation unit', () => {
    const links = extractSourceLinks('component A [[/docs/a]] [[/docs/b]]');
    expect(links).toHaveLength(1);
    expect(links[0]?.href).toBe('/docs/a');
  });
});

/** A rendered-diagram stand-in with the attributes the engine actually emits. */
function svgRoot(inner: string): Element {
  const host = document.createElement('div');
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  return host;
}

const anchors = (root: Element) =>
  Array.from(root.querySelectorAll('a[data-plantuml-diagram-link]'));

describe('attachDiagramLinks', () => {
  it('wraps an entity through its alias', () => {
    const root = svgRoot(
      '<g class="entity" data-qualified-name="ORDER_SVC" id="ent0001" data-source-line="1">' +
        '<rect/><text>Order Service</text></g>',
    );
    const source = '@startuml\ncomponent "Order Service" as ORDER_SVC [[/docs/orders]]\n@enduml';

    const wrapped = attachDiagramLinks(root, extractSourceLinks(source));

    expect(wrapped).toBe(1);
    const anchor = anchors(root)[0];
    expect(anchor?.getAttribute('href')).toBe('/docs/orders');
    expect(anchor?.querySelector('[data-qualified-name="ORDER_SVC"]')).not.toBeNull();
  });

  it('wraps through the alias even when preprocessing shifted every line number', () => {
    // The stdlib case: `!include <C4/C4_Container>` makes the engine number lines in the
    // preprocessed text, so data-source-line has nothing to do with the author's source.
    const root = svgRoot(
      '<g class="entity" data-qualified-name="web" id="ent0002" data-source-line="374">' +
        '<rect/><text>Web App</text></g>',
    );
    const source =
      '@startuml\n!include <C4/C4_Container>\nContainer(web, "Web App", "React") [[/docs/web#graph?highlight-node=X]]\n@enduml';

    expect(attachDiagramLinks(root, extractSourceLinks(source))).toBe(1);
    expect(anchors(root)[0]?.getAttribute('href')).toBe('/docs/web#graph?highlight-node=X');
  });

  it('wraps every element sharing the alias, except lifelines', () => {
    // Sequence participants render as head + tail + lifeline, all named alike; the
    // lifeline spans the whole diagram height and must not become a link.
    const root = svgRoot(
      '<g class="participant participant-head" data-qualified-name="PAY" data-source-line="1"><rect/></g>' +
        '<g class="participant-lifeline" data-qualified-name="PAY" data-source-line="1"><path/></g>' +
        '<g class="participant participant-tail" data-qualified-name="PAY" data-source-line="1"><rect/></g>',
    );
    const source = '@startuml\nparticipant "Payment" as PAY [[/docs/pay]]\n@enduml';

    expect(attachDiagramLinks(root, extractSourceLinks(source))).toBe(2);
    expect(root.querySelector('.participant-lifeline')?.closest('a')).toBeNull();
  });

  it('wraps an edge through its endpoint pair', () => {
    const root = svgRoot(
      '<g class="entity" data-qualified-name="A" id="ent0001" data-source-line="90"><text>A</text></g>' +
        '<g class="entity" data-qualified-name="B" id="ent0002" data-source-line="91"><text>B</text></g>' +
        '<g class="link" data-entity-1="ent0001" data-entity-2="ent0002" data-source-line="95"><path/></g>',
    );
    // Shifted line numbers on purpose: the pair resolution must carry it alone.
    const source = '@startuml\nA --> B : uses [[/docs/edge]]\n@enduml';

    expect(attachDiagramLinks(root, extractSourceLinks(source))).toBe(1);
    expect(anchors(root)[0]?.querySelector('g.link')).not.toBeNull();
  });

  it('falls back to the exact source line for unnamed elements', () => {
    const root = svgRoot(
      '<g class="link" data-entity-1="x" data-entity-2="y" data-source-line="1"><path/></g>',
    );
    // No qualified names anywhere; the arrow identifiers resolve nothing, the line does.
    const source = '@startuml\nfoo --> bar : [[/docs/edge]]\n@enduml';

    expect(attachDiagramLinks(root, extractSourceLinks(source))).toBe(1);
  });

  it('attaches nothing when a link cannot be correlated', () => {
    const root = svgRoot(
      '<g class="entity" data-qualified-name="OTHER" data-source-line="374"><text>o</text></g>',
    );
    const source = '@startuml\ncomponent "X" as MISSING [[/docs/x]]\n@enduml';

    expect(attachDiagramLinks(root, extractSourceLinks(source))).toBe(0);
    expect(anchors(root)).toHaveLength(0);
  });

  it('never nests anchors, so an element cannot become double-linked', () => {
    const root = svgRoot(
      '<g class="entity" data-qualified-name="C" data-source-line="1"><text>C</text></g>',
    );
    const links = extractSourceLinks('@startuml\ncomponent C [[/docs/c]]\n@enduml');

    attachDiagramLinks(root, links);
    attachDiagramLinks(root, links);

    expect(anchors(root)).toHaveLength(1);
  });
});

describe('detachDiagramLinks', () => {
  it('unwraps synthesized anchors and leaves the elements in place', () => {
    const root = svgRoot(
      '<g class="entity" data-qualified-name="C" data-source-line="1"><text>C</text></g>',
    );
    attachDiagramLinks(root, extractSourceLinks('@startuml\ncomponent C [[/docs/c]]\n@enduml'));
    expect(anchors(root)).toHaveLength(1);

    detachDiagramLinks(root);

    expect(anchors(root)).toHaveLength(0);
    expect(root.querySelector('[data-qualified-name="C"]')).not.toBeNull();
  });

  it('leaves engine-native anchors alone', () => {
    const root = svgRoot('<a href="https://example.com"><text>native</text></a>');
    detachDiagramLinks(root);
    expect(root.querySelector('a')).not.toBeNull();
  });
});
