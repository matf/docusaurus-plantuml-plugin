/**
 * What the Node side and the browser side of standard library support both need: the shape
 * of the manifest, and the one definition of what a `<namespace/…>` include looks like.
 *
 * Deliberately free of `node:` imports. `stdlibBundle.ts` reads the file system and
 * `stdlib.ts` resolves paths; neither may be pulled into a theme component's bundle, and
 * keeping the shared half here is what stops that from happening by accident.
 */

/** One namespace as the browser needs to know about it. Kept small: this ships in global data. */
export interface StdlibNamespaceEntry {
  /** Namespaces the engine will need as soon as this one is included. */
  dependencies: string[];
  /** Namespaces needed only by this one's `_examples_/` files. */
  exampleDependencies: string[];
}

export interface StdlibRuntimeManifest {
  /**
   * Changes whenever the emitted bundles change. Part of the asset directory name, so a
   * refreshed standard library can never be served from a stale HTTP cache, and part of the
   * render cache key, so it can never be served from a stale SVG either.
   */
  revision: string;
  namespaces: Record<string, StdlibNamespaceEntry>;
}

/** Directory holding a namespace's includable examples, which upstream keeps in the bundle. */
export const STDLIB_EXAMPLES_DIRECTORY = '_examples_';

/**
 * `<namespace/path>` in an `!include` and its variants.
 *
 * Anchored to the start of a line because `!include` is only a directive there. Applied to
 * stdlib sources when bundling and to author sources when rendering — one syntax, one place
 * to correct it.
 */
export const STDLIB_INCLUDE_PATTERN =
  /^[^\S\r\n]*!include(?:sub|url|_many)?[^\S\r\n]+<([^>\r\n]+)>/gim;

export interface StdlibIncludeReference {
  /** Lower-cased namespace. */
  namespace: string;
  /** The rest of the path, lower-cased, as written minus the namespace. */
  target: string;
  /** Whether the target lives under `_examples_/`. */
  fromExamples: boolean;
}

/**
 * Extracts the `<namespace/…>` includes of a PlantUML source.
 *
 * Includes whose path is computed (`!include <material2.1.19/$icon>`, as DomainStory does
 * inside an `!if`) are skipped: the namespace is knowable but the file is not, so treating it
 * as a hard dependency would make every DomainStory diagram drag in 6.8 MB of icons for a
 * branch it will probably not take.
 */
export function findStdlibIncludes(source: string): StdlibIncludeReference[] {
  const found: StdlibIncludeReference[] = [];
  const seen = new Set<string>();
  // `matchAll` on a shared global regex is safe: it clones the regex rather than advancing
  // `lastIndex` on the original.
  for (const match of source.matchAll(STDLIB_INCLUDE_PATTERN)) {
    const raw = match[1]?.trim() ?? '';
    if (raw.includes('$') || raw.includes('%')) continue;
    const slash = raw.indexOf('/');
    if (slash <= 0) continue;
    const namespace = raw.slice(0, slash).toLowerCase();
    const target = raw.slice(slash + 1).toLowerCase();
    if (target === '') continue;
    const key = `${namespace}/${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({
      namespace,
      target,
      fromExamples: target.startsWith(`${STDLIB_EXAMPLES_DIRECTORY}/`),
    });
  }
  return found;
}
