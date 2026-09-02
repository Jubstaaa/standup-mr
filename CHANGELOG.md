# Changelog

All notable changes to standup-mr are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1] - 2026-09-02

### Changed

- `get_standup_data` documents itself properly. The description now gives the
  shape of the object it returns, says the tool is a snapshot rather than a
  search API and what that rules out, and spells out failure behaviour: a
  rejected token, a refused resource or a rate limit surfaces the host's own
  message after two retries on transient errors, and a blocker whose
  diagnosis could not be fetched still comes back with `job: "unknown"`. The
  parameter descriptions gained the interactions the schema cannot express —
  `host` is required for GitLab and optional for GitHub, a recognisable host
  settles `provider` on its own, and `lang` relabels dates without
  translating anything.

## [0.4.0] - 2026-09-01

### Added

- **The MCP tool takes arguments.** `get_standup_data` exposed an empty input
  schema, so an MCP client could not pick a provider, point at a self-hosted
  host, or ask for Turkish date labels — all of which the CLI has always
  allowed. `provider` (`github` / `gitlab`), `host` and `lang` (`en` / `tr`)
  are now declared options, each with a description. The two enums replace
  free strings, so an unsupported language is rejected instead of silently
  falling back to English.

  No token argument, deliberately: credentials come from the environment or a
  logged-in `gh` / `glab` session, and a tool argument would end up in the
  transcript.

### Changed

- `zod` is a direct dependency rather than one borrowed from the MCP SDK's
  dependency tree.

## [0.3.3] - 2026-09-01

### Fixed

- The MCP server announced itself as version 0.3.0 in the `initialize`
  handshake while the package was already 0.3.2, so every client listed a
  version that had not shipped for two releases. The version is now read from
  `package.json` at runtime and cannot drift again — the handshake test
  asserts the two match.

### Added

- `glama.json` and a Glama score badge in the README.

## [0.3.2] - 2026-09-01

Metadata only — no functional change, and nothing to do if you are already on
0.3.1.

### Added

- A project icon (`assets/`), referenced from `server.json` so the MCP
  Registry and directories can show it. SVG plus 512x512 and 400x400 PNGs.

### Fixed

- The release workflow no longer fails when the version being tagged is
  already on npm; the publish step checks first and exits cleanly.

## [0.3.1] - 2026-09-01

### Fixed

- One flaky sub-request no longer costs the whole note. A run fans out to
  several requests per merge request — pull detail, check runs, reviews, and
  for a red pipeline the run, the job and its log — and any one of them
  returning a 502 aborted the entire standup. Server errors (5xx) and dropped
  connections are now retried twice with a short backoff before giving up. When
  the retries run out the error is raised exactly as before: nothing is
  swallowed. A rejected token (401), a refused resource (403), a rate limit
  (429) and a missing resource (404) are not retried, because retrying them is
  never the right answer.
- A blocker whose diagnosis could not be fetched is now reported as a blocker
  with `job: "unknown"` and an error line reading
  `diagnosis unavailable: <reason>`, instead of failing the run. The merge
  request is genuinely blocked either way, and the log fetch already degraded
  this way; the metadata calls around it now match. **A 401 is never degraded**
  — a revoked or invalid token still fails loudly, which is the whole reason
  these calls throw in the first place.

### Added

- `mcpName` in `package.json`, for publication to the official MCP Registry.

## [0.3.0] - 2026-09-01

### Added

- `standup mcp` — starts the stdio MCP server directly from the CLI, so
  `npx -y standup-mr mcp` works without a local clone.
- `standup instructions` — prints the note-writing playbook (the standup
  skill body, minus its YAML frontmatter) to stdout, for teaching a
  non-Claude assistant the same rules, e.g.
  `npx standup-mr instructions >> AGENTS.md`.
- README section for using the MCP server from Cursor, Codex, or another
  assistant.

### Fixed

- The skill wrote the note in English even when the user was speaking Turkish.
  The language rule was buried as a clause inside a sentence about section
  structure, and `fetch` was called with no `--lang`, so every date label in
  the JSON came back English and outweighed it. The rule is now a standalone,
  unmissable line, and the skill passes `--lang` to match the user's language
  so the payload reinforces the note instead of fighting it.
- On a machine where both `gh` and `glab` are authenticated, every run failed
  once before succeeding: the skill called `fetch` with no `--provider`, hit
  the "both authenticated" error, then retried with the flag. The skill now
  passes `--provider` on the first call whenever it's known, and only asks the
  user (instead of guessing) when it genuinely isn't.

Nothing breaking. `@modelcontextprotocol/sdk` moves from a dev dependency to
a regular dependency, since the CLI can now start the MCP server itself; the
CLI's `fetch`/`post`/`instructions` path still pulls nothing.

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
