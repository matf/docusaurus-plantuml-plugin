import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import PlantUmlDiagram from '../../src/theme/PlantUmlDiagram/index.js';
import {setStubOptions, stubState} from '../stubs/state.js';

const {renderDiagramMock} = vi.hoisted(() => ({renderDiagramMock: vi.fn()}));
vi.mock('../../src/runtime/renderer.js', () => ({renderDiagram: renderDiagramMock}));

const SOURCE = '@startuml\nAlice -> Bob : Hello\n@enduml';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><text>Hello</text></svg>';

const figure = () => document.querySelector('[data-plantuml-diagram]') as HTMLElement;
const viewport = () => document.querySelector('[data-plantuml-zoom]') as HTMLElement;
const layer = () => viewport().firstElementChild as HTMLElement;
const zoomLevel = () => viewport().getAttribute('data-plantuml-zoom');

interface FakeObserver {
  callback: IntersectionObserverCallback;
  disconnected: boolean;
}
let observers: FakeObserver[] = [];
let resizeObserverDisconnects = 0;

function installObservers(): void {
  observers = [];
  resizeObserverDisconnects = 0;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      readonly #record: FakeObserver;
      constructor(callback: IntersectionObserverCallback) {
        this.#record = {callback, disconnected: false};
        observers.push(this.#record);
      }
      observe() {}
      disconnect() {
        this.#record.disconnected = true;
      }
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
      disconnect() {
        resizeObserverDisconnects += 1;
      }
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

/** Renders and waits for the diagram to reach the ready state. */
async function renderReady(props: Parameters<typeof PlantUmlDiagram>[0] = {source: SOURCE}) {
  const result = render(<PlantUmlDiagram {...props} />);
  scrollIntoView();
  await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-status', 'ready'));
  return result;
}

function wheel(target: Element, init: WheelEventInit): boolean {
  const event = new WheelEvent('wheel', {bubbles: true, cancelable: true, ...init});
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

beforeEach(() => {
  renderDiagramMock.mockReset();
  renderDiagramMock.mockResolvedValue(SVG);
  installObservers();
  // jsdom implements none of the pointer-capture API.
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('enabling zoom', () => {
  it('is on by default', async () => {
    await renderReady();

    expect(figure()).toHaveAttribute('data-plantuml-interactive', 'true');
    expect(viewport()).toBeInTheDocument();
    expect(viewport().tabIndex).toBe(0);
    expect(screen.getByRole('group', {name: /zoom controls/})).toBeInTheDocument();
  });

  it('renders the pre-zoom markup when the option is off', async () => {
    setStubOptions({zoom: false});
    await renderReady();

    expect(figure()).not.toHaveAttribute('data-plantuml-interactive');
    expect(document.querySelector('[data-plantuml-zoom]')).toBeNull();
    expect(screen.queryByRole('group', {name: /zoom controls/})).toBeNull();
    // The canvas is a direct child of the figure again, exactly as before zoom existed.
    expect(figure().firstElementChild).toHaveAttribute('role', 'img');
  });

  it('lets a fence flag disable zoom for one diagram', async () => {
    await renderReady({source: SOURCE, zoom: false});

    expect(figure()).not.toHaveAttribute('data-plantuml-interactive');
    expect(screen.queryByRole('group', {name: /zoom controls/})).toBeNull();
  });

  it('lets a fence flag enable zoom when the option is off', async () => {
    setStubOptions({zoom: false});
    await renderReady({source: SOURCE, zoom: true});

    expect(figure()).toHaveAttribute('data-plantuml-interactive', 'true');
    expect(screen.getByRole('group', {name: /zoom controls/})).toBeInTheDocument();
  });

  it('shows no controls before the diagram is ready', () => {
    render(<PlantUmlDiagram source={SOURCE} />);

    expect(figure()).toHaveAttribute('data-plantuml-status', 'idle');
    expect(screen.queryByRole('group', {name: /zoom controls/})).toBeNull();
    expect(document.querySelector('[data-plantuml-zoom]')).toBeNull();
  });

  it('shows no controls in the error state', async () => {
    renderDiagramMock.mockRejectedValue(new Error('broken'));
    render(<PlantUmlDiagram source={SOURCE} />);
    scrollIntoView();

    await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-status', 'error'));
    // Filtered by name: the error panel's <details> is itself an implicit `group`.
    expect(screen.queryByRole('group', {name: /zoom controls/})).toBeNull();
    expect(document.querySelector('[data-plantuml-zoom]')).toBeNull();
  });
});

describe('accessible structure', () => {
  it('keeps the SVG inside the role="img" container', async () => {
    await renderReady();

    const canvas = figure().querySelector('div[role="img"]') as HTMLElement;
    expect(canvas.querySelector('svg')).not.toBeNull();
    expect(canvas.getAttribute('aria-label')).toBe('PlantUML diagram');
  });

  it('puts no interactive control inside the role="img" subtree', async () => {
    // `role="img"` makes its subtree opaque to assistive technology, so a button in there
    // would be invisible to screen-reader users.
    await renderReady();

    const canvas = figure().querySelector('div[role="img"]') as HTMLElement;
    expect(canvas.querySelectorAll('button')).toHaveLength(0);
    expect(within(canvas).queryByRole('group', {name: /zoom controls/})).toBeNull();
  });

  it('adds no extra svg element, which would break diagram counting', async () => {
    await renderReady();
    expect(figure().querySelectorAll('svg')).toHaveLength(1);
  });

  it('names the control group after the diagram', async () => {
    await renderReady({source: SOURCE, title: 'Order flow'});
    expect(screen.getByRole('group', {name: /zoom controls/})).toHaveAttribute(
      'aria-label',
      'Order flow zoom controls',
    );
  });

  it('exposes the controls as named buttons', async () => {
    await renderReady();

    expect(screen.getByRole('button', {name: 'Zoom in'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Zoom out'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Reset zoom'})).toBeInTheDocument();
  });

  it('describes the keyboard shortcuts without announcing them repeatedly', async () => {
    await renderReady();

    const hintId = viewport().getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    expect(document.getElementById(hintId as string)?.textContent).toMatch(/arrow keys to pan/i);
    // A live region would announce on every wheel tick.
    expect(figure().querySelectorAll('[aria-live]')).toHaveLength(0);
  });

  it('never disables a control, so no button state can go stale', async () => {
    await renderReady();
    for (const button of screen.getAllByRole('button')) {
      expect(button).not.toBeDisabled();
    }
  });
});

describe('wheel policy', () => {
  it('lets a plain wheel scroll the page', async () => {
    await renderReady();
    const before = layer().style.transform;

    const prevented = wheel(viewport(), {deltaY: -120});

    expect(prevented).toBe(false);
    expect(layer().style.transform).toBe(before);
    expect(zoomLevel()).toBe('1');
  });

  it('zooms on ctrl + wheel', async () => {
    await renderReady();

    const prevented = wheel(viewport(), {deltaY: -120, ctrlKey: true});

    expect(prevented).toBe(true);
    expect(Number(zoomLevel())).toBeGreaterThan(1);
    expect(layer().style.transform).toMatch(/scale\(/);
  });

  it('zooms out on ctrl + wheel downwards', async () => {
    await renderReady();
    wheel(viewport(), {deltaY: 120, ctrlKey: true});
    expect(Number(zoomLevel())).toBeLessThan(1);
  });

  it('ignores meta + wheel, which is the browser page zoom on macOS', async () => {
    await renderReady();

    const prevented = wheel(viewport(), {deltaY: -120, metaKey: true});

    expect(prevented).toBe(false);
    expect(zoomLevel()).toBe('1');
  });

  it('attaches no wheel handling when zoom is disabled', async () => {
    setStubOptions({zoom: false});
    await renderReady();

    const canvas = figure().querySelector('div[role="img"]') as HTMLElement;
    const event = new WheelEvent('wheel', {deltaY: -120, ctrlKey: true, cancelable: true});
    act(() => {
      canvas.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('controls', () => {
  it('zooms in by one step', async () => {
    await renderReady();

    act(() => screen.getByRole('button', {name: 'Zoom in'}).click());

    expect(zoomLevel()).toBe('1.25');
    expect(layer().style.transform).toMatch(/scale\(1\.25\)/);
  });

  it('updates the visible readout', async () => {
    await renderReady();
    act(() => screen.getByRole('button', {name: 'Zoom in'}).click());
    expect(figure().textContent).toContain('125%');
  });

  it('clamps at the minimum scale however often zoom out is pressed', async () => {
    await renderReady();
    const zoomOut = screen.getByRole('button', {name: 'Zoom out'});

    for (let i = 0; i < 25; i += 1) act(() => zoomOut.click());

    expect(zoomLevel()).toBe('0.25');
  });

  it('clamps at the maximum scale', async () => {
    await renderReady();
    const zoomIn = screen.getByRole('button', {name: 'Zoom in'});

    for (let i = 0; i < 40; i += 1) act(() => zoomIn.click());

    expect(zoomLevel()).toBe('8');
  });

  it('resets to 100%', async () => {
    await renderReady();
    act(() => screen.getByRole('button', {name: 'Zoom in'}).click());
    act(() => screen.getByRole('button', {name: 'Reset zoom'}).click());

    expect(zoomLevel()).toBe('1');
    expect(layer().style.transform).toBe('translate(0px, 0px) scale(1)');
  });

  it('offers fullscreen only where the browser supports it', async () => {
    await renderReady();
    // jsdom reports no fullscreen support, so the button must not be rendered at all.
    expect(screen.queryByRole('button', {name: 'Toggle fullscreen'})).toBeNull();
  });
});

describe('keyboard', () => {
  it.each([
    ['+', 'in'],
    ['=', 'in'],
  ])('zooms in on %s', async (key) => {
    await renderReady();
    fireEvent.keyDown(viewport(), {key});
    expect(Number(zoomLevel())).toBeGreaterThan(1);
  });

  it.each(['-', '_'])('zooms out on %s', async (key) => {
    await renderReady();
    fireEvent.keyDown(viewport(), {key});
    expect(Number(zoomLevel())).toBeLessThan(1);
  });

  it('resets on 0', async () => {
    await renderReady();
    fireEvent.keyDown(viewport(), {key: '+'});
    fireEvent.keyDown(viewport(), {key: '0'});
    expect(zoomLevel()).toBe('1');
  });

  it('handles the arrow keys', async () => {
    await renderReady();
    // `fireEvent` returns false when the handler called preventDefault.
    expect(fireEvent.keyDown(viewport(), {key: 'ArrowRight'})).toBe(false);
    expect(fireEvent.keyDown(viewport(), {key: 'ArrowLeft'})).toBe(false);
    expect(fireEvent.keyDown(viewport(), {key: 'ArrowUp'})).toBe(false);
    expect(fireEvent.keyDown(viewport(), {key: 'ArrowDown'})).toBe(false);
  });

  it('leaves modified arrow keys to the browser', async () => {
    await renderReady();
    expect(fireEvent.keyDown(viewport(), {key: 'ArrowRight', ctrlKey: true})).toBe(true);
    expect(fireEvent.keyDown(viewport(), {key: 'ArrowRight', metaKey: true})).toBe(true);
    expect(fireEvent.keyDown(viewport(), {key: 'ArrowRight', altKey: true})).toBe(true);
  });

  it('does not swallow keys it has no use for, so Tab still escapes', async () => {
    await renderReady();
    expect(fireEvent.keyDown(viewport(), {key: 'Tab'})).toBe(true);
    expect(fireEvent.keyDown(viewport(), {key: 'a'})).toBe(true);
  });
});

describe('resetting the view', () => {
  it('resets when the colour mode changes', async () => {
    // A cache hit can take the component ready -> ready without unmounting the layer, so the
    // reset cannot rely on the node being recreated.
    const {rerender} = await renderReady();
    act(() => screen.getByRole('button', {name: 'Zoom in'}).click());
    expect(zoomLevel()).toBe('1.25');

    stubState.colorMode = 'dark';
    rerender(<PlantUmlDiagram source={SOURCE} />);

    await waitFor(() => expect(zoomLevel()).toBe('1'));
  });

  it('resets when the diagram source changes', async () => {
    const {rerender} = await renderReady();
    act(() => screen.getByRole('button', {name: 'Zoom in'}).click());

    rerender(<PlantUmlDiagram source="@startuml\nA -> B\n@enduml" />);

    await waitFor(() => expect(zoomLevel()).toBe('1'));
  });
});

describe('lifecycle', () => {
  it('detaches every listener on unmount', async () => {
    const {unmount} = await renderReady();
    const detached = viewport();

    unmount();

    const event = new WheelEvent('wheel', {deltaY: -120, ctrlKey: true, cancelable: true});
    expect(() => detached.dispatchEvent(event)).not.toThrow();
    expect(event.defaultPrevented).toBe(false);
  });

  it('disconnects the ResizeObserver on unmount', async () => {
    const {unmount} = await renderReady();
    const before = resizeObserverDisconnects;
    unmount();
    expect(resizeObserverDisconnects).toBeGreaterThan(before);
  });

  it('still zooms when ResizeObserver is unavailable', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    await renderReady();

    act(() => screen.getByRole('button', {name: 'Zoom in'}).click());
    expect(zoomLevel()).toBe('1.25');
  });

  it('logs nothing across a mount, zoom and unmount cycle', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const {unmount} = await renderReady();
    act(() => screen.getByRole('button', {name: 'Zoom in'}).click());
    wheel(viewport(), {deltaY: -120, ctrlKey: true});
    unmount();

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
