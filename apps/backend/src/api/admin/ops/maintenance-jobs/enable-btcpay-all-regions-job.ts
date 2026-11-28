import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { computeRegionLinkChanges, type RegionRow } from "./enable-stripe-connect-eur-regions-job"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Bitcoin (BTCPay) — make `pp_bitcoin_btc` selectable at checkout in EVERY
 * region: the main store's and every partner storefront's (all currencies;
 * BTCPay converts the cart currency at the store's rate source).
 *
 * Linking only makes the method selectable. Where a partner's sale lands is
 * decided per session (their BTCPay store, else ours) — see
 * modules/btcpay-payment/lib/resolve-partner-store.ts.
 *
 * Dry-run lists the regions it would link and whether the provider is loaded
 * (it only loads when all four BTCPAY_* env vars are set). Idempotent.
 */
export const BTCPAY_PROVIDER_ID = "pp_bitcoin_btc"

const paramsSchema = z.object({
  region_id: z.string().min(1).optional(),
  limit: z.number().int().positive().max(5000).optional().default(1000),
})

export const enableBtcpayAllRegionsJob: MaintenanceJob = {
  id: "enable-btcpay-all-regions",
  label: "Enable Bitcoin (BTCPay) in all regions",
  description:
    `Link the Bitcoin checkout provider (${BTCPAY_PROVIDER_ID}) to every region — main store and partner storefronts — so buyers can choose Bitcoin. Idempotent. Dry-run previews the regions and reports whether the provider is loaded (needs BTCPAY_SERVER_URL, BTCPAY_SERVER_KEY, BTCPAY_SERVER_ID, BTCPAY_WEBHOOK_SECRET). Optionally scope to one region_id.`,
  params: [
    { name: "region_id", type: "string", required: false, description: "Only this region (default: all regions)" },
    { name: "limit", type: "number", required: false, description: "Max regions to scan (default 1000, max 5000)" },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, parsed.error.issues.map((i) => i.message).join("; "))
    }
    const { region_id, limit } = parsed.data
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const link: any = container.resolve(ContainerRegistrationKeys.LINK)

    const { data: providers } = await query
      .graph({ entity: "payment_provider", fields: ["id", "is_enabled"] })
      .catch(() => ({ data: [] }))
    const prov = (providers ?? []).find((p: any) => p?.id === BTCPAY_PROVIDER_ID)
    if (!prov && !dry_run) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `${BTCPAY_PROVIDER_ID} is not registered — set the four BTCPAY_* env vars and redeploy first`
      )
    }

    const { data: regions } = await query.graph({
      entity: "region",
      fields: ["id", "name", "currency_code", "payment_providers.id"],
      pagination: { take: limit },
      ...(region_id ? { filters: { id: region_id } } : {}),
    })
    const all = (regions ?? []) as RegionRow[]
    const { toLink, alreadyLinkedIds } = computeRegionLinkChanges(all, BTCPAY_PROVIDER_ID)

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    for (const c of toLink) {
      if (!dry_run) {
        try {
          await link.create({
            [Modules.REGION]: { region_id: c.id },
            [Modules.PAYMENT]: { payment_provider_id: BTCPAY_PROVIDER_ID },
          })
        } catch (e: any) {
          errors.push({ id: c.id, message: e?.message ?? String(e) })
          continue
        }
      }
      changes.push(c)
    }

    const providerLine = prov
      ? `provider ${BTCPAY_PROVIDER_ID}: registered${prov.is_enabled ? " ✓" : " but DISABLED ✗"}`
      : `provider ${BTCPAY_PROVIDER_ID}: NOT registered ✗ (set BTCPAY_* env vars + redeploy)`
    const verb = dry_run ? "Would link" : "Linked"
    const head =
      toLink.length === 0
        ? `No changes — all ${all.length} region(s) already offer Bitcoin`
        : `${verb} Bitcoin to ${toLink.length}/${all.length} region(s); ${alreadyLinkedIds.length} already had it`

    return {
      job_id: enableBtcpayAllRegionsJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary: `${head}${errors.length ? `; ${errors.length} error(s)` : ""}\n${providerLine}`,
      changes,
      errors,
    }
  },
}

export default enableBtcpayAllRegionsJob
