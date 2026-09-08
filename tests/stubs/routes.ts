import type {RouteLike} from '../../src/theme/PlantUmlDiagram/routeMatching.js';

/**
 * Stand-in for `@generated/routes`, which only exists inside a real Docusaurus build.
 *
 * Shaped like a real generated table rather than a flat list, because the shape is what the
 * route check has to cope with: a docs plugin nests its pages under non-exact parents that
 * all repeat the same path, and `codegenRoutes` appends the `'*'` catch-all that renders
 * `NotFound` — the entry that would make a naive match succeed for every path on earth.
 *
 * Paths carry the stub `baseUrl` (`/plantuml-test/`), as generated tables do. This build
 * routes that subtree and nothing else, which is what lets a test express "a path belonging
 * to a sibling Docusaurus build".
 */
const routes: RouteLike[] = [
  {path: '/plantuml-test/', exact: true},
  {path: '/plantuml-test/blog', exact: true},
  {
    path: '/plantuml-test/docs',
    routes: [
      {
        path: '/plantuml-test/docs',
        routes: [
          {path: '/plantuml-test/docs/orders', exact: true},
          {path: '/plantuml-test/docs/plantuml', exact: true},
          {path: '/plantuml-test/docs/test', exact: true},
        ],
      },
    ],
  },
  {path: '*'},
];

export default routes;
