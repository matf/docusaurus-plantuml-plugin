/**
 * Synthesizes the hyperlinks PlantUML's bundled engine drops.
 *
 * The engine parses `[[url]]` on components, participants and edges but emits no `<a>`
 * elements, so authored links are silently lost. What it *does* emit is enough to put them
 * back: every entity carries its alias in `data-qualified-name` and its source position in
 * `data-source-line`, and every edge carries `data-source-line` plus its endpoints in
 * `data-entity-1`/`data-entity-2`. This module extracts the links from the fence source the
 * plugin already has, correlates each with the rendered element, and wraps that element in a
 * real `<a>` — clickable, keyboard-focusable, and marked for styling.
 *
 * Correlation is a two-layer affair because of `!include`: the engine numbers lines in the
 * *preprocessed* text, so a stdlib include shifts every `data-source-line` after it and
 * line-equality silently stops holding. Aliases survive preprocessing untouched, which makes
 * them the include-proof primary; exact line matching is the fallback that covers unnamed
 * things (edges, mostly) in include-free sources. Everything here fails safe: a link that
 * cannot be correlated attaches to nothing.
 */

import {DATA_ATTR} from '../../constants.js';

export interface ExtractedLink {
  /** Zero-based index of the line in the fence source, matching `data-source-line`. */
  line: number;
  /** The line's text, used for alias-candidate extraction. */
  text: string;
  href: string;
}

/**
 * Schemes a synthesized link may carry. The engine's own output goes through DOMPurify, but
 * these anchors are built by this module *after* sanitization, so the check lives here.
 */
export function isSafeLinkHref(href: string): boolean {
  if (/^(https?:)/i.test(href)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false; // any other explicit scheme
  return (
    href.startsWith('/') || href.startsWith('./') || href.startsWith('../') || href.startsWith('#')
  );
}

/** `[[href]]`, `[[href label]]`, `[[href{tooltip}]]` — the href ends at `{`, space, or `]]`. */
const LINK_PATTERN = /\[\[([^\s{\]]+)[^\]]*\]\]/;

/** Note lines carry body links the engine renders as styled text; nothing to attach. */
const NOTE_LINE = /^\s*[rh]?note\b/i;

/**
 * Extracts at most one link per source line.
 *
 * One per line is a deliberate ceiling, not laziness: `data-source-line` identifies a line,
 * not a token, so two links on one line cannot be told apart on the SVG side.
 */
export function extractSourceLinks(source: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const lines = source.split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index] as string;
    if (NOTE_LINE.test(text)) continue;
    const match = LINK_PATTERN.exec(text);
    if (!match) continue;
    const href = match[1] as string;
    if (!isSafeLinkHref(href)) continue;
    links.push({line: index, text, href});
  }
  return links;
}

/** `as ALIAS` — the strongest signal a declaration line gives. */
const AS_ALIAS = /\bas\s+([A-Za-z_][\w]*)/;

/** C4-style macro: `Container(alias, …)` — the alias is the first argument. */
const MACRO_ALIAS = /^\s*[A-Za-z_][\w]*\s*\(\s*([A-Za-z_][\w]*)\s*[,)]/;

/** `component ALIAS [[…]]` — a declaration whose bare name is the alias. */
const DECL_ALIAS =
  /^\s*(?:component|actor|participant|database|queue|node|usecase|rectangle|interface|boundary|control|entity|collections|agent|artifact|card|cloud|file|folder|frame|hexagon|package|person|stack|storage|state|object|class|circle|label)\s+([A-Za-z_][\w]*)/i;

/** Lines with an arrow are relations; their identifiers name the two endpoints. */
const ARROW = /(-+[->]|\.+[.>]|<[-.]|[-.]{2,})/;

const IDENTIFIER = /[A-Za-z_][\w]*/g;

/**
 * The alias candidates a link line offers, most specific first. `null` means the line's
 * shape gives no safe candidates and only exact line matching may be used.
 */
function aliasCandidates(text: string): string[] | null {
  const as = AS_ALIAS.exec(text);
  if (as) return [as[1] as string];
  const macro = MACRO_ALIAS.exec(text);
  if (macro) return [macro[1] as string];
  const decl = DECL_ALIAS.exec(text);
  if (decl) return [decl[1] as string];
  if (ARROW.test(text)) {
    // Identifiers before the link only: the label after `:` may contain arbitrary words.
    const beforeLink = text.slice(0, text.indexOf('[['));
    return beforeLink.match(IDENTIFIER) ?? [];
  }
  return null;
}

/**
 * Participant lifelines run the full height of a sequence diagram; wrapping them would turn
 * most of the background into a link.
 */
function isWrappable(element: Element): boolean {
  return !(element.getAttribute('class') ?? '').includes('lifeline');
}

function wrap(element: Element, href: string): boolean {
  if (!isWrappable(element)) return false;
  if (element.closest('a')) return false; // already linked — never nest anchors
  const parent = element.parentNode;
  if (!parent) return false;
  const anchor = element.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'a');
  anchor.setAttribute('href', href);
  anchor.setAttribute(DATA_ATTR.diagramLink, 'true');
  parent.insertBefore(anchor, element);
  anchor.appendChild(element);
  return true;
}

/**
 * Attaches extracted links to the rendered SVG. Returns how many elements were wrapped.
 *
 * Resolution per link, in order:
 *
 * 1. **Alias** (include-proof): a declaration line's single candidate that names emitted
 *    `data-qualified-name` elements wraps all of them. An arrow line whose identifiers name
 *    exactly two entities wraps the `g.link` connecting them.
 * 2. **Exact line**: elements whose `data-source-line` equals the author's line index —
 *    which holds whenever the source was not shifted by preprocessing.
 */
export function attachDiagramLinks(root: Element, links: ExtractedLink[]): number {
  const named = new Map<string, Element[]>();
  for (const element of Array.from(root.querySelectorAll('[data-qualified-name]'))) {
    const name = element.getAttribute('data-qualified-name') as string;
    const list = named.get(name);
    if (list) list.push(element);
    else named.set(name, [element]);
  }
  // Entity ids (`ent0001`) are what edges reference in `data-entity-1`/`data-entity-2`.
  const idToName = new Map<string, string>();
  for (const [name, elements] of named) {
    for (const element of elements) {
      const id = element.getAttribute('id');
      if (id) idToName.set(id, name);
    }
  }

  let wrapped = 0;

  for (const link of links) {
    const candidates = aliasCandidates(link.text);

    // 1a. A single alias candidate that exists → wrap every element carrying it.
    if (candidates !== null) {
      const matching = candidates.filter((candidate) => named.has(candidate));
      if (matching.length === 1) {
        for (const element of named.get(matching[0] as string) ?? []) {
          if (wrap(element, link.href)) wrapped += 1;
        }
        continue;
      }
      // 1b. Exactly two entities on an arrow line → the edge between them.
      if (matching.length === 2) {
        const [a, b] = matching as [string, string];
        const edge = Array.from(root.querySelectorAll('g.link')).find((element) => {
          const e1 = idToName.get(element.getAttribute('data-entity-1') ?? '');
          const e2 = idToName.get(element.getAttribute('data-entity-2') ?? '');
          return (e1 === a && e2 === b) || (e1 === b && e2 === a);
        });
        if (edge && wrap(edge, link.href)) {
          wrapped += 1;
          continue;
        }
      }
    }

    // 2. Exact line match — the fallback for unnamed elements in unshifted sources.
    for (const element of Array.from(root.querySelectorAll(`[data-source-line="${link.line}"]`))) {
      if (wrap(element, link.href)) wrapped += 1;
    }
  }

  return wrapped;
}

/** Undoes {@link attachDiagramLinks}: unwraps every synthesized anchor under `root`. */
export function detachDiagramLinks(root: Element): void {
  for (const anchor of Array.from(root.querySelectorAll(`a[${DATA_ATTR.diagramLink}]`))) {
    const parent = anchor.parentNode;
    if (!parent) continue;
    while (anchor.firstChild) parent.insertBefore(anchor.firstChild, anchor);
    anchor.remove();
  }
}
