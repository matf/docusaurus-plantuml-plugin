import {describe, expect, it} from 'vitest';

import {
  findDeeplinkTarget,
  parseDiagramHash,
  resetDeeplinkScroll,
  claimDeeplinkScroll,
} from '../../src/theme/PlantUmlDiagram/deeplink.js';

describe('parseDiagramHash', () => {
  it('extracts the target from a diagram hash', () => {
    expect(parseDiagramHash('#graph?highlight-node=MYNOTE-123')).toBe('MYNOTE-123');
  });

  it('decodes percent-encoding, including %0A newlines for multiline labels', () => {
    expect(parseDiagramHash('#graph?highlight-node=caminus-process-archive%0A12345')).toBe(
      'caminus-process-archive\n12345',
    );
    expect(parseDiagramHash('#graph?highlight-node=MyEvent%0A%5Bvariant%5D')).toBe(
      'MyEvent\n[variant]',
    );
  });

  it('ignores ordinary heading anchors', () => {
    expect(parseDiagramHash('#installation')).toBeNull();
    expect(parseDiagramHash('#graph')).toBeNull();
    expect(parseDiagramHash('')).toBeNull();
  });

  it('ignores a diagram hash naming no node', () => {
    expect(parseDiagramHash('#graph?highlight-node=')).toBeNull();
    expect(parseDiagramHash('#graph?other-param=x')).toBeNull();
  });

  it('reads its parameter regardless of other parameters around it', () => {
    expect(parseDiagramHash('#graph?zoom=fit&highlight-node=A')).toBe('A');
  });
});

/** Builds a detached SVG root the matcher can search, jsdom-style. */
function svgRoot(inner: string): Element {
  const host = document.createElement('div');
  host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${inner}</svg>`;
  return host;
}

describe('findDeeplinkTarget', () => {
  it('resolves an explicit id first', () => {
    const root = svgRoot(
      '<g id="REACTION-1234"><text>anything</text></g><text>REACTION-1234</text>',
    );
    const match = findDeeplinkTarget(root, 'REACTION-1234');
    // The id wins over the text that merely contains the target.
    expect(match?.elements).toHaveLength(1);
    expect(match?.anchor.getAttribute('id')).toBe('REACTION-1234');
  });

  it('resolves an id that a bare #-selector could not address', () => {
    const root = svgRoot('<g id="1234-starts-with-digit"><text>x</text></g>');
    expect(findDeeplinkTarget(root, '1234-starts-with-digit')?.anchor.tagName).toBe('g');
  });

  it('resolves a PlantUML alias through data-qualified-name', () => {
    // `component "Command handler" as MESSAGE_MY_GREAT_COMMAND` — the alias never appears
    // in the picture, but the engine writes it onto the entity group.
    const root = svgRoot(
      '<g class="entity" data-qualified-name="MESSAGE_MY_GREAT_COMMAND">' +
        '<rect/><text>Command handler</text></g>',
    );
    const match = findDeeplinkTarget(root, 'MESSAGE_MY_GREAT_COMMAND');
    expect(match?.anchor.getAttribute('data-qualified-name')).toBe('MESSAGE_MY_GREAT_COMMAND');
  });

  it('resolves an aliased note the same way, which makes notes addressable', () => {
    const root = svgRoot(
      '<g class="entity" data-qualified-name="REACTIONNOTE1"><path/><text>details</text></g>',
    );
    expect(findDeeplinkTarget(root, 'REACTIONNOTE1')?.anchor.tagName).toBe('g');
  });

  it('prefers the alias over text that merely contains the target', () => {
    const root = svgRoot(
      '<text>ARCHIVE mentioned in prose</text>' +
        '<g class="entity" data-qualified-name="ARCHIVE"><text>The archive</text></g>',
    );
    expect(findDeeplinkTarget(root, 'ARCHIVE')?.anchor.tagName).toBe('g');
  });

  it('resolves a self-anchor by its href hash', () => {
    const root = svgRoot(
      '<a href="#graph?highlight-node=MESSAGE-MY-GREAT-COMMAND"><rect/><text>Cmd</text></a>',
    );
    const match = findDeeplinkTarget(root, 'MESSAGE-MY-GREAT-COMMAND');
    expect(match?.anchor.tagName).toBe('a');
  });

  it('resolves a self-anchor whose link also navigates somewhere', () => {
    // The href may point at another page and still carry the id in its hash.
    const root = svgRoot(
      '<a href="/docs/reactions/1234#graph?highlight-node=REACTION-1234"><text>R</text></a>',
    );
    expect(findDeeplinkTarget(root, 'REACTION-1234')?.anchor.tagName).toBe('a');
  });

  it('resolves a Graphviz-style xlink:href self-anchor', () => {
    const root = svgRoot(
      '<a xlink:href="#graph?highlight-node=NODE-7"><ellipse/><text>n7</text></a>',
    );
    expect(findDeeplinkTarget(root, 'NODE-7')?.anchor.tagName).toBe('a');
  });

  it('does not treat an unrelated link as a self-anchor', () => {
    const root = svgRoot('<a href="https://example.com/REACTION-1234"><text>ext</text></a>');
    expect(findDeeplinkTarget(root, 'REACTION-1234')).toBeNull();
  });

  it('resolves a Graphviz node by its name in the title', () => {
    const root = svgRoot(
      '<g class="node"><title>archive</title><text>caminus-process-archive</text></g>',
    );
    const match = findDeeplinkTarget(root, 'archive');
    expect(match?.anchor.getAttribute('class')).toBe('node');
  });

  it('matches a multiline label against consecutive text lines', () => {
    const root = svgRoot(
      '<text>MyEvent</text><text>[other]</text>' + '<text>MyEvent</text><text>[variant]</text>',
    );
    const match = findDeeplinkTarget(root, 'MyEvent\n[variant]');
    // The second MyEvent, whose *following* line matches too — not the first.
    expect(match?.elements.map((element) => element.textContent)).toEqual(['MyEvent', '[variant]']);
    expect(match?.anchor.textContent).toBe('MyEvent');
  });

  it('does not join lines across non-consecutive positions', () => {
    const root = svgRoot('<text>MyEvent</text><text>noise</text><text>[variant]</text>');
    expect(findDeeplinkTarget(root, 'MyEvent\n[variant]')).toBeNull();
  });

  it('keeps a multiline window inside one PlantUML entity', () => {
    // Same shape as the Graphviz case, with the grouping PlantUML actually emits.
    const root = svgRoot(
      '<g class="entity" data-qualified-name="a"><text>MyEvent</text></g>' +
        '<g class="entity" data-qualified-name="b"><text>[variant]</text></g>' +
        '<g class="entity" data-qualified-name="c"><text>MyEvent</text><text>[variant]</text></g>',
    );
    const match = findDeeplinkTarget(root, 'MyEvent\n[variant]');
    expect(match?.elements[0]?.parentElement?.getAttribute('data-qualified-name')).toBe('c');
  });

  it('keeps a multiline window inside one Graphviz node', () => {
    // The first node ends with the first line and the second starts with the second line;
    // without the per-node scope the window would falsely bridge them.
    const root = svgRoot(
      '<g class="node"><title>a</title><text>x</text><text>MyEvent</text></g>' +
        '<g class="node"><title>b</title><text>[variant]</text></g>' +
        '<g class="node"><title>c</title><text>MyEvent</text><text>[variant]</text></g>',
    );
    const match = findDeeplinkTarget(root, 'MyEvent\n[variant]');
    expect(match?.elements[0]?.parentElement?.querySelector('title')?.textContent).toBe('c');
  });

  it('matches the unique half of a multiline label as a substring', () => {
    const root = svgRoot(
      '<text>caminus-process-archive</text><text>67890</text>' +
        '<text>caminus-process-archive</text><text>12345</text>',
    );
    const match = findDeeplinkTarget(root, '12345');
    expect(match?.elements.map((element) => element.textContent)).toEqual(['12345']);
  });

  it('matches a single line case-insensitively', () => {
    const root = svgRoot('<text>WvsNctsGoodsDeclarationActivated</text>');
    expect(findDeeplinkTarget(root, 'goodsdeclaration')?.anchor.tagName).toBe('text');
  });

  it('returns null when nothing matches', () => {
    const root = svgRoot('<text>Alpha</text>');
    expect(findDeeplinkTarget(root, 'Beta')).toBeNull();
    expect(findDeeplinkTarget(root, 'Alpha\nBeta')).toBeNull();
  });
});

describe('claimDeeplinkScroll', () => {
  it('scrolls only the first claimant for a given target', () => {
    resetDeeplinkScroll();
    const calls: string[] = [];
    const figure = (name: string) =>
      ({scrollIntoView: () => calls.push(name)}) as unknown as Element;

    claimDeeplinkScroll('NODE-1', figure('first'));
    claimDeeplinkScroll('NODE-1', figure('second'));

    expect(calls).toEqual(['first']);
  });

  it('scrolls again for a different target', () => {
    resetDeeplinkScroll();
    const calls: string[] = [];
    const figure = (name: string) =>
      ({scrollIntoView: () => calls.push(name)}) as unknown as Element;

    claimDeeplinkScroll('NODE-1', figure('first'));
    claimDeeplinkScroll('NODE-2', figure('other'));

    expect(calls).toEqual(['first', 'other']);
  });
});
