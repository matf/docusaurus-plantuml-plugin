import fs from 'node:fs';
import path from 'node:path';

import {
  MAX_DIAGRAM_SIZE,
  PLANTUML_MODULE_FILENAME,
  PLUGIN_NAME,
  UPSTREAM_MAX_DIAGRAM_SIZE,
} from './constants.js';

/**
 * Raises the diagram size ceiling compiled into `@plantuml/core`.
 *
 * The engine measures the laid-out diagram and refuses to serialize anything wider or taller
 * than 4096 points, reporting `Diagram too large for browser rendering: 78x12916 (max 4096)`
 * through its error callback. `renderToString` takes only `{dark}`, so there is no option to
 * turn this off, and no way to work around it from diagram source: the check runs *before* a
 * `scale` directive is applied, `skinparam dpi` does not move it, and `left to right
 * direction` only transposes the two numbers. Shrinking the Graphviz layout by hand —
 * `skinparam ranksep`, fewer nodes, smaller fonts — is the only lever an author has.
 *
 * The ceiling is arbitrary. It is not an SVG or a browser constraint; patched to 65536 the
 * same engine produced correct SVG for a 79x43157 diagram. So this plugin patches it, and
 * serves the patched file rather than the vendored one.
 *
 * See `docs/adr/0007-engine-size-ceiling-patch.md` for the evidence and the rejected
 * alternatives.
 */

/**
 * The comparison the engine guards on, as it appears in the minified bundle:
 *
 * ```js
 * p=o.bBY;if(!(p>4096.0)){q=o.bB0;if(!(q>4096.0)){ …serialize… }}
 * ```
 *
 * Deliberately anchored on `>4096.0)` rather than on the surrounding code: `p`, `q` and `o`
 * are TeaVM-mangled locals that are renamed by every `@plantuml/core` build, so a pattern
 * that named them would break on a release that changed nothing meaningful.
 */
const COMPARISON = `>${UPSTREAM_MAX_DIAGRAM_SIZE}.0)`;

/**
 * `4096.0` occurs exactly twice in the whole 7 MB bundle, and both occurrences are the width
 * and height halves of this one guard. That makes the count the safety property: two matches
 * means the engine still has the shape this patch was written against, and any other number
 * means it does not.
 */
const COMPARISON_OCCURRENCES = 2;

/** The suffix of the engine's own error message, in TeaVM's string pool. */
const MESSAGE_SUFFIX = ` (max ${UPSTREAM_MAX_DIAGRAM_SIZE})`;

const MESSAGE_SUFFIX_OCCURRENCES = 1;

const PATCHED_COMPARISON = `>${MAX_DIAGRAM_SIZE}.0)`;
const PATCHED_MESSAGE_SUFFIX = ` (max ${MAX_DIAGRAM_SIZE})`;

/**
 * How many bytes the patch adds. Every replacement is ASCII, so the byte delta is the
 * character delta, and it is fixed for a given {@link MAX_DIAGRAM_SIZE}. This is what makes
 * an already-generated file cheap to validate: its size is an exact fingerprint.
 */
export const PATCH_SIZE_DELTA =
  COMPARISON_OCCURRENCES * (PATCHED_COMPARISON.length - COMPARISON.length) +
  MESSAGE_SUFFIX_OCCURRENCES * (PATCHED_MESSAGE_SUFFIX.length - MESSAGE_SUFFIX.length);

/** Directory under the Docusaurus cache that generated engine builds live in. */
const CACHE_SUBDIRECTORY = 'plantuml-engine';

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function assertOccurrences(
  source: string,
  needle: string,
  expected: number,
  coreVersion: string,
): void {
  const found = countOccurrences(source, needle);
  if (found === expected) return;
  throw new Error(
    `[${PLUGIN_NAME}] Cannot raise the diagram size ceiling of ` +
      `'@plantuml/core@${coreVersion}': expected ${expected} occurrence(s) of ` +
      `${JSON.stringify(needle)} in '${PLANTUML_MODULE_FILENAME}', found ${found}. ` +
      'The engine no longer has the shape this plugin patches, which means the installed ' +
      '@plantuml/core is not one this plugin supports. Pin @plantuml/core to the last ' +
      'version that worked, or upgrade this plugin.',
  );
}

/**
 * Rewrites the engine source so it accepts diagrams up to {@link MAX_DIAGRAM_SIZE} points.
 *
 * Both literals are counted *before* anything is replaced, so an engine that changed shape
 * fails the build with a name attached rather than being silently half-patched. Patching the
 * message as well as the comparison is not cosmetic — an engine that still reported
 * `(max 4096)` while refusing at 32768 would send every future reader of that error down the
 * wrong path. It is also safe: TeaVM's string pool is a plain list of JavaScript string
 * literals, so a literal that changes length does not disturb its neighbours.
 */
export function patchEngineSource(source: string, coreVersion: string): string {
  assertOccurrences(source, COMPARISON, COMPARISON_OCCURRENCES, coreVersion);
  assertOccurrences(source, MESSAGE_SUFFIX, MESSAGE_SUFFIX_OCCURRENCES, coreVersion);

  return source
    .split(COMPARISON)
    .join(PATCHED_COMPARISON)
    .split(MESSAGE_SUFFIX)
    .join(PATCHED_MESSAGE_SUFFIX);
}

export interface ResolvePatchedEngineOptions {
  /** Absolute path of the vendored `plantuml.js` inside the installed `@plantuml/core`. */
  vendoredPath: string;
  /** Installed `@plantuml/core` version, which names the cache directory. */
  coreVersion: string;
  /** Site directory, used when `cacheDir` is absent. */
  siteDir: string;
  /**
   * Where the patched engine is cached. Docusaurus passes its `generatedFilesDir`; when it
   * is absent the site's `.docusaurus` directory is assumed, as in `src/stdlib.ts`.
   */
  cacheDir?: string;
}

/**
 * Returns the path of the `plantuml.js` this build should serve, generating it if needed.
 *
 * The basename stays `plantuml.js`: the copy pattern emits `[name][ext]`, and the browser
 * loader joins {@link PLANTUML_MODULE_FILENAME} onto the assets directory.
 *
 * Generation is skipped when the cached file is already the right size. That check is exact
 * rather than approximate — {@link PATCH_SIZE_DELTA} is fixed — and it is O(1) where reading
 * 7 MB back to inspect its contents would not be.
 */
export function resolvePatchedEngine(options: ResolvePatchedEngineOptions): string {
  const {vendoredPath, coreVersion, siteDir, cacheDir} = options;
  const generatedDir = cacheDir ?? path.join(siteDir, '.docusaurus');
  const target = path.join(generatedDir, CACHE_SUBDIRECTORY, coreVersion, PLANTUML_MODULE_FILENAME);
  const expectedSize = fs.statSync(vendoredPath).size + PATCH_SIZE_DELTA;

  if (fs.existsSync(target) && fs.statSync(target).size === expectedSize) return target;

  const patched = patchEngineSource(fs.readFileSync(vendoredPath, 'utf8'), coreVersion);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  // `.docusaurus` is shared by every locale, and Docusaurus builds locales in separate
  // processes. Writing 7 MB in place would let a concurrent build read a torn file — and a
  // torn file of the right length would pass the size check above. Rename is atomic.
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, patched, 'utf8');
  fs.renameSync(temporary, target);
  return target;
}
