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
    it('strips ansi codes from the lines it keeps', () => {
        const coloured = `${ESC}[31merror: GET /packages/npm/@acme/ui-1.2.0.tgz - 404${ESC}[0m`
        expect(extractErrors(coloured)).toEqual([
            'error: GET /packages/npm/@acme/ui-1.2.0.tgz - 404',
        ])
    })

    it('strips section markers glued to the lines it keeps', () => {
        const marked = 'section_start:1787644042:step_scripterror: npm ci failed'
        expect(extractErrors(marked)).toEqual(['npm ci failed'])
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

    it('truncates a very long line', () => {
        const long = `error: ${'x'.repeat(300)}`
        expect(extractErrors(long)[0]).toHaveLength(200)
    })
})

describe('extractErrors on github actions logs', () => {
    it('strips the per-line timestamp prefix', () => {
        const log = '2026-08-28T09:12:03.1234567Z npm ERR! code E404\n'
        expect(extractErrors(log)).toEqual(['npm ERR! code E404'])
    })

    it('strips the error marker from the line it keeps', () => {
        const log = '2026-08-28T09:12:04.0000000Z ##[error]Process completed with exit code 1.\n'
        expect(extractErrors(log)).toEqual(['Process completed with exit code 1.'])
    })

    it('drops group markers even when they mention an error', () => {
        const log = '2026-08-28T09:12:01.0000000Z ##[group]Run error check\n'
        expect(extractErrors(log)).toEqual([])
    })

    it('keeps the real failure out of a full actions log', () => {
        const log = [
            '2026-08-28T09:12:01.0000000Z ##[group]Run npm ci',
            '2026-08-28T09:12:02.0000000Z npm ERR! code E404',
            "2026-08-28T09:12:02.0000000Z npm ERR! 404 Not Found - GET https://npm.pkg.github.com/@acme%2fui",
            '2026-08-28T09:12:03.0000000Z ##[endgroup]',
            '2026-08-28T09:12:04.0000000Z ##[error]Process completed with exit code 1.',
        ].join('\n')

        const errors = extractErrors(log)
        expect(errors).toHaveLength(3)
        expect(errors[0]).toBe('npm ERR! code E404')
        expect(errors.some((line) => line.startsWith('##['))).toBe(false)
        expect(errors.some((line) => line.startsWith('2026-'))).toBe(false)
    })
})
