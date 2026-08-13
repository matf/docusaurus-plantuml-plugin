import {useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject} from 'react';

import {DATA_ATTR} from '../../constants.js';
import type {ZoomPanHandle} from './useZoomPan.js';
import {centerViewportOn} from './zoomMath.js';

/**
 * Text search over one rendered diagram.
 *
 * The search runs against the *rendered SVG's* `<text>` elements rather than the diagram
 * source: what the reader sees is what they are searching, and a match can be highlighted and
 * panned to because it is a real element with a position. Matches are marked with data
 * attributes and coloured from the stylesheet, so the SVG string itself — which the cache
 * shares between diagrams — is never mutated.
 *
 * Highlighting is imperative for the same reason the zoom transform is: the elements live in
 * a `dangerouslySetInnerHTML` subtree that React cannot render into. React state carries only
 * what drives markup — the query, the match count and the current position.
 */

export interface DiagramSearchHandle {
  /** Whether the search bar is shown. */
  open: boolean;
  query: string;
  /** Number of `<text>` elements matching the query; 0 when the query is empty. */
  matchCount: number;
  /** Zero-based position of the current match, or -1 when there is none. */
  currentIndex: number;
  inputRef: MutableRefObject<HTMLInputElement | null>;
  toggle: () => void;
  close: () => void;
  setQuery: (value: string) => void;
  next: () => void;
  previous: () => void;
}

export interface UseDiagramSearchParams {
  enabled: boolean;
  zoom: ZoomPanHandle;
  /** The rendered SVG string — a dependency, so a re-rendered picture is re-searched. */
  svg: string | null;
}

export function useDiagramSearch({
  enabled,
  zoom,
  svg,
}: UseDiagramSearchParams): DiagramSearchHandle {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const matchesRef = useRef<Element[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const toggle = useCallback(() => setOpen((value) => !value), []);
  const close = useCallback(() => setOpen(false), []);

  const next = useCallback(() => {
    setCurrentIndex((index) => {
      const total = matchesRef.current.length;
      return total === 0 ? -1 : (index + 1) % total;
    });
  }, []);

  const previous = useCallback(() => {
    setCurrentIndex((index) => {
      const total = matchesRef.current.length;
      return total === 0 ? -1 : (index - 1 + total) % total;
    });
  }, []);

  // Typing should not require a second click after pressing the toggle.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // A diagram that lost its zoom lost the viewport the search pans; the bar goes with it.
  useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);

  /**
   * Finds and marks the matches. The effect's cleanup unmarks them, so closing the bar,
   * changing the query and unmounting all sweep up through the same code path. A replaced
   * SVG needs no sweeping — its marked elements left the document with it — but re-runs the
   * effect (via `svg`) so the new elements are searched.
   */
  useEffect(() => {
    if (!enabled || !open) return undefined;
    const layer = zoom.layerRef.current;
    const needle = query.trim().toLowerCase();
    if (!layer || needle === '') {
      matchesRef.current = [];
      setMatchCount(0);
      setCurrentIndex(-1);
      return undefined;
    }

    // `<text>` elements, not their tspans: a PlantUML label is one text element, and marking
    // the whole label keeps the highlight readable instead of colouring a fragment.
    const matches = Array.from(layer.querySelectorAll('svg text')).filter((element) =>
      (element.textContent ?? '').toLowerCase().includes(needle),
    );
    matchesRef.current = matches;
    for (const match of matches) match.setAttribute(DATA_ATTR.searchMatch, 'true');
    setMatchCount(matches.length);
    // Every new query starts at its first match, exactly like the browser's own find bar.
    setCurrentIndex(matches.length > 0 ? 0 : -1);

    return () => {
      matchesRef.current = [];
      for (const match of matches) match.removeAttribute(DATA_ATTR.searchMatch);
    };
  }, [enabled, open, query, svg, zoom]);

  /**
   * Marks the current match and centres the viewport on it.
   *
   * Declared after the match effect on purpose: effects run in order, so by the time this
   * one reads `matchesRef` the list belongs to the current query. `query` and `svg` are
   * dependencies because a new list can leave the index at 0 — unchanged — while element 0
   * is a different match.
   */
  useEffect(() => {
    if (!enabled || !open) return undefined;
    const target = currentIndex >= 0 ? matchesRef.current[currentIndex] : undefined;
    if (!target) return undefined;

    target.setAttribute(DATA_ATTR.searchCurrent, 'true');

    const layer = zoom.layerRef.current;
    if (layer) {
      // The match's offset inside the layer, both measured in the same transformed space,
      // divided back by the scale — which yields content coordinates whatever the zoom is.
      const transform = zoom.getTransform();
      const layerBox = layer.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      zoom.applyTransform(
        centerViewportOn(
          transform,
          (box.left + box.width / 2 - layerBox.left) / transform.k,
          (box.top + box.height / 2 - layerBox.top) / transform.k,
          zoom.measure(),
        ),
      );
    }

    return () => target.removeAttribute(DATA_ATTR.searchCurrent);
  }, [currentIndex, enabled, open, query, svg, zoom]);

  // Stable per set of values, like the zoom handle: consumers may hang callbacks and
  // effects off the handle, and those must not churn on unrelated re-renders.
  return useMemo(
    () => ({
      open,
      query,
      matchCount,
      currentIndex,
      inputRef,
      toggle,
      close,
      setQuery,
      next,
      previous,
    }),
    [open, query, matchCount, currentIndex, toggle, close, next, previous],
  );
}
