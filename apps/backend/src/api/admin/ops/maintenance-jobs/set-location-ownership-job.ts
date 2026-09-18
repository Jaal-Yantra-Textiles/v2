import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { LOCATION_OWNERSHIP_MODULE } from "../../../../modules/location_ownership"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Data Plumbing — record which stock locations are OURS.
 *
 * Ownership decides whether consumption moves stock at all, and until now it
 * was inferred: the brand store was whichever store no partner linked to, and
 * its single `default_location_id` was the only place a deduction could land.
 * That inference cannot express stocking at several of our own warehouses, and
 * it breaks outright when a store exists with no partner link — prod carries
 * `Sharhlo Store`, a mis-spelled orphan of the partner-linked `Sharlho Store`,
 * which is why `resolveBrandLocationId` now throws `found 2`.
 *
 * Two modes:
 *
 * - `seed: true` proposes a row for every stock location, ALWAYS `is_core:
 *   false`. It records what is known (a partner store's location is not ours)
 *   and defaults everything it cannot establish to not-ours as well. 🔴 It
 *   never marks anything core — see the note at the seed loop for what that
 *   used to cost.
 * - `location_id` + `is_core` sets one location, which is how the orphan gets
 *   corrected and how a new warehouse is added later.
 */

const paramsSchema = z
  .object({
    /** Propose a row for every stock location, from partner linkage. */
    seed: z.boolean().optional(),
    /** Set a single location's ownership. */
    location_id: z.string().min(1).optional(),
    is_core: z.boolean().optional(),
    note: z.string().optional(),
  })
  .refine((v) => v.seed || v.location_id, {
    message: "pass seed:true to bootstrap, or location_id to set one location",
  })
  .refine((v) => !v.location_id || v.is_core !== undefined, {
    message: "is_core is required when setting a single location",
  })


/**
 * PURE: what the seed proposes for each location. Exported for unit tests.
 *
 * 🔴 The invariant this function exists to hold: **`is_core` is NEVER true.**
 *
 * It used to be `!isPartnerStoreDefaultLocation`, which is not a definition of
 * ownership — it is "we could not prove this belongs to a partner", and it
 * defaulted the unknown to OURS. That is the least safe direction for the one
 * flag deciding whether stock may leave our books.
 *
 * Measured against prod before it was changed: the old rule would have marked
 * NINE locations core. Six held nothing. One was the bench of the partner
 * holding our consigned pashminas — and marking that bench ours bypasses the
 * #2111 allocation gate entirely, making the partner's OWN stock deductible
 * from our books. Neither of the two genuinely-ours locations was in that set;
 * both were already recorded by hand and skipped as `existing`.
 *
 * A location already recorded is skipped: seeding must never undo a decision a
 * human has made.
 */
export type SeedOwnershipRow = {
  stock_location_id: string
  is_core: false
  note: string
  label: string
}

export function planSeedOwnershipRows(
  locations: Array<{ id: string; name?: string | null }>,
  partnerLocationIds: Set<string>,
  existingLocationIds: Set<string>
): SeedOwnershipRow[] {
  const rows: SeedOwnershipRow[] = []
  for (const loc of locations) {
    if (!loc?.id || existingLocationIds.has(loc.id)) {
      continue
    }
    const isPartner = partnerLocationIds.has(loc.id)
    rows.push({
      stock_location_id: loc.id,
      is_core: false,
      note: isPartner
        ? "seeded: partner store location"
        : "seeded: ownership NOT established — defaulted to not-ours; set explicitly with location_id + is_core if this warehouse is ours",
      label: loc.name ?? loc.id,
    })
  }
  return rows
}

export const setLocationOwnershipJob: MaintenanceJob = {
  id: "set-location-ownership",
  label: "Record which stock locations are ours (core)",
  description:
    "Mark stock locations core (ours) or not. Consumption is only ever deducted from a core location, so this is what lets us stock at several of our own warehouses and what keeps partner-held material off our books. Use seed:true once to record a row per location; it ALWAYS writes is_core:false, because 'not provably a partner's' is not the same as 'ours' and defaulting an unknown to ours is what lets a partner's bench be treated as our warehouse. Assert our own warehouses one at a time with location_id + is_core:true. Dry-run previews every row.",
  params: [
    {
      name: "seed",
      type: "boolean",
      required: false,
      description:
        "Record a row for every stock location, ALWAYS is_core:false. Never overwrites a location already recorded, and never marks anything ours — use location_id + is_core:true for that.",
    },
    {
      name: "location_id",
      type: "string",
      required: false,
      description: "Set just this location, e.g. 'sloc_01JPAQVGYJR3CDP2Q2AYV7GRDR'",
    },
    {
      name: "is_core",
      type: "boolean",
      required: false,
      description: "true = ours, deductions allowed. Required with location_id.",
    },
    {
      name: "note",
      type: "string",
      required: false,
      description: "Why — free text kept alongside the row",
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

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const service: any = container.resolve(LOCATION_OWNERSHIP_MODULE)

    const existingRows = await service.listLocationOwnerships({}, { take: null })
    const existing = new Map<string, any>(
      ((existingRows || []) as any[]).map((r) => [r.stock_location_id, r])
    )

    const changes: MaintenanceChange[] = []
    const creates: any[] = []
    const updates: any[] = []

    const plan = (
      locationId: string,
      isCore: boolean,
      note: string | null,
      label: string
    ) => {
      const row = existing.get(locationId)
      if (!row) {
        changes.push({
          entity: "location_ownership",
          id: locationId,
          field: `is_core (${label})`,
          before: null,
          after: isCore,
        })
        creates.push({ stock_location_id: locationId, is_core: isCore, note })
        return
      }
      if (row.is_core === isCore) {
        return
      }
      changes.push({
        entity: "location_ownership",
        id: locationId,
        field: `is_core (${label})`,
        before: row.is_core,
        after: isCore,
      })
      updates.push({ id: row.id, is_core: isCore, ...(note ? { note } : {}) })
    }

    if (parsed.data.seed) {
      // Partner-owned locations are every partner store's default location.
      const { data: partners } = await query.graph({
        entity: "partners",
        fields: ["id", "stores.id", "stores.default_location_id"],
      })
      const partnerLocationIds = new Set<string>()
      for (const p of (partners || []) as any[]) {
        for (const s of (p?.stores || []) as any[]) {
          if (s?.default_location_id) {
            partnerLocationIds.add(s.default_location_id)
          }
        }
      }

      const { data: locations } = await query.graph({
        entity: "stock_location",
        fields: ["id", "name"],
      })

      // The decision itself is pure and unit-tested — see
      // `planSeedOwnershipRows`, whose whole job is to never return `is_core:
      // true`. The loop here only turns those rows into planned changes.
      for (const row of planSeedOwnershipRows(
        (locations || []) as any[],
        partnerLocationIds,
        new Set(existing.keys())
      )) {
        plan(row.stock_location_id, row.is_core, row.note, row.label)
      }
    }

    if (parsed.data.location_id) {
      plan(
        parsed.data.location_id,
        parsed.data.is_core as boolean,
        parsed.data.note ?? null,
        "explicit"
      )
    }

    if (!dry_run && changes.length > 0) {
      if (creates.length) {
        await service.createLocationOwnerships(creates)
      }
      for (const u of updates) {
        await service.updateLocationOwnerships(u)
      }
    }

    const coreCount = changes.filter((c) => c.after === true).length
    const unestablished = creates.filter((c) =>
      String(c.note ?? "").includes("NOT established")
    ).length
    const summary = changes.length
      ? [
          `${dry_run ? "Would record" : "Recorded"} ${changes.length} location(s): ${coreCount} core, ${changes.length - coreCount} not ours`,
          // Said out loud rather than left to be inferred from a count: these
          // rows are a safe DEFAULT, not a finding. A warehouse of ours sitting
          // in here reads exactly like a partner's until someone says otherwise.
          unestablished
            ? `⚠️ ${unestablished} of those could not be proved either way and were defaulted to NOT ours. If any is our own warehouse, set it explicitly with location_id + is_core:true — the seed will never do it for you.`
            : "",
        ]
          .filter(Boolean)
          .join(". ")
      : "Every location already holds the requested ownership — nothing to record"

    return {
      job_id: setLocationOwnershipJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary,
      changes,
    }
  },
}
