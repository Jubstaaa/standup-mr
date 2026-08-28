export const USAGE = `standup — standup notes from merge request state

Usage:
  standup fetch [--host H] [--token T] [--lang en|tr] [--markdown]
  standup post (--slack URL | --discord URL) [--text TEXT]

Credentials resolve as: flag, then GITLAB_HOST / GITLAB_TOKEN, then glab config.
--text defaults to '-', meaning read stdin.`
