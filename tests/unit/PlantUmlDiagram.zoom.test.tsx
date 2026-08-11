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

/**
 * Renders and waits for the diagram to be ready **and for the zoom hook to have taken hold**.
 *
 * `data-plantuml-status="ready"` is written during the render commit, but `useZoomPan` attaches
 * its listeners and writes the initial transform from *passive* effects, which React flushes
 * afterwards. Returning on the attribute alone let a test act on the viewport in between: a
 * dispatched wheel event found no listener, and a zoom set before the reset effect ran was
 * immediately overwritten with the identity transform. Both showed up on CI as a scale that
 * stubbornly stayed at 1.
 *
 * The inline transform is the signal to wait on because only the hook ever writes it — React
 * renders no `style` on the layer, so a non-empty value cannot come from anywhere else.
 */
async function renderReady(props: Parameters<typeof PlantUmlDiagram>[0] = {source: SOURCE}) {
  const result = render(<PlantUmlDiagram {...props} />);
  scrollIntoView();
  await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-status', 'ready'));
  // Absent when the diagram opted out of zoom, which is a state several tests render on purpose.
  if (document.querySelector('[data-plantuml-zoom]')) {
    await waitFor(() => expect(layer().style.transform).not.toBe(''));
  }
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
  // The maximize overlay writes to body styles; jsdom keeps them between tests.
  document.body.style.overflow = '';
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

  it('keeps the diagram the only svg inside the role="img" container', async () => {
    // The documented selector is `div[role="img"] > svg`, and it has to stay unambiguous:
    // the toolbar's icons are SVG too, but they live outside this subtree.
    await renderReady();

    const canvas = figure().querySelector('div[role="img"]') as HTMLElement;
    expect(canvas.querySelectorAll('svg')).toHaveLength(1);
    expect(canvas.querySelector(':scope > svg')).not.toBeNull();
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
    expect(screen.getByRole('button', {name: 'Maximize diagram'})).toBeInTheDocument();
  });

  it('draws every control as SVG rather than as a font character', async () => {
    // `⛶` U+26F6 has no glyph in any font a stock Linux desktop ships, so the maximize
    // control rendered as a tofu box; the others only worked because DejaVu Sans happened to
    // be installed. See issue #21.
    await renderReady();

    for (const name of ['Zoom in', 'Zoom out', 'Reset zoom', 'Maximize diagram']) {
      const button = screen.getByRole('button', {name});
      expect(button.querySelector('svg'), `${name} should be drawn`).toBeInTheDocument();
      // Nothing left for a missing font to fail to draw. This is the assertion that stops a
      // later refactor from quietly reintroducing a symbol character.
      expect(button.textContent ?? '').toMatch(/^[\x20-\x7e]*$/);
    }
  });

  it('keeps the icons out of the accessibility tree', async () => {
    await renderReady();

    // The button's `aria-label` is the accessible name; the drawing must add nothing.
    const icon = screen.getByRole('button', {name: 'Maximize diagram'}).querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveAttribute('focusable', 'false');
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
    await waitFor(() => expect(Number(zoomLevel())).toBeGreaterThan(1));
    expect(layer().style.transform).toMatch(/scale\(/);
  });

  it('zooms out on ctrl + wheel downwards', async () => {
    await renderReady();
    wheel(viewport(), {deltaY: 120, ctrlKey: true});
    // Polled rather than asserted outright: the write is synchronous, but this ran ahead of
    // the hook's own effects on a loaded CI machine and read the untouched initial 1. A wrong
    // value still fails — it just fails after the poll gives up rather than instantly.
    await waitFor(() => expect(Number(zoomLevel())).toBeLessThan(1));
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

  it('offers maximize everywhere, with no capability detection', async () => {
    await renderReady();
    // An in-page overlay works in every browser, including iOS Safari where element
    // fullscreen does not exist, so the control is never hidden.
    const button = screen.getByRole('button', {name: 'Maximize diagram'});
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-pressed', 'false');
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

describe('not resetting the view', () => {
  it('keeps the zoom across a re-render that changes nothing about the picture', async () => {
    // Resets must have exactly one owner. When the listener effect also reset on attach, any
    // re-attach for an unrelated reason threw away a zoom the reader had chosen.
    const {rerender} = await renderReady();
    act(() => screen.getByRole('button', {name: 'Zoom in'}).click());
    expect(zoomLevel()).toBe('1.25');

    rerender(<PlantUmlDiagram source={SOURCE} />);
    rerender(<PlantUmlDiagram source={SOURCE} title="a caption appears" />);

    expect(zoomLevel()).toBe('1.25');
  });

  it('keeps the zoom while maximizing and restoring', async () => {
    await renderReady();
    act(() => screen.getByRole('button', {name: 'Zoom in'}).click());

    act(() => screen.getByRole('button', {name: 'Maximize diagram'}).click());
    act(() => screen.getByRole('button', {name: 'Maximize diagram'}).click());

    await waitFor(() => expect(zoomLevel()).toBe('1.25'));
  });

  it('sets the zoom attribute without React also owning it', async () => {
    // Rendering `data-plantuml-zoom` from JSX as well would give the attribute two owners.
    await renderReady();
    expect(viewport()).toHaveAttribute('data-plantuml-zoom', '1');

    act(() => screen.getByRole('button', {name: 'Zoom in'}).click());
    expect(viewport()).toHaveAttribute('data-plantuml-zoom', '1.25');
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

describe('maximizing', () => {
  const maximizeButton = () => screen.getByRole('button', {name: 'Maximize diagram'});

  it('fills the viewport without using the Fullscreen API', async () => {
    // The Fullscreen API took the whole browser window fullscreen in Firefox and let the
    // page show through its backdrop; an in-page overlay does neither.
    const requestFullscreen = vi.fn();
    Element.prototype.requestFullscreen = requestFullscreen;

    await renderReady();
    act(() => maximizeButton().click());

    expect(figure()).toHaveAttribute('data-plantuml-maximized', 'true');
    expect(maximizeButton()).toHaveAttribute('aria-pressed', 'true');
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it('locks page scrolling while maximized and restores it after', async () => {
    document.body.style.overflow = 'auto';
    await renderReady();

    act(() => maximizeButton().click());
    expect(document.body.style.overflow).toBe('hidden');

    act(() => maximizeButton().click());
    expect(document.body.style.overflow).toBe('auto');
  });

  it('closes on Escape', async () => {
    await renderReady();
    act(() => maximizeButton().click());
    expect(figure()).toHaveAttribute('data-plantuml-maximized', 'true');

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    });

    expect(figure()).not.toHaveAttribute('data-plantuml-maximized');
    expect(document.body.style.overflow).toBe('');
  });

  it('restores the previous view when un-maximized', async () => {
    await renderReady();
    act(() => screen.getByRole('button', {name: 'Zoom in'}).click());
    expect(zoomLevel()).toBe('1.25');

    act(() => maximizeButton().click());
    act(() => maximizeButton().click());

    // `waitFor`, not a bare assertion: the round trip settles through an effect cleanup, and
    // asserting synchronously assumed a flush order that held locally but not on every runner.
    // The expected value is unchanged, so a genuinely wrong transform still fails.
    await waitFor(() => expect(zoomLevel()).toBe('1.25'));
  });

  it('does not leave the page scroll-locked when unmounted while maximized', async () => {
    document.body.style.overflow = 'auto';
    const {unmount} = await renderReady();
    act(() => maximizeButton().click());
    expect(document.body.style.overflow).toBe('hidden');

    unmount();

    expect(document.body.style.overflow).toBe('auto');
  });
});
