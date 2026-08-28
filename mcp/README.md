# MCP server

Exposes one tool, `get_standup_data`, returning the same JSON as `standup fetch`.

## Install

```bash
npm install standup-mr @modelcontextprotocol/sdk
```

## Configure

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

`GITLAB_HOST` and `GITLAB_TOKEN` are the supported configuration for MCP use. If
`glab` happens to be installed and authenticated it is used as a fallback, but do
not rely on that inside a container.

The tool returns data only. Ask your client to write the note, or use the Claude
Code skill in `skill/`, which carries the note-writing rules.
