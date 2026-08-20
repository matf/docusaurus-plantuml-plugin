#!/usr/bin/env node
/**
 * Decides whether `main` warrants a release, and applies the whole bump when it does.
 *
 * The version comes from `CHANGELOG.md`, not from commit messages. This project already requires
 * every pull request to describe itself under `## [Unreleased]` (see CONTRIBUTING.md), so that
 * section is the one place where the nature of a change is already written down by a human in
 * Keep a Changelog's vocabulary. Conventional-commit subjects would be a second, redundant and
 * silently-diverging source of the same fact.
 *
 *   `### Removed`, or a line opening with BREAKING  -> major
 *   `### Added`                                     -> minor
 *   any other non-empty section                     -> patch
 *   empty, and every commit since the last tag is
 *   a dependency bump                               -> patch, entry written from the log
 *   empty, with anything else in the log            -> no release
 *
 * The rules themselves live in `lib/release-decision.mjs`, where they are unit-tested.
 *
 * Applying a release means: `npm version` (which moves `package.json` and both `version` fields in
 * `package-lock.json`), close the `[Unreleased]` section into a dated one, open a fresh empty
 * `[Unreleased]`, and add the compare link at the foot of the changelog.
 *
 * Usage:
 *   node scripts/next-release.mjs                  apply the release, if there is one
 *   node scripts/next-release.mjs --dry-run        decide and print, change nothing
 *   node scripts/next-release.mjs --version 2.0.0  force a version instead of deriving it
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readUnreleased} from './lib/changelog.mjs';
import {applyBump, decideRelease} from './lib/release-decision.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function fail(message) {
  console.error(`Release decision failed: ${message}`);
  process.exit(1);
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  const inline = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : undefined;
}

function git(...args) {
  return execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
}

const dryRun = flag('dry-run');
const forcedVersion = option('version');
// Injectable so the tests and a re-run are deterministic; the workflow does not set it.
const releaseDate = option('date') ?? new Date().toISOString().slice(0, 10);

const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
const repoUrl = `https://github.com/${config.githubRepository}`;

const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (!SEMVER.test(pkg.version))
  fail(`package.json declares a non-release version "${pkg.version}".`);

let lastTag = '';
try {
  lastTag = git('describe', '--tags', '--abbrev=0', '--match', 'v*');
} catch {
  // No tag yet: the first release is whatever the changelog asks for, measured from package.json.
}

if (lastTag && lastTag.slice(1) !== pkg.version) {
  fail(
    `the last tag is ${lastTag} but package.json declares ${pkg.version}. ` +
      'Releases are cut from a tree where those agree; reconcile them before releasing.',
  );
}

// --- what does the changelog say -----------------------------------------------------------
const changelogPath = path.join(root, 'CHANGELOG.md');
const changelog = fs.readFileSync(changelogPath, 'utf8');

const unreleasedHeading = '## [Unreleased]';
const unreleased = readUnreleased(changelog);
if (!unreleased) fail(`CHANGELOG.md has no "${unreleasedHeading}" heading.`);
const {body: unreleasedBody, start: unreleasedStart, end: unreleasedEnd} = unreleased;

// --- what does the log say -------------------------------------------------------------------
const range = lastTag ? `${lastTag}..HEAD` : 'HEAD';
const subjects = git('log', range, '--no-merges', '--format=%s')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

// --- decide ----------------------------------------------------------------------------------
if (forcedVersion && !SEMVER.test(forcedVersion)) {
  fail(`"${forcedVersion}" is not a release version.`);
}

const decision = forcedVersion
  ? {bump: 'explicit', reason: 'a version was supplied', notes: unreleasedBody}
  : decideRelease(unreleasedBody, subjects);

if (!decision.bump) {
  console.log(`No release: ${decision.reason}.`);
  writeOutputs({release: false});
  process.exit(0);
}

const version = forcedVersion ?? applyBump(pkg.version, decision.bump);
const notesBody = decision.notes || '### Changed\n\n- Release cut by hand.';

console.log(
  `Release ${pkg.version} -> ${version} (${decision.bump}): ${decision.reason}. Dated ${releaseDate}.`,
);
console.log(`\n${notesBody}\n`);

if (dryRun) {
  console.log('--dry-run: nothing was written.');
  writeOutputs({release: true, version, bump: decision.bump, notes: notesBody});
  process.exit(0);
}

// --- apply -------------------------------------------------------------------------------------
execFileSync('npm', ['version', version, '--no-git-tag-version'], {
  cwd: root,
  stdio: 'inherit',
});

const previousVersion = pkg.version;
const dated = `## [${version}] - ${releaseDate}`;
const remainder = changelog.slice(unreleasedEnd);
// The remainder begins at the next `## ` heading, with its separating blank line consumed above.
const closed = `${unreleasedHeading}\n\n${dated}\n\n${notesBody}\n${remainder.startsWith('\n') ? '' : '\n'}`;
let next = changelog.slice(0, unreleasedStart) + closed + remainder;

// The link footer: repoint [Unreleased] at the new tag and add this release's compare link
// directly beneath it, which is where every previous release's link already sits.
const unreleasedLink = new RegExp(`^\\[Unreleased\\]: .*$`, 'm');
if (!unreleasedLink.test(next)) fail('CHANGELOG.md has no [Unreleased] link reference to update.');
const base = lastTag
  ? `${repoUrl}/compare/v${previousVersion}...v${version}`
  : `${repoUrl}/releases/tag/v${version}`;
next = next.replace(
  unreleasedLink,
  `[Unreleased]: ${repoUrl}/compare/v${version}...HEAD\n[${version}]: ${base}`,
);

fs.writeFileSync(changelogPath, next);
console.log(`updated CHANGELOG.md`);

// package.json is prettier-formatted; npm's writer is close but not guaranteed to match.
// (CHANGELOG.md is in .prettierignore, so it is left exactly as written above.)
execFileSync('npx', ['prettier', '--write', 'package.json'], {cwd: root, stdio: 'inherit'});

writeOutputs({
  release: true,
  version,
  bump: decision.bump,
  notes: notesBody,
  previous: previousVersion,
});

function writeOutputs(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  const lines = [];
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (String(value).includes('\n')) {
      const delimiter = `ghadelimiter_${key}_${Buffer.from(key).toString('hex')}`;
      lines.push(`${key}<<${delimiter}`, String(value), delimiter);
    } else {
      lines.push(`${key}=${value}`);
    }
  }
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}
