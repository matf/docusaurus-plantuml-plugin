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

/** Reads `title="..."` (or `title='...'`) from the fence metastring. */
export function parseTitle(props: CodeBlockProps): string | undefined {
  if (typeof props.title === 'string' && props.title !== '') return props.title;
  const match = props.metastring?.match(TITLE_REGEX);
  const title = match?.groups?.['title'];
  return title !== undefined && title !== '' ? title : undefined;
}
