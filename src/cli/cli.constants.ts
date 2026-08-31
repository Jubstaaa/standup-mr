export const USAGE = `standup — standup notes from merge request state

Usage:
  standup fetch [--provider github|gitlab] [--host H] [--token T]
                [--lang en|tr] [--markdown]
  standup post (--slack URL | --discord URL) [--text TEXT]

The provider is taken from --provider, then STANDUP_PROVIDER, then whichever of
GITHUB_* / GITLAB_* is set, then whichever of gh / glab is logged in.

Credentials resolve as: flag, then GITHUB_HOST / GITHUB_TOKEN (or GITLAB_HOST /
GITLAB_TOKEN), then the gh or glab config.
--text defaults to '-', meaning read stdin.`
