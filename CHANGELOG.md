# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/matf/docusaurus-plantuml-plugin/releases/tag/v0.1.0
