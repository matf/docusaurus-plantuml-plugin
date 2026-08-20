# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Dependency updates merge themselves, and releases are cut by CI rather than from a laptop.**
  Dependabot now opens **one** pull request a week for npm — covering the plugin and the example
  site together — and one for GitHub Actions. Minor and patch updates auto-merge once the new
  `CI complete` check is green; majors ride in the same pull request and are held for review with
  a comment naming what holds them.

  Every green `main` then runs `.github/workflows/release.yml`, which reads `## [Unreleased]` to
  decide the version (`### Removed` or `BREAKING` → major, `### Added` → minor, anything else →
  patch, empty → no release), bumps `package.json` and `package-lock.json`, closes the section
  into a dated one, and pushes the commit and the tag **atomically**. The old
  `npm version && git push --follow-tags` recipe could leave a tag pointing at a pre-rebase commit
  whenever a dependency pull request landed in between — and `verify:tag` could not see it,
  because the tag and `package.json` agreed. `publish.yml` now also creates the GitHub Release,
  after npm has accepted the publish. Recorded in
  [ADR 0006](docs/adr/0006-automated-release-from-changelog.md).

- `npm run sync:check` now also asserts that `package-lock.json`'s `version` fields match
  `package.json`, and `npm run sync:meta` fixes them. That drift had to be repaired by hand once
  already.

## [1.5.0] - 2026-08-14

### Added

- **Deep links *from* diagram nodes — including to diagrams on other pages.** A node can now
  carry a link to another diagram's deep link, and clicking it navigates there and focuses
  the target node: `component "Order Service" as ORDER_SVC
  [[/docs/orders#graph?highlight-node=ORDER_DETAIL_1]]` in PlantUML, or
  `orders [URL="/docs/orders#graph?highlight-node=ORDER_DETAIL_1"]` in Graphviz.

  For PlantUML this means the plugin now **synthesizes the anchors the bundled engine
  drops**: `[[url]]` on components, participants, C4 macros and relations is read back out
  of the fence source and wrapped around the rendered element — clickable,
  keyboard-focusable, marked `data-plantuml-diagram-link`, coloured with the site's link
  colour. Correlation runs on the alias the engine writes into `data-qualified-name`, with
  `data-source-line` as the fallback, so it survives `!include` — standard-library diagrams
  included, whose preprocessing shifts every line number. Synthesized hrefs pass a scheme
  allowlist; a link that cannot be correlated attaches to nothing. Links inside note bodies
  remain the engine's styled-but-inert text, and one link per source line is correlatable.

  Navigation is SPA-aware in both engines: in-diagram links to same-site URLs go through
  the Docusaurus router — no full page load — and site-absolute paths get the site's
  `baseUrl` exactly as markdown links do. External links and pure `#…` anchors stay native,
  and clicks that end a drag never navigate.

### Changed

- **The deep-link highlight is green, not red.** The focused-node colour was the theme's
  danger red, which reads as an error on a highlight that persists until the hash changes;
  it now defaults to the theme's success green. Sites can pick any colour by setting
  `--plantuml-focus-color` — the rule reads
  `var(--plantuml-focus-color, var(--ifm-color-success))`.

## [1.4.0] - 2026-08-13

### Added

- **A Fit control in the maximized view.** While a diagram fills the screen, one press
  returns it to the fitted scale — the whole diagram filling the screen, magnified or shrunk
  as the picture demands — after zooming or panning away from it. Maximizing itself now
  opens at that truly fitted scale too: the view's content measurement tracks the rendered
  picture rather than the full-width frame, which is also what tightens the minimap around
  the actual diagram. (The pan clamp deliberately keeps its old frame-wide bounds, so focal
  wheel zoom holds the point under the pointer exactly as before.) The button is
  deliberately absent from the inline toolbar, where the frame grows with the diagram and a
  fit would merely duplicate Reset; it sits between Reset and Maximize, is drawn as inline
  SVG like the rest of the toolbar, and carries `aria-label="Fit diagram to screen"`.

- **A minimap.** A new toggle in the bottom-left corner opens a small copy of the diagram
  with a rectangle marking what the viewport currently shows; pressing or dragging anywhere
  on the map centres the view there, so a single press doubles as "jump there". The map
  follows every zoom, pan and resize without re-rendering the figure — it subscribes to the
  same imperative transform writes the zoom hook itself uses — and works while maximized.
  The figure carries `data-plantuml-minimap-open="true"` while the map is up.

  The map is pointer-only and hidden from assistive technology on purpose: the real viewport
  is already keyboard-operable, so a second, duplicated view of the same diagram would add
  noise without adding a capability. Its close button stays outside the hidden subtree and
  remains focusable.

- **Search within a diagram.** The new lens button opens a search bar beside the toolbar: a
  case-insensitive substring search over the rendered SVG's text. Every match is marked with
  `data-plantuml-search-match` and highlighted from the stylesheet — the cached SVG string is
  never mutated — and the current match additionally carries `data-plantuml-search-current`.
  Enter and the chevron buttons step through the matches (Shift+Enter backwards), each step
  centres the view on its match at the current zoom level, and Escape or ✕ closes the bar
  and sweeps every highlight. The figure carries `data-plantuml-search-open="true"` while
  the bar is up.

- **Deep links into diagrams.** A URL hash of the form `#graph?highlight-node=REACTION_1234`
  focuses a node: every diagram on the page reacts - none needs an id of its own, and a
  diagram without the node does nothing - the page scrolls to the first matching figure, the
  node is marked with `data-plantuml-focused-node` and highlighted from the stylesheet, and
  a zoomable diagram snaps to 100% centred on it. The hash is watched through the router, so
  every kind of navigation reacts — pushed, replaced, popped and native `#…` clicks alike,
  including a `<Link>` navigation that *drops* the hash, which sweeps the highlight — and a
  `#graph?…` hash defeats lazy loading so below-the-fold targets still react.

  The identifier resolves through a ladder - explicit SVG `id` (Graphviz `node [id="…"]`),
  the PlantUML alias (`component "X" as REACTION_1234`, aliased notes included, via the
  `data-qualified-name` the engine writes into its SVG), a self-anchor link
  (Graphviz `URL="#graph?…"`, which doubles as the node's own permalink when clicked),
  Graphviz node names via their `<title>`, multiline labels with `%0A`-encoded newlines
  matched against consecutive text lines within one node's group, and finally a
  case-insensitive substring of a single line. The first level that matches wins, so a
  deterministic id always beats loose text matching.

  Alongside this, Graphviz author links are pinned by tests, and sanitization keeps
  `target="_top"` on links instead of silently dropping it. One engine limitation surfaced
  and is now documented: the bundled PlantUML engine renders `[[url]]` link text but emits
  no `<a>` elements, so PlantUML links are not clickable - which is why PlantUML deep-link
  ids ride on aliases rather than on links.

### Fixed

- **The rendered SVG is no longer re-parsed on every re-render under React 19.** React 19
  compares `dangerouslySetInnerHTML` by the wrapper object's identity rather than by its
  `__html` string, so the inline `{{__html: svg}}` literal made every state change — opening
  the source view, maximizing, a copy confirmation — throw away and re-parse the entire SVG
  subtree. The wrapper is now memoized per SVG string. This is also what makes the search's
  in-DOM highlights survive unrelated re-renders.

## [1.3.1]

### Fixed

- **The toolbar's controls are drawn rather than typed** ([#21]). `⛶` U+26F6 SQUARE FOUR
  CORNERS, the maximize icon, has no glyph in any font that ships with a stock Linux desktop,
  so that control rendered as an empty box for an entire platform's readers — on the demo site
  included. The other four only worked because DejaVu Sans happens to be installed, which a
  minimal container image or a locked-down desktop does not promise, so all of them are now
  inline SVG and the plugin depends on no font at all.

  The source toggle's `</>` went the same way. It is ASCII and never had the glyph problem, but
  left as text it would have been the one control still drawn in the page font, at a different
  weight and optical size from its neighbours.

  Nothing about the accessible surface changes: every button keeps its `aria-label`,
  `aria-pressed`, `aria-expanded` and `aria-controls`, and the icons are `aria-hidden`. The
  icons inherit `currentColor` and `1em`, so both colour modes and reader font scaling behave
  exactly as before, with no CSS change. The `Copy` text button and the `⚠` error glyph are
  unchanged.

  If you worked around this with a `font-family` override on `[class*='toolbarButton']`, it is
  now a harmless no-op and can be removed.

### Changed

- The example site records why its `onBrokenMarkdownLinks` stays at the top level rather than
  moving to `markdown.hooks`, where Docusaurus 3.9 put it: 3.5's `markdown` schema rejects the
  key outright, and CI builds that fixture against 3.5.2 — the oldest release this plugin's
  peer range claims.

[#21]: https://github.com/matf/docusaurus-plantuml-plugin/issues/21

## [1.3.0]

### Added

- **The PlantUML standard library.** `!include <C4/C4_Container>` now renders, with no
  configuration and nothing to install. Eight namespaces ship with the plugin — `c4`,
  `archimate`, `eip`, `k8s`, `kubernetes`, `azure`, `office` and `cloudinsight` — and a page
  downloads only the ones its diagrams actually include. A C4 page costs 29 KB gzipped; a page
  with no standard library include costs nothing.

  Four details are worth knowing:
  - **Bundles are served from your own `baseUrl`**, like every other asset. Left to itself the
    engine resolves a namespace against the *current page* — `/docs/architecture/c4.min.js` —
    which cannot exist, and pre-populating its global does not stop it. The plugin loads the
    bundle from the assets directory and then tells the engine the work is done. See
    [ADR 0005](docs/adr/0005-stdlib-bundles.md).
  - **Includes the library makes of itself are resolved too**, from an index built when the
    bundles are generated. `k8s/Common` needs `<c4/…>`, and the engine would only discover that
    mid-render, with no chance to fetch it.
  - **`!include <C4/C4_Container.puml>` works**, spelled with the extension. Upstream's own
    bundles cannot resolve that spelling, even though C4-PlantUML's documentation uses it.
  - **A missing namespace is explained, not dumped on the reader.** The panel names the
    namespace and the option that adds it, instead of PlantUML's grey "Fatal parsing error".

- `stdlib` plugin option: `stdlib: false` switches the feature off entirely; `stdlib.include`
  plus `stdlib.source` add namespaces from a `plantuml-stdlib` checkout — including the icon
  libraries that are far too large to vendor, such as `aws`, `ibm` and `tupadr3` — and
  `stdlib.namespaces` narrows what a build emits.
- `stdlib` error kind, for an include the site cannot resolve.
- `npm run stdlib:update`, which regenerates the vendored bundles from a pinned
  plantuml-stdlib commit. It is maintainer-only and never part of `npm run build`, so site
  builds stay offline and hermetic.
- `assets/stdlib/LICENSES.md`, recording the upstream project, version and licence of every
  vendored namespace. Namespaces whose upstream declares no licence are deliberately not
  vendored; `stdlib.include` remains available for anyone who wants them.

### Fixed

- **PlantUML's preprocessor failures are now reported as errors** rather than passed through as
  successfully rendered pictures. Calling a macro the included library does not define
  (`Function not found RelIndex`), naming a file that is not in a namespace
  (`cannot include <C4/C4_Nope>`) and an include that could not be resolved at all
  (`Fatal parsing error`) all produce an error card with no `Syntax Error?` marker on it, so
  the existing detection missed all three. They are the likeliest ways a standard library
  diagram goes wrong, which is how this surfaced. The panel shows the failure alone rather
  than the thousands of macro-expanded lines it is buried in.
- **Library files that are themselves whole `@startuml … @enduml` documents** are unwrapped when
  the bundle is generated, the way PlantUML's file-based `!include` does. The standard library
  lookup passes the markers through verbatim, and a nested `@startuml` fails the diagram — 81 of
  `cloudinsight`'s 83 sprite files are written that way, so the namespace was unusable without
  this. Files with more than one block are left alone.

### Changed

- A script asset that fails to load is now replaced rather than reused when a later diagram
  retries, so one flaky response no longer disables the engine — or a standard library
  namespace — for the rest of the page.
- The render cache key includes the standard library revision, so refreshing it cannot serve a
  picture rendered against the old one.
- The published package grows from 77 KB to ~776 KB packed (245 KB to ~3.2 MB unpacked); the
  difference is the vendored bundles. `verify-package.mjs` budgets them separately from the
  plugin's own code, which keeps its own 400 KB ceiling.

## [1.2.0]

### Added

- **A source view for every rendered diagram.** A `</>` control in the toolbar, beside the zoom
  buttons, **flips the frame**: the source takes the diagram's place, in the same box. A
  **Copy** button joins the same toolbar while the source is shown, so every control on a
  diagram lives in one place. Enabled by default; turn it off with
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
- `data-plantuml-source-open="true"` on the `<figure>` while the source is shown, part of the
  documented `data-*` contract.

### Changed

- The zoom controls are hidden while the source is shown — they would act on a picture nobody
  can see. **Maximize stays**, because it sizes the frame the source is read in and removing it
  while maximized would leave Escape as the only way back out.

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

[Unreleased]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.0.3...v1.1.0
[1.0.3]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/matf/docusaurus-plantuml-plugin/releases/tag/v0.1.0
