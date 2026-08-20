# ADR 0006 — Derive the release version from the changelog, and push it with a GitHub App token

- Status: accepted
- Date: 2026
- Affects: `.github/workflows/release.yml`, `.github/workflows/dependabot-auto-merge.yml`,
  `.github/workflows/ci.yml`, `.github/workflows/publish.yml`, `.github/dependabot.yml`,
  `scripts/next-release.mjs`, `scripts/changelog-notes.mjs`, `scripts/lib/changelog.mjs`,
  `scripts/sync-project-metadata.mjs`

## Context

Dependency updates were merged by hand and releases were cut from a local checkout:

```bash
npm version 1.2.3          # commit + tag, locally
git push --follow-tags
```

Turning on Dependabot auto-merge breaks that, and not subtly. `npm version` creates the commit
**and** the tag before anything is pushed. If a Dependabot pull request lands in between, the push
is rejected as a non-fast-forward. The natural recovery — pull, rebase, push again — moves the
commit but **not** the tag, which still points at the pre-rebase commit. `publish.yml` then builds
and publishes that orphaned tree. `scripts/verify-tag-version.mjs` does not catch it: the tag and
`package.json` agree perfectly, because they came from the same discarded commit. The published
tarball simply is not what is on `main`, and nothing says so.

Three smaller problems sat alongside it:

- The branch ruleset required four status-check contexts out of nine. `Format, lint and types`,
  `Build and verify package contents` and the three Docusaurus compatibility jobs were not
  required, so an auto-merge could land with any of them red.
- `strict_required_status_checks_policy` was off, so two pull requests each green against an older
  `main` could combine into a `main` that was never tested in that combination.
- Nothing checked that `package-lock.json`'s `version` matched `package.json`. Commit `c9f795d`
  fixed exactly that drift by hand.

## Decision

**The version comes from `CHANGELOG.md`.** `## [Unreleased]` containing `### Removed` or the word
`BREAKING` cuts a major, `### Added` a minor, anything else a patch, and an empty section cuts
nothing. A merge whose commits are all dependency bumps cuts a patch and has its entry written from
the commit subjects.

The alternative was conventional commits. It was rejected because this project already requires
every pull request to describe itself under `[Unreleased]` in Keep a Changelog's vocabulary — the
`Added` / `Fixed` / `Removed` distinction _is_ the semver distinction, written by a human who knew
what they changed. Conventional-commit subjects would be a second encoding of the same fact, free
to diverge from the first, with the changelog still needing to be written by hand anyway. Deriving
from the changelog also means the release notes and the version can never disagree: they are read
from the same lines.

The cost is real and accepted: a pull request that forgets its `[Unreleased]` entry releases
nothing. That failure is silent rather than wrong, and `CONTRIBUTING.md` already made the entry
mandatory.

**Releases trigger on CI's completion, not on the push.** `release.yml` runs on
`workflow_run: {workflows: [CI], branches: [main]}` and only when the conclusion is `success`, so
"the tree was green" is a precondition of releasing rather than something discovered afterwards.

**The commit and tag are pushed atomically.** `git push --atomic origin HEAD:main refs/tags/vX.Y.Z`
lands both or neither. If `main` moved underneath, the workflow discards its tag and rebuilds the
release from the new `main`, up to three times, rather than forcing anything. This is the direct
fix for the failure above: there is no window in which a tag exists that `main` does not contain.

**A GitHub App token does the pushing.** This is not a preference. GitHub deliberately does not
trigger workflow runs from events created with `GITHUB_TOKEN`, to stop workflows recursing. Under
that token the chain dies twice over: the auto-merge would not run CI on `main`, so `release.yml`
would never fire; and the tag push would not run `publish.yml`, so nothing would reach npm. An App
installation token is not `GITHUB_TOKEN` and does trigger both. A personal access token would work
equally well and was rejected: it is tied to one person's account, it carries that account's full
reach unless carefully scoped, and it expires on a calendar rather than in an hour.

The App needs `Contents: write` and `Pull requests: write`, and it must be a bypass actor on the
`main` ruleset — the required-status-checks rule blocks direct pushes as well as merges, and the
release commit is a direct push. The safety net for that bypass is `publish.yml`, which re-runs the
entire suite on the tagged tree before `npm publish`.

**One aggregated required check.** `ci-complete` depends on every other CI job and fails unless all
of them succeeded, so the ruleset requires one context instead of nine matrix names. Matrix entries
can be added or removed without editing the ruleset, and a job dropped from the matrix cannot
silently stop being required. Branches must now also be up to date; the `refresh` job in
`dependabot-auto-merge.yml` updates any Dependabot branch that falls behind, so that costs nobody a
manual rebase.

**One Dependabot pull request at a time.** A single group spanning `/` and `/examples/docusaurus`
with `open-pull-requests-limit: 1` means the automation never has to reason about two dependency
pull requests racing into `main`. Majors join the group rather than opening a second pull request,
and are held for review instead of merged.

## Consequences

- The version of a release is decided by whoever writes the changelog entry, at the time they write
  it, in the pull request where the change is reviewed.
- Nothing is released from a laptop. `verify:tag`'s clean-tree check now only ever sees CI's
  checkout.
- `sync:check` gained the `package.json` ↔ `package-lock.json` version assertion, and `sync:meta`
  fixes it. Round-tripping the lockfile through `JSON.parse`/`JSON.stringify(_, null, 2)` is
  byte-identical to what npm writes, so the fix is a two-field edit and not a reformat.
- `dependabot-auto-merge.yml` runs on `pull_request_target`, which is the only trigger that gives a
  Dependabot pull request a writable token. It is safe **only** because no step in it checks out,
  installs or executes anything from the pull request. That constraint is written at the top of the
  file, and it is not negotiable: an `actions/checkout` of `head.sha` there would hand write access
  to whatever a compromised dependency's pull request contained.
