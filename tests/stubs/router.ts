import {useSyncExternalStore} from 'react';

/**
 * Stand-in for `@docusaurus/router`, which only exists inside a real Docusaurus webpack
 * build. Mirrors the piece the theme uses: `useLocation`, re-rendering subscribers on every
 * navigation — which is exactly the behaviour the deep-link hook depends on, since router
 * navigations (`history.pushState`) fire no DOM event a component could listen for.
 */

export interface StubLocation {
  pathname: string;
  search: string;
  hash: string;
  /** Distinguishes one navigation entry from the next, like react-router's `location.key`. */
  key?: string;
}

const INITIAL: StubLocation = {pathname: '/docs/test', search: '', hash: '', key: 'default'};

let current: StubLocation = INITIAL;
let navigationCount = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLocation(): StubLocation {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}

/**
 * Drives a navigation: mounted components re-render with the new location, exactly as a
 * router push would make them. Unspecified fields reset to a hash-less default on purpose —
 * a navigation replaces the location, it does not patch it. Call inside `act()` when
 * components are mounted.
 */
export function setStubLocation(next: Partial<StubLocation>): void {
  navigationCount += 1;
  current = {
    pathname: current.pathname,
    search: '',
    hash: '',
    key: `stub-${navigationCount}`,
    ...next,
  };
  for (const listener of listeners) listener();
}

export function resetStubRouter(): void {
  current = INITIAL;
  navigationCount = 0;
  listeners.clear();
}
