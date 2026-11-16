/**
 * Headers for re-emitting an upstream fetch() Response to the browser.
 *
 * fetch() has already DECOMPRESSED the body, so forwarding the upstream
 * `content-encoding: gzip` (or its compressed `content-length`) makes the
 * browser fail with ERR_CONTENT_DECODING_FAILED. That hid every compressed
 * error from /store/ai/chat, e.g. the 403/429 JSON (#2543).
 */
export function toClientHeaders(upstream: Headers): Headers {
  const out = new Headers(upstream)
  out.delete("content-encoding")
  out.delete("content-length")
  return out
}
