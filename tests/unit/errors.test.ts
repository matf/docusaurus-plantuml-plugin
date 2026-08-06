import {describe, expect, it} from 'vitest';

import {describeEngineError, detectDiagramError, PlantUmlError} from '../../src/runtime/errors.js';

/** Builds an SVG whose <text> nodes carry the given lines, like PlantUML's error pictures. */
function errorSvg(lines: string[]): string {
  const texts = lines
    .map((line, index) => `<text x="5" y="${17 + index * 14}">${line}</text>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 413 160">${texts}</svg>`;
}

const VERSION_NAG = [
  'PlantUML version $version$ / $git.commit.id$ [Unknown compile time]',
  ' ',
  'This version of PlantUML is 199 days old, so you should',
  'consider upgrading from https://plantuml.com/download',
];

describe('diagram error detection', () => {
  it('detects a syntax error picture', () => {
    const message = detectDiagramError(
      errorSvg([
        ...VERSION_NAG,
        '[From textarea (line 2) ]',
        '@startuml',
        'this is definitely not valid ###',
        ' Syntax Error? (Assumed diagram type: sequence)',
      ]),
    );
    expect(message).not.toBeNull();
    expect(message).toContain('Syntax Error?');
    expect(message).toContain('this is definitely not valid');
  });

  it('strips the engine version nag from the reported message', () => {
    const message = detectDiagramError(
      errorSvg([...VERSION_NAG, 'X', ' Syntax Error? (Assumed diagram type: sequence)']),
    );
    expect(message).not.toContain('PlantUML version');
    expect(message).not.toContain('days old');
    expect(message).not.toContain('consider upgrading');
  });

  it('detects an empty-description picture', () => {
    expect(
      detectDiagramError(
        errorSvg([
          ...VERSION_NAG,
          '@startuml',
          '@enduml',
          ' Empty description (Assumed diagram type: sequence)',
        ]),
      ),
    ).toContain('Empty description');
  });

  it('detects an unsupported-directive picture', () => {
    expect(
      detectDiagramError(
        errorSvg([
          'Diagram not supported by this release of PlantUML',
          'Sorry, but the following directive ',
          'Alice -> Bob : hi',
          ' is not recognized.',
        ]),
      ),
    ).toContain('not supported by this release');
  });

  it('accepts a valid diagram whose labels merely mention an error', () => {
    // A single marker is not enough; a real note could legitimately say this.
    expect(
      detectDiagramError(errorSvg(['Handle Syntax Error?', 'Retry', 'Log the failure'])),
    ).toBeNull();
    expect(
      detectDiagramError(errorSvg(['Diagram not supported by this release of PlantUML'])),
    ).toBeNull();
  });

  it('accepts an ordinary rendered diagram', () => {
    expect(
      detectDiagramError(errorSvg(['User', 'Browser', 'API', 'Sign in', 'Access token'])),
    ).toBeNull();
  });

  it('accepts an SVG with no text at all', () => {
    expect(
      detectDiagramError('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10"/></svg>'),
    ).toBeNull();
  });

  it('does not treat unparseable markup as a diagram error', () => {
    expect(detectDiagramError('<svg><unclosed>')).toBeNull();
    expect(detectDiagramError('')).toBeNull();
  });
});

describe('engine error description', () => {
  it('reads the message from an Error', () => {
    expect(describeEngineError(new Error('java.lang.IndexOutOfBoundsException'))).toBe(
      'java.lang.IndexOutOfBoundsException',
    );
  });

  it('passes a string through unchanged', () => {
    expect(describeEngineError('java.lang.IndexOutOfBoundsException')).toBe(
      'java.lang.IndexOutOfBoundsException',
    );
  });

  it('describes null and undefined rather than printing them', () => {
    expect(describeEngineError(null)).toMatch(/unknown error/);
    expect(describeEngineError(undefined)).toMatch(/unknown error/);
  });

  it('stringifies other values', () => {
    expect(describeEngineError(42)).toBe('42');
    expect(describeEngineError({toString: () => 'custom'})).toBe('custom');
  });

  it('survives a value that cannot be stringified', () => {
    const hostile = {
      toString() {
        throw new Error('nope');
      },
    };
    expect(describeEngineError(hostile)).toMatch(/unstringifiable/);
  });
});

describe('PlantUmlError', () => {
  it('carries a kind so the UI can explain what failed', () => {
    const error = new PlantUmlError('timeout', 'took too long');
    expect(error.kind).toBe('timeout');
    expect(error.name).toBe('PlantUmlError');
    expect(error.message).toBe('took too long');
    expect(error).toBeInstanceOf(Error);
  });

  it('preserves the underlying cause', () => {
    const cause = new Error('root cause');
    expect(new PlantUmlError('load', 'wrapper', {cause}).cause).toBe(cause);
  });
});
