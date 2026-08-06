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

  return {
    packageDir,
    version,
    files: [
      path.join(packageDir, VIZ_SCRIPT_FILENAME),
      path.join(packageDir, PLANTUML_MODULE_FILENAME),
    ],
  };
}
