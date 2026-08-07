import type {ReactNode} from 'react';

import OriginalCode from '@theme-init/MDXComponents/Code';
import PlantUmlDiagram from '@theme/PlantUmlDiagram';

import type {DiagramEngine} from '../../../runtime/types.js';
import {
  extractLanguage,
  extractSource,
  parseBooleanMeta,
  parseStringMeta,
  parseTitle,
  type CodeBlockProps,
} from '../../codeBlockMeta.js';
import {usePlantUmlConfig} from '../../usePlantUmlConfig.js';

/**
 * Wraps Docusaurus' `MDXComponents/Code` extension point.
 *
 * Only fences whose language is configured for one of the two diagram engines are
 * intercepted. Everything else — inline code, ordinary fenced blocks, JSX-authored blocks —
 * is delegated to the original component with its props untouched, so no existing code-block
 * behaviour changes.
 *
 * The delegate is imported from `@theme-init/`, not `@theme-original/`. Docusaurus points
 * *both* `@theme/X` and `@theme-original/X` at the last plugin theme that provides `X`, so
 * a plugin importing `@theme-original/MDXComponents/Code` imports itself and recurses until
 * the stack overflows. `@theme-init/X` is the alias that keeps pointing at the first theme
 * to provide the component — see `docs/adr/0001-theme-init-alias.md`.
 *
 * Handling both engines in this one wrapper is not merely convenient: only one plugin can
 * usefully wrap this component, so two engines shipped as two plugins would silently disable
 * each other. That is the reason Graphviz lives here rather than in a package of its own.
 */
export default function Code(props: CodeBlockProps): ReactNode {
  const config = usePlantUmlConfig();
  const language = extractLanguage(props);

  const engine = matchEngine(config, language);
  const source = engine !== null ? extractSource(props.children) : null;

  if (engine === null || source === null) {
    return <OriginalCode {...props} />;
  }

  return (
    <PlantUmlDiagram
      source={source}
      title={parseTitle(props)}
      language={language}
      engine={engine}
      layout={engine === 'graphviz' ? parseStringMeta(props, 'engine') : undefined}
      zoom={parseBooleanMeta(props, 'zoom')}
    />
  );
}

/**
 * Decides which engine — if either — owns this fence.
 *
 * `resolveOptions` rejects a configuration where both engines claim the same language, so the
 * order these are checked in cannot change what a site renders.
 */
function matchEngine(
  config: ReturnType<typeof usePlantUmlConfig>,
  language: string | undefined,
): DiagramEngine | null {
  if (config === null || language === undefined) return null;
  if (config.options.languages.includes(language)) return 'plantuml';
  // `usePlantUmlConfig` fills the group in when older global data lacks it, so it is always
  // present here even if the site's `.docusaurus` cache predates Graphviz support.
  const {graphviz} = config.options;
  if (graphviz.enabled && graphviz.languages.includes(language)) return 'graphviz';
  return null;
}
