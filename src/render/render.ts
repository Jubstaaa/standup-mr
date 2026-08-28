import { BUCKET_ORDER, STRINGS } from './render.constants'
import type { ActivityEvent, StandupReport } from '../types/standup.types'

function eventLine(event: ActivityEvent): string {
    const detail = event.commits
        ? `${event.commitTitle || event.branch} (${event.commits} commit)`
        : event.title || event.action
    return `- \`${event.project}\` ${event.action} — ${detail}`
}

export function toMarkdown(report: StandupReport, lang = 'en'): string {
    const t = STRINGS[lang] ?? STRINGS.en!
    const out: string[] = []

    out.push(`# ${report.today.label} — ${report.user}`, '', `_${t.digest}_`, '')

    out.push(`## ${t.previous}: ${report.previous.label ?? '—'}`, '')
    if (report.previousEvents.length > 0) {
        out.push(...report.previousEvents.map(eventLine))
    } else {
        out.push(`_${t.nothing}_`)
    }
    out.push('')

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
            out.push(`- \`${mr.project}\` !${mr.iid} ${mr.title}${suffix}`)
        }
        out.push('')
    }

    const pending = report.reviews.filter((r) => !r.approvedByMe)
    if (pending.length > 0) {
        out.push(`## ${t.reviews} (${report.reviewPendingCount} ${t.pending})`, '')
        for (const review of pending) {
            out.push(
                `- \`${review.project}\` !${review.iid} ${review.title} — ${review.author}`
            )
        }
        out.push('')
    }

    if (report.blockers.length > 0) {
        out.push(`## ${t.blockers}`, '')
        for (const blocker of report.blockers) {
            out.push(`- \`${blocker.project}\` !${blocker.mr} — job \`${blocker.job}\``)
            out.push(...blocker.errors.map((line) => `  - \`${line}\``))
        }
        out.push('')
    }

    return `${out.join('\n').trimEnd()}\n`
}
