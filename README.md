# standup-mr

Standup notes from **merge request state**, not commit logs.

Most standup tools read your local `git log`. That answers "what did I type",
which is not what anyone asks in a standup. This one reads GitLab: what is ready
to merge, what is blocked, what is waiting on you — and when a pipeline is red,
it opens the job log and tells you **why**.

## What makes it different

|  | commit-log tools | standup-mr |
|---|---|---|
| Source | local `git log` | GitLab API |
| Merge request state | ✗ | ready / blocked / draft / stale |
| Review queue | ✗ | pending only, approvals filtered out |
| Failed pipeline | ✗ | error lines pulled from the job trace |
| Self-hosted GitLab | varies | first class |

## Use

```bash
npx standup-mr fetch                 # JSON
npx standup-mr fetch --markdown      # structured digest
npx standup-mr fetch --lang tr       # Turkish date labels
```

Credentials resolve in this order, independently for host and token:

1. `--host` / `--token`
2. `GITLAB_HOST` / `GITLAB_TOKEN`
3. the local [`glab`](https://gitlab.com/gitlab-org/cli) CLI config

So if you already use `glab`, there is nothing to configure.

### Post it to chat

```bash
npx standup-mr fetch --markdown | npx standup-mr post --slack "$SLACK_WEBHOOK_URL"
```

## The three surfaces

**CLI** — the core. Emits JSON; zero runtime dependencies.

**MCP server** (`mcp/`) — one tool, `get_standup_data`, for Claude Desktop,
Cursor, or any MCP client. See [`mcp/README.md`](mcp/README.md).

**Claude Code skill** (`skill/`) — the note-writing playbook. Copy it in:

```bash
cp -r skill ~/.claude/skills/standup
```

Then type `/standup`.

## `--markdown` is a digest, not a written note

`--markdown` organizes the raw material into readable sections. It does **not**
group events into themes or diagnose blockers — that is the model's work, and it
lives in the MCP client's prompt or in the Claude Code skill.

- Without AI: a structured digest.
- With AI: a note you can read out.

## Requirements

Node 20 or newer. No runtime dependencies.

## License

MIT
