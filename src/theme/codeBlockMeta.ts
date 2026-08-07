import {Children, isValidElement, type ReactNode} from 'react';

/**
 * Mirrors Docusaurus' own code-block metadata parsing so that a `plantuml` fence behaves
 * exactly like any other fence up to the point where this plugin takes over.
 */

/** Same expression Docusaurus uses in `theme-common`'s `parseCodeBlockTitle`. */
const TITLE_REGEX = /title=(?<quote>["'])(?<title>.*?)\1/;

const LANGUAGE_CLASS_PREFIX = 'language-';

export interface CodeBlockProps {
  children?: ReactNode;
  className?: string;
  metastring?: string;
  language?: string;
  title?: string;
}

/**
 * Extracts the fence language.
 *
 * MDX preserves the case the author typed (```PlantUML yields `language-PlantUML`), and
 * Docusaurus lower-cases it before handing it to Prism. Matching is therefore
 * case-insensitive: `plantuml`, `PlantUML` and `PUML` all resolve to the same language.
 */
export function extractLanguage(props: CodeBlockProps): string | undefined {
  if (typeof props.language === 'string' && props.language.trim() !== '') {
    return props.language.trim().toLowerCase();
  }
  const fromClass = props.className
    ?.split(' ')
    .find((entry) => entry.startsWith(LANGUAGE_CLASS_PREFIX));
  if (!fromClass) return undefined;
  const language = fromClass.slice(LANGUAGE_CLASS_PREFIX.length).trim();
  return language === '' ? undefined : language.toLowerCase();
}

export function isPlantUmlLanguage(props: CodeBlockProps, languages: readonly string[]): boolean {
  const language = extractLanguage(props);
  return language !== undefined && languages.includes(language);
}

/**
 * Flattens fence children into the raw diagram source.
 *
 * Returns `null` when the children contain React elements, which happens for JSX-authored
 * code blocks. Those are handed back to the original Docusaurus component untouched rather
 * than being rendered from a partially-known source string.
 */
export function extractSource(children: ReactNode): string | null {
  const parts = Children.toArray(children);
  if (parts.length === 0) return null;
  if (parts.some((part) => isValidElement(part))) return null;
  if (!parts.every((part) => typeof part === 'string' || typeof part === 'number')) return null;
  const source = parts.join('');
  // MDX always terminates a fence with a newline that is not part of the diagram.
  return source.replace(/\n$/, '');
}

/**
 * Quoted segments, removed before flag matching so that a value such as
 * `title="zoom=false"` can never be mistaken for a flag.
 */
const QUOTED_SEGMENT = /(["'])(?:\\.|(?!\1).)*\1/g;

/**
 * Reads a boolean flag from the fence metastring: either bare (`zoom`) or explicit
 * (`zoom=true` / `zoom=false`).
 *
 * Returns `undefined` when the flag is absent or malformed, which the caller reads as "fall
 * back to the plugin option". A fence metastring is authored prose, not configuration, so an
 * unrecognized value is ignored rather than failing the site build.
 */
export function parseBooleanMeta(props: CodeBlockProps, key: string): boolean | undefined {
  const metastring = props.metastring;
  if (typeof metastring !== 'string' || metastring === '') return undefined;

  const withoutQuoted = metastring.replace(QUOTED_SEGMENT, ' ');
  // Word boundaries by hand: `nozoom` and `zoomed` must not match `zoom`.
  const pattern = new RegExp(`(?:^|\\s)${key}(?:=(\\S+))?(?=\\s|$)`, 'i');
  const match = pattern.exec(withoutQuoted);
  if (!match) return undefined;

  const value = match[1];
  if (value === undefined) return true;

  const normalized = value.toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
}

/**
 * Reads a `key=value` pair from the fence metastring, accepting `engine=neato`,
 * `engine="neato"` and `engine='neato'` alike.
 *
 * Unlike {@link parseBooleanMeta} this runs against the raw metastring, because the value it
 * is looking for may itself be the quoted part. Returns `undefined` when the key is absent or
 * carries no value, which the caller reads as "fall back to the plugin option".
 */
export function parseStringMeta(props: CodeBlockProps, key: string): string | undefined {
  const metastring = props.metastring;
  if (typeof metastring !== 'string' || metastring === '') return undefined;

  // Word boundaries by hand, matching parseBooleanMeta: `subengine=` must not match `engine`.
  const pattern = new RegExp(`(?:^|\\s)${key}=(?:"([^"]*)"|'([^']*)'|(\\S+))(?=\\s|$)`, 'i');
  const match = pattern.exec(metastring);
  if (!match) return undefined;

  const value = match[1] ?? match[2] ?? match[3];
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed !== '' ? trimmed : undefined;
}

/** Reads `title="..."` (or `title='...'`) from the fence metastring. */
export function parseTitle(props: CodeBlockProps): string | undefined {
  if (typeof props.title === 'string' && props.title !== '') return props.title;
  const match = props.metastring?.match(TITLE_REGEX);
  const title = match?.groups?.['title'];
  return title !== undefined && title !== '' ? title : undefined;
}
