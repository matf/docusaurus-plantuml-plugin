/**
 * Shared parsing of `CHANGELOG.md`.
 *
 * Two callers need the same two facts and must not disagree about them: `next-release.mjs` reads
 * the `[Unreleased]` section to decide the version, and the publish workflow reads a released
 * section to write the GitHub Release notes. Both are "find a `## ` heading, take everything up
 * to the next one".
 */

/**
 * Returns the body under a `## ` heading, trimmed, or `null` when the heading is absent.
 *
 * @param {string} changelog full contents of CHANGELOG.md
 * @param {RegExp} heading anchored, multiline-flagged pattern matching the heading line
 * @returns {{body: string, start: number, end: number} | null}
 */
export function readSection(changelog, heading) {
  const match = heading.exec(changelog);
  if (!match) return null;
  const afterHeading = match.index + match[0].length;
  const next = changelog.indexOf('\n## ', afterHeading);
  const end = next === -1 ? changelog.length : next + 1;
  return {body: changelog.slice(afterHeading, end).trim(), start: match.index, end};
}

/** The `## [Unreleased]` section. */
export function readUnreleased(changelog) {
  return readSection(changelog, /^## \[Unreleased\]$/m);
}

/** The `## [1.2.3] - 2026-01-01` section for one released version. */
export function readRelease(changelog, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return readSection(changelog, new RegExp(`^## \\[${escaped}\\].*$`, 'm'));
}
