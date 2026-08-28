import { describe, expect, it } from 'bun:test'

import { extractErrors } from './trace'

const ESC = '\x1b'

const SAMPLE =
    `section_start:1787644042:step_script${ESC}[0;m` +
    'Executing "step_script" stage of the job script\n' +
    '$ npm ci\n' +
    'error: GET https://gitlab.example.com/api/v4/projects/1/packages/npm/@acme/ui/-/@acme/ui-1.2.0.tgz - 404\n' +
    'error: GET https://gitlab.example.com/api/v4/projects/1/packages/npm/@acme/core/-/@acme/core-2.0.0.tgz - 404\n' +
    'section_end:1787644047:step_script' +
    'Cleaning up project directory and file based variables\n' +
    'ERROR: Job failed: exit status 1\n'

describe('extractErrors', () => {
    it('strips ansi codes and section markers', () => {
        const errors = extractErrors(SAMPLE)
        expect(errors.some((line) => line.includes(ESC))).toBe(false)
        expect(errors.some((line) => line.includes('section_'))).toBe(false)
    })

    it('keeps the real error lines', () => {
        const errors = extractErrors(SAMPLE)
        expect(errors).toHaveLength(2)
        expect(errors.every((line) => line.includes('404'))).toBe(true)
        expect(errors[0]).toContain('@acme/ui')
    })

    it('drops generic runner noise', () => {
        const errors = extractErrors(SAMPLE)
        expect(errors.some((line) => line.includes('Job failed: exit status'))).toBe(false)
        expect(errors.some((line) => line.startsWith('Cleaning up'))).toBe(false)
    })

    it('deduplicates repeated lines', () => {
        expect(extractErrors('error: boom\n'.repeat(5))).toEqual(['error: boom'])
    })

    it('returns the last lines within the limit', () => {
        const trace = Array.from({ length: 20 }, (_, n) => `error: failure ${n}`).join('\n')
        expect(extractErrors(trace, 3)).toEqual([
            'error: failure 17',
            'error: failure 18',
            'error: failure 19',
        ])
    })

    it('returns an empty list for an empty trace', () => {
        expect(extractErrors('')).toEqual([])
    })

    it('returns an empty list when nothing failed', () => {
        expect(extractErrors('$ npm ci\nadded 400 packages\n')).toEqual([])
    })
})
