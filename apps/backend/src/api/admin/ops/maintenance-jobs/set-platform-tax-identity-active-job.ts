import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PLATFORM_TAX_IDENTITY_MODULE } from "../../../../modules/platform-tax-identity"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * #348 Data Plumbing — activate / deactivate a platform tax identity by brand.
 *
 * ## Why this is a job and not an admin route
 *
 * `platform_tax_identity` rows are seeded by migration and there is no write
 * route for them — `api/admin/platform-tax-identities` is GET only. That is the
 * right default for a table whose values go on customs paperwork, but it left
 * no supported way to retire a row that turned out to be wrong.
 *
 * ## The row this was written for
 *
 * `KHT` (Kind Health Tech SIA) was seeded as `tax_id_type: "eu_vat"`, tax_id
 * `40203579735`, covering all 27 EU member states. Three things are wrong with
 * that:
 *
 *  1. KHT is NOT VAT-registered — it is below the Latvian threshold.
 *     `40203579735` is its Uzņēmumu reģistrs company number. An EU VAT number
 *     would be that number with an `LV` prefix, and only exists on registration.
 *  2. KHT ships nothing. It invoices and collects on JYT's behalf while goods go
 *     direct from India, so it is never the exporter of record and has no
 *     business answering a shipping-label lookup.
 *  3. Until #348's ship-from fix, `resolveSellerTaxIdForOrder` was keyed on the
 *     CONSIGNEE, so a shipment to Germany resolved this row and stamped a
 *     Latvian company number on an India-origin export declaration.
 *
 * 🔑 Deactivation is the ONLY lever. `resolvePlatformTaxIdString` returns
 * `tax_id` without ever reading `tax_id_type`, so relabelling the row does not
 * take the number out of the label path — it just makes the row honest about
 * what it holds while it keeps being stamped. Dropping the country codes would
 * also work; deactivating keeps the record intact for the day KHT registers,
 * which is what `is_active` is documented for ("Disabled rows are skipped by the
 * resolver without being deleted").
 *
 * Generic on purpose: takes a brand and a target state, so re-activating after
 * registration needs no new code. Idempotent — a row already in the target state
 * is reported as no change.
 */

const paramsSchema = z.object({
  /** Brand handle of the identity to toggle, e.g. "KHT" or "JYT". */
  brand_code: z.string().min(1),
  /** Target state. `false` retires the row from every resolver. */
  is_active: z.boolean(),
})

export const setPlatformTaxIdentityActiveJob: MaintenanceJob = {
  id: "set-platform-tax-identity-active",
  label: "Activate / deactivate a platform tax identity",
  description:
    "Set is_active on the platform_tax_identity row(s) for a brand_code. Deactivating retires the row from the seller-tax-ID fallback that stamps carrier labels and customs declarations, without deleting it. Written for KHT (Kind Health Tech SIA), seeded as an EU VAT identity for an entity that is not VAT-registered and never ships. NOTE: relabelling tax_id_type does NOT retire a row — resolvePlatformTaxIdString returns tax_id without reading the type, so is_active is the only lever. Apply writes; dry-run reports what would change.",
  params: [
    {
      name: "brand_code",
      type: "string",
      required: true,
      description: 'Brand handle of the identity, e.g. "KHT"',
    },
    {
      name: "is_active",
      type: "boolean",
      required: true,
      description: "Target state — false retires the row from every resolver",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { brand_code, is_active } = parsed.data

    const service: any = container.resolve(PLATFORM_TAX_IDENTITY_MODULE)

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []

    // Listed by brand rather than fetched by id: the id is a generated ULID that
    // differs per environment, so an ops call that names one cannot be copied
    // from staging to prod. The brand handle is stable and is what a human
    // reading the ops log will recognise.
    const rows: any[] = await service.listPlatformTaxIdentities({ brand_code })

    if (!rows.length) {
      return {
        job_id: setPlatformTaxIdentityActiveJob.id,
        dry_run,
        applied: false,
        summary: `No platform tax identity found for brand_code "${brand_code}"`,
        changes: [],
      }
    }

    for (const row of rows) {
      const before = row?.is_active !== false
      if (before === is_active) {
        continue // already in the target state
      }
      try {
        const change: MaintenanceChange = {
          entity: "platform_tax_identity",
          id: row.id,
          field: "is_active",
          before: String(before),
          after: String(is_active),
        }
        if (!dry_run) {
          await service.updatePlatformTaxIdentities({ id: row.id, is_active })
        }
        changes.push(change)
      } catch (e: any) {
        errors.push({ id: row?.id ?? brand_code, message: e?.message ?? String(e) })
      }
    }

    const verb = dry_run ? "Would set" : "Set"
    const summary =
      changes.length === 0
        ? `No changes — every "${brand_code}" identity is already is_active=${is_active}`
        : `${verb} is_active=${is_active} on ${changes.length} "${brand_code}" identity row(s)` +
          (errors.length ? `; ${errors.length} error(s)` : "")

    return {
      job_id: setPlatformTaxIdentityActiveJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary,
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}

export default setPlatformTaxIdentityActiveJob
