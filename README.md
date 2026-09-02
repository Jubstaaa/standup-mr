# standup-mr

[![standup-mr MCP server](https://glama.ai/mcp/servers/Jubstaaa/standup-mr/badges/score.svg)](https://glama.ai/mcp/servers/Jubstaaa/standup-mr)
[![Listed on mcpservers.org](https://mcpservers.org/badge.svg)](https://mcpservers.org/servers/jubstaaa/standup-mr)

Standup notes from **merge request state**, not commit logs.

Most standup tools read your local `git log`. That answers "what did I type",
which is not what anyone asks in a standup. This one reads GitLab or GitHub:
what is ready to merge, what is blocked, what is waiting on you — and when a
pipeline is red, it opens the job log and tells you **why**.

## What makes it different

|                                               | commit-log tools | standup-mr                                            |
| --------------------------------------------- | ---------------- | ----------------------------------------------------- |
| Source                                        | local `git log`  | GitLab or GitHub API                                  |
| Merge request state                           | ✗                | ready / blocked / draft / stale                       |
| Review queue                                  | ✗                | pending only, approvals filtered out                  |
| Failed pipeline                               | ✗                | error lines from the job trace or the Actions job log |
| Self-hosted (GitLab CE/EE, GitHub Enterprise) | varies           | first class                                           |

## Use

```bash
npx standup-mr fetch                            # JSON, provider auto-detected
npx standup-mr fetch --provider github          # GitHub
npx standup-mr fetch --provider gitlab          # GitLab
npx standup-mr fetch --markdown                 # structured digest
npx standup-mr fetch --lang tr                  # Turkish date labels
```

```bash
npx standup-mr fetch --markdown | npx standup-mr post --google-chat "$URL"
```

### Identity

|             | GitHub                                      | GitLab                                                  |
| ----------- | ------------------------------------------- | ------------------------------------------------------- |
| Flags       | `--host` / `--token`                        | `--host` / `--token`                                    |
| Env         | `GITHUB_HOST` / `GITHUB_TOKEN`              | `GITLAB_HOST` / `GITLAB_TOKEN`                          |
| CLI session | [`gh`](https://cli.github.com/) auth config | [`glab`](https://gitlab.com/gitlab-org/cli) auth config |

GitHub defaults to `github.com` when no host is given. GitLab has no default —
self-hosted is the norm there, so a host must come from a flag, env var, or
`glab`'s own config.

The provider itself is picked in this order:

1. `--provider github` / `--provider gitlab`, if passed
2. a recognizable `--host` (`github.com`, `gitlab.com`, or a hostname
   containing `github`/`gitlab`)
3. `STANDUP_PROVIDER`, or whichever of the `GITHUB_*` / `GITLAB_*` env pairs
   is set
4. whichever of `gh` / `glab` is logged in

If none of these resolve — or both do, ambiguously — the command fails with a
clear error instead of guessing.

So if you already use `gh` or `glab`, there is nothing to configure.

### Post it to chat

```bash
npx standup-mr fetch --markdown | npx standup-mr post --slack "$SLACK_WEBHOOK_URL"
```

## The three surfaces

**CLI** — the core. Emits JSON; zero runtime dependencies.

**MCP server** (`mcp/`) — one tool, `get_standup_data`, for Claude Desktop,
Cursor, or any MCP client. See [`mcp/README.md`](mcp/README.md).

**Claude Code plugin** — the note-writing playbook, shipped as the `standup`
skill. From inside Claude Code:

```
/plugin marketplace add Jubstaaa/standup-mr
/plugin install standup@standup-mr
```

Then type `/standup`. Updates come with `/plugin marketplace update standup-mr`.

### Using it from Cursor, Codex, or another assistant

If you're not using Claude Code, wire up the MCP server for live data and
paste in the note-writing rules separately.

**Cursor** — add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json`
(project-local):

```json
{
    "mcpServers": {
        "standup": {
            "command": "npx",
            "args": ["-y", "standup-mr", "mcp"],
            "env": {
                "GITHUB_TOKEN": "ghp_..."
            }
        }
    }
}
```

**Codex** — add to `~/.codex/config.toml`:

```toml
[mcp_servers.standup]
command = "npx"
args = ["-y", "standup-mr", "mcp"]

[mcp_servers.standup.env]
GITHUB_TOKEN = "ghp_..."
```

The exact config key and file path are version-dependent for both clients —
if a snippet above doesn't work, check [Cursor's MCP
docs](https://docs.cursor.com/context/mcp) or Codex's own config
documentation for the current format rather than trusting this file blindly.

The server exposes three tools:

| Tool                    | What it does                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `get_standup_data`      | Reads the provider and returns the report as JSON. Optional `provider`, `host`, `lang`.      |
| `get_note_instructions` | Returns the note-writing rules, so the assistant can write the note the way the skill would. |
| `post_standup_note`     | Posts a finished note to a Slack, Discord or Google Chat webhook.                            |

`post_standup_note` reads the webhook URL from `STANDUP_WEBHOOK_URL` and never
takes it as an argument — anyone holding that URL can post to the channel, so
it belongs with the tokens, not in a transcript. The payload shape is inferred
from the URL host; `kind` is only needed when a proxy hides it.

Three shapes are implemented: `slack` and `google-chat` both post `{"text"}`,
`discord` posts `{"content"}`.

Slack and Google Chat do not render standard Markdown, so the note is rewritten
on the way out: `**bold**` becomes `*bold*` and a `##` heading becomes a bold
line. Inline code, fenced blocks and their contents are left alone. Discord
speaks Markdown natively and is sent untouched. Anything else that accepts a Slack-shaped body —
Mattermost, Rocket.Chat, an n8n or Zapier endpoint — works today by passing
`kind: "slack"`, or `--slack URL` on the CLI.

Outside MCP, the same rules are available on stdout:

```bash
npx standup-mr instructions >> AGENTS.md
```

## `--markdown` is a digest, not a written note

`--markdown` organizes the raw material into readable sections. It does **not**
group events into themes or diagnose blockers — that is the model's work, and it
lives in the MCP client's prompt or in the Claude Code skill.

- Without AI: a structured digest.
- With AI: a note you can read out.

## What the digest looks like

Anonymised output from a real Monday run — note that Friday and Saturday each
get their own section, and that a merge request GitLab has not evaluated is not
called ready:

```markdown
# Monday, 31 August — dev

_Structured digest — not a written note._

## Previous working day: Friday, 28 August

- `acme/ui` pushed to — fix(keyboard): scale keys to viewport (4 commits)
- `acme/ui` accepted — chore(deps): bump @acme/ui to 0.5.18
- `acme/api` opened — feat: package subscription sales

## Previous working day: Saturday, 29 August

- `acme/ui` pushed to — fix(keyboard): close the autofill bar (1 commit)

## Ready to merge (2)

- `acme/api` !196 fix: normalise the +90 trunk prefix
- `acme/web` !194 refactor: loading state — **no pipeline ran**

## Blocked (1)

- `acme/terminal` !49 fix: relative date chips — **1 unresolved comment(s)**

## Reviews (2 pending)

- `acme/mobile` !501 chore: upgrade to RN 0.87 — Teammate

## Blockers

- `acme/mobile` !6 — job `quality`
    - `npm ERR! code E404`
    - `npm ERR! 404 Not Found - GET https://registry.example.com/@acme%2fui`
```

The last section is the point of the tool. Every other standup tool can tell you
that pipeline is red; this one opens the failed job's log and shows you the
404 — and a 404 rather than a 403 usually means the token's scope is wrong, not
that the package is missing.

## Known limits

- **GitHub's events feed is shallow.** It is capped at roughly 300 events over
  the last 90 days, so a very active account or an old gap can silently lose
  the earliest events. GitLab has no comparable documented cap.
- **GitHub activity is only visible to a token belonging to that same
  account**, and private-repository events do not show up for anyone else's
  token, even with otherwise sufficient scopes.
- **On GitHub, CI that reports only through the legacy commit-statuses API**
  — still how some vendors integrate — shows up as `pipelineMissing`. Check
  state is read from check-runs only.
- **A blocker whose diagnosis could not be fetched is still reported**, as
  `job: "unknown"` with a `diagnosis unavailable: …` error line. The merge
  request is blocked either way; only the explanation is missing. Server
  errors are retried twice first, and a rejected token still fails the run.

## Upgrading from 0.1.x

0.2.0 changes the JSON output, the library API, and the MCP options. If you
pipe `standup fetch` into anything, or import the package, read
[`CHANGELOG.md`](CHANGELOG.md) before upgrading. The short version:

- `previous` and `previousEvents` are replaced by `previousDays[]`, one entry
  per active day, so a weekend no longer swallows Friday. `jq .previous` now
  returns `null` with no error.
- `MergeRequest`, `Review` and `Blocker` carry a required `provider` field, and
  `Provider.getReviews` takes an `Identity` rather than a numeric id.
- The MCP `CollectOptions.provider` is now a provider _name_; inject a
  `Provider` instance through `providerImpl`.

Claude Code plugin users should run `/plugin marketplace update standup-mr` —
the `standup` skill changed along with the report shape.

## Requirements

Node 20 or newer. The CLI core (`fetch`, `post`, `instructions`) pulls no
runtime dependencies. The MCP server (`mcp` command) brings one:
`@modelcontextprotocol/sdk`.

## License

MIT
