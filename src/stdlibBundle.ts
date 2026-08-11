import fs from 'node:fs';
import path from 'node:path';

import {findStdlibIncludes, STDLIB_EXAMPLES_DIRECTORY} from './stdlibShared.js';

/**
 * Turns a `plantuml-stdlib` namespace directory into the JavaScript bundle that
 * `@plantuml/core` resolves `!include <namespace/file>` against.
 *
 * The engine reads three globals, all keyed by a *lower-cased* namespace and a *lower-cased*
 * path with the extension stripped:
 *
 * ```js
 * window.PLANTUML_STDLIB['c4']['c4_container'] = ['line', 'line', ...]
 * window.PLANTUML_STDLIB_JSON['awslib10']['awslib10']    = { ... }
 * window.PLANTUML_STDLIB_INFO['c4']                      = { name: 'C4', license: 'MIT', ... }
 * ```
 *
 * That layout is not documented anywhere; it was read out of the installed `plantuml.js`
 * (helpers `CCf`, `DJm` and `DID`) and reproduced from upstream's own generator,
 * `src/main/java/com/plantuml/stdlibencoder/js/JsBuilder.java` in plantuml/plantuml-stdlib.
 * See `docs/adr/0005-stdlib-bundles.md`.
 *
 * This port deviates from upstream in exactly one way, and deliberately: every entry is also
 * registered under its name *with* the `.puml` (or `.json`) suffix. Upstream strips the
 * suffix while the engine looks the name up as written, so `!include <C4/C4_Container.puml>`
 * — a spelling that appears throughout C4-PlantUML's own documentation — cannot resolve
 * against an upstream bundle. Both spellings share one array, so the alias costs no memory.
 */

/** Bumped when the emitted bundle layout changes in a way a stale manifest cannot describe. */
export const STDLIB_BUNDLE_FORMAT = 1;

export interface StdlibNamespaceBundle {
  /** Lower-cased namespace key, as the engine looks it up: `c4`, `awslib10`. */
  namespace: string;
  /** Directory name as it appears upstream, which is not always lower case: `C4`. */
  directoryName: string;
  /** The bundle source, ready to be written as `<namespace>.min.js`. */
  script: string;
  /** The namespace's README front matter: `display_name`, `version`, `license`, `source`. */
  info: Record<string, string>;
  /**
   * Other namespaces this one includes from its *library* files. Loading the namespace
   * without these leaves the engine unable to resolve those includes.
   */
  dependencies: string[];
  /**
   * Other namespaces included only from `_examples_/`. Kept apart because they are dead
   * weight for everyone who includes the library itself: C4's examples pull in `office`,
   * 1.4 MB that a C4 diagram has no use for.
   */
  exampleDependencies: string[];
  /** Number of `.puml` and `.json` files registered. */
  fileCount: number;
}

/**
 * Upstream's rule: `_foo_` directories hold metadata and are skipped, except `_examples_`,
 * which holds includable examples. Mirrored so a bundle carries the same files as the
 * `.repx` the PlantUML jar would use.
 */
function isSkippedDirectory(name: string): boolean {
  if (name === STDLIB_EXAMPLES_DIRECTORY) return false;
  return name.startsWith('_') && name.endsWith('_');
}

interface CollectedFile {
  /** Lower-cased path relative to the namespace directory, extension intact. */
  key: string;
  absolutePath: string;
  extension: '.puml' | '.json';
  fromExamples: boolean;
}

function collectFiles(directory: string, namespaceRoot: string): CollectedFile[] {
  const entries = fs
    .readdirSync(directory, {withFileTypes: true})
    // Sorted so a regenerated bundle is byte-identical on every platform.
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const files: CollectedFile[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!isSkippedDirectory(entry.name)) files.push(...collectFiles(absolutePath, namespaceRoot));
      continue;
    }
    const extension = path.extname(entry.name).toLowerCase();
    if (extension !== '.puml' && extension !== '.json') continue;
    const key = path.relative(namespaceRoot, absolutePath).split(path.sep).join('/').toLowerCase();
    files.push({
      key,
      absolutePath,
      extension,
      fromExamples: key.startsWith(`${STDLIB_EXAMPLES_DIRECTORY}/`),
    });
  }
  return files;
}

/**
 * Reads the YAML front matter every stdlib namespace README carries.
 *
 * Deliberately not a YAML parser: upstream's own reader accepts flat `key: value` lines and
 * nothing else, and matching it keeps the emitted `PLANTUML_STDLIB_INFO` identical.
 */
function readNamespaceInfo(namespaceRoot: string): Record<string, string> {
  const readme = path.join(namespaceRoot, 'README.md');
  if (!fs.existsSync(readme)) return {};
  const lines = fs.readFileSync(readme, 'utf8').split(/\r\n|\r|\n/);
  if (lines[0]?.trim() !== '---') return {};

  const info: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (trimmed === '---') break;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    info[trimmed.slice(0, colon).trim()] = trimmed.slice(colon + 1).trim();
  }
  return info;
}

/**
 * `JSON.stringify` output is valid JavaScript except for U+2028/U+2029, which are legal in
 * JSON strings and were illegal in JavaScript ones before ES2019. Escaping them keeps the
 * bundle parseable by anything that can run the site.
 */
function toJsLiteral(value: unknown): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Re-serializes a `.json` file so the bundle registers an object rather than a string.
 *
 * Parsing first is what makes that safe: a malformed file becomes a build error naming the
 * file, instead of a syntax error inside a 500 KB generated bundle in a reader's browser.
 */
function toJsonLiteral(text: string, file?: string): string {
  try {
    return toJsLiteral(JSON.parse(text));
  } catch (cause) {
    throw new Error(`'${file ?? 'a standard library JSON file'}' is not valid JSON.`, {cause});
  }
}

/** Strips the extension the way the engine does before looking a name up. */
function withoutExtension(key: string): string {
  return key.replace(/\.(puml|json)$/, '');
}

/** The file name a namespace's bundle is served under. The engine's own loader assumes it. */
export function stdlibBundleFileName(namespace: string): string {
  return `${namespace.toLowerCase()}.min.js`;
}

/**
 * Builds the bundle for one namespace directory of a `plantuml-stdlib` checkout.
 *
 * @param stdlibRoot the checkout's `stdlib/` directory
 * @param directoryName the namespace directory inside it, spelled as it is on disk
 */
export function buildStdlibNamespace(
  stdlibRoot: string,
  directoryName: string,
): StdlibNamespaceBundle {
  const namespaceRoot = path.join(stdlibRoot, directoryName);
  if (!fs.existsSync(namespaceRoot) || !fs.statSync(namespaceRoot).isDirectory()) {
    throw new Error(`'${namespaceRoot}' is not a plantuml-stdlib namespace directory.`);
  }

  const namespace = directoryName.toLowerCase();
  const info = readNamespaceInfo(namespaceRoot);
  const files = collectFiles(namespaceRoot, namespaceRoot);

  const dependencies = new Set<string>();
  const exampleDependencies = new Set<string>();

  const quoted = toJsLiteral(namespace);
  const lines: string[] = [
    `// ${namespace}.min.js - generated from plantuml-stdlib by @matfsw/docusaurus-plantuml-plugin.`,
    '(function () {',
    '  var w = window;',
    '  w.PLANTUML_STDLIB = w.PLANTUML_STDLIB || {};',
    '  w.PLANTUML_STDLIB_JSON = w.PLANTUML_STDLIB_JSON || {};',
    '  w.PLANTUML_STDLIB_INFO = w.PLANTUML_STDLIB_INFO || {};',
    `  w.PLANTUML_STDLIB_INFO[${quoted}] = ${toJsLiteral(info)};`,
    `  var P = (w.PLANTUML_STDLIB[${quoted}] = w.PLANTUML_STDLIB[${quoted}] || {});`,
    `  var J = (w.PLANTUML_STDLIB_JSON[${quoted}] = w.PLANTUML_STDLIB_JSON[${quoted}] || {});`,
  ];

  for (const file of files) {
    const text = fs.readFileSync(file.absolutePath, 'utf8');
    const bare = withoutExtension(file.key);
    const target = file.extension === '.puml' ? 'P' : 'J';
    // `.puml` becomes an array of lines and `.json` an object: the engine reads the two
    // globals differently, joining the first with newlines and indexing into the second.
    const value =
      file.extension === '.puml'
        ? toJsLiteral(text.split(/\r\n|\r|\n/))
        : toJsonLiteral(text, file.absolutePath);
    lines.push(
      `  ${target}[${toJsLiteral(bare)}] = ${target}[${toJsLiteral(file.key)}] = ${value};`,
    );

    if (file.extension !== '.puml') continue;
    for (const reference of findStdlibIncludes(text)) {
      if (reference.namespace === namespace) continue;
      (file.fromExamples ? exampleDependencies : dependencies).add(reference.namespace);
    }
  }

  lines.push('})();', '');

  return {
    namespace,
    directoryName,
    script: lines.join('\n'),
    info,
    dependencies: [...dependencies].sort(),
    // An example-only dependency that the library already needs is not worth recording twice.
    exampleDependencies: [...exampleDependencies].filter((name) => !dependencies.has(name)).sort(),
    fileCount: files.length,
  };
}

/** Namespace directories of a `plantuml-stdlib` checkout, in on-disk spelling. */
export function listStdlibNamespaceDirectories(stdlibRoot: string): string[] {
  return fs
    .readdirSync(stdlibRoot, {withFileTypes: true})
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}
