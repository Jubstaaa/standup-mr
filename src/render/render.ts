import { BUCKET_ORDER, PROVIDER_STRINGS, REF_PREFIX, STRINGS } from './render.constants'
import type { ActivityEvent, StandupReport } from '../types/standup.types'
import type { Strings } from './render.types'

function eventLine(event: ActivityEvent): string {
    const detail = event.commits
        ? `${event.commitTitle || event.branch} (${event.commits} commit)`
        : event.title || event.action
    return `- \`${event.project}\` ${event.action} — ${detail}`
}

export function toMarkdown(report: StandupReport, lang = 'en'): string {
    const base = STRINGS[lang] ?? STRINGS.en!
    const t: Strings = { ...base, ...(PROVIDER_STRINGS[report.provider][lang] ?? {}) }
    const ref = REF_PREFIX[report.provider]
    const out: string[] = []

    out.push(`# ${report.today.label} — ${report.user}`, '', `_${t.digest}_`, '')

    if (report.previousDays.length === 0) {
        out.push(`## ${t.previous}`, '', `_${t.nothing}_`, '')
    }
    for (const day of report.previousDays) {
        out.push(`## ${t.previous}: ${day.label}`, '')
        out.push(...day.events.map(eventLine))
        out.push('')
    }

    if (report.todayEvents.length > 0) {
        out.push(`## ${t.today}`, '', ...report.todayEvents.map(eventLine), '')
    }

    for (const bucket of BUCKET_ORDER) {
        const rows = report.myMrs.filter((mr) => mr.bucket === bucket)
        if (rows.length === 0) continue

        out.push(`## ${t[bucket]} (${rows.length})`, '')
        for (const mr of rows) {
            const notes: string[] = []
            if (mr.pipelineMissing) notes.push(t.noPipeline)
            if (mr.unresolved) notes.push(`${mr.unresolved} ${t.unresolved}`)
            const suffix = notes.length > 0 ? ` — **${notes.join(', ')}**` : ''
            out.push(`- \`${mr.project}\` ${ref}${mr.iid} ${mr.title}${suffix}`)
        }
        out.push('')
    }

    const pending = report.reviews.filter((r) => !r.approvedByMe)
    if (pending.length > 0) {
        out.push(`## ${t.reviews} (${report.reviewPendingCount} ${t.pending})`, '')
        for (const review of pending) {
            out.push(
                `- \`${review.project}\` ${ref}${review.iid} ${review.title} — ${review.author}`
            )
        }
        out.push('')
    }

    if (report.blockers.length > 0) {
        out.push(`## ${t.blockers}`, '')
        for (const blocker of report.blockers) {
            out.push(`- \`${blocker.project}\` ${ref}${blocker.mr} — job \`${blocker.job}\``)
            out.push(...blocker.errors.map((line) => `  - \`${line}\``))
        }
        out.push('')
    }

    return `${out.join('\n').trimEnd()}\n`
}
