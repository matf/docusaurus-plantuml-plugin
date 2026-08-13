import {act, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import PlantUmlDiagram from '../../src/theme/PlantUmlDiagram/index.js';
import {setStubOptions} from '../stubs/state.js';

const {renderDiagramMock} = vi.hoisted(() => ({renderDiagramMock: vi.fn()}));
vi.mock('../../src/runtime/renderer.js', () => ({renderDiagram: renderDiagramMock}));

const SOURCE = '@startuml\nAlice -> Bob : Hello\n@enduml';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><text>Hello</text></svg>';

const figure = () => document.querySelector('[data-plantuml-diagram]') as HTMLElement;
const viewport = () => document.querySelector('[data-plantuml-zoom]') as HTMLElement;
const layer = () => viewport().firstElementChild as HTMLElement;
const panel = () => document.querySelector('[data-plantuml-minimap]');
/** The minimap's structure is canvas-first; the canvas is layer-then-rect. */
const mapCanvas = () => panel()?.firstElementChild as HTMLElement;
const mapLayer = () => mapCanvas().firstElementChild as HTMLElement;
const mapRect = () => mapCanvas().lastElementChild as HTMLElement;

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
  if (document.querySelector('[data-plantuml-zoom]')) {
    await waitFor(() => expect(layer().style.transform).not.toBe(''));
  }
  return result;
}

/**
 * jsdom lays nothing out, so the sizes the zoom hook measures are stubbed directly:
 * an 800×600 diagram in a 400×300 viewport.
 */
function stubSizes(): void {
  Object.defineProperty(viewport(), 'clientWidth', {configurable: true, value: 400});
  Object.defineProperty(viewport(), 'clientHeight', {configurable: true, value: 300});
  Object.defineProperty(layer(), 'offsetWidth', {configurable: true, value: 800});
  Object.defineProperty(layer(), 'offsetHeight', {configurable: true, value: 600});
}

/**
 * jsdom has no PointerEvent; the handler's `isPrimary` and `pointerId` checks are satisfied
 * by planting the fields on a MouseEvent, exactly as a browser would populate them.
 */
function pointer(target: Element, type: string, clientX: number, clientY: number): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX,
    clientY,
  });
  Object.defineProperty(event, 'isPrimary', {value: true});
  Object.defineProperty(event, 'pointerId', {value: 1});
  act(() => {
    target.dispatchEvent(event);
  });
}

const toggle = () => screen.getByRole('button', {name: /(Show|Hide) minimap/});

beforeEach(() => {
  renderDiagramMock.mockReset();
  renderDiagramMock.mockResolvedValue(SVG);
  installObservers();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the toggle', () => {
  it('offers a minimap toggle on zoomable diagrams', async () => {
    await renderReady();

    const button = toggle();
    expect(button).toHaveAccessibleName('Show minimap');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    // Drawn, not typed — the rule issue #21 established for every control.
    expect(button.querySelector('svg')).toBeInTheDocument();
    expect(panel()).toBeNull();
  });

  it('offers no minimap without zoom, which is what would drive it', async () => {
    setStubOptions({zoom: false});
    await renderReady();
    expect(screen.queryByRole('button', {name: /minimap/i})).toBeNull();
  });

  it('opens and closes the map', async () => {
    await renderReady();

    act(() => toggle().click());
    expect(figure()).toHaveAttribute('data-plantuml-minimap-open', 'true');
    expect(panel()).not.toBeNull();
    expect(toggle()).toHaveAccessibleName('Hide minimap');

    act(() => toggle().click());
    expect(figure()).not.toHaveAttribute('data-plantuml-minimap-open');
    expect(panel()).toBeNull();
  });

  it('closes from the map’s own close button', async () => {
    await renderReady();
    act(() => toggle().click());

    act(() => screen.getByRole('button', {name: 'Close minimap'}).click());

    expect(panel()).toBeNull();
    expect(figure()).not.toHaveAttribute('data-plantuml-minimap-open');
  });

  it('disappears with the picture when the source view is flipped on', async () => {
    await renderReady();
    act(() => toggle().click());
    expect(panel()).not.toBeNull();

    act(() => screen.getByRole('button', {name: 'Show diagram source'}).click());

    expect(panel()).toBeNull();
    expect(screen.queryByRole('button', {name: /minimap/i})).toBeNull();
  });
});

describe('the map', () => {
  it('keeps the diagram copy out of the accessibility tree', async () => {
    // The map is a duplicate view of a diagram whose real viewport is already
    // keyboard-operable; announcing a second copy would add noise, not capability.
    await renderReady();
    act(() => toggle().click());

    expect(mapCanvas()).toHaveAttribute('aria-hidden', 'true');
    expect(mapCanvas().querySelector('svg')).not.toBeNull();
    expect(mapCanvas().querySelectorAll('button')).toHaveLength(0);
  });

  it('scales the copy into the map box and marks the visible part', async () => {
    await renderReady();
    stubSizes();
    act(() => toggle().click());

    // 800×600 into a 200×150 box is exactly quarter scale…
    expect(mapCanvas().style.width).toBe('200px');
    expect(mapCanvas().style.height).toBe('150px');
    expect(mapLayer().style.transform).toBe('scale(0.25)');
    // …and a 400×300 viewport at 100% covers a quarter-scaled 100×75 of it.
    expect(mapRect().style.width).toBe('100px');
    expect(mapRect().style.height).toBe('75px');
    expect(mapRect().style.left).toBe('0px');
    expect(mapRect().style.top).toBe('0px');
  });

  it('shrinks the rectangle as the reader zooms in', async () => {
    await renderReady();
    stubSizes();
    act(() => toggle().click());

    act(() => screen.getByRole('button', {name: 'Zoom in'}).click());

    // 400 viewport px at 1.25× show 320 content px; quarter scale makes that 80.
    expect(mapRect().style.width).toBe('80px');
  });

  it('centres the view on a pressed point', async () => {
    await renderReady();
    stubSizes();
    act(() => toggle().click());

    // The map's rect is at (0,0) in jsdom, so client coordinates are map coordinates.
    // (100,75) at quarter scale is content point (400,300); centring a 400×300 viewport
    // there puts the transform at (-200,-150).
    pointer(mapCanvas(), 'pointerdown', 100, 75);

    expect(layer().style.transform).toBe('translate(-200px, -150px) scale(1)');
  });

  it('keeps panning while the pointer drags across the map', async () => {
    await renderReady();
    stubSizes();
    act(() => toggle().click());

    pointer(mapCanvas(), 'pointerdown', 100, 75);
    pointer(mapCanvas(), 'pointermove', 50, 75);
    // Content point (200,300): x clamps to 0 because the viewport centre cannot go past it.
    expect(layer().style.transform).toBe('translate(0px, -150px) scale(1)');

    pointer(mapCanvas(), 'pointerup', 50, 75);
    // The gesture is over; a later move without a press must not pan.
    pointer(mapCanvas(), 'pointermove', 100, 75);
    expect(layer().style.transform).toBe('translate(0px, -150px) scale(1)');
  });
});
