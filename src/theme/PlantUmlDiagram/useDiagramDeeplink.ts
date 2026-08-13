import {useEffect, useState, type MutableRefObject} from 'react';

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
  const [target, setTarget] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : parseDiagramHash(window.location.hash),
  );

  // A link *inside* one diagram can address a node in another, so the hash is live state,
  // not something read once on mount.
  useEffect(() => {
    const onHashChange = () => setTarget(parseDiagramHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  /**
   * Marks, scrolls and centres. The cleanup unmarks, so a changed hash, a cleared hash and
   * an unmounting diagram all sweep up through the same code path; a replaced SVG re-runs
   * the effect (via `svg`) against the new elements.
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

    claimDeeplinkScroll(target, figure);

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
  }, [containerRef, interactive, ready, svg, target, zoom]);
}
