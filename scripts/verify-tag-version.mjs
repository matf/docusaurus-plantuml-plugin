#!/usr/bin/env node
/**
 * Refuses to release when the git tag and `package.json` disagree.
 *
 * Also reports the dist-tag a release should use, so a prerelease can never land on
 * `latest` by accident.
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const SEMVER =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function fail(message) {
  console.error(`Release verification failed: ${message}`);
  process.exit(1);
}

const rawRef = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? process.env.RELEASE_TAG;
if (!rawRef) {
  fail(
    'no tag supplied. Pass one as an argument, or set GITHUB_REF_NAME (GitHub Actions does this).',
  );
}

const tag = rawRef.replace(/^refs\/tags\//, '');
if (!tag.startsWith('v')) {
  fail(`tag "${tag}" does not start with "v". Release tags look like v1.2.3.`);
}

const tagVersion = tag.slice(1);
const match = SEMVER.exec(tagVersion);
if (!match) {
  fail(`tag "${tag}" does not contain a valid semantic version.`);
}

if (tagVersion !== pkg.version) {
  fail(
    `tag "${tag}" implies version ${tagVersion}, but package.json declares ${pkg.version}. ` +
      'Update package.json (or retag) so the two agree.',
  );
}

let status;
try {
  status = execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'});
} catch (error) {
  fail(`could not inspect the git working tree: ${error.message}`);
}
if (status.trim() !== '') {
  fail(`the working tree is dirty, so the release contents are not reproducible:\n${status}`);
}

const prerelease = match.groups.prerelease;
// Anything unreleased must not become the default install for existing users.
const distTag = prerelease ? (/^(beta|rc)/.test(prerelease) ? 'beta' : 'next') : 'latest';

console.log(`Release checks passed for ${pkg.name}@${pkg.version} (tag ${tag}).`);
console.log(`dist-tag: ${distTag}`);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `dist_tag=${distTag}\nversion=${pkg.version}\ntag=${tag}\n`,
  );
}
