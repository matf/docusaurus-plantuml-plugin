import {describe, expect, it} from 'vitest';

// @ts-expect-error -- plain ESM helper shared by the release scripts, deliberately untyped.
import {parsePackResult} from '../../scripts/lib/pack-output.mjs';

/**
 * `npm pack --json` has broken two releases: npm 11 emits an array of results while newer npm
 * emits an object keyed by package name, and `actions/setup-node` provokes warnings that land
 * on stdout beside the payload. Both shapes and both kinds of noise are pinned here.
 */

const ENTRY = {
  id: '@scope/pkg@1.0.0',
  name: '@scope/pkg',
  version: '1.0.0',
  size: 54047,
  unpackedSize: 169597,
  filename: 'scope-pkg-1.0.0.tgz',
  files: [
    {path: 'dist/index.js', size: 3000},
    {path: 'README.md', size: 1000},
  ],
  entryCount: 2,
  bundled: [],
};

const ARRAY_SHAPE = JSON.stringify([ENTRY], null, 2);
const OBJECT_SHAPE = JSON.stringify({'@scope/pkg': ENTRY}, null, 2);

const LEADING = 'npm warn Unknown user config "always-auth". This will stop working.\n';
const TRAILING = '\nnpm notice run something afterwards\n';

describe('parsePackResult', () => {
  it.each([
    ['the npm 11 array shape', ARRAY_SHAPE],
    ['the newer object shape', OBJECT_SHAPE],
  ])('reads %s', (_name, payload) => {
    const result = parsePackResult(payload);
    expect(result.filename).toBe('scope-pkg-1.0.0.tgz');
    expect(result.entryCount).toBe(2);
    expect(result.files.map((file: {path: string}) => file.path)).toEqual([
      'dist/index.js',
      'README.md',
    ]);
  });

  it.each([
    ['leading warnings', LEADING + ARRAY_SHAPE],
    ['trailing notices', ARRAY_SHAPE + TRAILING],
    ['noise on both sides', LEADING + ARRAY_SHAPE + TRAILING],
    ['leading warnings, object shape', LEADING + OBJECT_SHAPE],
    ['trailing notices, object shape', OBJECT_SHAPE + TRAILING],
    ['noise on both sides, object shape', LEADING + OBJECT_SHAPE + TRAILING],
  ])('tolerates %s', (_name, payload) => {
    expect(parsePackResult(payload).filename).toBe('scope-pkg-1.0.0.tgz');
  });

  it('is not fooled by a bracket inside the payload', () => {
    // `"bundled": []` once matched a naive search for the last closing bracket.
    expect(parsePackResult(OBJECT_SHAPE + TRAILING).files).toHaveLength(2);
  });

  it('reports output containing no JSON at all', () => {
    expect(() => parsePackResult('npm error code E404\n')).toThrow(/Found no JSON/);
  });

  it('reports a payload that is JSON but not a pack result', () => {
    expect(() => parsePackResult('{"unexpected": true}')).toThrow(/unexpected payload/);
    expect(() => parsePackResult('[]')).toThrow(/unexpected payload/);
  });
});
