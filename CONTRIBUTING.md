# Contributing

Thanks for taking the time. This is a small, focused package; the bar is correctness and
clarity rather than breadth of features.

Security issues are **not** handled here — see [SECURITY.md](SECURITY.md).

## Setup

Requirements: Node `>= 20` (the repository pins a version in `.nvmrc`) and npm.

```bash
git clone https://github.com/matf/docusaurus-plantuml-plugin.git
cd docusaurus-plantuml-plugin
npm ci
```

`npm ci` installs `@plantuml/core`, which is roughly 8 MB. On a slow or proxied connection
this is the step that takes a while; see the corporate-proxy entry in the README's
troubleshooting section if it fails.

Build the package once so the example site has something to consume:

```bash
npm run build
```

## Working on the plugin

The fastest loop is the example site, which consumes the package through a `file:../..`
dependency:

```bash
npm run example:install
npm run build          # after any change under src/
npm run example:start
```

The example deploys under `baseUrl: '/plantuml-test/'`, so the dev server serves it at
`http://localhost:3000/plantuml-test/`. That non-root path is deliberate — it is how asset
URLs get exercised the way a project-pages deployment exercises them.

Note that the example site registers a small inline plugin setting
`resolve: {symlinks: false}`. That exists **only** because of the `file:` link; see the
README's "Duplicate or mismatched Docusaurus / React dependencies" entry. Do not copy it into
your own site, and do not remove it from the example.

If a change does not seem to take effect, clear the Docusaurus build cache:

```bash
npx --prefix examples/docusaurus docusaurus clear
```

## Checks

Run the full gate before opening a pull request:

```bash
npm run test:all
```

That is: `format:check`, `lint`, `typecheck`, `test:unit`, `build`, `pack:check`,
`test:integration` — the same scripts CI runs. Individually:

| Command                    | Scope                                                         |
| -------------------------- | ------------------------------------------------------------- |
| `npm run format`           | Prettier, writing                                             |
| `npm run format:check`     | Prettier, checking                                            |
| `npm run lint`             | ESLint (`npm run lint:fix` to autofix)                        |
| `npm run typecheck`        | `tsc --noEmit`                                                |
| `npm test`                 | Unit and component tests                                      |
| `npm run test:watch`       | Same, in watch mode                                           |
| `npm run test:coverage`    | Same, with a v8 coverage report                               |
| `npm run build`            | Clean + `tsc` (ESM and theme) + `tsup` (CJS entry) + finalize |
| `npm run pack:check`       | Verify the tarball's contents and size budget                 |
| `npm run test:integration` | Pack, install into a clean fixture, build and serve it        |
| `npm run test:e2e`         | Playwright against the served production build                |
| `npm run sync:check`       | Verify derived files match `project.config.json`              |

`test:integration` and `test:e2e` are slow and start real servers. Run them before touching
anything in `src/index.ts`, `src/assets.ts`, the theme components, or the build configuration.

## Project identity

Package name, GitHub repository, plugin id and security contact live in one place:
`project.config.json`. Never edit the derived values by hand. Change the source of truth and
run:

```bash
npm run sync:meta
```

`npm run sync:check` fails the build when a derived file has drifted.

The Docusaurus plugin name (`docusaurus-plugin-plantuml-client`) is intentionally decoupled
from the npm package name, because it is the key under which global data is published.
Changing it would break already-built sites. Leave it alone.

## Code guidelines

- **TypeScript, strict.** No `any` without a comment explaining why nothing narrower works,
  and no `@ts-expect-error` / `@ts-ignore` to silence a real error.
- **Respect the SSR boundary.** Nothing under `src/index.ts`, `src/options.ts`,
  `src/assets.ts` or `src/constants.ts` may import from `src/runtime/` or `src/theme/`.
  Browser globals are only touched behind a guard.
- **No third-party network access at runtime.** No CDN, no PlantUML or Kroki server, no
  telemetry, ever. This is the product's central promise.
- **Never leave the render queue wedged.** Any new code path through `runtime/queue.ts` must
  advance the queue on success, failure, timeout and abort alike.
- **Never write state after unmount.** Check the abort signal before every state write.
- **Comment only non-obvious behaviour.** Explain why, not what. Comments that restate the
  code will be asked to go.
- **No fixed-duration sleeps in tests.** Await an event, a process output line or a Playwright
  locator instead. A test that passes only because of execution order is a bug.

## Tests

New behaviour needs a test at the right layer:

- **Unit / component** (`tests/unit/`, Vitest + jsdom) — options, metadata parsing, cache,
  queue, loader, sanitization, component states. Docusaurus aliases are stubbed in
  `vitest.config.ts`; the renderer is mocked in component tests.
- **Package** (`scripts/verify-package.mjs`) — anything affecting what is published.
- **Integration** (`scripts/test-packed-example.mjs`) — anything affecting how the package is
  consumed from a registry install.
- **End-to-end** (`tests/e2e/`, Playwright) — anything involving the real engine, real asset
  URLs, hydration or colour-mode switching. The engine contract test is what will catch an
  incompatible `@plantuml/core` upgrade.

When a technical assumption about `@plantuml/core` or Docusaurus turns out to be false, add a
regression test **and** record the decision in `docs/adr/`. Both existing ADRs came from
exactly that situation.

## Commits and pull requests

- Write commit subjects in the imperative mood, under ~72 characters:
  `Serialize renders behind a module-level FIFO queue`. Explain the _why_ in the body when it
  is not obvious.
- Keep a pull request to one concern. A refactor and a behaviour change in the same diff are
  hard to review and harder to revert.
- Update the docs in the same pull request: the README options table, `docs/architecture.md`,
  and the `## [Unreleased]` section of `CHANGELOG.md` (Keep a Changelog style).
- Say in the description which checks you ran, and note anything you could not run locally.
- Do not bump the version or create a tag in a pull request. Releases are the maintainer's
  job — see the release section of the README.

## Reporting bugs

Please include the Docusaurus version, the Node version, whether webpack or Rspack is in use,
your `baseUrl`, the plugin options, the smallest PlantUML source that reproduces it, and the
browser console output. If it is a rendering problem, the value of `data-plantuml-status` on
the affected `<figure>` is usually the most informative single detail.
