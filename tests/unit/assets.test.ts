import fs from 'node:fs';

import {afterEach, describe, expect, it, vi} from 'vitest';

import {locatePlantUmlCore} from '../../src/assets.js';

/**
 * The build-time half of the §8.1 mitigation.
 *
 * `viz-global.js` is the Graphviz engine this plugin renders DOT with, but it reaches the
 * build through `@plantuml/core`, which ships it for PlantUML's own layout. A dependency bump
 * that dropped or renamed it must fail the build with a name attached, rather than reaching a
 * reader's browser as an unexplained runtime load failure.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('locating the runtime assets', () => {
  it('finds both runtime files in the installed @plantuml/core', () => {
    const core = locatePlantUmlCore();

    expect(core.files).toHaveLength(2);
    core.files.forEach((file) => expect(fs.existsSync(file)).toBe(true));
  });

  it('really does ship the Graphviz engine this plugin renders DOT with', () => {
    // Not a tautology: this reads the file and checks it is the Viz.js build, so an upstream
    // swap to a different layout engine fails here rather than in a browser.
    const viz = locatePlantUmlCore().files.find((file) => file.endsWith('viz-global.js'));
    expect(viz).toBeDefined();

    const head = fs.readFileSync(viz as string, 'utf8').slice(0, 400);
    expect(head).toMatch(/Viz\.js \d+\.\d+\.\d+/);
    expect(head).toMatch(/Graphviz/);
  });

  it('bundles the WebAssembly inline, so no CDN or side-car .wasm is ever fetched', () => {
    // The plugin's "no CDN" promise depends on this: the engine is one self-contained file.
    const viz = locatePlantUmlCore().files.find((file) => file.endsWith('viz-global.js'));
    const source = fs.readFileSync(viz as string, 'utf8');

    expect(source).toContain('data:application/octet-stream;base64,');
    expect(source).not.toMatch(/https?:\/\/unpkg\.com|https?:\/\/cdn\./);
  });

  it('fails the build when viz-global.js is missing from @plantuml/core', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((file) =>
      String(file).endsWith('viz-global.js') ? false : true,
    );

    expect(() => locatePlantUmlCore()).toThrow(/does not contain 'viz-global\.js'/);
    expect(() => locatePlantUmlCore()).toThrow(/\[docusaurus-plugin-plantuml-client\]/);
  });

  it('fails the build when plantuml.js is missing from @plantuml/core', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((file) =>
      String(file).endsWith('plantuml.js') ? false : true,
    );

    expect(() => locatePlantUmlCore()).toThrow(/does not contain 'plantuml\.js'/);
  });

  it('names the installed version in the failure, so the cause is obvious', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    expect(() => locatePlantUmlCore()).toThrow(/@plantuml\/core@\d+\.\d+\.\d+/);
  });
});
