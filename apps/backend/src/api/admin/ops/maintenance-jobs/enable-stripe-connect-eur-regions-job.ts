import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PARTNER_PAYMENT_CONFIG_MODULE } from "../../../../modules/partner-payment-config"
import {
  CONNECT_CONFIG_PROVIDER_ID,
  resolvePartnerConnect,
} from "../../../../modules/stripe-connect-payment/lib/resolve-connect"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * #457 Data Plumbing — enable Stripe Connect on EUR regions (go-live for #838
 * Half B checkout routing).
 *
 * Stripe Connect's checkout provider (`pp_stripe-connect_stripe-connect`) is
 * registered + gated behind `STRIPE_CONNECT_ENABLED=true`, but a buyer can only
 * SELECT it at checkout if the provider is linked to that checkout's region.
 * Partner EUR storefronts use per-partner EUR region clones, so this job links
 * the provider to every `eur` region (idempotent), mirroring the one-off
 * `assign-payu-to-partner.ts` pattern but as a guarded, audited DP job.
 *
 * The per-partner connected account + application fee are resolved UPSTREAM in
 * the store payment route (`resolvePartnerConnect`) and passed to the provider
 * via the payment-session context — enabling the provider on a region NEVER
 * routes a non-partner sale into Connect (routing returns null when the cart's
 * sales channel has no owning partner with a charges_enabled account). So the
 * only effect of this job is to make the provider selectable.
 *
 * The dry-run does double duty as the go-live READINESS check (rungs 0-1 of the
 * verification ladder): it reports the flag state, whether the provider is
 * registered, the EUR regions + their current link status, AND every partner
 * that has completed Connect onboarding together with the account + fee its
 * checkout would actually resolve to. Zero money moves.
 */

/** The checkout payment provider id (id "stripe-connect" + identifier "stripe-connect"). */
export const CONNECT_PROVIDER_ID = "pp_stripe-connect_stripe-connect"

/** Hard cap on regions scanned in one call — bounds the per-request blast radius. */
export const MAX_CONNECT_REGION_SCAN = 5000

const enableConnectParamsSchema = z.object({
  /** Restrict to a single region (default: all eur regions). */
  region_id: z.string().min(1).optional(),
  /** Max regions to scan in one call (1..MAX_CONNECT_REGION_SCAN). */
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_CONNECT_REGION_SCAN)
    .optional()
    .default(1000),
})

export type RegionRow = {
  id: string
  name?: string | null
  currency_code?: string | null
  payment_providers?: Array<{ id?: string | null }> | null
}

/**
 * PURE: keep only EUR-currency regions. Case-insensitive on `currency_code`.
 * Exported for unit testing.
 */
export function selectEurRegions(regions: RegionRow[]): RegionRow[] {
  return (regions || []).filter(
    (r) => r?.id && String(r?.currency_code ?? "").toLowerCase() === "eur"
  )
}

/**
 * PURE: split EUR regions into those that still need the Connect provider link
 * and those already linked. A region needing the link becomes one `add_link`
 * change (before = its current provider ids, after = the Connect provider).
 * Exported for unit testing — no container/DB.
 */
export function computeRegionLinkChanges(
  eurRegions: RegionRow[],
  providerId: string
): { toLink: MaintenanceChange[]; alreadyLinkedIds: string[] } {
  const toLink: MaintenanceChange[] = []
  const alreadyLinkedIds: string[] = []
  for (const r of eurRegions || []) {
    if (!r?.id) continue
    const providerIds = (r.payment_providers || [])
      .map((p) => p?.id)
      .filter(Boolean) as string[]
    if (providerIds.includes(providerId)) {
      alreadyLinkedIds.push(r.id)
      continue
    }
    toLink.push({
      entity: "region",
      id: r.id,
      field: "payment_providers",
      before: providerIds.length ? providerIds.join(", ") : null,
      after: providerId,
    })
  }
  return { toLink, alreadyLinkedIds }
}

/**
 * PURE: one-line summary of the enablement action. Exported for unit testing.
 */
export function summarizeConnectEnablement(args: {
  dryRun: boolean
  eurRegionCount: number
  toLinkCount: number
  alreadyLinkedCount: number
  errorCount: number
}): string {
  const { dryRun, eurRegionCount, toLinkCount, alreadyLinkedCount, errorCount } = args
  const verb = dryRun ? "Would link" : "Linked"
  const head =
    toLinkCount === 0
      ? `No changes — all ${eurRegionCount} EUR region(s) already have Stripe Connect enabled`
      : `${verb} Stripe Connect to ${toLinkCount}/${eurRegionCount} EUR region(s); ${alreadyLinkedCount} already enabled`
  return errorCount > 0 ? `${head}; ${errorCount} error(s)` : head
}

export type ConnectedPartnerReadiness = {
  partner_id: string
  name?: string | null
  account_last4?: string | null
  charges_enabled: boolean
  /** true when resolvePartnerConnect returns a routable account for this partner. */
  routes: boolean
  /** application-fee fraction the checkout would apply (0.02 = 2%). */
  fee_percent?: number | null
}

export type ConnectReadinessInput = {
  flagEnabled: boolean
  providerRegistered: boolean
  providerEnabled: boolean
  connectedPartners: ConnectedPartnerReadiness[]
}

/**
 * PURE: render the human-facing go-live readiness digest (rungs 0-1). Exported
 * for unit testing — no container/DB. Keeps the dry-run's diagnostic value
 * verifiable without booting the modules.
 */
export function buildReadinessDigest(input: ConnectReadinessInput): string {
  const lines: string[] = ["", "Readiness:"]
  lines.push(`  • STRIPE_CONNECT_ENABLED: ${input.flagEnabled ? "true ✓" : "FALSE ✗ (provider will not load)"}`)
  lines.push(
    `  • provider ${CONNECT_PROVIDER_ID}: ${
      input.providerRegistered
        ? input.providerEnabled
          ? "registered ✓"
          : "registered but DISABLED ✗"
        : "NOT registered ✗ (check the flag + redeploy)"
    }`
  )

  if (!input.connectedPartners.length) {
    lines.push("  • connected partners: none yet — no partner has completed Stripe Connect onboarding")
    return lines.join("\n")
  }

  lines.push(`  • connected partners (${input.connectedPartners.length}):`)
  for (const p of input.connectedPartners) {
    const who = p.name ? `${p.name} (${p.partner_id})` : p.partner_id
    const acct = p.account_last4 ? `acct …${p.account_last4}` : "acct —"
    if (!p.charges_enabled) {
      lines.push(`      ✗ ${who} — ${acct}, charges NOT enabled (onboarding incomplete)`)
      continue
    }
    if (!p.routes) {
      lines.push(`      ⚠ ${who} — ${acct}, charges enabled but routing did not resolve (config inactive?)`)
      continue
    }
    const feePct =
      p.fee_percent != null ? `${(Number(p.fee_percent) * 100).toFixed(2)}% fee` : "no fee (seed plan fee)"
    lines.push(`      ✓ ${who} — routes to ${acct}, ${feePct}`)
  }
  return lines.join("\n")
}

const last4 = (id?: string | null): string | null =>
  id ? String(id).slice(-4) : null

export const enableStripeConnectEurRegionsJob: MaintenanceJob = {
  id: "enable-stripe-connect-eur-regions",
  label: "Enable Stripe Connect on EUR regions",
  description:
    `Link the Stripe Connect checkout provider (${CONNECT_PROVIDER_ID}) to every EUR region so partner EUR storefronts can select it at checkout (#838 Half B go-live). Idempotent — only links regions that don't already have it. Dry-run previews the regions it would link AND reports go-live readiness: the STRIPE_CONNECT_ENABLED flag, whether the provider is registered, and every partner that has completed Connect onboarding with the account + application fee its checkout resolves to (zero money moves). Apply creates the region↔provider links. Optionally scope to one region_id. Scans up to 'limit' regions per call (default 1000, max ${MAX_CONNECT_REGION_SCAN}).`,
  params: [
    {
      name: "region_id",
      type: "string",
      required: false,
      description: "Restrict the enablement to a single region (default: all EUR regions)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max regions to scan in one call (default 1000, max ${MAX_CONNECT_REGION_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = enableConnectParamsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { region_id, limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)

    // 1. Regions (+ their currently-linked payment providers).
    const regionGraphArgs: Record<string, unknown> = {
      entity: "region",
      fields: ["id", "name", "currency_code", "payment_providers.id"],
      pagination: { take: limit },
    }
    if (region_id) regionGraphArgs.filters = { id: region_id }
    const { data: regions } = await query.graph(regionGraphArgs as any)

    const eurRegions = selectEurRegions((regions ?? []) as RegionRow[])
    const { toLink, alreadyLinkedIds } = computeRegionLinkChanges(eurRegions, CONNECT_PROVIDER_ID)

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []

    for (const change of toLink) {
      if (!dry_run) {
        try {
          await remoteLink.create({
            [Modules.REGION]: { region_id: change.id },
            [Modules.PAYMENT]: { payment_provider_id: CONNECT_PROVIDER_ID },
          })
        } catch (e: any) {
          errors.push({ id: change.id, message: e?.message ?? String(e) })
          continue
        }
      }
      changes.push(change)
    }

    // 2. Readiness digest (always computed — the dry-run's go-live value).
    const flagEnabled = process.env.STRIPE_CONNECT_ENABLED === "true"

    let providerRegistered = false
    let providerEnabled = false
    try {
      const { data: providers } = await query.graph({
        entity: "payment_provider",
        fields: ["id", "is_enabled"],
      })
      const prov = (providers ?? []).find((p: any) => p?.id === CONNECT_PROVIDER_ID)
      providerRegistered = !!prov
      providerEnabled = !!prov?.is_enabled
    } catch {
      // leave defaults — reported as "not registered"
    }

    const connectedPartners: ConnectedPartnerReadiness[] = []
    try {
      const configService: any = container.resolve(PARTNER_PAYMENT_CONFIG_MODULE)
      const configs = await configService.listPartnerPaymentConfigs({
        provider_id: CONNECT_CONFIG_PROVIDER_ID,
      })
      const onboarded = (configs ?? []).filter((c: any) => c?.connect_account_id)

      if (onboarded.length) {
        const partnerIds = Array.from(new Set(onboarded.map((c: any) => c.partner_id).filter(Boolean)))
        const { data: partners } = await query.graph({
          entity: "partners",
          fields: ["id", "name", "stores.default_sales_channel_id"],
          filters: { id: partnerIds },
        })
        const partnerById = new Map(
          (partners ?? []).map((p: any) => [p.id, p])
        )
        const defaultFee = Number(process.env.STRIPE_CONNECT_DEFAULT_FEE_PERCENT || 0) || 0

        for (const cfg of onboarded) {
          const partner: any = partnerById.get(cfg.partner_id)
          const salesChannelId = (partner?.stores ?? [])
            .map((s: any) => s?.default_sales_channel_id)
            .find(Boolean)
          let routes = false
          let feePercent: number | null = null
          if (cfg.connect_charges_enabled && salesChannelId) {
            try {
              const resolved = await resolvePartnerConnect(container, salesChannelId, defaultFee)
              if (resolved && resolved.connect_account_id === cfg.connect_account_id) {
                routes = true
                feePercent = resolved.fee_percent
              }
            } catch {
              // routing did not resolve — reported as ⚠ in the digest
            }
          }
          connectedPartners.push({
            partner_id: cfg.partner_id,
            name: partner?.name ?? null,
            account_last4: last4(cfg.connect_account_id),
            charges_enabled: !!cfg.connect_charges_enabled,
            routes,
            fee_percent: feePercent,
          })
        }
      }
    } catch {
      // config module unavailable — omit the partner section
    }

    const summary =
      summarizeConnectEnablement({
        dryRun: dry_run,
        eurRegionCount: eurRegions.length,
        toLinkCount: toLink.length,
        alreadyLinkedCount: alreadyLinkedIds.length,
        errorCount: errors.length,
      }) +
      "\n" +
      buildReadinessDigest({ flagEnabled, providerRegistered, providerEnabled, connectedPartners })

    return {
      job_id: enableStripeConnectEurRegionsJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary,
      changes,
      errors,
    }
  },
}

export default enableStripeConnectEurRegionsJob
