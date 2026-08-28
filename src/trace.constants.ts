export const ANSI = /\x1b\[[0-9;]*[a-zA-Z]/g
export const SECTION = /section_(start|end):\d+:\S*/g
export const SIGNAL = /(\berror\b|Error:|fatal:|npm ERR!|\bfailed\b)/i
export const NOISE =
    /^(Cleaning up|Job failed: exit status|ERROR: Job failed|Uploading artifacts|Job succeeded)/i
export const MAX_LINE = 200
