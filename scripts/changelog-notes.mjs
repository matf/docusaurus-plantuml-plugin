#!/usr/bin/env node
/**
 * Prints one released version's changelog section, for use as GitHub Release notes.
 *
 * Usage: node scripts/changelog-notes.mjs 1.2.3
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readRelease} from './lib/changelog.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const version = process.argv[2] ?? process.env.RELEASE_VERSION;

if (!version) {
  console.error('Usage: node scripts/changelog-notes.mjs <version>');
  process.exit(1);
}

const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const section = readRelease(changelog, version);

// A missing section is not worth failing a release that npm has already accepted.
process.stdout.write(section ? `${section.body}\n` : `See CHANGELOG.md for ${version}.\n`);
