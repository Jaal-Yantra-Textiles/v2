/**
 * PURE deployment-account selection — least-loaded-under-cap rotation. No IO;
 * unit-testable. The workflow resolves the accounts list, calls this to pick
 * one, then increments its project_count on success.
 */

export type DeploymentProvider = "vercel" | "cloudflare" | "render" | "netlify"

export type DeploymentAccountRow = {
  id: string
  provider: DeploymentProvider
  label: string
  cutoff_max?: number | null
  project_count?: number | null
  priority?: number | null
  status?: "active" | "full" | "inactive"
}

/** PURE: projects still allowed on this account (Infinity when uncapped). */
export function remainingCapacity(a: DeploymentAccountRow): number {
  const cap = a.cutoff_max
  if (cap == null || !Number.isFinite(cap)) return Infinity
  return Math.max(0, cap - (a.project_count ?? 0))
}

/** PURE: is this account at/over its cutoff cap? */
export function isFull(a: DeploymentAccountRow): boolean {
  return remainingCapacity(a) <= 0
}

/** PURE: eligible = active status AND under its cap. */
export function isEligible(a: DeploymentAccountRow): boolean {
  return (a.status ?? "active") === "active" && !isFull(a)
}

export type SelectOptions = {
  /** restrict to one provider (e.g. only Cloudflare). */
  provider?: DeploymentProvider
}

/**
 * Pick the account a new storefront should provision onto:
 *   1. eligible only (active + under cutoff), optionally provider-filtered
 *   2. least-loaded first (fewest projects) — spreads load
 *   3. tiebreak: higher priority, then most remaining capacity, then label
 * Returns null when nothing is eligible (caller should alert: add or round-up an
 * account).
 */
export function selectDeploymentAccount(
  accounts: DeploymentAccountRow[],
  opts: SelectOptions = {}
): DeploymentAccountRow | null {
  const pool = (accounts ?? [])
    .filter((a) => (opts.provider ? a.provider === opts.provider : true))
    .filter(isEligible)

  if (!pool.length) return null

  pool.sort((a, b) => {
    const la = a.project_count ?? 0
    const lb = b.project_count ?? 0
    if (la !== lb) return la - lb // least-loaded first
    const pa = a.priority ?? 0
    const pb = b.priority ?? 0
    if (pa !== pb) return pb - pa // higher priority first
    const ra = remainingCapacity(a)
    const rb = remainingCapacity(b)
    if (ra !== rb) return rb - ra // more headroom first
    return a.label.localeCompare(b.label)
  })

  return pool[0]
}
