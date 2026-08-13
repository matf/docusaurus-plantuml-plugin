import {useCallback, useEffect, useMemo, useRef, type ReactNode} from 'react';

import {CloseIcon} from './icons.js';
import type {ZoomPanHandle} from './useZoomPan.js';
import {centerViewportOn, minimapScale, visibleContentRect} from './zoomMath.js';
import styles from './styles.module.css';

/**
 * The minimap: a small copy of the diagram with a rectangle marking what the viewport
 * currently shows. Pressing or dragging anywhere on the map centres the view there.
 *
 * Everything that changes per pan frame — the map's sizes and the rectangle — is written
 * straight to the DOM through `zoom.subscribe`, for the same reason `useZoomPan` writes its
 * transform imperatively: mirroring a per-frame value through React state would re-render the
 * whole figure once per frame of every drag.
 *
 * The map handles the pointer itself rather than making the rectangle the draggable thing:
 * a rectangle a few pixels wide would be a hopeless drag target, and centring on the pressed
 * point makes a single click work as "jump there" with no extra code path.
 */

/** The box the diagram is scaled into. The map is smaller when the aspect ratio demands it. */
const MAP_MAX_WIDTH = 200;
const MAP_MAX_HEIGHT = 150;

export interface MinimapProps {
  /** The rendered diagram, already sanitized — the same string the canvas shows. */
  svg: string;
  zoom: ZoomPanHandle;
  onClose: () => void;
}

export default function Minimap({svg, zoom, onClose}: MinimapProps): ReactNode {
  // React 19 compares `dangerouslySetInnerHTML` by wrapper identity, not by `__html`; an
  // inline literal would re-parse the copy on every re-render of the figure.
  const svgHtml = useMemo(() => ({__html: svg}), [svg]);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const rectRef = useRef<HTMLDivElement | null>(null);
  const scaleRef = useRef(0);

  const update = useCallback(() => {
    const canvas = canvasRef.current;
    const layer = layerRef.current;
    const rect = rectRef.current;
    if (!canvas || !layer || !rect) return;

    const bounds = zoom.measure();
    const scale = minimapScale(bounds, MAP_MAX_WIDTH, MAP_MAX_HEIGHT);
    scaleRef.current = scale;
    // Nothing measurable yet (jsdom, or a picture that has not laid out): keep the box at
    // its maximum size rather than collapsing to a zero-sized, unclickable sliver.
    if (scale <= 0) {
      canvas.style.width = `${MAP_MAX_WIDTH}px`;
      canvas.style.height = `${MAP_MAX_HEIGHT}px`;
      rect.style.width = '0px';
      rect.style.height = '0px';
      return;
    }

    canvas.style.width = `${bounds.contentWidth * scale}px`;
    canvas.style.height = `${bounds.contentHeight * scale}px`;
    // The copy is laid out at the content's own width and scaled down as one block, so it
    // keeps exactly the layout — and therefore the geometry — of the real canvas.
    layer.style.width = `${bounds.contentWidth}px`;
    layer.style.transform = `scale(${scale})`;

    const visible = visibleContentRect(zoom.getTransform(), bounds);
    rect.style.left = `${visible.x * scale}px`;
    rect.style.top = `${visible.y * scale}px`;
    rect.style.width = `${visible.width * scale}px`;
    rect.style.height = `${visible.height * scale}px`;
  }, [zoom]);

  // `svg` is a dependency so a re-rendered picture re-measures once its new layout is
  // committed; the subscription covers every transform change in between.
  useEffect(() => {
    update();
    return zoom.subscribe(update);
  }, [svg, update, zoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let pointerId: number | null = null;

    const panTo = (event: PointerEvent) => {
      const scale = scaleRef.current;
      if (scale <= 0) return;
      const box = canvas.getBoundingClientRect();
      zoom.applyTransform(
        centerViewportOn(
          zoom.getTransform(),
          (event.clientX - box.left) / scale,
          (event.clientY - box.top) / scale,
          zoom.measure(),
        ),
      );
    };

    const setContinuous = (on: boolean) => {
      // The main layer eases discrete zoom steps; a drag tracked through the minimap is
      // direct manipulation and must not lag behind the pointer, exactly like a canvas drag.
      const layer = zoom.layerRef.current;
      if (layer) layer.dataset['plantumlContinuous'] = on ? 'true' : 'false';
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      pointerId = event.pointerId;
      // Unlike the canvas there is nothing to select or focus in here, so the press can be
      // consumed outright — this is also what stops a drag from selecting page text.
      event.preventDefault();
      setContinuous(true);
      try {
        canvas.setPointerCapture(pointerId);
      } catch {
        // Capture is unavailable in some environments; dragging still works without it.
      }
      panTo(event);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      event.preventDefault();
      panTo(event);
    };

    const endDrag = (event: PointerEvent) => {
      if (pointerId === null || event.pointerId !== pointerId) return;
      try {
        if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
      } catch {
        // Nothing to release.
      }
      pointerId = null;
      setContinuous(false);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('lostpointercapture', endDrag);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', endDrag);
      canvas.removeEventListener('lostpointercapture', endDrag);
      setContinuous(false);
    };
  }, [zoom]);

  return (
    <div className={styles.minimap} data-plantuml-minimap="true">
      {/*
       * The map is pointer-only by design and hidden from assistive technology: it is a
       * duplicate view of a diagram whose real viewport is already keyboard-operable, so
       * announcing a second copy would add noise without adding a capability. The close
       * button stays outside this subtree, so it remains reachable and focusable.
       */}
      <div ref={canvasRef} className={styles.minimapCanvas} aria-hidden="true">
        <div
          ref={layerRef}
          className={styles.minimapLayer}
          // The same sanitized string the visible canvas renders — nothing new to sanitize.
          dangerouslySetInnerHTML={svgHtml}
        />
        <div ref={rectRef} className={styles.minimapRect} />
      </div>
      <button
        type="button"
        className={`${styles.toolbarButton} ${styles.minimapClose}`}
        aria-label="Close minimap"
        onClick={onClose}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
