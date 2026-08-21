import fs from 'node:fs';
import path from 'node:path';

import {act, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import PlantUmlDiagram from '../../src/theme/PlantUmlDiagram/index.js';

/**
 * The frame's layout: one control row above the picture, and nothing painted over it.
 *
 * The controls used to be absolutely positioned over the picture's corners, which meant that at
 * 100% — the view every reader arrives at — the toolbar sat on top of a sequence diagram's first
 * participant and the minimap toggle on top of a graph's leftmost node. Nothing about a floating
 * control can avoid that, because the picture is whatever shape its author drew.
 *
 * Geometry itself is asserted in `tests/e2e/zoom.spec.ts`: jsdom parses the stylesheet but lays
 * nothing out, so no unit test can measure an overlap. What is checkable here is what produces
 * the geometry — the row structure in the markup, and the stylesheet's promise to keep the
 * control row in flow.
 */

const {renderDiagramMock} = vi.hoisted(() => ({renderDiagramMock: vi.fn()}));
vi.mock('../../src/runtime/renderer.js', () => ({renderDiagram: renderDiagramMock}));

const SOURCE = '@startuml\nAlice -> Bob : Hello\n@enduml';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><text>Hello</text></svg>';

const figure = () => document.querySelector('[data-plantuml-diagram]') as HTMLElement;
const viewport = () => document.querySelector('[data-plantuml-zoom]') as HTMLElement;
/** The frame itself — `[class~=…]` matches the whole token, so `.stageBody` is not it. */
const stage = () => figure().querySelector('[class~="stage"]') as HTMLElement;
const minimapPanel = () => document.querySelector('[data-plantuml-minimap]');

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

async function renderReady() {
  const result = render(<PlantUmlDiagram source={SOURCE} />);
  act(() => {
    observers
      .at(-1)
      ?.callback([{isIntersecting: true} as IntersectionObserverEntry], {} as IntersectionObserver);
  });
  await waitFor(() => expect(figure()).toHaveAttribute('data-plantuml-status', 'ready'));
  return result;
}

beforeEach(() => {
  renderDiagramMock.mockReset();
  renderDiagramMock.mockResolvedValue(SVG);
  installObservers();
});

describe('the frame is a control row above the picture', () => {
  it('holds every control in one row, ahead of the picture', async () => {
    await renderReady();

    const rows = Array.from(stage().children);
    expect(rows).toHaveLength(2);

    const [controls, body] = rows as HTMLElement[];
    const group = screen.getByRole('group', {name: /zoom controls/});
    expect(controls).toContainElement(group);
    expect(body).toContainElement(viewport());

    // The minimap toggle is in the toolbar with everything else, not in a row of its own: a
    // row for one button read as a stray control, a diagonal away from the rest.
    expect(group).toContainElement(screen.getByRole('button', {name: 'Show minimap'}));

    // Reading order is DOM order, so `Tab` reaches the controls where the eye finds them
    // rather than after the picture they act on.
    expect(controls?.compareDocumentPosition(viewport())).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('opens the search bar in the control row, beside the toolbar', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole('button', {name: 'Search diagram'}));

    const controls = stage().firstElementChild as HTMLElement;
    expect(controls).toContainElement(screen.getByRole('search', {name: /search/}));
    // Still one row: the bar takes space beside the toolbar rather than over the diagram.
    expect(stage().children).toHaveLength(2);
  });

  it('anchors the minimap itself to the picture, since the reader asked for it', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole('button', {name: 'Show minimap'}));

    // Inside the diagram row, not a row of its own: the map is the one control that may cover
    // the picture, and it is positioned within the box it mirrors — the opposite corner from
    // the toolbar that opens it.
    expect(minimapPanel()?.parentElement).toBe(stage().children[1]);
    expect(stage().children).toHaveLength(2);
  });

  it('drops the minimap toggle with the picture when the source view is shown', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole('button', {name: 'Show diagram source'}));

    // A toggle for a map of an invisible diagram would pan nothing anyone can see.
    expect(screen.queryByRole('button', {name: /minimap/})).toBeNull();
    const rows = Array.from(stage().children) as HTMLElement[];
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContainElement(screen.getByText('PlantUML source'));
  });
});

describe('the stylesheet keeps the controls out of the picture', () => {
  // Vitest runs from the repository root; `import.meta.url` is not a `file:` URL under jsdom.
  const css = fs
    .readFileSync(path.join(process.cwd(), 'src/theme/PlantUmlDiagram/styles.module.css'), 'utf8')
    // Comments in this stylesheet quote declarations; stripping them keeps the parsing honest.
    .replace(/\/\*[\s\S]*?\*\//g, '');

  /**
   * The declarations of one top-level rule.
   *
   * Anchored on `}` or the start of the file so that a selector cannot be matched inside a
   * grouped selector or an `@media` block — `.minimapBar` appears in both.
   */
  function declarations(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    expect(match, `no rule for ${selector}`).not.toBeNull();
    return match?.[1] ?? '';
  }

  it('stacks the frame in flow rather than layering it', () => {
    const stageRule = declarations('.stage');
    expect(stageRule).toMatch(/display:\s*flex/);
    expect(stageRule).toMatch(/flex-direction:\s*column/);
  });

  it('leaves the control row in flow, so it cannot be painted over the diagram', () => {
    // The defect in one assertion: a positioned control row is a control row over the picture.
    expect(declarations('.controls')).not.toMatch(/position:/);
  });

  it('lets the control row wrap rather than overflow a narrow column', () => {
    // The toolbar carries the minimap toggle now, so in a narrow column it has to break
    // rather than push past the frame's edge.
    expect(declarations('.controls')).toMatch(/flex-wrap:\s*wrap/);
    expect(declarations('.toolbar')).toMatch(/flex-wrap:\s*wrap/);
  });

  it('positions only the map, which the reader opens deliberately', () => {
    expect(declarations('.minimap')).toMatch(/position:\s*absolute/);
  });

  it('stops reserving a toolbar gutter in the source view header', () => {
    // The bar used to carry `padding-right: 12rem` to dodge the floating toolbar.
    expect(declarations('.sourceViewBar')).not.toMatch(/12rem/);
  });
});
