import {createElement} from 'react';
import {describe, expect, it} from 'vitest';

import {
  extractLanguage,
  extractSource,
  isPlantUmlLanguage,
  parseBooleanMeta,
  parseTitle,
} from '../../src/theme/codeBlockMeta.js';

describe('language detection', () => {
  it('detects plantuml and puml fences', () => {
    expect(extractLanguage({className: 'language-plantuml'})).toBe('plantuml');
    expect(extractLanguage({className: 'language-puml'})).toBe('puml');
  });

  it('is case-insensitive, matching Docusaurus normalizing the fence language', () => {
    expect(extractLanguage({className: 'language-PlantUML'})).toBe('plantuml');
    expect(extractLanguage({className: 'language-PUML'})).toBe('puml');
    expect(extractLanguage({className: 'language-PlAnTuMl'})).toBe('plantuml');
  });

  it('finds the language class among other class names', () => {
    expect(extractLanguage({className: 'prism-code theme-code language-puml extra'})).toBe('puml');
  });

  it('prefers an explicit language prop over the class name', () => {
    expect(extractLanguage({className: 'language-js', language: 'PlantUML'})).toBe('plantuml');
  });

  it('returns undefined for inline code and unlabelled fences', () => {
    expect(extractLanguage({})).toBeUndefined();
    expect(extractLanguage({className: 'some-other-class'})).toBeUndefined();
    expect(extractLanguage({className: 'language-'})).toBeUndefined();
    expect(extractLanguage({language: '   '})).toBeUndefined();
  });

  it('matches only the configured languages', () => {
    const configured = ['plantuml', 'puml'];
    expect(isPlantUmlLanguage({className: 'language-plantuml'}, configured)).toBe(true);
    expect(isPlantUmlLanguage({className: 'language-PUML'}, configured)).toBe(true);
    expect(isPlantUmlLanguage({className: 'language-js'}, configured)).toBe(false);
    expect(isPlantUmlLanguage({className: 'language-uml'}, configured)).toBe(false);
    expect(isPlantUmlLanguage({className: 'language-uml'}, ['uml'])).toBe(true);
  });
});

describe('fence source extraction', () => {
  it('reads a plain string fence body', () => {
    expect(extractSource('@startuml\nA -> B\n@enduml')).toBe('@startuml\nA -> B\n@enduml');
  });

  it('joins the string fragments MDX may split the body into', () => {
    expect(extractSource(['@startuml\n', 'A -> B\n', '@enduml'])).toBe(
      '@startuml\nA -> B\n@enduml',
    );
  });

  it('strips the single trailing newline MDX appends to every fence', () => {
    expect(extractSource('@startuml\nA -> B\n@enduml\n')).toBe('@startuml\nA -> B\n@enduml');
  });

  it('keeps meaningful blank lines inside the diagram', () => {
    expect(extractSource('@startuml\n\nA -> B\n\n@enduml\n')).toBe(
      '@startuml\n\nA -> B\n\n@enduml',
    );
  });

  it('returns null for empty children so the original component keeps the block', () => {
    expect(extractSource(undefined)).toBeNull();
    expect(extractSource(null)).toBeNull();
    expect(extractSource([])).toBeNull();
  });

  it('returns null when the body contains React elements rather than plain text', () => {
    // A real element, not a hand-built object: React 19 renamed the internal element symbol
    // from `react.element` to `react.transitional.element`, and a faked one stops being
    // recognised — a brittleness in the test, not in the code under test.
    const element = createElement('span', null, 'x');
    expect(extractSource([element])).toBeNull();
    expect(extractSource(['@startuml', element])).toBeNull();
  });
});

describe('title metadata', () => {
  it('reads a double-quoted title from the metastring', () => {
    expect(parseTitle({metastring: 'title="Authentication sequence"'})).toBe(
      'Authentication sequence',
    );
  });

  it('reads a single-quoted title', () => {
    expect(parseTitle({metastring: "title='Order flow'"})).toBe('Order flow');
  });

  it('reads a title surrounded by other metadata', () => {
    expect(parseTitle({metastring: 'showLineNumbers title="Domain model" {1,3}'})).toBe(
      'Domain model',
    );
  });

  it('prefers an explicit title prop', () => {
    expect(parseTitle({title: 'From prop', metastring: 'title="From meta"'})).toBe('From prop');
  });

  it('returns undefined when there is no usable title', () => {
    expect(parseTitle({})).toBeUndefined();
    expect(parseTitle({metastring: ''})).toBeUndefined();
    expect(parseTitle({metastring: 'showLineNumbers'})).toBeUndefined();
    expect(parseTitle({metastring: 'title=""'})).toBeUndefined();
    expect(parseTitle({title: ''})).toBeUndefined();
  });

  it('does not confuse a mismatched quote pair for a title', () => {
    expect(parseTitle({metastring: 'title="unterminated'})).toBeUndefined();
  });
});

describe('boolean fence flags', () => {
  const zoom = (metastring?: string) => parseBooleanMeta({metastring}, 'zoom');

  it('reads a bare flag as true', () => {
    expect(zoom('zoom')).toBe(true);
  });

  it('reads an explicit value', () => {
    expect(zoom('zoom=true')).toBe(true);
    expect(zoom('zoom=false')).toBe(false);
  });

  it('is case-insensitive in both the key and the value', () => {
    expect(zoom('ZOOM=TRUE')).toBe(true);
    expect(zoom('Zoom=False')).toBe(false);
  });

  it('finds the flag among other metadata', () => {
    expect(zoom('showLineNumbers zoom title="Topology"')).toBe(true);
    expect(zoom('title="Topology" zoom=false')).toBe(false);
  });

  it('returns undefined when the flag is absent', () => {
    expect(zoom()).toBeUndefined();
    expect(zoom('')).toBeUndefined();
    expect(zoom('showLineNumbers')).toBeUndefined();
  });

  it('does not match a flag embedded in another word', () => {
    expect(zoom('nozoom')).toBeUndefined();
    expect(zoom('zoomed')).toBeUndefined();
    expect(zoom('autozoom=true')).toBeUndefined();
  });

  it('ignores a flag that only appears inside a quoted value', () => {
    // Otherwise a diagram titled "zoom=false" would silently disable its own zoom.
    expect(zoom('title="zoom=false"')).toBeUndefined();
    expect(zoom("title='zoom'")).toBeUndefined();
  });

  it('ignores an unrecognized value rather than failing the build', () => {
    expect(zoom('zoom=maybe')).toBeUndefined();
    expect(zoom('zoom=1')).toBeUndefined();
  });

  it('reads a flag other than zoom', () => {
    expect(parseBooleanMeta({metastring: 'foo=false'}, 'foo')).toBe(false);
  });
});
