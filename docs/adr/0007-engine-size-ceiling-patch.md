# ADR 0007 — Patch `@plantuml/core`'s 4096-point diagram ceiling instead of living with it

- Status: accepted
- Date: 2026
- Affects: `src/enginePatch.ts`, `src/constants.ts`, `src/index.ts`,
  `tests/unit/enginePatch.test.ts`

## Context

`@plantuml/core` measures every diagram it lays out and refuses to serialize one wider or
taller than 4096 points, reporting through its error callback:

```text
Diagram too large for browser rendering: 78x12916 (max 4096)
```

In the minified bundle that is:

```js
p=o.bBY;if(!(p>4096.0)){q=o.bB0;if(!(q>4096.0)){ …serialize… }}
```

`renderToString` accepts only `{dark}`, so there is no engine option to raise or remove it,
and there is no way to reach it from a `docusaurus.config.ts`.

### It cannot be worked around from diagram source

Probed against the installed engine with a chain of `class` nodes:

| Source                    | Result                                 |
| ------------------------- | -------------------------------------- |
| 40 nodes, plain           | `71x4276` → refused                    |
| `scale 0.3`               | `71x4276` → **unchanged**              |
| `skinparam dpi 40`        | `71x4276` → **unchanged**              |
| `left to right direction` | `4483x64` → refused, merely transposed |
| `skinparam ranksep 5`     | `72x2248` → accepted                   |

`scale` does not help because the check reads the _pre-scale_ dimensions — the scale ratio is
computed from the same two numbers immediately after the guard. `dpi` does not help because it
affects raster output, not this layout measurement. Only genuinely shrinking the Graphviz
layout — fewer nodes, tighter `ranksep`/`nodesep`, smaller fonts — moves the numbers, and an
author with a large architecture diagram often cannot do that without destroying the diagram.

### The ceiling is arbitrary

4096 is not an SVG limit or a browser limit; it reads like a canvas-texture assumption
inherited from PlantUML's own web demo. Browsers render far larger SVG without complaint.
Patched to 65536, the same engine produced correct output at every size tried:

| Nodes | Result                       |
| ----- | ---------------------------- |
| 40    | `72x4276`, real SVG          |
| 120   | `79x12916`, real SVG         |
| 400   | `79x43157`, real SVG, 453 KB |

Patching the error message alongside the comparison was verified safe. TeaVM's string pool is
a plain list of JavaScript string literals, so a literal whose length changes does not disturb
its neighbours: with all three patched, a still-oversized diagram reported
`…: 78x75556 (max 65536)`, and unrelated pool entries — the version banner, sequence-diagram
labels — rendered intact.

## Decision

The plugin rewrites the engine it serves, raising the ceiling to **32768 points**, and emits
the rewritten file instead of the vendored one.

The rewrite is two literal replacements, both counted before either is applied:

| Literal       | Occurrences required | Becomes        |
| ------------- | -------------------- | -------------- |
| `>4096.0)`    | exactly 2            | `>32768.0)`    |
| ` (max 4096)` | exactly 1            | ` (max 32768)` |

Anchoring on `>4096.0)` rather than on the surrounding statement is deliberate: `p`, `q` and
`o` are TeaVM-mangled locals that are renamed by every `@plantuml/core` build, so a pattern
naming them would break on a release that changed nothing meaningful. `4096.0` occurs exactly
twice in the whole 7 MB bundle and both occurrences are this one guard, which is what makes
the count a sound safety property rather than a guess.

**Not configurable.** A per-site option would have to be folded into the asset URL and the
render cache key, would multiply the emitted engine per plugin instance, and would put the
patch's failure mode on a per-consumer axis. One constant is enough: an author who wants
smaller output still has the only lever that ever mattered, which is the diagram itself.

The patched file is generated into `<generatedFilesDir>/plantuml-engine/<coreVersion>/` during
`configureWebpack`'s client branch — not in the plugin factory, so `swizzle`,
`write-translations` and the server compilation do not each pay to rewrite 7 MB. It is written
to a `.tmp` sibling and `rename`d into place, because `.docusaurus` is shared by every locale
and Docusaurus builds locales in separate processes. A cached build is reused when its size is
exactly `vendored + 3` bytes; every replacement is ASCII and fixed-width, so that equality is
an exact fingerprint and costs one `stat` rather than a 7 MB read.

## Consequences

- **The emitted asset directory gains a `-max32768` segment**:
  `assets/plantuml-client-<coreVersion>-max32768/`. This is required, not cosmetic — a reader
  holding a cached `plantuml.js` from an earlier plugin version must not be handed the
  unpatched engine from the same URL. The standard library is nested inside that directory, so
  it moves too and is re-downloaded once.
- **The render cache key is unchanged.** Only successful renders are cached, and this change
  is raise-only, so no cached SVG can become invalid.
- **A `@plantuml/core` release that changes the guard's shape fails the build**, naming the
  version, the literal whose count was wrong, and what was found. Failing is the right call:
  falling back to the unpatched engine would turn diagrams that rendered yesterday into error
  panels today, discovered by readers rather than by CI.
- **That failure is caught before it can ship.** `tests/unit/enginePatch.test.ts` runs the
  patcher against the real installed engine. Dependabot groups minor `@plantuml/core` bumps
  into auto-merging PRs and releases are cut from every green `main`, so without that test a
  TeaVM codegen change would merge, publish, and surface in consumers' builds. With it, the
  dependency PR goes red and both the merge and the release are blocked — the same mechanism
  `assertRuntimeFile` already relies on for a missing `viz-global.js`.
- **A very large diagram is now a real cost rather than an error panel.** A 30 000-point
  diagram is a multi-hundred-KB SVG, and both `detectDiagramError` (DOMParser) and
  `sanitizeSvgMarkup` (DOMPurify) parse it **synchronously** on the main thread. The queue's
  timeout cannot preempt synchronous work, so such a diagram can visibly stall the tab and may
  need `renderTimeoutMs` raised above its 20 s default. This is the same class of cost
  `graphviz.maxSourceBytes` exists to bound; here the plugin accepts it, because a diagram that
  will not render at all is worse than one that takes a moment.

## Alternatives considered

**Leave it alone and document the workaround.** Honest, and free. Rejected because the
workarounds are weak: the two an author reaches for first (`scale`, `skinparam dpi`) provably
do nothing, and the one that works requires editing the diagram until it is a different
diagram.

**Expose it as a plugin option.** Considered in detail and rejected as more machinery than the
problem warrants: the limit would have to reach the asset URL and the render cache key,
multiple plugin instances would emit multiple engines while the browser's module cache — which
is not keyed by URL — could only honour one of them, and every consumer would still be exposed
to the patch's failure mode without gaining anything they could act on.

**Emit the patched source through webpack's `emitAsset` instead of a file plus a copy
pattern.** Would remove the cache directory, the atomic-write concern and the accumulation of
one 7 MB directory per core version. Rejected for now because it needs a second bundler-
specific abstraction (`compiler.webpack.sources.RawSource`) alongside the one `createCopyPlugin`
already maintains, for a saving that `docusaurus clear` also achieves.

**Vendor a patched `plantuml.js` in the repository.** Removes all build-time work and all
failure modes at build time. Rejected because it forks a 7 MB minified artifact into git,
makes every `@plantuml/core` bump a manual re-patch, and hides from the reader what was changed
and why.
