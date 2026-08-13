/**
 * Deep links into diagrams: `#graph?highlight-node=<TARGET>`.
 *
 * Every diagram on the page reacts to the hash — none of them needs an id of its own, and a
 * diagram that does not contain the target simply does nothing. The matcher below is a
 * ladder: the first level that yields a match wins, so a deterministic, author-chosen ID
 * always beats the loose text matching that exists for diagrams nobody annotated.
 *
 * Everything here is DOM-in, elements-out and free of React, which is what makes the ladder
 * testable against synthetic SVG.
 */

/** The hash prefix that separates diagram deep links from ordinary heading anchors. */
const HASH_PREFIX = '#graph?';

/** The query parameter carrying the node identifier. */
const NODE_PARAM = 'highlight-node';

/**
 * Extracts the deeplink target from a location hash.
 *
 * Returns the decoded identifier — `%0A` becomes a real newline, so multiline labels can be
 * addressed — or `null` when the hash is absent, not diagram-shaped, or names no node.
 */
export function parseDiagramHash(hash: string): string | null {
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const target = new URLSearchParams(hash.slice(HASH_PREFIX.length)).get(NODE_PARAM);
  return target === null || target.trim() === '' ? null : target;
}

export interface DeeplinkMatch {
  /** The elements to mark as the focused node — one group or anchor, or several text lines. */
  elements: Element[];
  /** The element whose position the viewport centres on. */
  anchor: Element;
}

/** Escapes a value for use inside a double-quoted CSS attribute selector. */
function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** The target of an `<a>` element, whichever spelling the engine used. */
function hrefOf(anchor: Element): string | null {
  return anchor.getAttribute('href') ?? anchor.getAttribute('xlink:href');
}

/** Whether every line of the window contains its target line, case-insensitively. */
function windowMatches(texts: Element[], start: number, lines: string[]): boolean {
  return lines.every((line, index) =>
    (texts[start + index]?.textContent ?? '').toLowerCase().includes(line),
  );
}

/**
 * Finds the node a deeplink target refers to inside one rendered diagram.
 *
 * The ladder, from most to least deterministic:
 *
 * 1. **Explicit id** — an element whose `id` equals the target. Graphviz emits these for
 *    `node [id="…"]`, giving a hidden, deterministic handle. (PlantUML's own `id`s are
 *    generated — `ent0001` — and deliberately not part of the contract.)
 * 2. **PlantUML alias** — the engine writes every entity's alias into
 *    `data-qualified-name` on its `g.entity` group, so `component "X" as REACTION_1234`
 *    and `note "…" as REACTION_1234` are addressable by an id that never appears in the
 *    picture. This is PlantUML's spelling of a hidden deterministic id.
 * 3. **Self-anchor** — an `<a>` whose href's hash parses to the same target, which doubles
 *    as the node's own permalink. Graphviz emits these for `node [URL="#graph?…"]`; the
 *    bundled PlantUML engine currently emits no anchors at all, so for PlantUML this level
 *    is future-proofing rather than an authoring channel.
 * 4. **Graphviz node name** — the `<title>` Graphviz writes into every `g.node`, so plain
 *    DOT node names work with no annotation at all.
 * 5. **Multiline label** — a target containing newlines (`%0A` in the URL) matches that many
 *    *consecutive* text lines, each containing its line of the target. The window stays
 *    inside one node's group where groups exist (Graphviz `g.node`, PlantUML `g.entity`)
 *    and runs over the document order otherwise — which is how a two-line label is told
 *    apart from two nodes that each contain one of the lines.
 * 6. **Single-line substring** — the first text line containing the target,
 *    case-insensitively. This is what lets the unique half of a label (`12345` of
 *    `caminus-process-archive\n12345`) address the node without spelling out the rest.
 */
export function findDeeplinkTarget(root: Element, target: string): DeeplinkMatch | null {
  // A target with a newline is a multiline label, never an id or alias — and selector
  // engines reject the literal newline outright.
  if (!target.includes('\n')) {
    // 1. Explicit id. An attribute selector rather than #…: ids here are author-chosen and
    // may start with a digit or contain characters a bare id selector would reject.
    const byId = root.querySelector(`[id="${escapeAttributeValue(target)}"]`);
    if (byId) return {elements: [byId], anchor: byId};

    // 2. PlantUML alias.
    const byAlias = root.querySelector(`[data-qualified-name="${escapeAttributeValue(target)}"]`);
    if (byAlias) return {elements: [byAlias], anchor: byAlias};
  }

  // 3. Self-anchor.
  for (const anchor of Array.from(root.querySelectorAll('a'))) {
    const href = hrefOf(anchor);
    const hashIndex = href?.indexOf('#') ?? -1;
    if (href !== null && hashIndex >= 0 && parseDiagramHash(href.slice(hashIndex)) === target) {
      return {elements: [anchor], anchor};
    }
  }

  // 4. Graphviz node name.
  for (const title of Array.from(root.querySelectorAll('g.node > title'))) {
    const node = title.parentElement;
    if (node && (title.textContent ?? '').trim() === target) {
      return {elements: [node], anchor: node};
    }
  }

  const lines = target
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line !== '');
  if (lines.length === 0) return null;

  // 5. Multiline label.
  if (lines.length > 1) {
    const groups = Array.from(root.querySelectorAll('g.node, g.entity'));
    const scopes = groups.length > 0 ? groups : [root];
    for (const scope of scopes) {
      const texts = Array.from(scope.querySelectorAll('text'));
      for (let start = 0; start + lines.length <= texts.length; start += 1) {
        if (windowMatches(texts, start, lines)) {
          const window = texts.slice(start, start + lines.length);
          return {elements: window, anchor: window[0] as Element};
        }
      }
    }
    return null;
  }

  // 6. Single-line substring.
  const needle = lines[0] as string;
  for (const text of Array.from(root.querySelectorAll('text'))) {
    if ((text.textContent ?? '').toLowerCase().includes(needle)) {
      return {elements: [text], anchor: text};
    }
  }
  return null;
}

/**
 * Scrolls the page to the first figure that claims a given deeplink navigation — and only
 * that one.
 *
 * Diagrams evaluate the hash independently, so without an arbiter every matching figure
 * would fight over the scroll position. The caller keys the claim on one *navigation* to
 * one target (history entry key + pathname + target): the many diagrams reacting to a
 * single navigation yield a single scroll, while following the same deep link again — a new
 * history entry, unchanged hash — scrolls again. Keying on the target alone got that second
 * follow wrong: the stale claim swallowed the scroll. On a page whose diagrams were
 * force-rendered by the hash, renders complete in mount order, so the first claimant is in
 * practice the first matching figure in the document.
 */
let scrolledKey: string | null = null;

export function claimDeeplinkScroll(claimKey: string, figure: Element): void {
  if (scrolledKey === claimKey) return;
  scrolledKey = claimKey;
  figure.scrollIntoView({block: 'center'});
}

/** Test-only: lets each test start with the scroll unclaimed. */
export function resetDeeplinkScroll(): void {
  scrolledKey = null;
}
