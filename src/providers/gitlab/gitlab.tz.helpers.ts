import { routedFetch } from '../base/routes.helpers'

import { GitLabProvider } from './gitlab'

function mr(updatedAt: string): Record<string, unknown> {
    return {
        project_id: 1,
        iid: 7,
        title: 'feat: thing',
        draft: false,
        source_branch: 'feat/thing',
        target_branch: 'main',
        updated_at: updatedAt,
        web_url: 'https://h/acme/web/-/merge_requests/7',
        references: { full: 'acme/web!7' },
        author: { name: 'Dev' },
    }
}

export function gitlabAt(instant: string): GitLabProvider {
    return new GitLabProvider(
        'h',
        't',
        routedFetch({
            '/events': [
                {
                    created_at: instant,
                    action_name: 'pushed to',
                    project_id: 1,
                },
            ],
            '/projects/1': { path_with_namespace: 'acme/web' },
            'scope=created_by_me': [mr(instant)],
            'reviewer_id=': [mr(instant)],
            'merge_requests/7': { head_pipeline: null },
            'discussions': [],
            'approvals': { approved_by: [] },
        })
    )
}
