---
name: Bug report
about: Report a bug to help us improve standup-mr
title: '[BUG] '
labels: bug
assignees: ''
---

## Bug Description

A clear and concise description of what the bug is.

## Steps to Reproduce

Steps to reproduce the behavior:

1. Run `standup-mr fetch ...` with '...'
2. Configuration used (host / token source / lang)
3. See error '...'

## Expected Behavior

A clear and concise description of what you expected to happen.

## Output / Logs

If applicable, add the command output or error message. Please include:

```
Error message or stderr output here
```

## Environment

- **OS**: [e.g., macOS 13.0, Ubuntu 22.04, Windows 11]
- **Runtime**: [e.g., Node.js 20.0.0, Bun 1.3.0]
- **standup-mr version**: [e.g., 0.1.0]
- **Surface**: [CLI / MCP server / Claude Code skill]
- **GitLab**: [gitlab.com or self-hosted, and version if self-hosted]

## Additional Context

Add any other context about the problem here:

- How are credentials resolved (`--host`/`--token`, env vars, or `glab`)?
- Does it happen with every merge request / project, or a specific one?
- Have you tried with a fresh install?

## Checklist

- [ ] I've checked that this issue hasn't been reported already
- [ ] I've tried to reproduce it with the latest version
- [ ] I'm using a supported environment (Node.js 20+)
- [ ] I've included all relevant details and error messages
