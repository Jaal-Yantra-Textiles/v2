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
 * - `seed: true` proposes a row for every stock location, core when the
 *   location is not a partner store's. This is the bootstrap, and it is only a
 *   STARTING POINT: it reproduces the old inference, orphan and all, so the
 *   dry-run output must be read before applying.
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

export const setLocationOwnershipJob: MaintenanceJob = {
  id: "set-location-ownership",
  label: "Record which stock locations are ours (core)",
  description:
    "Mark stock locations core (ours) or not. Consumption is only ever deducted from a core location, so this is what lets us stock at several of our own warehouses and what keeps partner-held material off our books. Use seed:true once to propose a row per location from partner linkage — a starting point that reproduces the old inference including any orphan store, so read the dry-run — then correct individual locations with location_id + is_core. Dry-run previews every row.",
  params: [
    {
      name: "seed",
      type: "boolean",
      required: false,
      description:
        "Propose a row for every stock location, core when it is not a partner store's. Never overwrites a location already recorded.",
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

      for (const loc of (locations || []) as any[]) {
        // Seeding never overwrites a recorded decision — an operator who has
        // already corrected the orphan must not have it undone by a re-run.
        if (existing.has(loc.id)) {
          continue
        }
        const isPartner = partnerLocationIds.has(loc.id)
        plan(
          loc.id,
          !isPartner,
          isPartner ? "seeded: partner store location" : "seeded: not a partner location",
          loc.name ?? loc.id
        )
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
    const summary = changes.length
      ? `${dry_run ? "Would record" : "Recorded"} ${changes.length} location(s): ${coreCount} core, ${changes.length - coreCount} not ours`
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
