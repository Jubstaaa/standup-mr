---
name: standup
description: >-
  Generates a daily standup note from GitLab merge request state. Groups the
  previous working day's activity into themes, reports which merge requests are
  ready to merge or blocked, and diagnoses failed pipelines from their job logs.
  Use for "/standup", "standup note", "what did I do yesterday", "what's on my
  plate today", "daily note".
---

# Standup Note

Goal: put the things worth *saying* in front of the user before their standup.
Not a commit log — what finished, what is waiting, what is stuck.

## 1. Collect

```bash
npx standup-mr fetch
```

Prints one JSON document. Add `--lang tr` for Turkish date labels. Nothing else
needs running: the command resolves the host and token, works out which day to
report on, and reads failed job logs itself.

If the command exits non-zero, relay its stderr verbatim — do not invent a
cause. The usual fix is `glab auth login`, or setting `GITLAB_HOST` and
`GITLAB_TOKEN`.

## 2. Shape of the JSON

| Field | Contents |
|---|---|
| `previous` | Last active day: `date`, `label`, `gapDays`, `eventCount` |
| `previousEvents` | That day's events — `action`, `project`, `branch`, `commits`, `commitTitle` |
| `todayEvents` | Anything already done today (usually empty) |
| `myMrs` | Open merge requests with `bucket`: `ready` / `blocked` / `draft` / `stale`, plus `pipelineMissing` |
| `reviews` | Review requests, with `fresh` and `approvedByMe` |
| `reviewPendingCount` | Reviews genuinely awaiting action |
| `blockers` | Failed pipelines with real error lines from the job trace |

## 3. Write the note

Three sections: **Previous day · Today · Blockers**. Short, in the language the
user is speaking, phrased the way they would say it out loud.

### Previous day

Use `previous.label`. Never say "yesterday" — after a weekend or a day off it is
wrong, and the label already carries the right day.

**Group by theme; never list events one by one.** A 60-event day should collapse
to four to six bullets. Group on project + branch + subject:

> **Virtual keyboard — two fixes, two releases** (`acme/ui` → main)
> - keeps scaling on large screens, no longer widens modals → **0.5.13**
> - mirrors the settled field value, not the in-flight one → **0.5.14**

`commitTitle` values are conventional commits; use the scope as the grouping
hint. Fold merges, branch deletions and tags into the sentence rather than
giving them their own bullets.

When one subject spans several projects in a day — dependency alignment, a CI
rollout — make it **one bullet** and say how many projects it touched.

### Today

- **`ready`** → count them, give project + `!iid`.
  - If `pipelineMissing` is true, say **"no pipeline ever ran"** explicitly. Do
    not let it pass as green.
- **`blocked`** → say which: red pipeline, or unresolved comments, or both.
- **`draft`** → what needs finishing. Collapse drafts that share a branch prefix
  or scope into one line, and flag it when they must merge in order.
- **`stale`** → a count and the oldest date. No long list.

For reviews, use `reviewPendingCount`, not the raw length of `reviews` — GitLab
keeps you on the reviewer list after you approve, so the raw number overstates
the work. List the pending ones with author and `!iid`. If the user has both
their own merge request and a review in the same project, note the conflict risk.

### Blockers

If `blockers` is empty, **omit the section entirely.** Never write "no blockers".

Otherwise the useful content is the lines in `errors`, not the job name. Collapse
several merge requests sharing one root cause into a single blocker.

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
