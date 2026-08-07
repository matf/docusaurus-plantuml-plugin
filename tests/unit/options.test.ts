import {describe, expect, it} from 'vitest';

import {
  DEFAULT_OPTIONS,
  GRAPHVIZ_ENGINES,
  PlantUmlOptionsError,
  resolveOptions,
} from '../../src/options.js';
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
      showSource: true,
      graphviz: {
        enabled: true,
        languages: ['dot', 'graphviz', 'gv'],
        engine: 'dot',
        allowEngineOverride: true,
        maxSourceBytes: 100_000,
        transparentBackground: true,
      },
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

describe('graphviz options', () => {
  it('defaults to the three usual DOT fence languages', () => {
    expect(resolveOptions({}).graphviz).toEqual({
      enabled: true,
      languages: ['dot', 'graphviz', 'gv'],
      engine: 'dot',
      allowEngineOverride: true,
      maxSourceBytes: 100_000,
      transparentBackground: true,
    });
  });

  it('keeps user values and fills the rest from defaults', () => {
    const {graphviz} = resolveOptions({graphviz: {engine: 'neato', languages: ['DOT']}});
    expect(graphviz.engine).toBe('neato');
    // Normalized to lower case, exactly as the top-level `languages` option is.
    expect(graphviz.languages).toEqual(['dot']);
    expect(graphviz.allowEngineOverride).toBe(true);
  });

  it('does not share the default languages array between calls', () => {
    resolveOptions(undefined).graphviz.languages.push('mutated');
    expect(resolveOptions(undefined).graphviz.languages).toEqual(['dot', 'graphviz', 'gv']);
  });

  it('rejects an unknown nested key rather than ignoring a typo', () => {
    expect(() => resolveOptions({graphviz: {enigne: 'neato'}})).toThrow(PlantUmlOptionsError);
    expect(() => resolveOptions({graphviz: {enigne: 'neato'}})).toThrow(/graphviz\.enigne/);
  });

  it('rejects a layout engine Graphviz does not have', () => {
    expect(() => resolveOptions({graphviz: {engine: 'spring'}})).toThrow(
      /options\.graphviz\.engine must be one of/,
    );
  });

  it('accepts every engine the bundled build ships', () => {
    GRAPHVIZ_ENGINES.forEach((engine) => {
      expect(resolveOptions({graphviz: {engine}}).graphviz.engine).toBe(engine);
    });
  });

  it('rejects a non-object graphviz group', () => {
    expect(() => resolveOptions({graphviz: 'yes'})).toThrow(/options\.graphviz must be an object/);
  });

  it('rejects a non-boolean flag', () => {
    expect(() => resolveOptions({graphviz: {enabled: 'yes'}})).toThrow(
      /options\.graphviz\.enabled must be a boolean/,
    );
  });

  it('rejects an empty or malformed language list', () => {
    expect(() => resolveOptions({graphviz: {languages: []}})).toThrow(
      /options\.graphviz\.languages must contain at least one language/,
    );
    expect(() => resolveOptions({graphviz: {languages: ['dot', 'dot']}})).toThrow(
      /options\.graphviz\.languages contains duplicate entries/,
    );
    expect(() => resolveOptions({graphviz: {languages: [42]}})).toThrow(
      /options\.graphviz\.languages\[0\] must be a non-empty string/,
    );
  });

  it('rejects a maxSourceBytes that is not a positive integer', () => {
    expect(() => resolveOptions({graphviz: {maxSourceBytes: 0}})).toThrow(
      /must be a positive integer/,
    );
    expect(() => resolveOptions({graphviz: {maxSourceBytes: 1.5}})).toThrow(
      /must be a positive integer/,
    );
  });

  it('refuses a language claimed by both engines', () => {
    // A fence has one language, so letting both engines claim it would make the output depend
    // on the order the wrapper happens to check them in.
    expect(() => resolveOptions({languages: ['dot'], graphviz: {languages: ['dot']}})).toThrow(
      /both claim 'dot'/,
    );
  });

  it('allows an overlap when Graphviz is switched off', () => {
    const resolved = resolveOptions({
      languages: ['dot'],
      graphviz: {enabled: false, languages: ['dot']},
    });
    expect(resolved.languages).toEqual(['dot']);
    expect(resolved.graphviz.enabled).toBe(false);
  });

  it('reaches the build through validateOptions', () => {
    expect(() => validateOptions({options: {graphviz: {engine: 'nope' as never}}})).toThrow(
      PlantUmlOptionsError,
    );
  });

  it('publishes the graphviz group to the browser', () => {
    const plugin = plantumlPlugin({siteDir: '/tmp'} as never, {graphviz: {engine: 'twopi'}});
    let published: {options?: {graphviz?: unknown}} | undefined;
    void plugin.contentLoaded?.({
      content: undefined,
      actions: {setGlobalData: (data: never) => (published = data)},
      allContent: {},
    } as never);

    expect(published?.options?.graphviz).toMatchObject({engine: 'twopi', enabled: true});
  });
});
