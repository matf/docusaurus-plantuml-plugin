# Security Policy

## Supported versions

Only the latest minor of the current major receives security fixes. There are no maintained
release branches.

| Version | Supported |
| ------- | --------- |
| `1.0.x` | yes       |
| `0.1.x` | no        |

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security problem.**

Report it through GitHub private vulnerability reporting on this repository:

<https://github.com/matf/docusaurus-plantuml-plugin/security/advisories/new>

This is the only reporting channel. It keeps the report private until a fix is available,
gives us somewhere to collaborate on the patch, and handles CVE assignment if one is
warranted. There is deliberately no email alias to go stale or go unread.

### What to include

- The affected version, and whether you reproduced it in a real Docusaurus site or in the
  example fixture.
- The plugin options in use — in particular whether `sanitizeSvg` was `true` or `false`.
- A minimal reproduction: the PlantUML source, the site configuration, and the observed
  behaviour.
- The impact you believe it has.

### What to expect

This is a small, volunteer-maintained project, so please calibrate expectations accordingly:
we aim to acknowledge a report within a few working days and to give you an assessment and a
rough timeline shortly after. We will tell you when a fix ships, and we are glad to credit you
in the advisory and changelog unless you would rather we did not. Please give us a reasonable
opportunity to fix the issue before disclosing it publicly.

## Security model

Understanding what this plugin does and does not do will help you judge whether a finding is
in scope.

### Nothing leaves the browser

Rendering is entirely client-side and same-origin, for **both** the PlantUML and the Graphviz
engine. Diagram source is never transmitted to plantuml.com, to a Kroki instance, or to any
other service, and there is no configuration that would make it do so. Both engines
(`viz-global.js`, which is Graphviz, and `plantuml.js`) are copied out of the installed
`@plantuml/core` dependency into your own build output and served from your own origin under
your `baseUrl` — never from a CDN. `viz-global.js` embeds its WebAssembly inline, so it does
not fetch a side-car `.wasm` from anywhere either.

### Zooming never touches the sanitized markup

Zoom and pan apply a CSS transform to a wrapper element. The sanitized SVG is never mutated,
never re-serialized and never re-parsed after it has been inserted — re-serializing purified
markup is the mutation-XSS shape this deliberately avoids. See
[ADR 0003](docs/adr/0003-zoom-container-transform.md).

### Rendered SVG is treated as untrusted

Engine output is generated from author-controlled diagram source, and diagram source can
express markup. By default (`sanitizeSvg: true`) every rendered SVG — from either engine —
passes through DOMPurify with `USE_PROFILES: {svg: true, svgFilters: true}` before it reaches
the DOM, with `foreignObject`, `script`, `iframe`, `object`, `embed`, `audio` and `video`
additionally forbidden. Event-handler attributes and `javascript:` URLs are removed.
`foreignObject` is singled out because it is the one SVG element that can host arbitrary HTML —
allowing it would reinstate the injection surface the SVG profile exists to remove.

Two Graphviz-specific notes, both verified by tests rather than assumed:

- Graphviz renders HTML-like labels (`label=<<table>…>`) to native SVG `<text>`, **not** to
  `<foreignObject>`, so forbidding that element costs no Graphviz functionality.
- DOT's `URL` and `href` attributes emit real `<a>` links into the SVG. Ordinary and relative
  links survive; `javascript:` — plain, entity-encoded or whitespace-padded, in either `href` or
  `xlink:href` — does not.

If sanitization leaves no `<svg>` root, the plugin raises an error rather than inserting the
result.

### `sanitizeSvg: false` is out of scope

Disabling sanitization is a documented, deliberate opt-out. With it off, any HTML or
JavaScript that a diagram author can express in either engine's output is injected into the page
verbatim and runs with your site's origin, cookies and storage. That is the stated behaviour
of the option, so a report demonstrating script execution with `sanitizeSvg: false` is not a
vulnerability in this plugin.

Only turn it off when every diagram source in your site is fully trusted — that is, when
anyone who can influence a diagram could already commit arbitrary code to the site.

**A bypass of sanitization while `sanitizeSvg: true` is very much in scope.** Please report
it.

### Also in scope

- Any way to make the plugin fetch or execute code from a host other than the site's own
  origin.
- Any way for diagram source to escape the sanitizer, to reach `eval`-like execution, or to
  read data outside the page it is on.
- Supply-chain problems in what the package publishes — unexpected files in the tarball, or
  build output that does not correspond to the tagged source.
- Anything that makes a build publish or install content from an unintended source.

### Out of scope

- Vulnerabilities in `@plantuml/core` itself, in the PlantUML language, or in the Viz.js /
  Graphviz build it bundles. Report those upstream; we will pick up a fixed release.
- Vulnerabilities in Docusaurus, React or DOMPurify. Same — report upstream. If a fixed
  version requires a change here, tell us and we will make it.
- Denial of service through a deliberately pathological diagram. PlantUML rendering is
  serialized and bounded by `renderTimeoutMs`, and a diagram that exhausts that budget produces
  a contained error panel. Graphviz lays out synchronously, so a very large graph stalls the
  tab instead; `graphviz.maxSourceBytes` bounds that, and it is checked before the engine is
  even loaded. Either way, a slow diagram in your own documentation is a content problem.
- Missing hardening headers on a site that embeds this plugin. Content Security Policy is the
  site's responsibility; see the CSP section of the README for what this plugin needs.
- Findings that require `sanitizeSvg: false`, as described above.
