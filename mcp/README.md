# MCP server

Exposes one tool, `get_standup_data`, for either GitLab or GitHub, returning
the same JSON as `standup fetch`.

## Install

```bash
npm install standup-mr @modelcontextprotocol/sdk
```

## Configure

GitLab:

```json
{
  "mcpServers": {
    "standup": {
      "command": "node",
      "args": ["/absolute/path/to/standup-mr/dist/mcp/server.js"],
      "env": {
        "GITLAB_HOST": "gitlab.example.com",
        "GITLAB_TOKEN": "glpat-..."
      }
    }
  }
}
```

GitHub:

```json
{
  "mcpServers": {
    "standup": {
      "command": "node",
      "args": ["/absolute/path/to/standup-mr/dist/mcp/server.js"],
      "env": {
        "GITHUB_HOST": "github.com",
        "GITHUB_TOKEN": "ghp_..."
      }
    }
  }
}
```

`GITLAB_HOST`/`GITLAB_TOKEN` and `GITHUB_HOST`/`GITHUB_TOKEN` are the supported
configuration for MCP use — set whichever pair matches the provider you want.
If `glab` or `gh` happens to be installed and authenticated it is used as a
fallback, but do not rely on that inside a container.

The tool returns data only. Ask your client to write the note, or install the
Claude Code plugin (`/plugin install standup@standup-mr`), which carries the
note-writing rules.
