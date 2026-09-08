# ADR 0008 — Drop the engine patch and expose the ceiling as `maxSvgSize`

- Status: accepted
- Date: 2026-09-08
- Supersedes: [ADR 0007](0007-engine-size-ceiling-patch.md)
- Affects: `src/options.ts`, `src/constants.ts`, `src/assets.ts`, `src/runtime/renderer.ts`,
  `src/runtime/cache.ts`, `src/runtime/types.ts`, `src/theme/PlantUmlDiagram/index.tsx`

## Context

[ADR 0007](0007-engine-size-ceiling-patch.md) rewrote two literals in the 7 MB
`@plantuml/core` bundle so the engine would serialize diagrams up to 32768 points instead of 4096. It was a workaround for the absence of an engine option, and it said so.

`@plantuml/core@1.2026.8` added that option, via
[plantuml/plantuml#2832](https://github.com/plantuml/plantuml/issues/2832):

```js
C5z = (b) => {
  let c = D21(b);
  if (c < 0) c = 8192;
  return c;
};
D21 = (b) => (b && typeof b.maxSvgSize === 'number' ? b.maxSvgSize : -1);
```

Both `render` and `renderToString` now read `maxSvgSize` from their trailing options object.
Verified against the published bundle:

| `maxSvgSize`     | Effect                                                   |
| ---------------- | -------------------------------------------------------- |
| absent           | 8192 — upstream also raised its own default from 4096    |
| `0`              | the guard is skipped entirely (`if (d > 0) { …check… }`) |
| a positive `n`   | ceiling is `n`                                           |
| a negative value | read as "unspecified" and silently replaced by 8192      |

The error message names it too:
`Diagram too large for browser rendering: 78x12916 (max 8192; override via the maxSvgSize option, or set it to 0 to disable this check)`.

Two facts force the timing. The literals ADR 0007 anchored on — `>4096.0)` and ` (max 4096)`
— occur **zero** times in 1.2026.8, because the comparison now reads a variable. So
`patchEngineSource` throws on that release by construction, and the canary test
`tests/unit/enginePatch.test.ts` fails the moment Dependabot opens the bump. The patch had to
come out in the same change as the version bump, not after it.

## Decision

Remove the patch. Pass `maxSvgSize` to the engine on every render, and expose it as a
top-level plugin option defaulting to **32768** — the value ADR 0007's patch used, so no
existing site's diagrams change.

`0` is accepted and forwarded unchanged, which is the engine's own convention for "no
ceiling". Negative values are **rejected at build time** rather than forwarded: the engine
reads a negative as "unspecified" and falls back to 8192, so `maxSvgSize: -1` would quietly
mean something very different from what it reads like.

The option is always sent, never omitted when it happens to match a default. The engine's
default (8192) is lower than this plugin's (32768), so omitting it would silently tighten the
ceiling.

### Revisiting ADR 0007's "Not configurable"

ADR 0007 rejected an option, and that reasoning is worth answering rather than quietly
reversing. Every objection it raised was a consequence of _patching_, not of configuring:

| ADR 0007's objection                             | Why it no longer applies                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| the limit would have to reach the asset URL      | nothing about the served file varies now; the URL is the engine's identity alone |
| multiple instances would emit multiple engines   | there is one vendored engine, emitted once                                       |
| the browser's module cache could honour only one | the value is a render argument, not baked into the module                        |
| every consumer inherits the patch's failure mode | there is no patch to fail                                                        |

What survives is the render cache key, and that one is real — see below.

### The version floor

`package.json` asks for `^1.2026.8`, but a site can still end up below it through an
override, a hoisted duplicate or a stale lockfile. `locatePlantUmlCore()` therefore checks the
version actually on disk and fails the build naming it. This matters more than an ordinary
floor: the engine **ignores render options it does not recognize**, so on an older install
`maxSvgSize` would read as honoured while the engine's own 4096-point ceiling refused large
diagrams — a silent failure discovered by readers.

## Consequences

- **The asset directory loses its `-max32768` segment**:
  `assets/plantuml-client-<coreVersion>/`. The segment existed to distinguish differently
  patched engines; with no patch it distinguishes nothing. The URL moves anyway because
  `coreVersion` moves, so this costs no extra cache churn. The standard library is nested
  inside it and is re-downloaded once.
- **`maxSvgSize` joins the render cache key.** ADR 0007 could leave the key alone because the
  patch was raise-only and applied uniformly. An option can be _lowered_, and `session` cache
  entries outlive the rebuild that lowered it, so without the key term a site that tightened
  the setting would keep serving readers the oversized diagram their tab had already cached.
  One key segment closes that off. Graphviz keys are unaffected — that engine has its own
  guard in `graphviz.maxSourceBytes`.
- **The build no longer reads and rewrites 7 MB**, and `.docusaurus/plantuml-engine/` is gone
  along with its atomic-write and per-core-version accumulation concerns. `docusaurus clear`
  is no longer needed to reclaim it; an existing directory from an older plugin version is
  simply orphaned and harmless.
- **The canary moves from unit to end-to-end.** `tests/unit/enginePatch.test.ts` is deleted
  with the module it guarded. `tests/e2e/engine-contract.spec.ts` takes over the role: it
  renders a diagram over the engine's default ceiling, confirms it is refused, then confirms
  the same diagram renders under a raised ceiling and under `0`. A release that drops or
  renames the option fails there rather than silently reverting every site to 8192.
- **The cost of a very large diagram is unchanged** and still belongs to whoever raises the
  ceiling: both `detectDiagramError` (DOMParser) and `sanitizeSvgMarkup` (DOMPurify) parse the
  result **synchronously** on the main thread, and the queue's timeout cannot preempt
  synchronous work. This is why the default is a number rather than `0`.

## Alternatives considered

**Keep the patch and pass the option too.** Belt and braces, and briefly tempting as a hedge
against the option being withdrawn. Rejected outright: the patch cannot apply to 1.2026.8 at
all — its anchors are gone — so this is not an available option, only a way to fail the build.

**Default to the engine's 8192 rather than 32768.** Closer to upstream, and cheaper for a site
that never draws a large diagram. Rejected because it would be a silent regression: sites on
1.7.x render diagrams between 8192 and 32768 points today, and a minor release should not turn
those into error panels. A site that wants upstream's number can set it.

**Nest it as `plantuml.maxSvgSize`.** Symmetrical with `graphviz.maxSourceBytes`. Rejected
because there is no `plantuml` option group and inventing one for a single key would move
every existing top-level option or create two ways to say the same thing. The name matching
the engine's own option is worth more than the symmetry.

**Name it `maxDiagramSize`.** Describes the units better — these are PlantUML points, not SVG
bytes, and `maxSvgSize` invites confusion with `graphviz.maxSourceBytes`. Rejected because
the engine's error message now names `maxSvgSize` verbatim, and a reader who follows that
message into these docs should find the same word.
