// Idle time between bytes, then the most a whole request may take.
export const REQUEST_TIMEOUT_MS = 20_000
export const REQUEST_DEADLINE_MS = 30_000
// For callers that buffer a whole body (the OAuth token exchange); provider
// reads stream and cap themselves. The container has 192 MB.
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024
// Bodies downloading at once across the whole process: each provider read
// holds at most its own cap (2 MiB of log, 8 MiB of JSON) in memory.
export const MAX_CONCURRENT_DOWNLOADS = 4
export const MAX_REQUEST_BYTES = 1024 * 1024
export const MAX_REDIRECTS = 3
export const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])
