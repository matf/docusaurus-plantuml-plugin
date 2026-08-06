import type {ReactNode} from 'react';

export interface Props {
  children?: ReactNode;
  className?: string;
  metastring?: string;
  language?: string;
  title?: string;
}

/**
 * Stands in for `@theme-init/MDXComponents/Code`.
 *
 * It records the props it received so delegation tests can assert that non-PlantUML blocks
 * reach the original component untouched.
 */
export const originalCodeCalls: Props[] = [];

export function resetOriginalCodeCalls(): void {
  originalCodeCalls.length = 0;
}

export default function OriginalCode(props: Props): ReactNode {
  originalCodeCalls.push(props);
  return (
    <code data-testid="original-code" className={props.className} data-meta={props.metastring}>
      {props.children}
    </code>
  );
}
