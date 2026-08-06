export type PlantUmlErrorKind = 'load' | 'engine' | 'diagram' | 'timeout' | 'config' | 'aborted';

/** Every failure surfaced to the UI is one of these, so the panel can explain what broke. */
export class PlantUmlError extends Error {
  readonly kind: PlantUmlErrorKind;

  constructor(kind: PlantUmlErrorKind, message: string, options?: {cause?: unknown}) {
    super(message, options);
    this.name = 'PlantUmlError';
    this.kind = kind;
  }
}

/**
 * Noise that PlantUML prepends to its error diagrams. Dropping it keeps the message about
 * the user's diagram rather than about the engine's build metadata.
 */
const BOILERPLATE_PATTERNS = [
  /^PlantUML version /,
  /^This version of PlantUML is \d+ days old/,
  /^consider upgrading from /,
  /^\s*$/,
];

const NOT_SUPPORTED_HEADING = 'Diagram not supported by this release of PlantUML';

function textNodesOf(svg: string): string[] {
  if (typeof DOMParser === 'undefined') return [];
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  } catch {
    return [];
  }
  if (doc.querySelector('parsererror')) return [];
  return Array.from(doc.querySelectorAll('text')).map((node) => node.textContent ?? '');
}

/**
 * PlantUML reports invalid diagrams by *successfully* rendering an error picture rather
 * than by calling the error callback, so a rendered SVG still has to be inspected.
 *
 * Each signature requires two co-occurring markers to avoid misreading a legitimate
 * diagram that merely contains the words "syntax error" in a note.
 *
 * @returns a human-readable message, or `null` when the SVG is a real diagram.
 */
export function detectDiagramError(svg: string): string | null {
  const texts = textNodesOf(svg);
  if (texts.length === 0) return null;

  const isSyntaxError = texts.some(
    (text) => /Syntax Error\?/.test(text) && text.includes('(Assumed diagram type:'),
  );
  const isEmptyDescription = texts.some(
    (text) => /Empty description/.test(text) && text.includes('(Assumed diagram type:'),
  );
  const isUnsupported =
    texts.some((text) => text.includes(NOT_SUPPORTED_HEADING)) &&
    texts.some((text) => text.includes('is not recognized.'));

  if (!isSyntaxError && !isEmptyDescription && !isUnsupported) return null;

  const meaningful = texts
    .map((text) => text.replace(/\s+$/, ''))
    .filter((text) => !BOILERPLATE_PATTERNS.some((pattern) => pattern.test(text)));

  const message = meaningful.join('\n').trim();
  return message.length > 0 ? message : 'PlantUML reported an error for this diagram.';
}

const UNKNOWN_ERROR = 'The PlantUML engine reported an unknown error.';
const UNPRINTABLE_ERROR = 'The PlantUML engine reported an unstringifiable error.';

/**
 * Normalizes whatever the engine hands to its error callback into a readable string.
 *
 * The engine is TeaVM-compiled Java, so a rejection can be an `Error`, a bare string, or a
 * host object with its own `toString`. Anything without a meaningful string form is
 * described rather than rendered as `[object Object]`.
 */
export function describeEngineError(raw: unknown): string {
  if (raw instanceof Error) return raw.message;
  if (typeof raw === 'string') return raw;
  if (raw === null || raw === undefined) return UNKNOWN_ERROR;
  if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'bigint') {
    return String(raw);
  }
  if (typeof raw === 'symbol') return raw.toString();
  if (typeof raw === 'function') return UNKNOWN_ERROR;

  const candidate = raw as {toString?: unknown};
  if (
    typeof candidate.toString === 'function' &&
    candidate.toString !== Object.prototype.toString
  ) {
    try {
      const text = (candidate.toString as () => unknown)();
      if (typeof text === 'string' && text !== '') return text;
    } catch {
      return UNPRINTABLE_ERROR;
    }
  }

  try {
    return JSON.stringify(raw) ?? UNKNOWN_ERROR;
  } catch {
    return UNPRINTABLE_ERROR;
  }
}

/**
 * Coerces an unknown rejection into an `Error`, preserving {@link PlantUmlError} instances
 * so their `kind` survives a trip through the render queue.
 */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new PlantUmlError('engine', describeEngineError(value));
}
