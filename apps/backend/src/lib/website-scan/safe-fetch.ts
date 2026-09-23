/**
 * Fetch an operator-supplied URL without letting it reach inside our network.
 *
 * The partner-website scan (#2249) fetches whatever URL an admin types. That is
 * the textbook SSRF shape: `http://169.254.169.254/` is the ECS task-metadata
 * endpoint, and a hostname can resolve to 10.x just as easily as to a CDN. The
 * moodboard proxy solves a different problem with an ALLOW-list of our own
 * origins (moodboard-image-src.ts); an arbitrary partner site cannot be
 * allow-listed, so this is a deny-list — and to make a deny-list hold, the
 * check has to run on the address the socket ACTUALLY connects to.
 *
 * So the check lives in the socket's `lookup`: every address DNS returns is
 * vetted and the connection is made to one of those vetted addresses. There is
 * no gap between "checked" and "connected" for a rebinding resolver to use.
 *
 * Redirects are followed by hand, a hop at a time, each through the same
 * lookup — `fetch`'s automatic redirects would skip it.
 */
import dns from "node:dns"
import http from "node:http"
import https from "node:https"
import net from "node:net"

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnsafeUrlError"
  }
}

export type SafeFetchOptions = {
  /** Hard cap on the body; the read is aborted past it. */
  maxBytes: number
  timeoutMs?: number
  maxRedirects?: number
  accept?: string
}

export type SafeFetchResult = {
  status: number
  /** The URL after redirects — what the body actually came from. */
  url: string
  contentType: string
  body: Buffer
}

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_REDIRECTS = 3
const USER_AGENT =
  "JYT-CapabilityScan/1.0 (+https://jaalyantra.com; reads a partner's own catalogue at their request)"

/**
 * True when an address must never be contacted: loopback, private (RFC1918),
 * link-local (incl. cloud metadata), CGNAT, multicast, unspecified, and the
 * IPv6 equivalents — including IPv4-mapped IPv6, which is the usual bypass.
 */
export const isBlockedAddress = (address: string): boolean => {
  const family = net.isIP(address)
  if (family === 0) return true // not an IP at all: refuse, don't guess

  if (family === 6) {
    const a = address.toLowerCase()
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isBlockedAddress(mapped[1])
    // `new URL` rewrites [::ffff:127.0.0.1] to the HEX form ::ffff:7f00:1.
    const mappedHex = a.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16)
      const lo = parseInt(mappedHex[2], 16)
      return isBlockedAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
    }
    if (a === "::" || a === "::1") return true
    // fc00::/7 unique-local, fe80::/10 link-local, ff00::/8 multicast
    if (/^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^ff/.test(a)) return true
    // 64:ff9b::/96 NAT64 can embed a private v4; refuse it rather than decode
    if (a.startsWith("64:ff9b:")) return true
    return false
  }

  const [p0, p1] = address.split(".").map(Number)
  if (p0 === 0 || p0 === 10 || p0 === 127) return true
  if (p0 === 169 && p1 === 254) return true // link-local + 169.254.169.254
  if (p0 === 172 && p1 >= 16 && p1 <= 31) return true
  if (p0 === 192 && p1 === 168) return true
  if (p0 === 100 && p1 >= 64 && p1 <= 127) return true // CGNAT
  if (p0 === 192 && p1 === 0) return true // 192.0.0.0/24 + 192.0.2.0/24
  if (p0 === 198 && (p1 === 18 || p1 === 19)) return true // benchmarking
  if (p0 >= 224) return true // multicast + reserved + broadcast
  return false
}

/**
 * Tests (and only tests) serve fixtures from 127.0.0.1. The escape hatch is
 * bound to NODE_ENV so no production config can switch the guard off, and it
 * opens LOOPBACK only — never link-local or RFC1918 — so a test can still
 * prove that a redirect into 169.254.169.254 is refused.
 */
const privateHostsAllowed = () =>
  process.env.NODE_ENV === "test" &&
  process.env.WEBSITE_SCAN_ALLOW_PRIVATE_HOSTS === "true"

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1"])

/** Blocked, after the (test-only, loopback-only) hatch. */
const refused = (address: string) =>
  isBlockedAddress(address) && !(privateHostsAllowed() && LOOPBACK.has(address.toLowerCase()))

/** Parse and vet a URL's shape. Throws UnsafeUrlError; never returns junk. */
export const parseScanUrl = (raw: string): URL => {
  let input = String(raw ?? "").trim()
  if (!input) throw new UnsafeUrlError("A website URL is required")
  // Operators type "gof.asia" — the scheme is the only thing we supply.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) input = `https://${input}`

  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new UnsafeUrlError(`Not a valid URL: ${raw}`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(`Only http(s) URLs can be scanned, not ${url.protocol}`)
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("URLs with credentials cannot be scanned")
  }
  if (url.port && !["80", "443"].includes(url.port) && !privateHostsAllowed()) {
    throw new UnsafeUrlError(`Port ${url.port} cannot be scanned`)
  }
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (net.isIP(host) && refused(host)) {
    throw new UnsafeUrlError(`${host} is a private or reserved address`)
  }
  if (/^(localhost|.*\.localhost|.*\.internal|.*\.local)$/i.test(host) && !privateHostsAllowed()) {
    throw new UnsafeUrlError(`${host} is not a public host`)
  }
  url.hash = ""
  return url
}

/**
 * dns.lookup replacement that refuses a blocked address. Node calls it for
 * every connection, so whatever it hands back is exactly what gets dialled.
 */
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return (callback as any)(err)
    const list = (addresses as unknown as dns.LookupAddress[]) ?? []
    const allowed = list.filter((a) => !refused(a.address))
    // Refuse outright if ANY answer is private: a host that resolves to both a
    // CDN and 10.0.0.5 is not one we want to be clever about.
    if (!list.length || allowed.length !== list.length) {
      return (callback as any)(
        new UnsafeUrlError(`${hostname} resolves to a private or reserved address`)
      )
    }
    if ((options as any)?.all) return (callback as any)(null, allowed)
    return (callback as any)(null, allowed[0].address, allowed[0].family)
  })
}

const requestOnce = (
  url: URL,
  opts: Required<Pick<SafeFetchOptions, "maxBytes" | "timeoutMs">> & {
    accept?: string
  }
): Promise<{ status: number; location?: string; contentType: string; body: Buffer }> =>
  new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http
    const req = lib.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup,
        timeout: opts.timeoutMs,
        headers: {
          "user-agent": USER_AGENT,
          accept: opts.accept ?? "*/*",
          // No compression: a byte cap on a gzip stream caps the WIRE, not what
          // it inflates to.
          "accept-encoding": "identity",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0
        const contentType = String(res.headers["content-type"] ?? "")
        if (status >= 300 && status < 400) {
          res.resume()
          return resolve({
            status,
            location: res.headers.location,
            contentType,
            body: Buffer.alloc(0),
          })
        }
        const declared = Number(res.headers["content-length"])
        if (Number.isFinite(declared) && declared > opts.maxBytes) {
          res.destroy()
          return reject(
            new Error(`Response too large (${declared} bytes > ${opts.maxBytes})`)
          )
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on("data", (chunk: Buffer) => {
          size += chunk.length
          if (size > opts.maxBytes) {
            res.destroy()
            reject(new Error(`Response exceeded ${opts.maxBytes} bytes`))
            return
          }
          chunks.push(chunk)
        })
        res.on("end", () =>
          resolve({ status, contentType, body: Buffer.concat(chunks) })
        )
        res.on("error", reject)
      }
    )
    req.on("timeout", () => req.destroy(new Error(`Timed out after ${opts.timeoutMs}ms`)))
    req.on("error", reject)
    req.end()
  })

export const safeFetch = async (
  rawUrl: string | URL,
  options: SafeFetchOptions
): Promise<SafeFetchResult> => {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let url = parseScanUrl(String(rawUrl))

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await requestOnce(url, {
      maxBytes: options.maxBytes,
      timeoutMs,
      accept: options.accept,
    })
    if (res.status >= 300 && res.status < 400) {
      if (!res.location) throw new Error(`Redirect ${res.status} without a Location`)
      // Every hop is re-parsed and re-vetted: a public page may redirect inward.
      url = parseScanUrl(new URL(res.location, url).toString())
      continue
    }
    return {
      status: res.status,
      url: url.toString(),
      contentType: res.contentType,
      body: res.body,
    }
  }
  throw new Error(`Too many redirects (more than ${maxRedirects})`)
}
