import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import PlantUmlDiagram from '../../src/theme/PlantUmlDiagram/index.js';
import {setStubOptions} from '../stubs/state.js';

const {renderDiagramMock} = vi.hoisted(() => ({renderDiagramMock: vi.fn()}));
vi.mock('../../src/runtime/renderer.js', () => ({renderDiagram: renderDiagramMock}));

const SOURCE = '@startuml\nAlpha -> Beta : hello\n@enduml';
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg">' +
  '<text>Alpha</text><text>Beta</text><text>alphabet</text>' +
  '</svg>';

const figure = () => document.querySelector('[data-plantuml-diagram]') as HTMLElement;
const viewport = () => document.querySelector('[data-plantuml-zoom]') as HTMLElement;
const layer = () => viewport().firstElementChild as HTMLElement;
const matches = () => Array.from(document.querySelectorAll('[data-plantuml-search-match]'));
const current = () => document.querySelector('[data-plantuml-search-current]');
const input = () => screen.getByRole('textbox', {name: 'Search diagram text'});
const countReadout = () => screen.getByRole('status');

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

const toggle = () => screen.getByRole('button', {name: 'Search diagram'});

async function openSearch(): Promise<void> {
  await renderReady();
  act(() => toggle().click());
}

function type(value: string): void {
  fireEvent.change(input(), {target: {value}});
}

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

describe('the search bar', () => {
  it('opens from a drawn toolbar toggle and focuses the input', async () => {
    await renderReady();

    const button = toggle();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button.querySelector('svg')).toBeInTheDocument();

    act(() => button.click());

    expect(figure()).toHaveAttribute('data-plantuml-search-open', 'true');
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(input()).toHaveFocus();
    expect(countReadout()).toHaveTextContent('0/0');
  });

  it('offers no search without zoom, which is what pans to a match', async () => {
    setStubOptions({zoom: false});
    await renderReady();
    expect(screen.queryByRole('button', {name: 'Search diagram'})).toBeNull();
  });

  it('closes from its close button and returns focus to the toggle', async () => {
    await openSearch();
    type('alpha');
    expect(matches()).not.toHaveLength(0);

    act(() => screen.getByRole('button', {name: 'Close search'}).click());

    expect(figure()).not.toHaveAttribute('data-plantuml-search-open');
    expect(matches()).toHaveLength(0);
    expect(current()).toBeNull();
    expect(toggle()).toHaveFocus();
  });

  it('closes on Escape without letting the key reach the document', async () => {
    // The document-level Escape listener un-maximizes the diagram; one keystroke must not
    // do both.
    const documentEscapes = vi.fn();
    document.addEventListener('keydown', documentEscapes);
    await openSearch();

    fireEvent.keyDown(input(), {key: 'Escape'});

    expect(figure()).not.toHaveAttribute('data-plantuml-search-open');
    expect(documentEscapes).not.toHaveBeenCalled();
    document.removeEventListener('keydown', documentEscapes);
  });

  it('disappears with the picture when the source view is flipped on', async () => {
    await openSearch();
    act(() => screen.getByRole('button', {name: 'Show diagram source'}).click());

    expect(screen.queryByRole('textbox', {name: 'Search diagram text'})).toBeNull();
    expect(screen.queryByRole('button', {name: 'Search diagram'})).toBeNull();
  });
});

describe('matching', () => {
  it('marks every case-insensitive match and starts at the first', async () => {
    await openSearch();

    type('ALPHA');

    expect(matches().map((element) => element.textContent)).toEqual(['Alpha', 'alphabet']);
    expect(current()?.textContent).toBe('Alpha');
    expect(countReadout()).toHaveTextContent('1/2');
  });

  it('reports zero for a query nothing contains', async () => {
    await openSearch();
    type('gamma');

    expect(matches()).toHaveLength(0);
    expect(current()).toBeNull();
    expect(countReadout()).toHaveTextContent('0/0');
  });

  it('drops the highlights when the query is cleared', async () => {
    await openSearch();
    type('alpha');
    expect(matches()).toHaveLength(2);

    type('');

    expect(matches()).toHaveLength(0);
    expect(countReadout()).toHaveTextContent('0/0');
  });

  it('re-marks the matches when the query changes', async () => {
    await openSearch();
    type('alpha');
    type('beta');

    expect(matches().map((element) => element.textContent)).toEqual(['Beta']);
    expect(current()?.textContent).toBe('Beta');
  });
});

describe('stepping', () => {
  it('steps forward with the button, wrapping at the end', async () => {
    await openSearch();
    type('alpha');
    const next = screen.getByRole('button', {name: 'Next match'});

    act(() => next.click());
    expect(current()?.textContent).toBe('alphabet');
    expect(countReadout()).toHaveTextContent('2/2');

    act(() => next.click());
    expect(current()?.textContent).toBe('Alpha');
    expect(countReadout()).toHaveTextContent('1/2');
  });

  it('steps backward with the button, wrapping at the start', async () => {
    await openSearch();
    type('alpha');

    act(() => screen.getByRole('button', {name: 'Previous match'}).click());

    expect(current()?.textContent).toBe('alphabet');
    expect(countReadout()).toHaveTextContent('2/2');
  });

  it('treats Enter as next and Shift+Enter as previous', async () => {
    await openSearch();
    type('alpha');

    fireEvent.keyDown(input(), {key: 'Enter'});
    expect(current()?.textContent).toBe('alphabet');

    fireEvent.keyDown(input(), {key: 'Enter', shiftKey: true});
    expect(current()?.textContent).toBe('Alpha');
  });

  it('keeps exactly one current match, and it is always also a match', async () => {
    await openSearch();
    type('alpha');
    act(() => screen.getByRole('button', {name: 'Next match'}).click());

    const marked = document.querySelectorAll('[data-plantuml-search-current]');
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveAttribute('data-plantuml-search-match');
  });
});
