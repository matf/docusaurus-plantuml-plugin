#!/usr/bin/env node
/** Guards `npm publish` from shipping a stale or absent build. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distIndex = path.join(root, 'dist', 'index.js');

if (!fs.existsSync(distIndex)) {
  console.error('dist/ is missing. Run `npm run build` before publishing.');
  process.exit(1);
}

const newestSource = fs
  .readdirSync(path.join(root, 'src'), {recursive: true, withFileTypes: true})
  .filter((entry) => entry.isFile())
  .map((entry) => fs.statSync(path.join(entry.parentPath ?? entry.path, entry.name)).mtimeMs)
  .reduce((max, value) => Math.max(max, value), 0);

if (newestSource > fs.statSync(distIndex).mtimeMs) {
  console.error('dist/ is older than src/. Run `npm run build` before publishing.');
  process.exit(1);
}

console.log('Build artifacts are present and up to date.');
