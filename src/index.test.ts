import { describe, expect, it } from 'bun:test'

import * as api from './index'
import type {
    ActiveDay,
    ActivityEvent,
    Blocker,
    Bucket,
    FetchLike,
    Identity,
    MergeRequest,
    Provider,
    ProviderKind,
    ProviderLabels,
    Review,
    SelectOptions,
    StandupReport,
} from './index'

// The package entry point is a public contract: swapping an internal for a
// library must not drop, rename or re-shape what consumers import. A change
// here is a deliberate API change and belongs in the changelog.
const EXPECTED_RUNTIME_API = {
    ApiError: 'class/2',
    ConfigError: 'class/1',
    DIAGNOSIS_UNAVAILABLE: 'string',
    GITHUB_LABELS: 'object',
    GITLAB_LABELS: 'object',
    GitHubProvider: 'class/2',
    GitLabProvider: 'class/2',
    RETRY_ATTEMPTS: 'number',
    RETRY_BACKOFF_MS: 'object',
    STALE_DAYS: 'number',
    approvedBy: 'function/2',
    assertUsable: 'function/2',
    buildReport: 'function/2',
    buildUrl: 'function/3',
    chooseKind: 'function/0',
    classify: 'function/2',
    connect: 'function/0',
    countChangesRequested: 'function/1',
    degradable: 'function/1',
    extractErrors: 'function/1',
    ghHosts: 'function/0',
    ghToken: 'function/1',
    glabHosts: 'function/0',
    glabToken: 'function/1',
    inferWebhookKind: 'function/1',
    isoDay: 'function/1',
    label: 'function/1',
    latestStateByReviewer: 'function/1',
    localAt: 'function/1',
    mapEvent: 'function/1',
    markMissingPipelines: 'function/1',
    normalizeChecks: 'function/1',
    parseGlabHosts: 'function/1',
    parseLoggedInHosts: 'function/1',
    postWebhook: 'function/2',
    previousActiveDays: 'function/2',
    readStandupSkillBody: 'function/0',
    repoFromUrl: 'function/1',
    resolveHost: 'function/3',
    resolveToken: 'function/4',
    sendWithRetry: 'function/4',
    toChatDigest: 'function/1',
    toChatText: 'function/2',
    toMarkdown: 'function/1',
    undiagnosed: 'function/2',
    unreachable: 'function/2',
}

function shapeOf(value: unknown): string {
    if (typeof value !== 'function') return typeof value
    const source = Function.prototype.toString.call(value)
    const kind = /^class[\s{]/.test(source) ? 'class' : 'function'
    return `${kind}/${value.length}`
}

describe('package entry point', () => {
    it('exports exactly the documented runtime names, kinds and arities', () => {
        const actual = Object.fromEntries(
            Object.keys(api)
                .sort()
                .map(name => [name, shapeOf(api[name as keyof typeof api])])
        )
        expect(actual).toEqual(EXPECTED_RUNTIME_API)
    })

    it('keeps the retry constants at their published values', () => {
        expect(api.RETRY_ATTEMPTS).toBe(3)
        expect(api.RETRY_BACKOFF_MS).toEqual([250, 750])
    })

    it('exports every public type', () => {
        // Compile-time check: typecheck fails if a type export disappears.
        type PublicTypes = [
            ActiveDay,
            ActivityEvent,
            Blocker,
            Bucket,
            FetchLike,
            Identity,
            MergeRequest,
            Provider,
            ProviderKind,
            ProviderLabels,
            Review,
            SelectOptions,
            StandupReport,
        ]
        const count: PublicTypes['length'] = 13
        expect(count).toBe(13)
    })
})
