# ADR 0003 — Zoom by transforming a wrapper, not the SVG

- Status: accepted
- Date: 2026
- Affects: `src/theme/PlantUmlDiagram/{index.tsx,useZoomPan.ts,zoomMath.ts,styles.module.css}`,
  `src/options.ts`, `src/theme/codeBlockMeta.ts`, `src/constants.ts`

## Context

A large diagram — a wide component diagram, a full domain model — is rendered at
`max-width: 100%` and becomes an unreadable postage stamp. Before this change the only
recourse was the native horizontal scroll on `.canvas`, which does nothing for height and
cannot magnify at all.

Adding zoom to an SVG that has already been sanitized and inserted with
`dangerouslySetInnerHTML` raises four questions: what gets transformed, how zoom is triggered
without breaking page scrolling, where interactive controls can live given `role="img"`, and
whether the whole thing should be on by default.

## Decision

### Transform a wrapper element

The sanitized SVG is wrapped in a clipping `viewport` containing a `layer` that carries
`transform: translate(x, y) scale(k)`. The SVG node itself is never touched.

The decisive argument is **layout, not security**. `.canvas svg {max-width: 100%; height: auto}`
derives the SVG's laid-out height from its `viewBox` aspect ratio. Mutating `viewBox` would
therefore change the element's laid-out height and reflow every paragraph below the diagram on
every wheel tick. To avoid that you would first have to pin `width`/`height` in pixels on the
SVG and then reimplement `max-width: 100%` in JavaScript. CSS transforms do not participate in
layout, so the figure's height is constant no matter how far the reader zooms in.

State the security position accurately, because it is easy to overclaim: the rule this project
follows is **never re-serialize** sanitized output. `element.outerHTML = mutate(element.outerHTML)`
round-trips purified markup back through the parser and is the classic mutation-XSS shape.
Setting an attribute such as `viewBox` on an already-parsed node would _not_ have been a
vulnerability. We avoid touching the node for layout and ownership reasons, not security ones.

Two consequences worth recording:

- `will-change: transform` and `translate3d` are deliberately **not** used. Permanently
  promoting the layer to its own compositor layer is what makes SVG text look blurry; a plain
  2D transform is re-rasterized crisply at rest.
- Measurements use `offsetWidth`/`offsetHeight` on the layer and `clientWidth`/`clientHeight`
  on the viewport, never `getBoundingClientRect()`. The layer's rect _includes_ the transform
  being changed, which would feed back into the next measurement.

### Ctrl + wheel, never plain wheel, never Cmd

Plain wheel scrolls the page, exactly as before. Zoom requires `ctrlKey` — which is also how
trackpad pinch arrives, so pinch-to-zoom works on laptops for free.

`metaKey` is deliberately **not** accepted: Cmd + scroll is the browser's own page zoom on
macOS, and intercepting it fights the platform.

The `wheel` listener must be registered with `addEventListener(…, {passive: false})` on a ref.
React registers its JSX `onWheel` prop passively at the root, so `preventDefault()` from there
is a silent no-op. Key handlers may use the JSX prop, because React key events are not passive.

### `touch-action: pan-y pinch-zoom`, and no custom pinch

One finger scrolls the page; two fingers are the browser's own zoom. A full-width diagram can
therefore never become a scroll trap on a phone, and WCAG 1.4.4 (Resize text) is not at risk
from a hijacked pinch. The cost is that we do not implement diagram-level pinch on
touchscreens, which is the right trade for a documentation site.

### Controls live outside `role="img"`

`role="img"` makes its entire subtree opaque to assistive technology, so a button placed inside
it is invisible to screen-reader users. The `role="img"` element is also written with
`dangerouslySetInnerHTML`, which forbids React children outright.

Both constraints point the same way: the transform layer and the toolbar sit **outside** the
`role="img"` div, which stays a leaf whose only child is the SVG. This also preserves
`div[role="img"] > svg` as a stable selector for tests and author CSS.

The toolbar is `role="group"`, **not** `role="toolbar"`: the toolbar role obliges an author to
implement roving-tabindex arrow navigation between its buttons, and the arrow keys are already
bound to panning.

### No React state

The transform lives in a ref and is written straight to the DOM. The hook calls `setState`
zero times, so panning never re-renders, and "no state update after unmount" becomes
structurally true rather than something a guard has to enforce. Only `pointermove` is
rAF-coalesced; wheel, buttons, keys and resize write synchronously, which also keeps the unit
tests free of frame-flushing.

Buttons are never disabled — zoom-in at maximum is a harmless no-op — which removes the only
prop that would otherwise have to depend on the transform.

### On by default

Zoom is enabled by default, overridable per fence with `zoom=false` and globally with
`zoom: false`.

This was a close call and the trade is real. Enabling it by default adds a toolbar and roughly
four keyboard tab stops to **every** diagram, changes the rendered markup for every existing
consumer, and adds a non-passive `wheel` listener and a `ResizeObserver` per diagram. The
argument that carried is that `0.x → 1.0` is exactly the boundary where a change of this shape
belongs, and that a feature nobody discovers is not worth building: large diagrams are common
in documentation, and the reader who needs zoom is rarely the author who would enable it.

## Consequences

- Site CSS that targets `[data-plantuml-diagram] > div[role="img"]` as a **direct child**
  breaks. Documented as a breaking change in the changelog, with the before/after shape.
- Every diagram costs about four extra tab stops. Mitigated by the toolbar existing only in the
  `ready` state, and by `zoom=false` removing it entirely for a given fence.
- Two new `data-*` attributes are part of the public contract: `data-plantuml-interactive` on
  the figure, `data-plantuml-zoom` on the viewport. The scale attribute deliberately lives on
  the viewport rather than the figure so that imperative writes can never race React's
  attribute diffing.
- The view resets on both a source change and a colour-mode change. Both triggers are needed:
  a cache hit resolves before any phase is reported, so toggling light → dark → light takes the
  component `ready → ready` in a microtask **without unmounting the layer**, and a reset keyed
  only on node identity would miss it.
- `prefers-reduced-motion` suppresses the easing of discrete zoom steps only. Dragging and
  wheel zooming are direct manipulation and stay instantaneous either way.

## Alternatives considered

**Mutate the SVG `viewBox`.** Rejected for the reflow-per-wheel-tick problem above, and because
it couples the implementation to the SVG's own coordinate system and `preserveAspectRatio`
handling — including for `sanitizeSvg: false` output that might not carry a `viewBox` at all.

**Transform a `<g>` inside the SVG.** Same coupling, plus it requires mutating the sanitized
subtree, and PlantUML's output has no single wrapper group to rely on.

**Depend on `svg-pan-zoom`.** Rejected: a new runtime dependency that mutates the SVG DOM and
brings its own sizing assumptions, to replace roughly 150 lines of pure geometry that is far
easier to unit-test than to configure around.

**Hover-revealed controls.** Rejected: `:hover` does not exist on touch devices, and fading
resting controls risks the WCAG 1.4.11 non-text contrast requirement.

**Fullscreen via a second component.** Not needed; the existing stage element is fullscreened
directly, with the previous transform saved and restored, and the button is feature-detected so
it is simply absent on iOS Safari, which has no element fullscreen.
