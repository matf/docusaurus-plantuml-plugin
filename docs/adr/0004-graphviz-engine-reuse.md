# ADR 0004 — Render DOT with the Graphviz already inside `@plantuml/core`

- Status: accepted
- Date: 2026
- Affects: `src/assets.ts`, `src/runtime/assetLoader.ts`, `src/runtime/graphvizRenderer.ts`

## Context

Graphviz/DOT support was added to this plugin in 1.1.0. The engine question had four
candidates, and one of them was already installed.

`@plantuml/core` ships `viz-global.js` — **Viz.js 3.24.0 containing Graphviz 14.1.1** — because
PlantUML needs Graphviz for its own layout. The plugin has emitted that file into every site
build since 0.1.0, and `runtime/assetLoader.ts` has always injected it as a classic script that
installs `window.Viz` before `plantuml.js` is imported.

`window.Viz.instance()` is a complete Graphviz. Measured against the installed package:

|                                                 |                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| Layout engines                                  | `circo dot fdp neato nop nop1 nop2 osage patchwork sfdp twopi`           |
| Engine init                                     | ~15 ms                                                                   |
| Small graph → SVG                               | ~10 ms                                                                   |
| 300-edge graph → SVG                            | 26 ms                                                                    |
| 3 000-edge graph → SVG                          | 2 252 ms                                                                 |
| 200 renders on one instance, 20 of them invalid | 48 ms total, instance healthy afterwards                                 |
| Packaging                                       | single file, wasm embedded as a `data:` URI, no side-car `.wasm`, no CDN |

The alternatives were `@viz-js/viz` (~1.33 MB, MIT, the same engine family one minor newer),
`@hpcc-js/wasm-graphviz` (~0.82 MB, Apache-2.0, Graphviz 15.1.0, throws instead of returning
diagnostics) and `d3-graphviz` (adds D3 and an animation feature a docs page never needs, plus
its own zoom, which would collide with [ADR 0003](0003-zoom-container-transform.md)).

## Decision

Render DOT with the `viz-global.js` that `@plantuml/core` already ships.

The marginal cost is **zero bytes over the wire and zero new dependencies**. The file is
already downloaded, already cached, already served from the site origin under `baseUrl`, and
already covered by the plugin's "no Java, no server, no CDN" promise. Declaring `@viz-js/viz`
directly would have added ~1.3 MB to the published package and a second near-identical asset to
the build, to buy independence from a package this plugin depends on regardless.

Three properties fall out of the engine's design and are worth recording, because they are why
the Graphviz path looks so much simpler than the PlantUML one:

- **No render queue.** `runtime/queue.ts` exists because the PlantUML engine keeps in-flight
  state in module globals — three concurrent `renderToString` calls produced one callback and
  two permanent hangs. Viz.js has no such defect: `render` is synchronous and has returned
  before anything else can observe the engine. `renderGraphvizDiagram` therefore bypasses the
  queue entirely.
- **No error-picture sniffing.** [ADR 0002](0002-render-to-string.md) had to inspect rendered
  SVG for PlantUML's error markers. Graphviz returns `{status: 'failure', errors: [{level,
message}]}` with the offending line number, so the reader is shown `syntax error in line 3
near '}'` instead of a generic failure.
- **No colour-mode re-render.** Graphviz has no dark theme; it draws black on white regardless
  of the page. Rather than re-rendering per colour mode — which would double the cache and
  fight authors who set their own colours — the stylesheet retargets only Graphviz's _defaults_
  (`stroke="black"`, `fill="black"`, unstyled `<text>`) at `currentColor`. Anything the DOT
  source colours explicitly is emitted as that colour and is never matched. The colour mode is
  consequently **absent from the Graphviz cache key**.

## Consequences

### The engine is a transitive dependency

This is the real cost of the decision. `viz-global.js` is a declared `exports` entry of
`@plantuml/core`, not a private file, so it is supported — but it is shipped at PlantUML's
discretion. A future release that inlined it, renamed it, or swapped layout engines would break
DOT rendering on a routine dependency bump.

Three mitigations, all cheap, all implemented:

1. **Fail at build time.** `locatePlantUmlCore()` asserts both runtime files exist on disk and
   throws a message naming the missing file and the installed version. A dependency bump that
   dropped the asset fails CI instead of reaching a reader's browser.
2. **Assert the API in the loader.** `loadVizRuntime()` checks `window.Viz` for `instance`,
   `engines` and `graphvizVersion` before using it, and reports a `load` error naming the likely
   cause rather than failing later with a `TypeError` several frames away.
3. **Keep the escape hatch documented.** If `@plantuml/core` ever drops the file, switching to a
   direct `@viz-js/viz` dependency is a one-file change to `src/assets.ts` plus one copy
   pattern; nothing above the loader would need to change, because `runtime/types.ts` describes
   the Viz.js API rather than the package it came from.

`tests/unit/assets.test.ts` pins all three, including reading the shipped file to confirm it
really is a Viz.js build with its wasm embedded and no CDN URL in it.

### The two runtimes had to be split

`plantuml.js` is ~6.8 MB and `viz-global.js` is ~1.4 MB. Before this change one loader promise
fetched both, which would have made a page with a single DOT diagram pay for the PlantUML
engine. `assetLoader.ts` now exposes `loadVizRuntime()` and `loadPlantUmlRuntime()` as
independent, independently-cached singletons, with the PlantUML one building on the Viz script
because PlantUML needs `window.Viz` to exist. One `<script>` tag still serves both, guarded by
the same `data-plantuml-runtime` marker as before. An end-to-end test asserts that a DOT-only
page requests `viz-global.js` once and `plantuml.js` never.

This is a straight improvement for existing PlantUML-only users too: nothing about their load
path changed, and the split is what keeps the Graphviz feature honest about its cost.

### Rendering blocks the main thread

Viz.js lays out synchronously. 26 ms for a 300-edge graph is imperceptible; the measured 2.25 s
for 3 000 edges is not. `graphviz.maxSourceBytes` (default 100 000) refuses an oversized source
**before** the engine is even loaded, turning a frozen tab into an explanatory panel. Rendering
in a Web Worker would remove the ceiling entirely and remains available as a later enhancement;
it was not taken now because worker startup costs more than most renders save.

### Both engines share one code-block wrapper

Per [ADR 0001](0001-theme-init-alias.md), two plugins wrapping `MDXComponents/Code` do not
compose — the second silently disables the first. Shipping Graphviz as a separate package would
therefore have broken any site using both. One wrapper handling both languages is not a
convenience here; it is the only shape that works.

## Alternatives considered

**Declare `@viz-js/viz` directly.** Rejected for now: ~1.3 MB of duplication to avoid a
coupling that the three mitigations above already make loud and cheap to reverse. Recorded as
the documented escape hatch rather than discarded.

**`@hpcc-js/wasm-graphviz`.** Technically excellent — smallest bundle, newest Graphviz — but it
duplicates an engine already present, throws instead of returning structured diagnostics, and
mixes Apache-2.0 into an MIT project.

**Render at build time with a remark/rehype transform.** Genuinely the stronger option on the
merits for Graphviz alone: zero client JavaScript, works without JavaScript, best LCP. Rejected
because it would make the two diagram languages behave differently in the same plugin — no
zoom, no shared cache, no shared error presentation — and consistency was judged worth more
than the bytes. Not planned.

**Render server-side via Kroki or a custom endpoint.** Rejected outright. Local rendering costs
10 ms and the engine is already on the page; a network round-trip would be slower, would leak
diagram source off the machine, and would abandon the plugin's entire reason for existing.
