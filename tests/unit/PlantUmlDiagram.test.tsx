import {act, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import PlantUmlDiagram from '../../src/theme/PlantUmlDiagram/index.js';
import {PlantUmlError} from '../../src/runtime/errors.js';
import {removeStubGlobalData, setStubOptions, stubState} from '../stubs/state.js';

const {renderDiagramMock} = vi.hoisted(() => ({renderDiagramMock: vi.fn()}));

// Component tests mock the renderer; the real engine is covered by the browser suite.
vi.mock('../../src/runtime/renderer.js', () => ({renderDiagram: renderDiagramMock}));

const SOURCE = '@startuml\nAlice -> Bob : Hello\n@enduml';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><text>Hello</text></svg>';

const figure = () => document.querySelector('[data-plantuml-diagram]') as HTMLElement;

/** Records the observers created so tests can drive intersection by hand. */
interface FakeObserver {
  callback: IntersectionObserverCallback;
  elements: Element[];
  disconnected: boolean;
}
let observers: FakeObserver[] = [];

function installIntersectionObserver(): void {
  observers = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      readonly #record: FakeObserver;
      constructor(callback: IntersectionObserverCallback) {
        this.#record = {callback, elements: [], disconnected: false};
        observers.push(this.#record);
      }
      observe(element: Element) {
        this.#record.elements.push(element);
      }
      disconnect() {
        this.#record.disconnected = true;
      }
      unobserve() {}
      takeRecords() {
        return [];
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

beforeEach(() => {
  renderDiagramMock.mockReset();
  renderDiagramMock.mockResolvedValue(SVG);
  installIntersectionObserver();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('render states', () => {
  it('renders a deferred placeholder before anything is requested', () => {
    render(<PlantUmlDiagram source={SOURCE} />);

    expect(figure()).toHaveAttribute('data-plantuml-status', 'idle');
    expect(figure().tagName).toBe('FIGURE');
    expect(renderDiagramMock).not.toHaveBeenCalled();
    expect(screen.getByText(/waiting to render/)).toBeInTheDocument();
  });

  it('reports the loading and rendering phases while work is in flight', async () => {
    let reportPhase: ((phase: 'loading' | 'rendering') => void) | undefined;
    renderDiagramMock.mockImplementation(({onPhase}) => {
      reportPhase = onPhase;
      return new Promise(() => {});
    });

    render(<PlantUmlDiagram source={SOURCE} />);
    scrollIntoView();

    await waitFor(() => expect(reportPhase).toBeDefined());

    act(() => reportPhase?.('loading'));
    expect(figure()).toHaveAttribute('data-plantuml-status', 'loading');
    expect(figure()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText(/Loading PlantUML runtime/)).toBeInTheDocument();

    act(() => reportPhase?.('rendering'));
    expect(figure()).toHaveAttribute('data-plantuml-status', 'rendering');
    expect(figure()).toHaveAttribute('aria-busy', 'true');
  });

  it('inserts the rendered SVG into an accessible container once ready', async () => {
    render(<PlantUmlDiagram source={SOURCE} title="Authentication sequence" />);
    scrollIntoView();

    await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-status', 'ready'));

    const canvas = figure().querySelector('div[role="img"]') as HTMLElement;
    expect(canvas).toHaveAttribute('aria-label', 'Authentication sequence');
    expect(canvas.querySelector('svg')).not.toBeNull();
    expect(canvas.textContent).toContain('Hello');
    expect(figure()).not.toHaveAttribute('aria-busy');
  });

  it('uses a sensible default accessible label when the fence has no title', async () => {
    render(<PlantUmlDiagram source={SOURCE} />);
    scrollIntoView();

    await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-status', 'ready'));
    expect(figure().querySelector('div[role="img"]')).toHaveAttribute(
      'aria-label',
      'PlantUML diagram',
    );
    expect(figure().querySelector('figcaption')).toBeNull();
  });

  it('renders the title as a caption when present', async () => {
    render(<PlantUmlDiagram source={SOURCE} title="Order flow" />);
    scrollIntoView();

    await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-status', 'ready'));
    expect(figure().querySelector('figcaption')).toHaveTextContent('Order flow');
  });

  it('always includes the source in a noscript fallback', () => {
    render(<PlantUmlDiagram source={'@startuml\nA -> B : <script>\n@enduml'} />);

    const noscript = figure().querySelector('noscript') as HTMLElement;
    expect(noscript.innerHTML).toContain('@startuml');
    // The source is escaped, so it cannot become live markup for a no-JS reader.
    expect(noscript.innerHTML).toContain('&lt;script&gt;');
    expect(noscript.innerHTML).not.toContain('<script>');
  });

  it('tags the diagram with the fence language that matched', () => {
    render(<PlantUmlDiagram source={SOURCE} language="puml" />);
    expect(figure()).toHaveAttribute('data-plantuml-diagram', 'puml');
  });
});

describe('error states', () => {
  it('shows a readable error panel and the source when rendering fails', async () => {
    renderDiagramMock.mockRejectedValue(
      new PlantUmlError('diagram', 'Syntax Error? (Assumed diagram type: sequence)'),
    );

    render(<PlantUmlDiagram source={SOURCE} />);
    scrollIntoView();

    await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-status', 'error'));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Error: PlantUML diagram could not be rendered');
    expect(alert).toHaveTextContent('Syntax Error?');
    expect(screen.getByText('Show diagram source')).toBeInTheDocument();
    expect(figure().querySelector('details pre')).toHaveTextContent('Alice -> Bob');
    expect(figure().querySelector('svg')).toBeNull();
  });

  it('hides the source when showSourceOnError is disabled', async () => {
    setStubOptions({showSourceOnError: false});
    renderDiagramMock.mockRejectedValue(new PlantUmlError('engine', 'broken'));

    render(<PlantUmlDiagram source={SOURCE} />);
    scrollIntoView();

    await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-status', 'error'));
    expect(figure().querySelector('details')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('broken');
  });

  it('describes a non-Error rejection without leaking undefined into the UI', async () => {
    renderDiagramMock.mockRejectedValue('just a string');

    render(<PlantUmlDiagram source={SOURCE} />);
    scrollIntoView();

    await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-status', 'error'));
    expect(screen.getByRole('alert')).toHaveTextContent('The diagram could not be rendered.');
  });

  it('explains a missing plugin registration instead of rendering nothing', async () => {
    removeStubGlobalData();

    render(<PlantUmlDiagram source={SOURCE} />);
    scrollIntoView();

    await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-status', 'error'));
    expect(screen.getByRole('alert')).toHaveTextContent(/Diagram plugin data is missing/);
    expect(renderDiagramMock).not.toHaveBeenCalled();
  });

  it('does not surface an abort as an error to the reader', async () => {
    renderDiagramMock.mockRejectedValue(new PlantUmlError('aborted', 'Render aborted.'));

    render(<PlantUmlDiagram source={SOURCE} />);
    scrollIntoView();

    // Give the rejection a chance to propagate before asserting nothing changed.
    await act(() => Promise.resolve());
    expect(figure()).not.toHaveAttribute('data-plantuml-status', 'error');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('lazy rendering', () => {
  it('waits for the diagram to approach the viewport', async () => {
    render(<PlantUmlDiagram source={SOURCE} />);

    expect(renderDiagramMock).not.toHaveBeenCalled();
    expect(observers).toHaveLength(1);
    expect(observers[0]?.elements[0]).toBe(figure());

    scrollIntoView();
    await waitFor(() => expect(renderDiagramMock).toHaveBeenCalledTimes(1));
  });

  it('stops observing once the diagram has been requested', async () => {
    render(<PlantUmlDiagram source={SOURCE} />);
    scrollIntoView();

    await waitFor(() => expect(renderDiagramMock).toHaveBeenCalled());
    expect(observers[0]?.disconnected).toBe(true);
  });

  it('renders immediately when lazy loading is disabled', async () => {
    setStubOptions({lazy: false});

    render(<PlantUmlDiagram source={SOURCE} />);

    await waitFor(() => expect(renderDiagramMock).toHaveBeenCalledTimes(1));
    expect(observers).toHaveLength(0);
  });

  it('renders immediately when IntersectionObserver is unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);

    render(<PlantUmlDiagram source={SOURCE} />);

    await waitFor(() => expect(renderDiagramMock).toHaveBeenCalledTimes(1));
  });

  it('disconnects the observer when unmounted before intersecting', () => {
    const {unmount} = render(<PlantUmlDiagram source={SOURCE} />);
    unmount();
    expect(observers[0]?.disconnected).toBe(true);
  });
});

describe('colour mode', () => {
  it('renders light diagrams in light mode', async () => {
    render(<PlantUmlDiagram source={SOURCE} />);
    scrollIntoView();

    await waitFor(() => expect(renderDiagramMock).toHaveBeenCalled());
    expect(renderDiagramMock.mock.calls[0]?.[0]).toMatchObject({dark: false});
    expect(figure()).toHaveAttribute('data-plantuml-theme', 'light');
  });

  it('follows the Docusaurus colour mode when theme is auto', async () => {
    stubState.colorMode = 'dark';

    render(<PlantUmlDiagram source={SOURCE} />);
    scrollIntoView();

    await waitFor(() => expect(renderDiagramMock).toHaveBeenCalled());
    expect(renderDiagramMock.mock.calls[0]?.[0]).toMatchObject({dark: true});
    expect(figure()).toHaveAttribute('data-plantuml-theme', 'dark');
  });

  it('pins the diagram theme when the option is not auto', async () => {
    setStubOptions({theme: 'dark'});
    stubState.colorMode = 'light';

    render(<PlantUmlDiagram source={SOURCE} />);
    scrollIntoView();

    await waitFor(() => expect(renderDiagramMock).toHaveBeenCalled());
    expect(renderDiagramMock.mock.calls[0]?.[0]).toMatchObject({dark: true});
    expect(figure()).toHaveAttribute('data-plantuml-theme', 'dark');
  });

  it('re-renders with the new theme when the colour mode changes', async () => {
    const {rerender} = render(<PlantUmlDiagram source={SOURCE} />);
    scrollIntoView();
    await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-status', 'ready'));

    stubState.colorMode = 'dark';
    renderDiagramMock.mockResolvedValue(
      '<svg xmlns="http://www.w3.org/2000/svg"><text>Dark</text></svg>',
    );
    rerender(<PlantUmlDiagram source={SOURCE} />);

    await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-theme', 'dark'));
    await waitFor(() => expect(figure().textContent).toContain('Dark'));
    expect(renderDiagramMock).toHaveBeenCalledTimes(2);
    expect(renderDiagramMock.mock.calls[1]?.[0]).toMatchObject({dark: true});
  });
});

describe('lifecycle safety', () => {
  it('does not render repeatedly for a stable set of inputs', async () => {
    render(<PlantUmlDiagram source={SOURCE} />);
    scrollIntoView();

    await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-status', 'ready'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(renderDiagramMock).toHaveBeenCalledTimes(1);
  });

  it('aborts the in-flight render when unmounted', async () => {
    let capturedSignal: AbortSignal | undefined;
    renderDiagramMock.mockImplementation(({signal}) => {
      capturedSignal = signal;
      return new Promise(() => {});
    });

    const {unmount} = render(<PlantUmlDiagram source={SOURCE} />);
    scrollIntoView();
    await waitFor(() => expect(capturedSignal).toBeDefined());

    expect(capturedSignal?.aborted).toBe(false);
    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('does not update state after unmounting', async () => {
    let resolveRender: ((svg: string) => void) | undefined;
    renderDiagramMock.mockImplementation(
      () => new Promise<string>((resolve) => (resolveRender = resolve)),
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const {unmount} = render(<PlantUmlDiagram source={SOURCE} />);
    scrollIntoView();
    await waitFor(() => expect(resolveRender).toBeDefined());

    unmount();
    await act(async () => {
      resolveRender?.(SVG);
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('ignores a slow earlier render once the inputs have changed', async () => {
    const pending = new Map<string, (svg: string) => void>();
    renderDiagramMock.mockImplementation(
      ({source}: {source: string}) =>
        new Promise<string>((resolve) => pending.set(source, resolve)),
    );

    const {rerender} = render(<PlantUmlDiagram source="FIRST" />);
    scrollIntoView();
    await waitFor(() => expect(pending.has('FIRST')).toBe(true));

    rerender(<PlantUmlDiagram source="SECOND" />);
    await waitFor(() => expect(pending.has('SECOND')).toBe(true));

    // The superseded render finishes last; its result must not win.
    await act(async () => {
      pending.get('SECOND')?.('<svg xmlns="http://www.w3.org/2000/svg"><text>Second</text></svg>');
      await Promise.resolve();
    });
    await act(async () => {
      pending.get('FIRST')?.('<svg xmlns="http://www.w3.org/2000/svg"><text>First</text></svg>');
      await Promise.resolve();
    });

    await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-status', 'ready'));
    expect(figure().textContent).toContain('Second');
    expect(figure().textContent).not.toContain('First');
  });
});
