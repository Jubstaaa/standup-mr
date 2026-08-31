# Changelog

All notable changes to standup-mr are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-08-31

### Fixed

- A pull request whose CI timed out was reported as ready to merge. GitHub
  reports a timed-out job with the conclusion `cancelled`, not `timed_out`, so
  it normalised to a `canceled` pipeline — and a canceled pipeline was treated
  as a green light. A canceled pipeline now blocks, on both providers: GitLab's
  `canceled` status took the same path.
- Every error line in a GitHub blocker was reported twice. GitHub Actions echoes
  a step's script inside a `##[group]Run …` block before running it, and those
  echoed lines matched the error patterns. The body of a `Run` group is now
  suppressed; other groups are still scanned, since they carry real output.

Both were found by testing 0.2.0 against the real GitHub Actions API — neither
was reachable from the test fixtures.

## [0.2.0] - 2026-08-31

GitHub joins GitLab as a first-class provider, and the previous-day report
stops throwing work away. Both changes break existing shapes — read the
migration notes before upgrading.

### Added

- **GitHub provider.** Pull requests, review requests, activity events, and
  blockers, on `github.com` and on GitHub Enterprise (`/api/v3`). When CI is
  red the failed Actions job's log is opened and its error lines reported, with
  a fall back to a non-Actions check run's summary.
- **Provider selection.** `--provider github` / `--provider gitlab`, the
  `STANDUP_PROVIDER` environment variable, host-name recognition, and a fall
  back to whichever of `gh` / `glab` is logged in. Ambiguity fails with a clear
  error rather than a guess.
- `provider` on the report and on every merge request, review, and blocker, so
  a consumer can pick the right vocabulary (`!123` vs `#123`).

### Changed

- **BREAKING — JSON output: `previous` and `previousEvents` are gone,**
  replaced by `previousDays[]`. Each entry carries `date`, `label`, `gapDays`,
  and its own `events`. The old single-day shape reported only the most recent
  active day, so a Saturday with any activity at all silently discarded the
  whole of Friday's work — which is exactly the day a Monday standup is about.
  Anyone piping `standup fetch | jq .previous` now gets `null` with no error;
  read `.previousDays` instead, and write up every entry.
- **BREAKING — library API:**
  - `Provider.getReviews(identity, today)` takes an `Identity` object where it
    previously took a numeric user id. GitHub searches by login, GitLab by
    numeric id, so the contract has to carry both.
  - `MergeRequest`, `Review` and `Blocker` each gained a **required**
    `provider` field.
  - `getJson` now **throws** an `ApiError` on an authentication or rate-limit
    failure where it previously returned `null`. `null` is reserved for exactly
    one case: a 404. Previously an invalid token produced an empty standup note
    that looked like a quiet day.
- **BREAKING — MCP:** `CollectOptions.provider` changed meaning. It is now a
  provider *name* (`'github'` / `'gitlab'`); the injection point for a
  `Provider` instance is the new `CollectOptions.providerImpl`.
- The `standup` skill (`skills/standup/SKILL.md`) changed incompatibly with
  0.1.x: it reads `previousDays` and carries provider-specific vocabulary
  rules. Run `/plugin marketplace update standup-mr` after upgrading.

### Fixed

- A red pipeline whose Actions run or job **timed out** (or hit
  `startup_failure` / `action_required`) now reaches the job log instead of
  degrading silently to the check-run summary.
- An Actions blocker with no error lines no longer suppresses the check-run
  fallback that held the real reason.
- GitHub's **secondary** rate limit (403 with `retry-after` and a non-zero
  remaining count) is reported as a rate limit with the retry delay, not as a
  missing-permissions error.
- An ambient `GITHUB_TOKEN` — exported by dotfiles and CI everywhere — no
  longer hard-errors a working GitLab setup. When both environment pairs are
  present, the pair that names a `*_HOST` wins.
- `getEvents` stops paging at GitHub's documented ~300-event feed cap instead
  of requesting a page beyond it.
- An unreachable job log degrades to "no error lines" rather than failing the
  whole run.

## [0.1.2] - 2026-08-28

- Initial published line: GitLab merge requests, buckets, review queue, and
  failed-pipeline diagnosis from the job trace. CLI, MCP server, and Claude
  Code skill.

[0.2.0]: https://github.com/Jubstaaa/standup-mr/releases/tag/v0.2.0
[0.1.2]: https://github.com/Jubstaaa/standup-mr/releases/tag/v0.1.2
