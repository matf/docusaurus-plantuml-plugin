#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const targets = ['dist', 'coverage', 'test-results', 'playwright-report', '.tmp-integration'];

for (const target of targets) {
  const absolute = path.join(root, target);
  fs.rmSync(absolute, {recursive: true, force: true});
}

for (const entry of fs.readdirSync(root)) {
  if (entry.endsWith('.tgz')) fs.rmSync(path.join(root, entry), {force: true});
}

console.log('Cleaned build output.');
