export const REFRESH_MARGIN_MS = 5 * 60_000
// How long one server may hold an account's refresh before another may
// take over: past the upstream request deadline, so it never expires early.
export const REFRESH_CLAIM_MS = 60_000
