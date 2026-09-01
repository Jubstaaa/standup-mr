export const USAGE = `standup — standup notes from merge request state

Usage:
  standup fetch [--provider github|gitlab] [--host H] [--token T]
                [--lang en|tr] [--markdown]
  standup post (--slack URL | --discord URL) [--text TEXT]
  standup mcp
  standup instructions

The provider is taken from --provider, then STANDUP_PROVIDER, then whichever of
GITHUB_* / GITLAB_* is set, then whichever of gh / glab is logged in.

Credentials resolve as: flag, then GITHUB_HOST / GITHUB_TOKEN (or GITLAB_HOST /
GITLAB_TOKEN), then the gh or glab config.
--text defaults to '-', meaning read stdin.

standup mcp starts the stdio MCP server, exposing get_standup_data.
standup instructions prints the note-writing playbook (the standup skill body)
to stdout, for teaching a non-Claude assistant the same rules, e.g.:
  npx standup-mr instructions >> AGENTS.md`
