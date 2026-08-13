/**
 * The toolbar's icons, drawn rather than typed.
 *
 * These were symbol characters until 1.3.1, and one of them was invisible to a large group of
 * readers: `⛶` U+26F6 SQUARE FOUR CORNERS has no glyph in any font that ships with a stock
 * Linux desktop, so the maximize control rendered as a tofu box — on the demo site included.
 * The other four only worked because DejaVu Sans happens to be installed, which a minimal
 * container image or a locked-down corporate desktop does not promise. See issue #21.
 *
 * Two details keep the existing styling working with no CSS change at all:
 *
 * - `currentColor` inherits `.toolbarButton`'s `color: var(--ifm-font-color-base)`, so both
 *   colour modes keep working exactly as they did.
 * - `1em` inherits its `font-size: 1rem`, so the icons size with the button — and with a
 *   reader who has scaled their font up — the way the characters used to.
 *
 * Every icon is `aria-hidden`: each `<button>` already carries an `aria-label`, which is the
 * accessible name. Nothing here is announced.
 */

import type {ReactElement} from 'react';

const iconProps = {
  viewBox: '0 0 16 16',
  width: '1em',
  height: '1em',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  // Keeps the SVG out of the tab order in browsers that made it focusable by default.
  focusable: false,
} as const;

/** Replaces `−` U+2212. */
export function ZoomOutIcon(): ReactElement {
  return (
    <svg {...iconProps}>
      <path d="M3 8h10" />
    </svg>
  );
}

/** Replaces `+`. */
export function ZoomInIcon(): ReactElement {
  return (
    <svg {...iconProps}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

/** Replaces `⟲` U+27F2: a circular arrow, open at the top right where the arrowhead sits. */
export function ResetZoomIcon(): ReactElement {
  return (
    <svg {...iconProps}>
      <path d="M13 8A5 5 0 1 1 11.4 4.3" />
      <path d="M13 2v3h-3" />
    </svg>
  );
}

/**
 * Fit to view: the maximize corners with the diagram drawn inside them, so the two controls
 * read as siblings — both are about the frame, one keeps you in the page.
 */
export function FitIcon(): ReactElement {
  return (
    <svg {...iconProps}>
      <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
      <rect x="5.5" y="5.5" width="5" height="5" rx="1" />
    </svg>
  );
}

/** Replaces `⛶` U+26F6, the character that had no glyph. */
export function MaximizeIcon(): ReactElement {
  return (
    <svg {...iconProps}>
      <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
    </svg>
  );
}

/** Replaces `✕` U+2715, shown in place of maximize while the diagram fills the viewport. */
export function CloseIcon(): ReactElement {
  return (
    <svg {...iconProps}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

/** The minimap toggle: a map frame with the viewport rectangle marked inside it. */
export function MinimapIcon(): ReactElement {
  return (
    <svg {...iconProps}>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <rect x="4.5" y="7.5" width="4" height="3" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Replaces the literal `</>` of the source toggle.
 *
 * ASCII, so it never had the glyph problem — but left as text it would be the one control in
 * the row still drawn in the page font, at a different weight and optical size from its
 * neighbours, and moving with the reader's font settings while they stayed put.
 */
export function SourceIcon(): ReactElement {
  return (
    <svg {...iconProps}>
      <path d="M6 4L2 8l4 4M10 4l4 4-4 4" />
    </svg>
  );
}
