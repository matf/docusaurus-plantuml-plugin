# ADR 0001 — Wrap `@theme-init/MDXComponents/Code`, not `@theme-original/`

- Status: accepted
- Date: 2026
- Affects: `src/theme/MDXComponents/Code/index.tsx`

## Context

The plugin intercepts fenced code blocks by providing its own `MDXComponents/Code` theme
component and delegating every non-PlantUML block to the previous implementation. The question
is which alias that delegate should be imported from.

`docs/spec.md`, the requirements this project was built against, says explicitly:

> wrap `@theme-original/MDXComponents/Code`

That is the natural reading of the Docusaurus documentation, and it is wrong for a plugin.

Docusaurus registers theme paths through `createAliasesForTheme(themePath,
addOriginalAlias)`. For every **plugin** theme path it is called with `addOriginalAlias:
true`, which points **both** `@theme/X` **and** `@theme-original/X` at that same theme path.
`@theme-original/` is only meaningful for **site-level swizzled** components, which are
registered from `userThemePaths` with `addOriginalAlias: false` — there, `@theme/X` is the
site's swizzled copy and `@theme-original/X` is what it shadowed.

So a plugin component that imports `@theme-original/MDXComponents/Code` imports **itself**.

This is not theoretical. Before the fix, the example site's static-site generation failed with:

```text
RangeError: Maximum call stack size exceeded
```

— the component recursing into itself until the stack ran out, during SSG, with no hint in the
message about which component was responsible.

The alias that keeps pointing at the _first_ theme to provide a component, regardless of how
many later themes wrap it, is `@theme-init/X`. It exists precisely for the plugin-wrapping
case, and it is the same mechanism `docusaurus-theme-live-codeblock` uses to wrap
`CodeBlock`.

## Decision

Import the delegate from `@theme-init/MDXComponents/Code`:

```tsx
import OriginalCode from '@theme-init/MDXComponents/Code';
```

Deviate from the spec here, and record why in this ADR rather than silently.

## Consequences

- **A theme that already provides `MDXComponents/Code` must be installed.** `@theme-init/X`
  resolves to the first theme providing `X`; with no such theme there is nothing to resolve
  and the build fails. In practice this means `@docusaurus/theme-classic`, which virtually
  every Docusaurus 3 site has through `preset-classic`. This is documented as a requirement,
  not treated as a bug.
- **A site-level swizzle of `MDXComponents/Code` wins.** If a site swizzles that component
  itself, Docusaurus points `@theme/MDXComponents/Code` at the site's copy and this plugin is
  bypassed entirely. Diagrams silently stop rendering. Users who need both must merge this
  plugin's delegation logic into their swizzled component.
- **Two plugins wrapping the same component do not compose.** Both would register a theme path
  providing `MDXComponents/Code`, and only one wrapper survives. There is no supported
  mechanism for chaining plugin wrappers of the same component in Docusaurus 3.
- **The recursion failure mode is guarded by the end-to-end suite.** A full production build of
  the example site is what caught it, and that build runs on every CI run — a regression to
  `@theme-original/` fails there rather than in a user's site.
- The spec's `@theme-original/` instruction stands uncorrected in `docs/spec.md`; this ADR is
  the record that the implementation deliberately deviates from it.

## Alternatives considered

**Use a Remark transform plus a packaged React component.** The spec permits this as a
fallback when the theme-component approach cannot be made to work reliably. It was not needed:
`@theme-init/` makes the preferred design work across Docusaurus 3.x, and the spec is explicit
that the fallback must not be chosen merely because it is easier.

**Require users to swizzle `MDXComponents/Code` themselves.** Rejected — the spec requires
that no manual swizzling be needed, and it would push the recursion problem onto every user.
