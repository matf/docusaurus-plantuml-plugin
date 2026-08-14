import {useEffect, type MutableRefObject} from 'react';

import {useHistory} from '@docusaurus/router';
import {useBaseUrlUtils} from '@docusaurus/useBaseUrl';

import type {DiagramEngine} from '../../runtime/types.js';
import {attachDiagramLinks, detachDiagramLinks, extractSourceLinks} from './diagramLinks.js';

/**
 * Author-written links inside one diagram: synthesis and navigation.
 *
 * **Synthesis** (PlantUML only): the bundled engine drops `[[url]]` links, so they are
 * rebuilt from the fence source and attached to the rendered elements — see
 * `diagramLinks.ts` for the correlation. Graphviz needs none of this; `URL=` already emits
 * real anchors.
 *
 * **Navigation** (both engines): a click on any in-diagram link to a same-site URL goes
 * through the router instead of a full page load, so a node can link to a diagram on
 * another page and arrive instantly — with the target page's diagrams reacting to the
 * hash through the same router-driven deep-link tracking. Site-absolute paths get the
 * site's `baseUrl`, exactly as markdown links do, so authors write the same `/docs/…`
 * everywhere. External links and pure `#…` anchors stay native: the browser handles both
 * correctly on its own, and the router observes hash navigations anyway.
 */

export interface UseDiagramLinksParams {
  /** Whether the diagram is rendered and its SVG is in the DOM. */
  ready: boolean;
  /** The rendered SVG string — a dependency, so a re-rendered picture is re-linked. */
  svg: string | null;
  engine: DiagramEngine;
  /** The fence source, exactly as authored — where the links are read from. */
  source: string;
  containerRef: MutableRefObject<HTMLElement | null>;
}

export function useDiagramLinks({
  ready,
  svg,
  engine,
  source,
  containerRef,
}: UseDiagramLinksParams): void {
  const history = useHistory();
  const {withBaseUrl} = useBaseUrlUtils();

  // Synthesis. The cleanup unwraps, so a re-rendered or unmounting diagram never leaks
  // anchors; a replaced SVG re-runs the effect (via `svg`) against the new elements.
  useEffect(() => {
    if (!ready || engine !== 'plantuml') return undefined;
    const canvas = containerRef.current?.querySelector('[role="img"]');
    if (!canvas) return undefined;

    const links = extractSourceLinks(source);
    if (links.length === 0) return undefined;
    attachDiagramLinks(canvas, links);

    return () => detachDiagramLinks(canvas);
  }, [containerRef, engine, ready, source, svg]);

  // Navigation. One listener on the figure covers synthesized and engine-native anchors
  // alike. Bubble phase on purpose: the zoom hook suppresses post-drag clicks in the
  // capture phase, and a suppressed click must not navigate.
  useEffect(() => {
    if (!ready) return undefined;
    const figure = containerRef.current;
    if (!figure) return undefined;

    const onClick = (event: MouseEvent) => {
      // Modified clicks are the reader asking the browser for its own behaviour
      // (new tab, download); never take those over.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest('a');
      if (!anchor || !figure.querySelector('[role="img"]')?.contains(anchor)) return;

      const href = anchor.getAttribute('href') ?? anchor.getAttribute('xlink:href');
      // Hash-only anchors navigate natively; the router sees hash navigations by itself.
      if (!href || href.startsWith('#')) return;

      const resolved = href.startsWith('/') ? withBaseUrl(href) : href;
      let url: URL;
      try {
        url = new URL(resolved, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;

      event.preventDefault();
      history.push(url.pathname + url.search + url.hash);
    };

    figure.addEventListener('click', onClick);
    return () => figure.removeEventListener('click', onClick);
  }, [containerRef, history, ready, withBaseUrl]);
}
