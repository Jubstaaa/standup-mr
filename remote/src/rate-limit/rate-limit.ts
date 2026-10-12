import type { Request } from 'express'
import { ipKeyGenerator } from 'express-rate-limit'

// Requests arrive through Cloudflare and Caddy, so the socket address is
// always the proxy. Cloudflare's header is the real client.
export function clientKey(req: Request): string {
    const header = req.headers['cf-connecting-ip']
    const ip = (Array.isArray(header) ? header[0] : header) ?? req.ip ?? ''
    return ipKeyGenerator(ip)
}
