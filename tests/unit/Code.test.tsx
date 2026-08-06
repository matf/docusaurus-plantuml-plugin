import {render, screen} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import Code from '../../src/theme/MDXComponents/Code/index.js';
import {originalCodeCalls, resetOriginalCodeCalls} from '../stubs/OriginalCode.js';
import {removeStubGlobalData, setStubOptions} from '../stubs/state.js';

// The diagram component is exercised separately; here only delegation matters.
vi.mock('@theme/PlantUmlDiagram', () => ({
  default: ({
    source,
    title,
    language,
    zoom,
  }: {
    source: string;
    title?: string;
    language?: string;
    zoom?: boolean;
  }) => (
    <div
      data-testid="diagram"
      data-title={title}
      data-language={language}
      data-zoom={zoom === undefined ? 'inherit' : String(zoom)}
    >
      {source}
    </div>
  ),
}));

const DIAGRAM = '@startuml\nAlice -> Bob\n@enduml\n';

beforeEach(() => {
  resetOriginalCodeCalls();
});

describe('intercepting PlantUML fences', () => {
  it('renders a diagram for a plantuml fence', () => {
    render(<Code className="language-plantuml">{DIAGRAM}</Code>);

    const diagram = screen.getByTestId('diagram');
    expect(diagram).toHaveTextContent('Alice -> Bob');
    expect(diagram).toHaveAttribute('data-language', 'plantuml');
    expect(originalCodeCalls).toHaveLength(0);
  });

  it('renders a diagram for the puml alias', () => {
    render(<Code className="language-puml">{DIAGRAM}</Code>);
    expect(screen.getByTestId('diagram')).toHaveAttribute('data-language', 'puml');
  });

  it('matches the fence language case-insensitively', () => {
    render(<Code className="language-PlantUML">{DIAGRAM}</Code>);
    expect(screen.getByTestId('diagram')).toHaveAttribute('data-language', 'plantuml');
  });

  it('passes the fence title through as the diagram title', () => {
    render(
      <Code className="language-plantuml" metastring='title="Authentication sequence"'>
        {DIAGRAM}
      </Code>,
    );
    expect(screen.getByTestId('diagram')).toHaveAttribute('data-title', 'Authentication sequence');
  });

  it('strips the trailing newline MDX appends', () => {
    render(<Code className="language-plantuml">{DIAGRAM}</Code>);
    expect(screen.getByTestId('diagram').textContent).toBe('@startuml\nAlice -> Bob\n@enduml');
  });

  it('passes the fence zoom flag through to the diagram', () => {
    render(
      <Code className="language-plantuml" metastring="zoom=false">
        {DIAGRAM}
      </Code>,
    );
    expect(screen.getByTestId('diagram')).toHaveAttribute('data-zoom', 'false');
  });

  it('leaves zoom to the plugin option when the fence says nothing', () => {
    render(<Code className="language-plantuml">{DIAGRAM}</Code>);
    expect(screen.getByTestId('diagram')).toHaveAttribute('data-zoom', 'inherit');
  });

  it('honours a custom language list', () => {
    setStubOptions({languages: ['uml']});

    render(<Code className="language-uml">{DIAGRAM}</Code>);
    expect(screen.getByTestId('diagram')).toBeInTheDocument();
  });

  it('stops intercepting a language that was removed from the list', () => {
    setStubOptions({languages: ['uml']});

    render(<Code className="language-plantuml">{DIAGRAM}</Code>);
    expect(screen.queryByTestId('diagram')).toBeNull();
    expect(screen.getByTestId('original-code')).toBeInTheDocument();
  });
});

describe('delegating everything else', () => {
  it('delegates an ordinary fenced code block unchanged', () => {
    render(
      <Code className="language-ts" metastring='title="example.ts"'>
        {'export const x = 1;\n'}
      </Code>,
    );

    expect(screen.queryByTestId('diagram')).toBeNull();
    expect(originalCodeCalls).toHaveLength(1);
    expect(originalCodeCalls[0]).toEqual({
      className: 'language-ts',
      metastring: 'title="example.ts"',
      children: 'export const x = 1;\n',
    });
  });

  it('delegates an ordinary fence carrying a zoom flag, untouched', () => {
    render(
      <Code className="language-ts" metastring="zoom">
        {'const a = 1;\n'}
      </Code>,
    );
    expect(screen.queryByTestId('diagram')).toBeNull();
    expect(originalCodeCalls[0]).toEqual({
      className: 'language-ts',
      metastring: 'zoom',
      children: 'const a = 1;\n',
    });
  });

  it('delegates inline code, which carries no language class', () => {
    render(<Code>plantuml</Code>);
    expect(screen.queryByTestId('diagram')).toBeNull();
    expect(screen.getByTestId('original-code')).toHaveTextContent('plantuml');
  });

  it('delegates a fence with no language', () => {
    render(<Code>{'plain text\n'}</Code>);
    expect(originalCodeCalls).toHaveLength(1);
  });

  it('delegates a PlantUML fence whose body contains React elements', () => {
    // JSX-authored blocks have no reliable source string to hand to the engine.
    render(
      <Code className="language-plantuml">
        <span>@startuml</span>
      </Code>,
    );
    expect(screen.queryByTestId('diagram')).toBeNull();
    expect(originalCodeCalls).toHaveLength(1);
  });

  it('delegates an empty PlantUML fence rather than rendering a blank diagram', () => {
    render(<Code className="language-plantuml" />);
    expect(screen.queryByTestId('diagram')).toBeNull();
    expect(originalCodeCalls).toHaveLength(1);
  });

  it('delegates every block when the plugin data is missing', () => {
    removeStubGlobalData();

    render(<Code className="language-plantuml">{DIAGRAM}</Code>);
    expect(screen.queryByTestId('diagram')).toBeNull();
    expect(originalCodeCalls).toHaveLength(1);
  });

  it('preserves unknown props when delegating', () => {
    render(
      <Code className="language-js" title="from-prop" language="js">
        {'const a = 1;\n'}
      </Code>,
    );
    expect(originalCodeCalls[0]).toMatchObject({title: 'from-prop', language: 'js'});
  });
});
