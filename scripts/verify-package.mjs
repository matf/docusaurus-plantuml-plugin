#!/usr/bin/env node
/**
 * Inspects `npm pack --json` output and fails when the tarball is missing something a
 * consumer needs, or contains something it should not ship.
 *
 * Runs `npm pack --dry-run`, so it never leaves a tarball behind.
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/** Generous enough for the compiled plugin, but far below the ~8 MB PlantUML runtime. */
const MAX_UNPACKED_BYTES = 400 * 1024;
const MAX_PACKED_BYTES = 120 * 1024;

const REQUIRED_FILES = [
  'dist/index.js',
  'dist/index.cjs',
  'dist/index.d.ts',
  'dist/index.d.cts',
  'dist/options.js',
  'dist/options.d.ts',
  'dist/runtime/renderer.js',
  'dist/runtime/queue.js',
  'dist/runtime/cache.js',
  'dist/runtime/sanitize.js',
  'dist/runtime/assetLoader.js',
  'dist/theme/MDXComponents/Code/index.js',
  'dist/theme/PlantUmlDiagram/index.js',
  'dist/theme/PlantUmlDiagram/useZoomPan.js',
  'dist/theme/PlantUmlDiagram/zoomMath.js',
  'dist/theme/PlantUmlDiagram/styles.module.css',
  'README.md',
  'LICENSE',
];

const FORBIDDEN_PATTERNS = [
  {pattern: /\.map$/, reason: 'source maps are not published'},
  {pattern: /(^|\/)tests?\//, reason: 'test files must not be published'},
  {pattern: /\.(test|spec)\.[cm]?[jt]sx?$/, reason: 'test files must not be published'},
  {pattern: /(^|\/)examples?\//, reason: 'the example site must not be published'},
  {
    pattern: /(^|\/)(build|\.docusaurus|coverage|playwright-report|test-results)\//,
    reason: 'build output must not be published',
  },
  {pattern: /\.tgz$/, reason: 'nested tarballs must not be published'},
  {pattern: /(^|\/)node_modules\//, reason: 'dependencies must not be vendored'},
  {pattern: /(^|\/)\.github\//, reason: 'CI configuration is not part of the package'},
];

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

let packOutput;
try {
  packOutput = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (error) {
  console.error('`npm pack --dry-run --json` failed:\n', error.stderr ?? error.message);
  process.exit(1);
}

// npm can prefix the JSON with notices on stdout; take the JSON array only.
const jsonStart = packOutput.indexOf('[');
const result = JSON.parse(packOutput.slice(jsonStart))[0];
const files = result.files.map((file) => ({path: file.path, size: file.size}));
const problems = [];

console.log(`Package: ${pkg.name}@${pkg.version}`);
console.log(`Tarball: ${result.filename}`);
console.log(`Files:   ${result.entryCount}`);
console.log(`Packed:  ${formatBytes(result.size)}   Unpacked: ${formatBytes(result.unpackedSize)}`);
console.log('');
console.log('Contents:');
for (const file of [...files].sort((a, b) => b.size - a.size)) {
  console.log(`  ${formatBytes(file.size).padStart(10)}  ${file.path}`);
}
console.log('');

const packedPaths = new Set(files.map((file) => file.path));

for (const required of REQUIRED_FILES) {
  if (!packedPaths.has(required)) problems.push(`missing required file: ${required}`);
}

for (const file of files) {
  for (const {pattern, reason} of FORBIDDEN_PATTERNS) {
    if (pattern.test(file.path)) problems.push(`unexpected file ${file.path} (${reason})`);
  }
}

if (!files.some((file) => file.path.endsWith('.d.ts'))) {
  problems.push('no TypeScript declarations are included');
}

if (result.unpackedSize > MAX_UNPACKED_BYTES) {
  problems.push(
    `unpacked size ${formatBytes(result.unpackedSize)} exceeds the ${formatBytes(MAX_UNPACKED_BYTES)} budget. ` +
      'If this is intentional, raise MAX_UNPACKED_BYTES in scripts/verify-package.mjs and say why.',
  );
}
if (result.size > MAX_PACKED_BYTES) {
  problems.push(
    `packed size ${formatBytes(result.size)} exceeds the ${formatBytes(MAX_PACKED_BYTES)} budget.`,
  );
}

/** Every path an `exports` entry can resolve to must actually be in the tarball. */
function collectExportTargets(node, out = []) {
  if (typeof node === 'string') {
    out.push(node);
  } else if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectExportTargets(value, out);
  }
  return out;
}

for (const target of collectExportTargets(pkg.exports)) {
  if (target.includes('*')) {
    // Wildcard subpath: require that at least one packed file matches the prefix.
    const prefix = target.slice(2, target.indexOf('*'));
    if (![...packedPaths].some((file) => file.startsWith(prefix))) {
      problems.push(`exports pattern "${target}" matches no packed file`);
    }
    continue;
  }
  const relative = target.replace(/^\.\//, '');
  if (!packedPaths.has(relative)) {
    problems.push(`exports entry "${target}" points at a file that is not packed`);
  }
}

for (const field of ['main', 'module', 'types']) {
  const value = pkg[field];
  if (!value) continue;
  const relative = value.replace(/^\.\//, '');
  if (!packedPaths.has(relative)) {
    problems.push(`package.json "${field}" points at "${value}", which is not packed`);
  }
}

if (problems.length > 0) {
  console.error(`Package verification failed with ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('Package verification passed.');
