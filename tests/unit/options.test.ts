import {describe, expect, it} from 'vitest';

import {DEFAULT_OPTIONS, PlantUmlOptionsError, resolveOptions} from '../../src/options.js';
import plantumlPlugin, {validateOptions} from '../../src/index.js';

describe('plugin option defaults', () => {
  it('applies every documented default when no options are given', () => {
    expect(resolveOptions(undefined)).toEqual({
      languages: ['plantuml', 'puml'],
      theme: 'auto',
      lazy: true,
      cache: 'memory',
      sanitizeSvg: true,
      showSourceOnError: true,
      renderTimeoutMs: 20_000,
      cacheMaxEntries: 50,
      zoom: true,
    });
  });

  it('treats an empty object the same as no options', () => {
    expect(resolveOptions({})).toEqual(resolveOptions(undefined));
  });

  it('does not share the default languages array between calls', () => {
    const first = resolveOptions(undefined);
    first.languages.push('mutated');
    expect(resolveOptions(undefined).languages).toEqual(['plantuml', 'puml']);
    expect(DEFAULT_OPTIONS.languages).toEqual(['plantuml', 'puml']);
  });

  it('keeps user values and fills the rest from defaults', () => {
    const resolved = resolveOptions({theme: 'dark', lazy: false, renderTimeoutMs: 5_000});
    expect(resolved.theme).toBe('dark');
    expect(resolved.lazy).toBe(false);
    expect(resolved.renderTimeoutMs).toBe(5_000);
    expect(resolved.cache).toBe('memory');
    expect(resolved.sanitizeSvg).toBe(true);
  });

  it('keeps an explicit zoom value', () => {
    expect(resolveOptions({zoom: false}).zoom).toBe(false);
    expect(resolveOptions({zoom: true}).zoom).toBe(true);
  });

  it('normalizes languages to lower case and trims them', () => {
    expect(resolveOptions({languages: [' PlantUML ', 'PUML']}).languages).toEqual([
      'plantuml',
      'puml',
    ]);
  });
});

describe('plugin option validation', () => {
  const invalidCases: Array<[string, unknown, RegExp]> = [
    ['a non-object', 'nope', /options must be an object/],
    ['an unknown key', {langauges: ['plantuml']}, /Unknown option 'langauges'/],
    ['several unknown keys', {a: 1, b: 2}, /Unknown options 'a', 'b'/],
    ['an invalid theme', {theme: 'sepia'}, /options\.theme must be one of/],
    ['an invalid cache mode', {cache: 'disk'}, /options\.cache must be one of/],
    ['a non-boolean lazy', {lazy: 'yes'}, /options\.lazy must be a boolean/],
    ['a non-boolean sanitizeSvg', {sanitizeSvg: 1}, /options\.sanitizeSvg must be a boolean/],
    ['languages that are not an array', {languages: 'plantuml'}, /must be an array of strings/],
    ['an empty languages array', {languages: []}, /at least one language/],
    ['a non-string language', {languages: [42]}, /options\.languages\[0\] must be a non-empty/],
    ['a blank language', {languages: ['  ']}, /options\.languages\[0\] must be a non-empty/],
    ['duplicate languages', {languages: ['puml', 'PUML']}, /duplicate entries: 'puml'/],
    ['a non-numeric timeout', {renderTimeoutMs: '20s'}, /must be a finite number/],
    ['a non-integer timeout', {renderTimeoutMs: 1.5}, /must be an integer/],
    ['a timeout below the minimum', {renderTimeoutMs: 10}, /must be between 100 and 600000/],
    ['a timeout above the maximum', {renderTimeoutMs: 900_000}, /must be between 100 and 600000/],
    ['a zero cache limit', {cacheMaxEntries: 0}, /must be a positive integer/],
    ['a non-boolean zoom', {zoom: 'yes'}, /options\.zoom must be a boolean/],
  ];

  it.each(invalidCases)('rejects %s', (_name, options, expectedMessage) => {
    expect(() => resolveOptions(options)).toThrow(PlantUmlOptionsError);
    expect(() => resolveOptions(options)).toThrow(expectedMessage);
  });

  it('names the plugin in every error message so the source is obvious', () => {
    expect(() => resolveOptions({theme: 'sepia'})).toThrow(/\[docusaurus-plugin-plantuml-client\]/);
  });

  it('accepts the Docusaurus-injected id without complaining', () => {
    expect(() => resolveOptions({id: 'second-instance'})).not.toThrow();
  });
});

describe('validateOptions hook', () => {
  it('returns the options with the default Docusaurus plugin id applied', () => {
    expect(validateOptions({options: {theme: 'dark'}})).toEqual({theme: 'dark', id: 'default'});
  });

  it('preserves an explicit plugin id', () => {
    expect(validateOptions({options: {id: 'second'}})).toEqual({id: 'second'});
  });

  it('throws for invalid configuration so the Docusaurus build fails early', () => {
    expect(() => validateOptions({options: {cache: 'disk'} as never})).toThrow(
      PlantUmlOptionsError,
    );
  });
});

describe('plugin factory', () => {
  const context = {siteDir: '/site', siteConfig: {baseUrl: '/'}} as never;

  it('exposes the stable plugin name used as the global-data key', () => {
    expect(plantumlPlugin(context, {}).name).toBe('docusaurus-plugin-plantuml-client');
  });

  it('publishes resolved options, the assets directory and the engine version', () => {
    const plugin = plantumlPlugin(context, {theme: 'dark'});
    let published: unknown;
    void plugin.contentLoaded?.({
      content: undefined,
      actions: {setGlobalData: (data: unknown) => (published = data)},
      allContent: {},
    } as never);

    expect(published).toMatchObject({
      options: expect.objectContaining({theme: 'dark', languages: ['plantuml', 'puml']}),
      assetsDir: expect.stringMatching(/^assets\/plantuml-client-\d+\.\d+\.\d+$/),
      coreVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/),
    });
  });

  it('points the theme path at the compiled theme directory', () => {
    expect(plantumlPlugin(context, {}).getThemePath?.()).toMatch(/theme$/);
  });
});
