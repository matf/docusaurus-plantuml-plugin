import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';

import {PLANTUML_MODULE_FILENAME, PLUGIN_NAME, VIZ_SCRIPT_FILENAME} from './constants.js';

const require = createRequire(import.meta.url);

export interface PlantUmlCoreLocation {
  /** Absolute directory of the installed `@plantuml/core` package. */
  packageDir: string;
  /** Installed `@plantuml/core` version, used to namespace emitted asset URLs. */
  version: string;
  /** Absolute paths of the runtime files that must be served from the site origin. */
  files: string[];
}

interface CorePackageJson {
  version?: unknown;
}

/**
 * Locates the installed `@plantuml/core` package on disk.
 *
 * Resolution goes through `@plantuml/core/package.json`, which the package lists in its
 * `exports` map — resolving the bare specifier would give the ES module entry instead.
 */
export function locatePlantUmlCore(): PlantUmlCoreLocation {
  let packageJsonPath: string;
  try {
    packageJsonPath = require.resolve('@plantuml/core/package.json');
  } catch (cause) {
    throw new Error(
      `[${PLUGIN_NAME}] Could not resolve '@plantuml/core'. It is a dependency of this plugin; ` +
        'reinstall your site dependencies to fix a broken or deduplicated install.',
      {cause},
    );
  }

  const packageDir = path.dirname(packageJsonPath);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as CorePackageJson;
  const version = typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';

  const files = [
    path.join(packageDir, VIZ_SCRIPT_FILENAME),
    path.join(packageDir, PLANTUML_MODULE_FILENAME),
  ];
  files.forEach((file) => assertRuntimeFile(file, version));

  return {packageDir, version, files};
}

/**
 * Fails the build if a runtime asset is missing from the installed `@plantuml/core`.
 *
 * `viz-global.js` matters twice over: PlantUML needs it for layout, and it *is* the Graphviz
 * engine this plugin renders DOT fences with. It is a declared `exports` entry of
 * `@plantuml/core`, not a private file — but it is still shipped at PlantUML's discretion, so a
 * routine dependency bump that dropped or renamed it would otherwise reach a reader's browser
 * as a runtime load failure. Checking here turns that into a failed build with a name attached.
 *
 * See `docs/adr/0004-graphviz-engine-reuse.md`.
 */
function assertRuntimeFile(file: string, version: string): void {
  if (fs.existsSync(file)) return;
  throw new Error(
    `[${PLUGIN_NAME}] '@plantuml/core@${version}' does not contain '${path.basename(file)}', ` +
      'which this plugin serves as a runtime asset. This means the installed version of ' +
      '@plantuml/core is not one this plugin supports. Pin a supported version, or open an ' +
      'issue if the package has genuinely changed its layout.',
  );
}
