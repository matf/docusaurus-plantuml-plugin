import {describe, expect, it} from 'vitest';

import {findStdlibIncludes} from '../../src/stdlibShared.js';

describe('finding standard library includes', () => {
  it('finds the plain form and lower-cases the namespace', () => {
    expect(findStdlibIncludes('@startuml\n!include <C4/C4_Container>\n@enduml')).toEqual([
      {namespace: 'c4', target: 'c4_container', fromExamples: false},
    ]);
  });

  it('keeps the extension in the target, because the engine looks the name up as written', () => {
    // The bundles register both spellings; the scanner only has to name the namespace.
    expect(findStdlibIncludes('!include <C4/C4_Container.puml>')[0]).toMatchObject({
      namespace: 'c4',
      target: 'c4_container.puml',
    });
  });

  it.each([
    ['!include', '!include <c4/c4>'],
    ['!includesub', '!includesub <c4/c4>!SUB'],
    ['!includeurl', '!includeurl <c4/c4>'],
    ['!include_many', '!include_many <c4/c4>'],
    ['indented', '   !include <c4/c4>'],
    ['upper case directive', '!INCLUDE <c4/c4>'],
  ])('recognizes the %s form', (_name, source) => {
    expect(findStdlibIncludes(source).map((reference) => reference.namespace)).toEqual(['c4']);
  });

  it('finds every include on a multi-line source and de-duplicates repeats', () => {
    const source = [
      '@startuml',
      '!include <k8s/Common>',
      '!include <k8s/OSS/KubernetesPod>',
      '!include <k8s/Common>',
      '@enduml',
    ].join('\n');
    expect(findStdlibIncludes(source).map((reference) => reference.target)).toEqual([
      'common',
      'oss/kubernetespod',
    ]);
  });

  it('marks targets under _examples_ so their extra dependencies can be loaded', () => {
    expect(findStdlibIncludes('!include <C4/_examples_/example>')[0]?.fromExamples).toBe(true);
    expect(findStdlibIncludes('!include <C4/C4_Container>')[0]?.fromExamples).toBe(false);
  });

  it('ignores a computed path, whose file cannot be known ahead of the render', () => {
    // DomainStory does exactly this, inside an `!if`, against a 6.8 MB icon namespace.
    expect(findStdlibIncludes('!include <material2.1.19/$icon>')).toEqual([]);
    expect(findStdlibIncludes('!include <material/%get_variable_value("X")>')).toEqual([]);
  });

  it('ignores includes that are not standard library references', () => {
    const source = [
      '!include ./local.puml',
      '!include https://example.com/remote.puml',
      '!include <no-slash-here>',
      'A -> B : text with <angle/brackets> in it',
    ].join('\n');
    expect(findStdlibIncludes(source)).toEqual([]);
  });

  it('does not advance a shared regex between calls', () => {
    const source = '!include <c4/c4_container>';
    expect(findStdlibIncludes(source)).toHaveLength(1);
    expect(findStdlibIncludes(source)).toHaveLength(1);
  });
});
