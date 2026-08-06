# Architecture

How `@matfsw/docusaurus-plantuml-plugin` turns a fenced code block into an SVG, and why the
pieces are shaped the way they are.

Two decisions large enough to deserve their own record live in `docs/adr/`:

- [ADR 0001 — Wrap `@theme-init/`, not `@theme-original/`](adr/0001-theme-init-alias.md)
- [ADR 0002 — Use `renderToString`, not the DOM `render()` API](adr/0002-render-to-string.md)
- [ADR 0003 — Zoom by transforming a wrapper, not the SVG](adr/0003-zoom-container-transform.md)

## Overview

```text
docusaurus.config.ts
        │
        ▼
  src/index.ts ─────────────── validateOptions()  ── src/options.ts
        │                       (build fails early on bad config)
        ├── getThemePath()   ── registers dist/theme as a plugin theme
        ├── contentLoaded()  ── setGlobalData({options, assetsDir, coreVersion})
        └── configureWebpack ── copies viz-global.js + plantuml.js into the build
                                                              ┃  Node / SSR boundary
──────────────────────────────────────────────────────────────╂──────────────────────────
                                                              ┃  Browser
theme/MDXComponents/Code  ── is this fence a PlantUML fence?
        │  no  ────────────▶ @theme-init/MDXComponents/Code (untouched)
        │  yes
        ▼
theme/PlantUmlDiagram  ── usePlantUmlConfig() ── useColorMode() ── IntersectionObserver
        │
        ▼
runtime/renderer  ── cache lookup ─────────────────────────────▶ hit: return SVG
        ├── runtime/assetLoader   (outside the queue, shared, idempotent)
        └── runtime/queue         (one render at a time)
                └── engine.renderToString(lines, ok, err, {dark})
                        └── runtime/errors.detectDiagramError()
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

### Loading (browser)

`runtime/assetLoader.ts` is a singleton loader:

1. `viz-global.js` is injected as a classic `<script>` (`async = false`) and must finish
   executing before anything else — it installs the Graphviz layout engine on `window`.
2. `plantuml.js` is then loaded with `import(/* webpackIgnore: true */ url)`. The
   `webpackIgnore` comment is what keeps webpack from trying to bundle the 6.8 MB engine into
   the site's JavaScript, and it is also why the plugin needs no `unsafe-eval`: the dynamic
   import is a real runtime import of a copied asset, not a `new Function` trampoline.
3. The resolved module is checked for the `render` and `renderToString` exports. A module
   without them is reported as a load error naming the likely cause — a proxy or service
   worker returning the wrong file — rather than failing later with a confusing `TypeError`.

Concurrency and lifecycle:

- One module-level promise is shared by all callers, so N diagrams mounting at once produce
  one download.
- The injected `<script>` carries a `data-plantuml-runtime` marker attribute with a
  `loading`/`loaded`/`error` state. Client-side navigation re-mounts diagram components
  without reloading the document, and the marker is what guarantees a second tag is never
  appended.
- A failed load **clears** the cached promise, so a later diagram can retry instead of
  inheriting a permanent failure.
- Loading is subject to `renderTimeoutMs`.

## The serialized render queue

The PlantUML engine keeps its in-flight render state in module-level globals. A browser spike
established the consequence precisely: **three concurrent `renderToString` calls produced
exactly one callback and two permanent hangs.** Overlapping renders do not merely interleave
badly; they are lost.

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

## Rendering one diagram

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

Errors are classified as `load`, `engine`, `diagram`, `timeout`, `config` or `aborted` by
`PlantUmlError`, which is what lets the UI say something specific about what broke.

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

## Dark-mode re-rendering

`useColorMode()` from `@docusaurus/theme-common` yields a `dark` boolean (`theme: 'auto'`
follows it; `'light'`/`'dark'` pin it). That boolean is both:

- an effect dependency, so a colour-mode toggle re-runs the render effect, and
- part of the cache key, so the second toggle back is a cache hit rather than a re-render.

The previous render's controller is aborted by the effect cleanup, so a slow render for the
old mode cannot land after the new one. The engine itself is not reloaded — only the render is
repeated.

## Sanitization

`runtime/sanitize.ts` builds one DOMPurify instance lazily against `window` (and throws a
`config` error if there is no `window`, which would mean it was reached during SSR). Rendered
SVG runs through the `svg` + `svgFilters` profiles with `foreignObject`, `script`, `iframe`,
`object`, `embed`, `audio` and `video` additionally forbidden. `foreignObject` is the
important one: it is the single SVG element that can host arbitrary HTML, which would
reintroduce exactly the injection surface the SVG profile removes, and PlantUML does not need
it.

If the result contains no `<svg>` root at all, an `engine` error is raised rather than
inserting empty markup — a blank figure with no explanation is the worst possible outcome.

The trust argument is spelled out in the README: PlantUML output is generated from
author-controlled source, so it is untrusted markup by default, and `sanitizeSvg: false` means
whatever a diagram author can express is injected verbatim.

## Component states and markup

`PlantUmlDiagram` has five states, surfaced as `data-plantuml-status`: `idle`, `loading`,
`rendering`, `ready`, `error`.

The wrapper is always a `<figure>` carrying the three `data-*` attributes and `aria-busy`
while work is in progress. On success the SVG goes into an inner `<div role="img"
aria-label="…">`. A fence `title="…"` supplies both the label and a `<figcaption>`; without one
the label defaults to `PlantUML diagram`.

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

## Zoom and pan

`runtime/` owns rendering; zooming lives entirely in the theme layer, split into
`PlantUmlDiagram/zoomMath.ts` (pure geometry) and `PlantUmlDiagram/useZoomPan.ts` (all DOM
interaction). See [ADR 0003](adr/0003-zoom-container-transform.md) for the reasoning; what
follows is how it behaves.

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
`clampTransform` left-aligns content that fits, so a diagram smaller than its viewport sits at
the origin with empty space to its right and below. Centre-anchored zoom scales that empty
space and walks the diagram off the top and left edges. Anchoring at `(0, 0)` makes the
translation `t' = t · ratio`, which leaves a left-aligned diagram exactly where it is.

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
