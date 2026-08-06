import {act, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {DEFAULT_GRAPHVIZ_OPTIONS, type ResolvedGraphvizOptions} from '../../src/options.js';
import PlantUmlDiagram from '../../src/theme/PlantUmlDiagram/index.js';
import {PlantUmlError} from '../../src/runtime/errors.js';
import {setStubOptions, stubState} from '../stubs/state.js';

const {renderDiagramMock, renderGraphvizMock} = vi.hoisted(() => ({
  renderDiagramMock: vi.fn(),
  renderGraphvizMock: vi.fn(),
}));

vi.mock('../../src/runtime/renderer.js', () => ({renderDiagram: renderDiagramMock}));
vi.mock('../../src/runtime/graphvizRenderer.js', () => ({
  renderGraphvizDiagram: renderGraphvizMock,
}));

const DOT = 'digraph {a -> b}';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><ellipse stroke="black"/></svg>';

const figure = () => document.querySelector('[data-plantuml-diagram]') as HTMLElement;

let observers: IntersectionObserverCallback[] = [];

function installIntersectionObserver(): void {
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
}

function scrollIntoView(): void {
  act(() => {
    observers.at(-1)?.(
      [{isIntersecting: true} as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}

/** Renders a DOT diagram and waits for it to reach the ready state. */
async function renderReady(props: Record<string, unknown> = {}) {
  const result = render(
    <PlantUmlDiagram source={DOT} language="dot" engine="graphviz" {...props} />,
  );
  scrollIntoView();
  await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-status', 'ready'));
  return result;
}

function setGraphvizOptions(overrides: Partial<ResolvedGraphvizOptions>): void {
  setStubOptions({graphviz: {...DEFAULT_GRAPHVIZ_OPTIONS, ...overrides}});
}

beforeEach(() => {
  renderDiagramMock.mockReset();
  renderGraphvizMock.mockReset();
  renderGraphvizMock.mockResolvedValue(SVG);
  installIntersectionObserver();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rendering a Graphviz diagram', () => {
  it('routes a DOT fence to the Graphviz renderer, never the PlantUML one', async () => {
    await renderReady();

    expect(renderGraphvizMock).toHaveBeenCalledTimes(1);
    expect(renderDiagramMock).not.toHaveBeenCalled();
    expect(figure().querySelector('[role="img"] svg')).toBeInTheDocument();
  });

  it('marks the figure with the engine and the layout in use', async () => {
    await renderReady();

    expect(figure()).toHaveAttribute('data-diagram-engine', 'graphviz');
    expect(figure()).toHaveAttribute('data-diagram-layout', 'dot');
    // The historical attribute keeps carrying the fence language, as it always has.
    expect(figure()).toHaveAttribute('data-plantuml-diagram', 'dot');
  });

  it('does not put a layout attribute on a PlantUML figure', async () => {
    renderDiagramMock.mockResolvedValue(SVG);
    render(<PlantUmlDiagram source="@startuml\nA -> B\n@enduml" language="plantuml" />);
    scrollIntoView();
    await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-status', 'ready'));

    expect(figure()).toHaveAttribute('data-diagram-engine', 'plantuml');
    expect(figure()).not.toHaveAttribute('data-diagram-layout');
  });

  it('passes the configured options through to the renderer', async () => {
    setGraphvizOptions({engine: 'twopi', maxSourceBytes: 4_096, transparentBackground: false});
    await renderReady();

    expect(renderGraphvizMock.mock.calls[0]?.[0]).toMatchObject({
      source: DOT,
      layout: 'twopi',
      maxSourceBytes: 4_096,
      transparentBackground: false,
    });
  });

  it('lets a fence choose its own layout engine', async () => {
    await renderReady({layout: 'neato'});

    expect(renderGraphvizMock.mock.calls[0]?.[0]).toMatchObject({layout: 'neato'});
    expect(figure()).toHaveAttribute('data-diagram-layout', 'neato');
  });

  it('ignores a fence layout when the site forbids overrides', async () => {
    setGraphvizOptions({engine: 'circo', allowEngineOverride: false});
    await renderReady({layout: 'neato'});

    expect(renderGraphvizMock.mock.calls[0]?.[0]).toMatchObject({layout: 'circo'});
    expect(figure()).toHaveAttribute('data-diagram-layout', 'circo');
  });

  it('re-renders when the fence changes its layout engine', async () => {
    const {rerender} = await renderReady();
    rerender(<PlantUmlDiagram source={DOT} language="dot" engine="graphviz" layout="neato" />);

    await waitFor(() => expect(renderGraphvizMock).toHaveBeenCalledTimes(2));
    expect(renderGraphvizMock.mock.calls[1]?.[0]).toMatchObject({layout: 'neato'});
  });
});

describe('colour mode', () => {
  it('does not re-render a DOT diagram when the colour mode changes', async () => {
    // Graphviz output is colour-mode independent — the stylesheet adapts it — so a toggle
    // must not cost a second layout. This is the property that keeps the cache key free of
    // the colour mode; see the `currentColor` rules in styles.module.css.
    const {rerender} = await renderReady();
    expect(renderGraphvizMock).toHaveBeenCalledTimes(1);

    stubState.colorMode = 'dark';
    rerender(<PlantUmlDiagram source={DOT} language="dot" engine="graphviz" />);

    await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-theme', 'dark'));
    expect(renderGraphvizMock).toHaveBeenCalledTimes(1);
  });

  it('still re-renders a PlantUML diagram when the colour mode changes', async () => {
    // The counterpart guard: dropping the colour mode for Graphviz must not have dropped it
    // for PlantUML, which genuinely does have a dark theme.
    renderDiagramMock.mockResolvedValue(SVG);
    const {rerender} = render(<PlantUmlDiagram source="@startuml\nA -> B\n@enduml" />);
    scrollIntoView();
    await waitFor(() => expect(renderDiagramMock).toHaveBeenCalledTimes(1));

    stubState.colorMode = 'dark';
    rerender(<PlantUmlDiagram source="@startuml\nA -> B\n@enduml" />);

    await waitFor(() => expect(renderDiagramMock).toHaveBeenCalledTimes(2));
    expect(renderDiagramMock.mock.calls[1]?.[0]).toMatchObject({dark: true});
  });

  it('still reports the page colour mode on the figure', async () => {
    // The diagram is not re-rendered, but the attribute must still describe the page, since
    // that is what author CSS keys off.
    stubState.colorMode = 'dark';
    await renderReady();

    expect(figure()).toHaveAttribute('data-plantuml-theme', 'dark');
  });

  it('never asks the Graphviz renderer for a dark render', async () => {
    stubState.colorMode = 'dark';
    await renderReady();

    expect(renderGraphvizMock.mock.calls[0]?.[0]).not.toHaveProperty('dark');
  });
});

describe('progress and failure wording', () => {
  it('names Graphviz while loading its runtime', async () => {
    let release: (svg: string) => void = () => {};
    renderGraphvizMock.mockImplementation(
      (request: {onPhase?: (phase: string) => void}) =>
        new Promise<string>((resolve) => {
          request.onPhase?.('loading');
          release = resolve;
        }),
    );

    render(<PlantUmlDiagram source={DOT} language="dot" engine="graphviz" />);
    scrollIntoView();

    await waitFor(() => expect(screen.getByText(/Loading Graphviz runtime/)).toBeInTheDocument());
    act(() => release(SVG));
  });

  it('labels the diagram for assistive technology without a title', async () => {
    await renderReady();

    expect(figure().querySelector('[role="img"]')).toHaveAttribute(
      'aria-label',
      'Graphviz diagram',
    );
  });

  it('prefers the fence title as the accessible label', async () => {
    await renderReady({title: 'Build pipeline'});

    expect(figure().querySelector('[role="img"]')).toHaveAttribute('aria-label', 'Build pipeline');
    expect(screen.getByText('Build pipeline')).toBeInTheDocument();
  });

  it('names Graphviz in the error heading', async () => {
    renderGraphvizMock.mockRejectedValue(
      new PlantUmlError('syntax', "syntax error in line 2 near '}'"),
    );
    render(<PlantUmlDiagram source={DOT} language="dot" engine="graphviz" />);
    scrollIntoView();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Error: Graphviz diagram could not be rendered/);
    // Graphviz names the offending line; showing it is the point of the structured errors.
    expect(alert).toHaveTextContent(/syntax error in line 2/);
  });

  it('offers the DOT source when a render fails', async () => {
    renderGraphvizMock.mockRejectedValue(new PlantUmlError('syntax', 'syntax error in line 1'));
    render(<PlantUmlDiagram source={DOT} language="dot" engine="graphviz" />);
    scrollIntoView();

    await screen.findByRole('alert');
    expect(screen.getByText('Show diagram source')).toBeInTheDocument();
    expect(screen.getByText(DOT)).toBeInTheDocument();
  });

  it('explains an oversized diagram instead of freezing the page', async () => {
    renderGraphvizMock.mockRejectedValue(
      new PlantUmlError(
        'too-large',
        'This diagram’s source is 900 bytes, above the 100-byte limit.',
      ),
    );
    render(<PlantUmlDiagram source={DOT} language="dot" engine="graphviz" />);
    scrollIntoView();

    expect(await screen.findByRole('alert')).toHaveTextContent(/above the 100-byte limit/);
  });

  it('stays silent about an aborted render, which is a normal lifecycle event', async () => {
    renderGraphvizMock.mockRejectedValue(new PlantUmlError('aborted', 'Render aborted.'));
    render(<PlantUmlDiagram source={DOT} language="dot" engine="graphviz" />);
    scrollIntoView();

    await waitFor(() => expect(renderGraphvizMock).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('shared behaviour still applies', () => {
  it('waits for the diagram to scroll into view when lazy', async () => {
    render(<PlantUmlDiagram source={DOT} language="dot" engine="graphviz" />);

    expect(renderGraphvizMock).not.toHaveBeenCalled();
    expect(figure()).toHaveAttribute('data-plantuml-status', 'idle');

    scrollIntoView();
    await waitFor(() => expect(renderGraphvizMock).toHaveBeenCalled());
  });

  it('is zoomable like any other diagram', async () => {
    await renderReady();

    expect(figure()).toHaveAttribute('data-plantuml-interactive', 'true');
    expect(screen.getByRole('group', {name: /zoom controls/})).toBeInTheDocument();
  });

  it('honours a fence flag that turns zoom off', async () => {
    await renderReady({zoom: false});

    expect(figure()).not.toHaveAttribute('data-plantuml-interactive');
  });

  it('carries the source in a noscript block for readers without JavaScript', async () => {
    await renderReady();

    expect(figure().querySelector('noscript')?.textContent).toContain('digraph');
  });
});
