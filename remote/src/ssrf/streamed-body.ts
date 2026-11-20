import type { Readable } from 'node:stream'

import type { LimitFunction } from 'p-limit'

export interface BodyLimits {
    // Process-wide, so many users at once cannot multiply the peak memory.
    downloads: LimitFunction
    maxResponseBytes: number
}

// p-limit holds a slot until the task's promise settles; this hands the
// release to whoever owns the body, since a download ends when it is read.
function takeSlot(downloads: LimitFunction): Promise<() => void> {
    return new Promise(granted => {
        void downloads(() => new Promise<void>(release => granted(release)))
    })
}

// A web stream over the response socket that pulls only when the consumer
// reads: the providers' readers then keep a log's tail or refuse JSON past
// their cap without the whole body ever sitting in memory. The download slot
// is taken on the first read, so a body nobody reads (a 404, a redirect)
// never blocks another.
export function streamedBody(
    source: Readable,
    limits: BodyLimits
): ReadableStream<Uint8Array> {
    const chunks = source[Symbol.asyncIterator]() as AsyncIterator<Buffer>
    let release: (() => void) | undefined
    let seen = 0
    const finish = () => {
        release?.()
        release = () => undefined
        source.destroy()
    }
    return new ReadableStream<Uint8Array>(
        {
            async pull(controller) {
                release ??= await takeSlot(limits.downloads)
                try {
                    const { done, value } = await chunks.next()
                    if (done) {
                        finish()
                        return controller.close()
                    }
                    seen += value.byteLength
                    if (seen > limits.maxResponseBytes) {
                        finish()
                        return controller.error(
                            new Error(
                                `The host sent more than ${limits.maxResponseBytes} bytes.`
                            )
                        )
                    }
                    controller.enqueue(new Uint8Array(value))
                } catch (error) {
                    finish()
                    controller.error(error)
                }
            },
            cancel: finish,
        },
        { highWaterMark: 0 }
    )
}
