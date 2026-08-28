import type { Bucket } from './standup.types'
import type { Strings } from './render.types'

export const STRINGS: Record<string, Strings> = {
    en: {
        digest: 'Structured digest — not a written note.',
        previous: 'Previous working day',
        today: 'Today',
        ready: 'Ready to merge',
        blocked: 'Blocked',
        draft: 'Drafts',
        stale: 'Stale',
        reviews: 'Reviews',
        pending: 'pending',
        blockers: 'Blockers',
        noPipeline: 'no pipeline ran',
        unresolved: 'unresolved comment(s)',
        nothing: 'No activity recorded.',
    },
    tr: {
        digest: 'Yapılandırılmış döküm — yazılmış not değil.',
        previous: 'Önceki iş günü',
        today: 'Bugün',
        ready: "Merge'e hazır",
        blocked: 'Engelli',
        draft: 'Draftlar',
        stale: 'Bayat',
        reviews: 'Review',
        pending: 'bekliyor',
        blockers: 'Blocker',
        noPipeline: 'pipeline hiç çalışmamış',
        unresolved: 'çözülmemiş yorum',
        nothing: 'Kayıtlı aktivite yok.',
    },
}

export const BUCKET_ORDER: Bucket[] = ['ready', 'blocked', 'draft', 'stale']
