# standup-mr

Standup notes from **merge request state**, not commit logs.

Most standup tools read your local `git log`. That answers "what did I type",
which is not what anyone asks in a standup. This one reads GitLab or GitHub:
what is ready to merge, what is blocked, what is waiting on you — and when a
pipeline is red, it opens the job log and tells you **why**.

## What makes it different

|  | commit-log tools | standup-mr |
|---|---|---|
| Source | local `git log` | GitLab or GitHub API |
| Merge request state | ✗ | ready / blocked / draft / stale |
| Review queue | ✗ | pending only, approvals filtered out |
| Failed pipeline | ✗ | error lines from the job trace or the Actions job log |
| Self-hosted (GitLab CE/EE, GitHub Enterprise) | varies | first class |

## Use

```bash
npx standup-mr fetch                            # JSON, provider auto-detected
npx standup-mr fetch --provider github          # GitHub
npx standup-mr fetch --provider gitlab          # GitLab
npx standup-mr fetch --markdown                 # structured digest
npx standup-mr fetch --lang tr                  # Turkish date labels
```

### Identity

| | GitHub | GitLab |
|---|---|---|
| Flags | `--host` / `--token` | `--host` / `--token` |
| Env | `GITHUB_HOST` / `GITHUB_TOKEN` | `GITLAB_HOST` / `GITLAB_TOKEN` |
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

## `--markdown` is a digest, not a written note

`--markdown` organizes the raw material into readable sections. It does **not**
group events into themes or diagnose blockers — that is the model's work, and it
lives in the MCP client's prompt or in the Claude Code skill.

- Without AI: a structured digest.
- With AI: a note you can read out.

## Known limits

- **GitHub's events feed is shallow.** It is capped at roughly 300 events over
  the last 90 days, so a very active account or an old gap can silently lose
  the earliest events. GitLab's API has no such cap.
- **GitHub activity is only visible to a token belonging to that same
  account**, and private-repository events do not show up for anyone else's
  token, even with otherwise sufficient scopes.

## Requirements

Node 20 or newer. No runtime dependencies.

## License

MIT
