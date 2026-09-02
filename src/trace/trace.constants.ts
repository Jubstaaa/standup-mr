// The escape character is exactly what this pattern exists to strip.
// eslint-disable-next-line no-control-regex
export const ANSI = /\x1b\[[0-9;]*[a-zA-Z]/g
export const SECTION = /section_(start|end):\d+:\S*/g
export const SIGNAL = /(\berror\b|Error:|fatal:|npm ERR!|\bfailed\b)/i
export const NOISE =
    /^(Cleaning up|Job failed: exit status|ERROR: Job failed|Uploading artifacts|Job succeeded)/i
export const MAX_LINE = 200
export const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+/
export const ERROR_MARKER = /^##\[error\]\s*/
export const GROUP_START = /^##\[group\]/
export const GROUP_END = /^##\[endgroup\]/
export const RUN_GROUP = /^##\[group\]Run\s/
