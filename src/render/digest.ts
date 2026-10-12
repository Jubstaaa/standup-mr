import type {
    ActiveDay,
    ActivityEvent,
    MergeRequest,
    StandupReport,
} from '../types/standup.types'

import {
    ERROR_LIMIT,
    MAX_DAY_LINES,
    MERGE_COMMIT,
    MERGED_ACTIONS,
    DIGEST_STRINGS as t,
    TITLE_LIMIT,
} from './digest.constants'
import { PROVIDER_STRINGS, REF_PREFIX, STRINGS } from './render.constants'

interface DayItem {
    merged: boolean
    project: string
    title: string
}

function shortName(project: string): string {
    return project.split('/').pop() ?? project
}

function truncate(text: string, limit: number): string {
    return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text
}

function squash(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]/g, '')
}

// GitLab reports branch deletions and project-level events with the
// project's display name as the title, which says nothing about the work.
function isNoise(text: string, project: string): boolean {
    if (!text || MERGE_COMMIT.test(text)) return true
    return (
        !text.includes(':') && squash(text).endsWith(squash(shortName(project)))
    )
}

function eventTitle(event: ActivityEvent, mrs: MergeRequest[]): string {
    if (!event.commits && !event.commitTitle) return event.title
    const mr = mrs.find(
        mr => mr.project === event.project && mr.branch === event.branch
    )
    return mr?.title ?? (event.commitTitle || event.branch)
}

function dayItems(day: ActiveDay, mrs: MergeRequest[]): DayItem[] {
    const items = new Map<string, DayItem>()
    for (const event of day.events) {
        const title = eventTitle(event, mrs)
        if (isNoise(title, event.project)) continue
        const key = `${event.project}\n${title}`
        const item = items.get(key) ?? {
            merged: false,
            project: event.project,
            title,
        }
        item.merged ||= MERGED_ACTIONS.includes(event.action)
        items.set(key, item)
    }
    return [...items.values()]
}

function hasWeekdayBetween(from: string, to: string): boolean {
    const day = new Date(`${from}T00:00:00Z`)
    day.setUTCDate(day.getUTCDate() + 1)
    for (
        ;
        day.toISOString().slice(0, 10) < to;
        day.setUTCDate(day.getUTCDate() + 1)
    ) {
        const weekday = day.getUTCDay()
        if (weekday >= 1 && weekday <= 5) return true
    }
    return false
}

function daySection(report: StandupReport): string[] {
    const day = report.previousDays.at(-1)
    if (!day) return []
    const items = dayItems(day, report.myMrs)
    if (items.length === 0) return []

    const heading = hasWeekdayBetween(day.date, report.today.date)
        ? `**${day.label} (${day.gapDays} ${t.daysAgo})**`
        : `**${t.yesterday} (${day.label})**`
    const lines = items.slice(0, MAX_DAY_LINES).map(item => {
        const merged = item.merged ? ` (${t.merged})` : ''
        return `- ${shortName(item.project)} — ${truncate(item.title, TITLE_LIMIT)}${merged}`
    })
    const hidden = items.length - MAX_DAY_LINES
    if (hidden > 0) lines.push(`- +${hidden} ${t.more}`)
    return [heading, ...lines]
}

function readySection(report: StandupReport, ref: string): string[] {
    const ready = report.myMrs.filter(mr => mr.bucket === 'ready')
    if (ready.length === 0) return []
    const byProject = new Map<string, string[]>()
    for (const mr of ready) {
        const name = shortName(mr.project)
        byProject.set(name, [...(byProject.get(name) ?? []), `${ref}${mr.iid}`])
    }
    const groups = [...byProject].map(
        ([name, refs]) => `${name} ${refs.join(', ')}`
    )
    return [`**${t.ready} (${ready.length})** ${groups.join(' · ')}`]
}

function blockedReason(
    report: StandupReport,
    mr: MergeRequest,
    unresolved: string
): string {
    const reasons: string[] = []
    const blocker = report.blockers.find(
        blocker => blocker.project === mr.project && blocker.mr === mr.iid
    )
    if (blocker) {
        const error = blocker.errors[0]
        reasons.push(
            `${t.pipelineFailed} (${blocker.job})` +
                (error ? `: \`${truncate(error, ERROR_LIMIT)}\`` : '')
        )
    } else if (mr.pipeline === 'failed') {
        reasons.push(t.pipelineFailed)
    }
    if (mr.pipelineMissing) reasons.push(STRINGS.en!.noPipeline)
    if (mr.unresolved) reasons.push(`${mr.unresolved} ${unresolved}`)
    return reasons.join('; ')
}

function blockedSection(report: StandupReport, ref: string): string[] {
    const blocked = report.myMrs.filter(mr => mr.bucket === 'blocked')
    if (blocked.length === 0) return []
    const unresolved =
        PROVIDER_STRINGS[report.provider].en?.unresolved ??
        STRINGS.en!.unresolved
    return [
        `**${t.blocked}**`,
        ...blocked.map(mr => {
            const reason = blockedReason(report, mr, unresolved)
            const suffix = reason ? ` — ${reason}` : ''
            return `- ${shortName(mr.project)} ${ref}${mr.iid}${suffix}`
        }),
    ]
}

function alsoLine(report: StandupReport): string[] {
    const count = (bucket: string) =>
        report.myMrs.filter(mr => mr.bucket === bucket).length
    const parts = [
        [count('draft'), t.drafts],
        [count('stale'), t.stale],
        [report.reviewPendingCount, t.reviews],
    ] as const
    const shown = parts
        .filter(([n]) => n > 0)
        .map(([n, name]) => `${n} ${name}`)
    return shown.length > 0 ? [`**${t.also}** ${shown.join(' · ')}`] : []
}

export function toChatDigest(report: StandupReport): string {
    const ref = REF_PREFIX[report.provider]
    const lines = [
        `**${t.standup} — ${report.today.label}** · ${report.user}`,
        ...daySection(report),
        ...readySection(report, ref),
        ...blockedSection(report, ref),
        ...alsoLine(report),
    ]
    return `${lines.join('\n')}\n`
}
