import {act, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import PlantUmlDiagram from '../../src/theme/PlantUmlDiagram/index.js';
import {PlantUmlError} from '../../src/runtime/errors.js';
import {setStubOptions} from '../stubs/state.js';

const {renderDiagramMock, renderGraphvizMock} = vi.hoisted(() => ({
  renderDiagramMock: vi.fn(),
  renderGraphvizMock: vi.fn(),
}));
vi.mock('../../src/runtime/renderer.js', () => ({renderDiagram: renderDiagramMock}));
vi.mock('../../src/runtime/graphvizRenderer.js', () => ({
  renderGraphvizDiagram: renderGraphvizMock,
}));

const SOURCE = '@startuml\nAlice -> Bob : Hello\n@enduml';
const DOT = 'digraph {a -> b}';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><text>Hello</text></svg>';

const figure = () => document.querySelector('[data-plantuml-diagram]') as HTMLElement;
const toggle = () => screen.getByRole('button', {name: /diagram source/i});
const panel = () => document.querySelector('pre') as HTMLElement | null;

let observers: IntersectionObserverCallback[] = [];
let writeText: ReturnType<typeof vi.fn>;

function installObservers(): void {
  observers = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        observers.push(callback);
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
    observers.at(-1)?.(
      [{isIntersecting: true} as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}

/**
 * jsdom has no clipboard, and `userEvent.setup()` installs a stub of its own — so a test that
 * wants to control `writeText` has to install it *after* setup, or user-event's stub wins and
 * the component never sees the mock. This helper keeps that ordering in one place.
 */
function setupUser(clipboard?: (() => Promise<void>) | null) {
  const user = userEvent.setup();
  if (clipboard === null) {
    vi.stubGlobal('navigator', {...navigator, clipboard: undefined});
  } else {
    writeText = vi.fn(clipboard ?? (() => Promise.resolve()));
    vi.stubGlobal('navigator', {...navigator, clipboard: {writeText}});
  }
  return user;
}

async function renderReady(props: Record<string, unknown> = {}) {
  const result = render(<PlantUmlDiagram source={SOURCE} {...props} />);
  scrollIntoView();
  await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-status', 'ready'));
  return result;
}

beforeEach(() => {
  renderDiagramMock.mockReset();
  renderDiagramMock.mockResolvedValue(SVG);
  renderGraphvizMock.mockReset();
  renderGraphvizMock.mockResolvedValue(SVG);
  installObservers();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('offering the source', () => {
  it('adds a source control to the toolbar by default', async () => {
    await renderReady();

    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    // It belongs to the same control group as the zoom buttons.
    const controls = screen.getByRole('group', {name: /zoom controls/});
    expect(controls).toContainElement(toggle());
  });

  it('keeps the panel closed until it is asked for', async () => {
    await renderReady();

    expect(panel()).toBeNull();
    expect(figure()).not.toHaveAttribute('data-plantuml-source-open');
  });

  it('reveals the source, and hides it again', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(toggle());
    expect(panel()).toHaveTextContent('Alice -> Bob : Hello');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(figure()).toHaveAttribute('data-plantuml-source-open', 'true');

    await user.click(toggle());
    expect(panel()).toBeNull();
    expect(figure()).not.toHaveAttribute('data-plantuml-source-open');
  });

  it('shows the source exactly as authored, not the rendered SVG', async () => {
    const user = userEvent.setup();
    await renderReady();
    await user.click(toggle());

    expect(panel()?.textContent).toBe(SOURCE);
  });

  it('points the control at the panel it opens', async () => {
    const user = userEvent.setup();
    await renderReady();
    await user.click(toggle());

    const controls = toggle().getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls as string)).toContainElement(panel());
  });

  it('names the engine in the panel heading', async () => {
    const user = userEvent.setup();
    render(<PlantUmlDiagram source={DOT} language="dot" engine="graphviz" />);
    scrollIntoView();
    await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-status', 'ready'));

    await user.click(toggle());
    expect(screen.getByText('Graphviz source')).toBeInTheDocument();
    expect(panel()?.textContent).toBe(DOT);
  });
});

describe('copying the source', () => {
  it('copies the diagram source and says so', async () => {
    const user = setupUser();
    await renderReady();
    await user.click(toggle());

    await user.click(screen.getByRole('button', {name: /copy .* source to clipboard/i}));

    expect(writeText).toHaveBeenCalledWith(SOURCE);
    expect(await screen.findByText('Copied to clipboard')).toBeInTheDocument();
  });

  it('announces the result without renaming the button', async () => {
    // A changing accessible name would be announced as a new control every time.
    const user = setupUser();
    await renderReady();
    await user.click(toggle());
    const copy = screen.getByRole('button', {name: /copy .* source to clipboard/i});

    await user.click(copy);
    await screen.findByText('Copied to clipboard');

    expect(copy).toHaveAccessibleName(/copy .* source to clipboard/i);
    expect(screen.getByRole('status')).toHaveTextContent('Copied to clipboard');
  });

  it('clears the message after the feedback delay', async () => {
    // Real timers on purpose. Faking the clock would mean either starting it before
    // `userEvent`, whose own awaited delays then never resolve, or after the component has
    // already scheduled a real timeout that a fake clock cannot advance. Waiting out two
    // seconds once is the cheaper honesty.
    const user = setupUser();
    await renderReady();
    await user.click(toggle());
    await user.click(screen.getByRole('button', {name: /copy .* source to clipboard/i}));
    await screen.findByText('Copied to clipboard');

    await waitFor(() => expect(screen.getByRole('status')).toBeEmptyDOMElement(), {
      timeout: 4_000,
    });
  });

  it('reports a rejected clipboard write instead of pretending it worked', async () => {
    const user = setupUser(() => Promise.reject(new Error('denied')));
    await renderReady();
    await user.click(toggle());

    await user.click(screen.getByRole('button', {name: /copy .* source to clipboard/i}));

    expect(await screen.findByText(/Could not copy/)).toBeInTheDocument();
  });

  it('reports a missing clipboard API, which is the plain-HTTP case', async () => {
    // `navigator.clipboard` is undefined outside a secure context. The panel is open, so the
    // reader can still select the text — but the control must not silently do nothing.
    const user = setupUser(null);
    await renderReady();
    await user.click(toggle());

    await user.click(screen.getByRole('button', {name: /copy .* source to clipboard/i}));

    expect(await screen.findByText(/select the text instead/)).toBeInTheDocument();
  });

  it('drops a stale result when the diagram source changes', async () => {
    const user = setupUser();
    const {rerender} = await renderReady();
    await user.click(toggle());
    await user.click(screen.getByRole('button', {name: /copy .* source to clipboard/i}));
    await screen.findByText('Copied to clipboard');

    rerender(<PlantUmlDiagram source="@startuml\nA -> B\n@enduml" />);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(''));
  });

  it('does not schedule a message into an unmounted diagram', async () => {
    const user = setupUser();
    const {unmount} = await renderReady();
    await user.click(toggle());
    await user.click(screen.getByRole('button', {name: /copy .* source to clipboard/i}));

    // The failure this guards against is a React "update on unmounted component" warning.
    expect(() => unmount()).not.toThrow();
  });
});

describe('turning it off', () => {
  it('omits the control when the plugin option is off', async () => {
    setStubOptions({showSource: false});
    await renderReady();

    expect(screen.queryByRole('button', {name: /diagram source/i})).toBeNull();
  });

  it('lets a fence opt out on its own', async () => {
    await renderReady({showSource: false});

    expect(screen.queryByRole('button', {name: /diagram source/i})).toBeNull();
  });

  it('lets a fence opt in when the option is off', async () => {
    setStubOptions({showSource: false});
    await renderReady({showSource: true});

    expect(toggle()).toBeInTheDocument();
  });
});

describe('without zoom', () => {
  it('still offers the source from its own control row', async () => {
    setStubOptions({zoom: false});
    await renderReady();

    expect(toggle()).toBeInTheDocument();
    expect(screen.queryByRole('group', {name: /zoom controls/})).toBeNull();
    expect(screen.getByRole('group', {name: /source controls/})).toContainElement(toggle());
  });

  it('keeps the canvas as the figure’s first child, as the pre-zoom markup always had', async () => {
    setStubOptions({zoom: false});
    await renderReady();

    expect(figure().firstElementChild).toHaveAttribute('role', 'img');
  });

  it('renders the bare pre-zoom markup when both are off', async () => {
    setStubOptions({zoom: false, showSource: false});
    await renderReady();

    expect(figure().children).toHaveLength(2); // the canvas and the <noscript>
    expect(screen.queryByRole('group')).toBeNull();
  });
});

describe('other states', () => {
  it('offers no source panel before the diagram is ready', () => {
    render(<PlantUmlDiagram source={SOURCE} />);

    expect(screen.queryByRole('button', {name: /diagram source/i})).toBeNull();
  });

  it('leaves the error panel to carry the source when rendering failed', async () => {
    renderDiagramMock.mockRejectedValue(new PlantUmlError('diagram', 'broken'));
    render(<PlantUmlDiagram source={SOURCE} />);
    scrollIntoView();

    await screen.findByRole('alert');
    // `showSourceOnError` already covers this case; a second copy would be redundant.
    expect(screen.queryByRole('button', {name: /diagram source/i})).toBeNull();
    expect(screen.getByText('Show diagram source')).toBeInTheDocument();
  });
});
