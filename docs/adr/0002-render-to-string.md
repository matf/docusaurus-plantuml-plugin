# ADR 0002 — Use `renderToString`, not the DOM `render()` API

- Status: accepted
- Date: 2026
- Affects: `src/runtime/renderer.ts`, `src/runtime/errors.ts`, `src/runtime/types.ts`

## Context

`docs/spec.md` prefers a string-returning API but allows a DOM-oriented fallback:

> Prefer a string-returning API when it supports all required options. When dark-mode
> rendering is only available through the DOM-oriented `render()` API, wrap it safely:
> create a unique temporary render target; call `render(lines, targetId, {dark})`; detect
> completion with a `MutationObserver`; extract the SVG; clean up the observer and temporary
> element […]
>
> Do not assume that `renderToString` supports options unless verified from the installed
> package.

So the fallback is conditional on a fact about the installed engine, and the spec requires
that fact to be verified rather than assumed. It was verified against
`@plantuml/core@1.2026.6`.

### What the installed package actually exposes

`plantuml.js` exports exactly two functions: `render` and `renderToString`.

`renderToString` has arity **4**:

```ts
renderToString(
  lines: string[],
  onSuccess: (svg: string) => void,
  onError: (message: unknown) => void,
  options?: {dark?: boolean},
): void;
```

The options object is the _fourth_ argument, after both callbacks — not the second, as one
would guess from `render(lines, targetId, options)`.

Reading the minified body, both functions apply the same dark flag: each compiles to
`AUQ = CPe(<options>) ? 1 : 0`. Empirically:

- `{dark: true}` produces different fill colours (`#222222` / `#E7E7E7` / `#FFFFFF`) from
  light (`#181818` / `#E2E2F0`);
- `{dark: false}` output is **byte-identical** to omitting the argument entirely.

Dark mode is therefore fully available through the string API, and the spec's precondition for
the DOM fallback does not hold.

## Decision

Render through `renderToString(lines, onSuccess, onError, {dark})`. Do not use `render()`,
temporary DOM targets, or `MutationObserver`.

The engine's shape is captured as an explicit interface in `src/runtime/types.ts` and guarded
by a browser contract test (`tests/e2e/engine-contract.spec.ts`), so an engine upgrade that
changes the signature fails a test rather than diagrams in production.

## Consequences

- **No temporary DOM elements exist at all.** The entire class of cleanup bugs the spec's
  step 7 was written to prevent — leaked nodes on success, error, timeout or unmount — cannot
  occur, because there is nothing to clean up. Success/error/timeout/unmount handling is
  trivially correct.
- **No `MutationObserver` and no completion heuristics.** Completion is a callback. There is
  no observer to disconnect and no window in which a mutation could be attributed to the wrong
  render.
- **Rendering does not touch the document.** The renderer is a pure `string -> Promise<string>`
  function, which is what makes it straightforward to unit-test and to serialize behind the
  render queue.
- The callbacks are wrapped in a promise with a `settled` guard, so a double callback from the
  engine cannot resolve and reject the same promise.
- Nothing here removes the need for the render queue: the engine's shared module-level state
  is a property of the engine, not of which entry point is called. See
  `docs/architecture.md`.

## Invalid PlantUML does not call `onError`

The second discovery, and the reason `src/runtime/errors.ts` exists.

**Invalid diagram source is not reported through the error callback.** The engine renders an
"error picture" — a real SVG containing the error text — and calls `onSuccess`. `onError`
fires only for engine-level exceptions; an unterminated `@startuml`, for instance, surfaces as
a `java.lang.IndexOutOfBoundsException`.

A rendered SVG therefore cannot be trusted just because it arrived through the success path.
`detectDiagramError()` parses the SVG and inspects its `<text>` nodes for error signatures.
Each signature requires **two co-occurring markers**, so that a legitimate diagram whose note
text happens to contain the words "syntax error" is not misread as a failure:

| Signature           | Requires both of                                                                 |
| ------------------- | -------------------------------------------------------------------------------- |
| Syntax error        | `Syntax Error?` **and** `(Assumed diagram type:`                                 |
| Empty description   | `Empty description` **and** `(Assumed diagram type:`                             |
| Unsupported diagram | `Diagram not supported by this release of PlantUML` **and** `is not recognized.` |

When a signature matches, the SVG's text is surfaced as the error message with PlantUML's
version-nag boilerplate stripped — `PlantUML version …`, `This version of PlantUML is N days
old`, `consider upgrading from …` — so the message is about the reader's diagram rather than
about the engine's build metadata. If stripping leaves nothing, a generic message is used.

Parsing failures are handled conservatively: if there is no `DOMParser`, if parsing throws, or
if the result contains a `parsererror`, `detectDiagramError` returns `null` and the SVG is
treated as a real diagram. A detector that cannot read the output must not manufacture errors.

The consequence for users is that invalid PlantUML produces the documented `error` state with
PlantUML's own message — never a mysterious picture of an error rendered as though it were the
diagram they asked for.

## Alternatives considered

**Follow the spec's DOM fallback anyway, for symmetry with the documented approach.** Rejected:
it would add a temporary-element lifecycle, a `MutationObserver` and four cleanup paths to
obtain output that the string API already returns directly.

**Trust `onSuccess` and skip SVG inspection.** Rejected: it violates the spec's "do not
silently swallow rendering errors" constraint in the most literal way possible, by displaying
an error as if it were a diagram.

**Match a single error marker instead of two.** Rejected as too eager — a diagram legitimately
containing the phrase "Syntax Error?" in a note would be replaced by an error panel.
