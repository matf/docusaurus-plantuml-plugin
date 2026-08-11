#!/usr/bin/env node
/**
 * Regenerates the vendored PlantUML standard library bundles in `assets/stdlib/`.
 *
 * Maintainer-only, and deliberately *not* part of `npm run build`: a site build must never
 * reach the network, and the bundles are committed so contributors can build offline.
 *
 *   npm run build            # the generator itself ships in dist/
 *   npm run stdlib:update    # download, regenerate, rewrite the manifest
 *
 * `UPSTREAM_COMMIT` pins the plantuml-stdlib revision. Bump it, run this, review the diff.
 *
 * The namespace list is curated rather than complete, on two criteria.
 *
 * **Licence.** Vendoring redistributes someone else's work, so a namespace is only vendored
 * when its upstream project declares a licence that permits it. plantuml-stdlib itself has no
 * top-level licence and leaves the `license:` field of most namespace READMEs blank, so the
 * declaration is checked at the source repository and recorded in {@link LICENCE_OVERRIDES}.
 * Namespaces whose upstream declares nothing at all — classy, classy-c4, cloudogu, edgy,
 * elastic, gcp, osa2 — are left out; a site can still opt into them with `stdlib.include`
 * plus `stdlib.source`, which is the site owner's call to make rather than this package's.
 *
 * **Size.** The full standard library is 265 MB of `.puml` (28 MB gzipped), and five
 * namespaces — aws, ibm, tupadr3, material7.4.47 and awslib14/20 — account for 95% of it.
 * Those stay opt-in the same way. Everything here fits in ~3 MB, and a reader only ever
 * downloads the namespaces the page in front of them actually uses.
 */
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import zlib from 'node:zlib';

const UPSTREAM_REPOSITORY = 'plantuml/plantuml-stdlib';
const UPSTREAM_COMMIT = 'bdbb819f76c75e7a23af582b2a63ea7dc43eed7c';

/** Namespace directories to vendor, spelled as upstream spells them. */
const NAMESPACES = [
  'C4',
  'DomainStory',
  'archimate',
  'azure',
  'cloudinsight',
  'eip',
  'k8s',
  'kubernetes',
  'office',
];

/**
 * Licences read from each namespace's own upstream repository, because plantuml-stdlib's
 * README front matter mostly leaves `license:` empty. Checked when a namespace is added; a
 * namespace with no entry and no README declaration must not be vendored.
 */
const LICENCE_OVERRIDES = {
  azure: 'MIT',
  cloudinsight: 'MIT',
  eip: 'MIT',
  k8s: 'MIT',
  kubernetes: 'Apache-2.0',
  office: 'MIT',
};

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const generatorPath = path.join(root, 'dist', 'stdlibBundle.js');
if (!fs.existsSync(generatorPath)) {
  console.error(
    `The bundle generator is not built. Run 'npm run build' first — this script uses the same\n` +
      `code a site build uses for 'stdlib.include', so there is only one implementation.`,
  );
  process.exit(1);
}
const {buildStdlibNamespace, stdlibBundleFileName, STDLIB_BUNDLE_FORMAT} = await import(
  new URL(`file://${generatorPath}`).href
);

const cacheDir = path.join(root, 'node_modules', '.cache', 'plantuml-stdlib');
const tarball = path.join(cacheDir, `${UPSTREAM_COMMIT}.tar.gz`);
const checkout = path.join(cacheDir, UPSTREAM_COMMIT);
const outputDir = path.join(root, 'assets', 'stdlib');

function download() {
  if (fs.existsSync(tarball)) return;
  fs.mkdirSync(cacheDir, {recursive: true});
  const url = `https://codeload.github.com/${UPSTREAM_REPOSITORY}/tar.gz/${UPSTREAM_COMMIT}`;
  console.log(`Downloading ${url}`);
  // Written to a temporary name first so an interrupted download cannot be mistaken for a
  // complete one on the next run.
  const partial = `${tarball}.partial`;
  execFileSync('curl', ['-sSfL', '-o', partial, url], {stdio: ['ignore', 'inherit', 'inherit']});
  fs.renameSync(partial, tarball);
}

function extract() {
  const stdlibRoot = path.join(checkout, 'stdlib');
  if (fs.existsSync(stdlibRoot)) return stdlibRoot;
  fs.mkdirSync(checkout, {recursive: true});
  console.log('Extracting the standard library (only the namespaces we vendor)…');
  const prefix = `plantuml-stdlib-${UPSTREAM_COMMIT}`;
  execFileSync(
    'tar',
    [
      '-xzf',
      tarball,
      '-C',
      checkout,
      '--strip-components=1',
      ...NAMESPACES.map((name) => `${prefix}/stdlib/${name}`),
    ],
    {stdio: ['ignore', 'inherit', 'inherit']},
  );
  return stdlibRoot;
}

function formatBytes(bytes) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} KiB`
    : `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

download();
const stdlibRoot = extract();

fs.rmSync(outputDir, {recursive: true, force: true});
fs.mkdirSync(outputDir, {recursive: true});

const namespaces = {};
const attribution = [];
let totalBytes = 0;
let totalGzipBytes = 0;

for (const directoryName of NAMESPACES) {
  const bundle = buildStdlibNamespace(stdlibRoot, directoryName);

  // Upstream writes `license:` with nothing after it more often than not, so an empty string
  // has to be treated as absent rather than as a declaration. Checked before anything is
  // written, so an unlicensed namespace cannot leave a half-vendored directory behind.
  const declared = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null);
  const license = declared(bundle.info.license) ?? LICENCE_OVERRIDES[bundle.namespace] ?? null;
  if (license === null) {
    throw new Error(
      `'${directoryName}' declares no licence upstream and has no LICENCE_OVERRIDES entry. ` +
        'Verify the licence at its source repository before vendoring it.',
    );
  }

  const fileName = stdlibBundleFileName(bundle.namespace);
  const script = Buffer.from(bundle.script, 'utf8');
  fs.writeFileSync(path.join(outputDir, fileName), script);

  const gzipBytes = zlib.gzipSync(script, {level: 9}).length;
  totalBytes += script.length;
  totalGzipBytes += gzipBytes;

  namespaces[bundle.namespace] = {
    directory: bundle.directoryName,
    file: fileName,
    bytes: script.length,
    files: bundle.fileCount,
    dependencies: bundle.dependencies,
    exampleDependencies: bundle.exampleDependencies,
    displayName: declared(bundle.info.display_name) ?? bundle.directoryName,
    version: declared(bundle.info.version),
    license,
    source: declared(bundle.info.source),
  };

  const entry = namespaces[bundle.namespace];
  attribution.push(
    `| \`${bundle.namespace}\` | ${entry.displayName} | ${entry.version ?? '—'} | ` +
      `${entry.license} | ${entry.source ? `<${entry.source}>` : '—'} |`,
  );

  console.log(
    `  ${bundle.namespace.padEnd(14)} ${formatBytes(script.length).padStart(9)}  ` +
      `${formatBytes(gzipBytes).padStart(9)} gz  ${String(bundle.fileCount).padStart(5)} files`,
  );
}

const manifest = {
  $comment:
    'Generated by `npm run stdlib:update`. Do not edit by hand; edit scripts/update-stdlib.mjs.',
  format: STDLIB_BUNDLE_FORMAT,
  upstream: {repository: UPSTREAM_REPOSITORY, commit: UPSTREAM_COMMIT},
  namespaces,
};
fs.writeFileSync(
  path.join(outputDir, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);

fs.writeFileSync(
  path.join(outputDir, 'LICENSES.md'),
  [
    '# Vendored PlantUML standard library namespaces',
    '',
    'These bundles are generated from',
    `[${UPSTREAM_REPOSITORY}](https://github.com/${UPSTREAM_REPOSITORY}) at commit`,
    `\`${UPSTREAM_COMMIT}\` by \`npm run stdlib:update\`. Each namespace keeps the licence of its`,
    'own upstream project, listed below. plantuml-stdlib leaves the `license:` field of most',
    'namespace READMEs empty, so where that is the case the licence was read from the source',
    'repository and recorded in `scripts/update-stdlib.mjs`. Namespaces whose upstream declares',
    'no licence at all are not vendored. The MIT licence of this plugin covers the generator,',
    'not the library content.',
    '',
    '| Namespace | Library | Version | Licence | Upstream |',
    '| --- | --- | --- | --- | --- |',
    ...attribution,
    '',
  ].join('\n'),
  'utf8',
);

console.log(
  `\nWrote ${NAMESPACES.length} namespaces to assets/stdlib: ` +
    `${formatBytes(totalBytes)} (${formatBytes(totalGzipBytes)} gzipped).`,
);
