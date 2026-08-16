/**
 * Map an `/admin/*` request to the scope rung it requires (#1306).
 *
 * ── Why this has to exist ─────────────────────────────────────────────────────
 *
 * The HTTP guard shipped in #1308 asked one question — "does this credential
 * reach `write`?" — and let every mutation through once the answer was yes. That
 * was harmless while `write` and `read` exposed the same 54 tools, because no
 * row could sit at `write` and mean anything. The moment `write` becomes a real
 * rung it stops being harmless: a `write`-scoped credential would see 63 tools
 * over MCP and still be able to POST `/admin/orders/:id/shipping-label`
 * directly, spending money at a carrier through the route the tool merely wraps.
 *
 * The MCP registry already states each route's rung, because every tool maps 1:1
 * to a real route. So the guard reads its requirement from the same table the
 * tool surface does, and the two cannot drift.
 *
 * ── The default for an unlisted route ─────────────────────────────────────────
 *
 * `sensitive`, which is to say: fail shut. Most `/admin/*` mutations are not
 * wrapped by any tool, and a machine credential reaching one is a route nobody
 * classified. Granting it on the strength of a `write` row would make `write`
 * mean "everything we forgot to think about" — the exact failure this replaces.
 * Credentials with no row at all are unaffected: they never reach here.
 */
import { mcpToolTier, type McpScopeLevel } from "../../../../lib/mcp-core/tiers"
import { ADMIN_MCP_TOOLS } from "./registry"

/** The rung required by a mutation no tool wraps. Fail shut. */
export const UNCLASSIFIED_ADMIN_ROUTE_TIER: McpScopeLevel = "sensitive"

type RouteMatcher = {
  method: string
  pattern: RegExp
  tier: McpScopeLevel
}

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * `/admin/designs/:id/tasks/:taskId` → `^/admin/designs/[^/]+/tasks/[^/]+$`.
 *
 * `[^/]+` rather than `.+` so a param can never swallow a path separator and
 * make one pattern match a deeper, differently-classified route.
 */
const pathToPattern = (path: string): RegExp =>
  new RegExp(
    "^" +
      path
        .split("/")
        .map((seg) => (seg.startsWith(":") ? "[^/]+" : escapeRegex(seg)))
        .join("/") +
      "$"
  )

/**
 * Built once from the static registry.
 *
 * Sorted so the STRONGEST requirement for a given (method, path) wins. Two tools
 * can wrap the same route — a broad one and a narrower one — and if they
 * disagree the guard must take the higher rung, never the first match.
 */
const buildMatchers = (): RouteMatcher[] =>
  ADMIN_MCP_TOOLS.filter((t) => !t.native && t.path)
    .map((t) => ({
      method: (t.method || "GET").toUpperCase(),
      pattern: pathToPattern(t.path!.split("?")[0].replace(/\/+$/, "")),
      tier: mcpToolTier(t),
    }))
    .filter((m) => m.method !== "GET")

let matchers: RouteMatcher[] | null = null

/**
 * The rung a machine credential needs to call `method path`.
 *
 * `path` must already be stripped of its query string and trailing slash.
 * Returns the strongest tier among matching tools, or
 * `UNCLASSIFIED_ADMIN_ROUTE_TIER` when nothing matches.
 */
export const adminRouteTier = (
  method: string,
  path: string
): McpScopeLevel => {
  matchers ??= buildMatchers()
  const verb = method.toUpperCase()

  let found: McpScopeLevel | null = null
  for (const m of matchers) {
    if (m.method !== verb || !m.pattern.test(path)) continue
    // Strongest wins; "dangerous" is the top of the ladder so we can stop there.
    if (!found || TIER_ORDER[m.tier] > TIER_ORDER[found]) found = m.tier
    if (found === "dangerous") break
  }
  return found ?? UNCLASSIFIED_ADMIN_ROUTE_TIER
}

const TIER_ORDER: Record<McpScopeLevel, number> = {
  read: 0,
  write: 1,
  sensitive: 2,
  dangerous: 3,
}

/** Test seam: drop the memoised matchers so a registry stub is picked up. */
export const __resetAdminRouteTierCache = (): void => {
  matchers = null
}
