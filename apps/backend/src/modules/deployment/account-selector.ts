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
  /** Non-secret provider config; carries `shared_project_id`/`shared_project_name`. */
  api_config?: Record<string, any> | null
}

export type ProvisioningMode = "shared" | "dedicated"

export type SharedProjectConfig = {
  mode: ProvisioningMode
  /** Provider project id/name to attach the tenant's domain to (shared mode only). */
  sharedProjectId: string | null
  sharedProjectName: string | null
}

/**
 * PURE: decide whether a NEW storefront provisions onto a SHARED, pre-deployed
 * multi-tenant project (attach-domain-only) or gets its own DEDICATED deploy.
 *
 * Shared mode requires BOTH:
 *   1. the provider supports it (everything except Netlify), and
 *   2. a shared project id is configured — from the chosen account's
 *      `api_config.shared_project_id` (multi-account path) or a
 *      `<PROVIDER>_SHARED_PROJECT_ID` env var (legacy env path).
 * Otherwise it falls back to a dedicated deploy (the pre-existing behaviour), so
 * this is a no-op until a shared project is actually configured.
 */
export function resolveProvisioningMode(
  provider: DeploymentProvider,
  opts: {
    apiConfig?: Record<string, any> | null
    env?: Record<string, string | undefined>
  } = {}
): SharedProjectConfig {
  const dedicated: SharedProjectConfig = {
    mode: "dedicated",
    sharedProjectId: null,
    sharedProjectName: null,
  }

  // Netlify (single primary custom_domain per site) can never be shared.
  if (provider === "netlify") return dedicated

  const cfg = opts.apiConfig ?? {}
  const env = opts.env ?? {}
  const envKey = provider.toUpperCase()

  const sharedProjectId =
    (cfg.shared_project_id as string | undefined) ||
    env[`${envKey}_SHARED_PROJECT_ID`] ||
    // Cloudflare Workers addresses by name — accept the worker name as the id.
    (provider === "cloudflare"
      ? (cfg.shared_worker_name as string | undefined) ||
        env.CLOUDFLARE_SHARED_WORKER_NAME
      : undefined) ||
    null

  if (!sharedProjectId) return dedicated

  const sharedProjectName =
    (cfg.shared_project_name as string | undefined) ||
    env[`${envKey}_SHARED_PROJECT_NAME`] ||
    sharedProjectId

  return { mode: "shared", sharedProjectId, sharedProjectName }
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

/**
 * The provisioning target for a NEW storefront: which account (multi-account
 * rotation) or which env-single-account provider (legacy fallback) to place it
 * on. PURE — the workflow feeds it the DB accounts + which providers have env
 * creds configured, and gets back a decision (or null → capacity exhausted).
 */
export type ProvisionTarget =
  | { kind: "account"; accountId: string; provider: DeploymentProvider }
  | { kind: "env"; provider: DeploymentProvider }

export type DecideProvisionOptions = {
  /** Provider to prefer for new partners (default target, e.g. "cloudflare"). */
  preferredProvider?: DeploymentProvider
  /** Providers that have legacy env-single-account creds configured. */
  envProviders?: DeploymentProvider[]
}

/**
 * Decide where a new storefront provisions:
 *   1. A rotatable account of the PREFERRED provider (least-loaded under cap).
 *   2. Else any rotatable account of ANY provider (cross-provider fallback so a
 *      full Cloudflare pool spills onto Netlify/Render, etc.).
 *   3. Else the legacy env account — preferred provider if it has env creds,
 *      otherwise the first configured env provider (keeps pre-#884 deploys
 *      working with zero accounts configured).
 * Returns null when nothing is eligible (caller alerts: add / round-up an account).
 */
export function decideProvisionTarget(
  accounts: DeploymentAccountRow[],
  opts: DecideProvisionOptions = {}
): ProvisionTarget | null {
  const preferred = opts.preferredProvider
  const envProviders = opts.envProviders ?? []

  // 1. preferred-provider account
  if (preferred) {
    const acct = selectDeploymentAccount(accounts, { provider: preferred })
    if (acct) return { kind: "account", accountId: acct.id, provider: acct.provider }
  }

  // 2. any-provider account (cross-provider spillover)
  const anyAcct = selectDeploymentAccount(accounts)
  if (anyAcct) return { kind: "account", accountId: anyAcct.id, provider: anyAcct.provider }

  // 3. legacy env fallback
  if (preferred && envProviders.includes(preferred)) {
    return { kind: "env", provider: preferred }
  }
  if (envProviders.length) {
    return { kind: "env", provider: envProviders[0] }
  }

  return null
}
