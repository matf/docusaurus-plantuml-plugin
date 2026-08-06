# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/matf/docusaurus-plantuml-plugin/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/matf/docusaurus-plantuml-plugin/releases/tag/v0.1.0
