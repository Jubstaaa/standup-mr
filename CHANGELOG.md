# Changelog

All notable changes to standup-mr are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The report gains a field, so the next release is a minor version.

### Added

- **`warnings` on the report.** The JSON from `standup fetch` and the
  `get_standup_data` tool carries `warnings: string[]`: things the report could
  not see, such as an empty or private GitHub events feed. The CLI also prints
  each one to stderr as `Warning: …`. Providers can supply them through an
  optional `warnings()` method.

### Changed

- **Long job logs keep their last 2 MiB** and start with
  `[log truncated to its last 2 MiB]`, instead of being read whole.
- **A JSON answer over 8 MiB is refused** with an error naming the API path,
  instead of being buffered whole.
- **A body that is not JSON is named as such**: "answered <path> with something
  that is not JSON (content-type …)", where it used to read as "Could not reach
  <host>".
- **GitLab events and merge requests are dated on your local wall clock**, as
  GitHub's already were. An event near midnight can move to the neighbouring
  day.
- **A `gh` or `glab` that times out or crashes raises a configuration error**
  naming the CLI, instead of reading as "no token".
- Per-item API requests (diagnoses, merge request details) run at most four at
  a time.
- **Hosted server: only a refused login asks you to reconnect.** A refresh the
  host answers with `invalid_grant` asks for a reconnect; a network or
  database error says to try again in a few minutes; a rejected sign-in app
  (`invalid_client`, `unauthorized_client`) says the operator has to fix it.
  A renewal that cannot be saved after the old refresh token was spent asks
  for a reconnect instead of being reported as temporary.
- **Hosted server: long job logs keep their tail** instead of failing past
  10 MiB. Host responses are streamed, and at most four bodies download at
  once across the whole server.
- **Hosted server: scheduled digests say what they could not read.** A run
  that reads some accounts but not all posts what it read plus a fixed line
  for each account that failed, and is recorded as a warning. A run missed by
  more than the catch-up limit is recorded as the schedule's last error
  instead of being skipped silently.
- **Hosted server: connect page messages come from a fixed table of codes.**
  The host's own `error_description` is no longer shown, and a failed sign-in
  no longer looks like a cancel.

### Fixed

- **A red merge request is never dropped from `blockers`.** When its failure
  cannot be diagnosed, it is still listed with job `unknown` and the reason,
  such as `job log unavailable: HTTP 410` or `no failed job found …`.
- Provider warnings now reach MCP callers, not only the CLI's stderr.
- **Hosted server: two servers overlapping during a deploy cannot post the same
  digest or spend the same refresh token twice.** Schedule runs and token
  refreshes are claimed in the database first (schema migrations 3 and 4 add
  `schedules.last_warning` and `accounts.refresh_claimed_until`; both are
  additive, so a rollback to the previous image keeps working).

### Security

- **Webhook kind inference is an allow-list.** A URL is recognised only when it
  is https, has no credentials or custom port, and starts with a known webhook
  path on hooks.slack.com, chat.googleapis.com or discord.com. A URL that was
  inferred before (http, a custom port, another path) now needs `kind` passed
  explicitly. Webhook redirects are no longer followed.
- **Mentions in a posted note cannot ping anyone.** Discord posts set
  `allowed_mentions: { parse: [] }`, Slack gets `&`, `<` and `>` escaped, and
  Google Chat gets a word joiner after each `<`, so `<!channel>` or
  `<users/all>` in a merge request title stays text.
- **Hosted server: a self-hosted OAuth application belongs to the connection
  that registered it.** It used to be shared by everyone signing in to that
  host, so anyone could register and lock it, and whoever held its secret could
  collect colleagues' tokens. Existing applications stay with the connections
  that already signed in through them; register your own on your next
  connect.
- **Hosted server: dynamic client registration refuses plain `http` redirect
  URIs** other than loopback, and script schemes. A client that registered
  one has to register again over https.
- **Hosted server: the connect cookie is `__Host-`-prefixed**, so a sibling
  subdomain cannot plant one. A connect flow in progress during the deploy
  starts over once.
- **Hosted server: clients are recognised by their exact callback URL**, not by
  host. A custom GPT on chatgpt.com no longer borrows the ChatGPT name on the
  consent page, and the openai.com and cursor.com host entries are gone.
- **Hosted server: every outbound response has a size and time bound.** The
  OAuth token exchange refuses an answer over 10 MiB, and every request has a
  30-second total deadline next to its idle timeout.
- npm releases carry provenance (`npm audit signatures` verifies them) and are
  published only from tags on `main`, from a tarball packed in a job that holds
  no publishing credential.

### Dependencies

- `p-map` is a new runtime dependency, used to cap concurrent API requests.

## [1.1.3] - 2026-11-20

### Changed

- **Node 22 or newer is required** (`engines.node` was `>=20`; Node 20 is past
  end of life).
- **The hosted server asks for sign-in again before anything else.** With
  discovery open, claude.ai detected the server as needing no sign-in and
  skipped OAuth, so new connectors could not call any tool. `initialize`,
  `tools/list` and `prompts/list` need a token again, as before 1.1.2.

### Fixed

- **A host that never answers no longer hangs the CLI or the local MCP
  server.** Every GitHub, GitLab and webhook request gives up after 30
  seconds; server errors are still retried twice.
- **The MCP `host` argument must be a bare host** (`gitlab.example.com`,
  optionally with a port). A scheme, path, credentials, query or fragment is
  refused before any request is made.

### Security

- The hosted server's container runs with a read-only root filesystem, no
  Linux capabilities, `no-new-privileges` and a process cap, from a base image
  pinned by digest.

## [1.1.2] - 2026-11-13

### Changed

- **The hosted server shows what it does before sign-in.** `initialize`,
  `tools/list` and `prompts/list` answer without a token, so directories and
  agents can see the tools before anyone connects. Tool calls and prompts still
  need sign-in, and a bad token is still refused.
- `server.json` carries a title and the hosted server's website.

## [1.1.1] - 2026-10-13

### Fixed

- **The env token is now bound to its host.** `GITHUB_TOKEN` / `GITLAB_TOKEN`
  was returned for any host, so in the stdio MCP server a tool call with a
  made-up host could send your token to it. The env token is now used only for
  `GITHUB_HOST` / `GITLAB_HOST` (default github.com / gitlab.com); any other
  host falls through to a host your CLI is logged into, or errors. Reported as
  MTC-SRC-002.

## [1.1.0] - 2026-10-12

### Added

- **A compact chat digest for scheduled posts.** Scheduled and test posts now
  send `toChatDigest` instead of the full Markdown report: one line per piece
  of work from the last active day (repeated pushes collapsed, merges marked,
  branch-deletion and merge-commit noise dropped), ready MRs grouped by
  project, the reason each blocked MR is stuck, and a one-line count of
  drafts, stale MRs and waiting reviews. The CLI's `--markdown` output is
  unchanged.

- **Scheduled posting on the hosted connector.** Once a webhook is saved, the
  connect page can post the digest automatically at a chosen time, time zone
  and weekdays, with one section per linked account, and send a test right
  away. A run missed by more than 30 minutes while the server was down is
  skipped rather than posted late.

- **A `standup` prompt.** Clients that show MCP prompts offer it as a one-click
  command — `/standup` in Claude Code — that writes the note, optionally for a
  named account.

- **Gemini CLI extension.** `gemini extensions install
  https://github.com/Jubstaaa/standup-mr` adds the hosted connector to Gemini
  CLI, with a context file that tells it how to use the tools.
- The README shows how to add the hosted connector to Claude Code, Cursor,
  VS Code, Gemini CLI, Codex CLI and ChatGPT, with one-click install buttons
  for Cursor and VS Code.

## [1.0.1] - 2026-10-12

### Fixed

- GitLab merge requests take their pipeline from `head_pipeline`, the one
  GitLab shows on the MR. The `/pipelines` list is not ordered newest first,
  so a merge request could be reported blocked by a stale red pipeline from an
  earlier commit, and the current failure's log was never read.
- Error lines from GitLab's timestamped job logs no longer start with the
  stream marker (`01O`, `00E+`) that follows each timestamp.

### Added

- Every MCP tool declares a human-readable `title`, which clients show in
  their tool lists and permission prompts.

## [1.0.0] - 2026-10-12

First stable release. From here on the CLI commands and flags, the JSON that
`fetch` and `get_standup_data` return, the MCP tool names and arguments, and
the environment variables follow semantic versioning: anything that would
break an existing setup waits for 2.0.

### Added

- **Remote MCP server for claude.ai.** Add
  `https://standup.ilkerbalcilar.com/mcp` as a custom connector, sign in with
  GitHub or gitlab.com — or paste a token for a self-hosted host — and use
  standup-mr from claude.ai on the web and on mobile, with no environment
  variables. One connector can hold several accounts and an optional chat
  webhook. The server lives in `remote/` and is not part of the npm package.
- **Sign in to your company's GitLab or GitHub Enterprise.** On the connect
  page, type the host: if someone there already set up sign-in, use it;
  otherwise register an OAuth application once, following the exact redirect
  URI and scopes the page shows, and everyone at that host can sign in from
  then on.
- `server.json` lists the remote endpoint, so registries show both the npm
  package and the hosted server.
- Both servers declare the project icon in `serverInfo.icons`.

### Fixed

- GitLab requests send the token as `Authorization: Bearer` instead of
  `PRIVATE-TOKEN`. Personal access tokens work either way, but OAuth tokens —
  from `glab`'s browser login or from the remote server's sign-in — were
  rejected with 401.

## [0.7.0] - 2026-10-10

### Added

- **Tool annotations.** Every MCP tool now declares `readOnlyHint`,
  `destructiveHint`, `idempotentHint` and `openWorldHint`, so a host can tell
  the read-only `get_standup_data` and `get_note_instructions` apart from
  `post_standup_note`, which sends a message other people will see, and warn
  before invoking it.

### Changed

- The MCP server registers its tools with `registerTool`, which needs
  `@modelcontextprotocol/sdk` 1.30.0 or later.

## [0.6.1] - 2026-09-02

### Fixed

- A note posted to Google Chat or Slack arrived with its formatting showing:
  `**bold**` as literal asterisks, `## Dün` as a literal heading marker.
  Neither renders standard Markdown — both use a single asterisk for bold and
  have no headings — while the note is Markdown throughout. Bold is now
  converted and headings become bold lines for those two. Discord speaks
  Markdown natively and is sent untouched, and fenced blocks pass through
  verbatim so a code sample keeps its asterisks.

## [0.6.0] - 2026-09-02

### Added

- **Google Chat webhooks.** `--google-chat URL` on the CLI, `kind:
  "google-chat"` in `post_standup_note`, and `chat.googleapis.com` added to
  host inference so neither is usually needed. Google Chat takes the same
  `{"text"}` body as Slack, so this was only ever a naming gap — but telling
  someone to pass `--slack` for a Google Chat webhook is a hack, not a
  feature.

  Anything else that accepts a Slack-shaped body — Mattermost, Rocket.Chat, an
  n8n or Zapier endpoint — already works by passing the slack kind.

### Changed

- `standup post` builds its flags and its error message from the list of
  implemented channels instead of a hand-written pair, so adding a channel is
  one map entry. The MCP tool's `kind` enum is now tested against that same
  list: a channel can no longer reach the CLI and quietly miss MCP.

## [0.5.0] - 2026-09-02

### Added

- **`post_standup_note`** — posts a finished note to a Slack or Discord
  webhook, so an MCP client can deliver the note it just wrote instead of
  handing it back as text. The webhook URL comes from `STANDUP_WEBHOOK_URL`
  and is never a tool argument: anyone holding that URL can post to the
  channel, which makes it a credential. The payload shape is inferred from the
  URL host, so `kind` is only needed when a proxy hides it. A missing URL, an
  unrecognisable host, or a webhook that rejects the message is reported as an
  error — a note is never announced as sent when it was not — and the error
  text never repeats the URL.
- **`get_note_instructions`** — returns the note-writing rules the Claude Code
  skill carries, so a non-Claude assistant can write the note the same way
  instead of inventing a format. Same content as `standup instructions`.

Both were already in the CLI. Only the MCP server was missing them.

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
