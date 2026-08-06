#!/usr/bin/env node
/**
 * `tsc` does not copy non-TypeScript assets, but Docusaurus theme components import their
 * CSS modules by relative path. This copies every stylesheet under `src/theme` into the
 * matching place in `dist/theme`, then checks that the published entry points exist.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcTheme = path.join(root, 'src', 'theme');
const distTheme = path.join(root, 'dist', 'theme');

function copyStylesheets(fromDir, toDir) {
  let copied = 0;
  for (const entry of fs.readdirSync(fromDir, {withFileTypes: true})) {
    const from = path.join(fromDir, entry.name);
    const to = path.join(toDir, entry.name);
    if (entry.isDirectory()) {
      copied += copyStylesheets(from, to);
    } else if (entry.name.endsWith('.css')) {
      fs.mkdirSync(toDir, {recursive: true});
      fs.copyFileSync(from, to);
      copied += 1;
    }
  }
  return copied;
}

const copied = copyStylesheets(srcTheme, distTheme);

const required = [
  'dist/index.js',
  'dist/index.cjs',
  'dist/index.d.ts',
  'dist/index.d.cts',
  'dist/theme/MDXComponents/Code/index.js',
  'dist/theme/PlantUmlDiagram/index.js',
  'dist/theme/PlantUmlDiagram/styles.module.css',
  'dist/runtime/renderer.js',
];

const missing = required.filter((relative) => !fs.existsSync(path.join(root, relative)));
if (missing.length > 0) {
  console.error(`Build is incomplete. Missing:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

console.log(
  `Build finalized: copied ${copied} stylesheet(s), verified ${required.length} outputs.`,
);
