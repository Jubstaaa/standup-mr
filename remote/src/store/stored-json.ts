import { z } from 'zod'

export const scopesSchema = z.array(z.string())

// A row that does not match is corruption or drift from an older release.
// The message names what was being read but never echoes the value, which
// may be a decrypted secret.
export function parseStored<T>(
    schema: z.ZodType<T>,
    raw: string,
    what: string
): T {
    let value: unknown
    try {
        value = JSON.parse(raw)
    } catch {
        throw new Error(
            `Could not read the stored ${what}: it is not valid JSON.`
        )
    }
    const result = schema.safeParse(value)
    if (!result.success) {
        const paths = result.error.issues
            .map(issue => issue.path.join('.') || '(root)')
            .join(', ')
        throw new Error(
            `Could not read the stored ${what}: unexpected value at ${paths}.`
        )
    }
    return result.data
}
