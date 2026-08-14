import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * #1285 — general-purpose repair for `fulfillment.data` (and provider attribution).
 *
 * WHY THIS EXISTS
 * ---------------
 * `fulfillment.data` is a free-form JSON column that every carrier adapter
 * writes its own response into. When an order moves carrier mid-flight, the new
 * carrier's values land ON TOP of the old carrier's — they do not replace them.
 * Order 83 is the worked example: it carries a Blue Dart AWB, tracking URL and
 * `provider_refs` sitting on a Delhivery manifest response, so `data.name` still
 * reads "Delhivery Express" and `data.packages[0].client` is still a Delhivery
 * account string.
 *
 * ⚠️ THE TRAP THIS TOOL EXISTS TO AVOID
 * -------------------------------------
 * `updateFulfillment` MERGES `data`. `delete`-ing a key is a SILENT NO-OP, and
 * passing a "full replacement object" that simply omits a key leaves the old key
 * in place — a green write that changed nothing. This cost a session in #1293,
 * where a pure-function unit test passed for months while prod kept the stale
 * refs. Medusa's own docs describe `data` as replaced wholesale; prod disagrees.
 *
 * **To clear a key you must WRITE `null` to it.** That is correct under BOTH
 * semantics, so this job always does that and never relies on omission.
 *
 * WHAT IT DOES
 * ------------
 * Three independent operations, any combination, on one order or one fulfillment:
 *
 *   clear_keys      → write null over the named top-level `data` keys
 *   set             → write explicit key/value pairs onto `data`
 *   align_provider  → repoint `fulfillment.provider_id` at the provider that
 *                     matches `data.carrier`
 *
 * `align_provider` is the one that is NOT cosmetic. Core routes cancellation on
 * `provider_id`, so a fulfillment holding a Blue Dart AWB while attributed to
 * `delhivery_delhivery` would ask the WRONG carrier to cancel it. The column is
 * absent from `UpdateFulfillmentDTO` and is an FK to `fulfillment_provider`, so
 * this verifies the target provider row EXISTS before writing and refuses
 * otherwise — an FK violation mid-run is a worse outcome than a clear refusal.
 *
 * Dry-run (the default) previews every before→after without writing. Apply is
 * idempotent: a second run finds the keys already null and reports no changes.
 */

/** Keys that carry live shipment identity — refused unless `force` is set. */
export const PROTECTED_DATA_KEYS = [
  "carrier",
  "waybill",
  "tracking_number",
  "tracking_url",
  "provider_refs",
  "cancelled_shipments",
]

/** Hard cap on fulfillments touched in one call. */
export const MAX_FULFILLMENTS = 200

const paramsSchema = z
  .object({
    order_id: z.string().min(1).optional(),
    fulfillment_id: z.string().min(1).optional(),
    clear_keys: z.array(z.string().min(1)).optional().default([]),
    set: z.record(z.string(), z.unknown()).optional().default({}),
    align_provider: z.boolean().optional().default(false),
    /** Permit clearing a PROTECTED_DATA_KEY. Deliberately explicit. */
    force: z.boolean().optional().default(false),
    limit: z.number().int().positive().max(MAX_FULFILLMENTS).optional().default(50),
  })
  .refine((v) => v.order_id || v.fulfillment_id, {
    message: "Pass order_id or fulfillment_id",
  })
  .refine(
    (v) => v.clear_keys.length > 0 || Object.keys(v.set).length > 0 || v.align_provider,
    { message: "Nothing to do: pass clear_keys, set, or align_provider" }
  )

/**
 * PURE: the `data` patch that clears `keys` and applies `set`.
 *
 * Only keys actually PRESENT and not already null are cleared, so the result is
 * a faithful "what changed" record rather than a wall of no-op nulls. Exported
 * for unit testing.
 */
export function buildDataPatch(
  data: Record<string, unknown> | null | undefined,
  keys: string[],
  set: Record<string, unknown>
): Record<string, unknown> {
  const current = data ?? {}
  const patch: Record<string, unknown> = {}
  for (const k of keys) {
    if (k in current && current[k] !== null) {
      // NULL, not delete, and not omission — see the docblock.
      patch[k] = null
    }
  }
  for (const [k, v] of Object.entries(set)) {
    if (current[k] !== v) patch[k] = v
  }
  return patch
}

/**
 * PURE: which requested keys are protected and were not force-approved.
 * Exported for unit testing.
 */
export function refusedKeys(keys: string[], force: boolean): string[] {
  if (force) return []
  return keys.filter((k) => PROTECTED_DATA_KEYS.includes(k))
}

/**
 * PURE: the provider id a fulfillment SHOULD carry, given `data.carrier`.
 * Medusa ids are `<provider>_<id>`, which for our carriers is the carrier
 * doubled (`bluedart_bluedart`). Returns null when there is nothing to align —
 * no carrier recorded, or it already matches. Exported for unit testing.
 */
export function targetProviderId(fulfillment: any): string | null {
  const carrier = String(fulfillment?.data?.carrier ?? "").trim().toLowerCase()
  if (!carrier) return null
  const target = `${carrier}_${carrier}`
  return fulfillment?.provider_id === target ? null : target
}

export const cleanOrderFulfillmentDataJob: MaintenanceJob = {
  id: "clean-order-fulfillment-data",
  label: "Clean stale carrier residue off order fulfillments (#1285)",
  description:
    "Repair fulfillment.data after a carrier switch. `updateFulfillment` MERGES data, so deleting a key is a silent no-op and omitting it from a 'full replacement' leaves it in place — this job always WRITES NULL, which works under both semantics. clear_keys nulls the named top-level keys; set writes explicit values; align_provider repoints provider_id at the provider matching data.carrier (not cosmetic — core routes cancellation on provider_id, so a mismatch asks the wrong carrier to cancel). Keys carrying live shipment identity (carrier, waybill, tracking_number, tracking_url, provider_refs, cancelled_shipments) are refused unless force=true. Dry-run previews every before→after; apply is idempotent.",
  params: [
    { name: "order_id", type: "string", required: false, description: "Repair every fulfillment on this order" },
    { name: "fulfillment_id", type: "string", required: false, description: "Repair a single fulfillment (wins over order_id)" },
    { name: "clear_keys", type: "string", required: false, description: "JSON array of top-level data keys to null out, e.g. [\"id\",\"name\",\"mode\"]" },
    { name: "set", type: "string", required: false, description: "JSON object of data key/values to write, e.g. {\"name\":\"Blue Dart Domestic Priority\"}" },
    { name: "align_provider", type: "boolean", required: false, description: "Repoint provider_id at the provider matching data.carrier (verifies the provider row exists first)" },
    { name: "force", type: "boolean", required: false, description: "Permit clearing a protected key" },
    { name: "limit", type: "number", required: false, description: `Max fulfillments in one call (default 50, max ${MAX_FULFILLMENTS})` },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { order_id, fulfillment_id, clear_keys, set, align_provider, force, limit } =
      parsed.data

    const refused = refusedKeys(clear_keys, force)
    if (refused.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Refusing to clear protected key(s): ${refused.join(", ")}. These carry live shipment identity — pass force=true only if you are certain.`
      )
    }

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const fulfillmentModule: any = container.resolve(Modules.FULFILLMENT)
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

    // --- load the target fulfillments ---------------------------------------
    let fulfillments: any[] = []
    if (fulfillment_id) {
      const { data } = await query.graph({
        entity: "fulfillment",
        filters: { id: fulfillment_id },
        fields: ["id", "provider_id", "data", "canceled_at"],
      })
      fulfillments = data ?? []
    } else {
      const { data } = await query.graph({
        entity: "order",
        filters: { id: order_id },
        fields: [
          "id",
          "display_id",
          "fulfillments.id",
          "fulfillments.provider_id",
          "fulfillments.data",
          "fulfillments.canceled_at",
        ],
      })
      fulfillments = (data?.[0]?.fulfillments ?? []).slice(0, limit)
    }

    if (!fulfillments.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `No fulfillments found for ${fulfillment_id ?? order_id}`
      )
    }

    // --- provider existence check (FK safety) --------------------------------
    let knownProviderIds: Set<string> | null = null
    if (align_provider) {
      const providers = await fulfillmentModule.listFulfillmentProviders(
        {},
        { take: 200 }
      )
      knownProviderIds = new Set((providers ?? []).map((p: any) => p.id))
    }

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []

    for (const f of fulfillments) {
      const patch = buildDataPatch(f.data, clear_keys, set)
      let nextProviderId: string | null = null

      if (align_provider) {
        const target = targetProviderId(f)
        if (target && !knownProviderIds!.has(target)) {
          // Do NOT attempt the write — an FK violation would abort the run and
          // is far less useful than naming the missing provider.
          errors.push({
            id: f.id,
            message: `Cannot align provider: '${target}' is not a registered fulfillment provider. Register it (and deploy) before aligning.`,
          })
        } else if (target) {
          nextProviderId = target
        }
      }

      if (!Object.keys(patch).length && !nextProviderId) continue

      for (const [k, v] of Object.entries(patch)) {
        changes.push({
          entity: "fulfillment.data",
          id: f.id,
          field: k,
          before: (f.data ?? {})[k],
          after: v,
        })
      }
      if (nextProviderId) {
        changes.push({
          entity: "fulfillment",
          id: f.id,
          field: "provider_id",
          before: f.provider_id,
          after: nextProviderId,
        })
      }

      if (dry_run) continue

      try {
        if (Object.keys(patch).length) {
          // Merge semantics: this patch is applied ON TOP of existing data, and
          // the nulls in it are what actually clear the stale keys.
          await fulfillmentModule.updateFulfillment(f.id, { data: patch })
        }
        if (nextProviderId) {
          // `provider_id` is absent from UpdateFulfillmentDTO, but updateFulfillment_
          // spreads `data` straight into the underlying update — the same
          // deliberate, load-bearing cast used by backfill-open-order-requires-shipping.
          await fulfillmentModule.updateFulfillment(f.id, {
            provider_id: nextProviderId,
          } as any)
        }
        logger?.info?.(
          `[clean-order-fulfillment-data] repaired ${f.id} (${Object.keys(patch).join(", ") || "provider only"}${nextProviderId ? ` → ${nextProviderId}` : ""})`
        )
      } catch (e: any) {
        errors.push({ id: f.id, message: e?.message ?? String(e) })
      }
    }

    const dataChanges = changes.filter((c) => c.entity === "fulfillment.data").length
    const providerChanges = changes.filter((c) => c.field === "provider_id").length
    const applied = !dry_run && changes.length > 0 && errors.length === 0

    return {
      job_id: "clean-order-fulfillment-data",
      dry_run,
      applied,
      summary: changes.length
        ? `${dry_run ? "Would repair" : "Repaired"} ${dataChanges} data key(s) and ${providerChanges} provider attribution(s) across ${fulfillments.length} fulfillment(s)${errors.length ? `; ${errors.length} error(s)` : ""}`
        : `Nothing to repair across ${fulfillments.length} fulfillment(s)`,
      changes,
      ...(errors.length ? { errors } : {}),
    }
  },
}
