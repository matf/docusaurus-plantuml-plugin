#!/usr/bin/env node
/**
 * Full generation loop against the *published* artifact.
 *
 * Builds the package, packs it, installs the resulting tarball into a throwaway copy of the
 * example site, builds that site, serves it, and runs Playwright against the served output.
 * Nothing here resolves the plugin through a workspace symlink or a source import, so a
 * green run means the tarball a consumer downloads actually works.
 */
import {execFileSync, spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {parsePackResult} from './lib/pack-output.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const exampleDir = path.join(root, 'examples', 'docusaurus');

const keepFixture = process.argv.includes('--keep');
const skipBuild = process.argv.includes('--skip-build');

/** Bind and probe the same interface, so IPv4/IPv6 loopback can never disagree. */
const SERVE_HOST = '127.0.0.1';

/** Everything the fixture must not inherit from the developer's working copy. */
const EXCLUDED_ENTRIES = new Set([
  'node_modules',
  'build',
  '.docusaurus',
  'package-lock.json',
  '.cache',
]);

let serverProcess = null;
let fixtureDir = null;
const serverLog = [];

function step(message) {
  console.log(`\n[1m==> ${message}[0m`);
}

function run(command, args, options = {}) {
  console.log(`    $ ${command} ${args.join(' ')}`);
  execFileSync(command, args, {stdio: 'inherit', ...options});
}

function copyFixture(from, to) {
  fs.mkdirSync(to, {recursive: true});
  for (const entry of fs.readdirSync(from, {withFileTypes: true})) {
    if (EXCLUDED_ENTRIES.has(entry.name)) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyFixture(source, target);
    } else {
      fs.copyFileSync(source, target);
    }
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (serverProcess?.exitCode !== null && serverProcess?.exitCode !== undefined) {
      throw new Error(`docusaurus serve exited early with code ${serverProcess.exitCode}`);
    }
    try {
      const response = await fetch(url, {redirect: 'manual'});
      if (response.status < 500) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${url}`);
}

function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  // Negative pid signals the whole process group, so no orphaned server survives a failure.
  try {
    process.kill(-serverProcess.pid, 'SIGTERM');
  } catch {
    try {
      serverProcess.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

function cleanup() {
  stopServer();
  if (fixtureDir && !keepFixture) {
    fs.rmSync(fixtureDir, {recursive: true, force: true});
  } else if (fixtureDir) {
    console.log(`\nFixture kept at ${fixtureDir}`);
  }
}

process.on('exit', cleanup);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    cleanup();
    process.exit(1);
  });
}

async function main() {
  if (!skipBuild) {
    step('Building the package');
    run('npm', ['run', 'build'], {cwd: root});
  }

  step('Packing the package');
  const packJson = execFileSync('npm', ['pack', '--json', '--silent'], {
    cwd: root,
    encoding: 'utf8',
  });
  const tarballName = parsePackResult(packJson).filename;
  const tarballPath = path.join(root, tarballName);
  if (!fs.existsSync(tarballPath)) {
    throw new Error(`npm pack reported ${tarballName} but the file is missing`);
  }
  console.log(
    `    tarball: ${tarballName} (${(fs.statSync(tarballPath).size / 1024).toFixed(1)} KiB)`,
  );

  step('Creating a clean Docusaurus fixture');
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plantuml-fixture-'));
  copyFixture(exampleDir, fixtureDir);

  // Point the fixture at the tarball instead of the local checkout, so nothing can resolve
  // back to the workspace.
  const fixturePkgPath = path.join(fixtureDir, 'package.json');
  const fixturePkg = JSON.parse(fs.readFileSync(fixturePkgPath, 'utf8'));
  fixturePkg.dependencies[pkg.name] = `file:${tarballPath}`;
  fs.writeFileSync(fixturePkgPath, `${JSON.stringify(fixturePkg, null, 2)}\n`);
  console.log(`    fixture: ${fixtureDir}`);
  console.log(`    ${pkg.name} -> file:${tarballPath}`);

  step('Installing fixture dependencies');
  run('npm', ['install', '--no-audit', '--no-fund'], {cwd: fixtureDir});

  const installed = path.join(fixtureDir, 'node_modules', ...pkg.name.split('/'));
  if (fs.lstatSync(installed).isSymbolicLink()) {
    throw new Error(
      `${pkg.name} was installed as a symlink. The integration test must exercise the packed ` +
        'tarball, not the workspace.',
    );
  }

  step('Building the fixture site');
  run('npx', ['docusaurus', 'build'], {cwd: fixtureDir});

  const port = await findFreePort();
  const baseUrl = `http://${SERVE_HOST}:${port}/plantuml-test/`;

  step(`Serving the production build on ${baseUrl}`);
  // `--host` is not optional here: left to itself `docusaurus serve` binds only the IPv6
  // loopback, and every IPv4 health check and Playwright request then fails to connect.
  serverProcess = spawn(
    'npx',
    ['docusaurus', 'serve', '--port', String(port), '--host', SERVE_HOST, '--no-open'],
    {
      cwd: fixtureDir,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const record = (chunk) => {
    serverLog.push(chunk.toString());
    if (serverLog.length > 200) serverLog.shift();
  };
  serverProcess.stdout.on('data', record);
  serverProcess.stderr.on('data', record);

  await waitForServer(baseUrl, 60_000);
  console.log('    server is responding');

  step('Running Playwright against the served production build');
  run('npx', ['playwright', 'test'], {
    cwd: root,
    env: {...process.env, PLANTUML_E2E_BASE_URL: baseUrl},
  });

  step('Packed-package integration test passed');
}

try {
  await main();
  // Same reason as the failure path: the detached server keeps the loop alive otherwise.
  cleanup();
  process.exit(0);
} catch (error) {
  console.error('\n[31mPacked-package integration test failed.[0m');
  console.error(error.message);
  if (serverLog.length > 0) {
    console.error('\n--- last output from `docusaurus serve` ---');
    console.error(serverLog.join(''));
  }
  if (fixtureDir && fs.existsSync(fixtureDir) && keepFixture) {
    console.error(`\nFixture kept for inspection: ${fixtureDir}`);
  } else if (fixtureDir) {
    console.error('\nRe-run with --keep to inspect the fixture.');
  }
  // Tear down and exit explicitly. Relying on the `exit` handler alone would hang here: the
  // detached server's open stdio pipes keep the event loop alive, so `exit` never fires.
  cleanup();
  process.exit(1);
}
