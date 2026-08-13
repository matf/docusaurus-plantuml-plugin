import {useEffect, type MutableRefObject} from 'react';

import {useLocation} from '@docusaurus/router';

import {DATA_ATTR} from '../../constants.js';
import {claimDeeplinkScroll, findDeeplinkTarget, parseDiagramHash} from './deeplink.js';
import type {ZoomPanHandle} from './useZoomPan.js';
import {centerViewportOn} from './zoomMath.js';

/**
 * Makes one diagram react to `#graph?highlight-node=…` deep links.
 *
 * On a matching hash the target node is marked (`data-plantuml-focused-node`, styled from
 * the stylesheet), the page scrolls to the first matching figure, and — when the diagram is
 * zoomable — the view snaps to 100% centred on the node. A diagram without the node does
 * nothing, which is what lets every diagram on the page react without any of them carrying
 * an id.
 *
 * The hash comes from the router, not from a `hashchange` listener: Docusaurus `<Link>`
 * navigations are `history.pushState` calls, which fire no `hashchange` — so a listener
 * kept a stale hash whenever a link changed or dropped it while the page (and this
 * component) stayed mounted, leaving the old node highlighted. `useLocation` re-renders on
 * push, replace and pop alike, and native `#…` anchor clicks reach it too, via the
 * `popstate` the browser fires for hash navigations.
 *
 * Highlighting is imperative for the same reason the search's is: the marked elements live
 * in a `dangerouslySetInnerHTML` subtree React cannot render into.
 */

export interface UseDiagramDeeplinkParams {
  /** Whether the diagram is rendered and its SVG is in the DOM. */
  ready: boolean;
  /** The rendered SVG string — a dependency, so a re-rendered picture is re-matched. */
  svg: string | null;
  /** Whether the diagram is zoomable; centring and the 100% snap need the viewport. */
  interactive: boolean;
  zoom: ZoomPanHandle;
  containerRef: MutableRefObject<HTMLElement | null>;
}

export function useDiagramDeeplink({
  ready,
  svg,
  interactive,
  zoom,
  containerRef,
}: UseDiagramDeeplinkParams): void {
  const location = useLocation();
  const target = parseDiagramHash(location.hash);
  // One value per history entry. Undefined on entries the router did not create itself
  // (native hash clicks, the initial load); those still differ in `target`, which the
  // scroll claim includes.
  const navigationKey = location.key ?? 'pop';
  const pathname = location.pathname;

  /**
   * Marks, scrolls and centres. The cleanup unmarks, so a changed hash, a navigation that
   * drops the hash and an unmounting diagram all sweep up through the same code path; a
   * replaced SVG re-runs the effect (via `svg`) against the new elements.
   *
   * `navigationKey` is a dependency on purpose: following the same deep link again is a new
   * history entry with an unchanged `target`, and it should scroll and re-centre again.
   */
  useEffect(() => {
    if (!ready || target === null) return undefined;
    const figure = containerRef.current;
    const canvas = figure?.querySelector('[role="img"]');
    if (!figure || !canvas) return undefined;

    const match = findDeeplinkTarget(canvas, target);
    if (!match) return undefined;

    for (const element of match.elements) {
      element.setAttribute(DATA_ATTR.focusedNode, 'true');
    }

    claimDeeplinkScroll(`${navigationKey}|${pathname}|${target}`, figure);

    if (interactive) {
      const layer = zoom.layerRef.current;
      if (layer) {
        // The node's offset inside the layer, divided back by the current scale, is its
        // position in content coordinates whatever the zoom was; the view then snaps to
        // 100% centred there — the zoom level a deep link promises.
        const transform = zoom.getTransform();
        const layerBox = layer.getBoundingClientRect();
        const box = match.anchor.getBoundingClientRect();
        zoom.applyTransform(
          centerViewportOn(
            {k: 1, x: 0, y: 0},
            (box.left + box.width / 2 - layerBox.left) / transform.k,
            (box.top + box.height / 2 - layerBox.top) / transform.k,
            zoom.measure(),
          ),
        );
      }
    }

    return () => {
      for (const element of match.elements) {
        element.removeAttribute(DATA_ATTR.focusedNode);
      }
    };
  }, [containerRef, interactive, navigationKey, pathname, ready, svg, target, zoom]);
}
