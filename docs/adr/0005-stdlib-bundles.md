# ADR 0005 — Serve the PlantUML standard library as per-namespace bundles, and short-circuit the engine's own loader

- Status: accepted
- Date: 2026
- Affects: `src/stdlibBundle.ts`, `src/stdlibShared.ts`, `src/stdlib.ts`, `src/index.ts`,
  `src/runtime/stdlibLoader.ts`, `scripts/update-stdlib.mjs`, `assets/stdlib/`

## Context

`!include <C4/C4_Container>` is how most real PlantUML in a docs site starts. Before 1.3.0 it
produced PlantUML's grey "Fatal parsing error" card, because the plugin served the engine and
nothing else.

### How the engine resolves an include

None of this is documented. It was read out of the installed `plantuml.js` and confirmed by
probing the real engine in headless Chromium.

The engine looks a namespace up in three globals, all keyed by a **lower-cased** namespace and
a **lower-cased** path with the extension stripped:

```js
window.PLANTUML_STDLIB['c4']['c4_container'] = ['line', 'line', ...]  // helper CCf
window.PLANTUML_STDLIB_JSON['office']['all'] = { ... }                // helper DJm
window.PLANTUML_STDLIB_INFO['c4'] = {name: 'C4', license: 'MIT', ...} // helper DID
```

When the namespace is absent, the engine appends a `<script>` of its own:

```js
// helper ED3, condensed
var s = document.createElement('script');
s.src = b; // "c4.min.js"
document.head.appendChild(s);
```

`s.src` is **relative**, so it resolves against the current page. On a docs site that is
`/docs/architecture/c4.min.js`, which cannot exist. There is no base-URL hook, no
configuration, no callback.

Two things follow, and the second is the one that shaped the design:

1. Serving the bundles where the engine looks is impossible — the location depends on the
   reader's route, not on the site's layout.
2. **Pre-populating `window.PLANTUML_STDLIB` is not enough.** Verified directly: with the
   global fully populated and the page-relative URL 404ing, the render still failed. The engine
   consults its own bookkeeping — `window.__pl_script_state[src]` — before it consults the
   global, and only reads the global once the script it wanted has settled.

### How much of it there is

The standard library is 265 MB of `.puml`, 28 MB gzipped, across 34 namespaces. `aws` alone is
114 MB; `ibm`, `tupadr3`, `material7.4.47` and `awslib14`/`awslib20` account for most of the
rest. Separately, seven namespaces — `classy`, `classy-c4`, `cloudogu`, `edgy`, `elastic`,
`gcp`, `osa2` — declare no licence at all, upstream or in their own repositories.

## Decision

**Vendor generated per-namespace bundles, emit them as versioned site assets, load only the
namespaces a diagram names, and write `__pl_script_state` so the engine's own loader stands
down.**

Concretely:

- `scripts/update-stdlib.mjs` generates `assets/stdlib/<namespace>.min.js` from a pinned
  plantuml-stdlib commit, plus a manifest and a licence table. It is never part of
  `npm run build`: a build must not reach the network, and contributors must be able to work
  offline.
- `src/stdlibBundle.ts` is the generator itself, a port of upstream's `JsBuilder.java`. The
  site build uses the same code for `stdlib.include`, so there is one implementation of the key
  derivation rather than two that can drift.
- `src/index.ts` emits the bundles into
  `assets/plantuml-client-<coreVersion>/stdlib-<revision>/` and publishes a small index —
  namespace to dependencies — through global data.
- `src/runtime/stdlibLoader.ts` scans the source for `<namespace/…>`, expands the dependency
  closure from that index, loads each bundle from the assets directory, and then sets
  `window.__pl_script_state['c4.min.js'] = {state: 'loaded', ok: [], err: []}`.

The last line is the load-bearing one. It is an undocumented internal of `@plantuml/core`,
which is not a comfortable thing to depend on, and the section below says what happens if it
changes.

## Consequences

### The dependency index has to come from the build

`k8s/Common.puml` includes `<c4/…>`. The engine would discover that mid-render, synchronously,
with no opportunity to fetch anything. So dependencies are computed when the bundles are
generated and shipped in the manifest, and the loader resolves the closure before the engine is
handed the source.

Dependencies found only under `_examples_/` are recorded **separately**. C4's examples include
`office`; charging every C4 diagram 160 KB for a namespace it never touches would have made the
per-namespace split pointless. Example dependencies load only when the diagram includes
something from `_examples_/` itself.

Includes with a computed path — `!include <material2.1.19/$icon>`, which DomainStory does inside
an `!if` — are ignored. The namespace is knowable but the file is not, and treating it as a hard
dependency would drag 6.8 MB of icons into a branch the diagram probably never takes. A
dependency the site does not provide is likewise skipped rather than raised, for the same
reason.

### Two deviations from upstream's generator, on purpose

**Both spellings of a name are registered.** Upstream strips `.puml` from the keys, while the
engine looks the name up exactly as written. `!include <C4/C4_Container.puml>` — the spelling
C4-PlantUML's own documentation uses — therefore cannot resolve against an upstream bundle.
Every entry here is registered under both spellings, sharing one array, so the alias costs no
memory and a little file size.

**A file that is a whole `@startuml … @enduml` document is unwrapped.** PlantUML's file-based
`!include` takes the contents of such a file; the standard library lookup passes the markers
through verbatim, and the diagram then fails on a nested `@startuml`. 81 of `cloudinsight`'s 83
sprite files are written this way, so without unwrapping the namespace does not work at all.
Only single-block files are unwrapped — in a multi-block file the markers are what separates
the blocks — and `!include <ns/file!0>`, which selects a block by index, was verified not to
work through this lookup either way, so nothing is lost.

### The vendored set is curated, on two criteria

**Licence first.** A namespace is vendored only when its upstream project declares a licence
that permits redistribution. plantuml-stdlib has no top-level licence and leaves most
`license:` fields empty, so each was checked at source and recorded in
`LICENCE_OVERRIDES`; the generator refuses to vendor a namespace it cannot attribute. The seven
namespaces that declare nothing are left out — redistributing them is the site owner's call, not
this package's.

**Size second.** What remains and fits is eight namespaces, ~2.9 MB unpacked and ~0.7 MB packed.
That is a twelvefold increase in the published package, which is why `verify-package.mjs` now
budgets the standard library separately from the plugin's own code: vendoring more can never
quietly pay for the compiled plugin growing.

One namespace was dropped for a third reason, and it is the one worth remembering: `DomainStory`
is 35 KB and MIT licensed, but every element it draws resolves an icon out of `material2.1.19`,
so it cannot render without 6.8 MB of icons beside it. Shipping it alone would have shipped a
namespace that does not work. The dependency is invisible to the manifest because the include is
computed — `!include <material2.1.19/$icon>` — which is exactly the case the scanner skips, so
nothing but rendering the thing would have caught it.

Everything else is reachable through `stdlib.include` plus `stdlib.source`, generated from the
site's own checkout during its build and cached under `.docusaurus`.

### The assets directory carries a revision

`assets/plantuml-client-<coreVersion>/stdlib-<revision>/`. The standard library changes on a
different schedule from the engine, so it needs its own cache-busting segment; the same revision
is part of the render cache key, so a refresh cannot be served from a stale SVG either. For
namespaces generated from a site's checkout the revision folds in a stamp of that directory, so
editing a local copy moves the URL.

### If the engine changes its internals

`__pl_script_state` is not a public API. If a future `@plantuml/core` renames it, the symptom is
specific and loud: the engine issues its own page-relative `<ns>.min.js` request, that 404s, and
the diagram shows an error. `tests/e2e/stdlib.spec.ts` asserts that no page-relative `.min.js`
request is ever made, so the regression fails CI rather than reaching a reader.

Two better outcomes would remove the need for the trick entirely, and both are upstream's to
give: a configurable base URL for the loader, or a check of `window.PLANTUML_STDLIB` before the
script injection. Either would reduce this module to "load the bundle". Until then the
short-circuit is the only mechanism that works from a nested route.

## Alternatives considered

**Inline the includes into the source before rendering.** Textual `!include` expansion is close
to what the preprocessor does anyway. Rejected: the preprocessor also has `!if`, `%function`,
`!define`, sub-parts and variables, and a partial reimplementation of it would be wrong in ways
that are hard to see and harder to debug. Using the engine's own resolution keeps semantics
exactly right.

**Ship the whole standard library.** 28 MB gzipped in the npm tarball, ~265 MB unpacked in every
user's `node_modules`, and no licence for a good deal of it. Not defensible for a plugin whose
own code is 250 KB.

**Publish the standard library as a companion npm package.** The architecturally cleanest
option — it mirrors how `@plantuml/core` carries the engine — and still available later. Not
taken now: it is a second repository, release pipeline and publish to maintain, and it does not
change the licence problem at all.

**Fetch namespaces from a CDN at render time.** Rejected outright. "No Java, no server, no CDN"
is the plugin's reason for existing, and a reader's browser announcing which architecture
diagrams they are reading to a third party is precisely what this package exists to avoid.

**Download the standard library during the site build.** Zero configuration for every namespace,
at the cost of a non-hermetic build that fails without network access and silently changes what
it produces. Rejected; `stdlib.source` gets the same result from a checkout the site controls.
