/// <reference types="@docusaurus/module-type-aliases" />

/**
 * `@docusaurus/module-type-aliases` types `@theme-init/*` as `any`, which would spread
 * untyped values through the wrapper. Declaring the exact specifier gives the extension
 * point a real signature: the props Docusaurus hands to `MDXComponents/Code`.
 */
declare module '@theme-init/MDXComponents/Code' {
  import type {ComponentType, ReactNode} from 'react';

  export interface Props {
    children?: ReactNode;
    className?: string;
    metastring?: string;
    language?: string;
    title?: string;
  }

  const MDXCode: ComponentType<Props>;
  export default MDXCode;
}

declare module '@theme/PlantUmlDiagram' {
  import type {ComponentType} from 'react';

  export interface Props {
    source: string;
    title?: string;
    language?: string;
    engine?: 'plantuml' | 'graphviz';
    layout?: string;
    zoom?: boolean;
  }

  const PlantUmlDiagram: ComponentType<Props>;
  export default PlantUmlDiagram;
}
