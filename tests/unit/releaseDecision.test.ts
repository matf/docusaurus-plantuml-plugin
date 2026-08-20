import {describe, expect, it} from 'vitest';

// @ts-expect-error -- plain ESM helper shared by the release scripts, deliberately untyped.
import {applyBump, decideRelease} from '../../scripts/lib/release-decision.mjs';

/**
 * This decides the semver of everything this project publishes, so the cases that would publish
 * the *wrong* number are pinned here rather than discovered after the fact.
 *
 * The awkward one is prose: this project's own changelog documents these rules, quoting
 * `### Removed` and `BREAKING` inline. An early version read its own documentation as a directive
 * and proposed a major for a patch-sized change.
 */

const dependencySubjects = [
  'Bump the all group with 4 updates (#31)',
  'Bump @types/node from 26.1.2 to 26.2.0',
];

describe('decideRelease', () => {
  it('cuts a minor when the unreleased section adds something', () => {
    expect(decideRelease('### Added\n\n- A new option.', []).bump).toBe('minor');
  });

  it('cuts a major when the unreleased section removes something', () => {
    expect(decideRelease('### Removed\n\n- The old option.', []).bump).toBe('major');
  });

  it('cuts a major for a BREAKING marker that opens a line or a bullet', () => {
    expect(decideRelease('### Changed\n\n- BREAKING: renamed the option.', []).bump).toBe('major');
    expect(decideRelease('BREAKING CHANGE: the theme path moved.', []).bump).toBe('major');
    expect(decideRelease('### Changed\n\n- **BREAKING**: dropped Node 18.', []).bump).toBe('major');
  });

  it('cuts a patch for prose that merely mentions the trigger words', () => {
    const body = [
      '### Changed',
      '',
      '- The release workflow reads `## [Unreleased]` to pick the level: `### Removed` or',
      '  `BREAKING` cuts a major, `### Added` a minor, anything else a patch.',
    ].join('\n');
    expect(decideRelease(body, []).bump).toBe('patch');
  });

  it('cuts a patch for a fix', () => {
    expect(decideRelease('### Fixed\n\n- A crash.', []).bump).toBe('patch');
  });

  it('takes the highest level when a section both adds and removes', () => {
    const body = '### Added\n\n- A thing.\n\n### Removed\n\n- Another thing.';
    expect(decideRelease(body, []).bump).toBe('major');
  });

  it('cuts a patch from the log when only dependencies moved', () => {
    const decision = decideRelease('', dependencySubjects);
    expect(decision.bump).toBe('patch');
    expect(decision.notes).toBe(
      ['### Changed', '', ...dependencySubjects.map((s) => `- ${s}`)].join('\n'),
    );
  });

  it('recognises the conventional-commit spellings of a dependency bump', () => {
    const subjects = ['build(deps): bump vitest', 'chore(deps-dev): bump prettier'];
    expect(decideRelease('', subjects).bump).toBe('patch');
  });

  it('releases nothing when a human landed something without a changelog entry', () => {
    const decision = decideRelease('', ['Bump the all group with 2 updates', 'Fix the zoom drift']);
    expect(decision.bump).toBeNull();
    expect(decision.reason).toContain('not all dependency updates');
  });

  it('releases nothing when there is nothing new', () => {
    expect(decideRelease('', []).bump).toBeNull();
  });

  it('prefers the changelog over the log', () => {
    // A dependency-only log would say patch; an `### Added` entry beside it still wins.
    expect(decideRelease('### Added\n\n- A thing.', dependencySubjects).bump).toBe('minor');
  });
});

describe('applyBump', () => {
  it('moves the right part of the version and zeroes what follows', () => {
    expect(applyBump('1.5.0', 'patch')).toBe('1.5.1');
    expect(applyBump('1.5.3', 'minor')).toBe('1.6.0');
    expect(applyBump('1.5.3', 'major')).toBe('2.0.0');
    expect(applyBump('0.9.9', 'major')).toBe('1.0.0');
  });

  it('refuses a version it cannot reason about', () => {
    expect(() => applyBump('1.2.3-beta.1', 'patch')).toThrow(/not a release version/);
  });
});
