import {describe, expect, it} from 'vitest';

import {
  extractLanguage,
  extractSource,
  isPlantUmlLanguage,
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
    const element = {type: 'span', props: {}, key: null, $$typeof: Symbol.for('react.element')};
    expect(extractSource([element as never])).toBeNull();
    expect(extractSource(['@startuml', element as never])).toBeNull();
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
