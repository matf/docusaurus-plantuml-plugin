import type {ReactNode} from 'react';

import OriginalCode from '@theme-init/MDXComponents/Code';
import PlantUmlDiagram from '@theme/PlantUmlDiagram';

import {
  extractLanguage,
  extractSource,
  parseTitle,
  type CodeBlockProps,
} from '../../codeBlockMeta.js';
import {usePlantUmlConfig} from '../../usePlantUmlConfig.js';

/**
 * Wraps Docusaurus' `MDXComponents/Code` extension point.
 *
 * Only fences whose language is configured as PlantUML are intercepted. Everything else —
 * inline code, ordinary fenced blocks, JSX-authored blocks — is delegated to the original
 * component with its props untouched, so no existing code-block behaviour changes.
 *
 * The delegate is imported from `@theme-init/`, not `@theme-original/`. Docusaurus points
 * *both* `@theme/X` and `@theme-original/X` at the last plugin theme that provides `X`, so
 * a plugin importing `@theme-original/MDXComponents/Code` imports itself and recurses until
 * the stack overflows. `@theme-init/X` is the alias that keeps pointing at the first theme
 * to provide the component — see `docs/adr/0001-theme-init-alias.md`.
 */
export default function Code(props: CodeBlockProps): ReactNode {
  const config = usePlantUmlConfig();
  const language = extractLanguage(props);

  const isPlantUml =
    config !== null && language !== undefined && config.options.languages.includes(language);

  const source = isPlantUml ? extractSource(props.children) : null;

  if (!isPlantUml || source === null) {
    return <OriginalCode {...props} />;
  }

  return <PlantUmlDiagram source={source} title={parseTitle(props)} language={language} />;
}
