/**
 * Turn whatever a carrier POSTed into the list of payload objects to normalize.
 *
 * 🔴 Delhivery's push (Python aiohttp) delivered 26 updates for one parcel
 * between 2026-10-27 and 2026-11-03, every one with a valid token and a 200,
 * and every one was dropped as "Push without an AWB". The route assumed
 * `application/json`: Medusa runs json, text and urlencoded parsers, so a JSON
 * document sent as `text/plain` arrives as a STRING, a form post arrives as
 * `{ data: "<json>" }` (or the JSON itself as the only key), and an
 * `application/octet-stream` body is never parsed at all. The normalizer then
 * reads `"…".Shipment` → undefined → no AWB, and the update is gone.
 *
 * So: accept a parsed object, a JSON string, form fields carrying JSON, the raw
 * bytes, or an array of updates — and return each update as an object.
 */
export function pushPayloads(body: unknown, rawBody?: unknown): any[] {
  // The raw bytes first: the urlencoded parser mangles a JSON document posted
  // as a form (brackets read as nested keys), so the parsed body is only the
  // fallback when nothing raw was kept.
  let parsed = rawBody != null ? coerce(rawBody) : {}
  if (isEmpty(parsed)) {
    parsed = coerce(body)
  }
  if (Array.isArray(parsed)) {
    return parsed.map(coerce).filter((p) => !isEmpty(p))
  }
  return isEmpty(parsed) ? [] : [parsed]
}

/**
 * What to log when no AWB could be read: enough to see the shape next time
 * without dumping a whole payload. Tracking pushes carry no credentials (the
 * token rides in a header), so a short sample is safe to keep.
 */
export function describePushBody(body: unknown, contentType?: string): string {
  const kind = Buffer.isBuffer(body)
    ? "buffer"
    : Array.isArray(body)
      ? `array(${body.length})`
      : body === null
        ? "null"
        : typeof body
  const keys =
    body && typeof body === "object" && !Array.isArray(body) && !Buffer.isBuffer(body)
      ? Object.keys(body).slice(0, 20).join(",")
      : ""
  let sample = ""
  try {
    sample = Buffer.isBuffer(body)
      ? body.toString("utf8")
      : typeof body === "string"
        ? body
        : JSON.stringify(body) ?? ""
  } catch {
    sample = "[unserialisable]"
  }
  return (
    `content-type="${contentType || ""}" body=${kind}` +
    (keys ? ` keys=[${keys}]` : "") +
    ` sample=${sample.slice(0, 600)}`
  )
}

function coerce(body: unknown): any {
  if (Buffer.isBuffer(body)) {
    return coerce(body.toString("utf8"))
  }
  if (typeof body === "string") {
    const text = body.trim()
    if (!text) return {}
    const json = tryJson(text)
    if (json !== undefined) return json
    // `a=1&b=2` sent as text — read it as form fields.
    if (text.includes("=")) {
      return coerce(Object.fromEntries(new URLSearchParams(text)))
    }
    return {}
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return body ?? {}
  }

  const entries = Object.entries(body as Record<string, unknown>)
  // A JSON document posted as urlencoded parses into ONE key that is the
  // document itself, with an empty value.
  if (entries.length === 1 && entries[0][1] === "") {
    const json = tryJson(entries[0][0].trim())
    if (json !== undefined) return json
  }
  // Form fields carrying JSON (`data=<json>`, `payload=<json>`): decode them,
  // and unwrap a lone wrapper field so the normalizer sees the document.
  const decoded: Record<string, unknown> = {}
  for (const [key, value] of entries) {
    const json = typeof value === "string" ? tryJson(value.trim()) : undefined
    decoded[key] = json !== undefined ? json : value
  }
  if (entries.length === 1 && typeof entries[0][1] === "string") {
    const only = decoded[entries[0][0]]
    if (only && typeof only === "object") return only
  }
  return decoded
}

function tryJson(text: string): any {
  if (!/^[[{]/.test(text)) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === "object") return Object.keys(value as object).length === 0
  return true
}
