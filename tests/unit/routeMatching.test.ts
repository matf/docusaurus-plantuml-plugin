import {describe, expect, it} from 'vitest';

import {isRoutedPathname, type RouteLike} from '../../src/theme/PlantUmlDiagram/routeMatching.js';

/**
 * The table below mirrors a generated `routes.js`: leaves are `exact`, a docs plugin nests
 * them under non-exact parents that repeat the same path, and `codegenRoutes` appends the
 * `'*'` catch-all that renders `NotFound`.
 */
const ROUTES: RouteLike[] = [
  {path: '/site/', exact: true},
  {path: '/site/blog', exact: true},
  {
    path: '/site/docs',
    routes: [
      {
        path: '/site/docs',
        routes: [
          {path: '/site/docs/intro', exact: true},
          {path: '/site/docs/guides/deploy', exact: true},
        ],
      },
    ],
  },
  {path: '*'},
];

describe('deciding whether this build routes a path', () => {
  it('matches a leaf nested under non-exact parents', () => {
    expect(isRoutedPathname(ROUTES, '/site/docs/intro')).toBe(true);
    expect(isRoutedPathname(ROUTES, '/site/docs/guides/deploy')).toBe(true);
  });

  it('matches top-level routes, including the site root', () => {
    expect(isRoutedPathname(ROUTES, '/site/')).toBe(true);
    expect(isRoutedPathname(ROUTES, '/site/blog')).toBe(true);
  });

  // The whole point: the catch-all matches every path, so counting it would make the check
  // vacuous and every sibling build's URL would look routed.
  it('does not count the catch-all that renders NotFound', () => {
    expect(isRoutedPathname(ROUTES, '/other-build/systems/overview')).toBe(false);
    expect(isRoutedPathname(ROUTES, '/')).toBe(false);
    expect(isRoutedPathname(ROUTES, '/site-other/docs/intro')).toBe(false);
  });

  it('is empty-safe and catch-all-only-safe', () => {
    expect(isRoutedPathname([], '/site/docs/intro')).toBe(false);
    expect(isRoutedPathname([{path: '*'}], '/site/docs/intro')).toBe(false);
  });

  // A non-exact parent owns its whole subtree, so an unknown page inside this build's docs
  // tree stays client-side and gets this build's own NotFound — which is the right answer
  // for a prefix this build owns.
  it('treats an unknown page under an owned prefix as routed', () => {
    expect(isRoutedPathname(ROUTES, '/site/docs/removed')).toBe(true);
    expect(isRoutedPathname(ROUTES, '/site/docs/guides/gone')).toBe(true);
  });

  // react-router matches on segment boundaries; a prefix that merely shares characters is
  // a different path and belongs to whoever else serves it.
  it('respects segment boundaries rather than string prefixes', () => {
    expect(isRoutedPathname(ROUTES, '/site/docsomething')).toBe(false);
    expect(isRoutedPathname(ROUTES, '/site/blogging')).toBe(false);
  });

  it('does not let an exact route match a longer path', () => {
    expect(isRoutedPathname([{path: '/site/blog', exact: true}], '/site/blog/post')).toBe(false);
  });

  it('handles a route answering to several paths, catch-all included', () => {
    const multi: RouteLike[] = [{path: ['/site/a', '/site/b'], exact: true}, {path: ['*']}];
    expect(isRoutedPathname(multi, '/site/a')).toBe(true);
    expect(isRoutedPathname(multi, '/site/b')).toBe(true);
    expect(isRoutedPathname(multi, '/site/c')).toBe(false);
  });

  it('ignores routes carrying no path', () => {
    expect(
      isRoutedPathname([{exact: true}, {routes: [{path: '/site/x', exact: true}]}], '/site/x'),
    ).toBe(true);
  });
});
