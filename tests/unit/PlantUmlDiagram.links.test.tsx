import {act, render, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import PlantUmlDiagram from '../../src/theme/PlantUmlDiagram/index.js';
import {historyPushes} from '../stubs/router.js';

const {renderDiagramMock, renderGraphvizMock} = vi.hoisted(() => ({
  renderDiagramMock: vi.fn(),
  renderGraphvizMock: vi.fn(),
}));
vi.mock('../../src/runtime/renderer.js', () => ({renderDiagram: renderDiagramMock}));
vi.mock('../../src/runtime/graphvizRenderer.js', () => ({
  renderGraphvizDiagram: renderGraphvizMock,
}));

/** Source and SVG agree the way the real engine's output does: alias plus source line. */
const SOURCE =
  '@startuml\n' +
  'component "Order Service" as ORDER_SVC [[/docs/orders#graph?highlight-node=D1]]\n' +
  'component "Ext" as EXT [[https://example.com/ext]]\n' +
  '@enduml';
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg">' +
  '<g class="entity" data-qualified-name="ORDER_SVC" id="ent0001" data-source-line="1">' +
  '<rect/><text>Order Service</text></g>' +
  '<g class="entity" data-qualified-name="EXT" id="ent0002" data-source-line="2">' +
  '<rect/><text>Ext</text></g>' +
  '</svg>';

const GRAPHVIZ_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg">' +
  '<g class="node"><a href="/docs/orders#graph?highlight-node=D1"><ellipse/><text>go</text></a></g>' +
  '</svg>';

const figure = () => document.querySelector('[data-plantuml-diagram]') as HTMLElement;
const synthesized = () => document.querySelectorAll('a[data-plantuml-diagram-link]');

interface FakeObserver {
  callback: IntersectionObserverCallback;
}
let observers: FakeObserver[] = [];

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
  // `ready` is written during the render commit, but the navigation listener attaches from
  // a passive effect that React flushes afterwards — a click dispatched in between finds no
  // handler (it bit on Node 24's CI runners). The zoom hook's transform write happens in
  // the same synchronous flush, so once it is visible, every effect of the commit has run.
  const viewport = document.querySelector('[data-plantuml-zoom]');
  if (viewport) {
    await waitFor(() =>
      expect((viewport.firstElementChild as HTMLElement).style.transform).not.toBe(''),
    );
  }
  return result;
}

function click(target: Element): MouseEvent {
  const event = new MouseEvent('click', {bubbles: true, cancelable: true, button: 0});
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  renderDiagramMock.mockReset();
  renderDiagramMock.mockResolvedValue(SVG);
  renderGraphvizMock.mockReset();
  renderGraphvizMock.mockResolvedValue(GRAPHVIZ_SVG);
  installObservers();
  // A routed click lands on a hash the deep-link hook reacts to; jsdom lacks the scroll.
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('synthesized PlantUML links', () => {
  it('wraps the linked entities in real anchors', async () => {
    await renderReady();

    expect(synthesized()).toHaveLength(2);
    const anchor = synthesized()[0] as Element;
    expect(anchor.getAttribute('href')).toBe('/docs/orders#graph?highlight-node=D1');
    expect(anchor.querySelector('[data-qualified-name="ORDER_SVC"]')).not.toBeNull();
  });

  it('synthesizes nothing on a source without links', async () => {
    renderDiagramMock.mockResolvedValue(SVG);
    await renderReady({source: '@startuml\ncomponent "X" as ORDER_SVC\n@enduml'});
    expect(synthesized()).toHaveLength(0);
  });

  it('synthesizes nothing for Graphviz, whose links the engine emits itself', async () => {
    await renderReady({source: 'digraph { a }', engine: 'graphviz'});
    expect(synthesized()).toHaveLength(0);
    // The native anchor is untouched.
    expect(document.querySelector('svg a')).not.toBeNull();
  });
});

describe('navigating in-diagram links', () => {
  it('routes an internal link through history, baseUrl included', async () => {
    await renderReady();

    const event = click(synthesized()[0] as Element);

    expect(event.defaultPrevented).toBe(true);
    // The stub site lives under /plantuml-test/, exactly like the e2e fixture.
    expect(historyPushes).toEqual(['/plantuml-test/docs/orders#graph?highlight-node=D1']);
  });

  it('routes a Graphviz-native internal link the same way', async () => {
    await renderReady({source: 'digraph { a }', engine: 'graphviz'});

    const event = click(document.querySelector('svg a') as Element);

    expect(event.defaultPrevented).toBe(true);
    expect(historyPushes).toEqual(['/plantuml-test/docs/orders#graph?highlight-node=D1']);
  });

  it('leaves an external link to the browser', async () => {
    await renderReady();

    const event = click(synthesized()[1] as Element);

    expect(event.defaultPrevented).toBe(false);
    expect(historyPushes).toEqual([]);
  });

  it('leaves modified clicks to the browser', async () => {
    await renderReady();
    const anchor = synthesized()[0] as Element;

    const event = new MouseEvent('click', {bubbles: true, cancelable: true, ctrlKey: true});
    act(() => {
      anchor.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(historyPushes).toEqual([]);
  });
});
