#!/usr/bin/env node
/**
 * Propagates the identity in `project.config.json` into every file that has to repeat it.
 *
 * Renaming the npm package or moving the GitHub repository is therefore a one-line edit
 * followed by `npm run sync:meta`. CI runs `npm run sync:check`, which fails when a derived
 * file has drifted.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const checkOnly = process.argv.includes('--check');

const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
const {packageName, githubRepository, license, description} = config;

if (!packageName || !githubRepository) {
  console.error('project.config.json must define packageName and githubRepository.');
  process.exit(1);
}

const repoUrl = `https://github.com/${githubRepository}`;
const drift = [];

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}

function writeJson(relative, value) {
  const absolute = path.join(root, relative);
  const next = `${JSON.stringify(value, null, 2)}\n`;
  const current = fs.readFileSync(absolute, 'utf8');
  if (current === next) return;
  if (checkOnly) {
    drift.push(relative);
    return;
  }
  fs.writeFileSync(absolute, next);
  console.log(`updated ${relative}`);
}

// --- root package.json -------------------------------------------------------------
const rootPkg = readJson('package.json');
rootPkg.name = packageName;
rootPkg.description = description;
rootPkg.license = license;
rootPkg.homepage = `${repoUrl}#readme`;
rootPkg.repository = {type: 'git', url: `git+${repoUrl}.git`};
rootPkg.bugs = {url: `${repoUrl}/issues`};
writeJson('package.json', rootPkg);

// --- lockfile version --------------------------------------------------------------
// `npm version` moves these two alongside package.json, but a hand-edited version does not, and
// they have drifted before. Releases are cut from `package.json`, so a stale lockfile means
// anyone installing from source gets a version string that disagrees with what was published.
const lockPath = 'package-lock.json';
const lock = readJson(lockPath);
if (lock.version !== rootPkg.version || lock.packages?.['']?.version !== rootPkg.version) {
  lock.version = rootPkg.version;
  if (lock.packages?.['']) lock.packages[''].version = rootPkg.version;
  writeJson(lockPath, lock);
}

// --- example site ------------------------------------------------------------------
const examplePkgPath = 'examples/docusaurus/package.json';
const examplePkg = readJson(examplePkgPath);
const previousDependency = Object.keys(examplePkg.dependencies).find(
  (name) =>
    name === packageName ||
    name.endsWith('docusaurus-plantuml-plugin') ||
    name.endsWith('plantuml-client'),
);
if (previousDependency && previousDependency !== packageName) {
  delete examplePkg.dependencies[previousDependency];
}
examplePkg.dependencies[packageName] = 'file:../..';
examplePkg.dependencies = Object.fromEntries(
  Object.entries(examplePkg.dependencies).sort(([a], [b]) => a.localeCompare(b)),
);
writeJson(examplePkgPath, examplePkg);

// --- files that embed the identity in source ----------------------------------------
const [organizationName, projectName] = githubRepository.split('/');

const textReplacements = [
  {
    file: 'examples/docusaurus/docusaurus.config.ts',
    edits: [
      // The plugin's own import and registration, anchored so nothing else can match.
      {pattern: /(from\s+)'[^']*'(;\s*\/\/ plugin-package)/g, replacement: `$1'${packageName}'$2`},
      {pattern: /('[^']*')(,?\s*\/\/ plugin-package)/g, replacement: `'${packageName}'$2`},
      {
        pattern: /(organizationName:\s+)'[^']*'/,
        replacement: `$1'${organizationName}'`,
      },
      {pattern: /(projectName:\s+)'[^']*'/, replacement: `$1'${projectName}'`},
    ],
  },
];

for (const {file, edits} of textReplacements) {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) continue;
  const current = fs.readFileSync(absolute, 'utf8');
  const next = edits.reduce(
    (text, {pattern, replacement}) => text.replace(pattern, replacement),
    current,
  );
  if (current === next) continue;
  if (checkOnly) {
    drift.push(file);
    continue;
  }
  fs.writeFileSync(absolute, next);
  console.log(`updated ${file}`);
}

if (checkOnly) {
  if (drift.length > 0) {
    console.error(
      `Project metadata is out of sync with project.config.json:\n  ${drift.join('\n  ')}\n` +
        'Run `npm run sync:meta` and commit the result.',
    );
    process.exit(1);
  }
  console.log('Project metadata is in sync.');
} else {
  console.log(`Synced identity: ${packageName} (${repoUrl})`);
}
