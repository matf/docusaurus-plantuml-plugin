import {act, render, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import PlantUmlDiagram from '../../src/theme/PlantUmlDiagram/index.js';
import {resetDeeplinkScroll} from '../../src/theme/PlantUmlDiagram/deeplink.js';
import {setStubLocation} from '../stubs/router.js';
import {setStubOptions} from '../stubs/state.js';

const {renderDiagramMock} = vi.hoisted(() => ({renderDiagramMock: vi.fn()}));
vi.mock('../../src/runtime/renderer.js', () => ({renderDiagram: renderDiagramMock}));

const SOURCE = '@startuml\nAlpha -> Beta : hello\n@enduml';
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg">' +
  '<a href="#graph?highlight-node=REACTION-1234"><text>Reaction</text></a>' +
  '<text>caminus-process-archive</text><text>12345</text>' +
  '</svg>';

const figure = () => document.querySelector('[data-plantuml-diagram]') as HTMLElement;
const viewport = () => document.querySelector('[data-plantuml-zoom]') as HTMLElement;
const layer = () => viewport().firstElementChild as HTMLElement;
const focused = () => Array.from(document.querySelectorAll('[data-plantuml-focused-node]'));

interface FakeObserver {
  callback: IntersectionObserverCallback;
}
let observers: FakeObserver[] = [];
let scrolls = 0;

function installObservers(): void {
  observers = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        observers.push({callback});
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    },
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

function scrollIntoView(): void {
  act(() => {
    observers
      .at(-1)
      ?.callback([{isIntersecting: true} as IntersectionObserverEntry], {} as IntersectionObserver);
  });
}

async function renderReady(props: Parameters<typeof PlantUmlDiagram>[0] = {source: SOURCE}) {
  const result = render(<PlantUmlDiagram {...props} />);
  scrollIntoView();
  await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-status', 'ready'));
  if (document.querySelector('[data-plantuml-zoom]')) {
    await waitFor(() => expect(layer().style.transform).not.toBe(''));
  }
  return result;
}

/**
 * Drives a router navigation, the way a Docusaurus `<Link>` does: `history.pushState`
 * re-renders `useLocation` subscribers and fires no DOM event whatsoever.
 */
function navigate(hash: string): void {
  act(() => {
    setStubLocation({hash});
  });
}

beforeEach(() => {
  renderDiagramMock.mockReset();
  renderDiagramMock.mockResolvedValue(SVG);
  installObservers();
  resetDeeplinkScroll();
  scrolls = 0;
  Element.prototype.scrollIntoView = vi.fn(() => {
    scrolls += 1;
  });
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('arriving with a diagram hash', () => {
  it('marks the self-anchored node, scrolls to the figure and snaps to 100%', async () => {
    setStubLocation({hash: '#graph?highlight-node=REACTION-1234'});
    await renderReady();

    await waitFor(() => expect(focused()).toHaveLength(1));
    expect(focused()[0]?.tagName).toBe('a');
    expect(scrolls).toBe(1);
    expect(viewport()).toHaveAttribute('data-plantuml-zoom', '1');
  });

  it('matches loose text when no id or anchor claims the target', async () => {
    setStubLocation({hash: '#graph?highlight-node=12345'});
    await renderReady();

    await waitFor(() => expect(focused()).toHaveLength(1));
    expect(focused()[0]?.textContent).toBe('12345');
  });

  it('does nothing on a diagram without the node', async () => {
    setStubLocation({hash: '#graph?highlight-node=NO-SUCH-NODE'});
    await renderReady();

    expect(focused()).toHaveLength(0);
    expect(scrolls).toBe(0);
  });

  it('defeats lazy rendering, so a below-the-fold target still reacts', async () => {
    setStubLocation({hash: '#graph?highlight-node=REACTION-1234'});
    render(<PlantUmlDiagram source={SOURCE} />);

    // Deliberately no IntersectionObserver trigger: the hash alone must start the render.
    await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-status', 'ready'));
    await waitFor(() => expect(focused()).toHaveLength(1));
  });

  it('highlights and scrolls on a diagram that opted out of zoom, without panning', async () => {
    setStubOptions({zoom: false});
    setStubLocation({hash: '#graph?highlight-node=REACTION-1234'});
    await renderReady();

    await waitFor(() => expect(focused()).toHaveLength(1));
    expect(scrolls).toBe(1);
    expect(document.querySelector('[data-plantuml-zoom]')).toBeNull();
  });
});

describe('router navigations while the diagram stays mounted', () => {
  it('sweeps the highlight when a navigation drops the hash', async () => {
    // The bug this pins: a Docusaurus <Link> to the same page without a hash is a
    // pushState — no hashchange fires, yet the highlight must go.
    setStubLocation({hash: '#graph?highlight-node=REACTION-1234'});
    await renderReady();
    await waitFor(() => expect(focused()).toHaveLength(1));

    navigate('');

    await waitFor(() => expect(focused()).toHaveLength(0));
  });

  it('moves the highlight when a navigation names another node', async () => {
    setStubLocation({hash: '#graph?highlight-node=REACTION-1234'});
    await renderReady();
    await waitFor(() => expect(focused()).toHaveLength(1));

    navigate('#graph?highlight-node=12345');

    await waitFor(() => expect(focused()[0]?.textContent).toBe('12345'));
    expect(focused()).toHaveLength(1);
  });

  it('sweeps the highlight when a navigation lands on an ordinary anchor', async () => {
    setStubLocation({hash: '#graph?highlight-node=REACTION-1234'});
    await renderReady();
    await waitFor(() => expect(focused()).toHaveLength(1));

    navigate('#unrelated-heading');

    await waitFor(() => expect(focused()).toHaveLength(0));
  });

  it('reacts to a hash that arrives only after mounting', async () => {
    await renderReady();
    expect(focused()).toHaveLength(0);

    navigate('#graph?highlight-node=REACTION-1234');

    await waitFor(() => expect(focused()).toHaveLength(1));
  });

  it('scrolls again when the same deep link is followed a second time', async () => {
    // The scroll claim keys on the navigation, not the target: follow, clear, follow the
    // same link again — the second follow is a new history entry and must scroll too.
    setStubLocation({hash: '#graph?highlight-node=REACTION-1234'});
    await renderReady();
    await waitFor(() => expect(scrolls).toBe(1));

    navigate('');
    await waitFor(() => expect(focused()).toHaveLength(0));

    navigate('#graph?highlight-node=REACTION-1234');

    await waitFor(() => expect(focused()).toHaveLength(1));
    expect(scrolls).toBe(2);
  });
});
