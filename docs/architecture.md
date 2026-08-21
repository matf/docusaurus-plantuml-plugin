# Architecture

How `@matfsw/docusaurus-plantuml-plugin` turns a fenced code block into an SVG, and why the
pieces are shaped the way they are.

The plugin renders two diagram languages with two engines: **PlantUML** (`plantuml`, `puml`
fences) and **Graphviz/DOT** (`dot`, `graphviz`, `gv` fences). They share everything except the
render call itself — the code-block wrapper, the asset loader, the cache, the sanitizer, the
component, and the zoom/pan UI are all common.

Decisions large enough to deserve their own record live in `docs/adr/`:

- [ADR 0001 — Wrap `@theme-init/`, not `@theme-original/`](adr/0001-theme-init-alias.md)
- [ADR 0002 — Use `renderToString`, not the DOM `render()` API](adr/0002-render-to-string.md)
- [ADR 0003 — Zoom by transforming a wrapper, not the SVG](adr/0003-zoom-container-transform.md)
- [ADR 0004 — Render DOT with the Graphviz already inside `@plantuml/core`](adr/0004-graphviz-engine-reuse.md)
- [ADR 0005 — Serve the standard library as per-namespace bundles](adr/0005-stdlib-bundles.md)

## Overview

```text
docusaurus.config.ts
        │
        ▼
  src/index.ts ─────────────── validateOptions()  ── src/options.ts
        │                       (build fails early on bad config)
        ├── getThemePath()   ── registers dist/theme as a plugin theme
        ├── contentLoaded()  ── setGlobalData({options, assetsDir, coreVersion, stdlib})
        └── configureWebpack ── copies viz-global.js + plantuml.js into the build
                                plus one bundle per standard library namespace
                                                              ┃  Node / SSR boundary
──────────────────────────────────────────────────────────────╂──────────────────────────
                                                              ┃  Browser
theme/MDXComponents/Code  ── which engine claims this fence's language?
        │  neither ────────▶ @theme-init/MDXComponents/Code (untouched)
        │  one of them
        ▼
theme/PlantUmlDiagram  ── usePlantUmlConfig() ── useColorMode() ── IntersectionObserver
        │
        ├── engine === 'plantuml'
        │       ▼
        │   runtime/renderer  ── cache lookup ─────────────────▶ hit: return SVG
        │       ├── assetLoader.loadPlantUmlRuntime()  (viz-global.js, then plantuml.js)
        │       └── runtime/queue    (one render at a time — the engine demands it)
        │               └── engine.renderToString(lines, ok, err, {dark})
        │                       └── runtime/errors.detectDiagramError()
        │                       └── runtime/sanitize.sanitizeSvgMarkup()
        │
        └── engine === 'graphviz'
                ▼
            runtime/graphvizRenderer ── cache lookup ──────────▶ hit: return SVG
                ├── source-size guard  (before loading anything)
                ├── assetLoader.loadVizRuntime()  (viz-global.js only)
                └── viz.render(source, {format, engine, bgcolor})   — no queue, synchronous
                        └── runtime/errors.formatGraphvizErrors()
                        └── runtime/sanitize.sanitizeSvgMarkup()
```

## The SSR boundary

Docusaurus builds the site in Node and hydrates it in the browser, so the plugin has two
disjoint halves and the boundary is enforced structurally.

**The Node side** is `src/index.ts`, `src/options.ts`, `src/assets.ts` and `src/constants.ts`.
None of them imports anything from `src/runtime/` or `src/theme/`. They do exactly three
things: validate options, locate `@plantuml/core` on disk, and publish a small JSON payload
(`{options, assetsDir, coreVersion}`) into Docusaurus global data. The 8 MB engine is never
imported into the Node process — only its path is resolved, and only so the copy plugin knows
what to emit.

`src/constants.ts` is deliberately dependency-free and shared by both halves. It holds the
plugin name, the assets directory convention and the `data-*` attribute names, so the two
sides cannot drift apart.

**The browser side** is `src/theme/` and `src/runtime/`. It reads the payload back through
`useAllPluginInstancesData(PLUGIN_NAME, {failfast: false})` in `usePlantUmlConfig()`.

Three properties keep server and client in agreement:

- `configureWebpack` returns `{}` when `isServer` is true. The runtime assets are browser-only,
  and emitting them from the server compilation would duplicate ~8 MB into the SSR output for
  no benefit.
- `PlantUmlDiagram` renders **the same deferred placeholder on the server that it renders as
  its first client state**. Its render effect runs only in the browser, so there is nothing
  for hydration to mismatch on. Diagrams are never rendered during static-site generation.
- `loadPlantUmlRuntime()` rejects outright, with a `load` error, if `window` or `document` is
  missing. Even a future refactor that accidentally calls it during SSG fails loudly instead
  of producing subtly different HTML.

`usePlantUmlConfig()` returns `null` rather than throwing when the global data is absent, so a
site that forgot to register the plugin shows a contained error panel on the affected diagrams
instead of failing to render the page. The value is memoized: consumers use it as an effect
dependency, and a fresh object each render would restart the render effect on every state
update — an infinite render loop.

## Asset emission and loading

### Emission (Node)

`locatePlantUmlCore()` resolves `@plantuml/core/package.json` — not the bare specifier, which
would give the ES module entry — reads the version, and returns the absolute paths of
`viz-global.js` and `plantuml.js`.

It also **asserts both files exist**, and fails the build naming the missing file and the
installed `@plantuml/core` version if either does not. `viz-global.js` matters twice over: it
is PlantUML's layout engine _and_ the Graphviz this plugin renders DOT fences with, but it is
shipped at PlantUML's discretion. Checking here turns a dependency bump that dropped it into a
failed CI run rather than a runtime load failure in a reader's browser. See
[ADR 0004](adr/0004-graphviz-engine-reuse.md).

`configureWebpack` then registers a copy plugin that emits both into

```text
<baseUrl>assets/plantuml-client-<coreVersion>/
```

The engine version is in the directory name, so upgrading `@plantuml/core` changes every asset
URL and no stale cache entry can survive. Both files are marked `info: {minimized: true}`:
they are already minified upstream, and re-processing 8 MB is wasted build time.

Both bundlers are supported. Rspack (`future.v4`, `@docusaurus/faster`) does not accept
`copy-webpack-plugin` and ships `CopyRspackPlugin` instead, so `createCopyPlugin()` branches
on `currentBundler.name`. Docusaurus types `currentBundler.instance` as `typeof webpack` for
both bundlers, so the Rspack-only export is reached through a narrow structural type rather
than a cast to `any`. If Rspack is active but `CopyRspackPlugin` is missing, the build fails
with an actionable message rather than silently emitting nothing. The end-to-end suite
exercises the webpack path.

### The standard library

`src/stdlib.ts` runs alongside `locatePlantUmlCore()` and decides which standard library
namespaces this site emits: the vendored bundles in `assets/stdlib`, narrowed by
`stdlib.namespaces` if set, plus anything `stdlib.include` names, generated on demand from a
`plantuml-stdlib` checkout the site points at and cached under `.docusaurus`. They are emitted
into

```text
<baseUrl>assets/plantuml-client-<coreVersion>/stdlib-<revision>/
```

The extra `stdlib-<revision>` segment exists because the standard library changes on its own
schedule, independent of the engine version above it. The same revision is folded into the
render cache key.

A small index — namespace to its dependencies — is published through global data. It has to
come from the build: `k8s/Common.puml` includes `<c4/…>`, which the engine would only discover
mid-render, synchronously, far too late to fetch anything. Dependencies reachable only through
a namespace's `_examples_/` files are recorded separately and loaded only when a diagram
includes an example, so a C4 diagram does not drag in the 160 KB of `office` that C4's examples
use.

See [ADR 0005](adr/0005-stdlib-bundles.md) for why the bundles are shaped this way and why the
vendored set is nine namespaces rather than all thirty-four.

### Loading (browser)

`runtime/assetLoader.ts` holds **two independent singletons**, because the two engines have
very different sizes and a page that uses only one must not pay for the other:

| Runtime         | Size    | Loaded by               | Used for                              |
| --------------- | ------- | ----------------------- | ------------------------------------- |
| `viz-global.js` | ~1.4 MB | `loadVizRuntime()`      | DOT fences, and PlantUML's own layout |
| `plantuml.js`   | ~6.8 MB | `loadPlantUmlRuntime()` | PlantUML fences only                  |

`loadVizRuntime()`:

1. Injects `viz-global.js` as a classic `<script>` (`async = false`). It installs the Graphviz
   layout engine on `window.Viz`.
2. Asserts that `window.Viz` really carries `instance`, `engines` and `graphvizVersion`, and
   reports a `load` error naming the likely cause if not — a proxy returning the wrong file, or
   an upstream `@plantuml/core` that no longer bundles Viz.js.
3. Calls `Viz.instance()` once. One instance serves every DOT diagram on the page: Viz.js
   documents that an instance renders multiple graphs, and a 200-render soak with syntax errors
   interleaved left it fully healthy.

`loadPlantUmlRuntime()` builds on step 1 — PlantUML needs `window.Viz` to exist — and then:

4. Loads `plantuml.js` with `import(/* webpackIgnore: true */ url)`. The `webpackIgnore` comment
   is what keeps webpack from trying to bundle the 6.8 MB engine into the site's JavaScript, and
   it is also why the plugin needs no `unsafe-eval`: the dynamic import is a real runtime import
   of a copied asset, not a `new Function` trampoline.
5. Checks the resolved module for the `render` and `renderToString` exports, reporting a load
   error naming the likely cause rather than failing later with a confusing `TypeError`.

A DOT-only page therefore requests `viz-global.js` once and `plantuml.js` never, which the
end-to-end suite asserts directly.

`runtime/stdlibLoader.ts` is the third loader, and the odd one out. `@plantuml/core` resolves
`!include <c4/…>` against `window.PLANTUML_STDLIB`, and when a namespace is missing it appends
a `<script src="c4.min.js">` of its own — a **relative** URL, which on a docs site resolves to
`/docs/architecture/c4.min.js` and 404s. Populating the global first does not prevent it: the
engine checks its own `window.__pl_script_state` bookkeeping before it reads the global. So the
loader scans the source for `<namespace/…>`, expands the closure from the manifest, loads each
bundle from the assets directory where the URL is right, and then writes
`window.__pl_script_state['c4.min.js'] = {state: 'loaded', ok: [], err: []}` so the engine finds
the work already done. This runs concurrently with `loadPlantUmlRuntime()`, since both are
shared, idempotent downloads. See [ADR 0005](adr/0005-stdlib-bundles.md).

Concurrency and lifecycle:

- One module-level promise per runtime is shared by all callers, so N diagrams mounting at once
  produce one download. Both runtimes share the single injected `<script>` tag.
- The injected `<script>` carries a `data-plantuml-runtime` marker attribute with a
  `loading`/`loaded`/`error` state. Client-side navigation re-mounts diagram components
  without reloading the document, and the marker is what guarantees a second tag is never
  appended.
- A failed load **clears** the cached promise, so a later diagram can retry instead of
  inheriting a permanent failure.
- Loading is subject to `renderTimeoutMs`.

## The serialized render queue (PlantUML only)

The PlantUML engine keeps its in-flight render state in module-level globals. A browser spike
established the consequence precisely: **three concurrent `renderToString` calls produced
exactly one callback and two permanent hangs.** Overlapping renders do not merely interleave
badly; they are lost.

**Graphviz does not go through this queue.** Viz.js has no such defect: `viz.render()` is
synchronous and has returned before anything else can observe the engine, so serializing DOT
renders would add latency and buy nothing.

`runtime/queue.ts` is therefore a module-level FIFO that runs exactly one task at a time. Its
governing property is that it **always advances** — after success, after rejection, after
timeout. One malformed diagram can never wedge the rest of the page.

Details worth knowing:

- The slot is released through an idempotent `advance()`, so a timeout followed by a late
  settle cannot release it twice.
- `advance()` schedules the next task with `queueMicrotask`, so a chain of
  synchronously-resolving tasks cannot grow the stack without bound.
- A task whose signal is already aborted when it is enqueued rejects immediately and never
  occupies a slot.
- An abort **while a task is already running deliberately does not advance the queue.** The
  engine may still be mid-render, and starting the next diagram now would reintroduce exactly
  the concurrency corruption the queue exists to prevent. The running task's own settle (or
  its timeout) is what releases the slot.

**Runtime loading happens outside the queue.** It is shared, idempotent work, and holding the
single render slot for an 8 MB download would stall every other diagram on the page.

## Rendering one PlantUML diagram

`runtime/renderer.ts` is the whole render pipeline:

1. Compute the cache key and return a hit immediately — cache hits skip the queue entirely.
2. Report the `loading` phase and await the shared runtime load.
3. Report the `rendering` phase and enqueue the actual render.
4. Inside the queue: split the source into lines, call
   `renderToString(lines, onSuccess, onError, {dark})`, and wrap the callbacks in a promise
   with a `settled` guard so a double callback cannot resolve and reject the same promise.
5. Inspect the resulting SVG for PlantUML's "error picture" markers (see
   [ADR 0002](adr/0002-render-to-string.md)) and throw a `diagram` error if found.
6. Sanitize, unless `sanitizeSvg: false`.
7. Store in the cache and return.

Errors are classified as `load`, `engine`, `diagram`, `syntax`, `timeout`, `config`, `aborted`
or `too-large` by `PlantUmlError`, which is what lets the UI say something specific about what
broke.

## Rendering one Graphviz diagram

`runtime/graphvizRenderer.ts`. Shorter than the PlantUML pipeline, for reasons that are all
properties of the engine rather than choices:

1. Reject immediately if the signal is already aborted.
2. Compute the cache key and return a hit — **before** loading anything, so a page of repeated
   diagrams never downloads 1.4 MB it does not need.
3. Check the source against `graphviz.maxSourceBytes` (UTF-8 bytes, not code units). Also
   before loading: refusing a 5 MB graph should not first cost a 1.4 MB download.
4. Report the `loading` phase and await `loadVizRuntime()`.
5. Re-check the signal. Loading is shared work that a caller-side abort cannot cancel, so an
   unmounted diagram must not go on to lay out a graph nobody will see.
6. Report the `rendering` phase and call `viz.render(source, {format: 'svg', engine, …})`
   directly — no queue.
7. Sanitize, unless `sanitizeSvg: false`; store in the cache and return.

Three differences from the PlantUML path are worth naming:

- **The layout engine is validated against the live `viz.engines` list**, not only against the
  compile-time `GRAPHVIZ_ENGINES` array, so a fence naming an engine this build lacks fails with
  the available set spelled out.
- **Invalid DOT is a `syntax` error carrying Graphviz's own diagnostic**, including the line
  number: `syntax error in line 3 near '}'`. There is no error-picture sniffing to do — compare
  [ADR 0002](adr/0002-render-to-string.md). A `render` call that _throws_ means the engine
  itself broke, which is reported as an `engine` error with different wording.
- **`graphAttributes: {bgcolor: 'transparent'}`** is injected unless `transparentBackground` is
  off. Graphviz otherwise paints an opaque white rectangle over the whole canvas, which would
  show as a white slab on a dark page.

## Abort and unmount

Each render effect in `PlantUmlDiagram` owns an `AbortController`. The cleanup aborts it, and
**every state write checks `signal.aborted` first**. That single mechanism prevents both
classes of bug at once:

- a stale result from a superseded render (colour-mode toggle, changed source) overwriting a
  newer one, and
- a state update after the component has unmounted.

The renderer forwards the signal into the queue, so an aborted task that has not yet started
is dropped before it takes a slot. A `PlantUmlError` of kind `aborted` is swallowed by the
component rather than shown — an abort is a normal lifecycle event, not a failure.

Identical successive states are also dropped (`previous === next` short-circuit), so a
repeated phase report cannot cause a pointless re-render.

## Caching

`runtime/cache.ts`. The key folds in everything that can change the output:

```text
<coreVersion>|<light|dark>|<san|raw>|<sourceLength>|<FNV-1a hash of source>
```

- **`coreVersion`** — an engine upgrade invalidates every stored entry.
- **colour mode** — toggling dark mode can never serve the other mode's picture.
- **sanitized flag** — flipping `sanitizeSvg` cannot serve output produced under the other
  policy.
- **source length alongside the hash** — FNV-1a is a fast, stable, non-cryptographic 32-bit
  hash; including the length means a collision alone cannot serve the wrong diagram.

Graphviz entries use a separate namespace and a different set of components:

```text
graphviz|<coreVersion>|<layout>|<bg-none|bg-default>|<san|raw>|<sourceLength>|<FNV-1a hash>
```

- **the `graphviz|` prefix** — the two engines can never collide on the same source.
- **`layout`** — `dot` and `neato` draw different pictures from identical source.
- **background flag** — `transparentBackground` changes the emitted SVG, so flipping it cannot
  serve output produced under the other setting.
- **no colour mode.** Graphviz output is colour-mode independent; the stylesheet adapts it. One
  entry serves both modes, and toggling the theme triggers no re-render at all.
- **`coreVersion`, not `Viz.graphvizVersion`** — the Graphviz build lives inside
  `@plantuml/core`, so that package's version is what changes when the engine changes, and
  unlike the runtime value it is known _before_ the engine has loaded, which is what lets a
  cache hit skip loading entirely.

Three backing stores:

- `NoopCache` (`'none'`) — stores nothing.
- `MemoryCache` (`'memory'`, default) — a `Map` whose insertion order doubles as LRU recency
  (a `get` re-inserts), trimmed to `cacheMaxEntries`.
- `SessionCache` (`'session'`) — JSON entries under `plantuml-client:` keys in
  `sessionStorage`, carrying an entry-version field. Every access is wrapped: entries that
  fail to parse or carry the wrong version are dropped and re-rendered, and if `sessionStorage`
  is unavailable or throws (private modes, quota, embedded browsers) it silently degrades to an
  internal `MemoryCache` for the rest of the session. `sessionStorage` exposes no recency
  information, so eviction is a plain FIFO trim of the plugin's own key namespace — the
  documented bound is what matters, not the exact eviction order.

Caches are shared per `(mode, maxEntries)` pair across the whole page, so the same source
rendered in two places is rendered once.

## Dark mode, handled differently by each engine

`useColorMode()` from `@docusaurus/theme-common` yields a `dark` boolean (`theme: 'auto'`
follows it; `'light'`/`'dark'` pin it). What happens next depends on the engine, because the
two engines differ in a way that matters: **PlantUML has a real dark theme and Graphviz does
not.**

### PlantUML — re-render

The boolean is both:

- an effect dependency, so a colour-mode toggle re-runs the render effect, and
- part of the cache key, so the second toggle back is a cache hit rather than a re-render.

The previous render's controller is aborted by the effect cleanup, so a slow render for the
old mode cannot land after the new one. The engine itself is not reloaded — only the render is
repeated.

### Graphviz — restyle, never re-render

Graphviz draws black on white regardless of the page, and has no dark theme to ask for. Faking
one by injecting colour attributes would fight authors who set their own colours and would
double the cache, so the _defaults_ are retargeted in CSS instead:

```css
[data-diagram-engine='graphviz'] .canvas svg text:not([fill]) {
  fill: currentColor;
}
[data-diagram-engine='graphviz'] .canvas svg [stroke='black'] {
  stroke: currentColor;
}
[data-diagram-engine='graphviz'] .canvas svg [fill='black'] {
  fill: currentColor;
}
```

The selectors are deliberately narrow. Graphviz emits `stroke="black"` / `fill="black"` for
everything it colours by default and leaves `<text>` with no `fill` at all, while anything the
DOT source colours explicitly comes out as that colour (`stroke="red"`, `fill="lightblue"`) and
is therefore never matched. **Colours set in the diagram source always win.** `fill="none"` is
likewise untouched, which keeps unfilled node shapes unfilled.

Consequences, all of them improvements over the re-render approach:

- The component computes `renderDark`, which is always `false` for Graphviz, and uses _that_ as
  the effect dependency. A colour-mode toggle does not re-run the render effect for a DOT
  diagram at all.
- The colour mode is absent from the Graphviz cache key.
- The reader's zoom is not reset by a theme toggle, because the zoom reset key is derived from
  `renderDark` rather than `dark`.
- `data-plantuml-theme` still reports the _page's_ colour mode on every figure, because that is
  what author CSS keys off.

Sanitization is what makes this safe to rely on: `tests/unit/sanitize.test.ts` pins that
DOMPurify preserves the `stroke="black"` / `fill="black"` attributes these rules select on, so
the adaptation cannot silently stop working.

## Sanitization

`runtime/sanitize.ts` builds one DOMPurify instance lazily against `window` (and throws a
`config` error if there is no `window`, which would mean it was reached during SSR). Rendered
SVG runs through the `svg` + `svgFilters` profiles with `foreignObject`, `script`, `iframe`,
`object`, `embed`, `audio` and `video` additionally forbidden. `foreignObject` is the
important one: it is the single SVG element that can host arbitrary HTML, which would
reintroduce exactly the injection surface the SVG profile removes, and neither engine needs it.

The same profile is correct for Graphviz output without modification, which was verified rather
than assumed: Graphviz renders HTML-like labels (`label=<<table>…>`) to native SVG `<text>`
elements, **not** to `<foreignObject>`.

One Graphviz-specific surface does exist. DOT's `URL` and `href` node and edge attributes emit
real `<a xlink:href>` links into the SVG, and diagram source is untrusted under this plugin's
threat model. `tests/unit/sanitize.test.ts` pins both halves of the guarantee: an ordinary or
relative link survives, while `javascript:` — plain, entity-encoded, or whitespace-padded, in
either `href` or `xlink:href` — does not.

If the result contains no `<svg>` root at all, an `engine` error is raised rather than
inserting empty markup — a blank figure with no explanation is the worst possible outcome.

The trust argument is spelled out in the README: engine output is generated from
author-controlled source, so it is untrusted markup by default, and `sanitizeSvg: false` means
whatever a diagram author can express is injected verbatim.

## Component states and markup

`PlantUmlDiagram` has five states, surfaced as `data-plantuml-status`: `idle`, `loading`,
`rendering`, `ready`, `error`.

The wrapper is always a `<figure>` carrying the `data-*` attributes and `aria-busy` while work
is in progress. On success the SVG goes into an inner `<div role="img" aria-label="…">`. A
fence `title="…"` supplies both the label and a `<figcaption>`; without one the label defaults
to `PlantUML diagram` or `Graphviz diagram` according to the engine, which also names the
engine in the progress text and the error heading.

The attribute set is:

| Attribute                   | Value                                              |
| --------------------------- | -------------------------------------------------- |
| `data-plantuml-diagram`     | the fence language (`plantuml`, `puml`, `dot`, …)  |
| `data-diagram-engine`       | `plantuml` or `graphviz`                           |
| `data-diagram-layout`       | Graphviz layout engine; absent on PlantUML figures |
| `data-plantuml-status`      | `idle`, `loading`, `rendering`, `ready`, `error`   |
| `data-plantuml-theme`       | the page's colour mode                             |
| `data-plantuml-interactive` | `"true"` when zoomable                             |
| `data-plantuml-maximized`   | `"true"` while filling the viewport                |

The `data-plantuml-*` prefix is historical — it predates Graphviz support and is applied to
every diagram whatever the engine. Renaming it would break author CSS for no functional gain,
so `data-diagram-engine` was added alongside it instead; that is the attribute to select on
when the two engines need different styling, and it is what the Graphviz colour rules use.

Progress is `aria-busy`, deliberately **not** an `aria-live` region — a page of diagrams would
otherwise flood a screen reader with phase changes. Errors use `role="alert"`, and failure is
signalled by the literal `Error:` text and a ⚠ glyph as well as by colour, so it survives
colour-blindness and forced-colours mode.

A `<noscript>` block carries the escaped source for readers without JavaScript. It is written
with `dangerouslySetInnerHTML` because browsers expose a `<noscript>` body as inert text
rather than as elements, which React cannot hydrate.

There are two ready-state shapes. With `zoom: false` the `role="img"` container is a direct
child of the `<figure>` — byte-identical to what `0.1.0` produced. With zoom enabled it is
wrapped by a viewport and a transform layer, with the control group as a sibling. In both
shapes `div[role="img"] > svg` holds, which is what keeps the selector stable for tests and for
author CSS.

## Source view

The `</>` toolbar control **flips the frame**: the source takes the diagram's place in the same
box, with a copy button. Three structural decisions carry the weight:

- **The source and the viewport share one CSS grid cell** (`.stageBody > * {grid-area: 1/1}`),
  so the source lands exactly where the picture was, at exactly its size. It was first rendered
  _below_ the diagram, which had two failure modes found in review: a diagram taller than the
  window pushed it off-screen, and while maximized it was painted behind the `position: fixed`
  overlay — present, in the viewport, and invisible. Sharing the frame removes both by
  construction rather than by patching each case.
- **The viewport is hidden with `visibility`, not `display`.** It keeps contributing its height,
  so the frame does not resize when flipping, and the zoom hook's `clientWidth`/`clientHeight`
  measurements stay valid for the flip back. A `visibility: hidden` subtree is also unfocusable
  and takes no pointer events, so the invisible diagram cannot be tabbed into or dragged; its
  `tabIndex` is set to `-1` as well, belt and braces.
- **It sits outside the `role="img"` container**, for the same reason the zoom controls do:
  `role="img"` makes its whole subtree opaque to assistive technology.

The zoom controls are hidden while the source is shown — they would act on a picture nobody can
see — but **maximize stays**, because it sizes the frame the source is read in and removing it
while maximized would leave Escape as the only way back. The **copy control joins the same
toolbar** while the source is on screen, rather than sitting in a header bar of its own: the
diagram view has no header chrome, so giving the source view some made the two read as different
kinds of thing rather than two views of one.

Where there is no zoom frame (`zoom: false`) the canvas collapses with `display: none` instead:
there is no box height worth preserving, and collapsing lets the source take the diagram's place
rather than appear below it. The canvas stays mounted, so `figure > div[role="img"]` remains the
figure's first child — the pre-zoom shape both suites pin.

- **The copy outcome goes to a `role="status"` region, not the button's label.** Renaming a
  control changes its accessible name, and a screen reader announces that as a new control
  appearing rather than as the result of the action just taken.

Copying uses `navigator.clipboard.writeText`, which is **undefined outside a secure context** —
a docs site served over plain HTTP. That case is reported rather than swallowed; the panel is
open regardless, so the reader can select the text by hand. The feedback timer is cleared on
unmount, and the copy state resets when the diagram source changes so a stale "Copied" can never
describe text that is no longer on screen.

With `zoom: false` there is no toolbar to join, so the control gets its own row rendered _after_
the canvas. That ordering is what keeps `figure > div[role="img"]` as the first child — the
shape the pre-zoom markup has always had, which both the unit and end-to-end suites pin.

## Zoom and pan

`runtime/` owns rendering; zooming lives entirely in the theme layer, split into
`PlantUmlDiagram/zoomMath.ts` (pure geometry) and `PlantUmlDiagram/useZoomPan.ts` (all DOM
interaction). See [ADR 0003](adr/0003-zoom-container-transform.md) for the reasoning; what
follows is how it behaves.

**The frame is two rows in flow, not a picture with chrome floating over it.** `.stage` is a
flex column: one control row, then the diagram. Both control groups used to be
`position: absolute` in the frame's corners, which meant that at 100% — the view every reader
arrives at — they covered a sequence diagram's first participant and a graph's leftmost node.
That is not a nudging problem: the picture is whatever shape its author drew, so any floating
control lands on some diagram's content. A row costs the height of one button bar per figure
and removes the class of defect entirely. Zooming may still slide content under the row's edge,
which is fine — the viewport clips it, and the frame keeps the height it had at 100%, so the
page never reflows.

The **minimap toggle lives in the toolbar** rather than in a row of its own: a row carrying one
button read as a stray control, a diagonal away from everything else. The toolbar therefore
wraps (`flex-wrap: wrap`, on the row and on the bar) so a seventh button cannot overflow a
narrow column. The minimap _panel_ is the one thing still positioned over the picture, inside
the diagram row and in the corner opposite the toolbar — the reader opened it deliberately, and
a map painted under its own control would be half hidden by it. Maximized uses the same two
rows, with the diagram row taking whatever the control row leaves (`flex: 1; min-height: 0` and
a `minmax(0, 1fr)` track — an `auto` track floors at max-content, which let a tall diagram size
the row past the screen and fooled `fitScale` into measuring an overflowing viewport).

**The transform goes on a wrapper, never on the SVG.** `.canvas svg {max-width: 100%; height:
auto}` derives the SVG's laid-out height from its `viewBox` ratio, so mutating `viewBox` would
reflow the document on every wheel tick. CSS transforms do not participate in layout, so the
figure's height is identical at 800% and at 100%. An end-to-end test asserts exactly that.

**No React state.** The transform lives in a ref and is written straight to
`layer.style.transform`, `viewport.dataset.plantumlZoom` and the readout's `textContent`. The
hook calls `setState` zero times, so panning never re-renders — and "no state update after
unmount" holds structurally rather than by guard. Only `pointermove` is rAF-coalesced; wheel,
buttons, keys and resize write synchronously.

**Measurement uses layout boxes.** `layer.offsetWidth`/`offsetHeight` and
`viewport.clientWidth`/`clientHeight`, never `getBoundingClientRect()` — the layer's rect
_includes_ the transform about to be changed, which would feed back into the next measurement.
(The same trap catches tests: Playwright's `locator.boundingBox()` is clipped by the
`overflow: clip` viewport, so the e2e suite measures with in-page `getBoundingClientRect()`.)

**One effect owns every listener**, and its cleanup removes all of them:

| Registered on the viewport                                                       | Removed by              |
| -------------------------------------------------------------------------------- | ----------------------- |
| `wheel` (`{passive: false}`)                                                     | `removeEventListener`   |
| `pointerdown`, `pointermove`, `pointerup`, `pointercancel`, `lostpointercapture` | `removeEventListener`   |
| `click` (capture phase, to swallow the click that ends a drag)                   | `removeEventListener`   |
| `fullscreenchange` on `document`                                                 | `removeEventListener`   |
| `ResizeObserver` on the viewport                                                 | `disconnect()`          |
| pending `requestAnimationFrame`                                                  | `cancelAnimationFrame`  |
| active pointer capture                                                           | `releasePointerCapture` |

The `wheel` listener has to be registered imperatively with `{passive: false}`: React attaches
its JSX `onWheel` prop passively at the root, so `preventDefault()` from there is a silent
no-op. Key handlers do use the JSX prop, because React key events are not passive.

**Buttons and keys anchor zoom at the viewport's top-left; the wheel anchors at the pointer.**
A diagram smaller than its viewport opens at the origin, with empty space to its right and
below. Centre-anchored zoom scales that empty space and walks the diagram off the top and left
edges. Anchoring at `(0, 0)` makes the translation `t' = t · ratio`, which leaves a diagram
sitting at the origin exactly where it is.

**The clamp's two ends answer different questions.** `clampTransform` bounds each axis
independently, and the two limits are deliberately measured against different things.

_Forwards_ the limit is the empty space beside the picture, `viewport - content · k`: a diagram
that fits can be moved through that space and no further, so it never leaves the viewport. This
end used to be pinned at `0`, which is why a fitted diagram — most visibly a maximized one,
sitting in the corner of a large screen — had a grab cursor that moved nothing.

_Backwards_ the content size is floored at the viewport's before scaling. That looks arbitrary
until you zoom: focal zoom has to hold the point under the pointer, and a picture narrower than
its frame reaches a scale where it overflows while the pointer is still asking it to travel
further left than a flush right edge would allow. Clamping to the picture there yanks it
sideways mid-gesture — an end-to-end test measures exactly that drift. The floor buys the
fidelity for the price of some empty space at the right while zoomed, which is the trade this
component has always made. Removing it wholesale while adding the forward limit reintroduced a
134px drift in that test; the fix was to keep it on the backward end alone.

**Maximizing is an in-page overlay, not the Fullscreen API.** `requestFullscreen()` fullscreens
the whole browser window in Firefox rather than presenting the element, and its `::backdrop` is
outside the element, so the page showed through behind the diagram. A `position: fixed` overlay
with an opaque background fixes both, is identical across browsers, and needs no capability
detection — which also restores the control on iOS Safari. It is the one piece of zoom state
held in React, because it drives markup and changes only on an explicit user action. Entering
locks body scrolling and fits the diagram to the viewport; leaving restores the previous
transform and the previous overflow.

**Both reset triggers are necessary.** The view resets when the diagram source or the colour
mode changes. One reset runs when the listener effect re-arms (the layer node was replaced),
and a second runs directly off the reset key — because a cache hit resolves _before_ any phase
is reported, so toggling light → dark → light takes the component `ready → ready` in a
microtask without ever unmounting the layer. A reset keyed only on node identity would miss it.

## Known limitations

### The `file:` link duplicate-React trap

Consuming the plugin through a local `file:` link (as the example site does) makes webpack
resolve `@docusaurus/theme-common` and `react` from the **linked package's real path** rather
than from the site, because webpack resolves symlinks to their real path by default. The
result is two module instances, two React contexts, and a runtime error stating that
`useColorMode` was called outside the `ColorModeProvider`.

The example site sets `resolve: {symlinks: false}` through a tiny inline plugin purely for
this reason. A normal npm install has no symlink and needs none of it — and the packed-tarball
integration test, which installs the real `.tgz` into a clean fixture, is what proves that the
workaround is an artefact of local development and not part of the product.

### No swizzle support

`getTypeScriptThemePath` is intentionally not implemented, so `docusaurus swizzle` does not
offer this plugin's components. Supporting it would mean shipping the TypeScript sources of
the theme in the published package; keeping the package lean was judged more valuable than
supporting a swizzle of a component whose entire job is to delegate.

### Wrapping is not composable

Only one plugin can usefully wrap `MDXComponents/Code`, and a site-level swizzle of that
component bypasses this plugin entirely. See [ADR 0001](adr/0001-theme-init-alias.md).
