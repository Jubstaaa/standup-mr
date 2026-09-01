---
name: standup
description: >-
  Generates a daily standup note from GitLab merge request or GitHub pull
  request state. Groups the previous working day's activity into themes,
  reports which merge requests are ready to merge or blocked, and diagnoses
  failed pipelines from their job logs. Use for "/standup", "standup note",
  "what did I do yesterday", "what's on my plate today", "daily note".
---

# Standup Note

Goal: put the things worth *saying* in front of the user before their standup.
Not a commit log — what finished, what is waiting, what is stuck.

## 1. Collect

```bash
npx standup-mr fetch
```

Prints one JSON document. Nothing else needs running: the command resolves
the host and token, works out which day to report on, and reads failed job
logs itself.

**Know the provider before the first call, don't discover it from a failure.**
If the user has named GitHub or GitLab, or it is otherwise obvious from
context, pass it on the very first invocation:

```bash
npx standup-mr fetch --provider github
npx standup-mr fetch --provider gitlab
```

If it is not known, do not guess. The command resolves it itself, in order:
`--provider` → a recognisable `--host` → `STANDUP_PROVIDER` → the
`GITHUB_*`/`GITLAB_*` env pair → whichever of `gh`/`glab` is logged in → an
error naming what it found. On a machine where both `gh` and `glab` are
authenticated, that resolution is ambiguous and the bare call fails with
`Both gh and glab are authenticated. Pass --provider github or --provider
gitlab.` — if you hit that, ask the user which one they mean rather than
picking one silently, unless the conversation already makes it obvious, in
which case pass that provider and say so in the note.

If the command exits non-zero for any other reason, relay its stderr verbatim
— do not invent a cause. The usual fix is `gh auth login` or `glab auth
login`, depending on which provider it was trying to reach.

**Pass `--lang` to match the language the user is speaking** — `--lang tr`
for Turkish. It only affects the date labels inside the JSON (`"label":
"Friday, 28 August"` → `"Cuma, 28 Ağustos"`); the prose of the note is always
your own work, in the user's language, regardless of this flag. Passing it
matters because the payload is otherwise ~1000 lines of English labels
fighting a note you're trying to write in another language. Today `--lang`
supports only `en` (default) and `tr` — any other value silently falls back
to English labels. If the user speaks a language `--lang` doesn't cover,
still write the note in their language; just leave the date labels in
English rather than passing a value that won't take effect.

## 2. Shape of the JSON

| Field | Contents |
|---|---|
| `provider` | `gitlab` or `github` — decides the vocabulary, see below |
| `previousDays` | Chronologically ascending list of active days since the last report. Each entry: `date`, `label`, `gapDays`, `events` |
| `todayEvents` | Anything already done today (usually empty) |
| `myMrs` | Open merge/pull requests with `bucket`: `ready` / `blocked` / `draft` / `stale`, plus `mergeStatus` and `pipelineMissing` |
| `reviews` | Review requests, with `fresh` and `approvedByMe` |
| `reviewPendingCount` | Reviews genuinely awaiting action |
| `blockers` | Failed CI runs with real error lines pulled from the job log |

Each entry in `previousDays` carries its own `events` — `action`, `project`,
`branch`, `commits`, `commitTitle`. **Every active day gets its own section in
the note; never fold one day into another.** Running on a Monday typically
means the list holds Friday plus any weekend day that had activity — one entry
if the weekend was quiet, more if it was not — and each must be written up
under its own `label`, never merged into a single "yesterday".

## 3. Write the note

**Write in the language the user is speaking, not the language of the JSON.**
The payload's labels and field names are English regardless of `--lang`
coverage — that is source data, not a cue for what language to write in.

Three sections: **Previous day · Today · Blockers**. Short, phrased the way
the user would say it out loud.

### Previous day

Write one section per entry in `previousDays`, in order, each headed by its own
`label`. Never say "yesterday" — after a weekend or a day off it is wrong, and
the label already carries the right day.

**Group by theme within each day; never list events one by one.** A 60-event
day should collapse to four to six bullets. Group on project + branch + subject:

> **Virtual keyboard — two fixes, two releases** (`acme/ui` → main)
> - keeps scaling on large screens, no longer widens modals → **0.5.13**
> - mirrors the settled field value, not the in-flight one → **0.5.14**

`commitTitle` values are conventional commits; use the scope as the grouping
hint. Fold merges, branch deletions and tags into the sentence rather than
giving them their own bullets.

When one subject spans several projects in a day — dependency alignment, a CI
rollout — make it **one bullet** and say how many projects it touched.

### Today

- **`ready`** → count them, give project + reference. The bucket name means
  "nothing known is blocking it" — it is **not** a claim that the merge/pull
  request is mergeable. Use `mergeStatus` to say which:
  - `mergeable` → say it plainly, "ready to merge".
  - `unchecked` (GitLab has not evaluated it yet) → say so explicitly, e.g.
    "GitLab hasn't checked mergeability yet" — never round this up to "all
    green".
  - anything else (`conflict`, `need_rebase`, `discussions_not_resolved`,
    GitHub's `dirty`/`blocked`/`behind`, …) → name that specific reason instead
    of the generic bucket label.
  - `null` (the field is `string | null`) → say **nothing** about mergeability.
    The provider did not report it; do not guess a reason and do not round it
    up to "ready to merge".
  - If `pipelineMissing` is true, say **"no pipeline ever ran"** explicitly. Do
    not let it pass as green.
- **`blocked`** → say which: red pipeline, unresolved comments, or both. On
  GitHub the thing that blocks is a **change request**
  (`CHANGES_REQUESTED`), not an unresolved comment thread — `unresolved` holds
  the count of reviewers who requested changes.
- **`draft`** → what needs finishing. Collapse drafts that share a branch prefix
  or scope into one line, and flag it when they must merge in order.
- **`stale`** → a count and the oldest date. No long list.

For reviews, use `reviewPendingCount` on **both** providers, not the raw length
of `reviews`. GitLab keeps you on the reviewer list after you approve, so its
raw count overstates the work; GitHub drops you from the list once you approve,
so `approvedByMe` is almost always `false` there — `reviewPendingCount` is the
field that stays trustworthy either way. List the pending ones with author and
reference. If the user has both their own merge/pull request and a review in
the same project, note the conflict risk.

### Vocabulary

Match the platform's own words. When `provider` is `github`, say "pull
request" and reference it as `#123`. When it is `gitlab`, say "merge request"
and reference it as `!123`. The bucket names (`ready` / `blocked` / `draft` /
`stale`) stay the same on both sides — only the noun and the reference prefix
change.

### Blockers

If `blockers` is empty, **omit the section entirely.** Never write "no blockers".

Otherwise the useful content is the lines in `errors`, not the job name — on
GitLab those lines come from a failed pipeline job's trace, on GitHub from a
failed Actions job's log or from a non-Actions check's summary. The rule does
not change with the provider: what matters is what `errors` says, not which
job produced it. Collapse several merge/pull requests sharing one root cause
into a single blocker.

> The CI token cannot pull the private packages — `npm ci` gets a 404. Two
> pipelines are red for the same reason; the third passes because it has no such
> dependency.

A private package registry returning **404 instead of 403** usually means the
token's scope is wrong, not that the package is missing. Say so when the pattern
fits.

## Rules

- Speak from the data the command returned. If unsure about a merge request,
  verify it rather than guessing.
- If `todayEvents` is non-empty, do not say "nothing done today" — call out the
  work already started.
- The note gets read aloud: one breath per bullet, no three-line paragraphs.
