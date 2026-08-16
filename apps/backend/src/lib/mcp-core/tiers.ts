/**
 * The MCP scope ladder, and the rung each tool sits on (#1306).
 *
 * Pure and dependency-free on purpose: the ladder is imported by the request-
 * bound resolver (`src/lib/mcp-scope.ts`), by the admin dashboard bundle, and by
 * the surface-agnostic dispatcher, and none of those should drag the others in.
 *
 * ── Why a tier exists at all ──────────────────────────────────────────────────
 *
 * `sensitive` was doing two unrelated jobs. As a UX gate it means "ask the human
 * before running this", which is why the dispatcher demands `confirm: true`. As
 * a permission it was also being read as "no third-party credential may call
 * this". Conflating them made the `write` rung grant nothing: all 59 admin write
 * tools are confirm-gated, so scoping a credential to `write` exposed exactly
 * what `read` did.
 *
 * They are separate questions. Creating a design is worth confirming in a UI and
 * is also perfectly safe for a scoped machine client — it is reversible, costs
 * nothing and touches no one outside the platform. Booking a shipping label is
 * confirm-worthy for the same reason and NOT safe, because it spends money at a
 * carrier. `sensitive` keeps its confirm meaning untouched; `tier` answers the
 * permission question independently.
 */
import type { McpToolDef } from "./types"

/**
 * The scope ladder, weakest first. A level implies every level below it, so a
 * "dangerous" token can also read. Index in this array IS the rank.
 */
export const MCP_SCOPE_LEVELS = [
  "read",
  "write",
  "sensitive",
  "dangerous",
] as const

export type McpScopeLevel = (typeof MCP_SCOPE_LEVELS)[number]

export const isMcpScopeLevel = (value: unknown): value is McpScopeLevel =>
  typeof value === "string" &&
  (MCP_SCOPE_LEVELS as readonly string[]).includes(value)

/** Rank on the ladder; unknown strings rank as the weakest level (fail shut). */
export const mcpScopeRank = (level: string): number => {
  const i = (MCP_SCOPE_LEVELS as readonly string[]).indexOf(level)
  return i === -1 ? 0 : i
}

/** The weaker of two levels — how a row is intersected with the ceiling. */
export const minMcpScope = (
  a: McpScopeLevel,
  b: McpScopeLevel
): McpScopeLevel => (mcpScopeRank(a) <= mcpScopeRank(b) ? a : b)

/** True when `level` reaches at least `required` on the ladder. */
export const mcpScopeAllows = (
  level: McpScopeLevel,
  required: McpScopeLevel
): boolean => mcpScopeRank(level) >= mcpScopeRank(required)

/**
 * The rung a tool sits on — the minimum scope a credential needs to call it.
 *
 * An explicit `tier` wins. Everything else is DERIVED to reproduce the previous
 * behaviour exactly, so a registry with no `tier` anywhere grades identically to
 * before this existed:
 *
 *   dangerous          → "dangerous"
 *   sensitive / DELETE → "sensitive"
 *   write              → "write"
 *   otherwise          → "read"
 *
 * A `tier` that would WIDEN past the derived rung is ignored. `tier: "write"` on
 * a dangerous tool would be a one-word way to hand a platform-destructive action
 * to a low-privilege client, and no such demotion is worth that footgun — the
 * dangerous rails are the one thing a registry edit must not be able to lower.
 * Demoting a merely-`sensitive` tool to `write` IS allowed; that is the point.
 */
export const mcpToolTier = (def: McpToolDef): McpScopeLevel => {
  const derived: McpScopeLevel = def.dangerous
    ? "dangerous"
    : def.sensitive || def.method === "DELETE"
      ? "sensitive"
      : def.write
        ? "write"
        : "read"

  if (!def.tier || !isMcpScopeLevel(def.tier)) return derived
  // Never below "write" for something that mutates: a read-scoped credential
  // must not reach a write tool because someone typed `tier: "read"`.
  const floor: McpScopeLevel =
    def.write || def.method === "DELETE" ? "write" : "read"
  if (def.dangerous) return "dangerous"
  return mcpScopeRank(def.tier) < mcpScopeRank(floor) ? floor : def.tier
}
