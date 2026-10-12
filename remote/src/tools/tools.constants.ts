export const REMOTE_STANDUP_TOOL_DESCRIPTION =
    'Collect merge-request-based standup data from the GitLab or GitHub account the user ' +
    'linked to this connector. Returns one JSON object: `today`, `previousDays[]` with the ' +
    'events of each, `todayEvents[]`, `myMrs[]` bucketed ready / blocked / draft / stale, ' +
    '`reviews[]` waiting on the user, and `blockers[]` carrying the error lines read out of ' +
    'each failed pipeline job log.\n\n' +
    'Call it once at the start of a working day, to write a standup note. It is a ' +
    'snapshot, not a search API: it cannot fetch one named merge request, reach further ' +
    'back than the previous working day, or filter by project.\n\n' +
    'Read-only. Credentials come from the accounts linked on the connect page, never ' +
    'from an argument. With one linked account no argument is needed; with several, ' +
    'pass `provider` or `host` — an ambiguous call fails and lists the linked accounts, ' +
    'so ask the user which one they mean. An expired login fails with a request to ' +
    'reconnect the connector.'

export const REMOTE_PROVIDER_ARG_DESCRIPTION =
    'Which linked account to read, by provider. Only needed when both a GitHub and a ' +
    'GitLab account are linked.'

export const REMOTE_HOST_ARG_DESCRIPTION =
    'Which linked account to read, by host, e.g. github.com or gitlab.example.com. ' +
    'Only needed when several accounts of the same provider are linked.'

export const REMOTE_POST_TOOL_DESCRIPTION =
    'Posts a finished standup note to the chat webhook the user saved on the connect ' +
    'page (Slack, Discord or Google Chat). This one has a side effect: it sends a ' +
    'message other people will see, so only call it on a note the user has agreed to ' +
    'send. The webhook URL is never an argument. If none is saved, the call fails and ' +
    'says how to add one.'

export const NO_WEBHOOK_MESSAGE =
    'No webhook is saved for this connector. Reconnect it in the client settings and ' +
    'paste a Slack, Discord or Google Chat webhook URL on the connect page.'
