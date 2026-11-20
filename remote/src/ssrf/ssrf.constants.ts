// Idle time between bytes, then the most a whole request may take.
export const REQUEST_TIMEOUT_MS = 20_000
export const REQUEST_DEADLINE_MS = 30_000
// The container has 192 MB; provider JSON pages stay far below this.
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024
export const MAX_REQUEST_BYTES = 1024 * 1024
export const MAX_REDIRECTS = 3
export const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])
