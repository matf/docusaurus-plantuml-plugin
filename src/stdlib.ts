import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {PLUGIN_NAME} from './constants.js';
import type {ResolvedStdlibOptions} from './options.js';
import {buildStdlibNamespace, stdlibBundleFileName} from './stdlibBundle.js';
import type {StdlibNamespaceEntry, StdlibRuntimeManifest} from './stdlibShared.js';

/**
 * Decides which standard library bundles a site build emits, and where each one comes from.
 *
 * The vendored bundles in `assets/stdlib` cover the namespaces this package ships (see
 * `assets/stdlib/LICENSES.md`). Anything named in `stdlib.include` is generated on demand
 * from a `plantuml-stdlib` checkout the site points at, and cached, because `aws` alone is
 * 114 MB of source that nobody wants to re-read on every rebuild.
 */

export type {StdlibNamespaceEntry, StdlibRuntimeManifest} from './stdlibShared.js';

export interface StdlibAssets {
  /** Absolute paths of the bundles to copy into the site's assets directory. */
  files: string[];
  manifest: StdlibRuntimeManifest;
}

interface VendoredManifestEntry {
  file: string;
  dependencies?: string[];
  exampleDependencies?: string[];
}

interface VendoredManifest {
  upstream?: {commit?: string};
  namespaces?: Record<string, VendoredManifestEntry>;
}

/**
 * `assets/` sits beside `dist/` in the published package and beside `src/` in the repository,
 * so one relative step out of the compiled module's directory finds it either way.
 */
function vendoredDirectory(currentDir: string): string {
  return path.join(currentDir, '..', 'assets', 'stdlib');
}

function readVendoredManifest(directory: string): VendoredManifest {
  const manifestPath = path.join(directory, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `[${PLUGIN_NAME}] The vendored standard library manifest is missing from ` +
        `'${manifestPath}'. This is a packaging fault: reinstall the plugin, or run ` +
        "'npm run stdlib:update' if you are working in a checkout of it.",
    );
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as VendoredManifest;
}

/** Short, stable content identity for a generated bundle, used to name its cache file. */
function digest(...parts: string[]): string {
  const hash = crypto.createHash('sha256');
  for (const part of parts) hash.update(part).update('\0');
  return hash.digest('hex').slice(0, 12);
}

/**
 * Cheap identity for a namespace directory: every file's path, size and mtime.
 *
 * Reading 114 MB of `aws` sources to hash them would defeat the point of the cache, and this
 * is the same trade every bundler makes for its own file watching.
 */
function directoryStamp(directory: string): string {
  const parts: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs
      .readdirSync(current, {withFileTypes: true})
      .sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      const stats = fs.statSync(absolute);
      parts.push(`${absolute}:${stats.size}:${stats.mtimeMs}`);
    }
  };
  walk(directory);
  return digest(...parts);
}

/**
 * Finds a namespace directory in one of the configured source trees.
 *
 * Matching is case-insensitive because the option is written in the same lower case the
 * engine uses (`'aws'`), while upstream spells some directories differently (`'C4'`).
 */
function findNamespaceDirectory(sourceRoots: string[], namespace: string): string | null {
  for (const root of sourceRoots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
      if (entry.isDirectory() && entry.name.toLowerCase() === namespace) {
        return path.join(root, entry.name);
      }
    }
  }
  return null;
}

export interface ResolveStdlibInput {
  options: ResolvedStdlibOptions;
  /** Directory of the calling module, used to locate the vendored bundles. */
  currentDir: string;
  /** Site directory, which relative `stdlib.source` entries are resolved against. */
  siteDir: string;
  /**
   * Where bundles generated for `stdlib.include` are cached. Docusaurus passes its
   * `generatedFilesDir`; when it is absent the site's `.docusaurus` directory is assumed.
   */
  cacheDir?: string;
}

/**
 * Resolves the standard library for one site build.
 *
 * Returns `null` when the feature is switched off, in which case nothing is emitted and the
 * browser side never looks for a bundle.
 */
export function resolveStdlibAssets({
  options,
  currentDir,
  siteDir,
  cacheDir,
}: ResolveStdlibInput): StdlibAssets | null {
  if (!options.enabled) return null;

  const directory = vendoredDirectory(currentDir);
  const vendored = readVendoredManifest(directory);
  const vendoredNamespaces = vendored.namespaces ?? {};

  const files: string[] = [];
  const namespaces: Record<string, StdlibNamespaceEntry> = {};

  const addVendored = (namespace: string) => {
    if (namespace in namespaces) return;
    const entry = vendoredNamespaces[namespace];
    if (!entry) return;
    const bundlePath = path.join(directory, entry.file);
    if (!fs.existsSync(bundlePath)) {
      throw new Error(
        `[${PLUGIN_NAME}] The vendored standard library manifest lists '${entry.file}', but ` +
          `'${bundlePath}' does not exist. Reinstall the plugin.`,
      );
    }
    files.push(bundlePath);
    namespaces[namespace] = {
      dependencies: entry.dependencies ?? [],
      exampleDependencies: entry.exampleDependencies ?? [],
    };
    // A namespace is useless without the ones its own files include, so `stdlib.namespaces`
    // narrows the selection but can never narrow it into something that cannot render.
    for (const dependency of entry.dependencies ?? []) addVendored(dependency);
  };

  const selected = options.namespaces ?? Object.keys(vendoredNamespaces);
  if (options.namespaces) {
    const unknown = options.namespaces.filter(
      (namespace) => !(namespace in vendoredNamespaces) && !options.include.includes(namespace),
    );
    if (unknown.length > 0) {
      throw new Error(
        `[${PLUGIN_NAME}] options.stdlib.namespaces names ${unknown
          .map((name) => `'${name}'`)
          .join(', ')}, which ${unknown.length > 1 ? 'are' : 'is'} not vendored with this ` +
          `plugin. Vendored namespaces: ${Object.keys(vendoredNamespaces).join(', ')}. To use ` +
          'another one, add it to options.stdlib.include and point options.stdlib.source at a ' +
          'plantuml-stdlib checkout.',
      );
    }
  }
  for (const namespace of selected) addVendored(namespace);

  // Extra namespaces come last so that naming a vendored one in `include` replaces it with
  // the copy from the site's own checkout.
  const sourceRoots = options.source.map((entry) => path.resolve(siteDir, entry));
  const generatedDir = path.join(cacheDir ?? path.join(siteDir, '.docusaurus'), 'plantuml-stdlib');
  const stamps: string[] = [];

  for (const namespace of options.include) {
    const namespaceDir = findNamespaceDirectory(sourceRoots, namespace);
    if (!namespaceDir) {
      throw new Error(
        `[${PLUGIN_NAME}] options.stdlib.include names '${namespace}', which was not found in ` +
          `${sourceRoots.map((root) => `'${root}'`).join(', ')}. Clone the standard library ` +
          '(git clone --depth 1 https://github.com/plantuml/plantuml-stdlib) and point ' +
          "options.stdlib.source at its 'stdlib' directory.",
      );
    }

    const stamp = directoryStamp(namespaceDir);
    stamps.push(`${namespace}:${stamp}`);
    const cached = path.join(generatedDir, stamp, stdlibBundleFileName(namespace));
    if (!fs.existsSync(cached)) {
      const bundle = buildStdlibNamespace(path.dirname(namespaceDir), path.basename(namespaceDir));
      fs.mkdirSync(path.dirname(cached), {recursive: true});
      fs.writeFileSync(cached, bundle.script, 'utf8');
      fs.writeFileSync(
        `${cached}.json`,
        JSON.stringify({
          dependencies: bundle.dependencies,
          exampleDependencies: bundle.exampleDependencies,
        }),
        'utf8',
      );
    }

    const meta = JSON.parse(fs.readFileSync(`${cached}.json`, 'utf8')) as StdlibNamespaceEntry;
    // Replacing a vendored bundle means dropping its file, not shipping both under one name.
    const previous = files.findIndex(
      (file) => path.basename(file) === stdlibBundleFileName(namespace),
    );
    if (previous !== -1) files.splice(previous, 1);
    files.push(cached);
    namespaces[namespace] = {
      dependencies: meta.dependencies,
      exampleDependencies: meta.exampleDependencies,
    };
  }

  return {
    files,
    manifest: {
      revision: digest(vendored.upstream?.commit ?? 'unknown', ...stamps.sort()),
      namespaces,
    },
  };
}
