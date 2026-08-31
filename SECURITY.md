# Security Policy

## Reporting a Vulnerability

Security is important to us. If you have discovered a security vulnerability in
standup-mr, we appreciate your help in disclosing it to us in a responsible
manner.

### How to Report

Please **do not** open a public GitHub issue for security vulnerabilities.
Instead:

1. Email your report to ilkerbalcilartr@gmail.com
2. Include details about:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if you have one)

### What to Expect

- Acknowledgment of your report within 48 hours
- Regular updates about the progress
- Credit for the discovery (if desired)
- A reasonable timeline for a fix and release

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.2.x   | ✅        |
| 0.1.x   | ❌        |

We recommend always using the latest version of standup-mr.

## Security Best Practices

standup-mr reads your GitLab activity, open merge requests, and failed
pipeline job logs, and can post the resulting note to a Slack or Discord
webhook. Keep the following in mind:

### 1. **Token scope**

- Use a personal access token scoped as narrowly as GitLab allows for reading
  events, merge requests, and pipeline jobs
- Never commit `GITLAB_TOKEN` or a webhook URL to source control

### 2. **Data handling**

- standup-mr does not persist anything — each run makes live GitLab or GitHub
  API calls and prints the result
- Job log text is scanned for error lines locally. Requests leave for exactly
  three kinds of destination: the GitLab or GitHub host you configured; the
  storage host GitHub redirects to when a workflow job's log is fetched; and,
  if you use `post`, the webhook URL you pass
- **That storage host is a third party.** GitHub answers a job-log request with
  a 302 to a pre-signed URL on its own blob storage, and standup-mr follows it
  with **no `Authorization` header** — the URL already carries its own
  signature, and forwarding a token to a host that does not need it would
  disclose it. That behaviour is asserted in the test suite, in both
  directions: the API call must carry the token and the redirect must not

### 3. **Webhook URLs**

- Slack and Discord webhook URLs are bearer credentials — anyone with the URL
  can post to your channel. Treat them like secrets (environment variables,
  not command history)

### 4. **Dependencies**

- The CLI and library ship with zero runtime dependencies
- The MCP server has exactly one optional peer dependency,
  `@modelcontextprotocol/sdk`, needed only when you run it as an MCP server
- Keep standup-mr and any installed peer dependency updated

## Known Limitations

- No built-in encryption or storage — output is only as safe as your terminal,
  shell history, and CI logs
- The MCP server trusts whatever `GITLAB_HOST` / `GITLAB_TOKEN` it is launched
  with; scope the token appropriately for the environment it runs in

## Questions?

If you have questions about security, please reach out at
ilkerbalcilartr@gmail.com or open a
[GitHub Discussion](https://github.com/Jubstaaa/standup-mr/discussions).
