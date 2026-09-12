/**
 * Time-window parsing for the MCP usage ledger.
 *
 * The ledger is `ai_usage_event` rows filtered by `created_at`; without an
 * explicit window a query can only ever return the newest N rows, which reads
 * as "no usage" for every older period. This module owns the two ways a caller
 * can state a window (`days` — last N days from now — or explicit `from`/`to`
 * ISO dates) and the conversion of both into the `Date` filter the service
 * applies. Lives apart from the route so it can be unit-tested directly: the
 * defect it exists to prevent is `new Date("garbage")`, which is an Invalid
 * Date that silently widens the filter to everything.
 */
import { MedusaError } from "@medusajs/framework/utils"

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Parse one explicit boundary. `undefined`/`null`/`""` mean "absent" — a
 * caller that sent nothing must not be coerced into a filter. Anything else
 * that does not parse as a date is refused: an Invalid Date would widen the
 * window to all time instead of narrowing it.
 */
export const parseDateBoundary = (
  value: unknown,
  name: "from" | "to"
): Date | undefined => {
  if (value === undefined || value === null || value === "") return undefined
  const date = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(date.getTime())) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Invalid ${name} "${String(value)}" — not a parseable ISO 8601 date. Pass e.g. 2026-09-01T00:00:00Z, or use days instead.`
    )
  }
  return date
}

/**
 * The effective window for a request.
 *
 * `days` and explicit `from`/`to` are alternatives; when both are given the
 * explicit dates win, because they state exactly what the caller meant and a
 * convenience window should never override a precise one. `days` must be a
 * positive finite number — `"garbage"`, `NaN`, `0` and negatives are all
 * refused rather than silently treated as "no window".
 */
export const parseMcpUsageWindow = (input: {
  days?: unknown
  from?: unknown
  to?: unknown
}): { from?: Date; to?: Date } => {
  const from = parseDateBoundary(input.from, "from")
  const to = parseDateBoundary(input.to, "to")
  if (from || to) return { from, to }

  if (input.days !== undefined && input.days !== null && input.days !== "") {
    const days = Number(input.days)
    if (!Number.isFinite(days) || days <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Invalid days "${String(input.days)}" — must be a positive finite number (e.g. 7 for the last week).`
      )
    }
    const now = new Date()
    return { from: new Date(now.getTime() - days * DAY_MS), to: now }
  }

  return {}
}

/**
 * The service-side conversion: `Date | string` boundaries into the
 * `created_at` MikroORM filter. Strings are validated here too, so an Invalid
 * Date can never reach the query. Returns `undefined` when neither boundary is
 * present, so the caller keeps the "no time filter" shape identical to before.
 */
export const createdWindowFilter = (
  from?: Date | string,
  to?: Date | string
): { $gte?: Date; $lte?: Date } | undefined => {
  const gte = parseDateBoundary(from, "from")
  const lte = parseDateBoundary(to, "to")
  if (!gte && !lte) return undefined
  return {
    ...(gte ? { $gte: gte } : {}),
    ...(lte ? { $lte: lte } : {}),
  }
}