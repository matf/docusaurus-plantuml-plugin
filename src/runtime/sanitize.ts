import createDOMPurify from 'dompurify';

import {PlantUmlError} from './errors.js';

/**
 * PlantUML output is generated from user-authored diagram source, and diagram source can
 * embed arbitrary markup (labels, `<style>` blocks, hyperlinks). It is therefore treated as
 * untrusted and run through DOMPurify's SVG profile before it reaches `innerHTML`.
 */

type Purifier = ReturnType<typeof createDOMPurify>;

let purifier: Purifier | null = null;

function getPurifier(): Purifier {
  if (purifier) return purifier;
  if (typeof window === 'undefined') {
    throw new PlantUmlError('config', 'SVG sanitization requires a browser environment.');
  }
  purifier = createDOMPurify(window);
  return purifier;
}

/**
 * `foreignObject` is the one SVG element that can host arbitrary HTML, which reintroduces
 * exactly the injection surface the SVG profile exists to remove. PlantUML does not need it.
 */
const FORBIDDEN_TAGS = ['foreignobject', 'script', 'iframe', 'object', 'embed', 'audio', 'video'];

/**
 * Sanitizes a rendered SVG string.
 *
 * Scripts, event-handler attributes and `javascript:` URLs are removed; ordinary PlantUML
 * geometry, text, gradients, markers, links and `data-*`/ARIA attributes are preserved.
 *
 * @throws PlantUmlError when the input contains no SVG root at all, which would otherwise
 *   surface as a silently blank diagram.
 */
export function sanitizeSvgMarkup(svg: string): string {
  const purify = getPurifier();
  const clean = purify.sanitize(svg, {
    USE_PROFILES: {svg: true, svgFilters: true},
    FORBID_TAGS: FORBIDDEN_TAGS,
    FORBID_ATTR: ['formaction', 'xlink:show', 'ping'],
    ADD_ATTR: ['role', 'aria-label', 'aria-labelledby', 'aria-describedby'],
    ALLOW_DATA_ATTR: true,
    KEEP_CONTENT: true,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
  });

  if (!/<svg[\s>]/i.test(clean)) {
    throw new PlantUmlError(
      'engine',
      'Sanitization removed the rendered diagram: the engine output contained no usable <svg> root.',
    );
  }
  return clean;
}

/** Test-only: forces the DOMPurify instance to be rebuilt against the current window. */
export function resetSanitizer(): void {
  purifier = null;
}
