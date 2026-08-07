# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0]

### Added

- **A source view for every rendered diagram.** A `</>` control in the toolbar, beside the zoom
  buttons, **flips the frame**: the source takes the diagram's place, in the same box, with a
  button that copies it to the clipboard. Enabled by default; turn it off with
  `showSource: false`, or per fence with `showSource=false` in the metastring.

  Four details are deliberate:
  - **It shares the diagram's frame rather than sitting below it.** Below the diagram it had two
    failure modes: a diagram taller than the window pushed it off-screen, and while maximized it
    was painted behind the full-screen overlay. Sharing the frame removes both by construction.
  - **The diagram is hidden, not unmounted**, so the frame keeps its height — nothing on the page
    moves when you flip — and the reader's zoom and pan survive the round trip.
  - The copy result is announced through a `role="status"` region rather than by renaming the
    button, because a control whose accessible name changes is announced as a new control.
  - A failed copy says so. `navigator.clipboard` is undefined outside a secure context, which a
    docs site on plain HTTP genuinely is; the source is on screen either way, so the reader can
    select the text.

- `showSource` plugin option and the matching `showSource` / `showSource=false` fence flag.
- `data-plantuml-source-open="true"` on the `<figure>` while the panel is open, part of the
  documented `data-*` contract.

### Changed

- With `zoom: false` the source control gets its own row after the diagram, since there is no
  zoom toolbar to join. `figure > div[role="img"]` remains the first child, so the shape the
  pre-zoom markup has always had is unchanged. Setting both `zoom: false` and
  `showSource: false` restores the bare markup exactly.

## [1.1.2]

### Fixed

- De-flaked the zoom test suite. `data-plantuml-status="ready"` is written during the render
  commit, but `useZoomPan` attaches its listeners and writes the initial transform from
  *passive* effects that React flushes afterwards. The shared `renderReady()` helper returned on
  the attribute alone, so a test could act on the viewport in between — a dispatched wheel event
  found no listener, and a zoom set before the reset effect ran was immediately overwritten.
  Both surfaced on CI as a scale stuck at 1, and one of them failed the `1.1.1` release build.
  The helper now also waits for the hook's inline transform, which only the hook ever writes.

### Changed

- Development dependencies: `vitest` and `@vitest/coverage-v8` `3` → `4`, and
  `@testing-library/jest-dom` `6` → `7`. No product code changed; all 433 tests and the
  coverage report pass unchanged.

- `.github/dependabot.yml` now ignores the majors that are blocked upstream rather than merely
  unreviewed, each with the reason and the condition for revisiting. Left un-ignored they
  produced a grouped pull request that could never go green, which hid the updates that *were*
  takeable:
  - **TypeScript 7** — typescript-eslint refuses to run against it
    ([typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)).
  - **ESLint 10** — `eslint-plugin-react@7.37.5`, the latest release, still caps its peer range
    at `^9.7`.
  - **eslint-plugin-react-hooks 7** — its React Compiler rules flag 15 places in `useZoomPan`
    that are the deliberate design recorded in
    [ADR 0003](docs/adr/0003-zoom-container-transform.md).

## [1.1.1]

### Security

- Added `overrides` pinning three transitively-installed packages to patched versions:
  `serialize-javascript` `>= 7.0.7` (RCE and denial-of-service advisories), `uuid` `>= 11.1.1`
  (missing buffer bounds check) and `esbuild` `>= 0.28.1` (development-server request
  handling). `npm audit` now reports no vulnerabilities.

  **This changes nothing for consumers of the package.** All three arrived through build-time
  tooling — `serialize-javascript` and `uuid` through the `@docusaurus/core` used to build the
  example site, `esbuild` through `tsup` — and none of them is part of what a reader's browser
  downloads. npm also ignores an `overrides` block declared by a dependency, so these apply
  only to this repository's own installs. The plugin's own `copy-webpack-plugin` dependency
  was already resolving a patched `serialize-javascript`.

## [1.1.0]

### Added

- **Graphviz/DOT diagrams.** `dot`, `graphviz` and `gv` fences are now laid out by Graphviz in
  the reader's browser and replaced with SVG, exactly as `plantuml` fences already were. Zoom
  and pan, lazy rendering, caching, sanitization, the accessible markup and the error panel are
  all shared with the PlantUML path.

  **This costs no additional bytes.** `@plantuml/core` already bundles `viz-global.js` — Viz.js
  containing Graphviz — because PlantUML needs it for its own layout, and the plugin has been
  emitting and loading it since `0.1.0`. Rendering DOT reuses that engine rather than adding a
  dependency. See [ADR 0004](docs/adr/0004-graphviz-engine-reuse.md).

- A `graphviz` option group: `enabled`, `languages`, `engine`, `allowEngineOverride`,
  `maxSourceBytes` and `transparentBackground`. Unknown keys inside it are rejected at build
  time, like unknown keys at the top level.

- Per-fence layout engine selection with `engine=neato` (or `circo`, `fdp`, `twopi`, `sfdp`,
  `osage`, `patchwork`, `nop`, `nop1`, `nop2`, `dot`) in the fence metastring. Disable with
  `graphviz.allowEngineOverride: false`.

- Two `data-*` attributes on the diagram `<figure>`: `data-diagram-engine`
  (`plantuml` | `graphviz`) and `data-diagram-layout` (the Graphviz layout engine, absent on
  PlantUML diagrams). Both are part of the documented public surface.

- `GraphvizOptions`, `ResolvedGraphvizOptions`, `GraphvizEngine`, `GRAPHVIZ_ENGINES` and
  `DEFAULT_GRAPHVIZ_OPTIONS` are exported from the package root.

### Changed

- **`dot`, `graphviz` and `gv` fences now render as diagrams instead of as code blocks.** This
  is the one behaviour change in this release. If you have such fences that are meant to stay
  code, set `graphviz: {enabled: false}` or narrow `graphviz.languages`.

- **The two runtimes are now loaded independently.** `viz-global.js` (~1.4 MB) and
  `plantuml.js` (~6.8 MB) previously shared one loader promise, so any diagram fetched both.
  They are now separate singletons, and a page with only DOT diagrams never downloads the
  PlantUML engine. Nothing changes for a PlantUML-only page: the same two files load in the
  same order from the same single `<script>` tag.

- The build now fails with an actionable message if the installed `@plantuml/core` is missing
  either runtime file, rather than letting a broken install reach a reader's browser as a
  runtime load failure.

- Progress text, the default accessible label and the error heading name the engine that is
  actually involved — "Loading Graphviz runtime…", "Graphviz diagram", "Error: Graphviz diagram
  could not be rendered".

- The missing-plugin-data error panel now says "Diagram plugin data is missing" rather than
  "PlantUML plugin data is missing", since it applies to both engines.

### Notes

- **Invalid DOT is reported with Graphviz's own diagnostic, including the line number** — for
  example `syntax error in line 3 near '}'`. PlantUML reports invalid diagrams by rendering an
  error picture, which the plugin has to detect heuristically
  ([ADR 0002](docs/adr/0002-render-to-string.md)); Graphviz returns structured errors, so the
  reader is told exactly what is wrong and where.

- **Graphviz diagrams are not re-rendered on a colour-mode toggle.** Graphviz has no dark
  theme, so rather than laying the graph out twice, the plugin renders on a transparent
  background and retargets Graphviz's default black strokes, fills and text at the page's text
  colour in CSS. Colours set in the DOT source always win, in both modes. As a result the
  colour mode is absent from the Graphviz cache key and a theme toggle does not disturb a
  reader's zoom.

- **`graphviz.maxSourceBytes` defaults to 100 000.** Graphviz lays out synchronously: a
  300-edge graph renders in ~26 ms, but a 3 000-edge graph takes ~2.25 s and visibly freezes the
  page. Oversized sources are refused with an explanatory panel, before the engine is even
  downloaded.

- Rendering remains 100% same-origin and client-side. No CDN, no rendering service, no
  `unsafe-eval`, and no Graphviz installation on the build machine or the reader's.

## [1.0.3]

### Security

- `copy-webpack-plugin` `12` → `14`, which moves the transitive `serialize-javascript`
  dependency to `7.0.7`. That closes a high-severity advisory (RCE via `RegExp.flags`) and a
  denial-of-service advisory in the version the plugin previously pulled in. The dependency is
  used at build time and never reaches a site visitor's browser.

### Changed

- `engines.node` is now `>= 20.9.0`, following `copy-webpack-plugin@14`. In practice this is
  not a restriction: the Node 20 LTS line begins at `20.9.0`, so any supported Node 20 already
  satisfies it.
- Development dependencies updated: `globals` `16` → `17`, `@types/node` `22` → `26`, and
  React `18` → `19` for the unit-test environment. The plugin still supports React 18 and 19;
  the example site continues to exercise React 18 end to end, so both are covered.
- GitHub Actions updated: `actions/checkout` `5` → `7`, `actions/setup-node` `5` → `7`,
  `actions/upload-artifact` `4` → `7`.

### Fixed

- Resets of the zoom view now have exactly one owner. The listener effect also reset on every
  re-attach, duplicating the effect keyed on the rendered picture; any re-attach for an
  unrelated reason would have silently discarded a zoom the reader had chosen.
- A unit test built a fake React element from its internal `$$typeof` symbol, which React 19
  renamed. It now uses a real element, so it no longer depends on React internals.
- The maximize round-trip test no longer assumes effect flush order, which made it flaky on
  CI. It asserts the same value, so a genuinely wrong transform still fails.

## [1.0.2]

### Fixed

- The zoom buttons and keyboard shortcuts now zoom about the viewport's top-left corner rather
  than its centre. A diagram that fits its viewport is left-aligned, so the empty space is to
  its right and below; zooming about the centre scaled that empty space and pushed the diagram
  off the top and left edges, most visibly on a maximized diagram. Wheel zoom continues to
  track the pointer.

## [1.0.1]

### Fixed

- Maximizing a diagram no longer uses the Fullscreen API. It took the whole browser window
  fullscreen in Firefox instead of presenting the diagram, and the `::backdrop` sits outside
  the fullscreened element, so the page showed through behind a diagram with a transparent
  background. The diagram now expands into an opaque in-page overlay that fills the browser
  viewport, closed with the same button or <kbd>Escape</kbd>.
- The maximize control is now available in every browser. It previously required
  `Element.requestFullscreen()` and was hidden where that is missing, notably iOS Safari.

### Added

- `data-plantuml-maximized` on the figure while a diagram fills the viewport.

### Changed

- The fourth toolbar button is labelled `Maximize diagram` (was `Toggle fullscreen`) and
  exposes `aria-pressed`. End-to-end tests selecting it by its accessible name need updating.

## [1.0.0]

First stable release. The public surface — plugin options, fence metadata flags, the `data-*`
attributes and the shape of the rendered markup — is now covered by semantic versioning.

### Added

- Zoom and pan for rendered diagrams: Ctrl + wheel (and trackpad pinch) zooms about the
  pointer, dragging pans, and a `role="group"` control toolbar offers zoom out, zoom in, reset
  and — where the browser supports it — fullscreen.
- Keyboard operation on a focusable viewport: `+`/`=`, `-`/`_`, `0`, arrow keys, and
  Shift + arrows to pan by most of the viewport. Modified keys are left to the browser, and
  `Tab` always escapes.
- `zoom` plugin option (default `true`) and a per-fence `zoom` / `zoom=false` metastring flag
  that overrides it for a single diagram.
- `data-plantuml-interactive` on the figure and `data-plantuml-zoom` on the viewport.
- `parseBooleanMeta()` for reading boolean flags from a fence metastring.

### Changed

- **Breaking: the rendered markup changed for zoomable diagrams.** With `zoom` enabled — the
  default — the `role="img"` container is wrapped by a viewport and a transform layer, and a
  control group is added beside it. Site CSS that targeted
  `[data-plantuml-diagram] > div[role="img"]` as a **direct child** must be updated;
  `div[role="img"] > svg` still holds. Setting `zoom: false` restores the `0.1.0` markup
  exactly.
- **Breaking: zoomable diagrams add keyboard tab stops.** A zoomable diagram contributes about
  four (the viewport and its buttons).
- Plain scrolling over a diagram is unaffected: only Ctrl + wheel zooms, and on touchscreens
  one finger still scrolls the page and two-finger pinch is still the browser's own page zoom.

### Fixed

- `configureWebpack` no longer throws on Docusaurus `3.5.x`, where `currentBundler` does not
  exist. That release line is now covered by the CI compatibility matrix.

## [0.1.0]

Initial release.

### Added

- Docusaurus 3 plugin that replaces `plantuml` and `puml` fenced code blocks with SVG
  diagrams rendered in the browser by `@plantuml/core`, with no Java runtime, no PlantUML
  or Kroki server, and no CDN.
- Runtime assets (`viz-global.js`, `plantuml.js`) copied into the site build under a
  version-namespaced, `baseUrl`-relative directory, on both the webpack and Rspack bundlers.
- `PlantUmlDiagram` theme component with idle, loading, rendering, ready and error states,
  `IntersectionObserver`-based lazy rendering, and a `<noscript>` source fallback.
- Light/dark rendering driven by the Docusaurus colour mode, with the colour mode folded
  into the cache key.
- Serialized module-level render queue so that multiple diagrams on one page cannot corrupt
  the engine's shared state.
- Rendered SVG output cached in memory or `sessionStorage` under a bounded, deterministic key.
- DOMPurify SVG sanitization enabled by default, with a documented `sanitizeSvg: false`
  opt-out.
- Plugin option validation that rejects unknown keys and out-of-range values at build time.

[Unreleased]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.0.3...v1.1.0
[1.0.3]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/matf/docusaurus-plantuml-plugin/releases/tag/v0.1.0
