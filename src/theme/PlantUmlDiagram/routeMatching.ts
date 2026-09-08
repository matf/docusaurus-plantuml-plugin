import {matchPath} from '@docusaurus/router';

/**
 * Whether a path belongs to the Docusaurus build that is currently running.
 *
 * In-diagram links are navigated through the router, which is only correct for a path this
 * build actually routes. A site published as **several** builds — one per product area, a
 * docs build beside a marketing build, two builds stitched together by a reverse proxy —
 * shares an origin across bundles that each route only their own subtree. Pushing a sibling
 * build's path into this build's router matches no route, renders this build's own "Page not
 * found", and never reaches the server that could have served it. Reloading that URL works,
 * which is the tell.
 *
 * So the rule is: push what this build routes, and hand everything else to the browser.
 */

/**
 * One entry of the generated route table, narrowed to what matching needs.
 *
 * `path` widens to an array because react-router allows one route to answer to several
 * paths. Docusaurus' own codegen never emits that, but the generated table is typed as
 * react-router's `RouteConfig`, and quietly ignoring the array form would silently treat
 * such a route as unrouted.
 */
export interface RouteLike {
  path?: string | string[];
  exact?: boolean;
  routes?: RouteLike[];
}

/**
 * The catch-all every generated route table ends with.
 *
 * `codegenRoutes` appends `{path: '*', component: ComponentCreator('*')}` to every build,
 * and that route is what renders `NotFound`. It therefore matches *every* path, which would
 * make the check below vacuous — excluding it is the whole point.
 */
const CATCH_ALL_PATH = '*';

/** Depth-first flattening; nested routes are how Docusaurus expresses a docs plugin's tree. */
function flattenRoutes(routes: readonly RouteLike[]): RouteLike[] {
  return routes.flatMap((route) => [route, ...flattenRoutes(route.routes ?? [])]);
}

/**
 * Whether `pathname` matches any real route of `routes`.
 *
 * A flat walk rather than `react-router-config`'s `matchRoutes`: it gives the same answer for
 * every shape a Docusaurus table takes — verified against a generated `routes.js`, including
 * nested docs trees, non-exact parents and segment-boundary near-misses like `/docsomething` —
 * and it needs only `matchPath`, which `@docusaurus/router` exports for theme code. Reaching
 * past that export into `react-router-config` would mean depending on a transitive package of
 * `@docusaurus/core` that a strict installer need not hoist.
 *
 * Non-exact parent routes match their whole subtree, so an unknown page *inside* this build's
 * own docs tree still counts as routed. That is deliberate: this build owns that prefix, and
 * its own `NotFound` is the right answer there. Only a path no route claims at all is handed
 * back to the browser.
 */
export function isRoutedPathname(routes: readonly RouteLike[], pathname: string): boolean {
  return flattenRoutes(routes).some((route) => {
    if (route.path === undefined) return false;
    const paths = (Array.isArray(route.path) ? route.path : [route.path]).filter(
      (path) => path !== CATCH_ALL_PATH,
    );
    if (paths.length === 0) return false;
    return matchPath(pathname, {path: paths, exact: route.exact === true}) !== null;
  });
}
