/**
 * One answer to "what do I do with a failed tracking request", shared by the
 * three public `/web` tracking endpoints.
 *
 * ## The problem this replaces
 *
 * All three routes had the same chain: `schema.parse()` inside the handler →
 * an empty body throws → `catch` logs the full zod dump and stack at ERROR
 * level → responds `200 {success: true}`. Two things were wrong with it, and
 * they pull in opposite directions:
 *
 * 1. **A non-event was logged as an incident.** A bot POSTing `{}` got the same
 *    error-level treatment as a real pipeline failure — ~175/week of it, drowning
 *    genuine errors in CloudWatch.
 * 2. **The client was told it succeeded.** A real storefront whose tracker booted
 *    without a resolved `website_id` was indistinguishable from that bot, because
 *    both received `success: true`.
 *
 * So the fix is not "log less" or "fail louder" — it is to stop treating two
 * different situations as one:
 *
 * | situation | log | status |
 * |---|---|---|
 * | malformed request (the caller's fault) | ONE warn line, no stack | **400** |
 * | unexpected failure (ours — DB/Redis down) | error + stack, as before | 200 |
 *
 * 🔑 The 200-swallow is KEPT for our own failures on purpose. These endpoints are
 * called from a `<script>` on someone else's page; an outage in our write path
 * must never surface as a console error on a customer's storefront.
 */

/**
 * Why a body was rejected. Split three ways rather than two because the middle
 * case is the ONLY one worth waking someone for.
 */
export type TrackingRejectionKind =
  /** Not an object at all, or an empty one: a bot, a probe, a health check. Background radiation. */
  | "not_an_object"
  /**
   * A real request that forgot who it is about. This is the shape a genuine
   * storefront produces when its tracker booted before `website_id` resolved —
   * the case the old code hid by answering `success: true`. Given its own kind
   * so a log filter can alert on it WITHOUT drowning in bot noise.
   */
  | "missing_website_id"
  /** Well-formed intent, wrong details (bad enum, wrong type). */
  | "malformed"

export type TrackingRejection = {
  kind: TrackingRejectionKind
  /** Field paths zod complained about — names only, never values. */
  fields: string[]
}

/**
 * Duck-typed rather than `instanceof ZodError`: the schemas come from
 * `@medusajs/framework/zod`, and an `instanceof` across a re-exported module
 * copy is a silent false — it would send every validation failure down the
 * "unexpected failure" branch and restore the noise this exists to remove.
 */
export const isValidationError = (error: unknown): boolean => {
  const e = error as any
  return !!e && (e.name === "ZodError" || Array.isArray(e?.issues))
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v)

/**
 * Which of the three situations this is. Pure, so it can be tested without a
 * server — the classification is the part with the actual judgement in it.
 */
export const classifyTrackingRejection = (
  body: unknown,
  error: unknown
): TrackingRejection => {
  const issues = ((error as any)?.issues ?? []) as Array<{ path?: unknown[] }>
  const fields = Array.from(
    new Set(
      issues
        .map((i) => (Array.isArray(i?.path) ? i.path.join(".") : ""))
        .filter(Boolean)
    )
  ) as string[]

  // An absent body and `{}` are the same event: somebody hit the URL with
  // nothing to say. `req.body` is `{}` for a bodiless POST, so both land here.
  if (!isPlainObject(body) || Object.keys(body).length === 0) {
    return { kind: "not_an_object", fields }
  }

  if (fields.includes("website_id")) {
    return { kind: "missing_website_id", fields }
  }

  return { kind: "malformed", fields }
}

/** One line, no stack, no zod dump — the whole point. */
export const formatTrackingWarn = (
  label: string,
  rejection: TrackingRejection
): string =>
  `[${label}] rejected (${rejection.kind})` +
  (rejection.fields.length ? `: ${rejection.fields.join(", ")}` : "")

/**
 * The shared catch body for all three routes.
 *
 * Returns `true` when it handled the error as a client-side rejection, so the
 * caller can `return`. Returns `false` when the error is OURS — the caller then
 * logs at error level and swallows into a 200, exactly as before.
 */
export const handleTrackingError = (opts: {
  error: unknown
  body: unknown
  logger: { warn: (m: string) => void; error: (m: string, e?: any) => void }
  /** Log prefix, e.g. "analytics-track". */
  label: string
  res: {
    status: (code: number) => { json: (payload: unknown) => unknown }
  }
}): boolean => {
  const { error, body, logger, label, res } = opts

  if (!isValidationError(error)) {
    return false
  }

  const rejection = classifyTrackingRejection(body, error)
  logger.warn(formatTrackingWarn(label, rejection))

  // Field NAMES only. Enough for a storefront developer to fix their tracker,
  // nothing about what was sent and no internal shape.
  res.status(400).json({
    success: false,
    message: "Invalid tracking payload",
    fields: rejection.fields,
  })

  return true
}
