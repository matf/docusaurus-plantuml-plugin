import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {DEFAULT_STDLIB_OPTIONS, type ResolvedStdlibOptions} from '../../src/options.js';
import {resolveStdlibAssets} from '../../src/stdlib.js';

/**
 * `src/`, which is where the resolver looks for `../assets/stdlib` from. Taken from the
 * working directory rather than `import.meta.url`, which is not a file URL under vitest's
 * jsdom environment.
 */
const currentDir = path.join(process.cwd(), 'src');

const created: string[] = [];

afterEach(() => {
  while (created.length > 0) fs.rmSync(created.pop() as string, {recursive: true, force: true});
});

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plantuml-stdlib-site-'));
  created.push(directory);
  return directory;
}

function resolve(options: Partial<ResolvedStdlibOptions> = {}, siteDir = temporaryDirectory()) {
  return resolveStdlibAssets({
    options: {...DEFAULT_STDLIB_OPTIONS, ...options},
    currentDir,
    siteDir,
    cacheDir: path.join(siteDir, '.docusaurus'),
  });
}

function names(files: string[]): string[] {
  return files.map((file) => path.basename(file)).sort();
}

describe('resolving the standard library for a site build', () => {
  it('emits every vendored namespace by default', () => {
    const assets = resolve();
    expect(assets).not.toBeNull();
    expect(names(assets!.files)).toContain('c4.min.js');
    expect(Object.keys(assets!.manifest.namespaces)).toContain('c4');
    expect(assets!.manifest.revision).toMatch(/^[0-9a-f]{12}$/);
  });

  it('emits nothing when the standard library is switched off', () => {
    expect(resolve({enabled: false})).toBeNull();
  });

  it('narrows the emitted set to the named namespaces', () => {
    const assets = resolve({namespaces: ['c4']});
    expect(names(assets!.files)).toEqual(['c4.min.js']);
    expect(Object.keys(assets!.manifest.namespaces)).toEqual(['c4']);
  });

  it('keeps a narrowed namespace usable by emitting what it depends on', () => {
    // `k8s/Common` includes `<c4/…>`; emitting one without the other could not render.
    const assets = resolve({namespaces: ['k8s']});
    expect(names(assets!.files)).toEqual(['c4.min.js', 'k8s.min.js']);
  });

  it('rejects narrowing to a namespace that is not vendored', () => {
    expect(() => resolve({namespaces: ['aws']})).toThrow(/'aws'.*not vendored/s);
  });

  it('generates a namespace named in include from a checkout, and caches it', () => {
    const siteDir = temporaryDirectory();
    const checkout = path.join(siteDir, 'vendor', 'stdlib');
    fs.mkdirSync(path.join(checkout, 'Fake'), {recursive: true});
    fs.writeFileSync(path.join(checkout, 'Fake', 'Thing.puml'), 'body', 'utf8');

    const assets = resolve(
      {include: ['fake'], source: ['vendor/stdlib'], namespaces: ['c4']},
      siteDir,
    );

    expect(names(assets!.files)).toEqual(['c4.min.js', 'fake.min.js']);
    const generated = assets!.files.find((file) => file.endsWith('fake.min.js')) as string;
    expect(fs.readFileSync(generated, 'utf8')).toContain('"thing"');

    // The second build reuses the cached file rather than regenerating it.
    const again = resolve(
      {include: ['fake'], source: ['vendor/stdlib'], namespaces: ['c4']},
      siteDir,
    );
    expect(again!.files).toContain(generated);
  });

  it('replaces a vendored namespace when the same name is included from a checkout', () => {
    const siteDir = temporaryDirectory();
    const checkout = path.join(siteDir, 'stdlib');
    fs.mkdirSync(path.join(checkout, 'C4'), {recursive: true});
    fs.writeFileSync(path.join(checkout, 'C4', 'C4.puml'), 'newer', 'utf8');

    const assets = resolve({include: ['c4'], source: ['stdlib'], namespaces: ['c4']}, siteDir);

    expect(names(assets!.files)).toEqual(['c4.min.js']);
    expect(fs.readFileSync(assets!.files[0] as string, 'utf8')).toContain('newer');
  });

  it('names the missing namespace and how to obtain it', () => {
    const siteDir = temporaryDirectory();
    expect(() => resolve({include: ['aws'], source: ['vendor/stdlib']}, siteDir)).toThrow(
      /'aws'.*plantuml-stdlib/s,
    );
  });

  it('changes the revision when an included namespace changes', () => {
    const siteDir = temporaryDirectory();
    const namespaceDir = path.join(siteDir, 'stdlib', 'Fake');
    fs.mkdirSync(namespaceDir, {recursive: true});
    const file = path.join(namespaceDir, 'Thing.puml');
    fs.writeFileSync(file, 'first', 'utf8');
    const before = resolve({include: ['fake'], source: ['stdlib']}, siteDir)!.manifest.revision;

    fs.writeFileSync(file, 'second and longer', 'utf8');
    const after = resolve({include: ['fake'], source: ['stdlib']}, siteDir)!.manifest.revision;

    expect(after).not.toBe(before);
  });

  it('is stable across builds when nothing changed', () => {
    expect(resolve()!.manifest.revision).toBe(resolve()!.manifest.revision);
  });

  it('publishes only what the browser needs, not the vendoring metadata', () => {
    const entry = resolve({namespaces: ['c4']})!.manifest.namespaces.c4;
    expect(Object.keys(entry ?? {}).sort()).toEqual(['dependencies', 'exampleDependencies']);
  });
});
