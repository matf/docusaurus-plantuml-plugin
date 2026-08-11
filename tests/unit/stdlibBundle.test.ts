import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {
  buildStdlibNamespace,
  listStdlibNamespaceDirectories,
  stdlibBundleFileName,
} from '../../src/stdlibBundle.js';

const created: string[] = [];

afterEach(() => {
  while (created.length > 0) fs.rmSync(created.pop() as string, {recursive: true, force: true});
});

/** Writes a throwaway `stdlib/` tree: `{'C4/C4.puml': 'contents'}` relative to its root. */
function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plantuml-stdlib-'));
  created.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), {recursive: true});
    fs.writeFileSync(absolute, contents, 'utf8');
  }
  return root;
}

/**
 * Runs a generated bundle the way a browser would, and reports what it registered.
 *
 * The bundle is a script meant for a `<script>` tag, so executing it is the only way to
 * check what it actually registers. `new Function` is the narrowest way to do that: the
 * input is this test's own fixture, and the only global it can reach is the one passed in.
 */
function evaluate(script: string): {
  stdlib: Record<string, Record<string, string[]>>;
  json: Record<string, Record<string, unknown>>;
  info: Record<string, Record<string, string>>;
} {
  const fakeWindow: Record<string, unknown> = {};
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- see the note above
  new Function('window', script)(fakeWindow);
  return {
    stdlib: (fakeWindow.PLANTUML_STDLIB ?? {}) as Record<string, Record<string, string[]>>,
    json: (fakeWindow.PLANTUML_STDLIB_JSON ?? {}) as Record<string, Record<string, unknown>>,
    info: (fakeWindow.PLANTUML_STDLIB_INFO ?? {}) as Record<string, Record<string, string>>,
  };
}

describe('generating a namespace bundle', () => {
  it('registers each file as an array of lines, keyed the way the engine looks it up', () => {
    const root = fixture({'C4/C4_Container.puml': 'first\nsecond\n'});
    const {script} = buildStdlibNamespace(root, 'C4');

    const {stdlib} = evaluate(script);
    // Namespace and path are lower-cased, and the extension is stripped.
    expect(stdlib.c4?.c4_container).toEqual(['first', 'second', '']);
  });

  it('also registers the name with its extension, which upstream does not', () => {
    // `!include <C4/C4_Container.puml>` is how C4-PlantUML's own docs spell it, and the
    // engine looks up the name as written rather than normalizing it.
    const root = fixture({'C4/C4_Container.puml': 'line'});
    const {stdlib} = evaluate(buildStdlibNamespace(root, 'C4').script);

    expect(stdlib.c4?.['c4_container.puml']).toEqual(['line']);
    expect(stdlib.c4?.['c4_container.puml']).toBe(stdlib.c4?.c4_container);
  });

  it('keeps nested paths, so a sprite folder resolves', () => {
    const root = fixture({'k8s/OSS/KubernetesPod.puml': 'sprite'});
    const {stdlib} = evaluate(buildStdlibNamespace(root, 'k8s').script);
    expect(stdlib.k8s?.['oss/kubernetespod']).toEqual(['sprite']);
  });

  it('registers .json files separately, as the engine reads them from another global', () => {
    const root = fixture({'awslib/data.json': '{"a": 1}'});
    const {json} = evaluate(buildStdlibNamespace(root, 'awslib').script);
    // An object, not the file's text: the engine indexes into this one.
    expect(json.awslib?.data).toEqual({a: 1});
    expect(json.awslib?.['data.json']).toEqual({a: 1});
  });

  it('fails on malformed JSON rather than emitting a broken bundle', () => {
    const root = fixture({'awslib/data.json': '{not json}'});
    expect(() => buildStdlibNamespace(root, 'awslib')).toThrow(/is not valid JSON/);
  });

  it('publishes the README front matter as the namespace info', () => {
    const root = fixture({
      'C4/README.md': '---\nname: C4\nversion: 2.13.0\nlicense: MIT\n---\n\nProse.\n',
      'C4/C4.puml': 'x',
    });
    const bundle = buildStdlibNamespace(root, 'C4');

    expect(bundle.info).toEqual({name: 'C4', version: '2.13.0', license: 'MIT'});
    expect(evaluate(bundle.script).info.c4).toEqual(bundle.info);
  });

  it('skips meta folders but keeps _examples_, matching upstream', () => {
    const root = fixture({
      'C4/C4.puml': 'library',
      'C4/_examples_/example.puml': 'example',
      'C4/_tests_/test.puml': 'test',
    });
    const {stdlib} = evaluate(buildStdlibNamespace(root, 'C4').script);

    expect(
      Object.keys(stdlib.c4 ?? {})
        .filter((key) => !key.endsWith('.puml'))
        .sort(),
    ).toEqual(['_examples_/example', 'c4']);
  });

  it('separates dependencies of the library from those of its examples', () => {
    // C4 is exactly this shape: nothing of its own, but its examples reach for `office`.
    const root = fixture({
      'C4/C4.puml': '!include <classy/base>\nbody',
      'C4/_examples_/example.puml': '!include <office/Servers/server>\nbody',
    });
    const bundle = buildStdlibNamespace(root, 'C4');

    expect(bundle.dependencies).toEqual(['classy']);
    expect(bundle.exampleDependencies).toEqual(['office']);
  });

  it('does not record a self-reference as a dependency', () => {
    const root = fixture({
      'C4/C4_Container.puml': '!include <C4/C4_Context>',
      'C4/C4_Context.puml': 'body',
    });
    expect(buildStdlibNamespace(root, 'C4').dependencies).toEqual([]);
  });

  it('is byte-identical when generated twice', () => {
    const root = fixture({'C4/b.puml': 'b', 'C4/a.puml': 'a', 'C4/sub/c.puml': 'c'});
    expect(buildStdlibNamespace(root, 'C4').script).toBe(buildStdlibNamespace(root, 'C4').script);
  });

  it('escapes content that would otherwise break the bundle', () => {
    // U+2028 is legal inside a JSON string but was illegal inside a JavaScript one before
    // ES2019, so `JSON.stringify` alone does not produce safe JavaScript.
    const awkward = 'quote " backslash \\ separator \u2028 paragraph \u2029 done';
    const root = fixture({'x/q.puml': awkward});
    const {stdlib} = evaluate(buildStdlibNamespace(root, 'x').script);
    expect(stdlib.x?.q).toEqual([awkward]);
  });

  it('rejects a directory that is not a namespace', () => {
    const root = fixture({'C4/C4.puml': 'x'});
    expect(() => buildStdlibNamespace(root, 'nope')).toThrow(/not a plantuml-stdlib namespace/);
  });

  it('names the bundle the way the engine expects to request it', () => {
    expect(stdlibBundleFileName('C4')).toBe('c4.min.js');
  });

  it('lists the namespace directories of a checkout', () => {
    const root = fixture({'C4/a.puml': 'a', 'k8s/b.puml': 'b', '.git/config': 'x'});
    expect(listStdlibNamespaceDirectories(root)).toEqual(['C4', 'k8s']);
  });
});
