# Installing standup-mr

Instructions for an AI assistant setting this MCP server up on a user's
machine. Everything here is verified against the published package.

## What it needs

- Node.js 20 or newer. Nothing to clone, nothing to build — the server runs
  straight from npm.
- Read access to the user's GitLab or GitHub. It never takes a credential as
  a tool argument; credentials come from the environment or from a logged-in
  `gh` / `glab` session.

## Config

Add this to the MCP settings file (for Cline,
`cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "standup": {
      "command": "npx",
      "args": ["-y", "standup-mr", "mcp"],
      "env": {}
    }
  }
}
```

That is the whole install when the user already has `gh` or `glab` logged in
— leave `env` empty and the server picks the session up.

## Credentials, when there is no CLI session

Add only the pair the user actually needs.

| Variable | When |
|---|---|
| `GITHUB_TOKEN` | GitHub, no `gh` session |
| `GITHUB_HOST` | GitHub Enterprise only; defaults to `github.com` |
| `GITLAB_TOKEN` | GitLab, no `glab` session |
| `GITLAB_HOST` | **Required for GitLab** — there is no default host |
| `STANDUP_PROVIDER` | `github` or `gitlab`, when both are configured and the choice is ambiguous |

Ask the user for a token; do not invent one, and do not put a token anywhere
but `env`.

## The one tool

`get_standup_data` returns the previous working day's activity, open merge
requests bucketed by state (ready / blocked / draft / stale), pending
reviews, and the error lines from any failed pipeline job. All three
arguments are optional:

- `provider` — `github` or `gitlab`; omit to auto-detect
- `host` — self-hosted host, no scheme
- `lang` — `en` or `tr`; changes date labels in the JSON only

## Verifying the install

```bash
npx -y standup-mr mcp
```

It speaks MCP over stdio and writes nothing else to stdout. A successful
`initialize` reports `{"name":"standup-mr","version":"<current>"}`.

If the user is not on an MCP client, `npx standup-mr fetch --markdown`
prints the same data as a digest.

## Writing the note

The tool returns data, not prose. The note-writing rules live in the bundled
skill; pour them into whatever instructions file the assistant reads:

```bash
npx standup-mr instructions >> AGENTS.md
```
