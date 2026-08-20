/**
 * Decides what release a merge into `main` warrants, from the changelog and the git log.
 *
 * Kept apart from `next-release.mjs` so the decision can be tested without a git repository, a
 * checkout or a network. Getting this wrong publishes the wrong semver to everyone.
 */

/**
 * Squash-merged Dependabot subjects, plus the conventional-commit spellings other tools emit.
 * @type {RegExp}
 */
export const DEPENDENCY_SUBJECT = /^(?:Bump |build\(deps|chore\(deps|Update .* requirement)/;

/**
 * `BREAKING` only counts when it *opens* a line or a bullet — the Keep a Changelog and
 * conventional-commit spelling of a breaking change. Prose that merely mentions the word (this
 * project's own changelog documents these very rules) must not cut a major by accident.
 * @type {RegExp}
 */
const BREAKING_MARKER = /^[ \t]*(?:[-*][ \t]*)?\**BREAKING(?:[ \t]+CHANGE)?\**[ \t]*:/im;

/**
 * `### Removed` and `### Added` count only as real headings, never inline in backticks.
 */
const REMOVED_HEADING = /^###[ \t]+Removed[ \t]*$/m;
const ADDED_HEADING = /^###[ \t]+Added[ \t]*$/m;

/**
 * @typedef {{bump: 'major' | 'minor' | 'patch' | null, reason: string, notes?: string}} Decision
 */

/**
 * @param {string} unreleasedBody trimmed body of the `## [Unreleased]` section
 * @param {string[]} subjects commit subjects since the last tag, newest first, merges excluded
 * @returns {Decision}
 */
export function decideRelease(unreleasedBody, subjects) {
  if (unreleasedBody) {
    if (REMOVED_HEADING.test(unreleasedBody) || BREAKING_MARKER.test(unreleasedBody)) {
      return {
        bump: 'major',
        reason: 'the [Unreleased] section removes something',
        notes: unreleasedBody,
      };
    }
    if (ADDED_HEADING.test(unreleasedBody)) {
      return {
        bump: 'minor',
        reason: 'the [Unreleased] section adds something',
        notes: unreleasedBody,
      };
    }
    return {
      bump: 'patch',
      reason: 'the [Unreleased] section describes a fix or a change',
      notes: unreleasedBody,
    };
  }

  const relevant = subjects.filter(Boolean);
  if (relevant.length === 0) {
    return {bump: null, reason: 'there is nothing new since the last tag'};
  }
  if (relevant.every((subject) => DEPENDENCY_SUBJECT.test(subject))) {
    return {
      bump: 'patch',
      reason: 'every commit since the last tag is a dependency update',
      notes: ['### Changed', '', ...relevant.map((subject) => `- ${subject}`)].join('\n'),
    };
  }
  return {
    bump: null,
    reason:
      'the [Unreleased] section is empty and the commits since the last tag are not all dependency updates',
  };
}

/**
 * @param {string} current a released `x.y.z`
 * @param {'major' | 'minor' | 'patch'} bump
 * @returns {string}
 */
export function applyBump(current, bump) {
  const [major, minor, patch] = current.split('.').map(Number);
  if ([major, minor, patch].some((part) => !Number.isInteger(part))) {
    throw new Error(`"${current}" is not a release version.`);
  }
  return {
    major: `${major + 1}.0.0`,
    minor: `${major}.${minor + 1}.0`,
    patch: `${major}.${minor}.${patch + 1}`,
  }[bump];
}
