// Pure report/plan builders for the "AI platform sweep & report" maintenance
// job (#756). Kept free of any container / I/O so the coverage logic is unit
// testable: feed it a catalog (the output of `sweepAiPlatformsByCategory`) and
// the list of expected roles, get back a coverage report and an idempotent
// normalization plan. No secrets are ever surfaced — only a `hasApiKey`
// boolean.

import type { AiPlatformCatalogEntry } from "../../../../mastra/services/ai-platforms"
import { groupAiCatalogByRole } from "../../../../mastra/services/ai-platforms"

/** A platform within a role bucket, secret-free. */
export type CoveragePlatform = {
  platformId: string
  name?: string
  providerType: string | null
  defaultModel: string | null
  isDefault: boolean
  hasApiKey: boolean
  status: string
}

export type RoleCoverage = {
  role: string
  /** True when `role` is one of the expected (known) roles. */
  known: boolean
  platformCount: number
  /** At least one active, api-keyed platform → the role won't fall back to free. */
  configured: boolean
  hasDefault: boolean
  /** Flags an operator should act on. */
  flags: string[]
  platforms: CoveragePlatform[]
}

export type AiPlatformCoverageReport = {
  roles: RoleCoverage[]
  /** Counts for the summary line. */
  totals: {
    knownRoles: number
    configuredRoles: number
    freeFallbackRoles: number
    untaggedPlatforms: number
  }
  summary: string
}

const toCoveragePlatform = (e: AiPlatformCatalogEntry): CoveragePlatform => ({
  platformId: e.platformId,
  name: e.name,
  providerType: e.providerType,
  defaultModel: e.defaultModel,
  isDefault: e.isDefault,
  hasApiKey: e.hasApiKey,
  status: e.status,
})

const isUsable = (e: AiPlatformCatalogEntry): boolean =>
  e.status === "active" && e.hasApiKey

/**
 * Build a per-role coverage report from a swept catalog. Every expected role
 * appears (even with zero platforms → free-fallback), plus any extra roles the
 * operator coined. Platforms with no `metadata.role` land in the synthetic
 * `_untagged` bucket (flagged, never counted as configured).
 *
 * Pure — no container, no I/O, no secrets.
 */
export const buildAiPlatformCoverageReport = (
  catalog: AiPlatformCatalogEntry[],
  knownRoles: readonly string[]
): AiPlatformCoverageReport => {
  const grouped = groupAiCatalogByRole(catalog ?? [])

  // Union of expected roles + whatever the sweep discovered, _untagged last.
  const discovered = Object.keys(grouped).filter((r) => r !== "_untagged")
  const roleOrder: string[] = []
  for (const r of knownRoles) if (!roleOrder.includes(r)) roleOrder.push(r)
  for (const r of discovered) if (!roleOrder.includes(r)) roleOrder.push(r)
  if (grouped["_untagged"]?.length) roleOrder.push("_untagged")

  const roles: RoleCoverage[] = roleOrder.map((role) => {
    const entries = grouped[role] ?? []
    const platforms = entries.map(toCoveragePlatform)
    const usable = entries.filter(isUsable)
    const hasDefault = entries.some((e) => e.isDefault)
    const known = knownRoles.includes(role)

    const flags: string[] = []
    if (role === "_untagged") {
      flags.push("untagged-role")
    } else if (entries.length === 0) {
      flags.push("no-platform→free-fallback")
    } else {
      if (usable.length === 0) flags.push("no-usable-platform")
      if (entries.some((e) => !e.hasApiKey)) flags.push("missing-api-key")
      if (!hasDefault) flags.push("no-default")
      if (usable.length > 1 && !hasDefault) flags.push("ambiguous-default")
      if (!known) flags.push("unknown-role")
    }

    return {
      role,
      known,
      platformCount: entries.length,
      configured: role !== "_untagged" && usable.length > 0,
      hasDefault,
      flags,
      platforms,
    }
  })

  const knownRoleRows = roles.filter((r) => r.role !== "_untagged" && r.known)
  const configuredRoles = knownRoleRows.filter((r) => r.configured).length
  const freeFallbackRoles = knownRoleRows.filter((r) => !r.configured).length
  const untaggedPlatforms = grouped["_untagged"]?.length ?? 0

  const totals = {
    knownRoles: knownRoles.length,
    configuredRoles,
    freeFallbackRoles,
    untaggedPlatforms,
  }

  const fallbackNames = knownRoleRows
    .filter((r) => !r.configured)
    .map((r) => r.role)
  const summary =
    `${configuredRoles}/${knownRoles.length} known AI roles configured` +
    (freeFallbackRoles > 0
      ? `; ${freeFallbackRoles} fall back to free models (${fallbackNames.join(", ")})`
      : "") +
    (untaggedPlatforms > 0
      ? `; ${untaggedPlatforms} platform(s) have no role tag`
      : "")

  return { roles, totals, summary }
}

/** An idempotent normalization the apply pass can perform. */
export type NormalizationAction = {
  platformId: string
  role: string
  field: "metadata.is_default"
  before: boolean
  after: boolean
  reason: string
}

/**
 * Plan the safe, unambiguous normalizations. Currently one rule: a role whose
 * ONLY usable (active + keyed) platform is not marked default → mark it
 * default, so role resolution is deterministic. Idempotent: once the platform
 * is default, re-planning yields nothing. We deliberately do NOT auto-rename
 * `metadata.role` typos (too easy to mis-correct); those surface as
 * `unknown-role` / `untagged-role` flags in the report for the operator.
 *
 * Pure — returns the plan; the job performs the writes.
 */
export const planAiPlatformNormalization = (
  catalog: AiPlatformCatalogEntry[]
): NormalizationAction[] => {
  const grouped = groupAiCatalogByRole(catalog ?? [])
  const actions: NormalizationAction[] = []

  for (const [role, entries] of Object.entries(grouped)) {
    if (role === "_untagged") continue
    const usable = entries.filter(isUsable)
    const anyDefault = entries.some((e) => e.isDefault)
    if (usable.length === 1 && !anyDefault) {
      actions.push({
        platformId: usable[0].platformId,
        role,
        field: "metadata.is_default",
        before: false,
        after: true,
        reason: "sole usable platform for role — marking default",
      })
    }
  }

  return actions
}
