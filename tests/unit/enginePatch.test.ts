import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {locatePlantUmlCore} from '../../src/assets.js';
import {MAX_DIAGRAM_SIZE, PLANTUML_MODULE_FILENAME} from '../../src/constants.js';
import {patchEngineSource, PATCH_SIZE_DELTA, resolvePatchedEngine} from '../../src/enginePatch.js';

/**
 * The canary for `src/enginePatch.ts`.
 *
 * The patch is anchored on two literals in `@plantuml/core`'s minified bundle. Dependabot
 * bumps that dependency in a group whose PRs auto-merge, and releases are cut from every
 * green `main`, so a TeaVM codegen change that moved those literals would otherwise ship and
 * surface as a broken build in a consumer's project. Running the patcher against the real
 * installed engine here turns that into a red dependency PR instead.
 */

const engineSource = (): string => {
  const file = locatePlantUmlCore().files.find((entry) => entry.endsWith(PLANTUML_MODULE_FILENAME));
  return fs.readFileSync(file as string, 'utf8');
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop() as string, {recursive: true, force: true});
  }
});

function makeCacheDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plantuml-engine-patch-'));
  temporaryDirectories.push(dir);
  return dir;
}

describe('patching the engine size ceiling', () => {
  it('finds exactly the anchors it expects in the installed @plantuml/core', () => {
    const source = engineSource();

    // Two comparisons — width and height — and one message suffix. Any other count means the
    // engine changed shape and the patch can no longer be trusted.
    expect(source.match(/>4096\.0\)/g)).toHaveLength(2);
    expect(source.match(/ \(max 4096\)/g)).toHaveLength(1);
    // Not a restatement of the line above: it proves both comparisons above are the *only*
    // places the constant appears, which is what makes the count a safety property.
    expect(source.match(/4096\.0/g)).toHaveLength(2);
  });

  it('raises the ceiling and leaves nothing behind', () => {
    const patched = patchEngineSource(engineSource(), '1.0.0');

    expect(patched).not.toContain('>4096.0)');
    expect(patched).not.toContain(' (max 4096)');
    expect(patched.match(new RegExp(`>${MAX_DIAGRAM_SIZE}\\.0\\)`, 'g'))).toHaveLength(2);
    expect(patched).toContain(` (max ${MAX_DIAGRAM_SIZE})`);
  });

  it('changes the source by exactly the advertised number of bytes', () => {
    // `resolvePatchedEngine` reuses a cached build purely on file size, so this equality is
    // load-bearing rather than incidental.
    const source = engineSource();
    const patched = patchEngineSource(source, '1.0.0');

    expect(Buffer.byteLength(patched, 'utf8') - Buffer.byteLength(source, 'utf8')).toBe(
      PATCH_SIZE_DELTA,
    );
  });

  it.each([
    ['no comparison at all', 'if(!(x>1.0)){} " (max 4096)"'],
    ['only one comparison', 'if(!(x>4096.0)){} " (max 4096)"'],
    ['three comparisons', 'a>4096.0)b>4096.0)c>4096.0)" (max 4096)"'],
  ])('refuses to patch an engine with %s', (_label, source) => {
    expect(() => patchEngineSource(source, '9.9.9')).toThrow(/expected 2 occurrence\(s\)/);
    expect(() => patchEngineSource(source, '9.9.9')).toThrow(/@plantuml\/core@9\.9\.9/);
  });

  it('refuses to patch an engine whose error message moved', () => {
    const source = 'if(!(p>4096.0)){if(!(q>4096.0)){}}';

    expect(() => patchEngineSource(source, '9.9.9')).toThrow(/expected 1 occurrence\(s\)/);
    expect(() => patchEngineSource(source, '9.9.9')).toThrow(/\(max 4096\)/);
  });

  it('names the plugin in its failure, so a broken build says who complained', () => {
    expect(() => patchEngineSource('nothing to patch here', '9.9.9')).toThrow(
      /\[docusaurus-plugin-plantuml-client\]/,
    );
  });
});

describe('generating the patched engine', () => {
  it('writes a usable plantuml.js under the cache directory', () => {
    const cacheDir = makeCacheDir();
    const core = locatePlantUmlCore();
    const vendoredPath = core.files.find((entry) =>
      entry.endsWith(PLANTUML_MODULE_FILENAME),
    ) as string;

    const generated = resolvePatchedEngine({
      vendoredPath,
      coreVersion: core.version,
      siteDir: '/site',
      cacheDir,
    });

    // The basename has to survive: the copy pattern emits `[name][ext]` and the browser
    // loader joins 'plantuml.js' onto the assets directory.
    expect(path.basename(generated)).toBe(PLANTUML_MODULE_FILENAME);
    expect(generated.startsWith(cacheDir)).toBe(true);
    expect(fs.statSync(generated).size).toBe(fs.statSync(vendoredPath).size + PATCH_SIZE_DELTA);
    expect(fs.readFileSync(generated, 'utf8')).toContain(` (max ${MAX_DIAGRAM_SIZE})`);
    // No temporary file is left behind by the atomic write.
    expect(fs.readdirSync(path.dirname(generated))).toEqual([PLANTUML_MODULE_FILENAME]);
  });

  it('reuses an existing build instead of rewriting 7 MB every time', () => {
    const cacheDir = makeCacheDir();
    const core = locatePlantUmlCore();
    const vendoredPath = core.files.find((entry) =>
      entry.endsWith(PLANTUML_MODULE_FILENAME),
    ) as string;

    const first = resolvePatchedEngine({
      vendoredPath,
      coreVersion: core.version,
      siteDir: '/site',
      cacheDir,
    });
    const stamp = fs.statSync(first).mtimeMs;
    const second = resolvePatchedEngine({
      vendoredPath,
      coreVersion: core.version,
      siteDir: '/site',
      cacheDir,
    });

    expect(second).toBe(first);
    expect(fs.statSync(second).mtimeMs).toBe(stamp);
  });

  it('regenerates a cached build of the wrong size', () => {
    const cacheDir = makeCacheDir();
    const core = locatePlantUmlCore();
    const vendoredPath = core.files.find((entry) =>
      entry.endsWith(PLANTUML_MODULE_FILENAME),
    ) as string;

    const target = resolvePatchedEngine({
      vendoredPath,
      coreVersion: core.version,
      siteDir: '/site',
      cacheDir,
    });
    fs.writeFileSync(target, 'truncated by a previous, interrupted build', 'utf8');

    const regenerated = resolvePatchedEngine({
      vendoredPath,
      coreVersion: core.version,
      siteDir: '/site',
      cacheDir,
    });

    expect(fs.readFileSync(regenerated, 'utf8')).toContain(` (max ${MAX_DIAGRAM_SIZE})`);
  });
});
