import type {VizRenderError} from './types.js';

export type PlantUmlErrorKind =
  | 'load'
  | 'engine'
  | 'diagram'
  | 'syntax'
  | 'timeout'
  | 'config'
  | 'aborted'
  | 'too-large'
  /** A `!include <namespace/…>` the site cannot resolve. */
  | 'stdlib';

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

/**
 * Failures raised by PlantUML's *preprocessor* rather than by its parser.
 *
 * These matter far more now that `!include <namespace/…>` is resolvable. Calling a macro the
 * included version does not define, naming a file that is not in the namespace, and an
 * include the preprocessor could not resolve at all are the three likeliest ways a standard
 * library diagram goes wrong. *None* of them produces the `Syntax Error?` marker below — the
 * picture says only `Function not found RelIndex`, `cannot include <…>` or `Fatal parsing
 * error` — so without this signature the engine's error card was passed through as a
 * successful render.
 */
const PREPROCESSOR_FAILURE_PATTERN =
  /^\s*(?:function not found|cannot include|fatal parsing error)\b/i;

/**
 * The header PlantUML puts above the source listing in every error picture. Required to
 * co-occur with the line above, so that a diagram merely containing the words "cannot
 * include" in a note is not mistaken for a failure.
 */
const SOURCE_LISTING_PATTERN = /^\[From .+\(line \d+\)/;

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

  const preprocessorFailures = texts.filter((text) => PREPROCESSOR_FAILURE_PATTERN.test(text));
  const isPreprocessorError =
    preprocessorFailures.length > 0 && texts.some((text) => SOURCE_LISTING_PATTERN.test(text));

  if (!isSyntaxError && !isEmptyDescription && !isUnsupported && !isPreprocessorError) return null;

  // A preprocessor failure lists the *expanded* source, which for a standard library macro
  // runs to thousands of lines. The failure itself is the only part worth showing; the
  // reader still has the original fence a click away in the source view.
  if (isPreprocessorError && !isSyntaxError) {
    return preprocessorFailures.map((text) => text.trim()).join('\n');
  }

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

const GRAPHVIZ_UNKNOWN_ERROR = 'Graphviz rejected this diagram without reporting a reason.';

/**
 * Joins Graphviz's own diagnostics into one message.
 *
 * Unlike PlantUML, Graphviz reports failures as structured data rather than as a rendered
 * error picture, so the reader can be shown exactly what the engine said — typically
 * `syntax error in line 3 near '}'`. Warnings are dropped here: they accompany *successful*
 * renders and must not be presented as failures.
 */
export function formatGraphvizErrors(errors: readonly VizRenderError[]): string {
  const messages = errors
    .filter((entry) => entry.level !== 'warning')
    .map((entry) => entry.message.trim())
    .filter((message) => message.length > 0);
  // A failure with only warning-level diagnostics still failed; show them rather than nothing.
  const fallback = errors
    .map((entry) => entry.message.trim())
    .filter((message) => message.length > 0);
  const chosen = messages.length > 0 ? messages : fallback;
  return chosen.length > 0 ? [...new Set(chosen)].join('\n') : GRAPHVIZ_UNKNOWN_ERROR;
}

/**
 * Extracts the 1-based source line from a Graphviz diagnostic, so the error panel can point
 * at the offending line of the fence. Returns `null` when no line is named.
 */
export function graphvizErrorLine(message: string): number | null {
  const match = /\bin line (\d+)\b/i.exec(message);
  if (!match?.[1]) return null;
  const line = Number.parseInt(match[1], 10);
  return Number.isInteger(line) && line > 0 ? line : null;
}
